import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  let contentsId = 1;
  class FakeWebContents extends EventEmitter {
    id = contentsId++;
    url = "about:blank";
    title = "Fixture";
    destroyed = false;
    zoom = 1;
    session = { setPermissionRequestHandler: vi.fn() };
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    };
    async loadURL(url: string) {
      this.url = url;
    }
    getURL() {
      return this.url;
    }
    getTitle() {
      return this.title;
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
    setWindowOpenHandler() {}
    setZoomFactor(value: number) {
      this.zoom = value;
    }
    getZoomFactor() {
      return this.zoom;
    }
    disableDeviceEmulation() {}
    enableDeviceEmulation() {}
    reload() {}
    stop() {}
    async executeJavaScript(source: string) {
      return source.includes("innerWidth")
        ? { width: 800, height: 600, dpr: 1 }
        : source.includes("innerText")
          ? ""
          : {};
    }
    async capturePage() {
      return { isEmpty: () => false, toPNG: () => Buffer.from("fixture") };
    }
  }
  class FakeView {
    webContents = new FakeWebContents();
    visible = false;
    bounds: unknown = {};
    setVisible(value: boolean) {
      this.visible = value;
    }
    setBounds(value: unknown) {
      this.bounds = value;
    }
  }
  class FakeWindow {
    static all = new Map<number, FakeWindow>();
    contentView = {
      children: [] as FakeView[],
      addChildView: (view: FakeView) => this.contentView.children.push(view),
      removeChildView: (view: FakeView) => {
        this.contentView.children = this.contentView.children.filter(
          (candidate) => candidate !== view,
        );
      },
    };
    constructor(public id: number) {
      FakeWindow.all.set(id, this);
    }
    static fromId(id: number) {
      return FakeWindow.all.get(id) || null;
    }
    getContentBounds() {
      return { width: 1200, height: 800 };
    }
  }
  return {
    BrowserWindow: FakeWindow,
    WebContentsView: FakeView,
    shell: { openExternal: vi.fn() },
  };
});

import { BrowserWindow } from "electron";
import { BrowserService } from "../electron/browser";
import type { HostEvent } from "../shared/types";

type BrowserTabView = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  error?: string;
  projectId?: string;
  sessionId?: string;
  active: boolean;
  lastActiveAt: number;
};

const tab = (value: unknown) => value as BrowserTabView;
const tabs = (value: unknown) => value as BrowserTabView[];

describe("browser tab ownership and active selection", () => {
  it("persists a normalized main-frame load failure until navigation recovers", async () => {
    const events: HostEvent[] = [],
      service = new BrowserService(
        "/tmp/workbench-browser-load-error",
        (event) => events.push(event),
      ),
      window = new (BrowserWindow as any)(91) as BrowserWindow,
      created = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/start" },
          window,
        ),
      ),
      contents = (window as any).contentView.children[0].webContents;

    contents.emit("did-start-loading");
    contents.emit(
      "did-fail-load",
      {},
      -105,
      "<html><body>  ERR_NAME_NOT_RESOLVED\n retry later </body></html>",
      "https://broken.example.test/",
      true,
    );
    // Electron normally emits did-stop-loading after did-fail-load. The stop
    // event must not erase the diagnostic before the renderer re-reads it.
    contents.emit("did-stop-loading");

    let listed = tab(
      tabs(await service.invoke("browser.list", {}, window)).find(
        (candidate) => candidate.id === created.id,
      ),
    );
    expect(listed.loading).toBe(false);
    expect(listed.error).toBe(
      "Не удалось загрузить страницу: ERR_NAME_NOT_RESOLVED retry later (-105)",
    );
    expect(
      events.some(
        (event) =>
          event.type === "browser.changed" &&
          (event.payload as BrowserTabView).error === listed.error,
      ),
    ).toBe(true);

    // A subframe failure is not a failure of the visible page.
    contents.emit(
      "did-fail-load",
      {},
      -2,
      "ERR_FAILED",
      "https://cdn.example.test/frame",
      false,
    );
    expect(
      tab(
        tabs(await service.invoke("browser.list", {}, window)).find(
          (candidate) => candidate.id === created.id,
        ),
      ).error,
    ).toBe(listed.error);

    contents.emit("did-start-loading");
    listed = tab(
      tabs(await service.invoke("browser.list", {}, window)).find(
        (candidate) => candidate.id === created.id,
      ),
    );
    expect(listed.loading).toBe(true);
    expect(listed.error).toBeUndefined();
    contents.emit("did-finish-load");
    expect(
      tab(
        tabs(await service.invoke("browser.list", {}, window)).find(
          (candidate) => candidate.id === created.id,
        ),
      ).error,
    ).toBeUndefined();
    service.dispose();
  });

  it("persists renderer crashes and clears them for an explicit navigation", async () => {
    const service = new BrowserService(
        "/tmp/workbench-browser-render-error",
        () => {},
      ),
      window = new (BrowserWindow as any)(92) as BrowserWindow,
      created = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/start" },
          window,
        ),
      ),
      contents = (window as any).contentView.children[0].webContents;

    contents.emit("did-start-loading");
    contents.emit("render-process-gone", {}, { reason: "<b>crashed</b>\n" });
    let listed = tab(
      tabs(await service.invoke("browser.list", {}, window)).find(
        (candidate) => candidate.id === created.id,
      ),
    );
    expect(listed.loading).toBe(false);
    expect(listed.error).toBe("Процесс страницы завершился: crashed");
    expect(
      tab(await service.invoke("browser.inspect", { id: created.id }, window))
        .error,
    ).toBe(listed.error);

    await service.invoke(
      "browser.navigate",
      { id: created.id, url: "https://example.test/recovered" },
      window,
    );
    listed = tab(
      tabs(await service.invoke("browser.list", {}, window)).find(
        (candidate) => candidate.id === created.id,
      ),
    );
    expect(listed.error).toBeUndefined();
    service.dispose();
  });

  it("isolates window events, preserves an explicit active tab and deduplicates opens", async () => {
    const events: HostEvent[] = [];
    const service = new BrowserService("/tmp/workbench-browser-test", (event) =>
      events.push(event),
    );
    const first = new (BrowserWindow as any)(101) as BrowserWindow;
    const second = new (BrowserWindow as any)(202) as BrowserWindow;

    const a1 = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/a",
          requestId: "create-a",
        },
        first,
      ),
    );
    const duplicate = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/ignored",
          requestId: "create-a",
        },
        first,
      ),
    );
    expect(duplicate.id).toBe(a1.id);

    const a2 = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/b",
          requestId: "create-b",
        },
        first,
      ),
    );
    const b1 = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/window-b",
          requestId: "create-a",
        },
        second,
      ),
    );

    expect(tabs(await service.invoke("browser.list", {}, first))).toHaveLength(
      2,
    );
    expect(tabs(await service.invoke("browser.list", {}, second))).toHaveLength(
      1,
    );
    expect(
      tabs(await service.invoke("browser.list", {}, first)).find(
        (tab: any) => tab.active,
      )?.id,
    ).toBe(a2.id);

    await service.invoke("browser.activate", { id: a1.id }, first);
    expect(
      tabs(await service.invoke("browser.list", {}, first)).find(
        (tab: any) => tab.active,
      )?.id,
    ).toBe(a1.id);

    await service.invoke("browser.close", { id: a1.id }, first);
    expect(
      tabs(await service.invoke("browser.list", {}, first)).find(
        (tab: any) => tab.active,
      )?.id,
    ).toBe(a2.id);

    const preview = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/preview",
          reuseKey: "artifact:one",
        },
        first,
      ),
    );
    const samePreview = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/preview",
          reuseKey: "artifact:one",
        },
        first,
      ),
    );
    expect(samePreview.id).toBe(preview.id);
    expect(tabs(await service.invoke("browser.list", {}, first))).toHaveLength(
      2,
    );

    service.transferWindow(first as any, second as any);
    expect(tabs(await service.invoke("browser.list", {}, first))).toHaveLength(
      0,
    );
    expect(tabs(await service.invoke("browser.list", {}, second))).toHaveLength(
      3,
    );
    expect(
      tabs(await service.invoke("browser.list", {}, second)).find(
        (tab: any) => tab.active,
      )?.id,
    ).toBe(b1.id);

    expect(events.length).toBeGreaterThan(0);
    expect(
      events.every(
        (event) => event.targetWindowId === 101 || event.targetWindowId === 202,
      ),
    ).toBe(true);
    service.dispose();
  });

  it("keeps strip order, ignores layout as activation and closes to the adjacent tab", async () => {
    const service = new BrowserService(
        "/tmp/workbench-browser-order",
        () => {},
      ),
      window = new (BrowserWindow as any)(303) as BrowserWindow;
    const a = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/a" },
          window,
        ),
      ),
      b = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/b" },
          window,
        ),
      ),
      c = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/c" },
          window,
        ),
      );

    await service.invoke("browser.activate", { id: a.id }, window);
    await service.invoke(
      "browser.bounds",
      { id: c.id, x: 0, y: 0, width: 800, height: 600, visible: true },
      window,
    );
    let listed = tabs(await service.invoke("browser.list", {}, window));
    expect(listed.map((candidate) => candidate.id)).toEqual([a.id, b.id, c.id]);
    expect(listed.find((candidate) => candidate.active)?.id).toBe(a.id);

    await service.invoke("browser.activate", { id: b.id }, window);
    await service.invoke("browser.close", { id: b.id }, window);
    listed = tabs(await service.invoke("browser.list", {}, window));
    expect(listed.map((candidate) => candidate.id)).toEqual([a.id, c.id]);
    expect(listed.find((candidate) => candidate.active)?.id).toBe(c.id);

    await service.invoke("browser.close", { id: c.id }, window);
    listed = tabs(await service.invoke("browser.list", {}, window));
    expect(listed.map((candidate) => candidate.id)).toEqual([a.id]);
    expect(listed.find((candidate) => candidate.active)?.id).toBe(a.id);
    service.dispose();
  });

  it("scopes create request ids to the owner window and project", async () => {
    const service = new BrowserService(
        "/tmp/workbench-browser-request-scope",
        () => {},
      ),
      window = new (BrowserWindow as any)(350) as BrowserWindow;
    const first = tab(
        await service.invoke(
          "browser.create",
          {
            projectId: "project-a",
            url: "https://example.test/a",
            requestId: "same-request",
          },
          window,
        ),
      ),
      second = tab(
        await service.invoke(
          "browser.create",
          {
            projectId: "project-b",
            url: "https://example.test/b",
            requestId: "same-request",
          },
          window,
        ),
      );

    expect(second.id).not.toBe(first.id);
    expect(tabs(await service.invoke("browser.list", {}, window))).toHaveLength(
      2,
    );
    service.dispose();
  });

  it("rejects every existing-tab operation from a non-owner window", async () => {
    const service = new BrowserService(
        "/tmp/workbench-browser-owner",
        () => {},
      ),
      owner = new (BrowserWindow as any)(404) as BrowserWindow,
      observer = new (BrowserWindow as any)(405) as BrowserWindow,
      owned = tab(
        await service.invoke(
          "browser.create",
          { projectId: "project", url: "https://example.test/owned" },
          owner,
        ),
      );
    const operations: Array<[string, Record<string, unknown>]> = [
      ["browser.activate", {}],
      ["browser.bounds", { visible: false }],
      ["browser.close", {}],
      ["browser.rename", { title: "foreign" }],
      ["browser.navigate", { url: "https://example.test/foreign" }],
      ["browser.back", {}],
      ["browser.forward", {}],
      ["browser.reload", {}],
      ["browser.stop", {}],
      ["browser.external", {}],
      ["browser.zoom", { factor: 1 }],
      ["browser.resetEmulation", {}],
      ["browser.emulate", { width: 390, height: 844, deviceScaleFactor: 1 }],
      ["browser.capture", {}],
      ["browser.inspect", {}],
      ["browser.act", { action: "click", selector: "body" }],
    ];
    for (const [method, params] of operations)
      await expect(
        service.invoke(method, { id: owned.id, ...params }, observer),
      ).rejects.toThrow("другому окну");
    expect(tabs(await service.invoke("browser.list", {}, owner))).toHaveLength(
      1,
    );
    service.dispose();
  });

  it("moves request ids and collapses reusable duplicates during window transfer", async () => {
    const service = new BrowserService(
        "/tmp/workbench-browser-transfer",
        () => {},
      ),
      source = new (BrowserWindow as any)(501) as BrowserWindow,
      target = new (BrowserWindow as any)(502) as BrowserWindow;
    const sourceArtifact = tab(
        await service.invoke(
          "browser.create",
          {
            projectId: "project",
            url: "https://example.test/source-artifact",
            reuseKey: "artifact:shared",
            requestId: "source-artifact",
          },
          source,
        ),
      ),
      moved = tab(
        await service.invoke(
          "browser.create",
          {
            projectId: "project",
            url: "https://example.test/moved",
            requestId: "portable-request",
          },
          source,
        ),
      ),
      targetArtifact = tab(
        await service.invoke(
          "browser.create",
          {
            projectId: "project",
            url: "https://example.test/target-artifact",
            reuseKey: "artifact:shared",
            requestId: "target-artifact",
          },
          target,
        ),
      );

    service.transferWindow(source as any, target as any);
    expect(tabs(await service.invoke("browser.list", {}, source))).toEqual([]);
    let targetTabs = tabs(await service.invoke("browser.list", {}, target));
    expect(targetTabs.map((candidate) => candidate.id)).toEqual([
      targetArtifact.id,
      moved.id,
    ]);
    expect(
      targetTabs.some((candidate) => candidate.id === sourceArtifact.id),
    ).toBe(false);
    expect(targetTabs.find((candidate) => candidate.active)?.id).toBe(
      targetArtifact.id,
    );

    const requestRetry = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/ignored",
          requestId: "portable-request",
        },
        target,
      ),
    );
    const duplicateRetry = tab(
      await service.invoke(
        "browser.create",
        {
          projectId: "project",
          url: "https://example.test/ignored-too",
          requestId: "source-artifact",
        },
        target,
      ),
    );
    expect(requestRetry.id).toBe(moved.id);
    expect(duplicateRetry.id).toBe(targetArtifact.id);
    targetTabs = tabs(await service.invoke("browser.list", {}, target));
    expect(targetTabs).toHaveLength(2);
    service.dispose();
  });
});
