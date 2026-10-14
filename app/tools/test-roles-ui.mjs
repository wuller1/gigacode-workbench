/** Actual shipped Electron App + persistent host + offline ACP process; no paid model. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.dirname(appRoot);
const evidence = path.join(repoRoot, "docs/suite/evidence/agent-runtime-ui");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-roles-app-"));
const projectPath = path.join(temp, "project");
const passed = [],
  bindingTransitions = [],
  resizeTransitions = [],
  capturedScreenshots = [],
  expectedRejections = [],
  rendererErrors = [],
  widths = [];
const sourcePaths = [
  "src/App.tsx",
  "src/SettingsView.tsx",
  "src/styles.css",
  "electron/service.ts",
  "electron/prompt-binding.ts",
  "electron/role-router.ts",
  "electron/preload.ts",
  "shared/types.ts",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "../workbench/CORE.md",
  "tools/test-roles-ui.mjs",
  ...(await fs.readdir(path.join(appRoot, "../workbench/profiles")))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => "../workbench/profiles/" + name),
];
let application,
  page,
  current = "startup",
  failure,
  failureScreenshot,
  failureCaptureError,
  cleanup;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const snapshots = async () => {
  const result = {};
  for (const name of sourcePaths)
    result[name] = hash(await fs.readFile(path.join(appRoot, name)));
  for (const name of (
    await fs.readdir(path.join(appRoot, "dist/assets"))
  ).sort())
    if (/\.(?:js|css)$/.test(name))
      result[`dist/assets/${name}`] = hash(
        await fs.readFile(path.join(appRoot, "dist/assets", name)),
      );
  return result;
};
const before = await snapshots();
const invoke = (method, params = {}) =>
  page.evaluate(
    ({ method, params }) => window.workbench.invoke(method, params),
    { method, params },
  );
const check = async (name, action) => {
  current = name;
  const started = Date.now();
  await action();
  passed.push({ name, elapsedMs: Date.now() - started });
  console.log("PASS " + name);
};
const poll = async (predicate, label, timeout = 10000) => {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeout) throw new Error("Timed out: " + label);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
const resize = async (width) => {
  await application.evaluate(({ BrowserWindow }, width) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(width, 900);
  }, width);
  await page.waitForFunction((width) => innerWidth === width, width);
  // OS/client bounds and CSS animation state do not prove the ResizeObserver ->
  // React dock layout has committed. This waits for that independent owner;
  // the original composer/document overflow oracle still runs afterwards.
  const readiness = await page.evaluate(
    (width) =>
      new Promise((resolve) => {
        const started = performance.now(),
          samples = [];
        let previous,
          stable = 0,
          frames = 0,
          frameId,
          finished = false;
        const read = () => {
          const viewport = document.querySelector(".dock-viewport");
          const canvas = document.querySelector(".dock-canvas");
          const chat = document.querySelector(".conversation-area");
          const composer = document.querySelector(".composer-toolbar");
          const vr = viewport?.getBoundingClientRect(),
            cr = canvas?.getBoundingClientRect();
          const hr = chat?.getBoundingClientRect(),
            mr = composer?.getBoundingClientRect();
          return {
            elapsedMs: Math.round(performance.now() - started),
            viewport: innerWidth,
            dockViewportWidth: viewport?.clientWidth,
            dockViewportLeft: vr?.left,
            canvasWidth: cr?.width,
            canvasHeight: cr?.height,
            chatWidth: hr?.width,
            composerLeft: mr?.left,
            composerRight: mr?.right,
          };
        };
        const finish = (settled) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          cancelAnimationFrame(frameId);
          resolve({
            requestedWidth: width,
            settled,
            frames,
            elapsedMs: Math.round(performance.now() - started),
            samples,
          });
        };
        const remember = (sample) => {
          if (samples.length === 12) samples.splice(4, 1);
          samples.push(sample);
        };
        const timer = setTimeout(() => {
          remember(read());
          finish(false);
        }, 2500);
        remember(read());
        const frame = () => {
          if (finished) return;
          frames++;
          const sample = read();
          remember(sample);
          const signature = JSON.stringify([
            sample.viewport,
            sample.dockViewportWidth,
            sample.canvasWidth,
            sample.canvasHeight,
            sample.chatWidth,
          ]);
          const dockCommitted =
            sample.viewport === width &&
            sample.dockViewportWidth > 0 &&
            Math.abs(sample.canvasWidth - sample.dockViewportWidth) <= 1 &&
            Math.abs(sample.chatWidth - sample.canvasWidth) <= 1;
          const animating = document
            .getAnimations()
            .some(
              (animation) =>
                animation.playState === "running" &&
                animation.effect?.getTiming().iterations !== Infinity,
            );
          stable =
            dockCommitted && !animating && signature === previous
              ? stable + 1
              : 0;
          previous = signature;
          if (stable >= 3 && frames >= 4) finish(true);
          else frameId = requestAnimationFrame(frame);
        };
        frameId = requestAnimationFrame(frame);
      }),
    width,
  );
  resizeTransitions.push(readiness);
  assert.equal(
    readiness.settled,
    true,
    "Dock resize failed to commit stable current bounds within 2500 ms",
  );
};

const geometry = async (width) => {
  const result = await page.evaluate(() => {
    const composer = document.querySelector(".composer-toolbar");
    const settings = document.querySelector(".settings-layout");
    const rect = composer?.getBoundingClientRect();
    return {
      viewport: innerWidth,
      documentClient: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      composerClient: composer?.clientWidth,
      composerScroll: composer?.scrollWidth,
      composerLeft: rect?.left,
      composerRight: rect?.right,
      settingsClient: settings?.clientWidth,
      settingsScroll: settings?.scrollWidth,
    };
  });
  widths.push({ requestedWidth: width, ...result });
  assert.equal(result.viewport, width);
  assert.ok(
    result.documentScroll <= result.documentClient + 1,
    "Desktop document horizontally overflows",
  );
  if (result.composerClient) {
    assert.ok(
      result.composerScroll <= result.composerClient + 1,
      "Composer toolbar horizontally overflows",
    );
    assert.ok(
      result.composerLeft >= -1 && result.composerRight <= width + 1,
      "Composer is outside viewport",
    );
  }
  if (result.settingsClient)
    assert.ok(
      result.settingsScroll <= result.settingsClient + 1,
      "Settings content horizontally overflows",
    );
};
const capture = async (name) => {
  // Native capture can otherwise contain the previous compositor frame after
  // a desktop resize even though DOM geometry already reflects the new width.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const image =
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    if (image.isEmpty()) throw new Error("Native screenshot is empty");
    return image.toPNG().toString("base64");
  });
  await fs.writeFile(path.join(evidence, name), Buffer.from(png, "base64"));
  capturedScreenshots.push(name);
};
const openRoles = async () => {
  await page.keyboard.press("Control+,");
  await page
    .locator(".settings-nav")
    .getByRole("button", { name: "Роли", exact: true })
    .click();
  await page.getByRole("heading", { name: "Роли", exact: true }).waitFor();
};
const closeSettings = () =>
  page
    .locator(".settings-footer")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
try {
  await fs.mkdir(evidence, { recursive: true });
  try {
    const old = JSON.parse(
      await fs.readFile(path.join(evidence, "report.json"), "utf8"),
    );
    const index =
      (await fs.readdir(evidence)).filter((name) => /^attempt-/.test(name))
        .length + 1;
    await fs.writeFile(
      path.join(evidence, `attempt-${index}-${old.status}.json`),
      JSON.stringify(old, null, 2) + "\n",
    );
  } catch {}
  await fs.mkdir(projectPath);
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  env.WORKBENCH_DATA_DIR = path.join(temp, "userdata");
  env.WORKBENCH_CLI_PATH = path.join(appRoot, "tests/fixtures/acp-fixture.mjs");
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [appRoot],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => rendererErrors.push(String(error.message)));
  await page.waitForFunction(() => Boolean(window.workbench));
  await application.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest((request, callback) =>
      callback({ cancel: /^https?:/i.test(request.url) }),
    ),
  );
  const project = await invoke("project.create", {
    name: "Role acceptance project",
    path: projectPath,
  });
  const task = await invoke("task.create", {
    projectId: project.id,
    title: "Role prompt acceptance",
    description:
      "Synthetic role/receipt acceptance. No corporate data or external operations.",
  });
  const session = await invoke("session.create", {
    taskId: task.id,
    title: "Role acceptance conversation",
  });
  await invoke("settings.update", {
    patch: { theme: "dark", startupRetries: 0 },
  });
  await page
    .locator(".task-select")
    .filter({ hasText: "Role prompt acceptance" })
    .click();
  const readSession = async () =>
    (await invoke("state.get")).sessions.find(
      (value) => value.id === session.id,
    );

  await check(
    "Actual session.prepare produces context-only prepared receipt without sending a task",
    async () => {
      await invoke("session.prepare", { id: session.id });
      const state = await readSession();
      assert.equal(state.instructionBinding.delivery, "context_only");
      assert.equal(state.instructionBinding.state, "prepared");
      assert.equal(state.messages.length, 0);
      const log = await fs.readFile(
        path.join(projectPath, "fixture-events.jsonl"),
        "utf8",
      );
      assert.equal(log.includes('"type":"prompt"'), false);
      await openRoles();
      await page.getByText("Применённые инструкции", { exact: true }).click();
      const details = page.locator(".settings-body > details.fine-print");
      assert.match(await details.innerText(), /Подготовлено/);
      assert.match(await details.innerText(), /Контекст/);
      assert.equal(
        (await details.innerText()).includes("Применено к исполнителю"),
        false,
      );
      await closeSettings();
    },
  );

  await check(
    "Retained router shows actual Analyst rather than a false Auto after a completed real fixture turn",
    async () => {
      const input = page.getByRole("textbox", {
        name: "Сообщение агенту",
        exact: true,
      });
      await input.fill("Check the accepted synthetic role context.");
      await input.press("Control+Enter");
      await poll(
        async () => (await readSession()).status === "completed",
        "completed fixture turn",
      );
      const state = await readSession();
      assert.equal(state.roleRouting.source, "retained");
      assert.equal(state.profileId, "analyst");
      assert.equal(state.instructionBinding.state, "active");
      const chip = page.locator(".composer-auto-profile");
      const started = Date.now();
      const beforeTitle = await chip.getAttribute("title");
      await poll(
        async () =>
          (await chip.innerText()).trim() === "Аналитик" &&
          (await chip.getAttribute("title"))?.includes("active") &&
          (await chip.getAttribute("title"))?.includes(
            state.instructionBinding.fingerprint.slice(0, 12),
          ),
        "renderer accepted active instruction receipt",
      );
      const title = await chip.getAttribute("title");
      bindingTransitions.push({
        backendState: state.instructionBinding.state,
        beforeTitle,
        afterTitle: title,
        elapsedMs: Date.now() - started,
      });
      assert.match(title, /Контекст/);
      assert.match(title, /active/);
      assert.match(title, /не подключён|недоступна/);
      assert.equal(title.includes("Роль выбрана автоматически"), false);
      const prompts = (
        await fs.readFile(
          path.join(projectPath, "fixture-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((item) => item.type === "prompt");
      assert.equal(prompts.length, 1);
      assert.equal(
        (prompts[0].content.match(/# Workbench common instructions/g) || [])
          .length,
        1,
      );
      assert.equal(
        (prompts[0].content.match(/# Workbench role: analyst/g) || []).length,
        1,
      );
      assert.ok(
        (await page
          .locator(".turn-outcome")
          .filter({ hasText: "Выполнено за" })
          .count()) > 0,
      );
    },
  );

  await check("Desktop composer fits 1000 and 1440 pixels", async () => {
    for (const width of [1000, 1440]) {
      await resize(width);
      await geometry(width);
    }
    await capture("roles-composer-dark-1440.png");
  });

  await check(
    "Settings exposes active context delivery and current fingerprint on the real completed executor",
    async () => {
      await openRoles();
      await page.getByText("Применённые инструкции", { exact: true }).click();
      const text = await page
        .locator(".settings-body > details.fine-print")
        .innerText();
      assert.match(text, /Применено к исполнителю/);
      assert.match(text, /Контекст/);
      assert.ok(
        text.includes(
          (await readSession()).instructionBinding.fingerprint.slice(0, 12),
        ),
      );
      assert.match(text, /Аналитик\s*·\s*Контекст\s*·\s*[a-f0-9]{12}/);
    },
  );

  let custom;
  await check(
    "Builtin clone saves through actual profile editor and host without changing builtin or active binding",
    async () => {
      const before = await invoke("state.get");
      const analyst = before.profiles.find((value) => value.id === "analyst");
      await page
        .locator(".profile-list button")
        .filter({ has: page.getByText("Аналитик", { exact: true }) })
        .click();
      const builtin = page.getByRole("dialog", {
        name: "Встроенный профиль",
        exact: true,
      });
      assert.equal(
        await builtin
          .getByLabel("Инструкции", { exact: true })
          .getAttribute("readonly"),
        "",
      );
      await builtin
        .getByRole("button", { name: "Копировать", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Редактор профиля",
        exact: true,
      });
      await editor
        .getByLabel("Название", { exact: true })
        .fill("Validation helper");
      await editor
        .getByLabel("Назначение", { exact: true })
        .fill("Synthetic custom-role acceptance, not an activated task role.");
      await editor
        .getByLabel("Инструкции", { exact: true })
        .fill(
          "Inspect current facts and report observed evidence. Preserve scope and user changes.",
        );
      await editor
        .getByRole("button", { name: "Сохранить профиль", exact: true })
        .click();
      await editor.waitFor({ state: "hidden" });
      const after = await invoke("state.get");
      custom = after.profiles.find(
        (value) => value.name === "Validation helper",
      );
      assert.ok(custom && !custom.builtin);
      assert.equal(after.profiles.length, before.profiles.length + 1);
      assert.deepEqual(
        after.profiles.find((value) => value.id === "analyst"),
        analyst,
      );
      assert.equal((await readSession()).profileId, "analyst");
    },
  );

  await check(
    "UTF-8 byte overflow is rejected in real profile UI and retains the saved version",
    async () => {
      await page
        .locator(".profile-list button")
        .filter({ has: page.getByText("Validation helper", { exact: true }) })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Редактор профиля",
        exact: true,
      });
      const invalid = "😀".repeat(20000); // 40k UTF-16 units fits text limit, 80k UTF-8 bytes exceeds compiler limit.
      assert.ok(
        invalid.length < 60000 && Buffer.byteLength(invalid, "utf8") > 65536,
      );
      await editor.getByLabel("Инструкции", { exact: true }).fill(invalid);
      await editor
        .getByRole("button", { name: "Сохранить профиль", exact: true })
        .click();
      const toast = page.locator(".error-toast");
      await toast.waitFor();
      assert.match(await toast.innerText(), /64 KiB|exceed/i);
      assert.equal(await editor.isVisible(), true);
      assert.equal(
        (await invoke("state.get")).profiles.find(
          (value) => value.id === custom.id,
        ).prompt,
        custom.prompt,
      );
      expectedRejections.push(
        "UTF-8 byte overflow: rejected; editor draft and saved profile preserved",
      );
      await toast
        .getByRole("button", { name: "Закрыть сообщение", exact: true })
        .click();
      await editor
        .getByLabel("Инструкции", { exact: true })
        .fill(custom.prompt);
      await editor.getByRole("button", { name: "Отмена", exact: true }).click();
    },
  );

  await check(
    "Malformed Unicode is rejected from controlled profile UI without corrupting saved instructions",
    async () => {
      await page
        .locator(".profile-list button")
        .filter({ has: page.getByText("Validation helper", { exact: true }) })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Редактор профиля",
        exact: true,
      });
      await editor
        .getByLabel("Инструкции", { exact: true })
        .evaluate((textarea) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          ).set;
          setter.call(textarea, "invalid\ud800instructions");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await editor
        .getByRole("button", { name: "Сохранить профиль", exact: true })
        .click();
      const toast = page.locator(".error-toast");
      await toast.waitFor();
      assert.match(await toast.innerText(), /Invalid Unicode/);
      assert.equal(await editor.isVisible(), true);
      assert.equal(
        (await invoke("state.get")).profiles.find(
          (value) => value.id === custom.id,
        ).prompt,
        custom.prompt,
      );
      expectedRejections.push(
        "Invalid UTF-16 Unicode: rejected from actual controlled profile UI and saved version preserved",
      );
      await toast
        .getByRole("button", { name: "Закрыть сообщение", exact: true })
        .click();
      await editor
        .getByLabel("Инструкции", { exact: true })
        .fill(custom.prompt);
      await editor.getByRole("button", { name: "Отмена", exact: true }).click();
    },
  );

  await check(
    "Desktop Roles settings fit 1000 and 1440 pixels in light theme",
    async () => {
      await invoke("settings.update", { patch: { theme: "light" } });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
      for (const width of [1440, 1000]) {
        await resize(width);
        await geometry(width);
      }
      await page.locator(".settings-body").evaluate((node) => {
        node.scrollTop = 0;
      });
      await capture("roles-settings-light-1000.png");
      await closeSettings();
      assert.equal(await page.locator(".error-toast").count(), 0);
      assert.deepEqual(rendererErrors, []);
    },
  );
} catch (error) {
  if (page && application) {
    try {
      await geometry(await page.evaluate(() => innerWidth));
    } catch {}
    try {
      const name = `roles-failure-${process.platform}.png`;
      await capture(name);
      failureScreenshot = name;
    } catch (captureError) {
      failureCaptureError = String(captureError.message)
        .split(temp)
        .join("<owned-temp>");
    }
  }
  failure = {
    test: current,
    message: String(error.message).split(temp).join("<owned-temp>"),
  };
  process.exitCode = 1;
} finally {
  try {
    await application?.close();
    cleanup = { application: "closed", ownedData: "removed" };
  } catch (error) {
    cleanup = {
      application: "close failed",
      error: String(error.message).split(temp).join("<owned-temp>"),
    };
    process.exitCode = 1;
  }
  await fs.rm(temp, { recursive: true, force: true });
  const after = await snapshots();
  const changed = Object.keys(before).filter(
    (name) => before[name] !== after[name],
  );
  if (changed.length) {
    failure ||= {
      test: "provenance",
      message: "Source/build drift during run: " + changed.join(", "),
    };
    process.exitCode = 1;
  }
  await fs.mkdir(evidence, { recursive: true });
  const report = {
    status: failure ? "failed" : "passed",
    platform: process.platform,
    scope:
      "Actual shipped Electron App, actual IPC/AtomicStore/WorkbenchService and local ACP fixture. No real model, corporate MCP or native append acceptance claimed; platform is recorded separately.",
    passed,
    failure,
    expectedRejections,
    rendererErrors,
    widths,
    resizeTransitions,
    bindingTransitions,
    failureScreenshot,
    failureCaptureError,
    provenance: {
      sha256: before,
      unchangedDuringRun: changed.length === 0,
      changed,
    },
    screenshots: capturedScreenshots,
    cleanup,
  };
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      passed: passed.length,
      failure,
      evidence: path.relative(repoRoot, evidence),
      cleanup,
    }),
  );
}
