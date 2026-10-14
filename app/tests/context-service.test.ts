import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WorkbenchService,
  type WorkbenchOptions,
} from "../electron/service.js";

// Owned scripted ACP process, not a real model/context-capacity benchmark.
const script = String.raw`import readline from 'node:readline';
import { appendFileSync } from 'node:fs'; import path from 'node:path';
let remote = 'ctx-'+process.pid, pending, model = process.argv[process.argv.indexOf('--model')+1] || 'fixture';
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const reply=(id,result)=>send({jsonrpc:'2.0',id,result});
const update=update=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:remote,update}});
const log=v=>appendFileSync(path.join(process.cwd(),'context-fixture.jsonl'),JSON.stringify(v)+'\n');
const config=()=>[{id:'model',name:'Model',category:'model',currentValue:model,options:[{value:'fixture',name:'Fixture'},{value:'fixture-other',name:'Other'}]}];
readline.createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);
if(q.method==='initialize')reply(q.id,{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'owned-context-fixture',version:'1'}});
if(q.method==='session/new'){log({type:'new',pid:process.pid});reply(q.id,{sessionId:remote,configOptions:config()});}
if(q.method==='session/set_config_option'){if(q.params.configId==='model')model=q.params.value;reply(q.id,{configOptions:config()});}
if(q.method==='session/prompt'){
 const content=q.params.prompt[0].text; const command=content.includes('Current user message:\n')?content.split('Current user message:\n').at(-1):content;
 log({type:'prompt',pid:process.pid,command,content,model}); pending=q.id;
 if(command.includes('#usage-high')){update({sessionUpdate:'usage_update',usedTokens:227414,limitTokens:262144});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'IMPORTANT: This conversation was compressed (compressed from: 227414 to 203202 tokens)\n'}});update({sessionUpdate:'usage_update',usedTokens:203202,limitTokens:262144});}
 else if(!command.includes('#no-usage'))update({sessionUpdate:'usage_update',usedTokens:command.includes('#base-high')?203202:5000,limitTokens:262144});
 if(command.includes('#unresolved'))update({sessionUpdate:'tool_call',toolCallId:'native-write-uncertain',title:'Native write',status:'in_progress'});
 update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:command.includes('#long-response')?'x'.repeat(20000):'Observed scripted ACP response.'}});
 setTimeout(()=>{if(pending===q.id){reply(q.id,{stopReason:'end_turn'});pending=undefined;}},30);
}
if(q.method==='session/cancel'&&pending){reply(pending,{stopReason:'cancelled'});pending=undefined;}
});`;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function until(test: () => boolean, timeout = 10000) {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > timeout)
      throw new Error("Context service condition timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function setup(adapter?: WorkbenchOptions["contextCalibration"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-service-"));
  const bundle = path.join(root, "bundle"),
    projectPath = path.join(root, "project"),
    cliPath = path.join(root, "context-fixture.mjs");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(bundle, "CORE.md"),
    "Use current facts. Preserve unknown operation identities.",
  );
  for (const role of ["analyst", "backend"])
    await fs.writeFile(
      path.join(bundle, "profiles", `${role}.md`),
      `# ${role}\nActual ${role} fixture instructions.`,
    );
  await fs.writeFile(cliPath, script);
  const options: WorkbenchOptions = {
    dataDir: path.join(root, "data"),
    bundleDir: bundle,
    emit: () => undefined,
    cancelTimeoutMs: 80,
    routeProfile: async () => ({
      profileId: "backend",
      reason: "Actual scripted test.",
      confidence: 1,
    }),
    contextCalibration: adapter,
  };
  const service = new WorkbenchService(options);
  await service.init();
  cleanups.push(async () => {
    await service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.invoke("settings.update", {
    patch: { cliPath, cliArgs: ["--acp"], model: "fixture", startupRetries: 0 },
  });
  const project = await service.invoke("project.create", {
    name: "Context",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Accepted context task",
    description: "Preserve this goal and real receipt identities.",
  });
  const session = await service.invoke("session.create", { taskId: task.id });
  const current = () =>
    service.snapshot().sessions.find((entry) => entry.id === session.id)!;
  const settled = () =>
    !(service as any).launches.has(session.id) &&
    ["completed", "idle", "failed", "unknown"].includes(current().status);
  const send = async (text: string) => {
    await service.invoke("session.send", { id: session.id, text });
    await until(
      () =>
        settled() &&
        current().messages.some(
          (message) => message.role === "user" && message.content === text,
        ),
    );
  };
  const logs = async () => {
    try {
      return (
        await fs.readFile(
          path.join(projectPath, "context-fixture.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  return { service, options, root, session, current, settled, send, logs };
}

describe("actual host context lifecycle over an owned scripted ACP process", () => {
  it("retains an old unknown tool after explicit non-managed recovery and dispatches only a new small diagnostic", async () => {
    const x = await setup();
    await x.send("#unresolved old uncertain tool");
    const previous = x
      .current()
      .messages.filter((message) => message.role === "assistant")
      .at(-1)!;
    expect(previous.tools?.[0].status).toBe("in_progress");
    await x.service.invoke("session.recover", {
      id: x.session.id,
      note: "Inspect facts only; do not replay earlier effects.",
    });
    await x.service.invoke("queue.resume", { id: x.session.id });
    await x.send("new-small-diagnostic");
    expect(
      (await x.logs())
        .filter((entry) => entry.type === "prompt")
        .map((entry) => entry.command),
    ).toEqual(["#unresolved old uncertain tool", "new-small-diagnostic"]);
    expect(
      x.current().messages.find((message) => message.id === previous.id)
        ?.tools?.[0].status,
    ).toBe("in_progress");
  });
  it("records 227414 to 203202 usage, rotates once at the next clean boundary, and sends only the unsent new request", async () => {
    const x = await setup();
    await x.send("#usage-high accepted-original-goal");
    expect(x.current().context.usedTokens).toBe(203202);
    await x.send("#small-next new-authorized-request");
    const logs = await x.logs(),
      prompts = logs.filter((entry) => entry.type === "prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[0].pid).not.toBe(prompts[1].pid);
    expect(prompts[1].command).toBe("#small-next new-authorized-request");
    expect(prompts[1].content).toContain("HOST RECOVERY PACKET");
    expect(prompts[1].content).toContain("task_history:");
    expect(
      x.current().messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
    const info = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(info.rotations).toBe(1);
    expect(info.lastRotation.beforeTokens).toBeGreaterThanOrEqual(203202);
    expect(info.lastRotation.beforeTokens).toBeLessThan(203300);
    expect(info.lastRotation.checkpointBytes).toBeLessThanOrEqual(24000);
  });
  it("uses labelled known-byte pressure on an unknown CLI with no usage events and renews without copying retained history", async () => {
    const x = await setup();
    await x.service.invoke("context.policy", {
      patch: { highWaterTokens: 6000, lowWaterTokens: 3000 },
    });
    await x.send("#no-usage #long-response accepted brief");
    const before = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(before.observedUsage).toMatchObject({
      estimated: true,
      basis: "host_estimate",
    });
    expect(before.observedUsage.usedTokens).toBeGreaterThan(10000);
    await x.send("#no-usage new-small-request");
    const prompts = (await x.logs()).filter((entry) => entry.type === "prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[0].pid).not.toBe(prompts[1].pid);
    expect(prompts[1].command).toBe("#no-usage new-small-request");
    const after = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(after.rotations).toBe(1);
    expect(after.observedUsage).toMatchObject({
      estimated: true,
      basis: "host_estimate",
    });
    expect(after.observedUsage.usedTokens).toBeLessThan(6000);
    expect(
      x.current().messages.some((message) => message.content.length === 20000),
    ).toBe(true);
  });
  it("retains an oversized single input and dispatches nothing until the user edits and resumes it", async () => {
    const x = await setup();
    await x.service.invoke("context.policy", {
      patch: { highWaterTokens: 6000, lowWaterTokens: 3000 },
    });
    const text = "x".repeat(20000);
    await x.service.invoke("session.send", { id: x.session.id, text });
    await until(() => x.current().error?.includes("single input") === true);
    expect(x.current().queue[0].text).toBe(text);
    expect(await x.logs()).toEqual([]);
    const entry = x.current().queue[0];
    await x.service.invoke("queue.update", {
      sessionId: x.session.id,
      id: entry.id,
      expectedText: text,
      text: "short corrected input",
    });
    await x.service.invoke("queue.resume", { sessionId: x.session.id });
    await until(() => x.current().status === "completed" && x.settled());
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("does not override a user cancellation while an automatic context retirement is awaiting disposal", async () => {
    const x = await setup();
    await x.send("#usage-high original");
    const live = (x.service as any).live.get(x.session.id),
      dispose = live.client.dispose.bind(live.client);
    let entered = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    live.client.dispose = async () => {
      entered = true;
      await gate;
      await dispose();
    };
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "#small-next preserve-after-cancel",
    });
    await until(() => entered);
    await x.service.invoke("session.cancel", { id: x.session.id });
    release();
    await until(() => x.settled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(x.current().queue[0].text).toBe("#small-next preserve-after-cancel");
    expect((x.service as any).store.read()._controls[x.session.id].paused).toBe(
      true,
    );
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("retains old unknown operation identities in the recovery packet while dispatching only a fresh explicit request", async () => {
    const x = await setup();
    await x.send("#usage-high original");
    await (x.service as any).store.update((state: any) => {
      const session = state.sessions.find(
        (entry: any) => entry.id === x.session.id,
      );
      session.messages.unshift({
        id: "old-uncertain-message",
        role: "assistant",
        content: "Historical unknown native write",
        at: new Date(0).toISOString(),
        outcome: "unknown",
        tools: [
          {
            id: "write-receipt-old",
            title: "Historical write",
            status: "in_progress",
          },
        ],
      });
    });
    await x.send("#small-next inspect-fresh-only");
    const prompts = (await x.logs()).filter((entry) => entry.type === "prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
    expect(prompts[1].content).toContain("UNKNOWN write-receipt-old");
    expect(prompts[1].command).toBe("#small-next inspect-fresh-only");
    expect(
      x
        .current()
        .messages.find((message) => message.id === "old-uncertain-message")
        ?.tools?.[0].status,
    ).toBe("in_progress");
  });
  it("holds a new input after a high-pressure end_turn with a current unresolved tool instead of silently bypassing the context gate", async () => {
    const x = await setup();
    await x.send("#usage-high #unresolved current-write");
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "must-remain-unsent",
    });
    await until(() => x.settled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      x.current().queue.some((entry) => entry.text === "must-remain-unsent"),
    ).toBe(true);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("bounds repeated clean renewals when the fresh native base remains above the configured high-water threshold", async () => {
    const x = await setup();
    await x.send("#base-high first");
    await x.send("#base-high second");
    await x.send("#base-high third");
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "#base-high must-hold-fourth",
    });
    await until(() => x.settled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      x
        .current()
        .queue.some((entry) => entry.text.includes("must-hold-fourth")),
    ).toBe(true);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(3);
    const info = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(info.decision.action).toBe("hold_configuration");
  });
});

describe("opt-in isolated calibration and actual durable host ledger", () => {
  it("keeps pre-first-prompt calibration evidence after preparing and using the same actual runtime identity", async () => {
    const x = await setup({
      quoteCeilingUsd: () => 0,
      execute: async (probe) => ({
        output: JSON.stringify(probe.oracle),
        promptTokens: 32000,
      }),
    });
    const result = await x.service.invoke("context.calibrate", {
      id: x.session.id,
      explicitlyEnabled: true,
      maxBudgetUsd: 0.01,
      inputBytes: [2048],
    });
    await x.send("#small-next first-real-scripted-turn");
    const info = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(info.envelope.modelKey).toBe(result.modelKey);
    expect(info.envelope.observedRecallTokens).toBe(32000);
  });
  it("reserves its session while an isolated calibration is pending so queued work cannot change the measured route mid-probe", async () => {
    let entered = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const x = await setup({
      quoteCeilingUsd: () => 0,
      execute: async (probe) => {
        entered = true;
        await gate;
        return { output: JSON.stringify(probe.oracle), promptTokens: 32000 };
      },
    });
    const calibration = x.service.invoke("context.calibrate", {
      id: x.session.id,
      explicitlyEnabled: true,
      maxBudgetUsd: 0.01,
      inputBytes: [2048],
    });
    const observed = calibration.catch((error) => error);
    await until(() => entered);
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "#small-next after-calibration",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(0);
    release();
    expect(await observed).not.toBeInstanceOf(Error);
    await until(() => x.current().status === "completed" && x.settled());
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("cancels a pending isolated calibration as UNKNOWN without issuing another probe or claiming a paid result", async () => {
    let calls = 0,
      entered = false,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const x = await setup({
      quoteCeilingUsd: () => 0,
      execute: async (probe, _identity, signal) => {
        calls++;
        entered = true;
        await gate;
        signal.throwIfAborted();
        return { output: JSON.stringify(probe.oracle), promptTokens: 32000 };
      },
    });
    const calibration = x.service.invoke("context.calibrate", {
      id: x.session.id,
      explicitlyEnabled: true,
      maxBudgetUsd: 0.01,
      inputBytes: [2048, 4096],
    });
    const observed = calibration.catch((error) => error);
    await until(() => entered);
    try {
      await x.service.invoke("context.calibration.cancel", {
        id: x.session.id,
      });
      await observed;
    } finally {
      release();
    }
    expect(calls).toBe(1);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(0);
    expect(x.current().queue).toHaveLength(0);
    const file = JSON.parse(
      await fs.readFile(path.join(x.options.dataDir, "state.json"), "utf8"),
    );
    expect(file._contextCalibrationReceipts.at(-1).status).toBe("unknown");
  });
  it("never invokes an adapter without explicit enablement or without a verified adapter", async () => {
    let calls = 0;
    const x = await setup({
      quoteCeilingUsd: () => 0,
      execute: async (probe) => {
        calls++;
        return { output: JSON.stringify(probe.oracle), promptTokens: 32000 };
      },
    });
    await expect(
      x.service.invoke("context.calibrate", {
        id: x.session.id,
        explicitlyEnabled: false,
        maxBudgetUsd: 0.01,
        inputBytes: [2048],
      }),
    ).rejects.toThrow(/disabled/);
    expect(calls).toBe(0);
    x.options.contextCalibration = undefined;
    await expect(
      x.service.invoke("context.calibrate", {
        id: x.session.id,
        explicitlyEnabled: true,
        maxBudgetUsd: 0.01,
        inputBytes: [2048],
      }),
    ).rejects.toThrow(/adapter/);
    expect(calls).toBe(0);
  });
  it("persists dispatch intent and its reserved price before the isolated adapter executes, then retains measured evidence across restart", async () => {
    const x = await setup();
    let calls = 0;
    x.options.contextCalibration = {
      quoteCeilingUsd: () => 0.001,
      execute: async (probe) => {
        calls++;
        const file = JSON.parse(
          await fs.readFile(path.join(x.options.dataDir, "state.json"), "utf8"),
        );
        const intent = file._contextCalibrationReceipts.find(
          (entry: any) => entry.id === probe.id,
        );
        expect(intent).toMatchObject({
          status: "unknown",
          phase: "dispatch_intent",
          inputBytes: probe.inputBytes,
        });
        expect(intent.chargedBudgetUsd ?? intent.quotedCeilingUsd).toBe(0.001);
        return {
          output: JSON.stringify(probe.oracle),
          promptTokens: 32000,
          requestReference: "owned-calibration-request",
        };
      },
    };
    const result = await x.service.invoke("context.calibrate", {
      id: x.session.id,
      explicitlyEnabled: true,
      maxBudgetUsd: 0.01,
      inputBytes: [2048],
    });
    expect(calls).toBe(1);
    expect(result.fullContextVerified).toBe(false);
    expect(result.receipts[0].status).toBe("recall_passed");
    await x.service.dispose();
    const restored = new WorkbenchService(x.options);
    await restored.init();
    cleanups.push(() => restored.dispose());
    const info = await restored.invoke("context.inspect", { id: x.session.id });
    expect(info.envelope.observedRecallTokens).toBe(32000);
    expect(info.envelope.fullContextVerified).toBe(false);
  });
  it("retains old-route receipts after a route change and does not apply their evidence to the newly selected model", async () => {
    const x = await setup();
    let entered = false,
      release!: () => void,
      calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    x.options.contextCalibration = {
      quoteCeilingUsd: () => 0,
      execute: async (probe) => {
        calls++;
        entered = true;
        await gate;
        return { output: JSON.stringify(probe.oracle), promptTokens: 32000 };
      },
    };
    const calibration = x.service.invoke("context.calibrate", {
      id: x.session.id,
      explicitlyEnabled: true,
      maxBudgetUsd: 0.01,
      inputBytes: [2048, 4096],
    });
    const observed = calibration.catch((error) => error);
    await until(() => entered);
    await x.service.invoke("session.update", {
      id: x.session.id,
      model: "fixture-other",
    });
    release();
    expect(await observed).toBeInstanceOf(Error);
    expect(calls).toBe(1);
    const info = await x.service.invoke("context.inspect", {
      id: x.session.id,
    });
    expect(info.envelope.observedRecallTokens).toBeUndefined();
    const file = JSON.parse(
      await fs.readFile(path.join(x.options.dataDir, "state.json"), "utf8"),
    );
    expect(file._contextCalibrationReceipts.length).toBeGreaterThanOrEqual(1);
  });
});
