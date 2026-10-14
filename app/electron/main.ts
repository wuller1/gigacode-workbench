import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
  clipboard,
  safeStorage,
} from "electron";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { WorkbenchService } from "./service";
import { Workspace, isWithin, scopedPath } from "./workspace";
import { TerminalService } from "./terminal";
import { BrowserService, safeWebUrl } from "./browser";
import { UiMcpServer } from "./mcp";
import { redact } from "./acp";
import { readReference } from "./reference";
import { bundledCli } from "./bundled-cli";
import { IdeService } from "./ide";
import { DatabaseService } from "./database/service";
import { OpsService } from "./operations/service";
import { RendererRecoveryBudget } from "./renderer-recovery";
import { startShutdown, waitForShutdown, shutdownUnconfirmed } from "./shutdown";
import {
  normalizeError as normalizeOpsError,
  failure as opsFailure,
} from "./operations/errors";
import type { HostEvent } from "../shared/types";

if (process.env.WORKBENCH_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.WORKBENCH_DATA_DIR));
// Keep IDE preview origins isolated while resolving their reserved local subdomains.
app.commandLine.appendSwitch(
  "host-resolver-rules",
  "MAP *.webview.localhost 127.0.0.1",
);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let service: WorkbenchService,
  browser: BrowserService,
  terminal: TerminalService,
  workspace: Workspace,
  mcp: UiMcpServer;
let ide: IdeService;
let database: DatabaseService;
let operations: OpsService;
let quitting = false,
  shutdownPreparing = false,
  previewServer: Server | undefined,
  previewPort = 0;
let restartRequested = false;
let runtimeFailure:
  | { reason: string; persistence: "pending" | "saved" | "failed"; at: string }
  | undefined;
let runtimeFailurePromise: Promise<void> | undefined;
const previews = new Map<string, { body: Buffer; mime: string }>();
const previewSecret = randomBytes(24).toString("hex");
const windows = new Set<BrowserWindow>();
const windowKeys = new Map<number, string>();
let createdWindows = 0;
const rendererRecovery = new RendererRecoveryBudget();
const recoveryDialogs = new Set<number>();
const recoveringWindows = new Set<number>();
const deferredRendererRecoveries = new Map<number, unknown>();
const unresponsiveTimers = new Map<number, ReturnType<typeof setTimeout>>();
const sessionOwners = new Map<string, number>();
let builtinCli: { path: string; label: string } | undefined;
let builtinCliError: string | undefined;
let resourceRoot = "";
const uiPath = path.resolve(__dirname, "../dist/index.html");
const uiUrl = pathToFileURL(uiPath).toString();
const emit = (event: HostEvent) => {
  if (event.type === "runtime.stopped") {
    const payload = event.payload as { reason?: string; persistence?: string };
    runtimeFailure = {
      at: runtimeFailure?.at || new Date().toISOString(),
      reason: redact(String(payload?.reason || "Runtime stopped")).slice(
        0,
        1000,
      ),
      persistence:
        payload?.persistence === "saved" || payload?.persistence === "failed"
          ? payload.persistence
          : "pending",
    };
    event = { ...event, payload: runtimeFailure };
  }
  for (const window of windows)
    if (
      !window.isDestroyed() &&
      (event.targetWindowId === undefined || event.targetWindowId === window.id)
    )
      try {
        window.webContents.send("workbench:event", event);
      } catch (error) {
        void log("window-event-undelivered", {
          windowId: window.id,
          error: redact(error),
        });
      }
};

function failRuntime(kind: string, error: unknown): Promise<void> {
  if (runtimeFailurePromise) return runtimeFailurePromise;
  const reason =
    runtimeFailure?.reason ||
    redact(error instanceof Error ? error.message : error).slice(0, 1000);
  emit({
    type: "runtime.stopped",
    payload: { reason, persistence: "pending" },
  });
  runtimeFailurePromise = (async () => {
    // Logging may be the failing disk operation: it cannot precede retirement.
    try {
      const stopping = service?.quiesce(reason);
      void log(kind, error);
      const result = await stopping;
      emit({
        type: "runtime.stopped",
        payload: { reason, persistence: result?.persistence || "failed" },
      });
    } catch (failure) {
      void log("runtime-quiesce-failed", failure);
      emit({
        type: "runtime.stopped",
        payload: { reason, persistence: "failed" },
      });
    }
  })();
  return runtimeFailurePromise;
}

async function recoverRenderer(window: BrowserWindow, cause: unknown) {
  if (shutdownPreparing && !quitting && !window.isDestroyed()) {
    deferredRendererRecoveries.set(window.id, cause);
    return;
  }
  if (
    window.isDestroyed() ||
    quitting ||
    shutdownPreparing ||
    recoveringWindows.has(window.id)
  )
    return;
  recoveringWindows.add(window.id);
  let retry: unknown;
  try {
    try {
      browser?.hideWindow(window.id);
    } catch (error) {
      void log("browser-hide-failed", error);
    }
    try {
      ide?.hideWindow(window.id);
    } catch (error) {
      void log("ide-hide-failed", error);
    }
    const budget = rendererRecovery.claim(window.id);
    void log("renderer-recovery", { windowId: window.id, ...budget, cause });
    if (budget.allowed) {
      try {
        await window.loadFile(uiPath);
      } catch (error) {
        retry = { loadFailure: redact(error) };
      }
      return;
    }
    if (recoveryDialogs.has(window.id)) return;
    recoveryDialogs.add(window.id);
    window.show();
    try {
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Не удалось восстановить окно",
        message:
          "Окно несколько раз завершилось с ошибкой. Автоматические повторы остановлены.",
        detail:
          "Фоновые задачи не отправлялись заново. Можно повторить загрузку интерфейса или открыть другое рабочее окно.",
        buttons: ["Повторить", "Новое окно", "Оставить как есть"],
        defaultId: 2,
        cancelId: 2,
      });
      if (window.isDestroyed() || quitting || shutdownPreparing) return;
      if (choice.response === 0) {
        rendererRecovery.forget(window.id);
        retry = "explicit recovery";
      } else if (choice.response === 1) createWindow();
    } catch (error) {
      void log("renderer-recovery-dialog-failed", error);
    } finally {
      recoveryDialogs.delete(window.id);
    }
  } finally {
    recoveringWindows.delete(window.id);
    if (retry !== undefined)
      queueMicrotask(() => {
        void recoverRenderer(window, retry);
      });
  }
}
const log = async (kind: string, message: unknown) => {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "host.jsonl");
    const size = await fs.stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size > 5 * 1024 * 1024)
      await fs.rename(file, file + ".previous").catch(() => {});
    await fs.appendFile(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        kind,
        message: redact(
          message instanceof Error
            ? message.stack
            : typeof message === "string"
              ? message
              : JSON.stringify(message),
        ).slice(0, 8000),
      }) + "\n",
    );
  } catch {}
};

const closeRequests = new Map<
  number,
  { id: string; promise: Promise<void>; resolve: (error?: string) => void }
>();
const closeApproved = new WeakSet<BrowserWindow>();
async function prepareRendererClose(window: BrowserWindow) {
  if (
    window.isDestroyed() ||
    window.webContents.isDestroyed() ||
    window.webContents.isCrashed()
  )
    return;
  const old = closeRequests.get(window.id);
  if (old) return old.promise;
  const id = randomUUID();
  let finish!: (error?: string) => void;
  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        finish(
          "Редактор не подтвердил сохранение. Проверьте окно перед закрытием.",
        ),
      15000,
    );
    finish = (error) => {
      clearTimeout(timer);
      error ? reject(new Error(error)) : resolve();
    };
  });
  closeRequests.set(window.id, { id, promise, resolve: finish });
  window.webContents.send("workbench:event", {
    type: "window.prepareClose",
    payload: { requestId: id },
  });
  try {
    await promise;
  } catch (error) {
    if (!window.isDestroyed())
      window.webContents.send("workbench:event", {
        type: "window.closeSettled",
        payload: { error: String((error as Error).message) },
      });
    throw error;
  } finally {
    closeRequests.delete(window.id);
  }
}
function createWindow() {
  if (shutdownPreparing || quitting)
    throw new Error(
      "Приложение готовится к закрытию. Дождитесь завершения проверки сохранения.",
    );
  const windowKey = createdWindows++ === 0 ? "primary" : randomUUID();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 540,
    frame: false,
    show: false,
    backgroundColor: "#f8f9f6",
    title: "GigaCode Workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [`--workbench-window-key=${windowKey}`],
    },
  });
  windows.add(window);
  windowKeys.set(window.id, windowKey);
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e, url) => {
    if (url !== uiUrl) e.preventDefault();
  });
  window.webContents.on("render-process-gone", (_e, details) => {
    void log("renderer-gone", details);
    void recoverRenderer(window, details);
  });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning")
      void log("renderer-" + details.level, {
        windowId: window.id,
        message: details.message,
        line: details.lineNumber,
      });
  });
  window.on("unresponsive", () => {
    void log("window-unresponsive", { windowId: window.id });
    if (unresponsiveTimers.has(window.id)) return;
    unresponsiveTimers.set(
      window.id,
      setTimeout(() => {
        unresponsiveTimers.delete(window.id);
        if (
          window.isDestroyed() ||
          quitting ||
          shutdownPreparing ||
          recoveryDialogs.has(window.id)
        )
          return;
        recoveryDialogs.add(window.id);
        void dialog
          .showMessageBox(window, {
            type: "warning",
            title: "Окно не отвечает",
            message:
              "Интерфейс не отвечает. Фоновые задачи продолжают работать.",
            detail:
              "Восстановление перезагрузит только это окно и не повторит сообщения агенту.",
            buttons: ["Подождать", "Восстановить окно"],
            defaultId: 0,
            cancelId: 0,
          })
          .then((choice) => {
            if (choice.response === 1 && !window.isDestroyed())
              window.webContents.forcefullyCrashRenderer();
          })
          .catch((error) => void log("unresponsive-dialog-failed", error))
          .finally(() => recoveryDialogs.delete(window.id));
      }, 10000),
    );
  });
  window.on("responsive", () => {
    clearTimeout(unresponsiveTimers.get(window.id));
    unresponsiveTimers.delete(window.id);
  });
  window.on("close", (e) => {
    if (quitting) return;
    if (shutdownPreparing) {
      closeApproved.delete(window);
      e.preventDefault();
      return;
    }
    const survivor = [...windows].find((w) => w !== window && !w.isDestroyed());
    if (!survivor) {
      // Keep the last renderer alive until the global DB/save preflight passes.
      e.preventDefault();
      app.quit();
      return;
    }
    if (!closeApproved.has(window)) {
      e.preventDefault();
      if (!closeRequests.has(window.id))
        void prepareRendererClose(window)
          .then(() => {
            if (!window.isDestroyed() && !shutdownPreparing) {
              closeApproved.add(window);
              window.close();
            }
          })
          .catch((error) => {
            void log("window-save-blocked", {
              windowId: window.id,
              message: error.message,
            });
          });
      return;
    }
    closeApproved.delete(window);
    browser.transferWindow(window, survivor);
    ide?.transferWindow(window, survivor);
    for (const [id, owner] of sessionOwners)
      if (owner === window.id) sessionOwners.set(id, survivor.id);
  });
  window.on("closed", () => {
    browser.closeWindow(window.id);
    ide?.closeWindow(window.id);
    windows.delete(window);
    windowKeys.delete(window.id);
    rendererRecovery.forget(window.id);
    recoveringWindows.delete(window.id);
    deferredRendererRecoveries.delete(window.id);
    clearTimeout(unresponsiveTimers.get(window.id));
    unresponsiveTimers.delete(window.id);
  });
  window.once("ready-to-show", () => window.show());
  void window
    .loadFile(uiPath)
    .catch((error) =>
      recoverRenderer(window, { initialLoadFailure: redact(error) }),
    );
  return window;
}
function project(id: string) {
  const p = service.snapshot().projects.find((x) => x.id === id && !x.archived);
  if (!p) throw new Error("Проект не найден или находится в архиве");
  return p;
}
function sessionProject(id: string) {
  const state = service.snapshot(),
    s = state.sessions.find((s) => s.id === id),
    t = state.tasks.find((t) => t.id === s?.taskId);
  if (!s || !t) throw new Error("Сессия не найдена");
  return project(t.projectId);
}
async function artifactFile(id: string) {
  const state = service.snapshot(),
    artifact = state.artifacts.find((a) => a.id === id),
    task = state.tasks.find((t) => t.id === artifact?.taskId);
  if (!artifact || !task) throw new Error("Материал не найден");
  const file = await fs.realpath(artifact.path),
    root = await fs.realpath(project(task.projectId).path),
    local = path.join(app.getPath("userData"), "artifacts");
  if (!isWithin(root, file) && !isWithin(local, file))
    throw new Error("Материал находится вне разрешённой области");
  return { artifact, file };
}
async function invoke(
  method: string,
  p: any,
  window: BrowserWindow,
  agentSession?: string,
): Promise<any> {
  if (
    runtimeFailure &&
    ![
      "state.get",
      "diagnostics.export",
      "app.info",
      "app.restart",
      "workbench.reference",
      "window.minimize",
      "window.maximize",
      "window.readyToClose",
      "window.close",
      "window.new",
      "clipboard.write",
      "artifact.open",
      "artifact.export",
      "external.open",
      "ops.snapshot",
      "ops.query",
      "ops.reconcile",
      "database.snapshot",
      "database.job.read",
      "database.console.read",
      "database.operation.list",
      "database.operation.read",
      "database.effect.read",
      "database.cancel",
      "database.console.disconnect",
    ].includes(method)
  )
    throw new Error(
      "Работа остановлена после сбоя. История доступна; перед новыми действиями перезапустите приложение.",
    );
  if (method === "workbench.reference") return readReference(resourceRoot, p);
  if (method.startsWith("ops.")) {
    if (
      shutdownPreparing &&
      !["ops.snapshot", "ops.query", "ops.reconcile"].includes(method)
    )
      throw opsFailure(
        "conflict",
        "Приложение готовится к закрытию. Новые Operations dispatch временно остановлены.",
      );
    if (agentSession) {
      const owner = sessionProject(agentSession);
      if (p.projectId && p.projectId !== owner.id)
        throw opsFailure(
          "forbidden",
          "Нельзя управлять Operations другого проекта",
        );
      p = { ...p, projectId: owner.id };
    }
    if (method === "ops.reveal") {
      if (
        !service
          .snapshot()
          .projects.some((value) => value.id === p.projectId && !value.archived)
      )
        throw opsFailure("validation", "Выберите существующий проект");
      const connection = p.connectionId
        ? operations
            .snapshot(p.projectId)
            .connections.find((value) => value.id === p.connectionId)
        : undefined;
      if (p.connectionId && !connection)
        throw opsFailure(
          "forbidden",
          "Подключение не привязано к выбранному проекту",
        );
      const kind = connection
        ? connection.kind === "jenkins"
          ? "jenkins"
          : "cluster"
        : p.kind;
      if (!["jenkins", "cluster"].includes(kind))
        throw opsFailure("validation", "Выберите Jenkins или Cluster панель");
      emit({
        type: "ops.reveal",
        targetWindowId: window.id,
        payload: { ...p, kind },
      });
      return { requested: true, kind };
    }
    return operations.invoke(method, p, !!agentSession);
  }
  if (method.startsWith("database.")) {
    if (
      shutdownPreparing &&
      ![
        "database.console.update",
        "database.console.read",
        "database.snapshot",
        "database.cancel",
        "database.page",
        "database.history.load",
        "database.job.read",
        "database.operation.list",
        "database.operation.read",
        "database.effect.read",
      ].includes(method)
    )
      throw new Error(
        "Приложение готовится к закрытию. Новые операции БД временно остановлены.",
      );

    if (agentSession) {
      const owner = sessionProject(agentSession);
      if (p.projectId && p.projectId !== owner.id)
        throw new Error("Нельзя управлять БД другого проекта");
      p = { ...p, projectId: owner.id };
    }
    if (method === "database.reveal") {
      project(p.projectId);
      emit({
        type: "database.reveal",
        targetWindowId: window.id,
        payload: { projectId: p.projectId },
      });
      return { requested: true };
    }
    if (["database.import", "database.export"].includes(method)) {
      const owner = project(p.projectId);
      const importing = method === "database.import";
      if (!agentSession && p.chooseFile) {
        const extensions = [String(p.format || "csv")];
        if (importing) {
          const selection = await dialog.showOpenDialog(window, {
            title: "Импорт данных через COPY",
            properties: ["openFile"],
            filters: [{ name: "Данные", extensions }],
          });
          if (selection.canceled) return null;
          p = { ...p, file: selection.filePaths[0] };
        } else {
          const selection = await dialog.showSaveDialog(window, {
            title: "Экспорт результата БД",
            defaultPath: `result.${extensions[0]}`,
            filters: [{ name: "Данные", extensions }],
          });
          if (selection.canceled || !selection.filePath) return null;
          p = { ...p, file: selection.filePath };
        }
      } else {
        if (typeof p.file !== "string")
          throw new Error("Нужен путь к файлу внутри проекта");
        p = { ...p, file: (await scopedPath(owner, p.file, !importing)).full };
      }
    }
    return database.invoke(method, p, !!agentSession);
  }
  if (method === "session.attach") {
    sessionProject(p.id);
    const owner = sessionOwners.get(p.id);
    if (!owner || !BrowserWindow.fromId(owner))
      sessionOwners.set(p.id, window.id);
    return { ownerWindowId: sessionOwners.get(p.id) };
  }
  if (
    !agentSession &&
    ["session.send", "session.config", "session.prepare"].includes(method)
  ) {
    sessionProject(p.id);
    sessionOwners.set(p.id, window.id);
  }
  if (method.startsWith("browser.")) {
    if (p.projectId) project(p.projectId);
    if (agentSession) {
      const owner = sessionProject(agentSession);
      if (p.projectId && p.projectId !== owner.id)
        throw new Error("Нельзя управлять другим проектом");
      if (p.id && !browser.owns(p.id, agentSession))
        throw new Error("Вкладка принадлежит другой сессии");
      if (method === "browser.list")
        return browser.list().filter((t) => t.sessionId === agentSession);
      p = { ...p, sessionId: agentSession, projectId: owner.id };
    }
    const result: any = await browser.invoke(method, p, window);
    if (method === "browser.capture" && p.taskId)
      await service.invoke("artifact.register", {
        taskId: p.taskId,
        path: result.path,
        kind: "image",
        name: "Снимок браузера",
      });
    return result;
  }
  if (method.startsWith("ide.")) {
    if (shutdownPreparing && method !== "ide.list") {
      if (method === "ide.bounds") return { preparingClose: true };
      throw new Error(
        "Приложение готовится к закрытию. Изменения IDE временно остановлены.",
      );
    }
    if (agentSession) {
      const owner = sessionProject(agentSession);
      if (p.projectId && p.projectId !== owner.id)
        throw new Error("Нельзя управлять IDE другого проекта");
      p = { ...p, projectId: owner.id };
      if (method === "ide.list")
        return ide.pool
          .snapshot()
          .filter((entry) => entry.projectIds.includes(owner.id));
    }
    if (method === "ide.reveal") {
      project(p.projectId);
      emit({
        type: "ide.reveal",
        targetWindowId: window.id,
        payload: { projectId: p.projectId },
      });
      return { requested: true };
    }
    const result = await ide.invoke(method, p, window);
    if (method === "ide.capture" && p.taskId)
      await service.invoke("artifact.register", {
        taskId: p.taskId,
        path: result.path,
        kind: "image",
        name: "Снимок IDE",
      });
    return result;
  }
  if (agentSession) {
    const allowed = new Set([
      "todo.replace",
      "artifact.register",
      "session.create",
      "agent.spawn",
      "role.transition.request",
      "session.send",
      "session.peerMessage",
      "question.create",
      "memory.read",
      "instruction.read",
      "memory.remember",
      "diagnostics.export",
    ]);
    if (!allowed.has(method)) throw new Error("Инструмент недоступен агенту");
    if (method === "agent.spawn" && p.parentId !== agentSession)
      throw new Error("Agent parent belongs to another session.");
    if (method === "instruction.read" && p.sessionId !== agentSession)
      throw new Error("Instruction history belongs to another session.");
    if (method === "role.transition.request" && p.sessionId !== agentSession)
      throw new Error("Role transition belongs to another session.");
    const result = await service.invoke(method, p);
    if (method === "session.create") sessionOwners.set(result.id, window.id);
    if (method === "agent.spawn")
      sessionOwners.set(result.session.id, window.id);
    return result;
  }
  if (method === "role.transition.request")
    throw new Error("Role transitions require the bound task executor.");
  if (method.startsWith("fs.") || method.startsWith("git."))
    return workspace.invoke(method, p);
  if (method.startsWith("terminal.")) return terminal.invoke(method, p);
  switch (method) {
    case "app.info":
      return {
        version: app.getVersion(),
        platform: process.platform,
        windowId: window.id,
        windowKey: windowKeys.get(window.id),
        runtimeFailure,
        dataDir: app.getPath("userData"),
        bundleDir: service.options.bundleDir,
        referenceRoot: resourceRoot,
        bundledCli: builtinCli,
        bundledCliError: builtinCliError,
      };
    case "app.restart":
      if (!runtimeFailure)
        throw new Error(
          "Перезапуск восстановления доступен только после остановки runtime.",
        );
      restartRequested = true;
      app.quit();
      return { requested: true };
    case "app.chooseProject": {
      const result = await dialog.showOpenDialog(window, {
        title: "Открыть проект",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      const chosen = result.filePaths[0];
      return service.invoke("project.create", {
        path: chosen,
        name: path.basename(chosen),
      });
    }
    case "app.chooseCli": {
      const result = await dialog.showOpenDialog(window, {
        title: "Выберите CLI (.exe или JavaScript entrypoint)",
        properties: ["openFile"],
        filters: [
          {
            name: "CLI",
            extensions: ["exe", "cmd", "bat", "js", "mjs", "cjs"],
          },
          { name: "Все файлы", extensions: ["*"] },
        ],
      });
      return result.canceled ? null : { path: result.filePaths[0] };
    }
    case "app.chooseFiles": {
      const pr = project(p.projectId);
      const result = await dialog.showOpenDialog(window, {
        title: "Добавить файлы проекта",
        defaultPath: pr.path,
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return [];
      const files = [];
      for (const file of result.filePaths) {
        const scoped = await scopedPath(pr, file);
        files.push({ path: scoped.relative, name: path.basename(file) });
      }
      return files;
    }
    case "window.minimize":
      window.minimize();
      return;
    case "window.maximize":
      window.isMaximized() ? window.unmaximize() : window.maximize();
      return { maximized: window.isMaximized() };
    case "window.readyToClose": {
      const request = closeRequests.get(window.id);
      if (!request || request.id !== p.requestId)
        throw new Error("Запрос закрытия устарел");
      request.resolve(
        typeof p.error === "string" ? p.error.slice(0, 2000) : undefined,
      );
      return { accepted: true };
    }
    case "window.close":
      window.close();
      return;
    case "window.new":
      createWindow();
      return;
    case "clipboard.write":
      if (typeof p.text !== "string" || p.text.length > 2 * 1024 * 1024)
        throw new Error("Слишком большой текст");
      clipboard.writeText(p.text);
      return;
    case "external.open":
      await shell.openExternal(safeWebUrl(String(p.url)));
      return;
    case "artifact.open": {
      const { artifact, file } = await artifactFile(p.id);
      const stat = await fs.stat(file);
      if (stat.size > 20 * 1024 * 1024)
        throw new Error("Для файла больше 20 МБ используйте экспорт");
      const body = await fs.readFile(file),
        ext = path.extname(file).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext))
        return {
          path: file,
          kind: "image",
          url: `data:image/${ext === ".jpg" ? "jpeg" : ext.slice(1)};base64,${body.toString("base64")}`,
        };
      if (ext === ".html" || ext === ".htm") {
        const id = randomUUID();
        previews.set(id, { body, mime: "text/html; charset=utf-8" });
        while (previews.size > 20)
          previews.delete(previews.keys().next().value!);
        return {
          path: file,
          kind: "html",
          text:
            body.length <= 2 * 1024 * 1024 ? body.toString("utf8") : undefined,
          url: `http://127.0.0.1:${previewPort}/${previewSecret}/${id}`,
        };
      }
      if (body.includes(0) || body.length > 2 * 1024 * 1024)
        return { path: file, kind: artifact.kind || "binary" };
      return {
        path: file,
        kind: ext === ".md" ? "markdown" : artifact.kind || "text",
        text: body.toString("utf8"),
      };
    }
    case "artifact.export": {
      const { artifact, file } = await artifactFile(p.id);
      const result = await dialog.showSaveDialog(window, {
        title: "Сохранить материал",
        defaultPath: path.basename(file) || artifact.name,
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      if (path.resolve(result.filePath) !== file)
        await fs.copyFile(file, result.filePath);
      return { path: result.filePath };
    }
    default: {
      const result = await service.invoke(method, p);
      if (method === "session.create") sessionOwners.set(result.id, window.id);
      return result;
    }
  }
}
async function start() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, "../..");
  const dataDir = app.getPath("userData"),
    bundleDir = path.join(resourceRoot, "workbench");
  browser = new BrowserService(dataDir, emit);
  terminal = new TerminalService(emit, project);
  workspace = new Workspace(project, (p) => shell.trashItem(p));
  try {
    let qwen: string | undefined;
    try {
      qwen = createRequire(__filename).resolve("@qwen-code/qwen-code/cli.js");
      if (app.isPackaged)
        qwen = qwen.replace(
          `app.asar${path.sep}`,
          `app.asar.unpacked${path.sep}`,
        );
      if (!existsSync(qwen)) qwen = undefined;
    } catch {}
    builtinCli = process.env.WORKBENCH_CLI_PATH
      ? { path: process.env.WORKBENCH_CLI_PATH, label: "Тестовый CLI" }
      : await bundledCli(
          app.isPackaged
            ? path.join(process.resourcesPath, "cli")
            : path.resolve(__dirname, "../runtime"),
          qwen,
        );
  } catch (error) {
    builtinCliError = redact(error);
    await log("bundled-cli-unavailable", builtinCliError);
  }
  service = new WorkbenchService({
    dataDir,
    bundleDir,
    emit,
    bundledCliPath: builtinCli?.path,
    mcpServersForSession: (id, generation) => mcp.binding(id, generation),
    revokeSessionTools: (id) => mcp?.revokeBinding(id),
  });
  await service.init();
  database = new DatabaseService({
    dataDir,
    node: process.execPath,
    provider: path.join(__dirname, "database-provider.cjs"),
    project,
    vault: {
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    },
    changed: (projectId) =>
      emit({ type: "database.changed", payload: { projectId } }),
  });
  await database.init();
  operations = new OpsService({
    dataDir,
    node: process.execPath,
    provider: path.join(__dirname, "operations-provider.cjs"),
    project: (id) =>
      service
        .snapshot()
        .projects.find((value) => value.id === id && !value.archived),
    vault: {
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    },
    changed: (projectId) =>
      emit({ type: "ops.changed", payload: { projectId } }),
  });
  await operations.init();
  const ideRuntimeRoot = path.join(resourceRoot, "ide");
  const ideNodeLock = await fs
    .readFile(path.join(ideRuntimeRoot, "node-runtime-lock.json"), "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({ version: "" }));
  const nodePlatform = process.platform === "win32" ? "win" : process.platform;
  const ideNodeDirectory = `node-${ideNodeLock.version}-${nodePlatform}-${process.arch}`;
  const ideNodeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "ide-node")
    : path.resolve(__dirname, "../runtime/ide-node");
  ide = new IdeService({
    runtimeRoot: ideRuntimeRoot,
    nodePath:
      process.env.WORKBENCH_IDE_NODE ||
      path.join(
        ideNodeRoot,
        ideNodeDirectory,
        process.platform === "win32" ? "node.exe" : "bin/node",
      ),
    toolchainsRoot: app.isPackaged
      ? path.join(process.resourcesPath, "ide-tools")
      : path.resolve(__dirname, "../runtime/ide-tools"),
    dataDir,
    project,
    emit,
  });
  mcp = new UiMcpServer(
    () => service.snapshot(),
    (method, p, sessionId) => {
      const owner = sessionOwners.get(sessionId);
      const window = owner ? BrowserWindow.fromId(owner) : null;
      if (!window || window.isDestroyed())
        throw new Error(
          "Откройте сессию в рабочем окне для использования инструментов UI",
        );
      return invoke(method, p, window, sessionId);
    },
    {
      onFault: (error) => {
        void failRuntime("mcp-listener-failed", error);
      },
    },
  );
  await mcp.start();
  previewServer = createServer((req, res) => {
    const prefix = `/${previewSecret}/`,
      id = req.url?.startsWith(prefix) ? req.url.slice(prefix.length) : "",
      entry = id && previews.get(id);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", entry.mime);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors file:; sandbox allow-scripts",
    );
    res.end(entry.body);
  });
  await new Promise<void>((r) => previewServer!.listen(0, "127.0.0.1", r));
  previewPort = (previewServer.address() as any).port;
  if (!service.snapshot().settings.cliPath && builtinCli)
    await service.invoke("settings.update", { patch: { cliPath: "@bundled" } });
  ipcMain.handle("workbench:invoke", async (event, method, p) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      !window ||
      !windows.has(window) ||
      event.senderFrame !== event.sender.mainFrame ||
      event.sender.getURL() !== uiUrl
    )
      throw new Error("Недоверенный источник запроса");
    if (
      typeof method !== "string" ||
      method.length > 100 ||
      !p ||
      typeof p !== "object" ||
      Array.isArray(p)
    )
      throw new Error("Неверный формат запроса");
    const trace = ![
      "state.get",
      "session.attach",
      "browser.bounds",
      "browser.list",
      "ide.bounds",
      "terminal.list",
      "terminal.write",
      "terminal.resize",
      "fs.list",
    ].includes(method);
    const operation = {
      requestId: randomUUID(),
      method,
      windowId: window.id,
      ...Object.fromEntries(
        [
          "id",
          "sessionId",
          "taskId",
          "projectId",
          "connectionId",
          "preparedActionId",
          "receiptId",
        ]
          .filter(
            (key) =>
              typeof p[key] === "string" &&
              /^[a-zA-Z0-9-]{1,100}$/.test(p[key]),
          )
          .map((key) => [key, p[key]]),
      ),
    };
    const started = Date.now();
    if (trace) void log("operation-start", operation);
    try {
      const result = await invoke(method, p, window);
      if (trace)
        void log("operation-end", {
          ...operation,
          durationMs: Date.now() - started,
        });
      return result;
    } catch (error: any) {
      void log("operation-failed", {
        ...operation,
        durationMs: Date.now() - started,
        message:
          method.startsWith("database.") || method.startsWith("ops.")
            ? "Scoped operation failed; details are visible in the requesting tool"
            : error?.message,
      });
      if (method.startsWith("ops."))
        throw new Error(
          "OPS_ERROR:" +
            JSON.stringify(normalizeOpsError(error, method === "ops.execute")),
        );
      throw new Error(redact(error?.message || error));
    }
  });
  app.on(
    "select-client-certificate",
    (event, wc, _url, certificates, callback) => {
      event.preventDefault();
      const owner =
        (wc
          ? BrowserWindow.fromWebContents(wc) ||
            browser.windowForContents(wc.id)
          : null) || [...windows][0];
      if (!owner || !certificates.length) {
        callback();
        return;
      }
      void dialog
        .showMessageBox(owner, {
          type: "question",
          title: "Сертификат клиента",
          message: "Выберите сертификат для этого сайта",
          buttons: [
            "Отмена",
            ...certificates.map((c) => `${c.subjectName} — ${c.issuerName}`),
          ],
          defaultId: 0,
          cancelId: 0,
        })
        .then((result) =>
          callback(
            result.response ? certificates[result.response - 1] : undefined,
          ),
        );
    },
  );
  createWindow();
  void log("started", {
    version: app.getVersion(),
    platform: process.platform,
  });
  app.on("second-instance", () => {
    if (shutdownPreparing || quitting) return;
    const window = [...windows][0];
    if (window) {
      window.restore();
      window.focus();
    } else createWindow();
  });
  app.on("activate", () => {
    if (!windows.size && !shutdownPreparing && !quitting) createWindow();
  });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  if (shutdownPreparing) return;
  shutdownPreparing = true;
  void Promise.allSettled([...windows].map(prepareRendererClose))
    .then((results) => {
      const failed = results.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    })
    .then(async () => {
      const preflight = await Promise.allSettled([
        database?.assertShutdownReady(),
        ide?.assertShutdownReady(),
      ]);
      const blocked = preflight.find((result) => result.status === "rejected");
      if (blocked?.status === "rejected") throw blocked.reason;
      const window = [...windows].find((w) => !w.isDestroyed());
      if (
        window &&
        !runtimeFailure &&
        service
          ?.snapshot()
          .sessions.some((session) =>
            ["starting", "running", "waiting", "cancelling"].includes(
              session.status,
            ),
          )
      ) {
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          title: "Есть выполняющиеся задачи",
          message: "Закрыть приложение и запросить остановку задач?",
          detail:
            "История сохранится. Неизвестные внешние эффекты потребуют сверки после запуска.",
          buttons: ["Продолжить работу", "Остановить и закрыть"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response === 0)
          throw new Error("Закрытие отменено: задачи продолжают выполняться.");
      }
      const cleanup = startShutdown([
        () => service?.dispose(),
        () => mcp?.dispose(),
        () => terminal?.dispose(),
        () => ide?.dispose(),
        () => database?.dispose(),
        () => operations?.dispose(),
      ]);
      let result = await waitForShutdown(cleanup, 15000);
      while (!result.settled) {
        emit({
          type: "runtime.stopped",
          payload: {
            reason:
              "Завершение ожидает хранилище или внешнее соединение. Сохранение не подтверждено.",
            persistence: "failed",
          },
        });
        const message = {
          type: "warning" as const,
          title: "Завершение задерживается",
          message:
            "Не удалось подтвердить сохранение и закрытие всех соединений.",
          detail:
            "Можно продолжить ожидание или завершить приложение без подтверждения. При следующем запуске проверьте историю и неизвестные внешние операции. Автоматический перезапуск после такого завершения не выполняется.",
          buttons: ["Продолжить ожидание", "Завершить без подтверждения"],
          defaultId: 0,
          cancelId: 0,
        };
        const owner = [...windows].find((w) => !w.isDestroyed());
        const choice = owner
          ? await dialog.showMessageBox(owner, message)
          : await dialog.showMessageBox(message);
        if (choice.response === 1) {
          restartRequested = false;
          quitting = true;
          void log("shutdown-unconfirmed-exit", "Cleanup deadline exceeded");
          app.exit(1);
          return undefined;
        }
        result = await waitForShutdown(cleanup, 15000);
      }
      return result.results;
    })
    .then(async (results) => {
      if (!results) return;
      const terminalResult = results[2];
      const terminalValue =
        terminalResult?.status === "fulfilled"
          ? (terminalResult.value as { unconfirmed?: unknown[] } | undefined)
          : undefined;
      if (terminalValue?.unconfirmed?.length)
        void log("terminal-exit-unconfirmed", terminalValue);
      for (const result of results)
        if (result.status === "rejected")
          void log("shutdown-failed", result.reason);
      const unconfirmed = shutdownUnconfirmed(results);
      if (unconfirmed.length) {
        restartRequested = false;
        emit({
          type: "runtime.stopped",
          payload: {
            reason: "Завершение не подтверждено: " + unconfirmed.join(", "),
            persistence: "failed",
          },
        });
        const owner = [...windows].find((w) => !w.isDestroyed());
        const message = {
          type: "warning" as const,
          title: "Сохранение или закрытие не подтверждено",
          message: "Некоторые части приложения завершились с ошибкой.",
          detail: unconfirmed.join("\n") + "\nМожно оставить окно с историей и диагностикой или завершить без подтверждения. Работа остановлена; автоматического перезапуска не будет.",
          buttons: ["Оставить окно диагностики", "Завершить без подтверждения"],
          defaultId: 0,
          cancelId: 0,
        };
        const choice = owner
          ? await dialog.showMessageBox(owner, message)
          : await dialog.showMessageBox(message);
        if (choice.response === 0)
          throw new Error("Завершение отменено: сохранение или закрытие соединений не подтверждено. Работа остановлена, история доступна.");
        quitting = true;
        void log("shutdown-unconfirmed-exit", unconfirmed);
        app.exit(1);
        return;
      }
      browser?.dispose();
      previewServer?.closeAllConnections();
      previewServer?.close();
      quitting = true;
      shutdownPreparing = false;
      if (restartRequested) app.relaunch();
      app.quit();
    })
    .catch(async (error) => {
      quitting = false;
      restartRequested = false;
      try {
        await ide?.cancelShutdown();
      } catch (restoreError) {
        void log("ide-shutdown-restore-failed", restoreError);
      }
      shutdownPreparing = false;
      for (const window of windows)
        if (!window.isDestroyed()) {
          try {
            window.webContents.send("workbench:event", {
              type: "window.closeSettled",
              payload: { error: String(error.message) },
            });
          } catch (sendError) {
            void log("shutdown-notice-undelivered", sendError);
          }
          const deferred = deferredRendererRecoveries.get(window.id);
          deferredRendererRecoveries.delete(window.id);
          if (deferred !== undefined || window.webContents.isCrashed())
            void recoverRenderer(
              window,
              deferred || { cancelledShutdown: true },
            );
        }
      void log("shutdown-save-blocked", error);
    });
});
process.on("uncaughtException", (error) => void failRuntime("uncaught", error));
process.on(
  "unhandledRejection",
  (error) => void failRuntime("unhandled", error),
);
if (single)
  start().catch(async (error) => {
    void log("startup-failed", error);
    dialog.showErrorBox("Не удалось запустить Workbench", redact(error));
    app.exit(1);
  });
