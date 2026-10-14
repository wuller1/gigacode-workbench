/** Offline actual Electron + production React + shipped ToolBoundary. No CLI,
 * provider, remote credentials or workspaces; faults are intentionally injected. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright";

const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-panel-boundary-"),
);
const source =
  process.argv.find((a) => a.startsWith("--component="))?.slice(12) ||
  path.join(root, "src/ToolBoundary.tsx");
const passed = [],
  total = 6;
let application,
  current = "fixture startup",
  failure;
const bounded = async (promise, timeout = 8000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Fixture operation timed out")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
try {
  await build({
    stdin: {
      loader: "tsx",
      resolveDir: root,
      contents: `
    import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ToolBoundary}from ${JSON.stringify(source.replaceAll("\\", "/"))};
    import{ErrorBoundary}from ${JSON.stringify(path.join(root, "src/ErrorBoundary.tsx").replaceAll("\\", "/"))};
    window.fixtureBoot=crypto.randomUUID();window.fixtureMounts=0;window.fixtureCrash=false;
    function Healthy(){const[draft,D]=useState(''),[count,C]=useState(0),[ticks,T]=useState(0),[mount]=useState(()=>++window.fixtureMounts);
      useEffect(()=>{const timer=setInterval(()=>T(n=>n+1),40);return()=>clearInterval(timer)},[]);
      return <div id="healthy" data-mount={mount}><h2>Рабочая панель</h2><textarea aria-label="Черновик соседней панели" value={draft} onChange={e=>D(e.target.value)}/><button id="counter" onClick={()=>C(n=>n+1)}>Счётчик</button><output id="count">{count}</output><output id="ticks">{ticks}</output></div>}
    function Faulty(){const[revision,R]=useState(0),[mount]=useState(()=>++window.fixtureMounts),[draft,D]=useState('');
      if(window.fixtureCrash)throw new Error('Synthetic tool render fault Authorization: Bearer PANEL_DIAGNOSTIC_CANARY '+('x'.repeat(8000)));
      return <div id="faulty" data-mount={mount}><h2>Тестовый инструмент</h2><textarea aria-label="Локальный черновик" value={draft} onChange={e=>D(e.target.value)}/><button id="explicit-write" onClick={()=>window.fixture.invoke('explicit.save',{text:draft})}>Сохранить явно</button><button id="crash" onClick={()=>{window.fixtureCrash=true;R(n=>n+1)}}>Вызвать ошибку</button><output>{revision}</output></div>}
    function Fixture(){return <ErrorBoundary><main style={{display:'grid',gridTemplateColumns:'1fr 1fr',height:'100%',gap:16,padding:20}}><section id="fault-owner" style={{minWidth:0,border:'1px solid var(--line)'}}><ToolBoundary title="Jenkins"><Faulty/></ToolBoundary></section><section style={{minWidth:0,border:'1px solid var(--line)',padding:16}}><ToolBoundary title="Заметки"><Healthy/></ToolBoundary><button id="repair" onClick={()=>window.fixtureCrash=false}>Устранить причину</button></section></main></ErrorBoundary>}
    createRoot(document.getElementById('root'),{onCaughtError:()=>{}}).render(<Fixture/>);`,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    outfile: path.join(temp, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  await fs.copyFile(
    path.join(root, "src/styles.css"),
    path.join(temp, "styles.css"),
  );
  await fs.writeFile(
    path.join(temp, "index.html"),
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
  );
  await fs.writeFile(
    path.join(temp, "preload.cjs"),
    "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{invoke:(method,params)=>ipcRenderer.invoke('fixture',method,params)});",
  );
  await fs.writeFile(
    path.join(temp, "main.cjs"),
    `
    const{app,BrowserWindow,ipcMain}=require('electron');app.setName('Workbench Panel Boundary Regression');app.setPath('userData',${JSON.stringify(path.join(temp, "userdata"))});
    let loads=0;const writes=[],errors=[];
    ipcMain.handle('fixture',(_,method,params)=>{if(method==='fixture.inspect')return{loads,writes,errors};if(method==='explicit.save'){writes.push(params);return{saved:true}}throw new Error('Unexpected host operation: '+method)});
    app.whenReady().then(()=>{app.dock?.hide();const w=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{preload:${JSON.stringify(path.join(temp, "preload.cjs"))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      w.webContents.on('did-finish-load',()=>loads++);w.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message)});
      w.webContents.session.webRequest.onBeforeRequest((request,callback)=>callback({cancel:/^https?:/i.test(request.url)}));w.loadFile(${JSON.stringify(path.join(temp, "index.html"))});});`,
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
  await page.locator("#healthy").waitFor();
  const inspect = () =>
    page.evaluate(() => window.fixture.invoke("fixture.inspect"));
  const check = async (name, fn) => {
    current = name;
    await fn();
    passed.push(name);
  };
  let healthyMount, faultyMount, boot, ticksBefore;
  await check(
    "Baseline draft, counter and explicit write are observable",
    async () => {
      await page
        .getByLabel("Черновик соседней панели")
        .fill("Сохранить соседний черновик без перезагрузки");
      await page.locator("#counter").click();
      await page.locator("#counter").click();
      await page
        .getByLabel("Локальный черновик")
        .fill("Только одна явная запись");
      await page.locator("#explicit-write").click();
      await page.waitForFunction(
        () => Number(document.getElementById("ticks").textContent) > 0,
      );
      healthyMount = await page.locator("#healthy").getAttribute("data-mount");
      faultyMount = await page.locator("#faulty").getAttribute("data-mount");
      boot = await page.evaluate(() => window.fixtureBoot);
      assert.deepEqual((await inspect()).writes, [
        { text: "Только одна явная запись" },
      ]);
    },
  );
  await check(
    "One panel's render error does not replace the application or its sibling",
    async () => {
      ticksBefore = Number(await page.locator("#ticks").textContent());
      await page.locator("#crash").click();
      await page
        .getByRole("alert", { name: "Ошибка панели «Jenkins»" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("heading", {
            name: "Не удалось отобразить рабочее пространство",
            exact: true,
          })
          .count(),
        0,
      );
      assert.equal(
        await page.locator("#healthy").getAttribute("data-mount"),
        healthyMount,
      );
      assert.equal(
        await page.getByLabel("Черновик соседней панели").inputValue(),
        "Сохранить соседний черновик без перезагрузки",
      );
      assert.equal(await page.locator("#count").textContent(), "2");
      await page.waitForFunction(
        (before) =>
          Number(document.getElementById("ticks").textContent) > before,
        ticksBefore,
      );
    },
  );
  await check(
    "The local diagnostic is bounded and does not expose the injected bearer value",
    async () => {
      const errors = (await inspect()).errors.filter((message) =>
        message.startsWith("[tool-panel-failed] "),
      );
      assert.ok(errors.length >= 1);
      for (const message of errors) {
        assert.ok(message.length <= 2200);
        assert.ok(!message.includes("PANEL_DIAGNOSTIC_CANARY"));
      }
      assert.equal(
        await page
          .locator("#fault-owner")
          .getByText("PANEL_DIAGNOSTIC_CANARY", { exact: false })
          .count(),
        0,
      );
    },
  );
  await check(
    "Retry with an unresolved cause stays local and does not repeat host writes",
    async () => {
      await page
        .getByRole("button", {
          name: "Повторить открытие панели «Jenkins»",
          exact: true,
        })
        .click();
      await page
        .getByRole("alert", { name: "Ошибка панели «Jenkins»" })
        .waitFor();
      assert.equal(
        await page.locator("#healthy").getAttribute("data-mount"),
        healthyMount,
      );
      assert.deepEqual((await inspect()).writes, [
        { text: "Только одна явная запись" },
      ]);
    },
  );
  await check(
    "After repair, keyboard retry remounts only the failed child",
    async () => {
      await page.locator("#repair").click();
      await page
        .getByRole("button", {
          name: "Повторить открытие панели «Jenkins»",
          exact: true,
        })
        .focus();
      await page.keyboard.press("Enter");
      await page.locator("#faulty").waitFor();
      assert.notEqual(
        await page.locator("#faulty").getAttribute("data-mount"),
        faultyMount,
      );
      assert.equal(
        await page.locator("#healthy").getAttribute("data-mount"),
        healthyMount,
      );
      assert.equal(
        await page.getByLabel("Черновик соседней панели").inputValue(),
        "Сохранить соседний черновик без перезагрузки",
      );
      assert.equal(await page.locator("#count").textContent(), "2");
      await page.locator("#counter").click();
      assert.equal(await page.locator("#count").textContent(), "3");
    },
  );
  await check(
    "Recovery does not reload the document or replay the explicit save",
    async () => {
      assert.equal(await page.evaluate(() => window.fixtureBoot), boot);
      const state = await inspect();
      assert.equal(state.loads, 1);
      assert.deepEqual(state.writes, [{ text: "Только одна явная запись" }]);
    },
  );
} catch (error) {
  failure = {
    test: current,
    message: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
} finally {
  try {
    if (application) await bounded(application.close());
  } catch (error) {
    failure ||= { test: "fixture cleanup", message: String(error) };
    process.exitCode = 1;
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
      suite: "offline-panel-boundary-ui",
      environment:
        "actual isolated Electron; production React and shipped ToolBoundary; fixture child fault; no CLI/provider/network",
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
