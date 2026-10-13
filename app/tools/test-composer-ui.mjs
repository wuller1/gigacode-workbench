/** Real shipped React controls in isolated Electron; protocol ordering is tested separately. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright";
const require = createRequire(import.meta.url),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-composer-ui-")),
  source = (n) =>
    JSON.stringify(path.join(root, "src", n).replaceAll("\\", "/")),
  results = [];
let app;
try {
  await build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ModelPicker,ContextSend}from ${source("ModelPicker.tsx")};import{QueueMessages}from ${source("QueueMessages.tsx")};import{LayerProvider}from ${source("ui.tsx")};
function App(){const[model,M]=useState('fast'),[depth,D]=useState('medium'),[items,I]=useState([{id:'1',text:'First',createdAt:''},{id:'2',text:'Second',createdAt:''}]),[fill,F]=useState(.2),[context,C]=useState(false),[draft,S]=useState('Keep my draft');window.fixtureRemove=()=>I([]);window.fixtureFill=F;
const configs=[{id:'model',name:'Model',category:'model',currentValue:model,options:[{value:'fast',name:'Fast'},{value:'reason',name:'Mimo 2.6 Flash'}]},...(model==='reason'?[{id:'reasoning_effort',category:'thought_level',name:'Reasoning',currentValue:depth,options:[{value:'low',name:'Low'},{value:'medium',name:'High'}]}]:[])];
return <LayerProvider><section className="composer-region" style={{width:390,margin:20}}><QueueMessages items={items} sessionId="s" running unknown={false} invoke={async(method,p)=>{window.lastAction={method,...p};if(method==='queue.update')I(x=>x.map(i=>i.id===p.id?{...i,text:p.text}:i));if(method==='queue.delete')I(x=>x.filter(i=>i.id!==p.id));}} onRestore={S}/><div className="composer"><textarea aria-label="Draft" value={draft} onChange={e=>S(e.target.value)}/><div className="composer-toolbar"><button className="composer-branch">feature/long-branch</button><span className="composer-spacer"/><span className="composer-auto-profile"><span>Аналитик</span></span><ModelPicker configs={configs} model={model} reasoning={depth} disabled={false} onSelect={async(id,v)=>{await new Promise(r=>setTimeout(r,25));id==='model'?M(v):D(v);}} onSettings={()=>{}} onContext={()=>C(true)}/><ContextSend used={fill*256000} limit={256000} estimated busy={false} sending={false} disabled={false} onContext={()=>C(true)} onSend={()=>{}}/></div></div><span className="working-arc" id="activity"/><button id="outside">Outside</button>{context&&<p id="context">Context</p>}</section></LayerProvider>}createRoot(document.getElementById('root')).render(<App/>);`,
      loader: "tsx",
      resolveDir: root,
    },
    bundle: true,
    format: "iife",
    platform: "browser",
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
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
  );
  await fs.writeFile(
    path.join(temp, "main.cjs"),
    `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp, "userdata"))});app.whenReady().then(()=>{app.dock?.hide();const w=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((r,c)=>c({cancel:/^https?:/i.test(r.url)}));w.loadFile(${JSON.stringify(path.join(temp, "index.html"))});});`,
  );
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        k,
      )
    )
      delete env[k];
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(temp, "main.cjs")],
    env,
    timeout: 20000,
  });
  const p = await app.firstWindow();
  p.setDefaultTimeout(8000);
  const check = async (n, fn) => {
      await fn();
      results.push(n);
      console.log("PASS", n);
    },
    assert = async (c, m) => {
      if (!(await c)) throw Error(m);
    },
    trigger = () =>
      p.getByRole("button", { name: "Модель и рассуждение", exact: true });
  await check(
    "Advertised model/reasoning, draft and Escape focus",
    async () => {
      await trigger().click();
      await p
        .getByRole("button", { name: "Mimo 2.6 Flash", exact: true })
        .click();
      await p.getByRole("button", { name: "Low", exact: true }).click();
      await p.waitForFunction(
        () => document.querySelector(".model-depth")?.textContent === "Low",
      );
      await p.keyboard.press("Escape");
      await assert(
        p
          .getByRole("dialog")
          .count()
          .then((n) => n === 0),
        "Popover not closed",
      );
      await assert(
        p.evaluate(() =>
          document.activeElement.classList.contains("model-picker-trigger"),
        ),
        "Focus lost",
      );
      await assert(
        p.inputValue('[aria-label="Draft"]').then((v) => v === "Keep my draft"),
        "Draft changed",
      );
      await trigger().click();
      await p.getByRole("button", { name: "Fast", exact: true }).click();
      await p.waitForFunction(() => !document.querySelector(".model-depth"));
      await p.click("#outside");
    },
  );
  await check(
    "Narrow desktop composer does not clip reasoning or overflow",
    async () => {
      await trigger().click();
      await p
        .getByRole("button", { name: "Mimo 2.6 Flash", exact: true })
        .click();
      await p.getByRole("button", { name: "High", exact: true }).click();
      await p.keyboard.press("Escape");
      await assert(
        p.evaluate(() => {
          const t = document.querySelector(".composer-toolbar"),
            m = document.querySelector(".model-picker-trigger"),
            d = document.querySelector(".model-depth");
          return (
            t.scrollWidth <= t.clientWidth &&
            getComputedStyle(document.querySelector(".composer-branch"))
              .display === "none" &&
            d.getBoundingClientRect().right <= m.getBoundingClientRect().right
          );
        }),
        "Composer overflow",
      );
    },
  );
  await check(
    "Context ring changes color and opens independently",
    async () => {
      await p.evaluate(() => window.fixtureFill(0.98));
      await p.waitForFunction(() =>
        document
          .querySelector(".context-send svg circle:nth-child(2)")
          .getAttribute("stroke")
          .includes("danger"),
      );
      await p
        .locator(".context-send-ring")
        .click({ position: { x: 20, y: 1 } });
      await p.waitForSelector("#context");
    },
  );
  await check("Inline queue edit, immediate send and delete", async () => {
    await p
      .getByRole("button", { name: "Редактировать сообщение", exact: true })
      .first()
      .click();
    await p
      .getByRole("textbox", { name: "Редактирование сообщения в очереди" })
      .fill("Edited");
    await p.getByRole("button", { name: "Сохранить", exact: true }).click();
    await p.waitForFunction(() =>
      document.querySelector(".queue-row")?.textContent.includes("Edited"),
    );
    await p
      .getByRole("button", { name: "Отправить сейчас", exact: true })
      .first()
      .click();
    await p.waitForFunction(
      () =>
        window.lastAction?.method === "queue.sendNow" &&
        window.lastAction.id === "1",
    );
    await p
      .getByRole("button", { name: "Удалить из очереди", exact: true })
      .last()
      .click();
    await p.waitForFunction(
      () => document.querySelectorAll(".queue-row").length === 1,
    );
  });
  await check("Queue draft survives dispatch during editing", async () => {
    await p
      .getByRole("button", { name: "Редактировать сообщение", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "Редактирование сообщения в очереди" })
      .fill("Do not lose this");
    await p.evaluate(() => window.fixtureRemove());
    await p
      .getByRole("button", { name: "Вставить в поле ввода", exact: true })
      .click();
    await assert(
      p
        .inputValue('[aria-label="Draft"]')
        .then((v) => v === "Do not lose this"),
      "Edited draft lost",
    );
  });
  await check("Activity keeps moving with OS animations disabled", async () => {
    await p.emulateMedia({ reducedMotion: "reduce" });
    const before = await p
      .locator("#activity")
      .evaluate((el) => getComputedStyle(el).transform);
    await p.waitForFunction(
      (previous) =>
        getComputedStyle(document.querySelector("#activity")).transform !==
        previous,
      before,
    );
    await p.evaluate(
      () => (document.documentElement.dataset.motion = "reduced"),
    );
    await p.waitForTimeout(80);
    const paused = await p
      .locator("#activity")
      .evaluate((el) => getComputedStyle(el).transform);
    await p.waitForTimeout(120);
    await assert(
      p
        .locator("#activity")
        .evaluate(
          (el, previous) => getComputedStyle(el).transform === previous,
          paused,
        ),
      "Explicit app reduced-motion setting ignored",
    );
  });
  await p.screenshot({ path: path.join(temp, "composer.png") });
  console.log(
    JSON.stringify({ passed: results.length, results, evidence: temp }),
  );
} finally {
  await app?.close();
}
