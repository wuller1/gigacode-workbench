/** Shipped application, real local persistence/process/ACP transport; offline model peer. */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { _electron } from "playwright";
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-chat-live-")),
  projectPath = path.join(temp, "project");
await fs.mkdir(projectPath);
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
      k,
    )
  )
    delete env[k];
env.WORKBENCH_DATA_DIR = path.join(temp, "userdata");
env.WORKBENCH_CLI_PATH = path.join(root, "tests/fixtures/acp-fixture.mjs");
let app;
const results = [],
  errors = [],
  outcomeTransitions = [];
try {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [root],
    env,
    timeout: 30000,
  });
  const p = await app.firstWindow();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.waitForFunction(() => Boolean(window.workbench));
  const invoke = (method, params) =>
    p.evaluate(
      ({ method, params }) => window.workbench.invoke(method, params),
      { method, params },
    );
  const project = await invoke("project.create", {
      name: "Chat acceptance",
      path: projectPath,
    }),
    task = await invoke("task.create", {
      projectId: project.id,
      title: "Queue acceptance",
    }),
    session = await invoke("session.create", {
      taskId: task.id,
      title: "Primary",
    });
  await p
    .locator(".task-select")
    .filter({ hasText: "Queue acceptance" })
    .click();
  const check = async (name, fn) => {
      await fn();
      results.push(name);
      console.log("PASS", name);
    },
    assert = async (c, m) => {
      if (!(await c)) throw Error(m);
    };
  await check(
    "First model picker initializes actual ACP without a prompt",
    async () => {
      await p
        .getByRole("button", { name: "Модель и рассуждение", exact: true })
        .click();
      await p.getByRole("button", { name: "Reasoning", exact: true }).click();
      await p.getByRole("button", { name: "Low", exact: true }).click();
      await p.waitForFunction(
        () => document.querySelector(".model-depth")?.textContent === "Low",
      );
      await p.keyboard.press("Escape");
      const logs = await fs.readFile(
        path.join(projectPath, "fixture-events.jsonl"),
        "utf8",
      );
      if (logs.includes('"type":"prompt"'))
        throw Error("Opening model menu sent a model prompt");
    },
  );
  const input = p.getByRole("textbox", {
      name: "Сообщение агенту",
      exact: true,
    }),
    send = async (text) => {
      await input.fill(text);
      await input.press("Control+Enter");
      await p.waitForFunction(
        () =>
          document.querySelector('[aria-label="Сообщение агенту"]').value ===
          "",
      );
    };
  await check(
    "Full app queues, edits inline and sends priority after real cancellation",
    async () => {
      await send("hold ui current");
      await p.waitForFunction(() => document.querySelector(".status-running"));
      await send("later");
      await send("urgent");
      await p
        .getByRole("button", { name: "Редактировать сообщение", exact: true })
        .first()
        .click();
      await p
        .getByRole("textbox", { name: "Редактирование сообщения в очереди" })
        .fill("later edited");
      await p.getByRole("button", { name: "Сохранить", exact: true }).click();
      await p
        .getByRole("button", { name: "Отправить сейчас", exact: true })
        .last()
        .click();
      const deadline = Date.now() + 10000;
      while (true) {
        const state = await invoke("state.get", {}),
          s = state.sessions.find((s) => s.id === session.id);
        if (
          s?.messages.filter((m) => m.role === "user").length === 3 &&
          s.status === "completed"
        )
          break;
        if (Date.now() > deadline)
          throw Error(
            "Queue did not complete: " +
              JSON.stringify({ status: s?.status, queue: s?.queue }),
          );
        await new Promise((r) => setTimeout(r, 40));
      }
      const lines = (
        await fs.readFile(
          path.join(projectPath, "fixture-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map(JSON.parse);
      const prompts = lines.filter((l) => l.type === "prompt");
      if (
        JSON.stringify(prompts.map((x) => x.command)) !==
        JSON.stringify(["hold ui current", "urgent", "later edited"])
      )
        throw Error(
          "Wrong queue order/duplicate: " +
            JSON.stringify(prompts.map((x) => x.command)),
        );
      if (
        prompts.some(
          (l) => l.model !== "fixture-reasoning" || l.reasoning !== "low",
        )
      )
        throw Error("Model configuration did not reach the real ACP peer");
    },
  );
  await check(
    "Completed/cancelled outcomes render truthfully without speaker labels",
    async () => {
      const started = Date.now();
      const before = await p.locator(".turn-outcome").allTextContents();
      // A completed backend response does not commit React's coalesced snapshot.
      // Wait for the exact user-visible terminal outcomes, keeping both oracles.
      await p.waitForFunction(() => {
        const labels = [...document.querySelectorAll(".turn-outcome")].map(
          (node) => node.textContent || "",
        );
        return (
          labels.filter((text) => text.includes("Выполнено за")).length === 2 &&
          labels.filter((text) => text.includes("Остановлено")).length === 1
        );
      });
      outcomeTransitions.push({
        before,
        after: await p.locator(".turn-outcome").allTextContents(),
        elapsedMs: Date.now() - started,
      });
      await assert(
        p
          .locator(".turn-outcome")
          .filter({ hasText: "Выполнено за" })
          .count()
          .then((n) => n === 2),
        "Completed durations missing",
      );
      await assert(
        p
          .locator(".turn-outcome")
          .filter({ hasText: "Остановлено" })
          .count()
          .then((n) => n === 1),
        "Cancelled turn marked completed",
      );
      await assert(
        p
          .locator(".message header strong")
          .count()
          .then((n) => n === 0),
        "Speaker labels remain",
      );
    },
  );
  await invoke("settings.update", { patch: { theme: "dark" } });
  await p.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  const capture = async (name) => {
    // Theme state changes before the 120 ms button transitions finish. Wait for
    // the rendered selection color, not just the data-theme attribute.
    await p.waitForFunction(
      () => {
        const selected = document.querySelector(".tool-rail .selected");
        if (!selected) return false;
        const probe = document.createElement("span");
        probe.style.color = "var(--selected)";
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(selected).backgroundColor === expected;
      },
      undefined,
      { polling: 50 },
    );
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        );
      if (image.isEmpty()) throw Error("Empty native chat capture");
      return image.toPNG().toString("base64");
    });
    await fs.writeFile(path.join(temp, name), Buffer.from(png, "base64"));
  };
  await capture("chat-dark.png");
  await invoke("settings.update", { patch: { theme: "light" } });
  await p.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await capture("chat-light.png");
  if (await p.locator(".error-toast").count())
    throw Error("Unexpected error toast in completed chat workflow");
  if (errors.length) throw Error(errors.join("\n"));
  await fs.writeFile(
    path.join(temp, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        results,
        outcomeTransitions,
        errors,
        scope:
          "Shipped Electron app with offline ACP model peer; no paid model or corporate MCP",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: results.length, evidence: temp }));
} finally {
  await app?.close();
}
