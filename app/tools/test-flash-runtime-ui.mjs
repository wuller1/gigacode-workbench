/** Actual application acceptance. Owned ACP/MCP peers are deterministic protocol fixtures;
 * no paid model, real Qwen vision, corporate endpoint or model-quality claim. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { _electron } from "playwright";
const require = createRequire(import.meta.url);
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = path.dirname(appRoot);
const output = path.join(root, "docs/suite/evidence/flash-runtime-ui");
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "gigacode-flash-ui-")),
);
const dataDir = path.join(temp, "userdata"),
  projectA = path.join(temp, "frontend"),
  projectB = path.join(temp, "backend");
const baseline = process.argv.includes("--baseline");
const diagnosticContinue = process.argv.includes("--diagnostic-continue");
const fakeSecret = "owned-vision-vault-secret-not-a-real-credential";
const checks = [],
  captures = [],
  proofs = [],
  rendererErrors = [];
let application,
  launchAttempted = false,
  page,
  info,
  parent,
  taskA,
  a,
  b,
  failure,
  electronExit,
  current = "startup",
  cleanup = "not-started";
const sources = [
  "src/App.tsx",
  "src/ManagedAgentsPanel.tsx",
  "src/ContextControls.tsx",
  "src/VisionSettings.tsx",
  "src/QueueMessages.tsx",
  "src/SettingsView.tsx",
  "src/styles.css",
  "electron/main.ts",
  "electron/service.ts",
  "electron/acp.ts",
  "electron/store.ts",
  "electron/context-supervisor.ts",
  "electron/managed-coordination.ts",
  "electron/vision-bridge.ts",
  "shared/context.ts",
  "shared/managed-coordination.ts",
  "shared/vision.ts",
  "shared/types.ts",
  "tools/test-flash-runtime-ui.mjs",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = async () => {
  const result = {};
  const inventory = new Set(sources);
  const inventoryDirectory = async (directory) => {
    for (const entry of await fs.readdir(path.join(appRoot, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inventoryDirectory(file);
      else if (entry.isFile() && /\.(?:tsx?|css|svg|png|ico|icns)$/.test(file)) inventory.add(file);
      if (inventory.size > 1000) throw new Error("Source inventory exceeds the reviewed acceptance bound");
    }
  };
  for (const directory of ["src", "electron", "shared", "public", "build"])
    await inventoryDirectory(directory);
  for (const file of ["index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"])
    inventory.add(file);
  for (const file of [...inventory].sort())
    result[file] = hash(await fs.readFile(path.join(appRoot, file)));
  for (const file of (
    await fs.readdir(path.join(appRoot, "dist/assets"))
  ).sort())
    if (/\.(?:js|css)$/.test(file))
      result[`dist/assets/${file}`] = hash(
        await fs.readFile(path.join(appRoot, "dist/assets", file)),
      );
  return result;
};
let before;
const invoke = (method, params = {}) =>
  page.evaluate(
    ({ method, params }) => window.workbench.invoke(method, params),
    { method, params },
  );
const state = () => invoke("state.get");
const session = async (id) =>
  (await state()).sessions.find((item) => item.id === id);
const store = async () =>
  JSON.parse(await fs.readFile(path.join(dataDir, "state.json"), "utf8"));
const events = async (project) => {
  try {
    return (
      await fs.readFile(path.join(project, "owned-acp-events.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    return [];
  }
};
const prompts = async (project, marker) =>
  (await events(project)).filter(
    (event) => event.type === "prompt" && event.command === marker,
  );
const poll = async (predicate, label, timeout = 15000) => {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      if (await predicate()) return;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}${last ? `; ${last}` : ""}`);
};
const check = async (name, action) => {
  current = name;
  const start = Date.now();
  try {
    await action();
    checks.push({ name, elapsedMs: Date.now() - start, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    if (!diagnosticContinue) throw error;
    const message = String(error?.message ?? error).replaceAll(fakeSecret, "[redacted]")
      .replaceAll(temp, "<owned-temp>").slice(0, 3000);
    checks.push({ name, elapsedMs: Date.now() - start, passed: false, error: message });
    failure ||= { test: name, message };
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${message}`);
    try { await capture(`diagnostic-failure-${checks.length}.png`); } catch {}
    // Diagnostic groups are independent only if a failed form does not leave
    // an overlay intercepting later UI actions. Never force-click through it.
    try {
      for (let i = 0; i < 3 && await page.getByRole("dialog").count(); i++)
        await page.keyboard.press("Escape");
    } catch {}
  }
};
const capture = async (name) => {
  await page.screenshot({ path: path.join(output, name) });
  const image = await fs.readFile(path.join(output, name));
  captures.push({
    name,
    sha256: hash(image),
    viewport: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      theme: document.documentElement.dataset.theme,
    })),
  });
};
const input = () =>
  page.getByRole("textbox", { name: "Сообщение агенту", exact: true });
const selectTask = async (task) => {
  await page.locator(".task-select").filter({ hasText: task.title }).click();
  const chatTab = page.getByRole("tab", { name: "Чат", exact: true });
  if (await chatTab.count()) await chatTab.first().click();
  await input().waitFor();
};
const finish = async (project, marker) => {
  const record = (await prompts(project, marker)).at(-1);
  assert.ok(record, `Missing owned prompt ${marker}`);
  await fs.writeFile(
    path.join(project, `owned-finish-${record.pid}`),
    "finish\n",
  );
};
const workerCard = (title) =>
  page
    .locator(".worker-card")
    .filter({ has: page.locator(".worker-heading", { hasText: title }) });
const geometry = async (selector) =>
  page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect(),
        s = getComputedStyle(element);
      return {
        text: element.textContent.trim().slice(0, 120),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        display: s.display,
        color: s.color,
        background: s.backgroundColor,
      };
    }),
  );
const visibleControlMetrics = async (container) =>
  container.evaluate((root) => [...root.querySelectorAll("button,input,select,textarea")]
    .filter((element) => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      if (!r.width || !r.height || s.visibility !== "visible" || s.display === "none") return false;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      // Offscreen controls inside a deliberately scrollable pane are not overlaps.
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent.tagName === "DETAILS" && !parent.open &&
          !parent.querySelector(":scope > summary")?.contains(element)) return false;
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (y < clip.top || y > clip.bottom)) return false;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (x < clip.left || x > clip.right)) return false;
      }
      return true;
    })
    .map((element) => {
      const r = element.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        name: (element.getAttribute("aria-label") || element.getAttribute("title") ||
          element.labels?.[0]?.textContent || element.textContent || "").trim().slice(0, 120),
        tag: element.tagName.toLowerCase(), width: r.width, height: r.height,
        centreHit: element === top || element.contains(top),
        disabled: !!element.disabled,
      };
    }));
const acpPeer = `import readline from 'node:readline';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
let remote='',pending;const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');const result=(id,value)=>send({jsonrpc:'2.0',id,result:value});const log=value=>fs.appendFileSync(path.join(process.cwd(),'owned-acp-events.jsonl'),JSON.stringify({...value,pid:process.pid,at:Date.now()})+'\\n');const update=value=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:remote,update:value}});const done=reason=>{if(!pending)return;const current=pending;pending=undefined;log({type:'terminal',command:current.command,reason});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Observed fixture result: '+current.command}});result(current.id,{stopReason:reason});};
const timer=setInterval(()=>{if(pending&&fs.existsSync(path.join(process.cwd(),'owned-finish-'+process.pid))){fs.unlinkSync(path.join(process.cwd(),'owned-finish-'+process.pid));done('end_turn');}},30);timer.unref();
readline.createInterface({input:process.stdin}).on('line',line=>{let r;try{r=JSON.parse(line);}catch{return;}switch(r.method){case 'initialize':if(fs.existsSync(path.join(process.cwd(),'owned-init-fail-once'))){fs.unlinkSync(path.join(process.cwd(),'owned-init-fail-once'));log({type:'startup-failure',status:429});process.stderr.write('<html><title>429 Too many requests</title><body>Owned transient startup fixture</body></html>\\n',()=>process.exit(1));break;}result(r.id,{protocolVersion:1,agentInfo:{name:'owned-flash-protocol-peer',version:'1'},agentCapabilities:{}});break;case 'session/new':remote='owned-'+process.pid;log({type:'new'});result(r.id,{sessionId:remote,configOptions:[]});break;case 'session/prompt':{const content=r.params.prompt.filter(x=>x.type==='text').map(x=>x.text).join('\\n');const markers=['Current host phase:\\n','Current user message:\\n','Peer message:\\n'];let command=content;for(const marker of markers){if(content.includes(marker)){command=content.split(marker).at(-1);break;}}command=command.trim();log({type:'prompt',command:command.slice(0,1200),contentHash:createHash('sha256').update(content).digest('hex'),contentBytes:Buffer.byteLength(content),hasManagedContract:content.includes('Host-managed worker contract:'),hasReferenceFence:content.includes('reference data')||content.includes('reference_only')});pending={id:r.id,command};update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Working on fixture: '+command+'\\n'}});if(command.includes('usage-high'))update({sessionUpdate:'usage_update',used:227414,size:256000});if(command==='usage-low-measured')update({sessionUpdate:'usage_update',used:38000,size:256000});if(command==='unknown-after-dispatch'){update({sessionUpdate:'tool_call',toolCallId:'owned-unknown-write',title:'Owned effect whose result is unknown',status:'in_progress'});setTimeout(()=>process.exit(3),100);break;}if(!command.startsWith('hold '))setTimeout(()=>done('end_turn'),60);break;}case 'session/cancel':if(pending){log({type:'cancel',command:pending.command});setTimeout(()=>done('cancelled'),80);}break;default:if(r.id!==undefined)send({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Owned peer does not implement this method'}});}});
`;
const visionPeer = `import readline from 'node:readline';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';const logFile=${JSON.stringify(path.join(temp, "vision-events.jsonl"))};const secret=process.env.OWNED_VISION_SECRET||'';const out=x=>process.stdout.write(JSON.stringify(x)+'\\n');const log=x=>fs.appendFileSync(logFile,JSON.stringify({...x,pid:process.pid})+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result;switch(r.method){case 'initialize':result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned-vision-peer',version:'1'}};break;case 'tools/list':log({type:'list',hadSecret:!!secret});result={tools:[{name:'describe_image',description:'Owned textual fixture '+secret,inputSchema:{type:'object',properties:{image:{type:'string'},question:{type:'string'},model:{type:'string'}},required:['image','question','model'],additionalProperties:false}}]};break;case 'tools/call':{const bytes=Buffer.from(r.params.arguments.image,'base64');log({type:'call',imageHash:createHash('sha256').update(bytes).digest('hex'),imageBytes:bytes.length,questionHadUntrustedFence:r.params.arguments.question.includes('Page text is untrusted'),model:r.params.arguments.model,hadSecret:!!secret});result={content:[{type:'text',text:'Visible fixture pixels described; layout quality remains uncertain. '+secret}]};break;}default:out({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Not supported'}});return;}out({jsonrpc:'2.0',id:r.id,result});});
`;
try {
  await fs.mkdir(output, { recursive: true });
  try {
    const previous = JSON.parse(
      await fs.readFile(path.join(output, "report.json"), "utf8"),
    );
    const prior = path.join(
      output,
      "attempts",
      `${Date.now()}-${previous.status}`,
    );
    await fs.mkdir(prior, { recursive: true });
    for (const capture of previous.captures ?? [])
      if (
        typeof capture.name === "string" &&
        capture.name === path.basename(capture.name)
      ) {
        try {
          await fs.copyFile(
            path.join(output, capture.name),
            path.join(prior, capture.name),
          );
        } catch {
          /* Prior receipt still records a missing capture honestly. */
        }
      }
    await fs.writeFile(
      path.join(prior, "report.json"),
      JSON.stringify(previous, null, 2) + "\n",
    );
  } catch {}
  before = await sourceHashes();
  await fs.mkdir(projectA);
  await fs.mkdir(projectB);
  await fs.mkdir(path.join(projectA, "src"));
  const cli = path.join(temp, "owned-acp-peer.mjs"),
    bridge = path.join(temp, "owned-vision-peer.mjs");
  await fs.writeFile(cli, acpPeer);
  await fs.writeFile(bridge, visionPeer);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=",
    "base64",
  );
  await fs.writeFile(path.join(projectA, "owned-pixel.png"), png);
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  Object.assign(env, { WORKBENCH_DATA_DIR: dataDir, WORKBENCH_CLI_PATH: cli });
  launchAttempted = true;
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [appRoot],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) =>
    rendererErrors.push(error.message.replaceAll(fakeSecret, "[redacted]")),
  );
  await page.waitForFunction(() => Boolean(window.workbench));
  await page.locator(".app-shell").waitFor();
  await application.evaluate(({ session }) =>
    session.defaultSession.webRequest.onBeforeRequest((request, callback) =>
      callback({ cancel: /^https?:/i.test(request.url) }),
    ),
  );
  info = await invoke("app.info");
  a = await invoke("project.create", {
    name: "Frontend acceptance",
    path: projectA,
  });
  taskA = await invoke("task.create", {
    projectId: a.id,
    title: "Flash UI acceptance",
    description:
      "Owned fixture task; observe state, preserve evidence, no corporate systems.",
  });
  parent = await invoke("session.create", {
    taskId: taskA.id,
    title: "Coordinator",
  });
  b = await invoke("project.create", {
    name: "Backend acceptance",
    path: projectB,
  });
  await invoke("settings.update", {
    patch: {
      theme: "dark",
      startupRetries: 0,
      maxConcurrent: 3,
      managedMaxPerParent: 2,
      managedContextBudgetTokens: 64000,
      allowCrossProjectCoordination: true,
    },
  });
  await selectTask(taskA);
  await check(
    "Actual queue: editing then visible Send now cancels once and dispatches edited message once",
    async () => {
      await input().fill("hold queue-original");
      await input().press("Control+Enter");
      await poll(
        async () =>
          (await prompts(projectA, "hold queue-original")).length === 1,
        "first held ACP request",
      );
      await input().fill("queued-original");
      await input().press("Control+Enter");
      await poll(
        async () => (await session(parent.id)).queue.length === 1,
        "queued request",
      );
      await page
        .getByRole("button", { name: "Редактировать сообщение", exact: true })
        .click();
      await page
        .getByRole("textbox", {
          name: "Редактирование сообщения в очереди",
          exact: true,
        })
        .fill("queued-edited-send-now");
      await page
        .locator(".queue-editor")
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await poll(
        async () =>
          (await session(parent.id)).queue[0]?.text ===
          "queued-edited-send-now",
        "durable queue CAS",
      );
      const send = page.getByRole("button", {
        name: "Отправить сейчас",
        exact: true,
      });
      assert.equal(await send.isVisible(), true);
      assert.equal(await send.isEnabled(), true);
      await capture("queue-send-now-dark.png");
      await send.click();
      await poll(
        async () =>
          (await session(parent.id)).status === "completed" &&
          (await session(parent.id)).queue.length === 0,
        "Send now completed",
      );
      assert.equal((await prompts(projectA, "queued-original")).length, 0);
      assert.equal(
        (await prompts(projectA, "queued-edited-send-now")).length,
        1,
      );
      assert.equal(
        (await events(projectA)).filter(
          (event) =>
            event.type === "cancel" && event.command === "hold queue-original",
        ).length,
        1,
      );
      const ordered = await events(projectA);
      const terminal = ordered.findIndex(
        (event) =>
          event.type === "terminal" &&
          event.command === "hold queue-original" &&
          event.reason === "cancelled",
      );
      const dispatched = ordered.findIndex(
        (event) =>
          event.type === "prompt" && event.command === "queued-edited-send-now",
      );
      assert.ok(
        terminal >= 0 && dispatched > terminal,
        "Edited message dispatched before cancellation acknowledgement",
      );
      const s = await session(parent.id);
      assert.equal(
        s.messages.filter(
          (message) =>
            message.role === "assistant" && message.outcome === "cancelled",
        ).length,
        1,
      );
      proofs.push({
        stage: "queue",
        queueLength: s.queue.length,
        editedDispatches: 1,
        originalDispatches: 0,
        cancellations: 1,
      });
    },
  );
  let first, second, dependent;
  await check(
    "Managed delegate created through the actual UI remains visible in current-task scope",
    async () => {
      await page
        .getByRole("button", { name: "Исполнители", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Поручение", exact: true })
        .click();
      await page
        .getByLabel("Независимый результат", { exact: true })
        .fill("hold worker-primary");
      await page
        .getByText("Зависимости и область изменения", { exact: true })
        .click();
      await page
        .getByLabel("Файлы/каталоги для записи · относительно проекта", {
          exact: true,
        })
        .fill("src/shared.ts");
      await page
        .getByRole("button", { name: "Назначить", exact: true })
        .click();
      await poll(
        async () =>
          (await state()).sessions.some(
            (item) =>
              item.parentId === parent.id &&
              item.title === "hold worker-primary",
          ),
        "UI-created worker",
      );
      first = (await state()).sessions.find(
        (item) =>
          item.parentId === parent.id && item.title === "hold worker-primary",
      );
      await workerCard(first.title).waitFor();
      await poll(
        async () =>
          (await prompts(projectA, "hold worker-primary")).length === 1,
        "managed ACP child dispatched",
      );
      assert.equal((await session(first.id)).parentId, parent.id);
      assert.equal((await session(first.id)).managed.contextBudget, 16000);
      assert.equal(
        (await prompts(projectA, "hold worker-primary"))[0].hasManagedContract,
        true,
      );
      await capture("managed-worker-dark.png");
    },
  );
  await check(
    "Host write conflicts and DAG dependencies hold children, queued pause/resume is controlled through UI",
    async () => {
      second = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetTaskId: taskA.id,
          operationId: "worker-conflict",
          title: "Worker conflict",
          prompt: "worker-second",
          writeScopes: ["src/shared.ts"],
          contextBudget: 16000,
        })
      ).session;
      const duplicate = await invoke("agent.delegate", {
        parentId: parent.id,
        targetTaskId: taskA.id,
        operationId: "worker-conflict",
        title: "Worker conflict",
        prompt: "worker-second",
        writeScopes: ["src/shared.ts"],
        contextBudget: 16000,
      });
      assert.equal(duplicate.replayed, true);
      assert.equal(duplicate.session.id, second.id);
      dependent = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetTaskId: taskA.id,
          operationId: "worker-dependent",
          title: "Worker dependent",
          prompt: "worker-dependent",
          dependencies: [first.id],
          contextBudget: 16000,
        })
      ).session;
      await workerCard(second.title).waitFor();
      await workerCard(dependent.title).waitFor();
      await poll(
        async () =>
          (await session(second.id)).managed.phase === "queued" &&
          (await session(dependent.id)).managed.phase === "queued",
        "blocked admissions",
      );
      assert.equal((await prompts(projectA, "worker-second")).length, 0);
      assert.equal((await prompts(projectA, "worker-dependent")).length, 0);
      await workerCard(second.title)
        .getByRole("button", { name: "Пауза", exact: true })
        .click();
      await poll(
        async () => (await session(second.id)).managed.phase === "paused",
        "queued worker paused",
      );
      await workerCard(second.title)
        .getByRole("button", { name: "Продолжить", exact: true })
        .click();
      await poll(
        async () => (await session(second.id)).managed.phase === "queued",
        "queued worker resumed but conflict retained",
      );
      const cancelled = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetTaskId: taskA.id,
          operationId: "worker-cancel-queued",
          title: "Worker cancel queued",
          prompt: "must-not-run-cancelled-worker",
          writeScopes: ["src/shared.ts"],
          contextBudget: 16000,
        })
      ).session;
      await poll(
        async () => (await session(cancelled.id)).managed.phase === "queued",
        "cancelled worker initially held by writer lease",
      );
      const stopQueued = workerCard(cancelled.title).getByRole("button", {
        name: "Остановить", exact: true,
      });
      assert.equal(await stopQueued.isEnabled(), true,
        "A queued worker must be stoppable without launching a CLI");
      await stopQueued.click();
      await poll(
        async () => (await session(cancelled.id)).managed.phase === "cancelled",
        "queued worker stopped through actual card UI",
      );
      assert.equal((await session(cancelled.id)).queue.length, 1,
        "Stopped undispatched work is retained for explicit recovery; it must never dispatch automatically");
      await assert.rejects(
        invoke("agent.dependencies", {
          id: first.id,
          dependencies: [dependent.id],
        }),
        /cycle|dependenc|running|attempt|lease/i,
      );
      await finish(projectA, "hold worker-primary");
      await poll(
        async () =>
          (await state()).sessions
            .filter((item) =>
              [first.id, second.id, dependent.id].includes(item.id),
            )
            .every((item) => item.managed.phase === "completed"),
        "DAG and write lease released",
        20000,
      );
      assert.equal((await prompts(projectA, "worker-second")).length, 1);
      assert.equal((await prompts(projectA, "worker-dependent")).length, 1);
      assert.equal((await prompts(projectA, "must-not-run-cancelled-worker")).length, 0);
      await workerCard(cancelled.title).getByRole("button", { name: "Повторить", exact: true }).click();
      await poll(async () => (await session(cancelled.id)).managed.phase === "completed",
        "cancelled queued work executes only after explicit UI retry");
      assert.equal((await prompts(projectA, "must-not-run-cancelled-worker")).length, 1);
      proofs.push({
        stage: "managed-dag",
        first: first.id,
        second: second.id,
        dependent: dependent.id,
        dependentAndConflictingBeforeRelease: 0,
        queuedCancellationDispatched: 0,
        queuedCancellationInputRetained: true,
        explicitCancelledRetryDispatched: 1,
      });
    },
  );
  await check(
    "Managed followup uses actual card UI and prior attempt is not replayed",
    async () => {
      await workerCard(first.title)
        .getByRole("button", { name: "Новое поручение", exact: true })
        .click();
      await workerCard(first.title)
        .getByLabel("Поручение исполнителю", { exact: true })
        .fill("worker-followup");
      await workerCard(first.title)
        .getByRole("button", { name: "Отправить", exact: true })
        .click();
      await poll(
        async () =>
          (await prompts(projectA, "worker-followup")).length === 1 &&
          (await session(first.id)).managed.phase === "completed",
        "followup terminal",
      );
      assert.equal((await prompts(projectA, "hold worker-primary")).length, 1);
    },
  );
  let cross;
  await check(
    "Directed cross-project delegation, durable note dedup and revocation use the same host queue",
    async () => {
      cross = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetProjectId: b.id,
          operationId: "cross-worker",
          title: "Backend contract fix",
          prompt: "backend-contract-fix",
          contextBudget: 16000,
        })
      ).session;
      await poll(
        async () => (await session(cross.id)).managed.phase === "completed",
        "backend delegated request",
      );
      assert.equal((await prompts(projectB, "backend-contract-fix")).length, 1);
      assert.equal(
        (await state()).tasks.find((item) => item.id === cross.taskId)
          .projectId,
        b.id,
      );
      const params = {
        sourceId: parent.id,
        id: cross.id,
        operationId: "frontend-backend-note",
        text: "contract-note-reference-only",
      };
      const receipt = await invoke("session.peerMessage", params),
        duplicate = await invoke("session.peerMessage", params);
      assert.equal(receipt.id, duplicate.id);
      await poll(
        async () =>
          (await prompts(projectB, "contract-note-reference-only")).length ===
          1,
        "cross-project peer delivered once",
      );
      await poll(
        async () => (await session(cross.id)).managed.phase === "completed",
        "peer terminal",
      );
      const links = await invoke("coordination.links");
      const link = links.find(
        (item) =>
          item.sourceProjectId === a.id && item.targetProjectId === b.id,
      );
      assert.ok(link?.enabled);
      await invoke("coordination.revoke", { id: link.id });
      await assert.rejects(
        invoke("agent.delegate", {
          parentId: parent.id,
          targetProjectId: b.id,
          operationId: "cross-after-revoke",
          title: "Blocked delegated task",
          prompt: "must-not-dispatch",
        }),
        /revoked|disabled|allow|link/i,
      );
      assert.equal((await prompts(projectB, "must-not-dispatch")).length, 0);
      proofs.push({
        stage: "cross-project",
        linkId: link.id,
        distinctProject: true,
        noteDispatches: 1,
        revokedAdmission: "held",
      });
    },
  );
  await check(
    "Managed dispatched process failure is fenced; retry and followup do not replay UNKNOWN",
    async () => {
      const child = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetTaskId: taskA.id,
          operationId: "unknown-worker",
          title: "Unknown worker",
          prompt: "unknown-after-dispatch",
          contextBudget: 16000,
        })
      ).session;
      await poll(
        async () => (await session(child.id)).managed.effectFence === true,
        "managed unknown fence",
        20000,
      );
      await assert.rejects(
        invoke("agent.control", { id: child.id, action: "retry" }),
        /reconcil|unknown/i,
      );
      await assert.rejects(
        invoke("agent.followup", { id: child.id, text: "do-not-replay" }),
        /reconcil|unknown/i,
      );
      assert.equal(
        (await prompts(projectA, "unknown-after-dispatch")).length,
        1,
      );
      assert.equal((await prompts(projectA, "do-not-replay")).length, 0);
      const card = workerCard(child.title);
      await card.getByRole("button", { name: "Подтвердить сверку результата", exact: true }).waitFor();
      assert.equal((await page.locator(".worker-card .worker-heading").first().innerText()).trim(), child.title,
        "A worker needing human attention must be shown before completed workers");
      await card
        .getByRole("button", {
          name: "Подтвердить сверку результата",
          exact: true,
        })
        .click();
      proofs.push({
        stage: "human-reconcile-form",
        forms: await card.locator("form").count(),
        labels: await card.locator("label").allTextContents(),
      });
      await card
        .getByLabel("Наблюдаемый результат")
        .selectOption("not_applied");
      await card
        .getByLabel("Ссылки на проверку", { exact: true })
        .fill("owned-protocol-fixture: no external effect implementation");
      await card
        .getByRole("button", { name: "Сохранить сверку", exact: true })
        .click();
      await poll(
        async () =>
          !(await session(child.id)).managed.effectFence &&
          (await session(child.id)).status !== "unknown",
        "human readback clears executable hold without replay",
      );
      await card
        .getByRole("button", { name: "Новое поручение", exact: true })
        .click();
      await card
        .getByLabel("Поручение исполнителю", { exact: true })
        .fill("fresh-after-unknown-readback");
      await card
        .getByRole("button", { name: "Отправить", exact: true })
        .click();
      await poll(
        async () =>
          (await session(child.id)).managed.phase === "completed" &&
          (await prompts(projectA, "fresh-after-unknown-readback")).length ===
            1,
        "fresh managed followup after verified readback",
      );
      assert.equal(
        (await prompts(projectA, "unknown-after-dispatch")).length,
        1,
      );
      const retainedUnknown = (await session(child.id)).messages.find((message) =>
        message.tools?.some((tool) => tool.id === "owned-unknown-write"));
      assert.ok(retainedUnknown, "Human verification must preserve the original tool evidence");
      assert.equal(retainedUnknown.outcome, "unknown");
      assert.equal(retainedUnknown.tools.find((tool) => tool.id === "owned-unknown-write").status,
        "in_progress", "Historical unknown tool metadata must not be fabricated into success");
      proofs.push({
        stage: "unknown-worker",
        replayed: false,
        unresolvedHistoricalEvidenceRetained: true,
        needsAttentionSortedFirst: true,
        externalReadback:
          "Owned fixture has no external effect implementation; corporate write reconciliation not tested",
      });
    },
  );
  await check(
    "Predispatch HTML 429 startup failure retries with a bounded new attempt and exactly one prompt",
    async () => {
      await fs.writeFile(
        path.join(projectA, "owned-init-fail-once"),
        "owned retry fixture",
      );
      const retry = (
        await invoke("agent.delegate", {
          parentId: parent.id,
          targetTaskId: taskA.id,
          operationId: "retry-startup-worker",
          title: "Retry startup worker",
          prompt: "retry-startup-once",
          contextBudget: 16000,
        })
      ).session;
      await poll(
        async () => (await session(retry.id)).managed.phase === "completed",
        "managed startup retry terminal",
        25000,
      );
      const observed = await session(retry.id);
      assert.equal(observed.managed.attempts, 2);
      assert.equal((await prompts(projectA, "retry-startup-once")).length, 1);
      assert.equal(
        (await events(projectA)).filter(
          (event) => event.type === "startup-failure" && event.status === 429,
        ).length,
        1,
      );
      proofs.push({
        stage: "managed-startup-retry",
        attempts: observed.managed.attempts,
        prompts: 1,
        beforeDispatch: true,
        htmlStatus: 429,
      });
    },
  );
  await selectTask(taskA);
  const artifact = await invoke("artifact.register", {
    taskId: taskA.id,
    path: path.join(projectA, "owned-pixel.png"),
    name: "Owned visual fixture",
    kind: "png",
  });
  let visionConfig;
  await check(
    "Actual settings edit stdio args JSON and mapping; secret vault never returns plaintext",
    async () => {
      await page
        .getByRole("button", { name: "Настройки", exact: true })
        .first()
        .click();
      const modal = page.getByRole("dialog", {
        name: "Настройки",
        exact: true,
      });
      await modal
        .getByRole("button", { name: "Визуальные проверки", exact: true })
        .click();
      await modal.getByLabel("Подключение").selectOption("stdio");
      await modal
        .getByLabel("Команда MCP", { exact: true })
        .fill(process.execPath);
      await modal
        .getByLabel("Аргументы · JSON", { exact: true })
        .fill("not valid JSON");
      await modal
        .getByRole("button", { name: "Сохранить мост", exact: true })
        .click();
      await modal.locator(".vision-settings [role=alert]").waitFor();
      assert.equal(
        await modal
          .getByLabel("Аргументы · JSON", { exact: true })
          .inputValue(),
        "not valid JSON",
      );
      assert.equal((await invoke("vision.snapshot")).configured, false);
      await modal
        .getByLabel("Аргументы · JSON", { exact: true })
        .fill(JSON.stringify([bridge]));
      await modal
        .getByLabel("Инструмент описания изображения", { exact: true })
        .fill("describe_image");
      await modal
        .getByLabel("Аргументы инструмента · JSON")
        .fill(
          JSON.stringify(
            { image: "$imageBase64", question: "$prompt", model: "$model" },
            null,
            2,
          ),
        );
      await modal
        .getByText("Авторизация и корпоративный сертификат", { exact: true })
        .click();
      await modal
        .getByLabel("Переменная окружения секрета", { exact: true })
        .fill("OWNED_VISION_SECRET");
      const initial = await invoke("vision.snapshot");
      if (initial.vaultAvailable)
        await modal.getByLabel("Секрет", { exact: true }).fill(fakeSecret);
      await modal
        .getByRole("button", { name: "Сохранить мост", exact: true })
        .click();
      await modal
        .getByText(
          "Настройки сохранены. Изображения отправляются только выбранному мосту; агент получает текст.",
          { exact: true },
        )
        .waitFor();
      const saved = await invoke("vision.snapshot");
      assert.equal(saved.imageDelivery, "text_only");
      assert.equal(saved.hasSecret, initial.vaultAvailable);
      assert.equal(JSON.stringify(saved).includes(fakeSecret), false);
      visionConfig = saved.config;
      proofs.push({
        stage: "vision-config",
        vaultAvailable: initial.vaultAvailable,
        plaintextReturned: false,
        revision: saved.revision,
      });
      await modal
        .getByRole("button", { name: "Обнаружить инструменты", exact: true })
        .click();
      await modal
        .getByText("Каталог прочитан. Запросов к модели не было.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (
          await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8")
        ).includes('"type":"call"'),
        false,
      );
      await capture("vision-settings-dark.png");
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
    },
  );
  await check(
    "Actual vision MCP schema/mapping delivers real PNG bytes, scrubs secret and caches exact image/query",
    async () => {
      assert.ok(visionConfig, "Prerequisite: the actual vision settings form must be accepted");
      const inventory = await invoke("vision.probe");
      assert.equal(inventory.paidRequest, false);
      assert.equal(JSON.stringify(inventory).includes(fakeSecret), false);
      assert.equal(inventory.tools[0].name, "describe_image");
      const params = {
        artifactId: artifact.id,
        prompt: "Describe only the actual fixture pixels and uncertainty",
      };
      const reviewed = await invoke("vision.review", params),
        cached = await invoke("vision.review", params);
      assert.equal(reviewed.imageSha256, hash(png));
      assert.equal(reviewed.mode, "text_bridge");
      assert.equal(reviewed.cached, false);
      assert.equal(cached.cached, true);
      assert.match(reviewed.trust, /untrusted|not native/i);
      assert.equal(reviewed.description.includes(fakeSecret), false);
      const records = (
        await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map(JSON.parse);
      const calls = records.filter((record) => record.type === "call");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].imageHash, hash(png));
      assert.equal(calls[0].questionHadUntrustedFence, true);
      proofs.push({
        stage: "vision-review",
        imageSha256: reviewed.imageSha256,
        realBytes: calls[0].imageBytes,
        calls: 1,
        exactCache: true,
        description:
          "Redacted and held as untrusted; no real vision model invoked",
      });
    },
  );
  await check(
    "Vision discovered schema rejects wrong mapping before tool/model dispatch",
    async () => {
      assert.ok(visionConfig, "Prerequisite: the actual vision settings form must be accepted");
      const valid = await invoke("vision.snapshot");
      const keyOnly = await invoke("vision.configure", {
        config: {
          ...valid.config,
          argumentsTemplate: {
            "$imageDataUrl": "This key is not substituted into image bytes",
            question: "$prompt", model: "$model",
          },
        },
        expectedRevision: valid.revision,
      });
      const beforeKeyOnlyReview = (await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8"))
        .trim().split("\n").filter(Boolean).length;
      await assert.rejects(
        invoke("vision.review", {
          artifactId: artifact.id,
          prompt: "An object key cannot deliver actual image bytes",
        }),
        /must pass the actual captured image/i,
      );
      assert.equal((await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8"))
        .trim().split("\n").filter(Boolean).length, beforeKeyOnlyReview,
        "Missing image bytes must fail before MCP connection/discovery, not merely fail a strict server schema later");
      assert.equal((await invoke("vision.snapshot")).revision, keyOnly.revision,
        "Failed review must not silently alter the configured route");
      const restored = await invoke("vision.configure", {
        config: valid.config,
        expectedRevision: keyOnly.revision,
      });
      const invalid = await invoke("vision.configure", {
        config: {
          ...valid.config,
          argumentsTemplate: {
            ...valid.config.argumentsTemplate,
            unexpected: true,
          },
        },
        expectedRevision: restored.revision,
      });
      await assert.rejects(
        invoke("vision.review", {
          artifactId: artifact.id,
          prompt: "Schema failure must not dispatch",
        }),
        /schema|mapping/i,
      );
      const records = (
        await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(
        records.filter((record) => record.type === "call").length,
        1,
      );
      proofs.push({ stage: "vision-negative-mapping", objectKeyOnlyRejectedAtReview: true,
        beforeMCPConnection: true, discoveredSchemaRejected: true,
        additionalToolCalls: 0, failedReviewChangedRevision: false });
      await invoke("vision.configure", {
        config: valid.config,
        expectedRevision: invalid.revision,
      });
    },
  );
  await check(
    "Vision settings CAS rejects stale draft without replacing the accepted route",
    async () => {
      assert.ok(visionConfig, "Prerequisite: the actual vision settings form must be accepted");
      const before = await invoke("vision.snapshot");
      const accepted = await invoke("vision.configure", {
        config: { ...visionConfig, modelLabel: "Owned accepted bridge label" },
        expectedRevision: before.revision,
      });
      await assert.rejects(
        invoke("vision.configure", {
          config: { ...visionConfig, modelLabel: "Stale losing label" },
          expectedRevision: before.revision,
        }),
        /changed|revision|reload/i,
      );
      assert.equal(
        (await invoke("vision.snapshot")).config.modelLabel,
        accepted.config.modelLabel,
      );
    },
  );
  if (!baseline)
    await check(
      "High-water context supervision rotates only at clean boundary, preserving full host history and queued request",
      async () => {
        const contextTask = await invoke("task.create", {
          projectId: a.id,
          title: "Context boundary acceptance",
          description: "Keep original goal and observed history",
        });
        const contextSession = await invoke("session.create", {
          taskId: contextTask.id,
          title: "Context supervised session",
        });
        await selectTask(contextTask);
        await invoke("session.send", {
          id: contextSession.id,
          text: "hold usage-high",
        });
        await poll(
          async () =>
            (await session(contextSession.id)).context.usedTokens === 227414,
          "native usage_update retained",
        );
        await invoke("session.send", {
          id: contextSession.id,
          text: "context-after-checkpoint",
        });
        const active = await invoke("context.inspect", {
          id: contextSession.id,
        });
        assert.ok(active.envelope.highWaterTokens <= 96000);
        assert.ok(
          active.envelope.lowWaterTokens < active.envelope.highWaterTokens,
        );
        assert.equal(active.envelope.fullContextVerified, false);
        assert.ok(
          ["defer_until_boundary", "rotate_at_boundary"].includes(
            active.decision.action,
          ),
        );
        const oldState = await store(),
          oldGeneration = oldState._controls[contextSession.id].generation;
        assert.equal(
          (await prompts(projectA, "context-after-checkpoint")).length,
          0,
        );
        await finish(projectA, "hold usage-high");
        await poll(
          async () =>
            (await prompts(projectA, "context-after-checkpoint")).length ===
              1 && (await session(contextSession.id)).status === "completed",
          "new context terminal",
          20000,
        );
        const result = await session(contextSession.id),
          renewed = await invoke("context.inspect", { id: contextSession.id }),
          durable = await store();
        assert.ok(
          durable._controls[contextSession.id].generation > oldGeneration,
        );
        assert.ok(renewed.rotations >= 1);
        assert.equal(result.queue.length, 0);
        assert.equal(
          result.messages.filter((message) => message.role === "user").length,
          2,
        );
        assert.ok(
          result.messages.some((message) =>
            message.content.includes("usage-high"),
          ),
        );
        assert.equal((await prompts(projectA, "hold usage-high")).length, 1);
        proofs.push({
          stage: "context-boundary",
          initialUsed: 227414,
          highWater: active.envelope.highWaterTokens,
          lowWater: active.envelope.lowWaterTokens,
          rotations: renewed.rotations,
          originalPromptCount: 1,
          queuedDispatches: 1,
          hostHistoryPreserved: true,
          opaqueCliHistoryEdited: false,
        });
        await page.locator(".context-send-ring").press("Enter");
        await page
          .getByRole("dialog", { name: "Контекст сессии", exact: true })
          .getByText("Короткий контекст для flash", { exact: true })
          .waitFor();
        await capture("context-controls-dark.png");
        await page.keyboard.press("Escape");
        await selectTask(taskA);
      },
    );
  if (!baseline)
    await check(
      "Advanced context policy validates inline, retains invalid/stale drafts and applies explicit thresholds with CAS",
      async () => {
        await invoke("session.send", { id: parent.id, text: "usage-low-measured" });
        await poll(async () => {
          const observed = await session(parent.id);
          return observed.status === "completed" && observed.context.usedTokens === 38000;
        }, "native measured usage before a route metadata edit");
        const routeBefore = await invoke("context.inspect", { id: parent.id });
        const routeGenerationBefore = (await store())._controls[parent.id].generation;
        assert.equal(routeBefore.observedUsage.estimated, false);
        assert.equal(routeBefore.observedUsage.usedTokens, 38000);
        assert.ok(routeBefore.hostEstimate.usedTokens >= 38000);
        await input().fill("Owned draft preserved while inspecting context");
        const beforeContextMenuQueue = (await session(parent.id)).queue.length;
        await page.locator(".send-button").click({ button: "right" });
        const modal = page.getByRole("dialog", {
          name: "Контекст сессии",
          exact: true,
        });
        await modal.waitFor();
        assert.equal(await input().inputValue(), "Owned draft preserved while inspecting context");
        assert.equal((await session(parent.id)).queue.length, beforeContextMenuQueue,
          "Context inspection through right click must not dispatch or enqueue the draft");
        await modal
          .getByText("Настроить рабочий объём", { exact: true })
          .click();
        const high = modal.getByRole("textbox", {
          name: "Порог обновления контекста",
          exact: true,
        });
        const low = modal.getByRole("textbox", {
          name: "Целевой объём контекста",
          exact: true,
        });
        const route = modal.getByRole("textbox", {
          name: "Метка маршрута контекста",
          exact: true,
        });
        const apply = modal.getByRole("button", {
          name: "Применить",
          exact: true,
        });
        await high.waitFor();
        await poll(() => high.isEnabled(), "context policy loaded");
        const initial = await invoke("context.inspect", { id: parent.id });
        await high.fill("3000");
        await low.fill("4000");
        await apply.click();
        await modal.locator(".context-control-details [role=alert]").waitFor();
        assert.equal(await high.inputValue(), "3000");
        assert.equal(await low.inputValue(), "4000");
        assert.deepEqual(
          (await invoke("context.inspect", { id: parent.id })).policy,
          initial.policy,
        );
        await high.fill("64000");
        await low.fill("40000");
        await route.fill("owned-ui-route");
        await apply.click();
        await poll(
          async () =>
            (await invoke("context.inspect", { id: parent.id })).policy
              .highWaterTokens === 64000,
          "valid context policy durable",
        );
        await poll(
          async () => (await high.isEnabled()) && (await apply.isDisabled()),
          "context policy receipt accepted",
        );
        let accepted = await invoke("context.inspect", { id: parent.id });
        assert.equal(accepted.envelope.highWaterTokens, 64000);
        assert.equal(accepted.envelope.lowWaterTokens, 40000);
        assert.notEqual(accepted.envelope.modelKey, routeBefore.envelope.modelKey);
        assert.equal((await store())._controls[parent.id].generation, routeGenerationBefore,
          "Editing route metadata must not pretend that the actual CLI generation changed");
        assert.ok(accepted.hostEstimate.usedTokens >= routeBefore.hostEstimate.usedTokens,
          "Changing route metadata must preserve accumulated known context in the same executor");
        assert.equal(accepted.observedUsage.estimated, true,
          "Old-route native usage must not be presented as a measurement of the renamed route");
        assert.equal(accepted.observedUsage.basis, "host_estimate");
        proofs.push({ stage: "context-route-metadata", generationUnchanged: true,
          knownHostTokensBefore: routeBefore.hostEstimate.usedTokens,
          knownHostTokensAfter: accepted.hostEstimate.usedTokens,
          priorRouteNativeMeasurementReusedAsActual: false,
          priorRoutePressureRetainedAsEstimate: true,
          calibratedRecallEvidenceExercised: false });
        const displayed = await modal
          .locator(".context-stats > div")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              label: element.querySelector("dt")?.textContent,
              value: element
                .querySelector("dd")
                ?.textContent?.replace(/\D/g, ""),
            })),
          );
        assert.equal(
          displayed.find((item) => item.label === "Порог обновления").value,
          "64000",
        );
        assert.equal(
          displayed.find((item) => item.label === "Целевой объём").value,
          "40000",
        );
        await invoke("context.policy", {
          patch: { highWaterTokens: 62000, lowWaterTokens: 38000 },
          expectedPolicy: accepted.policy,
        });
        await high.fill("63000");
        await low.fill("39000");
        await apply.click();
        await modal.locator(".context-control-details [role=alert]").waitFor();
        assert.equal(await high.inputValue(), "63000");
        assert.equal(await low.inputValue(), "39000");
        assert.equal(
          (await invoke("context.inspect", { id: parent.id })).policy
            .highWaterTokens,
          62000,
        );
        await modal
          .getByRole("button", { name: "Обновить показания CLI", exact: true })
          .click();
        await poll(() => high.isEnabled(), "context policy refresh");
        assert.equal(await high.inputValue(), "63000");
        await apply.click();
        await poll(
          async () =>
            (await invoke("context.inspect", { id: parent.id })).policy
              .highWaterTokens === 63000,
          "retained policy applied after explicit refresh",
        );
        accepted = await invoke("context.inspect", { id: parent.id });
        assert.equal(accepted.policy.lowWaterTokens, 39000);
        assert.equal(accepted.calibrationAvailable, false);
        await capture("context-policy-dark.png");
        await page.keyboard.press("Escape");
        await modal.waitFor({ state: "hidden" });
        await input().fill("");
        proofs.push({
          stage: "context-policy",
          rightClickOpenedWithoutSending: true,
          invalidRetained: true,
          staleCASRejected: true,
          refreshedDraftApplied: true,
          highWater: 63000,
          lowWater: 39000,
          calibrationAvailable: false,
          paidRequests: 0,
        });
      },
    );
  await check(
    "Actual desktop light/dark 1024/1440 settings and worker controls fit; Escape dismisses settings",
    async () => {
      for (const theme of ["dark", "light"])
        for (const width of [1440, 1024]) {
          const toast = page.locator(".error-toast");
          if (await toast.count()) {
            await toast.getByRole("button", { name: "Закрыть сообщение", exact: true }).click();
            await toast.waitFor({ state: "hidden" });
            proofs.push({ stage: "notification-dismissal", beforeDesktopWidth: width, theme });
          }
          await invoke("settings.update", { patch: { theme } });
          await application.evaluate(
            ({ BrowserWindow }, { width, id }) =>
              BrowserWindow.fromId(id).setContentSize(width, 900),
            { width, id: info.windowId },
          );
          await poll(
            () =>
              page.evaluate(
                (theme) => document.documentElement.dataset.theme === theme,
                theme,
              ),
            `${theme} applied`,
          );
          await page
            .getByRole("button", { name: "Настройки", exact: true })
            .first()
            .click();
          const modal = page.getByRole("dialog", {
            name: "Настройки",
            exact: true,
          });
          await modal
            .getByRole("button", { name: "Визуальные проверки", exact: true })
            .click();
          await modal.getByLabel("Аргументы · JSON", { exact: true }).waitFor();
          const bounds = await modal.boundingBox();
          assert.ok(
            bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= width + 1 &&
              bounds.y + bounds.height <= 901,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            true,
          );
          const fields = await geometry(
            ".vision-settings .field, .settings-desktop-grid",
          );
          assert.ok(fields.every((field) => field.width > 0));
          const controls = await visibleControlMetrics(modal);
          assert.ok(controls.length >= 8, "Expected actual visible settings controls");
          assert.deepEqual(controls.filter((control) => !control.centreHit), [],
            "A visible settings control is covered at its centre");
          proofs.push({
            stage: "desktop-fit",
            theme,
            width,
            modal: bounds,
            fieldCount: fields.length,
            controls,
          });
          await capture(`vision-settings-${theme}-${width}.png`);
          await page.keyboard.press("Escape");
          await modal.waitFor({ state: "hidden" });
          const workers = page.locator(".managed-agents-panel").first();
          await workers.waitFor({ state: "visible" });
          const workerControls = await visibleControlMetrics(workers);
          assert.ok(workerControls.length >= 5, "Expected actual visible managed worker controls");
          assert.deepEqual(workerControls.filter((control) => !control.centreHit), [],
            "A visible worker control is covered at its centre");
          proofs.push({ stage: "managed-desktop-fit", theme, width, controls: workerControls });
          await capture(`managed-workers-${theme}-${width}.png`);
        }
    },
  );
  await check(
    "Execution settings edit and durably restore managed admission limits without sending a prompt",
    async () => {
      const original = (await state()).settings;
      const beforePrompts = (await events(projectA)).filter((event) => event.type === "prompt").length;
      await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
      const modal = page.getByRole("dialog", { name: "Настройки", exact: true });
      await modal.getByRole("button", { name: "Выполнение", exact: true }).click();
      await modal.getByText("Управляемые исполнители", { exact: true }).click();
      const parentLimit = modal.getByRole("spinbutton", { name: "Лимит исполнителей координатора", exact: true });
      const attempts = modal.getByRole("spinbutton", { name: "Лимит попыток исполнителя", exact: true });
      const budget = modal.getByRole("spinbutton", { name: "Общий резерв контекста исполнителей", exact: true });
      const crossProject = modal.getByRole("checkbox", { name: "Разрешать новые межпроектные обращения", exact: true });
      const save = modal.locator(".settings-footer").getByRole("button", { name: "Сохранить", exact: true });
      const waitSaveReceipt = () => poll(async () => await save.isDisabled() &&
        await save.getAttribute("aria-busy") !== "true" &&
        !(await modal.locator(".settings-footer").innerText()).includes("Есть несохранённые изменения"),
      "managed settings save acknowledged in renderer snapshot");
      await parentLimit.fill("3");
      await attempts.fill("4");
      await budget.fill("48000");
      await crossProject.uncheck();
      await save.click();
      await poll(async () => {
        const settings = (await store()).settings;
        return settings.managedMaxPerParent === 3 && settings.managedAttempts === 4 &&
          settings.managedContextBudgetTokens === 48000 && settings.allowCrossProjectCoordination === false;
      }, "managed execution limits durably saved from actual form");
      await waitSaveReceipt();
      await parentLimit.scrollIntoViewIfNeeded();
      await capture("execution-settings-light-1024.png");
      await parentLimit.fill(String(original.managedMaxPerParent ?? 2));
      await attempts.fill(String(original.managedAttempts ?? 3));
      await budget.fill(String(original.managedContextBudgetTokens ?? 32000));
      await crossProject.setChecked(original.allowCrossProjectCoordination !== false);
      await save.click();
      await poll(async () => {
        const settings = (await store()).settings;
        return settings.managedMaxPerParent === (original.managedMaxPerParent ?? 2) &&
          settings.managedAttempts === (original.managedAttempts ?? 3) &&
          settings.managedContextBudgetTokens === (original.managedContextBudgetTokens ?? 32000) &&
          settings.allowCrossProjectCoordination === (original.allowCrossProjectCoordination !== false);
      }, "original managed settings durably restored from actual form");
      await waitSaveReceipt();
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert.equal((await events(projectA)).filter((event) => event.type === "prompt").length, beforePrompts);
      proofs.push({ stage: "managed-execution-settings", accepted: {
        managedMaxPerParent: 3, managedAttempts: 4, managedContextBudgetTokens: 48000,
        allowCrossProjectCoordination: false }, durableReadback: true, originalRestored: true,
        additionalACPPrompts: 0 });
    },
  );
  await check(
    "Fake bridge secret absent from plaintext logs/state/rendered UI and no renderer exceptions",
    async () => {
      assert.ok(visionConfig, "Prerequisite: accepted vision configuration is required for secret-leak assertions");
      const exercisedVision = (await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8"))
        .trim().split("\n").filter(Boolean).map(JSON.parse);
      assert.ok(exercisedVision.some((event) => event.type === "call"),
        "Secret-leak assertions require an actual owned MCP tool invocation");
      const files = [];
      const walk = async (directory) => {
        for (const entry of await fs.readdir(directory, {
          withFileTypes: true,
        })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(file);
          else if (/\.(?:json|jsonl|log|txt)$/i.test(file)) files.push(file);
        }
      };
      await walk(dataDir);
      for (const file of files) {
        const stat = await fs.stat(file);
        if (stat.size <= 10 * 1024 ** 2)
          assert.equal(
            (await fs.readFile(file, "utf8")).includes(fakeSecret),
            false,
            `Secret leaked to ${path.relative(dataDir, file)}`,
          );
      }
      assert.equal(
        (await page.locator("body").innerText()).includes(fakeSecret),
        false,
      );
      assert.deepEqual(rendererErrors, []);
    },
  );
  assert.deepEqual(
    await sourceHashes(),
    before,
    "Product/driver source changed during acceptance; freeze then rerun",
  );
} catch (error) {
  failure = {
    test: current,
    message: String(error?.message ?? error)
      .replaceAll(fakeSecret, "[redacted]")
      .replaceAll(temp, "<owned-temp>")
      .slice(0, 3000),
  };
  console.error(`FAIL ${current}: ${failure.message}`);
  process.exitCode = 1;
  try {
    if (page) {
      // Owned fixture state only: preserve enough host facts to diagnose recovery
      // failures without serializing native requests, environments, or credentials.
      const observed = await state();
      proofs.push({
        stage: "failure-host-state",
        sessions: observed.sessions.slice(0, 40).map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          error: item.error?.replaceAll(fakeSecret, "[redacted]").slice(0, 1500),
          queueLength: item.queue.length,
          phase: item.managed?.phase,
          effectFence: item.managed?.effectFence,
          canRetry: item.managed?.canRetry,
          attempts: item.managed?.attempts,
          reconciliationCount: item.managed?.reconciliations?.length,
          messages: item.messages.slice(-10).map((message) => ({
            id: message.id,
            role: message.role,
            outcome: message.outcome,
            tools: message.tools?.map((tool) => ({ id: tool.id, status: tool.status })),
          })),
        })),
      });
      await capture("failure.png");
    }
  } catch {}
} finally {
  if (launchAttempted && !application) cleanup = "launch-exit-unconfirmed";
  if (application) {
    try {
      const ownedApplicationProcess = application.process();
      await application.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await application.close();
      await poll(() => ownedApplicationProcess.exitCode !== null ||
        ownedApplicationProcess.signalCode !== null, "owned Electron process exit observed", 5000);
      electronExit = { code: ownedApplicationProcess.exitCode, signal: ownedApplicationProcess.signalCode };
      assert.equal(electronExit.code, 0,
        "Electron shutdown must acknowledge success; a forced app.exit(1) is not a clean shutdown");
      assert.equal(electronExit.signal, null);
      cleanup = "closed";
    } catch (error) {
      cleanup = "exit-unconfirmed";
      failure ||= {
        test: "cleanup",
        message: String(error?.message ?? error).slice(0, 1000),
      };
      process.exitCode = 1;
    }
  }
  await fs.mkdir(output, { recursive: true });
  const fixtureEvents = [];
  for (const project of [projectA, projectB])
    fixtureEvents.push({
      project: project === projectA ? "frontend" : "backend",
      events: (await events(project)).map((event) => ({
        ...event,
        command: event.command?.replaceAll(fakeSecret, "[redacted]"),
      })),
    });
  let visionEvents = [];
  try { visionEvents = (await fs.readFile(path.join(temp, "vision-events.jsonl"), "utf8"))
    .trim().split("\n").filter(Boolean).map(JSON.parse); } catch {}
  const ownedPids = [...new Set([...fixtureEvents.flatMap((item) => item.events), ...visionEvents]
    .map((event) => event.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  const running = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  };
  if (cleanup === "closed") {
    try {
      await poll(() => ownedPids.every((pid) => !running(pid)),
        "all observed owned ACP child processes exited", 5000);
    } catch (error) {
      cleanup = "owned-child-exit-unconfirmed";
      failure ||= { test: "cleanup", message: error.message };
      process.exitCode = 1;
    }
  }
  const report = {
    schemaVersion: 1,
    status: failure ? "failed" : baseline ? "partial-baseline" : "passed",
    platform: process.platform,
    time: new Date().toISOString(),
    scope:
      "Actual built Electron App with owned deterministic ACP/MCP fixture processes; no paid/real vision model/corporate service",
    baseline,
    diagnosticContinue,
    checks,
    failure,
    proofs,
    captures,
    rendererErrors,
    sourceHashes: before,
    paidRequests: 0,
    cleanup,
    electronExit,
    ownedProcesses: { observed: ownedPids.length, remaining: ownedPids.filter(running) },
    fixtureEvents,
    visionEvents,
  };
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (cleanup === "closed" || cleanup === "not-started")
    await fs.rm(temp, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      status: report.status,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
      cleanup,
      report: path.join(output, "report.json"),
    }),
  );
}
