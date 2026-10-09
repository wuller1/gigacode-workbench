/** Opt-in, offline Electron regression for the actual renderer Modal/Menu components. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-modal-ui-"),
);
const passed = [];
const total = 10;
let application;
let currentCase = "fixture startup";
let failure;

try {
  const componentPath = path
    .join(appDir, "src", "ui.tsx")
    .replaceAll("\\", "/");
  const fixture = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { LayerProvider, Modal, Menu } from ${JSON.stringify(componentPath)};
    function Fixture() {
      const [open, setOpen] = useState(false);
      const [nested, setNested] = useState(false);
      const [row, setRow] = useState(true);
      const [revision, setRevision] = useState(0);
      window.rerenderFixture = () => setRevision(value => value + 1);
      return <LayerProvider>
        <button id="launch" onClick={() => { setRow(true); setOpen(true); }}>Open archive</button>
        <button id="outside">Outside</button>
        <section role="dialog" id="question"><input id="question-answer" aria-label="Nonmodal answer" /></section>
        {open && <Modal title="Archive" onClose={() => setOpen(false)}>
          <span data-revision={revision} />
          {row ? <button id="restore" onClick={() => setRow(false)}>Restore row</button> : <p>Archive is empty</p>}
          <input id="draft" aria-label="Draft" />
          <Menu label="Actions" items={[{label:'Menu item',action:()=>{}}]} />
          <button id="nested" onClick={() => setNested(true)}>Nested</button>
          {nested && <Modal title="Confirm" onClose={() => setNested(false)}><button id="child">Child</button></Modal>}
        </Modal>}
      </LayerProvider>;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `;
  await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: appDir },
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile: path.join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  await fs.copyFile(
    path.join(appDir, "src", "styles.css"),
    path.join(temporary, "styles.css"),
  );
  await fs.writeFile(
    path.join(temporary, "index.html"),
    `<!doctype html>
    <html lang="en"><head><meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'" />
      <link rel="stylesheet" href="styles.css" />
    </head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
  );
  await fs.writeFile(
    path.join(temporary, "main.cjs"),
    `
    const { app, BrowserWindow } = require('electron');
    app.setName('Workbench Modal Regression');
    app.setPath('userData', ${JSON.stringify(path.join(temporary, "userdata"))});
    app.whenReady().then(() => {
      app.dock?.hide();
      const window = new BrowserWindow({show:false,width:900,height:700,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      window.webContents.session.webRequest.onBeforeRequest((request,callback) => callback({cancel:/^https?:/i.test(request.url)}));
      window.loadFile(${JSON.stringify(path.join(temporary, "index.html"))});
    });
  `,
  );
  // Never inherit provider credentials or user-supplied Node hooks into this fixture.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  }
  application = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(temporary, "main.cjs")],
    env,
    timeout: 20_000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(8_000);
  await page.waitForSelector("#launch");
  const modal = page.locator('[aria-modal="true"]');
  const insideModal = () =>
    page.evaluate(() =>
      document
        .querySelector('[aria-modal="true"]')
        .contains(document.activeElement),
    );
  const check = async (name, action) => {
    currentCase = name;
    await action();
    passed.push(name);
  };
  const assert = async (condition, message) => {
    if (!(await condition)) throw new Error(message);
  };

  await check("Restore removal recovers focus inside modal", async () => {
    await page.click("#launch");
    await page.click("#restore");
    await page.waitForSelector("#restore", { state: "detached" });
    await assert(
      insideModal(),
      "Focus escaped after the Restore button was removed.",
    );
  });
  await check("Escape closes modal even when focus falls to body", async () => {
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("Escape");
    await page.waitForSelector('[aria-modal="true"]', { state: "detached" });
  });
  await check("Closing restores launcher focus", async () => {
    await assert(
      page.evaluate(() => document.activeElement.id === "launch"),
      "Launcher did not regain focus.",
    );
  });
  await check("Nested modal opens", async () => {
    await page.click("#launch");
    await page.click("#nested");
    await assert(
      modal.count().then((count) => count === 2),
      "Expected two modal layers.",
    );
  });
  await check("Escape closes only the top modal", async () => {
    await page.keyboard.press("Escape");
    await assert(
      modal.count().then((count) => count === 1),
      "Escape closed the wrong number of modal layers.",
    );
  });
  await check("Menu Escape leaves its owning modal open", async () => {
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await page.waitForSelector('[role="menu"]');
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="menu"]', { state: "detached" });
    await assert(
      modal.count().then((count) => count === 1),
      "Menu Escape also closed its modal.",
    );
  });
  await check("Focus outside modal is recovered", async () => {
    await page.evaluate(() => document.querySelector("#outside").focus());
    await assert(insideModal(), "Focus stayed outside the modal.");
  });
  await check("Tab recovers body focus", async () => {
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("Tab");
    await assert(
      insideModal(),
      "Tab failed to recover focus inside the modal.",
    );
  });
  await check(
    "New callback identity preserves input focus and draft",
    async () => {
      await page.fill("#draft", "keep this draft");
      const before = await page
        .locator("[data-revision]")
        .getAttribute("data-revision");
      await page.evaluate(() => window.rerenderFixture());
      await page.waitForFunction(
        (previous) =>
          document.querySelector("[data-revision]").dataset.revision !==
          previous,
        before,
      );
      await assert(
        page.evaluate(
          () =>
            document.activeElement.id === "draft" &&
            document.querySelector("#draft").value === "keep this draft",
        ),
        "Rerender reset focus or draft.",
      );
    },
  );
  await check(
    "Nonmodal question is not captured by modal registry",
    async () => {
      await page.keyboard.press("Escape");
      await page.waitForSelector('[aria-modal="true"]', { state: "detached" });
      await page.focus("#question-answer");
      await page.keyboard.press("Escape");
      await assert(
        page.evaluate(
          () =>
            document.activeElement.id === "question-answer" &&
            !!document.querySelector("#question"),
        ),
        "Nonmodal question was hijacked.",
      );
    },
  );
} catch (error) {
  failure = {
    test: currentCase,
    message: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
} finally {
  try {
    await application?.close();
  } catch (error) {
    failure ||= { test: "fixture cleanup", message: String(error) };
    process.exitCode = 1;
  }
  try {
    await fs.rm(temporary, { recursive: true, force: true });
  } catch (error) {
    failure ||= { test: "temporary directory cleanup", message: String(error) };
    process.exitCode = 1;
  }
}
console.log(
  JSON.stringify(
    {
      suite: "offline-modal-ui",
      environment:
        "hidden Electron; real ui.tsx and styles.css; isolated userData; no CLI/provider",
      status: failure ? "failed" : "passed",
      total,
      passed: passed.length,
      cases: passed,
      ...(failure ? { failure } : {}),
    },
    null,
    2,
  ),
);
