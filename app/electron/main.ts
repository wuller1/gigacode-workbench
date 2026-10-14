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
const previews = new Map<string, { body: Buffer; mime: string }>();
const previewSecret = randomBytes(24).toString("hex");
const windows = new Set<BrowserWindow>();
const sessionOwners = new Map<string, number>();
let builtinCli: { path: string; label: string } | undefined;
let builtinCliError: string | undefined;
let resourceRoot = "";
const uiPath = path.resolve(__dirname, "../dist/index.html");
const uiUrl = pathToFileURL(uiPath).toString();
const emit = (event: HostEvent) => {
  for (const window of windows)
    if (
      !window.isDestroyed() &&
      (event.targetWindowId === undefined || event.targetWindowId === window.id)
    )
      window.webContents.send("workbench:event", event);
};
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
  if (window.isDestroyed()) return;
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
    },
  });
  windows.add(window);
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e, url) => {
    if (url !== uiUrl) e.preventDefault();
  });
  window.webContents.on("render-process-gone", (_e, details) => {
    void log("renderer-gone", details);
    browser.hideWindow(window.id);
    ide?.hideWindow(window.id);
  });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning")
      void log("renderer-" + details.level, {
        windowId: window.id,
        message: details.message,
        line: details.lineNumber,
      });
  });
  window.on(
    "unresponsive",
    () => void log("window-unresponsive", { windowId: window.id }),
  );
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
  });
  window.once("ready-to-show", () => window.show());
  void window.loadFile(uiPath);
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
    const result = await service.invoke(method, p);
    if (method === "session.create") sessionOwners.set(result.id, window.id);
    if (method === "agent.spawn")
      sessionOwners.set(result.session.id, window.id);
    return result;
  }
  if (method.startsWith("fs.") || method.startsWith("git."))
    return workspace.invoke(method, p);
  if (method.startsWith("terminal.")) return terminal.invoke(method, p);
  switch (method) {
    case "app.info":
      return {
        version: app.getVersion(),
        platform: process.platform,
        windowId: window.id,
        dataDir: app.getPath("userData"),
        bundleDir: service.options.bundleDir,
        referenceRoot: resourceRoot,
        bundledCli: builtinCli,
        bundledCliError: builtinCliError,
      };
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
    mcpServersForSession: (id) => mcp.binding(id),
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
      return Promise.allSettled([
        service?.dispose(),
        mcp?.dispose(),
        terminal?.dispose(),
        ide?.dispose(),
        database?.dispose(),
        operations?.dispose(),
      ]);
    })
    .then(async (results) => {
      const terminalResult = results[2];
      if (
        terminalResult?.status === "fulfilled" &&
        terminalResult.value?.unconfirmed?.length
      )
        await log("terminal-exit-unconfirmed", terminalResult.value);
      for (const result of results)
        if (result.status === "rejected")
          await log("shutdown-failed", result.reason);
      browser?.dispose();
      previewServer?.closeAllConnections();
      previewServer?.close();
      quitting = true;
      shutdownPreparing = false;
      app.quit();
    })
    .catch(async (error) => {
      quitting = false;
      try {
        await ide?.cancelShutdown();
      } catch (restoreError) {
        void log("ide-shutdown-restore-failed", restoreError);
      }
      shutdownPreparing = false;
      for (const window of windows)
        if (!window.isDestroyed())
          window.webContents.send("workbench:event", {
            type: "window.closeSettled",
            payload: { error: String(error.message) },
          });
      void log("shutdown-save-blocked", error);
    });
});
process.on("uncaughtException", (error) => void log("uncaught", error));
process.on("unhandledRejection", (error) => void log("unhandled", error));
if (single)
  start().catch(async (error) => {
    await log("startup-failed", error);
    dialog.showErrorBox("Не удалось запустить Workbench", redact(error));
    app.exit(1);
  });
