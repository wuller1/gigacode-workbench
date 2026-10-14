/** Offline Electron: actual SettingsView + actual AtomicStore/WorkbenchService over IPC. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-settings-ui-"));
const component =
  process.argv.find((a) => a.startsWith("--component="))?.slice(12) ||
  path.join(root, "src/SettingsView.tsx");
const only = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
const passed = [];
let application,
  current = "fixture startup",
  failure;
const bounded = (promise, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture operation timed out")),
      timeout,
    );
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
try {
  await fs.mkdir(path.join(temp, "bundle/profiles"), { recursive: true });
  await fs.writeFile(
    path.join(temp, "bundle/CORE.md"),
    "Preserve observed facts.",
  );
  await build({
    entryPoints: [path.join(root, "electron/service.ts")],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    outfile: path.join(temp, "service.cjs"),
    logLevel: "silent",
  });
  await build({
    stdin: {
      loader: "tsx",
      resolveDir: root,
      contents: `
      import React,{useCallback,useEffect,useState} from 'react';
      import{createRoot}from'react-dom/client';
      import{SettingsView}from ${JSON.stringify(component.replaceAll("\\", "/"))};
      import{DialogProvider,LayerProvider}from ${JSON.stringify(path.join(root, "src/ui.tsx").replaceAll("\\", "/"))};
      function Fixture(){const[state,S]=useState(),[error,E]=useState('');
        useEffect(()=>{let alive=true;const refresh=()=>window.fixture.invoke('state.get').then(s=>{if(alive)S(s)});void refresh();const unsub=window.fixture.subscribe(refresh);return()=>{alive=false;unsub()}},[]);
        const run=useCallback(async(method,params)=>{try{return await window.fixture.invoke(method,params)}catch(e){E(String(e));return undefined}},[]);
        return <LayerProvider><DialogProvider>{state&&<SettingsView state={state} run={run} onClose={()=>{}} onAssist={()=>{}}/>}<output id="fixture-error">{error}</output></DialogProvider></LayerProvider>
      }createRoot(document.getElementById('root')).render(<Fixture/>);`,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(temp, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  await fs.copyFile(
    path.join(root, "src/styles.css"),
    path.join(temp, "styles.css"),
  );
  await fs.cp(path.join(root, "public/icons"), path.join(temp, "icons"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(temp, "index.html"),
    "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'\"><link rel=\"stylesheet\" href=\"styles.css\"></head><body><div id=\"root\"></div><script src=\"fixture.js\"></script></body></html>",
  );
  await fs.writeFile(
    path.join(temp, "preload.cjs"),
    `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{invoke:(m,p)=>ipcRenderer.invoke('fixture',m,p),subscribe:(fn)=>{const listener=()=>fn();ipcRenderer.on('changed',listener);return()=>ipcRenderer.removeListener('changed',listener)}});`,
  );
  await fs.writeFile(
    path.join(temp, "main.cjs"),
    `
    const{app,BrowserWindow,ipcMain}=require('electron');
    const{WorkbenchService}=require(${JSON.stringify(path.join(temp, "service.cjs"))});
    app.setName('Workbench Settings Regression');app.setPath('userData',${JSON.stringify(path.join(temp, "userdata"))});
    let win,service,holdNext=false,pendingAck,release,pauseSnapshots=false;const calls=[];
    app.whenReady().then(async()=>{
      app.dock?.hide();service=new WorkbenchService({dataDir:${JSON.stringify(path.join(temp, "data"))},bundleDir:${JSON.stringify(path.join(temp, "bundle"))},emit:()=>{if(!pauseSnapshots&&win&&!win.isDestroyed())win.webContents.send('changed')}});await service.init();
      ipcMain.handle('fixture',async(_,method,params)=>{
        if(method==='fixture.deferAck'){holdNext=true;return true}
        if(method==='fixture.ackPending')return !!pendingAck;
        if(method==='fixture.releaseAck'){release?.();return true}
        if(method==='fixture.pauseSnapshots'){pauseSnapshots=params.pause;if(!pauseSnapshots)win.webContents.send('changed');return true}
        if(method==='fixture.calls')return calls;
        if(method==='fixture.remoteSettings')return service.invoke('settings.update',{patch:params});
        if(method==='fixture.append')return service.invoke('memory.remember',{scope:'global',statement:params.text,evidence:'Another actual session recorded this fact.'});
        if(method==='fixture.dispose'){await service.dispose();return true}
        calls.push({method,params});const result=await service.invoke(method,params);
        if(method==='settings.update'&&holdNext){holdNext=false;pendingAck=new Promise(r=>release=r);await pendingAck;pendingAck=undefined;release=undefined}
        return result;
      });
      win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{preload:${JSON.stringify(path.join(temp, "preload.cjs"))},nodeIntegration:false,contextIsolation:true,sandbox:true}});
      win.webContents.session.webRequest.onBeforeRequest((request,callback)=>callback({cancel:/^https?:/i.test(request.url)}));
      await win.loadFile(${JSON.stringify(path.join(temp, "index.html"))});
    });`,
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(temp, "main.cjs")],
    env,
    timeout: 20000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(8000);
  await page
    .getByRole("heading", { name: "Внешний вид", exact: true })
    .waitFor();
  const invoke = (method, params) =>
    page.evaluate(
      ({ method, params }) => window.fixture.invoke(method, params),
      { method, params },
    );
  const check = async (name, fn) => {
    if (only && only !== name) return;
    current = name;
    await fn();
    passed.push(name);
  };
  const settings = () => invoke("state.get").then((s) => s.settings);
  const footerSave = () =>
    page
      .locator(".settings-footer")
      .getByRole("button", { name: "Сохранить", exact: true });
  const selectSection = (name) =>
    page
      .locator(".settings-nav")
      .getByRole("button", { name, exact: true })
      .click();

  await check("settings-rebase", async () => {
    await invoke("fixture.remoteSettings", { theme: "light" });
    await selectSection("Выполнение");
    await page.getByLabel("Одновременно активных сессий").fill("3");
    await footerSave().click();
    await footerSave().waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const button = document.querySelector(".settings-footer button.primary");
      return button.disabled && button.getAttribute("aria-busy") !== "true";
    });
    assert.equal(
      (await settings()).theme,
      "light",
      "An unrelated concurrent theme change was overwritten",
    );
    const calls = await invoke("fixture.calls");
    assert.deepEqual(
      calls.filter((c) => c.method === "settings.update").at(-1).params.patch,
      { maxConcurrent: 3 },
    );
    await selectSection("Внешний вид");
    assert.equal(await page.getByLabel("Тема").inputValue(), "light");
  });
  await check("settings-dirty-rebase", async () => {
    await selectSection("Внешний вид");
    await page.getByLabel("Тема").selectOption("dark");
    await invoke("fixture.remoteSettings", { reducedMotion: true });
    await page.waitForFunction(
      () =>
        document.querySelector(".settings-body input[type=checkbox]").checked,
    );
    assert.equal(
      await page.getByLabel("Тема").inputValue(),
      "dark",
      "The local theme draft was erased by a snapshot",
    );
    await footerSave().click();
    await page.waitForFunction(() => {
      const button = document.querySelector(".settings-footer button.primary");
      return button.disabled && button.getAttribute("aria-busy") !== "true";
    });
    assert.equal((await settings()).reducedMotion, true);
    const calls = await invoke("fixture.calls");
    assert.deepEqual(
      calls.filter((c) => c.method === "settings.update").at(-1).params.patch,
      { theme: "dark" },
    );
  });
  await check("settings-pending-ack", async () => {
    await selectSection("Выполнение");
    const input = page.getByLabel("Одновременно активных сессий");
    await input.fill((await settings()).maxConcurrent === 2 ? "3" : "2");
    await invoke("fixture.deferAck");
    await footerSave().click();
    current = "settings-pending-ack: receipt pending";
    await bounded(
      page.evaluate(async () => {
        while (!(await window.fixture.invoke("fixture.ackPending")))
          await new Promise((resolve) => setTimeout(resolve, 20));
      }),
    );
    await input.fill("4");
    await invoke("fixture.releaseAck");
    current = "settings-pending-ack: newer draft remains editable";
    await page.waitForFunction(() => {
      const button = document.querySelector(".settings-footer button.primary");
      return !button.disabled && button.getAttribute("aria-busy") !== "true";
    });
    assert.equal(
      await input.inputValue(),
      "4",
      "The stale save acknowledgement erased newer typing",
    );
    await footerSave().click();
    await page.waitForFunction(() => {
      const button = document.querySelector(".settings-footer button.primary");
      return button.disabled && button.getAttribute("aria-busy") !== "true";
    });
    assert.equal((await settings()).maxConcurrent, 4);
  });
  await check("settings-revert-during-save", async () => {
    await selectSection("Выполнение");
    const input = page.getByLabel("Одновременно активных сессий");
    const original = await input.inputValue();
    await input.fill(original === "2" ? "3" : "2");
    await invoke("fixture.pauseSnapshots", { pause: true });
    await invoke("fixture.deferAck");
    await footerSave().click();
    await bounded(
      page.evaluate(async () => {
        while (!(await window.fixture.invoke("fixture.ackPending")))
          await new Promise((resolve) => setTimeout(resolve, 20));
      }),
    );
    await input.fill(original);
    await invoke("fixture.releaseAck");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".settings-footer button.primary")
          .getAttribute("aria-busy") !== "true",
    );
    await invoke("fixture.pauseSnapshots", { pause: false });
    await page.waitForFunction(
      () => !document.querySelector(".settings-footer button.primary").disabled,
    );
    assert.equal(
      await input.inputValue(),
      original,
      "A delayed snapshot erased the intentional revert typed during save",
    );
    await footerSave().click();
    await page.waitForFunction(() => {
      const b = document.querySelector(".settings-footer button.primary");
      return b.disabled && b.getAttribute("aria-busy") !== "true";
    });
    assert.equal((await settings()).maxConcurrent, Number(original));
  });
  await check("memory-conflict", async () => {
    await selectSection("Память");
    const editor = page.getByRole("textbox", { name: "Память", exact: true });
    await page.waitForFunction(
      () => !document.querySelector(".memory-editor").disabled,
    );
    await editor.fill("Unsaved user draft.");
    await invoke("fixture.append", { text: "Concurrent note must survive." });
    await page
      .getByRole("button", { name: "Сохранить память", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector("#fixture-error")
        .textContent.includes("MEMORY_CONFLICT"),
    );
    assert.equal(
      await editor.inputValue(),
      "Unsaved user draft.",
      "Conflict erased the editor draft",
    );
    const actual = await invoke("memory.read");
    assert.match(actual.text, /Concurrent note must survive/);
    assert.doesNotMatch(actual.text, /Unsaved user draft/);
  });
  await check("memory-explicit-reload", async () => {
    await selectSection("Память");
    await page
      .getByRole("button", { name: "Перечитать память", exact: true })
      .click();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Память", exact: true })
        .inputValue(),
      "Unsaved user draft.",
    );
    await page
      .getByRole("button", { name: "Перечитать память", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    const editor = page.getByRole("textbox", { name: "Память", exact: true });
    await page.waitForFunction(() =>
      document
        .querySelector(".memory-editor")
        .value.includes("Concurrent note must survive"),
    );
    const merged = (await editor.inputValue()) + "\nMerged user draft.";
    await editor.fill(merged);
    await page
      .getByRole("button", { name: "Сохранить память", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "Сохранить память",
        ).disabled && !document.querySelector(".memory-editor").disabled,
    );
    assert.equal((await invoke("memory.read")).text, merged);
  });
  await check("settings-arguments-rebase", async () => {
    await selectSection("CLI и модели");
    const argumentsEditor = page.getByLabel(
      "Аргументы запуска · JSON-массив строк",
    );
    await argumentsEditor.fill('["--acp", "--custom"]');
    await invoke("fixture.remoteSettings", { cliPath: "updated-cli.mjs" });
    await footerSave().click();
    await page.waitForFunction(() => {
      const button = document.querySelector(".settings-footer button.primary");
      return button.disabled && button.getAttribute("aria-busy") !== "true";
    });
    assert.equal((await settings()).cliPath, "updated-cli.mjs");
    assert.deepEqual((await settings()).cliArgs, ["--acp", "--custom"]);
    const calls = await invoke("fixture.calls");
    assert.deepEqual(
      calls.filter((c) => c.method === "settings.update").at(-1).params.patch,
      { cliArgs: ["--acp", "--custom"] },
    );
  });
  if (only && !passed.length) throw new Error("Unknown --case: " + only);
  await bounded(invoke("fixture.dispose"));
} catch (error) {
  failure = {
    test: current,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  if (application) {
    try {
      const page = await bounded(application.firstWindow(), 2000);
      failure.fixture = await bounded(
        page.evaluate(async () => ({
          settings: (await window.fixture.invoke("state.get")).settings,
          ackPending: await window.fixture.invoke("fixture.ackPending"),
          inputs: [...document.querySelectorAll("input,textarea")].map((e) => ({
            value: e.value,
            disabled: e.disabled,
          })),
          footer: document.querySelector(".settings-footer")?.textContent,
          error: document.querySelector("#fixture-error")?.textContent,
        })),
        3000,
      );
    } catch (diagnosticError) {
      failure.diagnosticError = String(diagnosticError);
    }
  }
  process.exitCode = 1;
} finally {
  try {
    await bounded(application?.close());
  } catch (error) {
    failure ||= { test: "owned fixture cleanup", message: String(error) };
    process.exitCode = 1;
    try {
      application?.process().kill("SIGKILL");
    } catch {}
  }
  try {
    await fs.rm(temp, { recursive: true, force: true });
  } catch (error) {
    failure ||= { test: "temporary cleanup", message: String(error) };
    process.exitCode = 1;
  }
}
console.log(
  JSON.stringify(
    {
      suite: "offline-settings-ui",
      environment:
        "isolated hidden Electron; actual SettingsView and WorkbenchService/AtomicStore; no provider or corporate connection",
      status: failure ? "failed" : "passed",
      passed: passed.length,
      cases: passed,
      ...(failure ? { failure } : {}),
    },
    null,
    2,
  ),
);
