import { BrowserWindow, WebContentsView, session, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IdeProcessPool, type IdeEngine } from "./ide-process";
import { scopedPath } from "./workspace";
import { redact } from "./acp";
import type { HostEvent, Project } from "../shared/types";

type IdeView = {
  engine: IdeEngine;
  view: WebContentsView;
  windowId?: number;
  ready: Promise<void>;
  visible: boolean;
};
export class IdeService {
  readonly pool: IdeProcessPool;
  private views = new Map<string, IdeView>();
  private creating = new Map<string, Promise<IdeView>>();
  private closing = false;
  private placements = new Map<string, { epoch: number; visible: boolean }>();
  constructor(
    readonly options: {
      runtimeRoot: string;
      nodePath: string;
      dataDir: string;
      toolchainsRoot?: string;
      project(id: string): Project;
      emit(event: HostEvent): void;
    },
  ) {
    this.pool = new IdeProcessPool({
      ...options,
      changed: () =>
        options.emit({ type: "ide.changed", payload: this.pool.snapshot() }),
    });
  }
  async ensure(projectId: string): Promise<IdeView> {
    if (this.closing) throw new Error("IDE is shutting down");
    const engine = await this.pool.ensure(this.options.project(projectId));
    if (this.closing) throw new Error("IDE is shutting down");
    const existing = this.views.get(engine.id);
    if (
      existing &&
      existing.engine === engine &&
      !existing.view.webContents.isDestroyed()
    )
      return existing;
    const pending = this.creating.get(engine.id);
    if (pending) return pending;
    const creation = (async () => {
      const previousWindow = existing?.windowId
        ? BrowserWindow.fromId(existing.windowId)
        : undefined;
      const bounds = existing?.view.getBounds(),
        visible = existing?.visible;
      if (existing) {
        if (!existing.view.webContents.isDestroyed()) {
          // If only the backend died, rescue the still-live editor memory before replacing its view.
          const recovery = await existing.view.webContents
            .executeJavaScript('window.workbenchIDE?.invoke("recovery.export")')
            .catch(() => undefined);
          if (recovery) {
            const file = path.join(
              engine.configPath,
              "workbench-recovery.json",
            );
            await fs.writeFile(file + ".partial", JSON.stringify(recovery), {
              mode: 0o600,
            });
            await fs.rename(file + ".partial", file);
          }
          if (previousWindow && !previousWindow.isDestroyed())
            previousWindow.contentView.removeChildView(existing.view);
          existing.view.webContents.close();
        }
        this.views.delete(engine.id);
      }
      const entry = await this.create(engine);
      if (previousWindow && !previousWindow.isDestroyed()) {
        this.attach(entry, previousWindow);
        if (bounds) entry.view.setBounds(bounds);
        entry.visible = Boolean(visible);
        entry.view.setVisible(Boolean(visible));
      }
      return entry;
    })().finally(() => this.creating.delete(engine.id));
    this.creating.set(engine.id, creation);
    return creation;
  }
  private async create(engine: IdeEngine): Promise<IdeView> {
    const consoleFile = path.join(
      path.dirname(engine.logPath),
      "frontend.jsonl",
    );
    let consoleWrites: Promise<unknown> = Promise.resolve();
    const partition = session.fromPartition(
      `persist:workbench-ide-${engine.id}`,
    );
    const origin = `http://localhost:${engine.port}`;
    partition.webRequest.onBeforeSendHeaders(
      {
        urls: [
          origin + "/*",
          origin.replace("http:", "ws:") + "/*",
          `http://*.webview.localhost:${engine.port}/*`,
        ],
      },
      (details, callback) => {
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            "x-workbench-ide-token": engine.token,
          },
        });
      },
    );
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        session: partition,
      },
    });
    view.setBackgroundColor("#181b19");
    view.webContents.on("console-message", (details) => {
      if (!["error", "warning"].includes(details.level)) return;
      const record = JSON.stringify({
        at: new Date().toISOString(),
        level: details.level,
        message: String(redact(details.message))
          .replaceAll(engine.token, "[IDE_TOKEN]")
          .slice(0, 8000),
        line: details.lineNumber,
      });
      consoleWrites = consoleWrites
        .catch(() => {})
        .then(async () => {
          if (
            (await fs.stat(consoleFile).catch(() => undefined))?.size! >
            5_000_000
          ) {
            await fs.rm(consoleFile + ".1", { force: true });
            await fs.rename(consoleFile, consoleFile + ".1");
          }
          await fs.appendFile(consoleFile, record + "\n", { mode: 0o600 });
        });
      void consoleWrites.catch(() => {});
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && !url.startsWith(origin))
        void shell.openExternal(url);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      engine.error = "IDE_RENDERER_" + details.reason;
      this.options.emit({ type: "ide.changed", payload: this.pool.snapshot() });
    });
    const entry: IdeView = {
      engine,
      view,
      visible: false,
      ready: Promise.resolve(),
    };
    this.views.set(engine.id, entry);
    entry.ready = (async () => {
      await view.webContents.loadURL(
        `${origin}/#${encodeURI(engine.root.replaceAll("\\", "/"))}`,
      );
      const started = Date.now();
      while (!view.webContents.isDestroyed()) {
        if (
          await view.webContents.executeJavaScript(
            "Boolean(window.workbenchIDE?.version === 1)",
          )
        ) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              view.webContents.executeJavaScript(
                'window.workbenchIDE.invoke("ready")',
              ),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("IDE_EXTENSIONS_START_TIMEOUT")),
                  90_000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          return;
        }
        if (Date.now() - started > 90_000)
          throw new Error("IDE_FRONTEND_TIMEOUT");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("IDE_VIEW_CLOSED");
    })();
    // A view can be hidden while its frontend initializes. Do not leave a rejected startup unobserved.
    void entry.ready.catch((error) => {
      engine.error = String(error);
      this.options.emit({ type: "ide.changed", payload: this.pool.snapshot() });
    });
    return entry;
  }
  private attach(entry: IdeView, window: BrowserWindow): void {
    if (entry.windowId === window.id) return;
    const previous = entry.windowId
      ? BrowserWindow.fromId(entry.windowId)
      : undefined;
    if (previous && !previous.isDestroyed())
      previous.contentView.removeChildView(entry.view);
    window.contentView.addChildView(entry.view);
    entry.windowId = window.id;
    this.options.emit({
      type: "ide.owner",
      payload: {
        engineId: entry.engine.id,
        projectIds: [...entry.engine.projectIds],
        windowId: window.id,
      },
    });
  }
  async rpc(projectId: string, method: string, params: any = {}): Promise<any> {
    const entry = await this.ensure(projectId);
    await entry.ready;
    const p = { ...params };
    if (p.path !== undefined || p.uri !== undefined) {
      const requested = p.uri ? fileURLToPath(p.uri) : p.path;
      const location = await scopedPath(
        this.options.project(projectId),
        requested,
        method.startsWith("recovery."),
      );
      p.uri = pathToFileURL(location.full).toString();
      delete p.path;
    }
    if (JSON.stringify(p).length > 2_100_000)
      throw new Error("IDE_REQUEST_TOO_LARGE");
    if (method === "semantic.apply") {
      const proposal = await entry.view.webContents.executeJavaScript(
        `window.workbenchIDE.invoke("semantic.files", ${JSON.stringify({ proposalId: p.proposalId })})`,
      );
      for (const file of proposal)
        await scopedPath(
          this.options.project(projectId),
          fileURLToPath(file.uri),
          !file.exists,
        );
    }
    const result = await entry.view.webContents.executeJavaScript(
      `window.workbenchIDE.invoke(${JSON.stringify(method)}, ${JSON.stringify(p)})`,
    );
    if (p.focus && entry.visible) entry.view.webContents.focus();
    return method === "status"
      ? { ...result, toolchains: entry.engine.toolchains }
      : result;
  }
  async invoke(method: string, p: any, window: BrowserWindow): Promise<any> {
    if (method === "ide.installation") {
      const exists = async (file: string) =>
        Boolean((await fs.stat(file).catch(() => undefined))?.isFile());
      const nodeInstalled = await exists(this.options.nodePath),
        engineInstalled = await exists(
          path.join(this.options.runtimeRoot, "src-gen/backend/main.js"),
        ),
        extensionsInstalled = await exists(
          path.join(
            this.options.runtimeRoot,
            "plugins/workbench-theme/package.json",
          ),
        );
      return {
        engine: "theia",
        version: "1.76.0",
        nodeInstalled,
        engineInstalled,
        extensionsInstalled,
        ready: nodeInstalled && engineInstalled && extensionsInstalled,
      };
    }
    if (method === "ide.list") return this.pool.snapshot();
    const projectId = String(p.projectId || "");
    this.options.project(projectId);
    if (method === "ide.start") {
      const entry = await this.ensure(projectId);
      return {
        ...this.pool.snapshot().find((value) => value.id === entry.engine.id),
        ownerWindowId: entry.windowId,
      };
    }
    if (method === "ide.bounds") {
      const key = `${window.id}:${projectId}`;
      const epoch = (this.placements.get(key)?.epoch || 0) + 1;
      this.placements.set(key, { epoch, visible: Boolean(p.visible) });
      if (!p.visible) {
        for (const entry of this.views.values())
          if (
            entry.engine.projectIds.has(projectId) &&
            entry.windowId === window.id
          ) {
            entry.visible = false;
            entry.view.setVisible(false);
          }
        return;
      }
      const entry = await this.ensure(projectId);
      if (
        window.isDestroyed() ||
        this.placements.get(key)?.epoch !== epoch ||
        !this.placements.get(key)?.visible
      )
        return;
      if (entry.windowId && entry.windowId !== window.id && !p.claim)
        return { needsTransfer: true, ownerWindowId: entry.windowId };
      this.attach(entry, window);
      const [width, height] = window.getContentSize();
      const x = Math.max(0, Math.min(width, Math.round(Number(p.x) || 0))),
        y = Math.max(0, Math.min(height, Math.round(Number(p.y) || 0)));
      entry.view.setBounds({
        x,
        y,
        width: Math.max(
          1,
          Math.min(width - x, Math.round(Number(p.width) || 1)),
        ),
        height: Math.max(
          1,
          Math.min(height - y, Math.round(Number(p.height) || 1)),
        ),
      });
      entry.visible = true;
      entry.view.setVisible(true);
      return { visible: true, engineId: entry.engine.id };
    }
    if (method === "ide.stop" || method === "ide.restart") {
      for (const [id, entry] of this.views)
        if (entry.engine.projectIds.has(projectId)) {
          const owner = entry.windowId
            ? BrowserWindow.fromId(entry.windowId)
            : undefined;
          if (owner && !owner.isDestroyed())
            owner.contentView.removeChildView(entry.view);
          const wasReady = await entry.ready.then(
            () => true,
            () => false,
          );
          if (
            wasReady &&
            !entry.engine.error &&
            !entry.view.webContents.isDestroyed()
          )
            await entry.view.webContents.executeJavaScript(
              'window.workbenchIDE.invoke("recovery.flush")',
            );
          entry.view.webContents.close();
          this.views.delete(id);
          await this.pool.terminate(entry.engine);
        }
      return method === "ide.restart"
        ? this.invoke("ide.start", p, window)
        : { stopped: true };
    }
    if (method === "ide.capture") {
      const entry = await this.ensure(projectId);
      await entry.ready;
      const image = await entry.view.webContents.capturePage();
      const file = path.join(
        this.options.dataDir,
        "artifacts",
        `ide-${Date.now()}.png`,
      );
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, image.toPNG());
      return { path: file };
    }
    return this.rpc(projectId, method.slice(4), p);
  }
  hideWindow(windowId: number): void {
    for (const entry of this.views.values())
      if (entry.windowId === windowId) entry.view.setVisible(false);
  }
  transferWindow(from: BrowserWindow, to: BrowserWindow): void {
    for (const entry of this.views.values())
      if (entry.windowId === from.id) {
        this.attach(entry, to);
        entry.view.setVisible(false);
        entry.visible = false;
      }
  }
  closeWindow(windowId: number): void {
    for (const entry of this.views.values())
      if (entry.windowId === windowId) {
        entry.windowId = undefined;
        entry.visible = false;
        entry.view.setVisible(false);
      }
  }
  async dispose(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.creating.values()]);
    for (const entry of this.views.values())
      if (!entry.view.webContents.isDestroyed()) {
        await entry.ready
          .then(() =>
            entry.view.webContents.executeJavaScript(
              'window.workbenchIDE.invoke("recovery.flush")',
            ),
          )
          .catch(() => {});
        entry.view.webContents.close();
      }
    this.views.clear();
    await this.pool.dispose();
  }
}
