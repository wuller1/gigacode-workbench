/** Actual Electron + development React StrictMode. Controlled IPC fixtures, no remote Ops claims. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { _electron } from "playwright";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-ops-review-ui-"),
);
const override = process.argv.find((a) => a.startsWith("--source="))?.slice(9);
const reviewOnly = process.argv.includes("--review-only");
const only = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
const clusterOverride = process.argv
  .find((a) => a.startsWith("--cluster-source="))
  ?.slice(17);
const passed = [];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      "src/ops-ui.tsx",
      "src/ClusterPanel.tsx",
      "src/JenkinsPanel.tsx",
      "src/window-close.ts",
      "tools/test-operations-review-ui.mjs",
    ].map(async (file) => [
      file,
      createHash("sha256")
        .update(
          await fs.readFile(
            file === "src/ops-ui.tsx" && override
              ? override
              : file === "src/ClusterPanel.tsx" && clusterOverride
                ? clusterOverride
                : path.join(root, file),
          ),
        )
        .digest("hex"),
    ]),
  ),
);
let draftWindows, draftStorageKey;
let application,
  current = "startup",
  failure;
const until = async (fn, message) => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
};
try {
  await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
 import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
 import{OpsActionReview,stripJenkinsConsoleText}from'./src/ops-ui';import{ClusterPanel}from'./src/ClusterPanel';import{JenkinsPanel}from'./src/JenkinsPanel';
 import{prepareWindowClose}from'./src/window-close';import{DialogProvider,LayerProvider}from'./src/ui';
 window.workbench=window.fixture;window.fixtureClose=prepareWindowClose;window.fixtureConsole=chunks=>{const state={pending:'',hidden:false};const text=chunks.map(chunk=>stripJenkinsConsoleText(chunk,state)).join('');return{text,state};};
 function Fixture(){const[name,N]=useState('A'),[shown,S]=useState(true),[mode,M]=useState('review');
 useEffect(()=>window.fixture.subscribe(event=>{if(event.type==='fixture.render'){N(event.payload.name||'A');S(event.payload.show!==false);M(event.payload.mode||'review');}}),[]);
 const request={id:name,projectId:'p',connectionId:'c',expectedTargetHash:'target',expectedAuthGeneration:0,operation:'cluster.apply',input:{name,resource:'configmaps',version:'v1',namespace:'test',manifest:{apiVersion:'v1',kind:'ConfigMap',metadata:{name,namespace:'test'}}},title:'Операция '+name,target:'Контроллер / '+name};
 return <LayerProvider><DialogProvider>{mode.startsWith('cluster')?<ClusterPanel key={mode} projectId={mode==='cluster-no-project'?undefined:'p'}/>:mode.startsWith('jenkins')?<JenkinsPanel key={mode} projectId={mode==='jenkins-no-project'?undefined:'p'}/>:shown&&<OpsActionReview key={name} request={request} onClose={()=>S(false)} onExecuted={value=>void window.fixture.invoke('fixture.delivered',{name,status:value.status,id:value.id})}/>}</DialogProvider></LayerProvider>}
 createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
 `,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(temp, "fixture.js"),
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
    plugins:
      override || clusterOverride
        ? [
            {
              name: "prior-source",
              setup(builder) {
                builder.onLoad(
                  { filter: /[\\/](ops-ui|ClusterPanel)\.tsx$/ },
                  async (args) => {
                    const source = args.path.endsWith("ClusterPanel.tsx")
                      ? clusterOverride
                      : override;
                    if (!source) return undefined;
                    return {
                      contents: await fs.readFile(source, "utf8"),
                      loader: "tsx",
                      resolveDir: path.dirname(args.path),
                    };
                  },
                );
              },
            },
          ]
        : [],
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
    `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;connect-src 'none';object-src 'none'"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{width:100%;height:100%;margin:0}.ops-panel{height:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`,
  );
  await fs.writeFile(
    path.join(temp, "preload.cjs"),
    `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{invoke:(method,params)=>ipcRenderer.invoke('fixture',method,params),subscribe:fn=>{const listener=(_,event)=>fn(event);ipcRenderer.on('fixture-event',listener);return()=>ipcRenderer.removeListener('fixture-event',listener)}});`,
  );
  await fs.writeFile(
    path.join(temp, "main.cjs"),
    `
 const{app,BrowserWindow,ipcMain}=require('electron');app.setName('Ops Review Regression');app.setPath('userData',${JSON.stringify(path.join(temp, "userdata"))});
 const windows=[],calls=[],delivered=[],held=[];let hold=true,failPrepare=false,unknownExecute=false,connectionMode='cluster';const prepared=new Map();const receipts=[];
 const connection={id:'c',revision:1,kind:'kubernetes',name:'Test cluster',environment:'Local',enabled:true,projectIds:['p'],transport:'builtin',credentialConfigured:false,targetHash:'target',authGeneration:0,discovered:{server:{name:'Fixture'},schemaHash:'schema',tools:[],capabilities:['cluster.discovery','cluster.namespaces','cluster.list','cluster.get','cluster.apply','cluster.events'],observedAt:new Date().toISOString()}};
 const object={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'test',uid:'uid-1',resourceVersion:'10'},data:{value:'original'}};
 const emit=(type,payload)=>windows.forEach(win=>{if(!win.isDestroyed())win.webContents.send('fixture-event',{type,payload})});
 async function open(){const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{preload:${JSON.stringify(path.join(temp, "preload.cjs"))},contextIsolation:true,nodeIntegration:false,sandbox:true}});windows.push(win);await win.loadFile(${JSON.stringify(path.join(temp, "index.html"))});return win;}
 app.whenReady().then(async()=>{app.dock?.hide();ipcMain.handle('fixture',async(event,method,params={})=>{
 if(method==='fixture.inspect')return{calls,delivered,held:held.length};
 if(method==='fixture.hold'){hold=params.enabled;return true}
 if(method==='fixture.failPrepare'){failPrepare=true;return true}
 if(method==='fixture.unknown'){unknownExecute=true;return true}
 if(method==='fixture.release'){for(const resolve of held.splice(0))resolve();return true}
 if(method==='fixture.render'){event.sender.send('fixture-event',{type:'fixture.render',payload:params});return true}
 if(method==='fixture.connections'){connectionMode=params.mode;emit('ops.changed',{projectId:'p'});return true}
 if(method==='fixture.window'){await open();return true}
 if(method==='fixture.delivered'){delivered.push(params);return true}
 if(method==='fixture.confirm'){for(const receipt of receipts){receipt.status='confirmed';receipt.updatedAt=new Date().toISOString();receipt.data={metadata:{name:receipt.input.name,namespace:'test',uid:'new-uid',resourceVersion:'11'}};}emit('ops.changed',{projectId:'p'});return true}
 calls.push({method,params});
 if(method==='ops.snapshot')return{connections:connectionMode==='empty'?[]:connectionMode==='cluster'?[connection,{...connection,id:'d',name:'Second cluster',targetHash:'target-d'}]:[{...connection,kind:'jenkins',projectIds:connectionMode==='unassigned'?['other']:['p'],enabled:connectionMode!=='disabled',discovered:undefined}],prepared:[],receipts,favorites:[]};
 if(method==='ops.prepare'){
 if(hold)await new Promise(resolve=>held.push(resolve));
 if(failPrepare){failPrepare=false;throw new Error('OPS_ERROR:'+JSON.stringify({kind:'offline',message:'Controlled prepare failure',outcome:'notApplied'}));}
 const value={...params,id:'prepared-'+params.operationId,summary:'Проверенная '+params.input.name,preview:{target:params.input.name},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),schemaHash:'schema',targetHash:'target',authGeneration:0};prepared.set(value.id,value);return value;
 }
 if(method==='ops.execute'){const p=prepared.get(params.preparedActionId);const receipt={...p,id:'receipt-'+p.id,preparedActionId:p.id,requestHash:'request',status:unknownExecute?'unknown':'accepted',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),data:{metadata:{name:p.input.name,uid:'new-uid',resourceVersion:'11'}}};receipts.push(receipt);emit('ops.changed',{projectId:'p'});if(unknownExecute){unknownExecute=false;throw new Error('OPS_ERROR:'+JSON.stringify({kind:'timeout',message:'Controlled unknown outcome',outcome:'unknown'}));}return receipt;}
 if(method==='ops.query'){
 switch(params.operation){case'cluster.discovery':return{data:{resources:[{group:'',version:'v1',resource:'configmaps',kind:'ConfigMap',namespaced:true,verbs:['get','list','create','patch']},{group:'',version:'v1',resource:'namespaces',kind:'Namespace',namespaced:false,verbs:['get','list','create','patch']}],version:'fixture'},observedAt:new Date().toISOString(),warnings:[]};
 case'cluster.namespaces':return{data:{items:[{metadata:{name:'test'}}]},observedAt:new Date().toISOString(),warnings:[]};
 case'cluster.list':return{data:{items:[object,...['settings2','settings3','settings4'].map(name=>({...object,metadata:{...object.metadata,name,uid:'uid-'+name}}))],metadata:{resourceVersion:'10'}},observedAt:new Date().toISOString(),warnings:[]};
 case'cluster.get':return{data:{...object,metadata:{...object.metadata,name:params.input.name,uid:params.input.name==='settings'?'uid-1':'uid-'+params.input.name}},observedAt:new Date().toISOString(),warnings:[]};
 case'cluster.events':return{data:{items:[]},observedAt:new Date().toISOString(),warnings:[]};}
 }
 throw new Error('Unsupported fixture method '+method);
 });await open();});`,
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const invoke = (method, params) =>
    page.evaluate(
      ({ method, params }) => window.fixture.invoke(method, params),
      { method, params },
    );
  const check = async (name, fn) => {
    if (only && name !== only) return;
    current = name;
    await fn();
    passed.push(name);
    console.log("PASS " + name);
  };
  await page.waitForFunction(() => typeof window.fixtureConsole === "function");
  await check(
    "ConsoleNote envelopes are stripped across every chunk boundary without changing visible text",
    async () => {
      const note = "\u001b[8mha:////ENCODED_METADATA\u001b[0m",
        source = "Started by user " + note + "admin\nUI_ACTUAL_PARAMETER\n";
      for (let boundary = 0; boundary <= source.length; boundary++) {
        const result = await page.evaluate(
          (chunks) => window.fixtureConsole(chunks),
          [source.slice(0, boundary), source.slice(boundary)],
        );
        assert.equal(
          result.text,
          "Started by user admin\nUI_ACTUAL_PARAMETER\n",
        );
        assert.deepEqual(result.state, { pending: "", hidden: false });
      }
      const huge = await page.evaluate(() =>
        window.fixtureConsole([
          "before\u001b[8mha:",
          "x".repeat(1024 * 1024),
          "\u001b[0mafter",
        ]),
      );
      assert.equal(huge.text, "beforeafter");
      assert.deepEqual(huge.state, { pending: "", hidden: false });
      const plain = await page.evaluate(() =>
        window.fixtureConsole([
          "ordinary ha:payload ",
          "\u001b[31mred\u001b[0m",
        ]),
      );
      assert.equal(plain.text, "ordinary ha:payload \u001b[31mred\u001b[0m");
    },
  );
  await check(
    "development StrictMode reuses pending prepare and unlocks preview",
    async () => {
      await until(async () => {
        const state = await invoke("fixture.inspect");
        return state.held === 1;
      }, "StrictMode prepare was not held exactly once");
      await invoke("fixture.hold", { enabled: false });
      await invoke("fixture.release");
      await page
        .getByRole("button", { name: "Выполнить", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Выполнить", exact: true })
          .isEnabled(),
        true,
      );
      assert.equal(
        (await invoke("fixture.inspect")).calls.filter(
          (call) => call.method === "ops.prepare",
        ).length,
        1,
      );
    },
  );
  await check(
    "accepted receipt becomes confirmed from host event without another execute",
    async () => {
      await page
        .getByRole("button", { name: "Выполнить", exact: true })
        .click();
      await until(
        async () =>
          (await invoke("fixture.inspect")).delivered.some(
            (value) => value.name === "A" && value.status === "accepted",
          ),
        "Accepted callback absent",
      );
      await invoke("fixture.confirm");
      await until(
        async () =>
          (await invoke("fixture.inspect")).delivered.some(
            (value) => value.name === "A" && value.status === "confirmed",
          ),
        "Confirmed callback absent",
      );
      assert.equal(
        (await invoke("fixture.inspect")).calls.filter(
          (call) => call.method === "ops.execute",
        ).length,
        1,
      );
    },
  );
  await check(
    "unmounted pending prepare cannot replace the next target",
    async () => {
      await invoke("fixture.hold", { enabled: true });
      await invoke("fixture.render", { name: "B" });
      await until(
        async () => (await invoke("fixture.inspect")).held === 1,
        "B prepare not pending",
      );
      await invoke("fixture.render", { name: "C" });
      await until(
        async () => (await invoke("fixture.inspect")).held === 2,
        "C prepare not pending",
      );
      await invoke("fixture.hold", { enabled: false });
      await invoke("fixture.release");
      await page
        .getByRole("button", { name: "Выполнить", exact: true })
        .waitFor();
      assert.ok(
        (await page.locator(".ops-review").textContent()).includes(
          "Проверенная C",
        ),
      );
      assert.ok(
        !(await page.locator(".ops-review").textContent()).includes(
          "Проверенная B",
        ),
      );
    },
  );
  await check(
    "failed StrictMode prepare can be explicitly retried",
    async () => {
      await invoke("fixture.failPrepare");
      await invoke("fixture.render", { name: "D" });
      await page
        .getByRole("button", { name: "Повторить чтение", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Повторить чтение", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Выполнить", exact: true })
        .waitFor();
      const calls = (await invoke("fixture.inspect")).calls.filter(
        (call) =>
          call.method === "ops.prepare" && call.params.input.name === "D",
      );
      assert.equal(calls.length, 2);
      assert.equal(calls[0].params.operationId, calls[1].params.operationId);
    },
  );
  await check(
    "unknown execute follows durable receipt and never retries write",
    async () => {
      await invoke("fixture.unknown");
      await page
        .getByRole("button", { name: "Выполнить", exact: true })
        .click();
      await until(
        async () =>
          (await invoke("fixture.inspect")).delivered.some(
            (value) => value.name === "D" && value.status === "unknown",
          ),
        "Unknown durable receipt not observed",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Выполнить", exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await invoke("fixture.inspect")).calls.filter(
          (call) => call.method === "ops.execute",
        ).length,
        2,
      );
    },
  );
  await check(
    "initial Jenkins and Cluster empty/unassigned/unprobed states render without crashes or queries",
    async () => {
      const queries = () =>
        invoke("fixture.inspect").then(
          (state) =>
            state.calls.filter((call) => call.method === "ops.query").length,
        );
      const before = await queries();
      for (const [mode, connections, label] of [
        ["jenkins-no-project", "empty", "Выберите проект"],
        ["jenkins-empty", "empty", "Подключите Jenkins"],
        ["jenkins-unassigned", "unassigned", "Подключите Jenkins"],
        ["jenkins-disabled", "disabled", "Подключите Jenkins"],
        ["jenkins-unprobed", "unprobed", "Проверьте подключение"],
        ["cluster-no-project", "empty", "Выберите проект"],
        ["cluster-empty", "empty", "Подключите Kubernetes или OpenShift"],
        [
          "cluster-unassigned",
          "unassigned",
          "Подключите Kubernetes или OpenShift",
        ],
      ]) {
        await invoke("fixture.connections", { mode: connections });
        await invoke("fixture.render", { mode });
        await page.getByText(label, { exact: true }).waitFor();
      }
      assert.equal(await queries(), before);
      await invoke("fixture.connections", { mode: "cluster" });
    },
  );
  if (!reviewOnly) {
    await check(
      "same-origin native windows serialize YAML CAS and retain both drafts",
      async () => {
        await invoke("fixture.render", { mode: "cluster" });
        await page
          .getByRole("button", { name: "settings", exact: true })
          .click();
        await page.getByRole("tab", { name: "YAML", exact: true }).click();
        await page
          .getByRole("button", { name: "Редактировать", exact: true })
          .click();
        const secondPromise = application.waitForEvent("window");
        await invoke("fixture.window");
        const second = await secondPromise;
        second.setDefaultTimeout(8000);
        second.on("pageerror", (error) => errors.push(String(error)));
        await second.evaluate(() =>
          window.fixture.invoke("fixture.render", { mode: "cluster" }),
        );
        await second
          .getByRole("button", { name: "settings", exact: true })
          .click();
        await second.getByRole("tab", { name: "YAML", exact: true }).click();
        await second
          .getByRole("button", { name: "Редактировать", exact: true })
          .click();
        assert.equal(await page.evaluate(() => !!navigator.locks), true);
        assert.equal(
          await second.evaluate(() => location.href),
          await page.evaluate(() => location.href),
        );
        const storageKey = JSON.stringify([
          "p",
          "c",
          "target",
          "/v1/configmaps",
          "test",
          "settings",
          "uid-1",
        ]);
        const lockName = "workbench:ops:manifest:" + storageKey;
        await page.evaluate((name) => {
          window.lockEntered = false;
          window.lockHeld = navigator.locks.request(name, () => {
            window.lockEntered = true;
            return new Promise(
              (resolve) => (window.releaseDraftLock = resolve),
            );
          });
        }, lockName);
        await until(
          () => page.evaluate(() => window.lockEntered),
          "Fixture Web Lock not acquired",
        );
        const modify = async (p, value) => {
          await p.locator(".ops-yaml-editor .cm-content").click();
          await p.keyboard.press(
            process.platform === "darwin" ? "Meta+End" : "Control+End",
          );
          await p.keyboard.type("\n# " + value);
        };
        await modify(page, "first-window");
        await modify(second, "second-window");
        await until(async () => {
          const pending = await page.evaluate(
            async () => (await navigator.locks.query()).pending,
          );
          return pending.filter((value) => value.name === lockName).length >= 2;
        }, "Two autosaves did not queue behind actual Web Lock");
        await page.evaluate(() => window.releaseDraftLock());
        await until(async () => {
          const a = await page.locator(".ops-error").allTextContents(),
            b = await second.locator(".ops-error").allTextContents();
          return [...a, ...b].some((value) =>
            value.includes("изменён в другом окне"),
          );
        }, "Losing window did not expose CAS conflict");
        assert.ok(
          (
            await page.locator(".ops-yaml-editor .cm-content").textContent()
          ).includes("first-window"),
        );
        assert.ok(
          (
            await second.locator(".ops-yaml-editor .cm-content").textContent()
          ).includes("second-window"),
        );
        const stored = await page.evaluate(
          (key) =>
            JSON.parse(
              localStorage.getItem("workbench.ops.manifest-draft.v1:" + key),
            ),
          storageKey,
        );
        assert.equal(stored.storageVersion, 1);
        assert.ok(
          stored.text.includes("first-window") !==
            stored.text.includes("second-window"),
        );
        const outcomes = await Promise.all(
          [page, second].map((p) =>
            p.evaluate(() =>
              window.fixtureClose().then(
                () => ({ ok: true }),
                (e) => ({ ok: false, error: String(e) }),
              ),
            ),
          ),
        );
        assert.equal(outcomes.filter((value) => value.ok).length, 1);
        assert.equal(outcomes.filter((value) => !value.ok).length, 1);
        draftWindows = {
          winner: outcomes[0].ok ? page : second,
          loser: outcomes[0].ok ? second : page,
        };
        draftStorageKey = storageKey;
        await page.screenshot({ path: path.join(temp, "first-window.png") });
        await second.screenshot({ path: path.join(temp, "second-window.png") });
      },
    );
  }
  if (!reviewOnly) {
    await check(
      "typing during an awaited lock preserves and durably saves newer text",
      async () => {
        const winner = draftWindows.winner,
          lockName = "workbench:ops:manifest:" + draftStorageKey;
        await winner.evaluate((name) => {
          window.lockEntered = false;
          window.lockHeld = navigator.locks.request(name, () => {
            window.lockEntered = true;
            return new Promise(
              (resolve) => (window.releaseDraftLock = resolve),
            );
          });
        }, lockName);
        await until(
          () => winner.evaluate(() => window.lockEntered),
          "Second fixture lock not acquired",
        );
        const modify = async (value) => {
          await winner.locator(".ops-yaml-editor .cm-content").click();
          await winner.keyboard.press(
            process.platform === "darwin" ? "Meta+End" : "Control+End",
          );
          await winner.keyboard.type("\n# " + value);
        };
        await modify("awaited-first");
        await until(
          () =>
            winner.evaluate(
              async (name) =>
                (await navigator.locks.query()).pending.filter(
                  (value) => value.name === name,
                ).length >= 1,
              lockName,
            ),
          "First delayed draft did not queue",
        );
        await modify("awaited-newer");
        await until(
          () =>
            winner.evaluate(
              async (name) =>
                (await navigator.locks.query()).pending.filter(
                  (value) => value.name === name,
                ).length >= 1,
              lockName,
            ),
          "Newer draft absent",
        );
        await winner.evaluate(() => window.releaseDraftLock());
        await winner.evaluate(() => window.fixtureClose());
        const stored = await winner.evaluate(
          (key) =>
            JSON.parse(
              localStorage.getItem("workbench.ops.manifest-draft.v1:" + key),
            ),
          draftStorageKey,
        );
        assert.ok(stored.text.includes("awaited-first"));
        assert.ok(stored.text.includes("awaited-newer"));
        assert.ok(
          (
            await winner.locator(".ops-yaml-editor .cm-content").textContent()
          ).includes("awaited-newer"),
        );
      },
    );
    await check(
      "unavailable Web Locks retains draft and blocks close without a racy fallback",
      async () => {
        const loser = draftWindows.loser;
        await loser.evaluate(() =>
          Object.defineProperty(navigator, "locks", {
            value: undefined,
            configurable: true,
          }),
        );
        const outcome = await loser.evaluate(() =>
          window.fixtureClose().then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error: String(error) }),
          ),
        );
        assert.equal(outcome.ok, false);
        assert.ok(outcome.error.includes("Web Locks"));
        assert.ok(
          (
            await loser.locator(".ops-yaml-editor .cm-content").textContent()
          ).includes("window"),
        );
      },
    );
  }
  if (!reviewOnly) {
    const newClusterWindow = async () => {
      await invoke("fixture.hold", { enabled: false });
      await invoke("fixture.release");
      await invoke("fixture.connections", { mode: "cluster" });
      const pending = application.waitForEvent("window");
      await invoke("fixture.window");
      const window = await pending;
      window.setDefaultTimeout(8000);
      window.on("pageerror", (error) => errors.push(String(error)));
      await window.evaluate(() =>
        window.fixture.invoke("fixture.render", { mode: "cluster" }),
      );
      await window
        .getByRole("combobox", { name: "Подключение кластера", exact: true })
        .selectOption("c");
      await window
        .getByRole("button", { name: "settings", exact: true })
        .waitFor();
      return window;
    };
    const holdDraft = async (window, key) => {
      const name = "workbench:ops:manifest:" + JSON.stringify(key);
      await window.evaluate((name) => {
        window.lockEntered = false;
        window.lockHeld = navigator.locks.request(name, () => {
          window.lockEntered = true;
          return new Promise((resolve) => (window.releaseDraftLock = resolve));
        });
      }, name);
      await until(
        () => window.evaluate(() => window.lockEntered),
        "Navigation fixture lock not acquired",
      );
      return name;
    };
    const waitDraft = async (window, name) =>
      until(
        () =>
          window.evaluate(
            async (name) =>
              (await navigator.locks.query()).pending.some(
                (value) => value.name === name,
              ),
            name,
          ),
        "Navigation save did not queue",
      );
    const releaseDraft = async (window) => {
      await window.evaluate(() => window.releaseDraftLock());
      await window.evaluate(() => window.fixtureClose());
    };
    const append = async (window, text) => {
      await window.locator(".ops-yaml-editor .cm-content").click();
      await window.keyboard.press(
        process.platform === "darwin" ? "Meta+End" : "Control+End",
      );
      await window.keyboard.type("\n# " + text);
    };
    const openCreate = async (window, name) => {
      await window
        .getByRole("combobox", { name: "Namespace", exact: true })
        .fill("test");
      await window
        .getByRole("combobox", { name: "Namespace", exact: true })
        .press("Enter");
      await window
        .getByRole("button", { name: "Создать", exact: true })
        .click();
      await window
        .getByRole("textbox", { name: "Имя нового ресурса", exact: true })
        .fill(name);
    };
    const creationKey = [
      "create",
      "p",
      "c",
      "target",
      "/v1/configmaps",
      "test",
      "",
    ];
    await check(
      "pending old resource close cannot close a newer selected resource",
      async () => {
        const window = await newClusterWindow();
        await window
          .getByRole("button", { name: "settings2", exact: true })
          .click();
        await window.getByRole("tab", { name: "YAML", exact: true }).click();
        await window
          .getByRole("button", { name: "Редактировать", exact: true })
          .click();
        const lock = await holdDraft(window, [
          "p",
          "c",
          "target",
          "/v1/configmaps",
          "test",
          "settings2",
          "uid-settings2",
        ]);
        await append(window, "pending-old-close");
        await waitDraft(window, lock);
        await window
          .getByRole("button", {
            name: "Закрыть сведения о ресурсе, сохранив черновик",
            exact: true,
          })
          .click();
        await window
          .getByRole("button", { name: "settings3", exact: true })
          .click();
        await releaseDraft(window);
        await until(
          () =>
            window
              .locator(".ops-detail-head strong")
              .textContent()
              .then((text) => text?.trim() === "settings3"),
          "Old pending close removed the newer selection",
        );
      },
    );
    await check(
      "pending old type change cannot replace another connection creation draft",
      async () => {
        const window = await newClusterWindow();
        await openCreate(window, "change-type-old");
        await window.evaluate(() => window.fixtureClose());
        const lock = await holdDraft(window, creationKey);
        await append(window, "pending-type-change");
        await waitDraft(window, lock);
        await window
          .getByRole("combobox", { name: "API нового ресурса", exact: true })
          .selectOption("/v1/namespaces");
        await window
          .getByRole("combobox", { name: "Подключение кластера", exact: true })
          .selectOption("d");
        await window
          .getByRole("button", { name: "settings", exact: true })
          .waitFor();
        await openCreate(window, "newer-draft");
        await releaseDraft(window);
        assert.equal(
          await window
            .getByRole("combobox", { name: "API нового ресурса", exact: true })
            .inputValue(),
          "/v1/configmaps",
        );
        assert.equal(
          await window
            .getByRole("textbox", { name: "Имя нового ресурса", exact: true })
            .inputValue(),
          "newer-draft",
        );
      },
    );
    const acceptedCreation = async (window, name) => {
      await openCreate(window, name);
      await window.evaluate(() => window.fixtureClose());
      await window
        .getByRole("button", { name: "Проверить и создать", exact: true })
        .click();
      await window
        .getByRole("button", { name: "Выполнить", exact: true })
        .click();
      await until(
        () =>
          window
            .locator(".ops-review")
            .textContent()
            .then((text) => text?.includes("В очереди")),
        "Creation receipt not accepted",
      );
    };
    await check(
      "confirmed old creation cannot navigate after a newer connection selection",
      async () => {
        const window = await newClusterWindow();
        await acceptedCreation(window, "confirmed-old");
        const lock = await holdDraft(window, creationKey);
        await window.evaluate(() => window.fixture.invoke("fixture.confirm"));
        await waitDraft(window, lock);
        await window
          .getByRole("combobox", { name: "Подключение кластера", exact: true })
          .selectOption("d");
        await window
          .getByRole("button", { name: "settings", exact: true })
          .waitFor();
        await openCreate(window, "newer-target");
        await releaseDraft(window);
        assert.equal(
          await window
            .getByRole("combobox", {
              name: "Подключение кластера",
              exact: true,
            })
            .inputValue(),
          "d",
        );
        assert.equal(
          await window
            .getByRole("textbox", { name: "Имя нового ресурса", exact: true })
            .inputValue(),
          "newer-target",
        );
      },
    );
    await check(
      "confirmed creation keeps newer typing while its persistence is pending",
      async () => {
        const window = await newClusterWindow();
        await acceptedCreation(window, "confirmed-typing");
        const lock = await holdDraft(window, creationKey);
        await window.evaluate(() => window.fixture.invoke("fixture.confirm"));
        await waitDraft(window, lock);
        await append(window, "newer-typing-during-confirmation");
        await releaseDraft(window);
        assert.ok(
          (
            await window.locator(".ops-yaml-editor .cm-content").textContent()
          ).includes("newer-typing-during-confirmation"),
        );
        assert.equal(
          await window
            .getByRole("textbox", { name: "Имя нового ресурса", exact: true })
            .inputValue(),
          "confirmed-typing",
        );
      },
    );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (application)
    await application
      .firstWindow()
      .then((page) => page.screenshot({ path: path.join(temp, "failure.png") }))
      .catch(() => {});
  failure = {
    test: current,
    message: String(error?.message || error),
    stack: error?.stack,
  };
  process.exitCode = 1;
} finally {
  if (application)
    await Promise.race([
      application.close(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]).catch(() => {});
  await fs.writeFile(
    path.join(temp, "report.json"),
    JSON.stringify(
      {
        passed,
        failure,
        sourceHashes,
        scope:
          "Actual Electron development React StrictMode, controlled IPC fixture; native same-origin Web Locks. No live Jenkins/Kubernetes validation claim.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: passed.length, failure, directory: temp },
      null,
      2,
    ),
  );
}
