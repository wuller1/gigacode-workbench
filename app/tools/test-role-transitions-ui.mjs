/** Actual Electron App + unmodified installed Qwen + owned OpenAI protocol fixture.
 * No real model, external endpoint, seeded roles or production routing bypass.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { _electron } from "playwright";

const require = createRequire(import.meta.url),
  execFile = promisify(execFileCallback);
// A quoted Windows argv ending in a backslash can escape its closing quote.
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.dirname(appRoot);
const preliminary = process.argv.includes("--preliminary");
const evidence = path.join(
  repoRoot,
  preliminary
    ? "outputs/role-transitions-ui-preliminary"
    : "docs/suite/evidence/role-transitions-ui",
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-role-phases-"));
const projectPath = path.join(temp, "project"),
  qwenHome = path.join(temp, "qwen-home");
const executable = path.join(
  appRoot,
  "node_modules/@qwen-code/qwen-code/cli.js",
);
const model = "workbench-local-role-fixture";
const passed = [],
  requests = [],
  captures = [],
  receipts = [],
  rendererErrors = [],
  widths = [];
const fixtureErrors = [];
let diagnosticRouterFaults = 0;
let application,
  page,
  provider,
  current = "startup",
  failure,
  cleanup,
  sourceDrift = [];
const gates = Object.fromEntries(
  ["backend", "diagnostics", "frontend"].map((role) => {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    return [role, { promise, release, reached: false }];
  }),
);
const sourcePaths = [
  "src/App.tsx",
  "src/SettingsView.tsx",
  "src/styles.css",
  "electron/service.ts",
  "electron/main.ts",
  "electron/mcp.ts",
  "electron/prompt-binding.ts",
  "electron/role-router.ts",
  "electron/preload.ts",
  "electron/acp.ts",
  "shared/types.ts",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "tools/test-role-transitions-ui.mjs",
  "../workbench/CORE.md",
  ...(await fs.readdir(path.join(repoRoot, "workbench/profiles")))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => "../workbench/profiles/" + name),
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = async () => {
  const result = {};
  for (const file of sourcePaths)
    result[file] = hash(await fs.readFile(path.join(appRoot, file)));
  for (const file of (
    await fs.readdir(path.join(appRoot, "dist/assets"))
  ).sort())
    if (/\.(js|css)$/.test(file))
      result["dist/assets/" + file] = hash(
        await fs.readFile(path.join(appRoot, "dist/assets", file)),
      );
  return result;
};
const before = await hashes();
const poll = async (predicate, label, timeout = 30000) => {
  const started = Date.now();
  while (!(await predicate())) {
    if (fixtureErrors.length)
      throw new Error("Protocol fixture: " + fixtureErrors[0]);
    if (Date.now() - started > timeout) throw new Error("Timed out: " + label);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
};
const check = async (name, action) => {
  current = name;
  const started = Date.now();
  await action();
  passed.push({ name, elapsedMs: Date.now() - started });
  console.log("PASS " + name);
};
const invoke = (method, params = {}) =>
  page.evaluate(
    ({ method, params }) => window.workbench.invoke(method, params),
    { method, params },
  );
const textContent = (value) =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((part) => (part?.type === "text" ? part.text : "")).join("\n")
      : "";
function respond(response, body, { content, tool }) {
  const message = tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.args) },
          },
        ],
      }
    : { role: "assistant", content };
  const finish = tool ? "tool_calls" : "stop";
  const meta = { id: "owned-role-fixture", created: 1, model: body.model };
  if (body.stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [{ index: 0, ...message.tool_calls[0] }],
        }
      : message;
    for (const [index, part] of [delta, {}].entries())
      response.write(
        `data: ${JSON.stringify({ ...meta, object: "chat.completion.chunk", choices: [{ index: 0, delta: part, finish_reason: index ? finish : null }] })}\n\n`,
      );
    response.end("data: [DONE]\n\n");
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ...meta,
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
}
function discoveredTransition(body) {
  const eager = (body.tools || [])
    .map((tool) => tool.function)
    .find((fn) => fn?.name?.endsWith("role_transition_request"));
  if (eager) return { name: eager.name, eager: true };
  for (const message of body.messages || []) {
    const text = textContent(message.content);
    for (const match of text.matchAll(/<function>([\s\S]*?)<\/function>/g)) {
      try {
        const fn = JSON.parse(match[1]);
        if (fn.name?.endsWith("role_transition_request"))
          return { name: fn.name, eager: false };
      } catch {}
    }
  }
}
async function startProvider() {
  provider = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            object: "list",
            data: [{ id: model, object: "model" }],
          }),
        );
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions")
        throw new Error("Unexpected owned provider route.");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024)
          throw new Error("Provider request budget exceeded.");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(
        body.model,
        model,
        "Only the owned fixture model may be requested.",
      );
      if (requests.length >= 24)
        throw new Error("Provider request count exceeded.");
      const system = (body.messages || [])
        .filter((message) => ["system", "developer"].includes(message.role))
        .map((message) => textContent(message.content))
        .join("\n");
      const role = system.match(/# Workbench role: ([a-z0-9_-]+)/)?.[1];
      const tools = (body.tools || [])
        .map((tool) => tool.function?.name)
        .filter(Boolean);
      if (!role && system.includes("Select exactly one primary work role")) {
        const data = (body.messages || [])
          .filter((message) => message.role === "user")
          .map((message) => textContent(message.content))
          .join("\n");
        const hint = data.match(/"roleHint"\s*:\s*"([a-z0-9_-]+)"/)?.[1];
        const selected = hint || "backend";
        assert.ok(
          ["backend", "diagnostics", "frontend"].includes(selected),
          "Unexpected classifier role.",
        );
        assert.deepEqual(
          [...tools].sort(),
          [
            "agent",
            "enter_worktree",
            "exit_worktree",
            "get_goal",
            "list_agents",
            "read_mcp_resource",
            "record_artifact",
            "report_findings",
            "send_message",
            "task_stop",
            "update_goal",
            "web_fetch",
          ].sort(),
          "Classifier declaration catalog changed; execution budget is independently verified by the offline router controls.",
        );
        const invalidFormat =
          selected === "diagnostics" && diagnosticRouterFaults < 2;
        if (invalidFormat) diagnosticRouterFaults++;
        requests.push({
          kind: "classifier",
          role: selected,
          scriptedOutcome: invalidFormat ? "invalid_format" : "decision",
          toolNames: tools,
          bytes,
        });
        respond(response, body, {
          content: JSON.stringify(
            invalidFormat
              ? { fixture: "intentional malformed role result" }
              : {
                  profileId: selected,
                  reason: `Следующий этап задачи: ${selected}.`,
                  confidence: 1,
                },
          ),
        });
        return;
      }
      if (!["backend", "diagnostics", "frontend"].includes(role))
        requests.push({
          kind: "unrecognized",
          role,
          toolNames: tools,
          bytes,
          systemMessageRoles: (body.messages || [])
            .filter((m) => ["system", "developer"].includes(m.role))
            .map((m) => m.role),
        });
      assert.ok(
        ["backend", "diagnostics", "frontend"].includes(role),
        `Expected actual compiled executor role in system message (observed ${role || "none"}; classifier marker ${system.includes("Select exactly one primary work role")}; roles ${(body.messages || []).map((m) => m.role).join(",")}; system prefix ${system.slice(0, 150)}).`,
      );
      assert.ok(
        system.includes("You are Qwen Code,") &&
          system.includes("# Core Mandates"),
        "Executor must preserve native Qwen system instructions.",
      );
      assert.equal(
        system.split("# Workbench common instructions").length - 1,
        1,
        "One common instruction snapshot per executor.",
      );
      assert.equal(
        (system.match(/# Workbench role: /g) || []).length,
        1,
        "Only one role overlay per executor.",
      );
      const next = role === "backend" ? "diagnostics" : "frontend";
      const resultId = `handoff-${role}`;
      const handled = (body.messages || []).some(
        (message) =>
          message.role === "tool" && message.tool_call_id === resultId,
      );
      const declaration = discoveredTransition(body);
      let stage;
      if (role === "frontend" || handled) {
        stage = "terminal";
        requests.push({
          kind: "executor",
          role,
          stage,
          toolNames: tools,
          bytes,
        });
        gates[role].reached = true;
        await gates[role].promise;
        respond(response, body, {
          content:
            role === "frontend"
              ? "Проверка трёх этапов завершена. Протокол fixture; реальная модель не использовалась."
              : `Этап ${role} завершён; передача следующему исполнителю запрошена.`,
        });
        return;
      }
      const args = {
        operationId: `fixture-${role}-to-${next}`,
        roleHint: next,
        reason: `В этой же задаче нужен следующий этап ${next}.`,
        continuation: `Продолжи исходную синтетическую задачу на этапе ${next}; не запускай внешние операции и не меняй её объём.`,
        evidenceRefs: [],
      };
      let tool;
      if (declaration) {
        if (declaration.eager)
          tool = { id: resultId, name: declaration.name, args };
        else {
          const caller = tools.find((name) => name === "tool_call");
          assert.ok(
            caller,
            "Deferred declaration requires actual offered tool_call.",
          );
          tool = {
            id: resultId,
            name: caller,
            args: { name: declaration.name, arguments: args },
          };
        }
        stage = "request_transition";
      } else {
        const search = tools.find((name) => name === "tool_search");
        assert.ok(search, "Expected actual offered tool_search.");
        tool = {
          id: `search-${role}`,
          name: search,
          args: { query: "role_transition_request", max_results: 1 },
        };
        stage = "discover_transition";
      }
      requests.push({
        kind: "executor",
        role,
        stage,
        toolNames: tools,
        calledTool: tool.name,
        bytes,
      });
      respond(response, body, { tool });
    } catch (error) {
      fixtureErrors.push(String(error.message));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${provider.address().port}/v1`;
}
async function executorPID() {
  const parent = application.process().pid;
  let candidates, tree;
  const descendants = () => {
    const owned = [parent];
    for (let index = 0; index < owned.length; index++)
      for (const [pid, ppid] of tree)
        if (ppid === owned[index] && !owned.includes(pid)) owned.push(pid);
    return owned;
  };
  if (process.platform === "win32") {
    const inventory = await execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, maxBuffer: 512 * 1024 },
    );
    const all = JSON.parse(inventory.stdout);
    tree = (Array.isArray(all) ? all : [all]).map((value) => [
      value.ProcessId,
      value.ParentProcessId,
    ]);
    const command = `Get-CimInstance Win32_Process -Filter '${descendants()
      .map((pid) => `ProcessId=${pid}`)
      .join(
        " OR ",
      )}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
    const { stdout } = await execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, maxBuffer: 256 * 1024 },
    );
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    candidates = (Array.isArray(parsed) ? parsed : [parsed]).map((value) => ({
      pid: value.ProcessId,
      args: value.CommandLine || "",
    }));
  } else {
    const inventory = await execFile("ps", ["-ax", "-o", "pid=,ppid="], {
      maxBuffer: 512 * 1024,
    });
    tree = inventory.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const { stdout } = await execFile(
      "ps",
      ["-o", "pid=,args=", "-p", descendants().join(",")],
      { maxBuffer: 256 * 1024 },
    );
    candidates = stdout
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+([\s\S]*)$/);
        return match
          ? { pid: Number(match[1]), args: match[2] }
          : { pid: 0, args: "" };
      });
  }
  const executors = candidates.filter(
    (value) =>
      (value.args.includes(executable) ||
        value.args.includes(
          path.join(path.dirname(executable), "cli-entry.js"),
        )) &&
      /(?:^|\s)--acp(?:\s|$)/.test(value.args),
  );
  // Qwen can re-exec its JS entrypoint to set heap/GC options. Its wrapper is
  // owned too; the terminal descendant is the actual ACP protocol executor.
  const parents = new Map(tree.map(([pid, ppid]) => [pid, ppid]));
  const below = (pid, ancestor) => {
    let current = parents.get(pid);
    const seen = new Set();
    while (current && !seen.has(current)) {
      if (current === ancestor) return true;
      seen.add(current);
      current = parents.get(current);
    }
    return false;
  };
  const pids = executors
    .filter(
      (candidate) =>
        !executors.some(
          (other) =>
            other.pid !== candidate.pid && below(other.pid, candidate.pid),
        ),
    )
    .map((value) => value.pid);
  assert.equal(pids.length, 1, "Expected exactly one live owned ACP executor.");
  return pids[0];
}
async function capture(name) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const png = await application.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  assert.ok(png.length > 100);
  await fs.writeFile(path.join(evidence, name), Buffer.from(png, "base64"));
  captures.push(name);
}
async function resize(width) {
  await application.evaluate(
    ({ BrowserWindow }, width) =>
      BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
    width,
  );
  await page.waitForFunction((width) => innerWidth === width, width);
  await page.waitForFunction(() => {
    const dock = document.querySelector(".dock-viewport"),
      canvas = document.querySelector(".dock-canvas"),
      chat = document.querySelector(".conversation-area");
    return (
      dock &&
      canvas &&
      chat &&
      Math.abs(canvas.getBoundingClientRect().width - dock.clientWidth) <= 1 &&
      Math.abs(
        chat.getBoundingClientRect().width -
          canvas.getBoundingClientRect().width,
      ) <= 1 &&
      !document
        .getAnimations()
        .some(
          (a) =>
            a.playState === "running" &&
            a.effect?.getTiming().iterations !== Infinity,
        )
    );
  });
  const bounds = await page.evaluate(() => {
    const toolbar = document.querySelector(".composer-toolbar"),
      settings = document.querySelector(".settings-layout"),
      r = toolbar?.getBoundingClientRect();
    return {
      width: innerWidth,
      documentClient: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      composerClient: toolbar?.clientWidth,
      composerScroll: toolbar?.scrollWidth,
      left: r?.left,
      right: r?.right,
      settingsClient: settings?.clientWidth,
      settingsScroll: settings?.scrollWidth,
    };
  });
  assert.ok(
    bounds.documentScroll <= bounds.documentClient + 1,
    "Document overflow.",
  );
  if (bounds.composerClient) {
    assert.ok(
      bounds.composerScroll <= bounds.composerClient + 1,
      "Composer overflow.",
    );
    assert.ok(
      bounds.left >= -1 && bounds.right <= width + 1,
      "Composer outside viewport.",
    );
  }
  if (bounds.settingsClient)
    assert.ok(
      bounds.settingsScroll <= bounds.settingsClient + 1,
      "Settings overflow.",
    );
  widths.push(bounds);
}
try {
  await fs.mkdir(evidence, { recursive: true });
  try {
    const old = JSON.parse(
      await fs.readFile(path.join(evidence, "report.json"), "utf8"),
    );
    await fs.writeFile(
      path.join(evidence, `attempt-${Date.now()}-${old.status}.json`),
      JSON.stringify(old, null, 2) + "\n",
    );
  } catch {}
  await fs.mkdir(projectPath);
  await fs.mkdir(qwenHome);
  const baseUrl = await startProvider();
  const systemSettings = path.join(temp, "system-settings.json"),
    systemDefaults = path.join(temp, "system-defaults.json");
  await fs.writeFile(systemSettings, "{}");
  await fs.writeFile(systemDefaults, "{}");
  await fs.writeFile(
    path.join(qwenHome, "settings.json"),
    JSON.stringify({
      security: { auth: { selectedType: "openai" } },
      model: { name: model },
      modelProviders: {
        openai: [
          {
            id: model,
            name: "Owned protocol fixture",
            baseUrl,
            envKey: "OPENAI_API_KEY",
            generationConfig: {
              maxRetries: 0,
              timeout: 60000,
              samplingParams: { max_tokens: 1024 },
            },
          },
        ],
      },
      telemetry: { enabled: false, logPrompts: false },
      // This fixture tests host role phases, not Qwen's separate background
      // memory-agent protocol (settingsSchema.memory, source reviewed).
      memory: {
        enableManagedAutoMemory: false,
        enableManagedAutoDream: false,
        enableAutoSkill: false,
      },
      general: { chatRecording: false, enableAutoUpdate: false },
    }),
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(https?|all|no)_proxy$/i.test(
        key,
      )
    )
      delete env[key];
  Object.assign(env, {
    WORKBENCH_DATA_DIR: path.join(temp, "userdata"),
    WORKBENCH_CLI_PATH: executable,
    QWEN_HOME: qwenHome,
    QWEN_RUNTIME_DIR: path.join(qwenHome, "runtime"),
    QWEN_CODE_SYSTEM_SETTINGS_PATH: systemSettings,
    QWEN_CODE_SYSTEM_DEFAULTS_PATH: systemDefaults,
    OPENAI_API_KEY: "owned-loopback-fixture-no-real-credential",
    OPENAI_BASE_URL: baseUrl,
    OPENAI_MODEL: model,
    QWEN_CODE_UNATTENDED_RETRY: "0",
    NO_PROXY: "127.0.0.1,localhost",
  });
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [appRoot],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => rendererErrors.push(String(error.message)));
  await page.waitForFunction(() => Boolean(window.workbench));
  await application.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest((request, callback) =>
      callback({ cancel: /^https?:/i.test(request.url) }),
    ),
  );
  const project = await invoke("project.create", {
    name: "Role phase fixture",
    path: projectPath,
  });
  const task = await invoke("task.create", {
    projectId: project.id,
    title: "One task, three role phases",
    description:
      "Synthetic local protocol acceptance. No external model or corporate systems.",
  });
  const session = await invoke("session.create", {
    taskId: task.id,
    title: "Automatic role transitions",
  });
  await invoke("settings.update", {
    patch: {
      theme: "dark",
      startupRetries: 0,
      cliArgs: [
        "--acp",
        "--auth-type",
        "openai",
        "--approval-mode",
        "yolo",
        "--no-chat-recording",
      ],
      model,
    },
  });
  await page.locator(".task-select").filter({ hasText: task.title }).click();
  const readSession = async () =>
    (await invoke("state.get")).sessions.find(
      (value) => value.id === session.id,
    );
  const input = page.getByRole("textbox", {
    name: "Сообщение агенту",
    exact: true,
  });
  const draft = "Несохранённый черновик пользователя. Не отправлять.";
  const verifyDraft = async () => assert.equal(await input.inputValue(), draft);
  await check(
    "Renderer cannot impersonate the bound task executor to request a role transition",
    async () => {
      await assert.rejects(
        () =>
          invoke("role.transition.request", {
            sessionId: session.id,
            operationId: "renderer-forgery",
            roleHint: "frontend",
            reason: "Untrusted renderer request.",
            continuation: "This must never be accepted.",
          }),
        /bound task executor/,
      );
      const value = await readSession();
      assert.equal(value.roleTransition, undefined);
      assert.equal(value.messages.length, 0);
      assert.equal(value.queue.length, 0);
    },
  );
  const record = async (role) => {
    const value = await readSession();
    assert.equal(value.profileId, role);
    assert.equal(value.roleRouting.source, "llm");
    assert.equal(value.instructionBinding.delivery, "append_system");
    assert.equal(value.instructionBinding.state, "active");
    for (const prior of receipts)
      await poll(
        async () => {
          try {
            process.kill(prior.pid, 0);
            return false;
          } catch (error) {
            return error.code === "ESRCH";
          }
        },
        "prior role executor retired",
        10000,
      );
    receipts.push({
      role,
      sessionId: value.id,
      taskId: value.taskId,
      pid: await executorPID(),
      fingerprint: value.instructionBinding.fingerprint,
      transitionStatus: value.roleTransition?.status,
      retiredPriorPids: receipts.map((prior) => prior.pid),
    });
    assert.equal(
      value.messages.filter((message) => message.role === "user").length,
      1,
    );
    assert.equal(value.queue.length, 0);
    await verifyDraft();
    await poll(
      async () =>
        (await page.locator(".composer-auto-profile").innerText()).includes(
          {
            backend: "Бэкенд",
            diagnostics: "Диагностика",
            frontend: "Фронтенд",
          }[role],
        ),
      "actual role chip",
    );
  };
  await check(
    "One human request routes Backend, then agent requests Diagnostics while preserving draft",
    async () => {
      await input.fill(
        "Проверь последовательную передачу одной синтетической задачи: серверный этап, диагностика, затем интерфейс. Не выполняй внешние действия.",
      );
      await input.press("Control+Enter");
      await poll(
        async () =>
          (await readSession()).messages.filter(
            (message) => message.role === "user",
          ).length === 1,
        "human request accepted",
      );
      await input.fill(draft);
      await poll(
        () => gates.backend.reached,
        "Backend MCP request and clean-terminal gate",
        60000,
      );
      const value = await readSession();
      assert.equal(value.roleTransition.status, "pending");
      assert.equal(value.roleTransition.roleHint, "diagnostics");
      await record("backend");
      assert.match(
        await page.locator(".composer-auto-profile").getAttribute("title"),
        /Готовится передача/,
      );
      await resize(1440);
      await capture("backend-pending-dark-1440.png");
      gates.backend.release();
    },
  );
  await check(
    "Held clean phase can resume from compact UI after classifier format failure without another human message",
    async () => {
      await poll(
        async () => (await readSession()).roleTransition?.status === "held",
        "held router failure",
        60000,
      );
      const held = await readSession();
      assert.equal(held.profileId, "backend");
      assert.equal(held.roleTransition.canResume, true);
      assert.equal(held.queue.length, 0);
      assert.equal(
        held.messages.filter((message) => message.role === "user").length,
        1,
      );
      assert.equal(diagnosticRouterFaults, 2);
      await verifyDraft();
      const resume = page.getByRole("button", {
        name: "Продолжить этап",
        exact: true,
      });
      await resume.waitFor();
      assert.equal(
        await page.locator(".session-error").count(),
        0,
        "A clean resumable phase must not offer generic unknown-outcome session recovery.",
      );
      assert.match(
        await page.locator(".activity-line").innerText(),
        /Переход приостановлен/,
      );
      await resize(1000);
      await capture("held-resumable-dark-1000.png");
      await resume.click();
      await verifyDraft();
    },
  );
  await check(
    "Host LLM reroutes the same task to Diagnostics without human queue fabrication",
    async () => {
      await poll(
        () => gates.diagnostics.reached,
        "Diagnostics MCP request and clean-terminal gate",
        60000,
      );
      await record("diagnostics");
      const value = await readSession();
      assert.equal(value.roleTransition.roleHint, "frontend");
      assert.equal(
        value.roleTransitionHistory.filter(
          (item) => item.status === "completed",
        ).length,
        0,
      );
      await resize(1440);
      await capture("diagnostics-pending-dark-1440.png");
      gates.diagnostics.release();
    },
  );
  await check(
    "Frontend continues automatically with its own actual process and system fingerprint",
    async () => {
      await poll(() => gates.frontend.reached, "Frontend terminal gate", 60000);
      await record("frontend");
      await capture("frontend-running-dark-1440.png");
      gates.frontend.release();
      await poll(
        async () => (await readSession()).status === "completed",
        "final completed task",
        30000,
      );
      const value = await readSession();
      assert.equal(
        value.messages.filter((message) => message.role === "user").length,
        1,
      );
      assert.equal(
        value.messages.filter((message) => message.kind === "role_continuation")
          .length,
        2,
      );
      assert.equal(value.queue.length, 0);
      assert.deepEqual(
        value.roleTransitionHistory.map((item) => [
          item.fromProfileId,
          item.toProfileId,
          item.status,
        ]),
        [
          ["backend", "diagnostics", "completed"],
          ["diagnostics", "frontend", "completed"],
        ],
      );
      assert.equal(new Set(receipts.map((value) => value.pid)).size, 3);
      assert.equal(new Set(receipts.map((value) => value.fingerprint)).size, 3);
      assert.equal(new Set(receipts.map((value) => value.sessionId)).size, 1);
      assert.deepEqual(
        requests
          .filter(
            (value) =>
              value.kind === "classifier" &&
              value.scriptedOutcome === "decision",
          )
          .map((value) => value.role),
        ["backend", "diagnostics", "frontend"],
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Продолжить этап", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("article", { name: "Сообщение пользователя", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("article", { name: "Системное сообщение", exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await page.locator(".message-list").innerText()).includes(
          "Host phase continuation",
        ),
        false,
      );
      await verifyDraft();
      assert.match(
        await page.locator(".composer-auto-profile").getAttribute("title"),
        /Этап завершён/,
      );
    },
  );
  await check(
    "Compact actual role and on-demand completed phase history fit desktop dark and light",
    async () => {
      for (const theme of ["dark", "light"]) {
        await invoke("settings.update", { patch: { theme } });
        await page.waitForFunction(
          (theme) => document.documentElement.dataset.theme === theme,
          theme,
        );
        for (const width of [1440, 1000]) {
          await resize(width);
          await verifyDraft();
          await capture(`composer-${theme}-${width}.png`);
        }
        await page.keyboard.press("Control+,");
        await page
          .locator(".settings-nav")
          .getByRole("button", { name: "Роли", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Роли", exact: true })
          .waitFor();
        await page.getByText("Применённые инструкции", { exact: true }).click();
        await page.getByText("Этапы в разговоре", { exact: true }).click();
        const history = page.locator(".role-transition-history");
        assert.equal(
          await history
            .locator("li[data-role-transition-status=completed]")
            .count(),
          2,
        );
        assert.match(
          await history.innerText(),
          /Бэкенд[\s\S]*Диагностика[\s\S]*Фронтенд/,
        );
        await resize(1000);
        await capture(`history-${theme}-1000.png`);
        await page
          .locator(".settings-footer")
          .getByRole("button", { name: "Закрыть", exact: true })
          .click();
        await verifyDraft();
      }
      assert.deepEqual(rendererErrors, []);
      assert.deepEqual(fixtureErrors, []);
      assert.equal(await page.locator(".error-toast").count(), 0);
    },
  );
} catch (error) {
  failure = {
    test: current,
    message: String(error.message).split(temp).join("<owned-temp>"),
  };
  process.exitCode = 1;
  try {
    const state = await invoke("state.get");
    failure.sessionDiagnostics = state.sessions.map((s) => ({
      profileId: s.profileId,
      status: s.status,
      roleRouting: s.roleRouting,
      delivery: s.instructionBinding?.delivery,
    }));
  } catch {}
  try {
    if (page) await capture(`failure-${process.platform}.png`);
  } catch {}
  console.error("FAIL " + current + ": " + failure.message);
} finally {
  for (const gate of Object.values(gates)) gate.release();
  if (failure) {
    // Preserve bounded, non-content startup evidence before cleanup. No environment,
    // prompt, log message or provider credential is included in this report.
    const hostLog = path.join(temp, "userdata/logs/host.jsonl");
    failure.hostEvents = await fs.readFile(hostLog, "utf8").then(
      (content) =>
        content
          .slice(-65536)
          .split("\n")
          .flatMap((line) => {
            try {
              const item = JSON.parse(line);
              return [
                {
                  at: String(item.at).slice(0, 40),
                  kind: String(item.kind).slice(0, 100),
                },
              ];
            } catch {
              return [];
            }
          })
          .slice(-64),
      () => [],
    );
  }
  try {
    if (!application) throw new Error("Launch returned no application handle.");
    let timer;
    try {
      await Promise.race([
        application.close(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned App close deadline.")),
            3000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    cleanup = { application: "closed" };
  } catch {
    if (application?.process()?.pid) {
      const parent = application.process().pid;
      if (process.platform === "win32")
        await execFile("taskkill", ["/PID", String(parent), "/T", "/F"], {
          windowsHide: true,
        }).catch(() => undefined);
      else {
        const { stdout } = await execFile("ps", ["-ax", "-o", "pid=,ppid="], {
          maxBuffer: 512 * 1024,
        });
        const tree = stdout
          .trim()
          .split("\n")
          .map((line) => line.trim().split(/\s+/).map(Number));
        const owned = [parent];
        for (let index = 0; index < owned.length; index++)
          for (const [pid, ppid] of tree)
            if (ppid === owned[index] && !owned.includes(pid)) owned.push(pid);
        for (const pid of owned.reverse())
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
      }
    }
    cleanup = {
      application: application
        ? "owned process tree termination requested after close failure; exit not independently confirmed"
        : "launch returned no handle; process exit not independently confirmed",
    };
    if (!failure) {
      failure = {
        test: "cleanup",
        message:
          "Application required forced close after successful acceptance.",
      };
      process.exitCode = 1;
    }
  }
  provider?.closeAllConnections();
  if (provider) await new Promise((resolve) => provider.close(resolve));
  try {
    if (cleanup.application === "closed") {
      await fs.rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 150,
      });
      cleanup.ownedData = "removed";
    } else cleanup.ownedData = "retained: process exit unconfirmed";
  } catch {
    cleanup.ownedData = "remove failed";
    process.exitCode = 1;
  }
  const after = await hashes();
  sourceDrift = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => before[key] !== after[key]);
  if (sourceDrift.length && !preliminary) {
    failure ||= {
      test: "source/build hash guard",
      message: "Tested files changed during acceptance.",
    };
    process.exitCode = 1;
  }
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: failure
          ? "failed"
          : preliminary
            ? "preliminary-pass"
            : "passed",
        recordedAt: new Date().toISOString(),
        platform: process.platform,
        node: process.version,
        cliPackageVersion: JSON.parse(
          await fs.readFile(
            path.join(
              appRoot,
              "node_modules/@qwen-code/qwen-code/package.json",
            ),
            "utf8",
          ),
        ).version,
        kind: "Actual App + unmodified Qwen + owned loopback protocol fixture; no real-model intelligence claim",
        fixtureIsolation:
          "Fresh CLI home/runtime/project; managed Qwen memory/dream/skill background agents disabled only in the owned test settings; MCP executor enabled, classifier safe-mode and execution budget unchanged.",
        passed,
        total: 6,
        failure,
        requests,
        receipts,
        widths,
        captures,
        rendererErrors,
        fixtureErrors,
        sourceHashes: before,
        sourceDrift,
        cleanup,
        realModelCalls: 0,
        externalProviderCalls: 0,
      },
      null,
      2,
    ) + "\n",
  );
}
