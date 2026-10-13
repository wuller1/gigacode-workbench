import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WorkbenchService } from "../electron/service.js";
import { AtomicStore } from "../electron/store.js";
import {
  AcpConnection,
  classifyTransportText,
  launchSpec,
  redact,
  windowsTreeTermination,
} from "../electron/acp.js";

const fixture = fileURLToPath(
  new URL("./fixtures/acp-fixture.mjs", import.meta.url),
);
const folders: string[] = [];
const services: WorkbenchService[] = [];
const connections: AcpConnection[] = [];
async function temporary() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbench тест "));
  folders.push(directory);
  return directory;
}
async function setup() {
  const root = await temporary();
  const data = path.join(root, "data"),
    bundle = path.join(root, "bundle"),
    project = path.join(root, "project");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(bundle, "CORE.md"),
    "Preserve facts and unknown outcomes.",
  );
  await fs.writeFile(
    path.join(bundle, "profiles/analyst.md"),
    "# Analyst\nUse current evidence.",
  );
  await fs.writeFile(
    path.join(bundle, "profiles/designer.md"),
    "# Designer\nDesign accessible UI and validate UX with evidence.",
  );
  const events: any[] = [];
  const service = new WorkbenchService({
    dataDir: data,
    bundleDir: bundle,
    emit: (e) => events.push(e),
  });
  await service.init();
  services.push(service);
  await service.invoke("settings.update", {
    patch: { cliPath: fixture, cliArgs: ["--acp"], startupRetries: 0 },
  });
  const p = await service.invoke("project.create", {
    name: "Test",
    path: project,
  });
  const t = await service.invoke("task.create", {
    projectId: p.id,
    title: "Task",
  });
  const a = await service.invoke("session.create", {
    taskId: t.id,
    title: "A",
  });
  const b = await service.invoke("session.create", {
    taskId: t.id,
    title: "B",
  });
  return { root, data, bundle, project, service, a, b, t, p, events };
}
async function until(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout)
      throw new Error("Condition did not become true");
    await new Promise((r) => setTimeout(r, 15));
  }
}
async function logs(directory: string) {
  try {
    return (
      await fs.readFile(path.join(directory, "fixture-events.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((x) => JSON.parse(x));
  } catch {
    return [];
  }
}
afterEach(async () => {
  await Promise.all(
    services.splice(0).map((s) => s.dispose().catch(() => undefined)),
  );
  await Promise.all(connections.splice(0).map((s) => s.dispose()));
  await Promise.all(
    folders.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});

describe("durable backend", () => {
  it("resolves persisted @bundled against the current extraction after restart", async () => {
    const x = await setup();
    await x.service.invoke("settings.update", {
      patch: { cliPath: "@bundled" },
    });
    await x.service.dispose();
    services.splice(services.indexOf(x.service), 1);
    const firstPath = path.join(x.root, "old extraction.mjs"),
      secondPath = path.join(x.root, "new extraction.mjs");
    await fs.copyFile(fixture, firstPath);
    await fs.copyFile(fixture, secondPath);
    const first = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      bundledCliPath: firstPath,
      emit: () => undefined,
    });
    await first.init();
    services.push(first);
    await first.invoke("session.send", { id: x.a.id, text: "old extraction" });
    await until(() => first.snapshot().sessions[0].status === "completed");
    await first.dispose();
    services.splice(services.indexOf(first), 1);
    await fs.unlink(firstPath);
    const second = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      bundledCliPath: secondPath,
      emit: () => undefined,
    });
    await second.init();
    services.push(second);
    expect(second.snapshot().settings.cliPath).toBe("@bundled");
    await second.invoke("session.send", { id: x.a.id, text: "new extraction" });
    await until(
      () =>
        second.snapshot().sessions[0].status === "completed" &&
        second.snapshot().sessions[0].messages.filter((m) => m.role === "user")
          .length === 2,
    );
    expect(
      (await logs(x.project))
        .filter((l) => l.type === "prompt")
        .map((l) => l.command),
    ).toEqual(["old extraction", "new extraction"]);
    expect(
      await fs.readFile(path.join(x.data, "state.json"), "utf8"),
    ).not.toContain(firstPath);
    expect(
      await fs.readFile(path.join(x.data, "state.json"), "utf8"),
    ).not.toContain(secondPath);
  });
  it("fails before dispatch when selected bundled CLI is missing, preserving queued input", async () => {
    const x = await setup();
    await x.service.invoke("settings.update", {
      patch: { cliPath: "@bundled" },
    });
    await x.service.invoke("session.send", { id: x.a.id, text: "preserve me" });
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].error).toContain(
      "bundled CLI is unavailable",
    );
    expect(x.service.snapshot().sessions[0].queue[0].text).toBe("preserve me");
    expect(await logs(x.project)).toEqual([]);
  });
  it("persists real project/session state and refuses a second writer", async () => {
    const x = await setup();
    const second = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      emit: () => undefined,
    });
    await expect(second.init()).rejects.toThrow("already owned");
    await x.service.invoke("memory.write", {
      text: "User prefers scoped evidence.",
    });
    await x.service.dispose();
    services.splice(services.indexOf(x.service), 1);
    const resumed = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      emit: () => undefined,
    });
    await resumed.init();
    services.push(resumed);
    expect(resumed.snapshot().sessions.map((s) => s.id)).toEqual([
      x.a.id,
      x.b.id,
    ]);
    expect(await resumed.invoke("memory.read")).toEqual({
      text: "User prefers scoped evidence.",
    });
  });
  it("does not replace corrupt history with an empty state", async () => {
    const directory = await temporary();
    await fs.writeFile(path.join(directory, "state.json"), "{corrupt");
    const store = new AtomicStore(
      directory,
      () => ({ value: 0 }),
      (v): v is { value: number } =>
        !!v && typeof (v as any).value === "number",
    );
    await expect(store.init()).rejects.toThrow("refusing to reset");
    expect(await fs.readFile(path.join(directory, "state.json"), "utf8")).toBe(
      "{corrupt",
    );
  });
  it("appends bounded reference memory atomically and deduplicates across restart", async () => {
    const x = await setup();
    const note = {
      statement: "Prefer scoped evidence.",
      evidence: "User preference recorded in task abc.",
      scope: "global",
    };
    const results = await Promise.all([
      x.service.invoke("memory.remember", note),
      x.service.invoke("memory.remember", note),
      x.service.invoke("memory.remember", {
        ...note,
        statement: "State uncertainty explicitly.",
      }),
    ]);
    expect(results.filter((r) => r.saved)).toHaveLength(2);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    const before = (await x.service.invoke("memory.read")).text;
    expect(before.match(/Workbench reference/g)).toHaveLength(2);
    expect(before).toContain("reference_only");
    expect(x.service.snapshot()).not.toHaveProperty("_memory");
    await x.service.dispose();
    services.splice(services.indexOf(x.service), 1);
    const resumed = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      emit: () => undefined,
    });
    await resumed.init();
    services.push(resumed);
    expect((await resumed.invoke("memory.remember", note)).duplicate).toBe(
      true,
    );
    expect((await resumed.invoke("memory.read")).text).toBe(before);
  });
  it("refuses memory overflow, foreign scope and common secrets without changing stored notes", async () => {
    const x = await setup();
    await x.service.invoke("memory.write", { text: "x".repeat(19990) });
    const note = { statement: "A fact", evidence: "A source", scope: "global" };
    await expect(x.service.invoke("memory.remember", note)).rejects.toThrow(
      "nothing was truncated",
    );
    await expect(
      x.service.invoke("memory.remember", { ...note, scope: "project" }),
    ).rejects.toThrow("project-specific");
    await expect(
      x.service.invoke("memory.remember", {
        ...note,
        statement: "api_key=DO_NOT_STORE",
      }),
    ).rejects.toThrow("credentials");
    await expect(
      x.service.invoke("memory.remember", {
        ...note,
        statement: "s".repeat(1001),
      }),
    ).rejects.toThrow("Invalid");
    await expect(
      x.service.invoke("memory.write", { text: "y".repeat(20001) }),
    ).rejects.toThrow("Invalid");
    expect((await x.service.invoke("memory.read")).text).toBe(
      "x".repeat(19990),
    );
  });
  it("keeps deferred-tool discovery and bounded memory retrieval in fresh and recovered context", async () => {
    const x = await setup();
    await x.service.invoke("memory.write", {
      text: "Reference ".repeat(700) + "MEMORY_TAIL_ON_DEMAND",
    });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "first context",
    });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    await x.service.invoke("session.compact", { id: x.a.id });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "continue context",
    });
    await x.service.invoke("queue.resume", { sessionId: x.a.id });
    await until(
      () =>
        x.service.snapshot().sessions[0].status === "completed" &&
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 2,
    );
    for (const packet of (await logs(x.project)).filter(
      (l) => l.type === "prompt",
    )) {
      expect(packet.content).toContain("task_history");
      expect(packet.content).toContain("workbench_reference");
      expect(packet.content).toContain("When exposed");
      expect(packet.content).toContain("workbench-ui");
      expect(packet.content).toContain("exact qualified names returned");
      expect(packet.content).toContain("version-dependent");
      expect(packet.content).toContain("memory_read when available");
      expect(packet.content).not.toContain("MEMORY_TAIL_ON_DEMAND");
    }
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt").at(-1).content,
    ).toContain("Host recovery checkpoint");
    expect((await x.service.invoke("memory.read")).text).toContain(
      "MEMORY_TAIL_ON_DEMAND",
    );
  });
  it("preserves corrupt bytes and explicitly reports backup recovery", async () => {
    const directory = await temporary();
    const valid = (v: unknown): v is { value: number } =>
      !!v && typeof (v as any).value === "number";
    const first = new AtomicStore(directory, () => ({ value: 0 }), valid);
    await first.init();
    await first.update((s) => {
      s.value = 1;
    });
    await first.update((s) => {
      s.value = 2;
    });
    await first.close();
    await fs.writeFile(path.join(directory, "state.json"), "bad");
    const restored = new AtomicStore(directory, () => ({ value: 0 }), valid);
    await restored.init();
    expect(restored.read().value).toBe(1);
    expect(restored.recoveryNotice).toContain("preserved");
    expect(
      (await fs.readdir(directory)).some((f) => f.startsWith("state.invalid-")),
    ).toBe(true);
    await restored.close();
  });
  it("isolates simultaneous sessions and streams without additional input", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "hold A" });
    await x.service.invoke("session.send", { id: x.b.id, text: "B" });
    await until(() =>
      x.service.snapshot().sessions.every((s) => s.status === "completed"),
    );
    const [a, b] = x.service.snapshot().sessions;
    expect(a.messages.at(-1)?.content).toContain("done:hold A");
    expect(a.messages.at(-1)?.content).not.toContain("done:B");
    expect(b.messages.at(-1)?.content).toContain("done:B");
    expect(
      new Set(
        (await logs(x.project))
          .filter((l) => l.type === "prompt")
          .map((l) => l.sessionId),
      ).size,
    ).toBe(2);
    expect(
      x.events.filter((e) => e.type === "state.changed").length,
    ).toBeGreaterThan(5);
  });
  it("edits and reorders pending input; cancellation waits for terminal and holds queue", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "hold first" });
    await until(() => x.service.snapshot().sessions[0].status === "running");
    const two = await x.service.invoke("session.send", {
      id: x.a.id,
      text: "second",
    });
    const three = await x.service.invoke("session.send", {
      id: x.a.id,
      text: "third",
    });
    await x.service.invoke("queue.update", {
      sessionId: x.a.id,
      id: three.id,
      text: "third edited",
    });
    await x.service.invoke("queue.move", {
      sessionId: x.a.id,
      id: three.id,
      index: 0,
    });
    await x.service.invoke("queue.delete", { sessionId: x.a.id, id: two.id });
    await x.service.invoke("session.cancel", { id: x.a.id });
    expect(x.service.snapshot().sessions[0].status).toBe("cancelling");
    await new Promise((r) => setTimeout(r, 60));
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt").length,
    ).toBe(1);
    await until(() => x.service.snapshot().sessions[0].status === "idle");
    expect(x.service.snapshot().sessions[0].queue[0].text).toBe("third edited");
    await x.service.invoke("queue.resume", { sessionId: x.a.id });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    expect(
      (await logs(x.project))
        .filter((l) => l.type === "prompt")
        .map((l) => l.command),
    ).toEqual(["hold first", "third edited"]);
  });
  it("does not replay a prompt after connection loss or restart", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "exit" });
    await until(() => x.service.snapshot().sessions[0].status === "unknown");
    await x.service.invoke("session.send", { id: x.a.id, text: "later" });
    await new Promise((r) => setTimeout(r, 100));
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt"),
    ).toHaveLength(1);
    await expect(
      x.service.invoke("queue.resume", { sessionId: x.a.id }),
    ).rejects.toThrow("Recover");
    await x.service.dispose();
    services.splice(services.indexOf(x.service), 1);
    const restarted = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      emit: () => undefined,
    });
    await restarted.init();
    services.push(restarted);
    expect(restarted.snapshot().sessions[0].status).toBe("unknown");
    await new Promise((r) => setTimeout(r, 80));
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt"),
    ).toHaveLength(1);
    await restarted.invoke("session.recover", {
      id: x.a.id,
      summary:
        "Previous exit was a fixture; continue only the queued new instruction.",
    });
    await restarted.invoke("queue.resume", { sessionId: x.a.id });
    await until(() => restarted.snapshot().sessions[0].status === "completed");
    expect(
      (await logs(x.project))
        .filter((l) => l.type === "prompt")
        .map((l) => l.command),
    ).toEqual(["exit", "later"]);
  });
  it("guards active deletion and never deletes project files", async () => {
    const x = await setup();
    await fs.writeFile(path.join(x.project, "keep.txt"), "owned by user");
    await x.service.invoke("session.send", { id: x.a.id, text: "hold" });
    await until(() => x.service.snapshot().sessions[0].status === "running");
    await expect(
      x.service.invoke("project.delete", { id: x.p.id }),
    ).rejects.toThrow("Stop active");
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    const processIds = (await logs(x.project))
      .filter((event) => event.type === "prompt")
      .map((event) => event.pid);
    await x.service.invoke("project.delete", { id: x.p.id });
    for (const pid of processIds) expect(() => process.kill(pid, 0)).toThrow();
    expect(await fs.readFile(path.join(x.project, "keep.txt"), "utf8")).toBe(
      "owned by user",
    );
    expect(x.service.snapshot().tasks).toHaveLength(0);
  });
  it("auto-allows an actual bound permission option without a modal by default", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "permission" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    expect(x.service.snapshot().questions).toHaveLength(0);
    expect(
      (await logs(x.project)).find((l) => l.type === "permission").result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  });
  it("can require an actual permission option when ask-each mode is selected", async () => {
    const x = await setup();
    await x.service.invoke("settings.update", {
      patch: { permissionMode: "ask_each" },
    });
    await x.service.invoke("session.send", { id: x.a.id, text: "permission" });
    await until(() => x.service.snapshot().questions.length === 1);
    const q = x.service.snapshot().questions[0];
    await expect(
      x.service.invoke("question.answer", { id: q.id, text: "yes" }),
    ).rejects.toThrow("actual permission");
    await x.service.invoke("question.answer", { id: q.id, optionId: "once" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    expect(
      (await logs(x.project)).find((l) => l.type === "permission").result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  });
  it("routes roles automatically from request and project context", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "Спроектируй UI/UX макет и проверь удобство интерфейса.",
    });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    const session = x.service.snapshot().sessions[0];
    expect(session.profileId).toBe("designer");
    expect(session.profileConfidence).toBeGreaterThanOrEqual(0.55);
    expect(session.profileReason).toContain("UI/UX");
  });
  it("does not expose manual role selection through session updates", async () => {
    const x = await setup();
    await expect(
      x.service.invoke("session.create", {
        taskId: x.t.id,
        title: "Manual role",
        profileId: "analyst",
      }),
    ).rejects.toThrow("selected automatically");
    await expect(
      x.service.invoke("session.update", {
        id: x.a.id,
        profileId: "analyst",
      }),
    ).rejects.toThrow("selected automatically");
  });
  it("preserves free answers through the real host tool without queuing a duplicate", async () => {
    const x = await setup();
    const q = await x.service.invoke("question.create", {
      sessionId: x.a.id,
      title: "Choose or explain",
      delivery: "tool",
      options: [{ id: "one", label: "First" }],
    });
    await x.service.invoke("question.answer", {
      id: q.id,
      text: "A custom answer",
    });
    expect(x.service.snapshot().questions[0].answer).toBe("A custom answer");
    expect(x.service.snapshot().sessions[0].queue).toHaveLength(0);
  });
  it("uses discovered config values and refreshes reasoning after model switch", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "hello" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    await expect(
      x.service.invoke("session.config", {
        id: x.a.id,
        configId: "reasoning_effort",
        value: "high",
      }),
    ).rejects.toThrow("not offered");
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "reasoning_effort",
      value: "low",
    });
    expect(
      x.service
        .snapshot()
        .sessions[0].configOptions?.find((c) => c.id === "reasoning_effort")
        ?.currentValue,
    ).toBe("low");
    await x.service.invoke("session.compact", { id: x.a.id });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "after checkpoint",
    });
    await x.service.invoke("queue.resume", { sessionId: x.a.id });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    const last = (await logs(x.project))
      .filter((l) => l.type === "prompt")
      .at(-1);
    expect(last.model).toBe("fixture-reasoning");
    expect(last.reasoning).toBe("low");
  });
  it("captures busy configuration and applies a later change only to the next turn", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "hold current",
    });
    await until(() => x.service.snapshot().sessions[0].status === "running");
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await x.service.invoke("session.send", { id: x.a.id, text: "next config" });
    await until(
      () =>
        x.service.snapshot().sessions[0].status === "completed" &&
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 2,
    );
    expect(
      (await logs(x.project))
        .filter((l) => l.type === "prompt")
        .map((l) => l.model),
    ).toEqual(["fixture-fast", "fixture-reasoning"]);
  });
  it("drops saved reasoning after switching to a non-reasoning model and sends the next turn", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "initial" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "reasoning_effort",
      value: "low",
    });
    expect(x.service.snapshot().sessions[0].reasoning).toBe("low");
    expect(
      (
        await x.service.invoke("session.config", {
          id: x.a.id,
          configId: "model",
          value: "fixture-fast",
        })
      ).status,
    ).toBe("applied");
    expect(
      x.service
        .snapshot()
        .sessions[0].configOptions?.some((o) => o.id === "reasoning_effort"),
    ).toBe(false);
    expect(x.service.snapshot().sessions[0].reasoning).toBe("");
    await x.service.invoke("session.send", { id: x.a.id, text: "fast again" });
    await until(
      () =>
        x.service.snapshot().sessions[0].status === "completed" &&
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 2,
    );
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt").at(-1).model,
    ).toBe("fixture-fast");
    await x.service.invoke("session.compact", { id: x.a.id });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "restored fast",
    });
    await x.service.invoke("queue.resume", { sessionId: x.a.id });
    await until(
      () =>
        x.service.snapshot().sessions[0].status === "completed" &&
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 3,
    );
    expect(
      (await logs(x.project)).filter(
        (l) => l.type === "config_start" && l.id === "reasoning_effort",
      ),
    ).toHaveLength(1);
  });
  it("does not silently drop an explicit pending reasoning request when the next model cannot support it", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "initial" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "hold before model change",
    });
    await until(() => x.service.snapshot().sessions[0].status === "running");
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "reasoning_effort",
      value: "low",
    });
    await x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-fast",
    });
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "must not silently send",
    });
    await until(() => x.service.snapshot().sessions[0].status === "failed");
    expect(x.service.snapshot().sessions[0].error).toContain(
      "reasoning_effort",
    );
    expect(x.service.snapshot().sessions[0].queue[0].text).toBe(
      "must not silently send",
    );
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt"),
    ).toHaveLength(2);
    await expect(
      x.service.invoke("session.config", {
        id: x.a.id,
        configId: "reasoning_effort",
        value: "low",
      }),
    ).rejects.toThrow("not offered");
  });
  it("does not dispatch a prompt while idle configuration is awaiting its receipt", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "first" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    const changing = x.service.invoke("session.config", {
      id: x.a.id,
      configId: "model",
      value: "fixture-reasoning",
    });
    await until(async () =>
      (await logs(x.project)).some((l) => l.type === "config_start"),
    );
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "after config",
    });
    await changing;
    await until(
      () =>
        x.service.snapshot().sessions[0].status === "completed" &&
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 2,
    );
    const events = await logs(x.project);
    expect(events.findIndex((l) => l.type === "config_end")).toBeLessThan(
      events.findIndex(
        (l) => l.type === "prompt" && l.command === "after config",
      ),
    );
  });
  it("keeps real plans and bounded long tool input without breaking event persistence", async () => {
    const x = await setup();
    await x.service.invoke("session.send", { id: x.a.id, text: "plan" });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    expect(x.service.snapshot().sessions[0].todos.map((t) => t.status)).toEqual(
      ["completed", "in_progress"],
    );
    await x.service.invoke("session.send", { id: x.a.id, text: "large-tool" });
    await until(
      () =>
        x.service
          .snapshot()
          .sessions[0].messages.filter((m) => m.role === "user").length === 2 &&
        x.service.snapshot().sessions[0].status === "completed",
    );
    expect(
      x.service.snapshot().sessions[0].messages.at(-1)?.tools?.[0].output,
    ).toBe("done");
  });
  it("captures immutable artifacts and rejects application-private files", async () => {
    const x = await setup();
    const source = path.join(x.project, "note.txt");
    await fs.writeFile(source, "v1");
    const artifact = await x.service.invoke("artifact.register", {
      taskId: x.t.id,
      path: source,
    });
    await fs.writeFile(source, "v2");
    expect(await fs.readFile(artifact.path, "utf8")).toBe("v1");
    await expect(
      x.service.invoke("artifact.register", {
        taskId: x.t.id,
        path: path.join(x.data, "state.json"),
      }),
    ).rejects.toThrow("must belong");
  });
  it("resolves relative artifact paths from the project and rejects traversal", async () => {
    const x = await setup();
    await fs.writeFile(
      path.join(x.project, "relative.html"),
      "<h1>Project</h1>",
    );
    await fs.writeFile(path.join(x.root, "outside.txt"), "outside");
    const artifact = await x.service.invoke("artifact.register", {
      taskId: x.t.id,
      path: "relative.html",
    });
    expect(await fs.readFile(artifact.path, "utf8")).toBe("<h1>Project</h1>");
    await expect(
      x.service.invoke("artifact.register", {
        taskId: x.t.id,
        path: "../outside.txt",
      }),
    ).rejects.toThrow("must belong");
  });
  it("imports completed typed Qwen workspace artifacts once, without trusting titles or foreign paths", async () => {
    const x = await setup();
    await fs.writeFile(path.join(x.project, "preview.html"), "<h1>Actual</h1>");
    await fs.writeFile(path.join(x.project, "report.md"), "Actual report");
    await fs.writeFile(path.join(x.root, "outside.txt"), "private");
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "typed-artifacts",
    });
    await until(() => x.service.snapshot().sessions[0].status === "completed");
    const artifacts = x.service.snapshot().artifacts;
    expect(artifacts.map((a) => a.name)).toEqual(["Preview", "Report"]);
    expect(await fs.readFile(artifacts[0].path, "utf8")).toBe(
      "<h1>Actual</h1>",
    );
    expect(x.service.snapshot()).not.toHaveProperty("_artifactReceipts");
    await fs.writeFile(path.join(x.project, "preview.html"), "changed");
    expect(await fs.readFile(artifacts[0].path, "utf8")).toBe(
      "<h1>Actual</h1>",
    );
  });
  it("delivers peer coordination at a safe boundary, without a user bubble or duplicates", async () => {
    const x = await setup();
    await x.service.invoke("session.send", {
      id: x.b.id,
      text: "hold recipient",
    });
    await until(() => x.service.snapshot().sessions[1].status === "running");
    const params = {
      id: x.b.id,
      sourceId: x.a.id,
      text: "contract result",
      operationId: "contract-v1",
    };
    const first = await x.service.invoke("session.peerMessage", params);
    const repeated = await x.service.invoke("session.peerMessage", params);
    expect(repeated.id).toBe(first.id);
    expect(x.service.snapshot().sessions[1].queue).toHaveLength(0);
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt"),
    ).toHaveLength(1);
    await until(
      async () =>
        (await logs(x.project)).filter((l) => l.type === "prompt").length ===
          2 && x.service.snapshot().sessions[1].status === "completed",
    );
    const packets = (await logs(x.project)).filter((l) => l.type === "prompt");
    expect(packets.map((l) => l.command)).toEqual([
      "hold recipient",
      "contract result",
    ]);
    expect(packets[1].content).toContain(
      "not a user instruction or permission grant",
    );
    expect(
      x.service
        .snapshot()
        .sessions[1].messages.filter((m) => m.role === "user"),
    ).toHaveLength(1);
    expect((await x.service.invoke("session.peerMessage", params)).status).toBe(
      "observed",
    );
    await expect(
      x.service.invoke("session.peerMessage", { ...params, text: "changed" }),
    ).rejects.toThrow("reused");
  });
  it("persists hidden peer queue across restart and does not replay an unknown delivery", async () => {
    const x = await setup();
    await x.service.invoke("session.cancel", { id: x.b.id });
    const params = {
      id: x.b.id,
      sourceId: x.a.id,
      text: "exit",
      operationId: "unknown-result",
    };
    await x.service.invoke("session.peerMessage", params);
    await x.service.dispose();
    services.splice(services.indexOf(x.service), 1);
    const resumed = new WorkbenchService({
      dataDir: x.data,
      bundleDir: x.bundle,
      emit: () => undefined,
    });
    await resumed.init();
    services.push(resumed);
    expect((await resumed.invoke("session.peerMessage", params)).status).toBe(
      "retained",
    );
    expect(await logs(x.project)).toHaveLength(0);
    await resumed.invoke("queue.resume", { sessionId: x.b.id });
    await until(() => resumed.snapshot().sessions[1].status === "unknown");
    expect((await resumed.invoke("session.peerMessage", params)).status).toBe(
      "unknown",
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(
      (await logs(x.project)).filter((l) => l.type === "prompt"),
    ).toHaveLength(1);
  });
  it("rejects cross-project peers and self-trigger loops", async () => {
    const x = await setup();
    const otherPath = await temporary();
    const p = await x.service.invoke("project.create", {
      name: "Other",
      path: otherPath,
    });
    const t = await x.service.invoke("task.create", {
      projectId: p.id,
      title: "Other",
    });
    const s = await x.service.invoke("session.create", { taskId: t.id });
    await expect(
      x.service.invoke("session.peerMessage", {
        id: s.id,
        sourceId: x.a.id,
        text: "foreign",
        operationId: "x",
      }),
    ).rejects.toThrow("Cross-project");
    await expect(
      x.service.invoke("session.peerMessage", {
        id: x.a.id,
        sourceId: x.a.id,
        text: "loop",
        operationId: "x",
      }),
    ).rejects.toThrow("different recipient");
  });
});

describe("ACP boundaries", () => {
  it.each([400, 413, 429, 502])(
    "classifies bounded HTML without executing or guessing HTTP %i",
    (status) => {
      const body = `<html><title>${status} Gateway</title><script>SECRET_SCRIPT()</script><body>Retry https://user:password@example.test/path?token=SECRET_QUERY</body></html>`;
      const observed = classifyTransportText(body, status);
      expect(observed.kind).toBe("html_gateway");
      expect(observed.httpStatus).toBe(status);
      expect(observed.message).not.toMatch(
        /SECRET_SCRIPT|SECRET_QUERY|user:password|<html>/,
      );
      expect(classifyTransportText(body).httpStatus).toBeUndefined();
      expect(
        classifyTransportText(body + "a".repeat(100000)).message.length,
      ).toBeLessThan(900);
    },
  );
  it("rejects unsafe Windows wrappers and keeps arguments as argv for real executables", () => {
    expect(() => launchSpec("C:\\qwen.cmd", ["hello&calc"], "win32")).toThrow(
      "Unsafe",
    );
    expect(() => launchSpec("C:\\qwen.cmd", ["%TEMP%"], "win32")).toThrow(
      "Unsafe",
    );
    const safe = launchSpec("C:\\программа cli.cmd", ["--acp"], "win32");
    expect(safe.args).toContain("/v:off");
    expect(launchSpec("/tmp/program", ["text; not shell"]).args).toEqual([
      "text; not shell",
    ]);
    expect(redact("Bearer secret https://example.test?a=token")).not.toContain(
      "secret",
    );
    expect(
      redact('{"api_key":"DO_NOT_EXPORT","password":"DO_NOT_EXPORT"}'),
    ).not.toContain("DO_NOT_EXPORT");
  });
  it("constructs an owned Windows process-tree termination and exposes GC before the JS entry", () => {
    expect(windowsTreeTermination(1234).args).toEqual([
      "/PID",
      "1234",
      "/T",
      "/F",
    ]);
    expect(windowsTreeTermination(1234).file).toMatch(
      /System32\\taskkill\.exe$/,
    );
    expect(() => windowsTreeTermination(-1)).toThrow("identity");
    expect(() => windowsTreeTermination(Number.NaN)).toThrow("identity");
    const launch = launchSpec("/test/cli.js", ["--acp"]);
    expect(launch.file).toBe(process.execPath);
    expect(launch.args).toEqual(["--expose-gc", "/test/cli.js", "--acp"]);
  });
  it("rejects malformed live frames with ambiguous outcome and does not replay", async () => {
    const directory = await temporary();
    const connection = new AcpConnection({
      executable: fixture,
      args: [],
      cwd: directory,
    });
    connections.push(connection);
    await connection.start();
    const session = await connection.newSession({
      cwd: directory,
      mcpServers: [],
    });
    await expect(
      connection.prompt(session.sessionId, "malformed"),
    ).rejects.toMatchObject({ ambiguous: true });
    expect(
      (await logs(directory)).filter((l) => l.type === "prompt"),
    ).toHaveLength(1);
  });
  it("rejects a second concurrent prompt on the same session", async () => {
    const directory = await temporary();
    const connection = new AcpConnection({
      executable: fixture,
      args: [],
      cwd: directory,
    });
    connections.push(connection);
    await connection.start();
    const session = await connection.newSession({
      cwd: directory,
      mcpServers: [],
    });
    const first = connection.prompt(session.sessionId, "hold");
    await expect(
      connection.prompt(session.sessionId, "duplicate"),
    ).rejects.toThrow("already active");
    await first;
  });
});
