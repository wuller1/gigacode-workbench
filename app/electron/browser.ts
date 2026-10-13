import { BrowserWindow, WebContentsView, shell } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HostEvent } from "../shared/types";
type Tab = {
  id: string;
  title: string;
  url: string;
  projectId?: string;
  sessionId?: string;
  owner: number;
  view: WebContentsView;
  customTitle?: string;
  loading: boolean;
  error?: string;
  lastActiveAt: number;
  reuseKey?: string;
  emulation?: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
  };
};
const BROWSER_ERROR_LIMIT = 500;

/** Convert provider/Electron failures, including HTML gateway pages, to safe UI text. */
export function normalizeBrowserError(
  value: unknown,
  fallback = "Неизвестная ошибка страницы",
) {
  const source =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String((value as { message?: unknown }).message || "")
          : value == null
            ? ""
            : String(value);
  const normalized = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, BROWSER_ERROR_LIMIT);
}

export function safeWebUrl(value: string) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) && value !== "about:blank")
    throw new Error("Поддерживаются только HTTP и HTTPS адреса");
  if (u.username || u.password)
    throw new Error("Логин и пароль в адресе запрещены");
  return u.toString();
}
export class BrowserService {
  private tabs = new Map<string, Tab>();
  private active = new Map<string, string>();
  private createRequests = new Map<string, string>();
  constructor(
    private dataDir: string,
    private emit: (e: HostEvent) => void,
  ) {}
  list(owner?: number) {
    return [...this.tabs.values()]
      .filter((t) => owner === undefined || t.owner === owner)
      .map((t) => this.meta(t));
  }
  private meta(t: Tab) {
    return {
      id: t.id,
      title: t.customTitle || t.title,
      url: t.url,
      loading: t.loading,
      error: t.error,
      projectId: t.projectId,
      sessionId: t.sessionId,
      active: this.activeId(t.owner, t.projectId) === t.id,
      lastActiveAt: t.lastActiveAt,
    };
  }
  private group(owner: number, projectId?: string) {
    return `${owner}:${projectId || ""}`;
  }
  private requestKey(
    owner: number,
    projectId: string | undefined,
    requestId: string,
  ) {
    return `${owner}:${encodeURIComponent(projectId || "")}:${encodeURIComponent(requestId)}`;
  }
  private activeId(owner: number, projectId?: string) {
    const key = this.group(owner, projectId),
      stored = this.active.get(key),
      candidates = this.groupTabs(owner, projectId);
    if (stored && candidates.some((tab) => tab.id === stored)) return stored;
    // Map iteration is the tab-strip order. Never sort here: doing so made a
    // refresh silently reorder the fallback selection.
    const fallback = candidates[0]?.id;
    if (fallback) this.active.set(key, fallback);
    else this.active.delete(key);
    return fallback;
  }
  private groupTabs(owner: number, projectId?: string) {
    return [...this.tabs.values()].filter(
      (tab) => tab.owner === owner && tab.projectId === projectId,
    );
  }
  private activate(t: Tab) {
    t.lastActiveAt = Date.now();
    this.active.set(this.group(t.owner, t.projectId), t.id);
  }
  private changed(t: Tab, payload: unknown = this.meta(t)) {
    this.emit({
      type: "browser.changed",
      payload,
      targetWindowId: t.owner,
    });
  }
  private clearError(t: Tab) {
    t.error = undefined;
  }
  private fail(t: Tab, value: unknown, fallback: string) {
    t.loading = false;
    t.error = normalizeBrowserError(value, fallback);
    this.changed(t);
  }
  private get(id: string) {
    const t = this.tabs.get(id);
    if (!t || t.view.webContents.isDestroyed())
      throw new Error("Вкладка уже закрыта");
    return t;
  }
  owns(id: string, sessionId: string) {
    return this.get(id).sessionId === sessionId;
  }
  async invoke(method: string, p: any, window: BrowserWindow) {
    if (method === "browser.list") return this.list(window.id);
    if (method === "browser.create") {
      const requestId =
        typeof p.requestId === "string" ? p.requestId.trim().slice(0, 120) : "";
      // Idempotency is project-scoped as well as window-scoped. Reusing a
      // caller request id in another project must never return that project's
      // native tab or switch its active selection.
      const requestKey = requestId
        ? this.requestKey(window.id, p.projectId, requestId)
        : "";
      if (requestKey) {
        const previous = this.createRequests.get(requestKey),
          existing = previous ? this.tabs.get(previous) : undefined;
        if (
          existing &&
          existing.owner === window.id &&
          !existing.view.webContents.isDestroyed()
        ) {
          this.activate(existing);
          this.changed(existing);
          return this.meta(existing);
        }
        this.createRequests.delete(requestKey);
      }
      const reuseKey =
        typeof p.reuseKey === "string" ? p.reuseKey.trim().slice(0, 240) : "";
      if (reuseKey) {
        const existing = [...this.tabs.values()].find(
          (tab) =>
            tab.owner === window.id &&
            tab.projectId === p.projectId &&
            tab.reuseKey === reuseKey &&
            !tab.view.webContents.isDestroyed(),
        );
        if (existing) {
          if (requestKey) this.createRequests.set(requestKey, existing.id);
          this.activate(existing);
          if (p.url) {
            const nextUrl = safeWebUrl(String(p.url));
            if (nextUrl !== existing.url)
              await existing.view.webContents.loadURL(nextUrl);
          }
          this.changed(existing);
          return this.meta(existing);
        }
      }
      if (this.tabs.size >= 16)
        throw new Error("Открыто 16 вкладок. Закройте неиспользуемую");
      const url = safeWebUrl(String(p.url || "about:blank"));
      const id = randomUUID();
      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition:
            "persist:workbench-project-" +
            String(p.projectId || id).replace(/[^a-zA-Z0-9-]/g, ""),
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const tab: Tab = {
        id,
        title: "Новая вкладка",
        customTitle:
          typeof p.title === "string"
            ? p.title.trim().slice(0, 120) || undefined
            : undefined,
        url,
        projectId: p.projectId,
        sessionId: p.sessionId,
        owner: window.id,
        view,
        loading: false,
        lastActiveAt: Date.now(),
        reuseKey: reuseKey || undefined,
      };
      this.tabs.set(id, tab);
      if (requestKey) this.createRequests.set(requestKey, id);
      this.activate(tab);
      view.setVisible(false);
      window.contentView.addChildView(view);
      const update = () => {
        if (view.webContents.isDestroyed()) return;
        tab.url = view.webContents.getURL() || url;
        tab.title = view.webContents.getTitle() || "Новая вкладка";
        this.changed(tab);
      };
      view.webContents.on("did-start-loading", () => {
        tab.loading = true;
        this.clearError(tab);
        update();
      });
      view.webContents.on("did-stop-loading", () => {
        tab.loading = false;
        update();
      });
      view.webContents.on("did-finish-load", () => {
        tab.loading = false;
        this.clearError(tab);
        update();
      });
      view.webContents.on("page-title-updated", update);
      view.webContents.on("did-navigate", () => {
        this.clearError(tab);
        update();
      });
      view.webContents.on("did-navigate-in-page", () => {
        this.clearError(tab);
        update();
      });
      view.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
          // Subframe failures do not mean that the visible page failed. An
          // aborted load is the expected result when another navigation wins.
          if (!isMainFrame || errorCode === -3) return;
          const detail = normalizeBrowserError(errorDescription, "");
          this.fail(
            tab,
            detail
              ? `Не удалось загрузить страницу: ${detail} (${errorCode})`
              : `Не удалось загрузить страницу (${errorCode})`,
            "Не удалось загрузить страницу",
          );
        },
      );
      view.webContents.on("will-navigate", (event, dest) => {
        try {
          safeWebUrl(dest);
        } catch {
          event.preventDefault();
        }
      });
      view.webContents.setWindowOpenHandler(({ url: dest }) => {
        try {
          safeWebUrl(dest);
          const owner = BrowserWindow.fromId(tab.owner);
          if (owner)
            void this.invoke(
              "browser.create",
              { url: dest, projectId: tab.projectId, sessionId: tab.sessionId },
              owner,
            ).catch(() => {});
        } catch {}
        return { action: "deny" };
      });
      view.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      view.webContents.on("render-process-gone", (_e, details) => {
        this.fail(
          tab,
          `Процесс страницы завершился: ${normalizeBrowserError(
            details.reason,
            "причина неизвестна",
          )}`,
          "Процесс страницы завершился",
        );
      });
      await view.webContents.loadURL(url).catch((error) => {
        this.fail(tab, error, "Не удалось загрузить страницу");
      });
      update();
      return this.meta(tab);
    }
    if (method === "browser.bounds" && !p.visible && !this.tabs.has(p.id))
      return;
    const t = this.get(p.id),
      wc = t.view.webContents;
    // A tab is a native child view of exactly one BrowserWindow. Validate the
    // owner once before every operation so a stale renderer cannot navigate,
    // inspect, capture or close a different window's tab.
    if (window.id !== t.owner)
      throw new Error("Вкладка принадлежит другому окну");
    if (method === "browser.activate") {
      this.activate(t);
      this.changed(t);
      return this.meta(t);
    }
    if (method === "browser.bounds") {
      const size = window.getContentBounds();
      const x = Math.max(0, Math.round(Number(p.x) || 0)),
        y = Math.max(0, Math.round(Number(p.y) || 0));
      const width = Math.max(
          1,
          Math.min(size.width - x, Math.round(Number(p.width) || 1)),
        ),
        height = Math.max(
          1,
          Math.min(size.height - y, Math.round(Number(p.height) || 1)),
        );
      // Layout is deliberately not an activation signal. A delayed
      // ResizeObserver callback from the old tab must not steal selection
      // after browser.create/browser.activate selected another one.
      t.view.setBounds({ x, y, width, height });
      t.view.setVisible(!!p.visible && width > 1 && height > 1);
      return;
    }
    if (method === "browser.close") {
      this.close(t.id);
      return;
    }
    if (method === "browser.rename") {
      t.customTitle =
        String(p.title || p.name || "")
          .trim()
          .slice(0, 120) || undefined;
      this.changed(t);
      return this.meta(t);
    }
    if (method === "browser.navigate") {
      const destination = safeWebUrl(String(p.url || ""));
      this.clearError(t);
      await wc.loadURL(destination);
      return this.meta(t);
    }
    if (method === "browser.back") {
      if (wc.navigationHistory.canGoBack()) {
        this.clearError(t);
        wc.navigationHistory.goBack();
        this.changed(t);
      }
      return;
    }
    if (method === "browser.forward") {
      if (wc.navigationHistory.canGoForward()) {
        this.clearError(t);
        wc.navigationHistory.goForward();
        this.changed(t);
      }
      return;
    }
    if (method === "browser.reload") {
      this.clearError(t);
      wc.reload();
      this.changed(t);
      return;
    }
    if (method === "browser.stop") {
      wc.stop();
      return;
    }
    if (method === "browser.external") {
      await shell.openExternal(safeWebUrl(wc.getURL()));
      return;
    }
    if (method === "browser.zoom") {
      const factor = Number(p.factor);
      if (!Number.isFinite(factor) || factor < 0.25 || factor > 3)
        throw new Error("Масштаб должен быть от 25% до 300%");
      wc.setZoomFactor(factor);
      return this.inspect(t);
    }
    if (method === "browser.resetEmulation") {
      wc.disableDeviceEmulation();
      t.emulation = undefined;
      return this.inspect(t);
    }
    if (method === "browser.emulate") {
      const width = Math.round(Number(p.width)),
        height = Math.round(Number(p.height)),
        dpr = Number(p.deviceScaleFactor || 1);
      if (
        width < 240 ||
        width > 3840 ||
        height < 240 ||
        height > 3840 ||
        dpr < 0.5 ||
        dpr > 4
      )
        throw new Error("Недопустимые размеры или DPR");
      t.emulation = {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile: !!p.mobile,
      };
      wc.enableDeviceEmulation({
        screenPosition: p.mobile ? "mobile" : "desktop",
        screenSize: { width, height },
        viewSize: { width, height },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: dpr,
        scale: 1,
      });
      return this.inspect(t);
    }
    if (method === "browser.capture") {
      await fs.mkdir(path.join(this.dataDir, "artifacts"), { recursive: true });
      const image = await wc.capturePage();
      if (image.isEmpty())
        throw new Error("Не удалось получить снимок страницы");
      const dest = path.join(
        this.dataDir,
        "artifacts",
        `browser-${randomUUID()}.png`,
      );
      await fs.writeFile(dest, image.toPNG());
      return { path: dest, url: wc.getURL(), viewport: await this.viewport(t) };
    }
    if (method === "browser.inspect") return this.inspect(t);
    if (method === "browser.act") {
      const selector = String(p.selector || "");
      if (!selector || selector.length > 2000)
        throw new Error("Нужен CSS-селектор");
      if (!["click", "fill"].includes(p.action))
        throw new Error("Действие не поддерживается");
      // Only values are serialized; caller cannot provide executable page JavaScript.
      const result = await wc.executeJavaScript(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Элемент не найден');if(${JSON.stringify(p.action)}==='click'){el.click();return {action:'clicked'}}if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))throw new Error('Элемент не текстовое поле');const setter=Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(String(p.value || ""))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {action:'filled'}})()`,
        true,
      );
      return { result, url: wc.getURL() };
    }
    throw new Error("Неизвестное действие браузера");
  }
  private async viewport(t: Tab) {
    const values = await t.view.webContents.executeJavaScript(
      "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
    );
    return { ...values, zoom: t.view.webContents.getZoomFactor() };
  }
  private async inspect(t: Tab) {
    const wc = t.view.webContents;
    return {
      ...this.meta(t),
      viewport: await this.viewport(t),
      text: await wc.executeJavaScript(
        '(document.body?.innerText||"").slice(0,40000)',
      ),
    };
  }
  private remove(t: Tab) {
    BrowserWindow.fromId(t.owner)?.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    this.tabs.delete(t.id);
    for (const [request, tabId] of this.createRequests)
      if (tabId === t.id) this.createRequests.delete(request);
  }
  close(id: string) {
    const t = this.tabs.get(id);
    if (!t) return;
    const key = this.group(t.owner, t.projectId),
      ordered = this.groupTabs(t.owner, t.projectId),
      index = ordered.findIndex((candidate) => candidate.id === id),
      wasActive = this.activeId(t.owner, t.projectId) === id,
      adjacent = wasActive
        ? ordered[index + 1] || ordered[index - 1]
        : undefined;
    this.remove(t);
    if (wasActive) {
      if (adjacent) this.active.set(key, adjacent.id);
      else this.active.delete(key);
    }
    const next = this.activeId(t.owner, t.projectId);
    this.changed(t, { id, closed: true, activeId: next });
    if (wasActive && next) {
      const active = this.tabs.get(next);
      if (active) this.changed(active);
    }
  }
  closeWindow(id: number) {
    for (const t of this.tabs.values()) if (t.owner === id) this.close(t.id);
  }
  transferWindow(from: BrowserWindow, to: BrowserWindow) {
    const moving = [...this.tabs.values()].filter((t) => t.owner === from.id);
    if (!moving.length) return;

    const movingIds = new Set(moving.map((t) => t.id)),
      groups = new Map<
        string,
        {
          projectId?: string;
          sourceActive?: string;
          targetActive?: string;
          mappedSourceActive?: string;
        }
      >(),
      requestsByTab = new Map<string, string[]>(),
      sourcePrefix = `${from.id}:`;

    for (const t of moving) {
      const projectKey = t.projectId || "";
      if (!groups.has(projectKey))
        groups.set(projectKey, {
          projectId: t.projectId,
          sourceActive: this.activeId(from.id, t.projectId),
          targetActive: this.activeId(to.id, t.projectId),
        });
    }

    // Request ids are scoped to owner window + project. Move their mappings
    // with the tabs; if the destination already has that scoped request id,
    // its existing idempotency record wins.
    for (const [requestKey, tabId] of this.createRequests) {
      if (!requestKey.startsWith(sourcePrefix) || !movingIds.has(tabId))
        continue;
      const suffix = requestKey.slice(sourcePrefix.length),
        entries = requestsByTab.get(tabId) || [];
      entries.push(suffix);
      requestsByTab.set(tabId, entries);
      this.createRequests.delete(requestKey);
    }

    for (const t of moving) {
      const projectKey = t.projectId || "",
        group = groups.get(projectKey)!,
        duplicate = t.reuseKey
          ? [...this.tabs.values()].find(
              (candidate) =>
                candidate.owner === to.id &&
                candidate.projectId === t.projectId &&
                candidate.reuseKey === t.reuseKey &&
                !candidate.view.webContents.isDestroyed(),
            )
          : undefined;
      let destination = duplicate;
      if (duplicate) {
        // A reusable artifact/browser surface already exists in the target.
        // Keep the target instance and discard the duplicate native view.
        this.remove(t);
      } else {
        t.view.setVisible(false);
        from.contentView.removeChildView(t.view);
        to.contentView.addChildView(t.view);
        t.owner = to.id;
        // Reinsert to append transferred tabs after the target window's
        // existing strip while preserving the source order.
        this.tabs.delete(t.id);
        this.tabs.set(t.id, t);
        destination = t;
      }
      if (group.sourceActive === t.id)
        group.mappedSourceActive = destination?.id;

      for (const requestId of requestsByTab.get(t.id) || []) {
        if (!destination) continue;
        const targetRequest = `${to.id}:${requestId}`,
          currentId = this.createRequests.get(targetRequest),
          current = currentId ? this.tabs.get(currentId) : undefined;
        if (
          !current ||
          current.owner !== to.id ||
          current.view.webContents.isDestroyed()
        )
          this.createRequests.set(targetRequest, destination.id);
      }
    }

    for (const group of groups.values()) {
      const sourceKey = this.group(from.id, group.projectId),
        targetKey = this.group(to.id, group.projectId),
        retainedTarget = group.targetActive
          ? this.tabs.get(group.targetActive)
          : undefined,
        movedActive = group.mappedSourceActive
          ? this.tabs.get(group.mappedSourceActive)
          : undefined;
      this.active.delete(sourceKey);
      if (
        retainedTarget &&
        retainedTarget.owner === to.id &&
        retainedTarget.projectId === group.projectId
      )
        this.active.set(targetKey, retainedTarget.id);
      else if (
        movedActive &&
        movedActive.owner === to.id &&
        movedActive.projectId === group.projectId
      )
        this.active.set(targetKey, movedActive.id);
      else this.active.delete(targetKey);

      const activeId = this.activeId(to.id, group.projectId),
        activeTab = activeId ? this.tabs.get(activeId) : undefined;
      if (activeTab) this.changed(activeTab);
    }
    // The source renderer also needs to drop the moved tabs. It may already be
    // closing, so this owner-targeted refresh is intentionally best effort.
    this.emit({
      type: "browser.changed",
      payload: { transferred: true, count: moving.length },
      targetWindowId: from.id,
    });
  }
  windowForContents(id: number) {
    const tab = [...this.tabs.values()].find(
      (t) => t.view.webContents.id === id,
    );
    return tab ? BrowserWindow.fromId(tab.owner) : null;
  }
  hideWindow(id: number) {
    for (const t of this.tabs.values())
      if (t.owner === id) t.view.setVisible(false);
  }
  dispose() {
    for (const id of this.tabs.keys()) this.close(id);
  }
}
