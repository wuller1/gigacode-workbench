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
  emulation?: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
  };
};
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
      projectId: t.projectId,
      sessionId: t.sessionId,
    };
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
      };
      this.tabs.set(id, tab);
      view.setVisible(false);
      window.contentView.addChildView(view);
      const update = () => {
        if (view.webContents.isDestroyed()) return;
        tab.url = view.webContents.getURL() || url;
        tab.title = view.webContents.getTitle() || "Новая вкладка";
        this.emit({ type: "browser.changed", payload: this.meta(tab) });
      };
      view.webContents.on("did-start-loading", () => {
        tab.loading = true;
        update();
      });
      view.webContents.on("did-stop-loading", () => {
        tab.loading = false;
        update();
      });
      view.webContents.on("page-title-updated", update);
      view.webContents.on("did-navigate", update);
      view.webContents.on("did-navigate-in-page", update);
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
        this.emit({
          type: "browser.changed",
          payload: {
            ...this.meta(tab),
            error: "Процесс страницы завершился: " + details.reason,
          },
        });
      });
      await view.webContents.loadURL(url).catch((error) => {
        tab.loading = false;
        this.emit({
          type: "browser.changed",
          payload: {
            ...this.meta(tab),
            error: String(error.message).slice(0, 500),
          },
        });
      });
      update();
      return this.meta(tab);
    }
    if (method === "browser.bounds" && !p.visible && !this.tabs.has(p.id))
      return;
    const t = this.get(p.id),
      wc = t.view.webContents;
    if (method === "browser.bounds") {
      // Every window owns its views; observer windows cannot steal another window's tab by resizing.
      if (window.id !== t.owner)
        throw new Error("Вкладка принадлежит другому окну");
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
      this.emit({ type: "browser.changed", payload: this.meta(t) });
      return this.meta(t);
    }
    if (method === "browser.navigate") {
      await wc.loadURL(safeWebUrl(String(p.url || "")));
      return this.meta(t);
    }
    if (method === "browser.back") {
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      return;
    }
    if (method === "browser.forward") {
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      return;
    }
    if (method === "browser.reload") {
      wc.reload();
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
  close(id: string) {
    const t = this.tabs.get(id);
    if (!t) return;
    BrowserWindow.fromId(t.owner)?.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    this.tabs.delete(id);
    this.emit({ type: "browser.changed", payload: { id, closed: true } });
  }
  closeWindow(id: number) {
    for (const t of this.tabs.values()) if (t.owner === id) this.close(t.id);
  }
  transferWindow(from: BrowserWindow, to: BrowserWindow) {
    for (const t of this.tabs.values())
      if (t.owner === from.id) {
        t.view.setVisible(false);
        from.contentView.removeChildView(t.view);
        to.contentView.addChildView(t.view);
        t.owner = to.id;
        this.emit({ type: "browser.changed", payload: this.meta(t) });
      }
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
