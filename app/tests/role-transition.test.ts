import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchService, type WorkbenchOptions } from "../electron/service";
import { UiMcpServer } from "../electron/mcp";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const roles = [
  "analyst",
  "backend",
  "diagnostics",
  "frontend",
  "qa",
  "reviewer",
  "database",
  "architect",
  "devops",
];
const defaultRouter: NonNullable<WorkbenchOptions["routeProfile"]> = async (
  input,
) => ({
  profileId: input.roleHint || "backend",
  confidence: 1,
  reason: "Fixture classifies the next accepted task phase.",
});
async function setup(router: WorkbenchOptions["routeProfile"] = defaultRouter) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "role-transition-"),
  );
  const bundleDir = path.join(directory, "bundle"),
    projectPath = path.join(directory, "project"),
    dataDir = path.join(directory, "data");
  await fs.mkdir(path.join(bundleDir, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(bundleDir, "CORE.md"),
    "Preserve accepted scope. Check actual results.",
  );
  for (const role of roles)
    await fs.writeFile(
      path.join(bundleDir, "profiles", `${role}.md`),
      `# ${role}\nActual ${role} instructions.`,
    );
  let server: UiMcpServer;
  const bindings = new Map<
    string,
    ReturnType<UiMcpServer["binding"]>[number]
  >();
  const options: WorkbenchOptions = {
    bundleDir,
    dataDir,
    routeProfile: router,
    emit: () => undefined,
    mcpServersForSession: (sessionId, generation) => {
      const result = server.binding(sessionId, generation);
      bindings.set(sessionId, result[0]);
      return result;
    },
    revokeSessionTools: (sessionId) => server?.revokeBinding(sessionId),
  };
  const service = new WorkbenchService(options);
  await service.init();
  server = new UiMcpServer(
    () => service.snapshot(),
    (method, params) => service.invoke(method, params),
  );
  await server.start();
  cleanups.push(async () => {
    await server.dispose();
    await service.dispose();
    await fs.rm(directory, { recursive: true, force: true });
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
    name: "Fullstack",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Accepted fullstack task",
    description: "Keep this accepted task goal unchanged.",
  });
  const session = await service.invoke("session.create", { taskId: task.id });
  const current = () =>
    service.snapshot().sessions.find((item) => item.id === session.id)!;
  const rpc = async (
    args: Record<string, unknown>,
    binding = bindings.get(session.id)!,
  ) => {
    const response = await fetch(binding.url, {
      method: "POST",
      headers: { Authorization: binding.headers[0].value },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "role_transition_request", arguments: args },
      }),
    });
    if (response.status !== 200) return { httpStatus: response.status };
    const envelope = (await response.json()).result;
    return envelope.isError
      ? { error: envelope.content[0].text }
      : JSON.parse(envelope.content[0].text);
  };
  const request = (
    operationId: string,
    roleHint: string,
    continuation = "hold ui next-phase",
  ) =>
    rpc({
      operationId,
      roleHint,
      reason: "The next accepted phase needs another responsibility.",
      continuation,
      evidenceRefs: ["task:accepted-scope"],
    });
  const prompts = async () =>
    (await fs.readFile(path.join(projectPath, "fixture-events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.type === "prompt");
  const live = () => (service as any).live.get(session.id);
  const finish = async (stopReason = "end_turn") => {
    await live().client.request("fixture/finish", { stopReason });
  };
  const running = async (count: number) =>
    until(async () => {
      try {
        return (
          current().status === "running" && (await prompts()).length === count
        );
      } catch {
        return false;
      }
    });
  const settled = async () =>
    until(() => !(service as any).launches.has(session.id));
  return {
    service,
    options,
    server,
    bindings,
    projectPath,
    task,
    session,
    current,
    rpc,
    request,
    prompts,
    live,
    finish,
    running,
    settled,
  };
}
async function until(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout)
      throw new Error("Role transition condition did not become true.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("automatic in-task role handoffs", () => {
  it("runs backend→diagnostics→frontend on one real user request with separate processes and exact goal/history/config", async () => {
    const routed: any[] = [];
    const x = await setup(async (input, signal) => {
      routed.push(input);
      return defaultRouter(input, signal);
    });
    await x.service.invoke("session.prepare", { id: x.session.id });
    await x.service.invoke("session.config", {
      id: x.session.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await x.service.invoke("session.config", {
      id: x.session.id,
      configId: "reasoning_effort",
      value: "low",
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui ORIGINAL_ACCEPTED_GOAL",
    });
    await x.running(1);
    const backendBinding = x.bindings.get(x.session.id)!;
    const first = await x.request(
      "diagnose-1",
      "diagnostics",
      "hold ui diagnose-current-facts",
    );
    expect(first.transition.status).toBe("pending");
    expect(x.current().profileId).toBe("backend");
    await x.finish();
    await x.running(2);
    expect(x.current().profileId).toBe("diagnostics");
    expect((await x.rpc({}, backendBinding)).httpStatus).toBe(401);
    await x.request(
      "frontend-1",
      "frontend",
      "hold ui implement-current-client",
    );
    await x.finish();
    await x.running(3);
    await x.finish();
    await x.settled();
    const prompts = await x.prompts();
    expect(new Set(prompts.map((p) => p.pid)).size).toBe(3);
    expect(prompts.map((p) => p.model)).toEqual([
      "fixture-reasoning",
      "fixture-reasoning",
      "fixture-reasoning",
    ]);
    expect(prompts.map((p) => p.reasoning)).toEqual(["low", "low", "low"]);
    expect(prompts[2].content).toContain("ORIGINAL_ACCEPTED_GOAL");
    expect(prompts[2].content).toContain("Host recovery checkpoint");
    expect(routed[2].request).toContain("ORIGINAL_ACCEPTED_GOAL");
    expect(x.current().messages.filter((m) => m.role === "user")).toHaveLength(
      1,
    );
    expect(
      x.current().messages.filter((m) => m.kind === "role_continuation"),
    ).toHaveLength(2);
    expect(
      x
        .current()
        .roleTransitionHistory?.map((r) => [
          r.fromProfileId,
          r.toProfileId,
          r.status,
        ]),
    ).toEqual([
      ["backend", "diagnostics", "completed"],
      ["diagnostics", "frontend", "completed"],
    ]);
    expect(x.service.snapshot().tasks[0].description).toBe(x.task.description);
    expect(x.current().queue).toHaveLength(0);
  });

  it("deduplicates one operation and rejects altered input, a second pending operation and stale generation", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui dedup",
    });
    await x.running(1);
    const first = await x.request("same", "diagnostics");
    const again = await x.request("same", "diagnostics");
    expect(again).toMatchObject({
      replayed: true,
      transition: { id: first.transition.id },
    });
    expect((await x.request("same", "frontend")).error).toMatch(
      /different input/i,
    );
    expect((await x.request("another", "frontend")).error).toMatch(
      /already pending/i,
    );
    await expect(
      x.service.invoke("role.transition.request", {
        sessionId: x.session.id,
        generation: x.live().generation - 1,
        operationId: "stale",
        reason: "Stale",
        continuation: "Never",
        roleHint: "diagnostics",
      }),
    ).rejects.toThrow(/generation/i);
    await x.service.invoke("session.cancel", { id: x.session.id });
    await x.settled();
    expect(x.current().roleTransition?.status).toBe("held");
    expect(x.current().roleTransition?.canResume).toBe(false);
    expect(await x.prompts()).toHaveLength(1);
  });

  it("gives queued human input priority without sending the obsolete continuation", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    await x.request("superseded", "frontend", "must-not-be-dispatched");
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui actual-user-correction",
    });
    await x.finish();
    await x.running(2);
    await x.finish();
    await x.settled();
    expect((await x.prompts()).map((p) => p.command)).toEqual([
      "hold ui initial",
      "hold ui actual-user-correction",
    ]);
    expect(x.current().roleTransition?.status).toBe("rejected");
    expect(x.current().messages.filter((m) => m.role === "user")).toHaveLength(
      2,
    );
  });

  it("holds a clean phase for a real question answer, then continues with the answer as reference", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    await x.request("question-handoff", "frontend");
    const q = await x.service.invoke("question.create", {
      sessionId: x.session.id,
      title: "Which accepted behavior?",
      delivery: "tool",
    });
    await x.finish();
    await x.settled();
    expect(x.current().roleTransition?.status).toBe("held");
    expect(await x.prompts()).toHaveLength(1);
    await x.service.invoke("question.answer", {
      id: q.id,
      text: "ANSWER_FROM_HUMAN",
    });
    await x.running(2);
    await x.finish();
    await x.settled();
    expect((await x.prompts())[1].content).toContain("ANSWER_FROM_HUMAN");
    expect(x.current().messages.filter((m) => m.role === "user")).toHaveLength(
      1,
    );
  });

  it.each(["max_tokens", "unknown-tool"])(
    "holds an unsafe %s terminal instead of approving the next role",
    async (kind) => {
      const x = await setup();
      await x.service.invoke("session.send", {
        id: x.session.id,
        text:
          kind === "unknown-tool"
            ? "hold ui unresolved-tool"
            : "hold ui initial",
      });
      await x.running(1);
      await x.request("unsafe", "frontend");
      await x.finish(kind === "max_tokens" ? "max_tokens" : "end_turn");
      await x.settled();
      expect(x.current().roleTransition?.status).toBe("held");
      expect(x.current().roleTransition?.canResume).toBe(false);
      await x.service.invoke("queue.resume", { id: x.session.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await x.prompts()).toHaveLength(1);
    },
  );

  it("does not mark an executing phase completed when its tool remains unresolved", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    await x.request(
      "unknown-final-phase",
      "frontend",
      "hold ui unresolved-tool",
    );
    await x.finish();
    await x.running(2);
    await x.finish();
    await x.settled();
    expect(x.current().roleTransition?.status).toBe("held");
    expect(x.current().roleTransition?.canResume).toBe(false);
  });

  it("retains the role honestly when no LLM router approves a transition", async () => {
    let calls = 0;
    const x = await setup(async (input, signal) => {
      if (calls++) throw new Error("Router unavailable");
      return defaultRouter(input, signal);
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    await x.request("no-router", "frontend");
    await x.finish();
    await x.settled();
    expect(x.current().profileId).toBe("backend");
    expect(x.current().roleTransition?.status).toBe("held");
    expect(x.current().roleTransition?.canResume).toBe(true);
    expect(await x.prompts()).toHaveLength(1);
    expect(x.current().roleTransitionHistory?.at(-1)?.canResume).toBe(true);
    // A later question changes eligibility without publishing another receipt.
    const question = await x.service.invoke("question.create", {
      sessionId: x.session.id,
      title: "Actual resume prerequisite",
      delivery: "tool",
    });
    expect(x.current().roleTransition?.canResume).toBe(false);
    expect(x.current().roleTransitionHistory?.at(-1)?.canResume).toBe(false);
    await x.service.invoke("question.answer", {
      id: question.id,
      text: "Prerequisite answered",
    });
    expect(x.current().roleTransition?.canResume).toBe(true);
    expect(x.current().roleTransitionHistory?.at(-1)?.canResume).toBe(true);
  });

  it("rejects scope drift during classification and keeps the accepted task unchanged by the agent", async () => {
    let entered = false,
      release!: () => void;
    const x = await setup(async (input, signal) => {
      if (input.roleHint) {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return defaultRouter(input, signal);
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    await x.request("scope-drift", "frontend");
    await x.finish();
    await until(() => entered);
    await x.service.invoke("task.update", {
      id: x.task.id,
      description: "New real user scope",
    });
    release();
    await x.settled();
    expect(await x.prompts()).toHaveLength(1);
    expect(x.current().profileId).toBe("backend");
    expect(x.current().roleTransition?.status).toBe("held");
  });

  it("preserves an uncertain source phase across restart without replay", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui crash",
    });
    await x.running(1);
    await x.request("crash-transition", "frontend");
    await x
      .live()
      .client.request("fixture/crash", {})
      .catch(() => undefined);
    await x.settled();
    expect(x.current().status).toBe("unknown");
    expect(x.current().roleTransition?.status).toBe("unknown");
    expect(x.current().roleTransition?.canResume).toBe(false);
    await x.service.dispose();
    const resumed = new WorkbenchService(x.options);
    await resumed.init();
    try {
      expect(resumed.snapshot().sessions[0].roleTransition?.status).toBe(
        "unknown",
      );
      await expect(
        resumed.invoke("queue.resume", { id: x.session.id }),
      ).rejects.toThrow(/unknown/i);
      expect(await x.prompts()).toHaveLength(1);
    } finally {
      await resumed.dispose();
    }
  });

  it("lets a real user request arriving during role classification win without dispatching the phase", async () => {
    let entered = false,
      release!: () => void;
    const x = await setup(async (input, signal) => {
      if (input.roleHint) {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return defaultRouter(input, signal);
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui original",
    });
    await x.running(1);
    await x.request("routing-priority", "frontend");
    await x.finish();
    await until(() => entered);
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui newer-user-intent",
    });
    release();
    await x.running(2);
    await x.finish();
    await x.settled();
    expect((await x.prompts()).map((p) => p.command)).toEqual([
      "hold ui original",
      "hold ui newer-user-intent",
    ]);
    expect(x.current().roleTransition?.status).toBe("rejected");
    expect(
      x.current().messages.filter((m) => m.kind === "role_continuation"),
    ).toHaveLength(0);
  });

  it("holds stale classification when model settings change and retries with accepted current settings", async () => {
    let entered = false,
      release!: () => void;
    const x = await setup(async (input, signal) => {
      if (input.roleHint && !entered) {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return defaultRouter(input, signal);
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui original",
    });
    await x.running(1);
    await x.request("model-race", "frontend");
    await x.finish();
    await until(() => entered);
    await x.service.invoke("session.config", {
      id: x.session.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    release();
    await x.settled();
    expect(await x.prompts()).toHaveLength(1);
    expect(x.current().profileId).toBe("backend");
    expect(x.current().roleTransition?.status).toBe("held");
    expect(x.current().roleTransition?.canResume).toBe(true);
    await x.service.invoke("queue.resume", { id: x.session.id });
    await x.running(2);
    await x.finish();
    await x.settled();
    expect((await x.prompts())[1].model).toBe("fixture-reasoning");
    expect(x.current().profileId).toBe("frontend");
  });

  it("rechecks questions after next-process startup and resumes only after the real answer", async () => {
    const x = await setup();
    await x.service.invoke("settings.update", {
      patch: { cliArgs: ["--acp", "--hold-new-session"] },
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui original",
    });
    await x.running(1);
    const oldGeneration = x.live().generation;
    await x.request("startup-question", "frontend");
    await x.finish();
    await until(
      () =>
        x.current().status === "starting" &&
        x.live()?.generation > oldGeneration,
    );
    const q = await x.service.invoke("question.create", {
      sessionId: x.session.id,
      title: "Late actual question",
      delivery: "tool",
    });
    await x.settled();
    expect(await x.prompts()).toHaveLength(1);
    expect(x.current().roleTransition?.status).toBe("held");
    await x.service.invoke("question.answer", {
      id: q.id,
      text: "LATE_ACTUAL_ANSWER",
    });
    await x.running(2);
    await x.finish();
    await x.settled();
    expect((await x.prompts())[1].content).toContain("LATE_ACTUAL_ANSWER");
    expect(x.current().roleTransition?.status).toBe("completed");
  });

  it("stops a repeated role with no recorded progress but permits a completed test receipt", async () => {
    for (const progress of [false, true]) {
      const x = await setup();
      await x.service.invoke("session.send", {
        id: x.session.id,
        text: "hold ui initial",
      });
      await x.running(1);
      await x.request(
        "diagnose",
        "diagnostics",
        progress ? "hold ui tool-progress" : "hold ui no-progress",
      );
      await x.finish();
      await x.running(2);
      await x.request("return-backend", "backend");
      await x.finish();
      if (progress) {
        await x.running(3);
        await x.finish();
      }
      await x.settled();
      expect(await x.prompts()).toHaveLength(progress ? 3 : 2);
      expect(x.current().roleTransition?.status).toBe(
        progress ? "completed" : "rejected",
      );
    }
  });

  it("caps one autonomous user chain at six handoffs", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold ui initial",
    });
    await x.running(1);
    const next = [
      "diagnostics",
      "frontend",
      "qa",
      "reviewer",
      "database",
      "architect",
    ];
    for (let index = 0; index < next.length; index++) {
      await x.request(`hop-${index}`, next[index]);
      await x.finish();
      await x.running(index + 2);
    }
    const refused = await x.request("hop-seven", "devops");
    expect(refused.transition.status).toBe("rejected");
    expect(refused.transition.holdReason).toContain("6");
    await x.finish();
    await x.settled();
    expect(await x.prompts()).toHaveLength(7);
    expect(x.current().messages.filter((m) => m.role === "user")).toHaveLength(
      1,
    );
  });
});
