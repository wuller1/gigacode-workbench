import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorkbenchService,
  type WorkbenchOptions,
} from "../electron/service.js";
import { UiMcpServer } from "../electron/mcp.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function until(test: () => boolean, timeout = 10000) {
  const started = Date.now();
  while (!test()) {
    if (Date.now() - started > timeout)
      throw new Error("Managed runtime condition timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function setup(router?: WorkbenchOptions["routeProfile"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "managed-service-"));
  const bundle = path.join(root, "bundle"),
    projectPath = path.join(root, "project");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(bundle, "CORE.md"),
    "Use facts, preserve accepted scope.",
  );
  for (const role of ["analyst", "backend", "qa"])
    await fs.writeFile(
      path.join(bundle, "profiles", `${role}.md`),
      `# ${role}\nActual ${role} role.`,
    );
  const options: WorkbenchOptions = {
    dataDir: path.join(root, "data"),
    bundleDir: bundle,
    emit: () => undefined,
    cancelTimeoutMs: 80,
    routeProfile:
      router ||
      (async () => ({
        profileId: "backend",
        reason: "Actual fixture routing.",
        confidence: 1,
      })),
  };
  const service = new WorkbenchService(options);
  await service.init();
  cleanups.push(async () => {
    await service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.invoke("settings.update", {
    patch: {
      cliPath: fileURLToPath(
        new URL("./fixtures/acp-fixture.mjs", import.meta.url),
      ),
      cliArgs: ["--acp"],
      startupRetries: 0,
    },
  });
  const project = await service.invoke("project.create", {
    name: "Backend",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Accepted task",
    description: "Use the accepted contract.",
  });
  const parent = await service.invoke("session.create", {
    taskId: task.id,
    title: "Coordinator",
  });
  const spawn = async (operationId: string, prompt: string, extra = {}) =>
    (
      await service.invoke("agent.spawn", {
        parentId: parent.id,
        title: operationId,
        prompt,
        operationId,
        ...extra,
      })
    ).session;
  const current = (sessionId: string) =>
    service.snapshot().sessions.find((session) => session.id === sessionId)!;
  const logs = async (dir = projectPath) =>
    (await fs.readFile(path.join(dir, "fixture-events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return {
    service,
    root,
    options,
    project,
    projectPath,
    task,
    parent,
    spawn,
    current,
    logs,
  };
}

describe("actual managed service ownership, retries, and coordination", () => {
  it("retains the unresolved tool history but permits fresh work only after an exact human host attestation of the stopped turn", async () => {
    const x = await setup();
    const child = await x.spawn(
      "verified-unresolved-tool",
      "hold ui unresolved-tool",
    );
    await until(() =>
      x
        .current(child.id)
        .messages.some((message) =>
          message.tools?.some((tool) => tool.status === "in_progress"),
        ),
    );
    const covered = x
      .current(child.id)
      .messages.filter((message) => message.role === "assistant")
      .at(-1)!;
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/crash", {})
      .catch(() => undefined);
    await until(
      () =>
        x.current(child.id).status === "unknown" &&
        !(x.service as any).launches.has(child.id),
    );
    await x.service.invoke("agent.reconcile", {
      id: child.id,
      outcome: "not_applied",
      evidenceRefs: ["host:actual-scripted-turn-readback"],
      operationId: "exact-turn-readback",
    });
    expect(
      x.current(child.id).managed?.reconciliations?.[0].assistantMessageId,
    ).toBe(covered.id);
    await x.service.invoke("session.send", {
      id: child.id,
      text: "fresh-after-exact-turn-verification",
    });
    await until(
      () =>
        x.current(child.id).status === "completed" &&
        !(x.service as any).launches.has(child.id),
    );
    expect(
      x.current(child.id).messages.find((message) => message.id === covered.id)
        ?.tools?.[0].status,
    ).toBe("in_progress");
    expect(
      (await x.logs())
        .filter((entry) => entry.type === "prompt")
        .map((entry) => entry.command),
    ).toEqual([
      "hold ui unresolved-tool",
      "fresh-after-exact-turn-verification",
    ]);
  });
  it("accepts a fresh direct child-chat message after human attestation without replaying the original failed prompt", async () => {
    const x = await setup();
    const child = await x.spawn("chat-after-verification", "exit");
    await until(
      () =>
        x.current(child.id).status === "unknown" &&
        !(x.service as any).launches.has(child.id),
    );
    await x.service.invoke("agent.reconcile", {
      id: child.id,
      outcome: "applied",
      evidenceRefs: ["host:direct-chat-readback"],
      operationId: "direct-chat-attestation",
    });
    await x.service.invoke("session.send", {
      id: child.id,
      text: "fresh-direct-child-chat",
    });
    await until(
      () =>
        x.current(child.id).status === "completed" &&
        !(x.service as any).launches.has(child.id),
    );
    const prompts = (await x.logs()).filter((entry) => entry.type === "prompt");
    expect(prompts.map((entry) => entry.command)).toEqual([
      "exit",
      "fresh-direct-child-chat",
    ]);
    expect(prompts[0].pid).not.toBe(prompts[1].pid);
    expect(x.current(child.id).managed?.phase).toBe("completed");
    expect(
      x.current(child.id).managed?.reconciliations?.[0].humanRequestId,
    ).toBe("direct-chat-attestation");
  });
  it("rejects a fresh followup when an earlier undispatched input remains after failure and preserves that exact queue entry", async () => {
    const x = await setup(async () => {
      throw new Error("Permanent classifier schema mismatch");
    });
    const child = await x.spawn(
      "predispatch-failure",
      "original-undispatched-goal",
    );
    await until(
      () =>
        x.current(child.id).managed?.phase === "failed" &&
        !(x.service as any).launches.has(child.id),
    );
    const original = x.current(child.id).queue[0];
    await expect(
      x.service.invoke("agent.followup", {
        id: child.id,
        text: "new-fresh-goal",
      }),
    ).rejects.toThrow(/Unsent work is still retained/);
    await expect(
      x.service.invoke("session.send", {
        id: child.id,
        text: "new-direct-chat-goal",
      }),
    ).rejects.toThrow(/Unsent work is still retained/);
    expect(x.current(child.id).queue).toEqual([original]);
    expect(x.current(child.id).managed?.phase).toBe("failed");
    expect(
      x.current(child.id).messages.filter((message) => message.role === "user"),
    ).toHaveLength(0);
    const log = await fs
      .readFile(path.join(x.projectPath, "fixture-events.jsonl"), "utf8")
      .catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
    expect(log).toBe("");
  });
  it("records an idempotent human not-applied attestation only after the owner stops, then retries captured human input only on an explicit action", async () => {
    const x = await setup();
    const child = await x.spawn("verified-retry", "ignore-cancel");
    await until(() => x.current(child.id).status === "running");
    await expect(
      x.service.invoke("agent.reconcile", {
        id: child.id,
        outcome: "not_applied",
        evidenceRefs: ["host:fixture-no-external-effects"],
        operationId: "readback-1",
      }),
    ).rejects.toThrow(/actual owned worker executor/);
    await x.service.invoke("agent.control", { id: child.id, action: "cancel" });
    await until(() => !(x.service as any).launches.has(child.id));
    const params = {
      id: child.id,
      outcome: "not_applied",
      evidenceRefs: ["host:fixture-no-external-effects"],
      operationId: "readback-1",
    };
    const verified = await x.service.invoke("agent.reconcile", params);
    const repeated = await x.service.invoke("agent.reconcile", params);
    expect(verified.retryMode).toBe("captured_human");
    expect(repeated.replayed).toBe(true);
    expect(x.current(child.id).status).toBe("idle");
    expect(x.current(child.id).managed?.canRetry).toBe(true);
    expect(x.current(child.id).managed?.reconciliations).toHaveLength(1);
    expect(x.current(child.id).managed?.reconciliations?.[0]).toMatchObject({
      humanRequestId: "readback-1",
      outcome: "not_applied",
      evidenceRefs: ["host:fixture-no-external-effects"],
      source: "human_host_ui",
    });
    expect(x.current(child.id).queue).toHaveLength(0);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
    await expect(
      x.service.invoke("agent.reconcile", {
        ...params,
        evidenceRefs: ["changed-readback"],
      }),
    ).rejects.toThrow(/different attestation/);
    await x.service.invoke("agent.control", { id: child.id, action: "retry" });
    await until(() => x.current(child.id).status === "running");
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => x.current(child.id).status === "completed");
    const prompts = (await x.logs()).filter((entry) => entry.type === "prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[0].pid).not.toBe(prompts[1].pid);
    expect(prompts[1].command).toBe("ignore-cancel");
    expect(prompts[1].content).toContain(
      "Human-attested verification readback-1: not_applied",
    );
  });
  it("allows a fresh followup after applied-effect verification without replaying the failed original input", async () => {
    const x = await setup();
    const child = await x.spawn("applied", "exit");
    await until(
      () =>
        x.current(child.id).status === "unknown" &&
        !(x.service as any).launches.has(child.id),
    );
    await x.service.invoke("agent.reconcile", {
      id: child.id,
      outcome: "applied",
      evidenceRefs: ["host:fixture-readback-actual"],
      operationId: "applied-readback",
    });
    expect(x.current(child.id).status).toBe("idle");
    expect(x.current(child.id).managed?.canRetry).toBe(false);
    await expect(
      x.service.invoke("agent.control", { id: child.id, action: "retry" }),
    ).rejects.toThrow(/fresh bounded followup/);
    await x.service.invoke("agent.followup", {
      id: child.id,
      text: "fresh-inspection-only",
    });
    await until(() => x.current(child.id).status === "completed");
    const prompts = (await x.logs()).filter((entry) => entry.type === "prompt");
    expect(prompts.map((entry) => entry.command)).toEqual([
      "exit",
      "fresh-inspection-only",
    ]);
    expect(prompts[1].content).toContain(
      "Human-attested verification applied-readback: applied",
    );
  });
  it("requires fresh followup for a verified non-human continuation instead of fabricating a human replay", async () => {
    const x = await setup(async (input) => ({
      profileId: input.roleHint || "backend",
      reason: "Actual role routing.",
      confidence: 1,
    }));
    const child = await x.spawn("continuation-verification", "hold ui initial");
    await until(() => x.current(child.id).status === "running");
    const generation = (x.service as any).store.read()._controls[child.id]
      .generation;
    await x.service.invoke("role.transition.request", {
      sessionId: child.id,
      generation,
      operationId: "nonhuman-role",
      roleHint: "qa",
      reason: "Verify accepted behavior.",
      continuation: "ignore-cancel",
      evidenceRefs: [],
    });
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(
      () =>
        x.current(child.id).profileId === "qa" &&
        x.current(child.id).status === "running",
    );
    await x.service.invoke("agent.control", { id: child.id, action: "cancel" });
    await until(() => !(x.service as any).launches.has(child.id));
    await x.service.invoke("agent.reconcile", {
      id: child.id,
      outcome: "not_applied",
      evidenceRefs: ["host:qa-fixture-no-effects"],
      operationId: "nonhuman-readback",
    });
    expect(x.current(child.id).managed?.retryMode).toBe("fresh_followup_only");
    expect(x.current(child.id).managed?.canRetry).toBe(false);
    await expect(
      x.service.invoke("agent.control", { id: child.id, action: "retry" }),
    ).rejects.toThrow(/fresh bounded followup/);
    await x.service.invoke("agent.followup", {
      id: child.id,
      text: "fresh-factual-verification",
    });
    await until(() => x.current(child.id).status === "completed");
    expect(
      (await x.logs())
        .filter((entry) => entry.type === "prompt")
        .map((entry) => entry.command),
    ).toEqual([
      "hold ui initial",
      "ignore-cancel",
      "fresh-factual-verification",
    ]);
  });
  it("starts independent native executors while a dependent worker waits for a real terminal result", async () => {
    const x = await setup();
    const first = await x.spawn("first", "hold first");
    const dependent = await x.spawn("dependent", "dependent", {
      dependencies: [first.id],
    });
    const parallel = await x.spawn("parallel", "hold independent");
    await until(
      () =>
        x.current(first.id).status === "running" &&
        x.current(parallel.id).status === "running",
    );
    expect(x.current(dependent.id).managed?.phase).toBe("queued");
    expect(x.current(dependent.id).status).toBe("idle");
    await until(() => x.current(dependent.id).status === "completed");
    expect(x.current(dependent.id).managed?.phase).toBe("completed");
    const logs = await x.logs(),
      commands = logs
        .filter((entry) => entry.type === "prompt")
        .map((entry) => entry.command);
    expect(commands).toContain("hold first");
    expect(commands.indexOf("dependent")).toBeGreaterThan(
      commands.indexOf("hold first"),
    );
    const processIds = new Set(
      logs
        .filter((entry) => entry.type === "session_new")
        .map((entry) => entry.pid),
    );
    expect(processIds.size).toBe(3);
  });
  it("recovers safe HTML 429 routing failures with capped host backoff and dispatches the original prompt only once", async () => {
    let calls = 0;
    const x = await setup(async () => {
      if (++calls < 3)
        throw new Error(
          "<html><title>HTTP 429</title><body>busy</body></html>",
        );
      return {
        profileId: "backend",
        reason: "Recovered actual fixture.",
        confidence: 1,
      };
    });
    const child = await x.spawn("retry", "single-native-dispatch");
    await until(() => x.current(child.id).status === "completed");
    expect(calls).toBe(3);
    expect(x.current(child.id).managed?.attempts).toBe(3);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("holds HTML after native prompt dispatch unknown and does not repeat tool-capable work", async () => {
    const x = await setup();
    const child = await x.spawn("html-unknown", "malformed");
    await until(() => x.current(child.id).managed?.phase === "unknown");
    expect(x.current(child.id).managed?.effectFence).toBe(true);
    await expect(
      x.service.invoke("agent.control", { id: child.id, action: "retry" }),
    ).rejects.toThrow(/Reconcile/);
    await expect(
      x.service.invoke("agent.followup", { id: child.id, text: "repeat" }),
    ).rejects.toThrow(/Reconcile/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("pauses a queued dependency and resumes it only by the owning coordinator", async () => {
    const x = await setup();
    const first = await x.spawn("blocker", "hold blocker");
    const child = await x.spawn("wait", "after-resume", {
      dependencies: [first.id],
    });
    await x.service.invoke("agent.control", {
      id: child.id,
      action: "pause",
      actorSessionId: x.parent.id,
    });
    expect(x.current(child.id).managed?.phase).toBe("paused");
    const stranger = await x.service.invoke("session.create", {
      taskId: x.task.id,
    });
    await expect(
      x.service.invoke("agent.control", {
        id: child.id,
        action: "resume",
        actorSessionId: stranger.id,
      }),
    ).rejects.toThrow(/owning coordinator/);
    await x.service.invoke("agent.control", {
      id: child.id,
      action: "resume",
      actorSessionId: x.parent.id,
    });
    await until(() => x.current(child.id).status === "completed");
  });
  it("cancels an ignoring owned executor and retains its checkpoint and effect fence across actual storage restart", async () => {
    const x = await setup();
    const child = await x.spawn("cancel", "ignore-cancel");
    await until(() => x.current(child.id).status === "running");
    const generation = (x.service as any).store.read()._controls[child.id]
      .generation;
    await x.service.invoke("agent.checkpoint", {
      sessionId: child.id,
      generation,
      checkpoint: {
        summary: "Observed current task",
        evidenceRefs: ["host:fixture-log"],
        remaining: ["Verify unknown effects"],
        at: 0,
      },
    });
    await x.service.invoke("agent.control", {
      id: child.id,
      action: "cancel",
      actorSessionId: x.parent.id,
    });
    await until(() => !(x.service as any).launches.has(child.id));
    expect(x.current(child.id).managed?.phase).toBe("unknown");
    expect((x.service as any).live.has(child.id)).toBe(false);
    await x.service.dispose();
    const restored = new WorkbenchService(x.options);
    await restored.init();
    cleanups.push(() => restored.dispose());
    const saved = restored
      .snapshot()
      .sessions.find((session) => session.id === child.id)!;
    expect(saved.managed?.checkpoint?.summary).toBe("Observed current task");
    expect(saved.managed?.effectFence).toBe(true);
    await expect(
      restored.invoke("agent.control", { id: child.id, action: "retry" }),
    ).rejects.toThrow(/Reconcile/);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("delivers a cross-project coordination note through a durable link without a fabricated human message or duplicate dispatch", async () => {
    const x = await setup();
    const path2 = path.join(x.root, "frontend");
    await fs.mkdir(path2);
    const project2 = await x.service.invoke("project.create", {
      name: "Frontend",
      path: path2,
    });
    const task2 = await x.service.invoke("task.create", {
      projectId: project2.id,
      title: "Frontend contract",
    });
    const target = await x.service.invoke("session.create", {
      taskId: task2.id,
    });
    const params = {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "contract-1",
      text: "Observe backend contract version 2; do not expand the task.",
    };
    const receipt = await x.service.invoke("session.peerMessage", params);
    expect(x.service.snapshot().coordinationLinks).toHaveLength(1);
    await until(() => x.current(target.id).status === "completed");
    expect((await x.service.invoke("session.peerMessage", params)).id).toBe(
      receipt.id,
    );
    expect(
      x
        .current(target.id)
        .messages.filter((message) => message.role === "user"),
    ).toHaveLength(0);
    const log = await x.logs(path2);
    expect(log.filter((entry) => entry.type === "prompt")).toHaveLength(1);
    expect(log.find((entry) => entry.type === "prompt").content).toContain(
      "not a user instruction",
    );
    expect((x.service as any).store.read()._managed.deliveries[0].phase).toBe(
      "observed",
    );
  });
  it("creates exactly one independent cross-project task/child for an idempotent delegation", async () => {
    const x = await setup();
    const path2 = path.join(x.root, "other");
    await fs.mkdir(path2);
    const p = await x.service.invoke("project.create", {
      name: "Other",
      path: path2,
    });
    const params = {
      parentId: x.parent.id,
      targetProjectId: p.id,
      title: "Fix API consumer",
      prompt: "bounded-delegation",
      operationId: "delegate-1",
    };
    const [a, b] = await Promise.all([
      x.service.invoke("agent.delegate", params),
      x.service.invoke("agent.delegate", params),
    ]);
    expect(a.session.id).toBe(b.session.id);
    expect(
      x.service.snapshot().tasks.filter((task) => task.projectId === p.id),
    ).toHaveLength(1);
    await until(() => x.current(a.session.id).status === "completed");
    expect(x.current(a.session.id).parentId).toBe(x.parent.id);
    expect(x.current(a.session.id).managed?.contextBudget).toBe(16000);
    const actual = (await x.logs(path2)).find(
      (entry) => entry.type === "prompt",
    );
    expect(actual.content).toContain("Host-managed worker contract");
    expect(actual.content).toContain(
      "Current user message:\nbounded-delegation",
    );
  });
  it("publishes actual managed controls and the text-only vision bridge schema; inline images are host-disabled by default", async () => {
    const x = await setup();
    const server = new UiMcpServer(
      () => x.service.snapshot(),
      (method, params) => x.service.invoke(method, params),
    );
    await server.start();
    cleanups.push(() => server.dispose());
    const binding = server.binding(x.parent.id)[0];
    const response = await fetch(binding.url, {
      method: "POST",
      headers: { Authorization: binding.headers[0].value },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const tools = (await response.json()).result.tools;
    for (const name of [
      "agent_control",
      "agent_delegate",
      "agent_checkpoint",
      "coordination_targets",
      "browser_design_audit",
      "visual_review",
    ])
      expect(tools.some((tool: any) => tool.name === name)).toBe(true);
    expect(
      tools.find((tool: any) => tool.name === "agent_control").inputSchema
        .properties.action.enum,
    ).toEqual(["pause", "cancel", "resume", "retry"]);
    expect(tools.some((tool: any) => tool.name === "agent_reconcile")).toBe(
      false,
    );
  });
  it("normally defers overlapping native writers without failing or pausing the waiting session", async () => {
    const x = await setup();
    await fs.mkdir(path.join(x.projectPath, "src"));
    const first = await x.spawn("writer-1", "hold write-first", {
      writeScopes: ["src"],
    });
    const second = await x.spawn("writer-2", "write-second", {
      writeScopes: ["src/Api.java"],
    });
    await until(() => x.current(first.id).status === "running");
    expect(x.current(second.id).status).toBe("idle");
    expect(x.current(second.id).managed?.phase).toBe("queued");
    expect((x.service as any).store.read()._controls[second.id].paused).toBe(
      false,
    );
    await until(() => x.current(second.id).status === "completed");
    expect(x.current(second.id).managed?.attempts).toBe(1);
  });
  it("canonicalizes existing aliases and missing descendants, and rejects an escaping symlink", async () => {
    const x = await setup();
    const src = path.join(x.projectPath, "src"),
      outside = path.join(x.root, "outside");
    await fs.mkdir(src);
    await fs.mkdir(outside);
    await fs.symlink(
      src,
      path.join(x.projectPath, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await fs.symlink(
      outside,
      path.join(x.projectPath, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const a = await x.spawn("alias-1", "hold alias-first", {
      writeScopes: ["alias/new/File.java"],
    });
    const b = await x.spawn("alias-2", "alias-second", {
      writeScopes: ["src/new"],
    });
    const recordedScope = x.current(a.id).managed?.writeScopes[0];
    const expectedScope = path.join(await fs.realpath(src), "new", "File.java");
    expect(typeof recordedScope).toBe("string");
    // Compare the same resolved location, accepting Windows separators/casing.
    // A still-unresolved junction alias must not pass this comparison.
    const filesystemPath = (value: string) =>
      process.platform === "win32"
        ? path.win32.normalize(value).toLowerCase()
        : value;
    expect(filesystemPath(recordedScope!)).toBe(filesystemPath(expectedScope));
    await expect(
      x.spawn("escape", "never dispatch", {
        writeScopes: ["escape/new/File.java"],
      }),
    ).rejects.toThrow(/escapes the real project/);
    await until(() => x.current(a.id).status === "running");
    expect(x.current(b.id).status).toBe("idle");
    await until(() => x.current(b.id).status === "completed");
  });
  it("revokes a pending cross-project note without poisoning an unrelated human queue", async () => {
    const x = await setup();
    const dir = path.join(x.root, "other");
    await fs.mkdir(dir);
    const p = await x.service.invoke("project.create", {
      name: "Other",
      path: dir,
    });
    const t = await x.service.invoke("task.create", {
      projectId: p.id,
      title: "Target",
    });
    const target = await x.service.invoke("session.create", { taskId: t.id });
    await x.service.invoke("session.cancel", { id: target.id }); // Hold admission, not a running native process.
    const params = {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "revoked-pending",
      text: "must-not-dispatch",
    };
    const receipt = await x.service.invoke("session.peerMessage", params);
    const link = x.service.snapshot().coordinationLinks![0];
    await x.service.invoke("coordination.revoke", { id: link.id });
    expect((await x.service.invoke("session.peerMessage", params)).status).toBe(
      "cancelled",
    );
    expect((x.service as any).store.read()._controls[target.id].peers).toEqual(
      [],
    );
    await x.service.invoke("session.send", {
      id: target.id,
      text: "human-after-revocation",
    });
    await x.service.invoke("queue.resume", { sessionId: target.id });
    await until(() => x.current(target.id).status === "completed");
    const prompts = (await x.logs(dir)).filter(
      (entry) => entry.type === "prompt",
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0].command).toBe("human-after-revocation");
    expect(receipt.id).toBeDefined();
  });
  it("revokes a dispatched cross-project note, stops its owned native process, and retains the following human message", async () => {
    const x = await setup();
    const dir = path.join(x.root, "other");
    await fs.mkdir(dir);
    const p = await x.service.invoke("project.create", {
      name: "Other",
      path: dir,
    });
    const t = await x.service.invoke("task.create", {
      projectId: p.id,
      title: "Target",
    });
    const target = await x.service.invoke("session.create", { taskId: t.id });
    await x.service.invoke("session.peerMessage", {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "revoked-live",
      text: "ignore-cancel",
    });
    await until(() => x.current(target.id).status === "running");
    await x.service.invoke("session.send", {
      id: target.id,
      text: "preserve-human-after-unknown",
    });
    await x.service.invoke("coordination.revoke", {
      id: x.service.snapshot().coordinationLinks![0].id,
    });
    await until(() => !(x.service as any).launches.has(target.id));
    expect(x.current(target.id).status).toBe("unknown");
    expect(x.current(target.id).queue[0].text).toBe(
      "preserve-human-after-unknown",
    );
    expect((x.service as any).store.read()._managed.deliveries[0].phase).toBe(
      "unknown",
    );
    expect(
      (await x.logs(dir)).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("automatically retains peer reply causality while the source is dispatched and releases the reply only after observation", async () => {
    const x = await setup();
    const target = await x.service.invoke("session.create", {
      taskId: x.task.id,
      title: "Peer",
    });
    const first = await x.service.invoke("session.peerMessage", {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "causal-first",
      text: "hold ui causal",
    });
    await until(() => x.current(target.id).status === "running");
    const reply = await x.service.invoke("session.peerMessage", {
      sourceId: target.id,
      id: x.parent.id,
      operationId: "causal-reply",
      text: "causal-reply",
    });
    const stored = (x.service as any).store
      .read()
      ._managed.deliveries.find((delivery: any) => delivery.id === reply.id);
    expect(stored.parentDeliveryId).toBe(first.id);
    expect(stored.hops).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(x.current(x.parent.id).status).toBe("idle");
    await (x.service as any).live
      .get(target.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => x.current(x.parent.id).status === "completed");
    expect(
      (x.service as any).store
        .read()
        ._managed.deliveries.find((delivery: any) => delivery.id === reply.id)
        .phase,
    ).toBe("observed");
  });
  it("expires an idle nonworker peer lease and stops its native owner without replay", async () => {
    const x = await setup();
    const target = await x.service.invoke("session.create", {
      taskId: x.task.id,
      title: "Peer",
    });
    const receipt = await x.service.invoke("session.peerMessage", {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "lease-first",
      text: "ignore-cancel",
    });
    await until(() => x.current(target.id).status === "running");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await (x.service as any).store.update((state: any) => {
      state._managed.deliveries.find(
        (delivery: any) => delivery.id === receipt.id,
      ).attempt.expiresAt = Date.now() - 1;
    });
    (x.service as any).armManagedRetry();
    await until(() => !(x.service as any).launches.has(target.id));
    expect(x.current(target.id).status).toBe("unknown");
    expect((x.service as any).live.has(target.id)).toBe(false);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("revokes a claimed undispatched note during native startup and preserves the unrelated human queue", async () => {
    const x = await setup();
    const dir = path.join(x.root, "other");
    await fs.mkdir(dir);
    const p = await x.service.invoke("project.create", {
      name: "Other",
      path: dir,
    });
    const t = await x.service.invoke("task.create", {
      projectId: p.id,
      title: "Target",
    });
    const target = await x.service.invoke("session.create", { taskId: t.id });
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    x.options.mcpServersForSession = async (sessionId) => {
      if (sessionId === target.id && !entered) {
        entered = true;
        await gate;
      }
      return [];
    };
    await x.service.invoke("session.peerMessage", {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "claimed-revoke",
      text: "never-dispatch-claimed",
    });
    await until(() => entered);
    await x.service.invoke("session.send", {
      id: target.id,
      text: "human-after-claimed-revocation",
    });
    try {
      await x.service.invoke("coordination.revoke", {
        id: x.service.snapshot().coordinationLinks![0].id,
      });
    } finally {
      release();
    }
    await until(() => x.current(target.id).status === "completed");
    const prompts = (await x.logs(dir)).filter(
      (entry) => entry.type === "prompt",
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0].command).toBe("human-after-claimed-revocation");
    expect((x.service as any).store.read()._managed.deliveries[0].phase).toBe(
      "cancelled",
    );
  });
  it("keeps the same owned child across a clean automatic role transition without unblocking dependants early", async () => {
    const x = await setup(async (input) => ({
      profileId: input.roleHint || "backend",
      reason: "Actual phase fixture routing.",
      confidence: 1,
    }));
    const child = await x.spawn("role-child", "hold tool-progress");
    const dependent = await x.spawn("after-role", "after-child-role", {
      dependencies: [child.id],
    });
    await until(() => x.current(child.id).status === "running");
    const generation = (x.service as any).store.read()._controls[child.id]
      .generation;
    await x.service.invoke("role.transition.request", {
      sessionId: child.id,
      generation,
      operationId: "child-to-qa",
      roleHint: "qa",
      reason: "Verify actual output independently.",
      continuation: "hold ui final-phase",
      evidenceRefs: ["host:fixture-tool-progress"],
    });
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(
      () =>
        x.current(child.id).profileId === "qa" &&
        x.current(child.id).status === "running",
    );
    expect(x.current(dependent.id).status).toBe("idle");
    expect(x.current(child.id).managed?.phase).toBe("dispatched");
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => x.current(dependent.id).status === "completed");
    expect(x.current(child.id).managed?.phase).toBe("completed");
    expect(x.current(child.id).roleTransition?.status).toBe("completed");
  });
  it("holds a worker's end_turn with an unresolved tool UNKNOWN, revokes its native owner, and blocks dependants", async () => {
    const x = await setup();
    const child = await x.spawn("unresolved", "hold ui unresolved-tool");
    const dependent = await x.spawn("after-unknown", "must-not-run", {
      dependencies: [child.id],
    });
    await until(() => x.current(child.id).status === "running");
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => !(x.service as any).launches.has(child.id));
    expect(x.current(child.id).status).toBe("unknown");
    expect(x.current(child.id).managed?.effectFence).toBe(true);
    expect((x.service as any).live.has(child.id)).toBe(false);
    expect(x.current(dependent.id).status).toBe("idle");
  });
  it("holds a child role phase for a pending question without declaring its DAG work complete, then resumes after the actual answer", async () => {
    const x = await setup(async (input) => ({
      profileId: input.roleHint || "backend",
      reason: "Actual phase fixture routing.",
      confidence: 1,
    }));
    const child = await x.spawn("question-child", "hold ui initial");
    const dependent = await x.spawn("after-answer", "after-human-answer", {
      dependencies: [child.id],
    });
    await until(() => x.current(child.id).status === "running");
    const generation = (x.service as any).store.read()._controls[child.id]
      .generation;
    await x.service.invoke("role.transition.request", {
      sessionId: child.id,
      generation,
      operationId: "question-next",
      roleHint: "qa",
      reason: "Need the accepted behavior.",
      continuation: "hold ui answer-phase",
      evidenceRefs: [],
    });
    const question = await x.service.invoke("question.create", {
      sessionId: child.id,
      title: "Choose the accepted behavior",
      delivery: "tool",
    });
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => !(x.service as any).launches.has(child.id));
    expect(x.current(child.id).managed?.phase).toBe("paused");
    expect(x.current(dependent.id).status).toBe("idle");
    await x.service.invoke("question.answer", {
      id: question.id,
      text: "Use actual accepted behavior",
    });
    await until(
      () =>
        x.current(child.id).profileId === "qa" &&
        x.current(child.id).status === "running",
    );
    await (x.service as any).live
      .get(child.id)
      .client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => x.current(dependent.id).status === "completed");
  });
  it("revokes and terminates an expired native peer owner before a stalled durable write can acknowledge cancellation", async () => {
    const x = await setup();
    const target = await x.service.invoke("session.create", {
      taskId: x.task.id,
      title: "Peer",
    });
    const revoked: string[] = [];
    x.options.revokeSessionTools = (sessionId) => {
      revoked.push(sessionId);
    };
    const receipt = await x.service.invoke("session.peerMessage", {
      sourceId: x.parent.id,
      id: target.id,
      operationId: "stalled-expiry",
      text: "ignore-cancel",
    });
    await until(() => x.current(target.id).status === "running");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pid = (await x.logs()).find(
      (entry) => entry.type === "session_new",
    ).pid;
    const store = (x.service as any).store,
      original = store.update.bind(store);
    await original((state: any) => {
      state._managed.deliveries.find(
        (delivery: any) => delivery.id === receipt.id,
      ).attempt.expiresAt = Date.now() - 1;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = 0;
    store.update = async (fn: any) => {
      waiting++;
      await gate;
      return original(fn);
    };
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    };
    try {
      (x.service as any).armManagedRetry();
      await until(() => revoked.includes(target.id) && !alive(), 3000);
      expect(waiting).toBeGreaterThan(0);
      expect(x.current(target.id).status).toBe("running"); // No false durable cancellation acknowledgement.
    } finally {
      store.update = original;
      release();
    }
    await until(() => !(x.service as any).launches.has(target.id));
    expect(x.current(target.id).status).toBe("unknown");
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
});
