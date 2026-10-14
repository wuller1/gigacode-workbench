import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WorkbenchService } from "../electron/service.js";
import {
  parseRouterOutput,
  routingPrompt,
  validateRoleDecision,
  type RoleRouter,
} from "../electron/role-router.js";

const fixture = fileURLToPath(
  new URL("./fixtures/acp-fixture.mjs", import.meta.url),
);
const owned: { dir: string; service: WorkbenchService }[] = [];
async function setup(
  routeProfile?: RoleRouter,
  mcpServersForSession?: () => Promise<unknown[]>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-role-"));
  const bundle = path.join(dir, "bundle"),
    projectPath = path.join(dir, "project");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(bundle, "CORE.md"),
    "COMMON_FACTS_VERIFY_TEST_RECOVER",
  );
  for (const [id, content] of Object.entries({
    analyst: "ANALYST_AUTHOR_FUNCTIONS",
    backend: "BACKEND_IMPLEMENT_SERVER",
    spec: "SPEC_EXPLICIT_FORMAL_STAGE",
  }))
    await fs.writeFile(
      path.join(bundle, `profiles/${id}.md`),
      `# ${id}\n${content}`,
    );
  const service = new WorkbenchService({
    dataDir: path.join(dir, "data"),
    bundleDir: bundle,
    emit: () => undefined,
    routeProfile,
    mcpServersForSession,
  });
  await service.init();
  owned.push({ dir, service });
  await service.invoke("settings.update", {
    patch: {
      cliPath: fixture,
      cliArgs: ["--acp"],
      startupRetries: 0,
      maxConcurrent: 1,
    },
  });
  const project = await service.invoke("project.create", {
    name: "Billing backend",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Refund contract",
    description: "Describe then implement refunds with idempotency.",
  });
  const session = await service.invoke("session.create", { taskId: task.id });
  return { dir, service, task, session, projectPath, project };
}
async function until(condition: () => boolean, timeout = 6000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}
async function complete(x: Awaited<ReturnType<typeof setup>>, message: string) {
  const previous = x.service.snapshot().sessions[0].messages.length;
  await x.service.invoke("session.send", { id: x.session.id, text: message });
  await until(() => {
    const s = x.service.snapshot().sessions[0];
    return s.status === "completed" && s.messages.length > previous;
  });
}
async function prompts(folder: string) {
  return (await fs.readFile(path.join(folder, "fixture-events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x))
    .filter((x) => x.type === "prompt");
}
afterEach(async () => {
  for (const x of owned.splice(0)) {
    await x.service.dispose();
    await fs.rm(x.dir, { recursive: true, force: true });
  }
});

describe("role execution and recovery", () => {
  it("rejects accepted scope changes while ACP startup waits for its tool binding", async () => {
    let release!: () => void;
    let entered = false;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const x = await setup(undefined, async () => {
      entered = true;
      await barrier;
      return [];
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "Implement the accepted scope",
    });
    await until(() => entered);
    await x.service.invoke("task.update", {
      id: x.task.id,
      description: "A newer accepted contract",
    });
    release();
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].queue).toHaveLength(1);
    const log = await fs.readFile(
      path.join(x.projectPath, "fixture-events.jsonl"),
      "utf8",
    );
    expect(log).not.toContain('"type":"prompt"');
  });
  it("rejects project context changes while the LLM router is pending", async () => {
    let release!: (value: any) => void;
    const x = await setup(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "Use the current project context",
    });
    await until(() => !!release);
    await x.service.invoke("project.update", {
      id: x.project.id,
      name: "Changed project context",
    });
    release({
      profileId: "backend",
      reason: "obsolete project",
      confidence: 0.99,
    });
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].queue).toHaveLength(1);
    expect(x.service.snapshot().sessions[0].profileId).toBe("analyst");
  });
  it("keeps an unverified runtime explicit, without keyword role guessing", async () => {
    const x = await setup();
    await complete(
      x,
      "backend SQL SDD contradictions do not establish a formal stage",
    );
    const s = x.service.snapshot().sessions[0];
    expect(s.profileId).toBe("analyst");
    expect(s.roleRouting?.source).toBe("retained");
    expect(s.instructionBinding?.delivery).toBe("context_only");
    expect(s.messages.filter(m => m.role !== "system").every(m => m.instructionFingerprint === s.instructionBinding?.fingerprint)).toBe(true);
    const retained = await x.service.invoke("instruction.read", { sessionId: x.session.id, fingerprint: s.instructionBinding!.fingerprint });
    expect(retained.content).toContain("ANALYST_AUTHOR_FUNCTIONS");
    const other = await x.service.invoke("session.create", { taskId: x.task.id });
    await expect(x.service.invoke("instruction.read", { sessionId: other.id, fingerprint: s.instructionBinding!.fingerprint })).rejects.toThrow("outside");
    expect((await prompts(x.projectPath))[0].content).toContain(
      "ANALYST_AUTHOR_FUNCTIONS",
    );
    expect((await prompts(x.projectPath))[0].content).not.toContain(
      "SPEC_EXPLICIT_FORMAL_STAGE",
    );
  });
  it("switches on a contextual LLM decision and carries prior evidence into the new executor", async () => {
    const inputs: any[] = [];
    const x = await setup(async (input) => {
      inputs.push(input);
      return {
        profileId: inputs.length === 1 ? "analyst" : "backend",
        reason:
          "The next requested result changes from description to server implementation.",
        confidence: 0.95,
      };
    });
    await complete(x, "Describe the refund behavior MARKER_ACCEPTED_CONTRACT");
    await complete(x, "Now implement it.");
    expect(
      inputs[1].history.some((m: any) =>
        m.content.includes("MARKER_ACCEPTED_CONTRACT"),
      ),
    ).toBe(true);
    expect(inputs[1].project.name).toBe("Billing backend");
    const sent = await prompts(x.projectPath);
    expect(sent[1].pid).not.toBe(sent[0].pid);
    expect(sent[1].content).toContain("BACKEND_IMPLEMENT_SERVER");
    expect(sent[1].content).not.toContain("ANALYST_AUTHOR_FUNCTIONS");
    expect(sent[1].content).toContain("MARKER_ACCEPTED_CONTRACT");
    expect(x.service.snapshot().sessions[0].instructionBinding?.profileId).toBe(
      "backend",
    );
  });
  it("preserves context when model-catalog reconnect retires a completed executor", async () => {
    const x = await setup();
    await complete(x, "IMPORTANT_OLD_DECISION");
    await x.service.invoke("settings.update", {
      patch: { cliArgs: ["--acp", "--fixture-new-config"] },
    });
    await x.service.invoke("session.prepare", { id: x.session.id });
    expect(x.service.snapshot().sessions[0].instructionBinding?.state).toBe(
      "prepared",
    );
    await complete(x, "Use the previous decision");
    expect((await prompts(x.projectPath))[1].content).toContain(
      "IMPORTANT_OLD_DECISION",
    );
  });
  it("cancels a pending classifier without dispatching the task or consuming its queued message", async () => {
    let entered = false;
    const x = await setup(async (_input, signal) => {
      entered = true;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("stopped")), {
          once: true,
        }),
      );
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "Pending task",
    });
    await until(() => entered);
    await x.service.invoke("session.cancel", { id: x.session.id });
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].queue[0].text).toBe("Pending task");
    expect(
      await fs.access(path.join(x.projectPath, "fixture-events.jsonl")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
  it("rejects a stale classifier decision when the task changes while it runs", async () => {
    let release!: (v: any) => void;
    const x = await setup(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "Implement current contract",
    });
    await until(() => !!release);
    await x.service.invoke("task.update", {
      id: x.task.id,
      description: "Different accepted contract",
    });
    release({ profileId: "backend", reason: "old scope", confidence: 0.99 });
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].queue).toHaveLength(1);
    expect(x.service.snapshot().sessions[0].profileId).toBe("analyst");
  });
  it("bounds huge task recovery without dropping retained source data", async () => {
    const x = await setup();
    const goal = "Accepted scope ".repeat(6500);
    await x.service.invoke("task.update", { id: x.task.id, description: goal });
    await x.service.invoke("todo.replace", {
      sessionId: x.session.id,
      items: Array.from({ length: 400 }, (_, i) => ({
        id: `todo-${i}`,
        text: "x".repeat(9000),
        status: i === 0 ? "in_progress" : "pending",
      })),
    });
    await complete(x, "Short task");
    await x.service.invoke("session.compact", { id: x.session.id });
    await x.service.invoke("queue.resume", { sessionId: x.session.id });
    await complete(x, "Continue carefully");
    const sent = await prompts(x.projectPath);
    expect(sent[1].content.length).toBeLessThan(50000);
    expect(sent[1].content).toContain("task_context");
    expect(x.service.snapshot().tasks[0].description).toBe(goal);
    expect(x.service.snapshot().sessions[0].todos).toHaveLength(400);
  });
  it("rotates queue admission so a busy first conversation cannot starve another", async () => {
    const x = await setup();
    const b = await x.service.invoke("session.create", {
      taskId: x.task.id,
      title: "B",
    });
    await x.service.invoke("session.send", {
      id: x.session.id,
      text: "hold A1",
    });
    await until(() => x.service.snapshot().sessions[0].status === "running");
    await x.service.invoke("session.send", { id: x.session.id, text: "A2" });
    await x.service.invoke("session.send", { id: x.session.id, text: "A3" });
    await x.service.invoke("session.send", { id: b.id, text: "B1" });
    await until(() =>
      x.service
        .snapshot()
        .sessions.every((s) => s.status === "completed" && !s.queue.length),
    );
    expect((await prompts(x.projectPath)).map((p) => p.command)).toEqual([
      "hold A1",
      "B1",
      "A2",
      "A3",
    ]);
  });
});

describe("bounded router contract", () => {
  const input = {
    currentProfileId: "analyst",
    project: { id: "p", name: "P", directory: "repo" },
    task: { id: "t", title: "T", description: "D" },
    request: "now implement",
    history: [],
    profiles: [
      { id: "analyst", name: "Analyst", description: "Author" },
      { id: "backend", name: "Backend", description: "Implement server" },
    ],
  };
  it("retains a current role on low confidence and rejects invented roles", () => {
    expect(
      validateRoleDecision(
        { profileId: "backend", reason: "unclear", confidence: 0.5 },
        input,
      ).profileId,
    ).toBe("analyst");
    expect(() =>
      validateRoleDecision(
        { profileId: "invented", reason: "x", confidence: 0.99 },
        input,
      ),
    ).toThrow();
    expect(() =>
      validateRoleDecision(
        { profileId: "backend", reason: "x", confidence: NaN },
        input,
      ),
    ).toThrow();
  });
  it("parses actual headless result envelopes and rejects gateway/error output", () => {
    expect(
      parseRouterOutput(
        JSON.stringify({
          type: "result",
          result: JSON.stringify({
            profileId: "backend",
            reason: "server",
            confidence: 0.95,
          }),
        }),
        input,
      ).profileId,
    ).toBe("backend");
    expect(() => parseRouterOutput("<html>429</html>", input)).toThrow("JSON");
    expect(() =>
      parseRouterOutput(
        JSON.stringify({ type: "result", is_error: true, result: "bad" }),
        input,
      ),
    ).toThrow("failure");
  });
  it("sends catalog summaries without all role prompts or full transcripts", () => {
    const prompt = routingPrompt({
      ...input,
      history: Array.from({ length: 100 }, () => ({
        role: "user",
        content: "long".repeat(10000),
      })),
    });
    expect(prompt.length).toBeLessThan(15000);
    expect(prompt).toContain("bounded reference data");
  });
});
