/** Actual App, owned ACP process and native renderer crash. No model/network. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { _electron } from "playwright";
const require = createRequire(import.meta.url),
  appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  repoRoot = path.dirname(appRoot);
const evidence = path.join(
    repoRoot,
    "docs/suite/evidence/renderer-resilience-ui",
  ),
  temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "workbench-renderer-recovery-")),
  );
const projectA = path.join(temp, "project-a"),
  projectB = path.join(temp, "project-b"),
  dataDir = path.join(temp, "userdata");
const passed = [],
  captures = [],
  proofs = [],
  rendererErrors = [];
let application,
  page,
  pageB,
  current = "startup",
  failure,
  cleanup,
  nativeAfterCrash = false;
const nativeWindows = new Map();
const sources = [
  "src/App.tsx",
  "src/api.ts",
  "src/snapshot-feed.ts",
  "src/local-state.ts",
  "src/Workspace.tsx",
  "src/ErrorBoundary.tsx",
  "src/ToolBoundary.tsx",
  "src/QueueMessages.tsx",
  "src/queue-edit-journal.ts",
  "src/styles.css",
  "electron/preload.ts",
  "electron/main.ts",
  "electron/service.ts",
  "electron/acp.ts",
  "electron/store.ts",
  "electron/renderer-recovery.ts",
  "shared/types.ts",
  "tests/fixtures/acp-fixture.mjs",
  "tools/test-renderer-resilience-ui.mjs",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = async () => {
  const values = {};
  for (const file of sources)
    values[file] = hash(await fs.readFile(path.join(appRoot, file)));
  for (const file of (
    await fs.readdir(path.join(appRoot, "dist/assets"))
  ).sort())
    if (/\.(?:js|css)$/.test(file))
      values["dist/assets/" + file] = hash(
        await fs.readFile(path.join(appRoot, "dist/assets", file)),
      );
  return values;
};
const before = await hashes();
const nativeEvaluate = (source, id = info?.windowId || 1) =>
  application.evaluate(
    async ({ BrowserWindow }, { source, id }) => {
      const win = BrowserWindow.fromId(id);
      if (
        !win ||
        win.isDestroyed() ||
        win.webContents.isCrashed() ||
        win.webContents.isLoadingMainFrame()
      )
        throw new Error("Owned native renderer is not ready");
      let timer;
      try {
        return await Promise.race([
          win.webContents.executeJavaScript(source),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Owned native DOM observation deadline")),
              1500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    { source, id },
  );
const invoke = (target, method, params = {}) =>
  nativeAfterCrash && nativeWindows.has(target)
    ? nativeEvaluate(
        `window.workbench.invoke(${JSON.stringify(method)},${JSON.stringify(params)})`,
        nativeWindows.get(target),
      )
    : target.evaluate(
        ({ method, params }) => window.workbench.invoke(method, params),
        { method, params },
      );
const poll = async (predicate, label, timeout = 15000) => {
  const started = Date.now();
  while (true) {
    try {
      if (await predicate()) return;
    } catch {}
    if (Date.now() - started > timeout) throw new Error("Timed out: " + label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const check = async (name, action) => {
  current = name;
  const started = Date.now();
  await action();
  passed.push({ name, elapsedMs: Date.now() - started });
  console.log("PASS " + name);
};
const capture = async (name) => {
  const image = await application.evaluate(
    async ({ BrowserWindow }, id) =>
      (await BrowserWindow.fromId(id).webContents.capturePage())
        .toPNG()
        .toString("base64"),
    info?.windowId || 1,
  );
  await fs.writeFile(path.join(evidence, name), Buffer.from(image, "base64"));
  captures.push(name);
};
const events = async () => {
  try {
    return (
      await fs.readFile(path.join(projectA, "fixture-events.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
  } catch {
    return [];
  }
};
let a, b, task, session, info, identity;
const readSession = async () =>
  (await invoke(page, "state.get")).sessions.find((s) => s.id === session.id);
const control = async () =>
  JSON.parse(await fs.readFile(path.join(dataDir, "state.json"), "utf8"))
    ._controls[session.id];
const liveIdentity = async () => {
  const history = await events(),
    prompts = history.filter((item) => item.type === "prompt"),
    s = await readSession(),
    c = await control();
  return {
    pid: history.find((item) => item.type === "session_new")?.pid,
    generation: c.generation,
    sessionId: s.id,
    taskId: s.taskId,
    queue: s.queue.map((item) => ({ id: item.id, text: item.text })),
    promptCount: prompts.length,
    userMessages: s.messages.filter((m) => m.role === "user").length,
  };
};
const input = (target) =>
  target.getByRole("textbox", { name: "Сообщение агенту", exact: true });
const draftValue = (target) =>
  nativeAfterCrash
    ? nativeEvaluate(
        `document.querySelector('textarea[aria-label="Сообщение агенту"]')?.value`,
        nativeWindows.get(target),
      )
    : input(target).inputValue();
const contrastProof = async (selector, label) => {
  const theme = await nativeEvaluate(`document.documentElement.dataset.theme`);
  assert.equal(theme, label.startsWith("light") ? "light" : "dark");
  const controls = await nativeEvaluate(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(button => { const s=getComputedStyle(button); return {name:button.textContent.trim(),foreground:s.color,background:s.backgroundColor,opacity:s.opacity,disabled:button.disabled}; })`,
  );
  assert.ok(controls.length > 0, label + " controls missing");
  assert.ok(
    controls.every((control) => !control.disabled),
    label + " fresh local actions must remain available",
  );
  proofs.push({ stage: label + " control contrast", theme, controls });
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    assert.equal(channels?.length, 3, "Unexpected computed control color");
    const linear = channels.map((v) => {
      const n = v / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  for (const control of controls) {
    const a = luminance(control.foreground),
      b = luminance(control.background);
    control.contrast =
      Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) /
      100;
    if (!control.disabled) {
      assert.equal(
        Number(control.opacity),
        1,
        label + " enabled control opacity",
      );
      assert.ok(
        control.contrast >= 4.5,
        `${label} control text contrast ${control.contrast} below4.5`,
      );
    }
  }
};
const draftA =
  "Черновик первого окна. Должен пережить настоящий сбой renderer.";
const draftB = "Черновик второго проекта, независимый от первого окна.";
const alternate = "Другой вариант для этого разговора из второго окна.";
const queued = "Queued request must remain unsent during renderer recovery.";
const queueDraft =
  "Uncommitted queue edit must survive renderer recovery without changing the accepted queue item.";
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
  await fs.mkdir(projectA);
  await fs.mkdir(projectB);
  await fs.writeFile(
    path.join(projectA, "evidence.txt"),
    "Owned renderer recovery evidence.\n",
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  Object.assign(env, {
    WORKBENCH_DATA_DIR: dataDir,
    WORKBENCH_CLI_PATH: path.join(appRoot, "tests/fixtures/acp-fixture.mjs"),
  });
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [appRoot],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForFunction(() => Boolean(window.workbench));
  await page.locator(".app-shell").waitFor();
  await application.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest((request, callback) =>
      callback({ cancel: /^https?:/i.test(request.url) }),
    ),
  );
  await check(
    "Wrong-typed local preferences and draft data cannot blank the actual App or overwrite their original bytes",
    async () => {
      await page.evaluate(() => {
        localStorage.setItem("workbench.sidebar.window.primary", '"wrong"');
        localStorage.setItem("workbench.selection.window.primary", "[]");
        localStorage.setItem(
          "workbench.layout.v2.window.primary",
          JSON.stringify({ version: 2, tree: "invalid tree", locations: 17 }),
        );
        localStorage.setItem(
          "workbench.drafts.v1",
          JSON.stringify({ bad: { text: null, attachments: "wrong" } }),
        );
      });
      await page.reload();
      await page.locator(".app-shell").waitFor();
      assert.equal(
        await page
          .getByRole("alert")
          .filter({ hasText: "Не удалось отобразить" })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("workbench.selection.window.primary"),
        ),
        "[]",
      );
      assert.equal(await page.locator(".dock-canvas").count(), 1);
    },
  );
  a = await invoke(page, "project.create", {
    name: "Renderer project A",
    path: projectA,
  });
  task = await invoke(page, "task.create", {
    projectId: a.id,
    title: "Renderer recovery task",
    description: "Owned process and UI recovery test, no external systems.",
  });
  session = await invoke(page, "session.create", {
    taskId: task.id,
    title: "Host continues while renderer restarts",
  });
  await invoke(page, "settings.update", {
    patch: { theme: "dark", startupRetries: 0 },
  });
  await page.locator(".task-select").filter({ hasText: task.title }).click();
  await check(
    "Actual owned ACP request runs once; queued message and per-window drafts stay independent",
    async () => {
      await input(page).fill("hold ui tool-progress");
      await input(page).press("Control+Enter");
      await poll(
        async () =>
          (await events()).filter((item) => item.type === "prompt").length ===
          1,
        "first actual ACP prompt",
      );
      await input(page).fill(queued);
      await input(page).press("Control+Enter");
      await poll(
        async () => (await readSession()).queue.length === 1,
        "queued user message",
      );
      await input(page).fill(draftA);
      await application.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [file],
          });
        },
        path.join(projectA, "evidence.txt"),
      );
      await page
        .getByRole("button", { name: "Приложить файлы проекта", exact: true })
        .click();
      await page
        .locator(".attachment-list")
        .getByText("evidence.txt", { exact: true })
        .waitFor();
      info = await invoke(page, "app.info");
      nativeWindows.set(page, info.windowId);
      assert.equal(info.windowKey, "primary");
      await invoke(page, "window.new");
      await poll(
        async () => application.windows().length === 2,
        "second actual window",
      );
      pageB = application.windows().find((candidate) => candidate !== page);
      pageB.setDefaultTimeout(10000);
      pageB.on("pageerror", (error) => rendererErrors.push(error.message));
      await pageB.locator(".app-shell").waitFor();
      b = await invoke(pageB, "project.create", {
        name: "Renderer project B",
        path: projectB,
      });
      const secondTask = await invoke(pageB, "task.create", {
        projectId: b.id,
        title: "Independent window task",
        description: "Separate unsent draft.",
      });
      await invoke(pageB, "session.create", {
        taskId: secondTask.id,
        title: "Second window",
      });
      await pageB
        .locator(".task-select")
        .filter({ hasText: secondTask.title })
        .click();
      await input(pageB).fill(draftB);
      const secondInfo = await invoke(pageB, "app.info");
      nativeWindows.set(pageB, secondInfo.windowId);
      assert.notEqual(secondInfo.windowKey, "primary");
      await pageB
        .locator(".task-select")
        .filter({ hasText: task.title })
        .click();
      assert.equal(await input(pageB).inputValue(), "");
      await pageB
        .getByRole("button", {
          name: "Сохранённый черновик из другого окна",
          exact: true,
        })
        .click();
      await pageB
        .getByRole("dialog", { name: "Сохранённый черновик", exact: true })
        .getByRole("button", { name: "Восстановить черновик", exact: true })
        .click();
      assert.equal(await input(pageB).inputValue(), draftA);
      await input(pageB).fill(alternate);
      assert.equal(await input(page).inputValue(), draftA);
      const recovery = page.getByRole("button", {
        name: "Сохранённый черновик из другого окна",
        exact: true,
      });
      await recovery.click();
      const modal = page.getByRole("dialog", {
        name: "Сохранённый черновик",
        exact: true,
      });
      assert.equal(
        await modal
          .getByRole("textbox", { name: "Сохранённый черновик", exact: true })
          .inputValue(),
        alternate,
      );
      await modal
        .getByRole("button", { name: "Восстановить черновик", exact: true })
        .click();
      assert.equal(await input(page).inputValue(), alternate);
      assert.equal(
        await page.evaluate(
          (text) =>
            Object.keys(localStorage)
              .filter((key) => key.startsWith("workbench.draft.backup.v2."))
              .some(
                (key) =>
                  JSON.parse(localStorage.getItem(key)).value.text === text,
              ),
          draftA,
        ),
        true,
      );
      // Restore the user's current test draft explicitly; no message is submitted.
      await input(page).fill(draftA);
      await page
        .getByRole("button", { name: "Приложить файлы проекта", exact: true })
        .click();
      await page
        .locator(".attachment-list")
        .getByText("evidence.txt", { exact: true })
        .waitFor();
      await pageB
        .locator(".task-select")
        .filter({ hasText: secondTask.title })
        .click();
      assert.equal(await input(pageB).inputValue(), draftB);
      identity = await liveIdentity();
      assert.equal(identity.promptCount, 1);
      assert.equal(identity.userMessages, 1);
      assert.equal(identity.queue.length, 1);
      proofs.push({
        stage: "before faults",
        ...identity,
        windowId: info.windowId,
      });
    },
  );
  await page
    .getByRole("button", { name: "Редактировать сообщение", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Редактирование сообщения в очереди",
      exact: true,
    })
    .fill(queueDraft);
  assert.equal((await readSession()).queue[0].text, queued);
  // Ephemeral fault gateway around the real IPC handler. It never changes the
  // service's state or introduces test-only routing into production code.
  await application.evaluate(({ ipcMain, BrowserWindow }, windowId) => {
    const original = ipcMain._invokeHandlers.get("workbench:invoke");
    if (typeof original !== "function")
      throw new Error(
        "Pinned Electron IPC handler unavailable for owned response-fault test.",
      );
    const harness = {
      original,
      windowId,
      failReads: 0,
      delayNext: false,
      heldRead: undefined,
      dropEvents: false,
      reads: 0,
      failures: 0,
    };
    globalThis.__rendererResilience = harness;
    ipcMain.removeHandler("workbench:invoke");
    ipcMain.handle("workbench:invoke", async (event, method, params) => {
      const value = await original(event, method, params);
      if (
        method === "state.get" &&
        BrowserWindow.fromWebContents(event.sender)?.id === windowId
      ) {
        harness.reads++;
        if (harness.failReads > 0) {
          harness.failReads--;
          harness.failures++;
          throw new Error("Owned transient snapshot failure");
        }
        if (harness.delayNext) {
          harness.delayNext = false;
          const captured = structuredClone(value);
          captured.revision += 1000;
          return new Promise((resolve) => {
            harness.heldRead = () => resolve(captured);
          });
        }
      }
      return value;
    });
    const contents = BrowserWindow.fromId(windowId).webContents,
      send = contents.send.bind(contents);
    harness.send = send;
    contents.send = (channel, event, ...args) => {
      if (
        harness.dropEvents &&
        channel === "workbench:event" &&
        event?.type === "state.changed"
      )
        return;
      return send(channel, event, ...args);
    };
  }, info.windowId);
  await check(
    "Missed host notifications and transient snapshot failures recover without user interaction",
    async () => {
      await application.evaluate(() => {
        globalThis.__rendererResilience.dropEvents = true;
      });
      await invoke(page, "task.update", {
        id: task.id,
        title: "Recovered by background polling",
      });
      await poll(
        async () =>
          ((await page.locator(".task-context").count())
            ? await page.locator(".task-context").innerText()
            : await page.locator(".app-shell").innerText()
          ).includes("Recovered by background polling"),
        "missed-event polling",
        15000,
      );
      await application.evaluate(() => {
        globalThis.__rendererResilience.failReads = 1;
      });
      await invoke(page, "task.update", {
        id: task.id,
        title: "Recovered after transient read failure",
      });
      await poll(
        async () =>
          (await page.locator(".app-shell").innerText()).includes(
            "Recovered after transient read failure",
          ),
        "read retry without click",
        15000,
      );
      assert.equal(await input(page).inputValue(), draftA);
      await application.evaluate(() => {
        globalThis.__rendererResilience.dropEvents = false;
      });
      assert.equal((await liveIdentity()).promptCount, 1);
    },
  );
  await check(
    "Timed-out out-of-order IPC response cannot replace the newer screen",
    async () => {
      await application.evaluate(({ BrowserWindow }) => {
        globalThis.__rendererResilience.delayNext = true;
        BrowserWindow.fromId(
          globalThis.__rendererResilience.windowId,
        ).webContents.send("workbench:event", {
          type: "state.changed",
          payload: {},
        });
      });
      await poll(
        () =>
          application.evaluate(
            () => !!globalThis.__rendererResilience.heldRead,
          ),
        "owned delayed read captured",
      );
      await invoke(page, "task.update", {
        id: task.id,
        title: "Newest task title after delayed response",
      });
      await poll(
        async () =>
          (await page.locator(".app-shell").innerText()).includes(
            "Newest task title after delayed response",
          ),
        "deadline and read recovery",
        15000,
      );
      await application.evaluate(() => {
        globalThis.__rendererResilience.heldRead();
        globalThis.__rendererResilience.heldRead = undefined;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(
        (await page.locator(".app-shell").innerText()).includes(
          "Newest task title after delayed response",
        ),
      );
      assert.equal(await input(page).inputValue(), draftA);
      assert.deepEqual(await liveIdentity(), identity);
    },
  );
  await check(
    "Native renderer crash reloads the same window while host PID generation queue and draft survive",
    async () => {
      nativeAfterCrash = true;
      await application.evaluate(({ BrowserWindow }, id) => {
        const contents = BrowserWindow.fromId(id).webContents;
        globalThis.__ownedRendererCrashes = [];
        contents.once("render-process-gone", (_event, details) =>
          globalThis.__ownedRendererCrashes.push(details),
        );
        contents.forcefullyCrashRenderer();
      }, info.windowId);
      await poll(
        async () =>
          (await nativeEvaluate(
            `document.querySelectorAll('.app-shell').length`,
          )) === 1 && (await draftValue(page)) === draftA,
        "automatic renderer recovery",
        20000,
      );
      const after = await invoke(page, "app.info");
      assert.equal(after.windowId, info.windowId);
      assert.equal(after.windowKey, "primary");
      assert.deepEqual(await liveIdentity(), identity);
      assert.equal(await draftValue(pageB), draftB);
      assert.equal(
        await nativeEvaluate(
          `document.querySelector('textarea[aria-label="Редактирование сообщения в очереди"]')?.value`,
        ),
        queueDraft,
      );
      assert.equal(
        (await invoke(pageB, "app.info")).windowId !== info.windowId,
        true,
      );
      assert.ok(
        (
          await nativeEvaluate(
            `document.querySelector('.attachment-list')?.textContent || ''`,
          )
        ).includes("evidence.txt"),
      );
      const crashEvents = await application.evaluate(
        () => globalThis.__ownedRendererCrashes,
      );
      assert.equal(crashEvents.length, 1);
      await contrastProof(".queue-editor > div > button", "dark queue editor");
      proofs.push({
        stage: "after actual renderer crash",
        ...(await liveIdentity()),
        windowId: after.windowId,
        crashEvents,
        observation:
          "Native WebContents DOM after recovery; Playwright's old Page can retain a crashed target flag.",
      });
      await capture("recovered-dark-desktop.png");
      await invoke(page, "settings.update", { patch: { theme: "light" } });
      await poll(
        () =>
          nativeEvaluate(`document.documentElement.dataset.theme === 'light'`),
        "light theme applied",
      );
      await contrastProof(".queue-editor > div > button", "light queue editor");
      await capture("recovered-light-desktop.png");
      await invoke(page, "settings.update", { patch: { theme: "dark" } });
      await poll(
        () =>
          nativeEvaluate(`document.documentElement.dataset.theme === 'dark'`),
        "dark theme restored",
      );
      assert.deepEqual(await liveIdentity(), identity);
    },
  );
  await check(
    "Actual ErrorBoundary sanitizes a render failure and performs one bounded remount",
    async () => {
      const bundled = await build({
        stdin: {
          resolveDir: appRoot,
          loader: "tsx",
          contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ErrorBoundary}from'./src/ErrorBoundary';window.__boundaryFault=true;function Child(){if(window.__boundaryFault)throw new Error('Bearer owned-fixture-secret');return <p>Owned boundary recovered</p>}const root=document.createElement('div');root.id='owned-boundary-probe';document.body.append(root);window.__boundaryRoot=createRoot(root,{onCaughtError(){}});window.__boundaryRoot.render(<ErrorBoundary><Child/></ErrorBoundary>);`,
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        logLevel: "silent",
      });
      await nativeEvaluate(bundled.outputFiles[0].text);
      await poll(
        () =>
          nativeEvaluate(
            `!!document.querySelector('#owned-boundary-probe [role="alert"]')`,
          ),
        "actual boundary fallback",
      );
      assert.equal(
        (
          await nativeEvaluate(
            `document.getElementById('owned-boundary-probe').textContent`,
          )
        ).includes("owned-fixture-secret"),
        false,
      );
      await nativeEvaluate(`window.__boundaryFault = false`);
      await poll(
        async () =>
          (
            await nativeEvaluate(
              `document.getElementById('owned-boundary-probe').textContent`,
            )
          ).includes("Owned boundary recovered"),
        "bounded component remount",
      );
      await nativeEvaluate(`(() => {
        window.__boundaryRoot.unmount();
        document.getElementById("owned-boundary-probe").remove();
        delete window.__boundaryRoot;
        delete window.__boundaryFault;
      })()`);
      assert.deepEqual(await liveIdentity(), identity);
    },
  );
  await check(
    "Cancelling real application shutdown recovers a renderer that crashed during native preflight",
    async () => {
      await application.evaluate(({ app, dialog }) => {
        const original = dialog.showMessageBox.bind(dialog);
        globalThis.__cancelShutdownFixture = { original };
        dialog.showMessageBox = (...args) => {
          const options = args.at(-1);
          if (options?.title === "Есть выполняющиеся задачи")
            return new Promise((resolve) => {
              globalThis.__cancelShutdownFixture.release = () =>
                resolve({ response: 0, checkboxChecked: false });
            });
          return original(...args);
        };
        app.quit();
      });
      await poll(
        () =>
          application.evaluate(
            () => !!globalThis.__cancelShutdownFixture.release,
          ),
        "actual shutdown reached native task preflight",
      );
      await application.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.fromId(id).webContents.forcefullyCrashRenderer(),
        info.windowId,
      );
      await poll(
        () =>
          application.evaluate(
            ({ BrowserWindow }, id) =>
              BrowserWindow.fromId(id).webContents.isCrashed(),
            info.windowId,
          ),
        "renderer crashed while shutdown is preparing",
      );
      await application.evaluate(({ dialog }) => {
        globalThis.__cancelShutdownFixture.release();
        dialog.showMessageBox = globalThis.__cancelShutdownFixture.original;
        delete globalThis.__cancelShutdownFixture;
      });
      await poll(
        async () =>
          (await nativeEvaluate(
            `document.querySelectorAll('.app-shell').length`,
          )) === 1 && (await draftValue(page)) === draftA,
        "cancelled shutdown's deferred renderer recovery",
        20000,
      );
      assert.deepEqual(await liveIdentity(), identity);
      assert.equal(await draftValue(pageB), draftB);
      assert.equal(await nativeEvaluate(`document.body.inert`), false);
      assert.equal(
        await nativeEvaluate(
          `document.querySelector('textarea[aria-label="Редактирование сообщения в очереди"]')?.value`,
        ),
        queueDraft,
      );
      await nativeEvaluate(
        `document.querySelector('button[aria-label="Закрыть сообщение"]')?.click()`,
      );
      proofs.push({
        stage: "after cancelled shutdown and actual renderer crash",
        ...(await liveIdentity()),
      });
    },
  );
  await check(
    "Real main fatal path quiesces host and exposes persistent restart status without replay",
    async () => {
      await application.evaluate(() => {
        process.emit(
          "uncaughtException",
          new Error(
            "Owned renderer resilience fatal Bearer owned-fixture-secret",
          ),
        );
      });
      await poll(
        async () =>
          ["saved", "failed"].includes(
            (await invoke(page, "app.info")).runtimeFailure?.persistence,
          ),
        "actual main/runtime quiesce",
        15000,
      );
      const stopped = (await invoke(page, "app.info")).runtimeFailure;
      assert.equal(stopped.persistence, "saved");
      assert.equal(stopped.reason.includes("owned-fixture-secret"), false);
      await poll(
        () =>
          nativeEvaluate(`!!document.querySelector('.runtime-stopped-banner')`),
        "persistent stopped banner",
      );
      assert.match(
        await nativeEvaluate(
          `document.querySelector('.runtime-stopped-banner').textContent`,
        ),
        /История сохранена/,
      );
      assert.equal(
        await nativeEvaluate(
          `!Array.from(document.querySelectorAll('.runtime-stopped-banner button')).find(b => b.textContent.includes('Перезапустить'))?.disabled`,
        ),
        true,
      );
      await contrastProof(
        ".runtime-stopped-banner button",
        "dark stopped restart",
      );
      assert.equal(
        await nativeEvaluate(
          `!!Array.from(document.querySelectorAll('.queue-editor button')).find(b => b.textContent.trim()==='Сохранить')?.disabled`,
        ),
        true,
      );
      assert.equal(
        await nativeEvaluate(
          `!!document.querySelector('.queue-area button[aria-label="Удалить из очереди"]')?.disabled`,
        ),
        true,
      );
      assert.equal(
        await nativeEvaluate(
          `Array.from(document.querySelectorAll('.runtime-session-error button')).some(b => b.textContent.includes('Восстановить сессию'))`,
        ),
        false,
      );
      await assert.rejects(
        () =>
          invoke(page, "session.send", {
            id: session.id,
            text: "MUST NOT DISPATCH",
          }),
        /stopp|останов/i,
      );
      const state = await readSession();
      assert.deepEqual(
        state.queue.map((item) => ({ id: item.id, text: item.text })),
        identity.queue,
      );
      assert.equal(
        (await events()).filter((item) => item.type === "prompt").length,
        1,
      );
      assert.equal(await draftValue(page), draftA);
      assert.equal(
        await nativeEvaluate(
          `document.querySelector('textarea[aria-label="Редактирование сообщения в очереди"]')?.value`,
        ),
        queueDraft,
      );
      await application.evaluate(
        ({ BrowserWindow }, id) =>
          BrowserWindow.fromId(id).webContents.reload(),
        info.windowId,
      );
      await poll(
        () =>
          nativeEvaluate(`!!document.querySelector('.runtime-stopped-banner')`),
        "stopped banner after reload",
      );
      assert.equal(await draftValue(page), draftA);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        await nativeEvaluate(
          `Array.from(document.querySelectorAll('.error-toast')).some(e => /Работа остановлена после сбоя|Runtime is stopped/i.test(e.textContent))`,
        ),
        false,
        "Stopped reload must not issue an automatic gated operation or a false error toast",
      );
      assert.equal(
        await nativeEvaluate(
          `document.querySelector('textarea[aria-label="Редактирование сообщения в очереди"]')?.value`,
        ),
        queueDraft,
      );
      assert.equal(
        (await events()).filter((item) => item.type === "prompt").length,
        1,
      );
      await nativeEvaluate(
        `document.querySelector('textarea[aria-label="Сообщение агенту"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`,
      );
      assert.equal(
        (await events()).filter((item) => item.type === "prompt").length,
        1,
      );
      await capture("runtime-stopped-dark-desktop.png");
      proofs.push({
        stage: "fatal stopped",
        persistence: stopped.persistence,
        promptCount: 1,
        queueRetained: true,
        draftRetained: true,
      });
    },
  );
} catch (error) {
  failure = {
    test: current,
    message: String(error.message).split(temp).join("<owned-temp>"),
  };
  process.exitCode = 1;
  try {
    proofs.push({
      stage: "native failure diagnostics",
      windows: await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          id: w.id,
          crashed: w.webContents.isCrashed(),
          destroyed: w.isDestroyed(),
          url: w.webContents.getURL().split("?")[0],
        })),
      ),
    });
    proofs.push({
      stage: "owned main diagnostic categories",
      categories: (
        await fs.readFile(path.join(dataDir, "logs/host.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .map((entry) => {
          let details;
          try {
            details = JSON.parse(entry.message);
          } catch {}
          return {
            kind: entry.kind,
            ...(entry.kind === "renderer-recovery" && details
              ? {
                  windowId: details.windowId,
                  allowed: details.allowed,
                  cause: {
                    reason: details.cause?.reason,
                    exitCode: details.cause?.exitCode,
                  },
                }
              : {}),
          };
        }),
    });
  } catch {}
  try {
    if (page) await capture(`failure-${process.platform}.png`);
  } catch {}
  console.error("FAIL " + current + ": " + failure.message);
} finally {
  try {
    if (application)
      await application.evaluate(({ ipcMain, BrowserWindow, dialog }) => {
        const harness = globalThis.__rendererResilience;
        if (harness) {
          harness.heldRead?.();
          ipcMain.removeHandler("workbench:invoke");
          ipcMain.handle("workbench:invoke", harness.original);
          const win = BrowserWindow.fromId(harness.windowId);
          if (win && !win.isDestroyed()) win.webContents.send = harness.send;
          delete globalThis.__rendererResilience;
        }
        globalThis.__cancelShutdownFixture?.release?.();
        delete globalThis.__cancelShutdownFixture;
        // Explicitly close the owned active fixture, never a user's process.
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
  } catch {}
  let timer;
  try {
    if (!application) throw new Error("Launch returned no application handle.");
    await Promise.race([
      application.close(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("owned close deadline")),
          8000,
        );
      }),
    ]);
    cleanup = { application: "closed" };
  } catch {
    application?.process().kill("SIGKILL");
    cleanup = {
      application: application
        ? "owned process termination requested; exit not independently confirmed"
        : "launch returned no handle; process exit not independently confirmed",
    };
    if (!failure) {
      failure = {
        test: "cleanup",
        message: "Owned app required forced close.",
      };
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(timer);
  }
  try {
    if (cleanup.application === "closed") {
      await fs.rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 150,
      });
      cleanup.ownedData = "removed";
    } else cleanup.ownedData = "retained: process exit unconfirmed";
  } catch {
    cleanup.ownedData = "remove failed";
    process.exitCode = 1;
  }
  const after = await hashes(),
    sourceDrift = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((key) => before[key] !== after[key]);
  if (sourceDrift.length) {
    failure ||= {
      test: "source guard",
      message: "Tested source/build changed during acceptance.",
    };
    process.exitCode = 1;
  }
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: failure ? "failed" : "passed",
        recordedAt: new Date().toISOString(),
        platform: process.platform,
        scope:
          "Actual App + deterministic owned ACP process; response-fault injection only in automation, actual native renderer crash and actual main fatal handler. No model intelligence, GigaCode or Windows claim.",
        passed,
        total: 8,
        failure,
        proofs,
        captures,
        rendererErrors: rendererErrors.map((message) => message.slice(0, 200)),
        sourceHashes: before,
        sourceDrift,
        cleanup,
        externalProviderCalls: 0,
        realModelCalls: 0,
      },
      null,
      2,
    ) + "\n",
  );
}
