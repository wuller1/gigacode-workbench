import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchService, type WorkbenchOptions } from "../electron/service";
import { UiMcpServer } from "../electron/mcp";

const cleanups: (() => Promise<unknown>)[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function until(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout)
      throw new Error("Resilience condition did not become true.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function drainOwnedStorage(service: WorkbenchService) {
  // A bounded shutdown receipt can report failure before its owned writes settle.
  // Fixture removal must wait for those real operations, including a restarted
  // service that intentionally inherits the test's 50 ms acknowledgement limit.
  await service.dispose();
  await until(() => (service as any).launches.size === 0);
  await (service as any).flushPromise;
  await (service as any).store.close().catch(() => undefined);
}
async function setup(extra: Partial<WorkbenchOptions> = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "resilience-service-"),
  );
  const bundleDir = path.join(directory, "bundle"),
    dataDir = path.join(directory, "data"),
    projectPath = path.join(directory, "project");
  await fs.mkdir(path.join(bundleDir, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(bundleDir, "CORE.md"),
    "Keep facts and reconcile uncertain results.",
  );
  await fs.writeFile(
    path.join(bundleDir, "profiles", "analyst.md"),
    "# Analyst\nUse real evidence.",
  );
  let server: UiMcpServer;
  const events: any[] = [];
  const bindings = new Map<
    string,
    ReturnType<UiMcpServer["binding"]>[number]
  >();
  const options: WorkbenchOptions = {
    bundleDir,
    dataDir,
    emit: (event) => events.push(event),
    mcpServersForSession: (sessionId, generation) => {
      const value = server.binding(sessionId, generation);
      bindings.set(sessionId, value[0]);
      return value;
    },
    revokeSessionTools: (sessionId) => server?.revokeBinding(sessionId),
    ...extra,
  };
  const service = new WorkbenchService(options);
  await service.init();
  server = new UiMcpServer(
    () => service.snapshot(),
    (method, params) => service.invoke(method, params),
  );
  await server.start();
  cleanups.push(async () => {
    await drainOwnedStorage(service);
    await server.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await service.invoke("settings.update", {
    patch: {
      cliPath: fileURLToPath(
        new URL("./fixtures/acp-fixture.mjs", import.meta.url),
      ),
      cliArgs: ["--acp"],
      startupRetries: 0,
      maxConcurrent: 1,
    },
  });
  const project = await service.invoke("project.create", {
    name: "Resilience",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Recover safely",
  });
  const a = await service.invoke("session.create", {
    taskId: task.id,
    title: "A",
  });
  const b = await service.invoke("session.create", {
    taskId: task.id,
    title: "B",
  });
  const state = () =>
    service.snapshot().sessions.find((session) => session.id === a.id)!;
  const live = () => (service as any).live.get(a.id);
  const logs = async () => {
    try {
      return (
        await fs.readFile(
          path.join(projectPath, "fixture-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  const start = async (command = "hold ui active") => {
    await service.invoke("session.send", { id: a.id, text: command });
    await until(
      async () =>
        state().status === "running" &&
        (await logs()).some((entry) => entry.type === "prompt"),
    );
  };
  const checkBinding = async (binding = bindings.get(a.id)!) =>
    (
      await fetch(binding.url, {
        method: "POST",
        headers: { Authorization: binding.headers[0].value },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    ).status;
  const restart = async () => {
    const resumed = new WorkbenchService({
      ...options,
      mcpServersForSession: undefined,
    });
    await resumed.init();
    cleanups.push(() => drainOwnedStorage(resumed));
    return resumed;
  };
  return {
    service,
    options,
    events,
    dataDir,
    projectPath,
    task,
    a,
    b,
    state,
    live,
    logs,
    start,
    bindings,
    checkBinding,
    restart,
  };
}
function gateNextWrite(
  service: WorkbenchService,
  predicate: (...args: unknown[]) => boolean = () => true,
) {
  const store = (service as any).store;
  const atomic = store.atomic.bind(store);
  let release!: () => void,
    entered!: () => void,
    gated = false;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  releases.push(release);
  vi.spyOn(store, "atomic").mockImplementation(async (...args: unknown[]) => {
    if (!gated && predicate(...args)) {
      gated = true;
      entered();
      await wait;
    }
    return atomic(...args);
  });
  return { release, entered: enteredPromise };
}

describe("service fault containment and recovery", () => {
  it("atomically rejects one of two writers editing the same original queued text", async () => {
    const x = await setup();
    await x.start();
    const queued = await x.service.invoke("session.send", {
      id: x.a.id,
      text: "Original queued text",
    });
    const results = await Promise.allSettled([
      x.service.invoke("queue.update", {
        sessionId: x.a.id,
        id: queued.id,
        text: "Window A edit",
        expectedText: "Original queued text",
      }),
      x.service.invoke("queue.update", {
        sessionId: x.a.id,
        id: queued.id,
        text: "Window B edit",
        expectedText: "Original queued text",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const conflict = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(conflict.reason.message).toContain("changed in another window");
    const winner = results.find(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<any>;
    expect(x.state().queue.find((item) => item.id === queued.id)?.text).toBe(
      winner.value.text,
    );
    expect(x.events.some((event) => event.type === "runtime.stopped")).toBe(
      false,
    );
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });
  it("returns a confirmed persistence receipt from normal disposal", async () => {
    const x = await setup();
    expect(await x.service.dispose()).toEqual({ persistence: "saved" });
    expect(await x.service.dispose()).toEqual({ persistence: "saved" });
  });
  it("quiesces synchronously, revokes MCP, preserves queued input and allows only evidence reads until restart", async () => {
    const x = await setup();
    await x.start();
    const owned = x.live(),
      oldBinding = x.bindings.get(x.a.id)!;
    await x.service.invoke("session.send", {
      id: x.b.id,
      text: "never-dispatched-before-stop",
    });
    const stopped = x.service.quiesce("Controlled main failure");
    expect(owned.client.alive).toBe(false);
    expect(
      x.events.find((event) => event.type === "runtime.stopped")?.payload,
    ).toMatchObject({ persistence: "pending" });
    expect(await x.checkBinding(oldBinding)).toBe(401);
    await expect(
      x.service.invoke("session.send", {
        id: x.a.id,
        text: "forbidden-after-stop",
      }),
    ).rejects.toThrow(/stopped/i);
    expect(await stopped).toEqual({ persistence: "saved" });
    expect(x.state().status).toBe("unknown");
    expect(x.state().messages.at(-1)?.outcome).toBe("unknown");
    expect(
      (await x.service.invoke("state.get")).sessions[1].queue[0].text,
    ).toBe("never-dispatched-before-stop");
    const report = await x.service.invoke("diagnostics.export");
    expect(await fs.readFile(report.path, "utf8")).toContain(
      "Controlled main failure",
    );
    const resumed = await x.restart();
    expect(resumed.snapshot().sessions[0].status).toBe("unknown");
    expect(resumed.snapshot().sessions[1].queue).toHaveLength(1);
    await expect(
      resumed.invoke("queue.resume", { id: x.a.id }),
    ).rejects.toThrow(/unknown/i);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });

  it("always stops owned executors even when the shutdown state cannot be written", async () => {
    const x = await setup();
    await x.start();
    const owned = x.live();
    const error = Object.assign(new Error("Controlled disk failure"), {
      code: "ENOSPC",
    });
    vi.spyOn((x.service as any).store, "update").mockRejectedValue(error);
    expect(await x.service.quiesce("Fatal during disk failure")).toEqual({
      persistence: "failed",
    });
    expect(await x.service.dispose()).toEqual({ persistence: "failed" });
    expect(owned.client.alive).toBe(false);
    expect(await x.checkBinding()).toBe(401);
    expect((x.service as any).live.size).toBe(0);
    expect(x.events.at(-1)).toMatchObject({
      type: "runtime.stopped",
      payload: { persistence: "failed" },
    });
    await expect(
      x.service.invoke("settings.update", { patch: { maxConcurrent: 2 } }),
    ).rejects.toThrow(/stopped/i);
  });

  it.each(["reject", "throw"])(
    "contains an owned dispose %s immediately and still retires another executor",
    async (mode) => {
      const x = await setup();
      await x.service.invoke("settings.update", {
        patch: { maxConcurrent: 2 },
      });
      await x.service.invoke("session.prepare", { id: x.a.id });
      await x.service.invoke("session.prepare", { id: x.b.id });
      const first = x.live().client,
        second = (x.service as any).live.get(x.b.id).client;
      const dispose = first.dispose.bind(first);
      vi.spyOn(first, "dispose").mockImplementation(() => {
        void dispose().catch(() => undefined);
        if (mode === "throw")
          throw new Error("Controlled synchronous cleanup failure");
        return Promise.reject(
          new Error("Controlled rejected cleanup acknowledgement"),
        );
      });
      const unhandled: unknown[] = [];
      const observe = (error: unknown) => unhandled.push(error);
      process.on("unhandledRejection", observe);
      const gate = gateNextWrite(x.service);
      try {
        const stop = x.service.quiesce("Controlled executor cleanup fault");
        await gate.entered;
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(first.alive).toBe(false);
        expect(second.alive).toBe(false);
        expect(unhandled).toEqual([]);
        gate.release();
        expect(await stop).toEqual({ persistence: "failed" });
        expect(x.events.at(-1).payload.reason).toContain(
          "cleanup could not be confirmed",
        );
      } finally {
        gate.release();
        process.off("unhandledRejection", observe);
      }
    },
  );

  it("bounds acknowledgement of a stalled disk operation without releasing ownership to a second writer", async () => {
    const x = await setup({ shutdownTimeoutMs: 50 });
    await x.start();
    const owned = x.live();
    const gate = gateNextWrite(x.service);
    const pending = x.service.invoke("task.update", {
      id: x.task.id,
      description: "Already admitted host write",
    });
    // Observe the admitted write even if an earlier assertion fails.
    const settled = pending.then(
      () => ({ resolved: true as const }),
      (error) => ({ resolved: false as const, error }),
    );
    try {
      await gate.entered;
      expect(await x.service.quiesce("Storage is stalled")).toEqual({
        persistence: "failed",
      });
      expect(owned.client.alive).toBe(false);
      expect(await x.checkBinding()).toBe(401);
      expect(
        await fs.readFile(path.join(x.dataDir, "owner.lock"), "utf8"),
      ).toContain(String(process.pid));
      const second = new WorkbenchService({
        ...x.options,
        mcpServersForSession: undefined,
      });
      await expect(second.init()).rejects.toThrow(/already owned/i);
    } finally {
      gate.release();
      await settled;
      await drainOwnedStorage(x.service);
    }
    const outcome = await settled;
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) throw outcome.error;
    await expect(
      fs.stat(path.join(x.dataDir, "owner.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const resumed = await x.restart();
    expect(resumed.snapshot().sessions[0].status).toBe("unknown");
  });

  it("stops a still-running CLI immediately after its streamed trace write fails", async () => {
    const x = await setup();
    await x.start();
    const owned = x.live();
    await until(() => !!(x.service as any).streamUpdates.get(x.a.id)?.length);
    vi.spyOn((x.service as any).store, "update").mockRejectedValueOnce(
      Object.assign(new Error("Controlled lost stream"), { code: "EIO" }),
    );
    await expect((x.service as any).flushUpdates()).rejects.toThrow(
      "Controlled lost stream",
    );
    expect(owned.client.alive).toBe(false);
    expect(await x.checkBinding()).toBe(401);
    expect(await x.service.quiesce("Observe existing stop")).toEqual({
      persistence: "failed",
    });
    expect(x.state().status).toBe("unknown");
    expect(x.state().messages.at(-1)?.outcome).toBe("unknown");
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });

  it("preserves pre-dispatch input when shutdown interrupts startup and aborts an unresponsive classifier", async () => {
    for (const routing of [false, true]) {
      const x = await setup(
        routing
          ? { routeProfile: async () => new Promise(() => undefined) }
          : {},
      );
      if (!routing)
        await x.service.invoke("settings.update", {
          patch: { cliArgs: ["--acp", "--hold-new-session"] },
        });
      await x.service.invoke("session.send", {
        id: x.a.id,
        text: "unsent-user-input",
      });
      await until(async () =>
        routing
          ? (x.service as any).routing.has(x.a.id)
          : (await x.logs()).some((entry) => entry.type === "session_new"),
      );
      expect(await x.service.quiesce("Stop during admission")).toEqual({
        persistence: "saved",
      });
      expect(x.state().status).toBe("failed");
      expect(x.state().queue.map((item) => item.text)).toEqual([
        "unsent-user-input",
      ]);
      expect(x.state().messages).toHaveLength(0);
      expect(
        (await x.logs()).filter((entry) => entry.type === "prompt"),
      ).toHaveLength(0);
      await until(() => !(x.service as any).launches.has(x.a.id));
    }
  });

  it("does not stop the runtime for an ordinary invalid request", async () => {
    const x = await setup();
    await x.start();
    await expect(
      x.service.invoke("session.update", {
        id: x.a.id,
        profileId: "manual-override",
      }),
    ).rejects.toThrow(/automatically/i);
    expect(x.live().client.alive).toBe(true);
    expect(await x.checkBinding()).toBe(200);
    expect(x.events.some((event) => event.type === "runtime.stopped")).toBe(
      false,
    );
  });

  it("never advertises phase resume after a permanent runtime stop", async () => {
    const x = await setup();
    await x.start();
    await x.service.invoke("role.transition.request", {
      sessionId: x.a.id,
      generation: x.live().generation,
      operationId: "held-before-stop",
      reason: "Await a verified router",
      continuation: "Continue the accepted phase",
      roleHint: "analyst",
    });
    await x.live().client.request("fixture/finish", { stopReason: "end_turn" });
    await until(() => !(x.service as any).launches.has(x.a.id));
    expect(x.state().roleTransition?.canResume).toBe(true);
    await x.service.quiesce("Controlled permanent stop");
    expect(x.state().roleTransition?.canResume).toBe(false);
    expect(x.state().roleTransitionHistory?.at(-1)?.canResume).toBe(false);
  });

  it.each(["EBUSY", "ENOENT"])(
    "globally stops on a real store %s fault rather than treating it as a domain validation error",
    async (code) => {
      const x = await setup();
      await x.start();
      const owned = x.live();
      vi.spyOn((x.service as any).store, "atomic").mockRejectedValueOnce(
        Object.assign(new Error(`Controlled ${code}`), { code }),
      );
      await expect(
        x.service.invoke("settings.update", { patch: { maxConcurrent: 2 } }),
      ).rejects.toThrow(`Controlled ${code}`);
      expect(owned.client.alive).toBe(false);
      expect(await x.checkBinding()).toBe(401);
      expect(await x.service.quiesce("Observe prior storage fence")).toEqual({
        persistence: "failed",
      });
      expect(x.service.snapshot().settings.maxConcurrent).toBe(1);
      expect(x.state().status).toBe("unknown");
    },
  );

  it("enforces the native cancel deadline even while its durable acknowledgement is blocked by storage", async () => {
    const x = await setup({ cancelTimeoutMs: 50 });
    await x.start("ignore-cancel");
    const owned = x.live();
    await x.service.invoke("session.send", {
      id: x.a.id,
      text: "preserved-after-ignored-cancel",
    });
    const gate = gateNextWrite(x.service);
    let acknowledged = false;
    const cancel = x.service
      .invoke("session.cancel", { id: x.a.id })
      .then((result) => {
        acknowledged = true;
        return result;
      });
    await gate.entered;
    await until(() => !owned.client.alive, 1000);
    expect(acknowledged).toBe(false);
    expect(await x.checkBinding()).toBe(401);
    gate.release();
    await cancel;
    await until(() => !(x.service as any).launches.has(x.a.id));
    expect(x.state().status).toBe("unknown");
    expect(x.state().queue.map((item) => item.text)).toEqual([
      "preserved-after-ignored-cancel",
    ]);
    await expect(
      x.service.invoke("queue.resume", { id: x.a.id }),
    ).rejects.toThrow(/unknown/i);
    expect(
      (await x.logs()).filter((entry) => entry.type === "prompt"),
    ).toHaveLength(1);
  });

  it("does not grant a permission if Stop retires its generation while the human answer is being persisted", async () => {
    const x = await setup();
    await x.service.invoke("settings.update", {
      patch: { permissionMode: "ask_each" },
    });
    await x.service.invoke("session.send", { id: x.a.id, text: "permission" });
    await until(() =>
      x.service.snapshot().questions.some((q) => q.status === "pending"),
    );
    const question = x.service.snapshot().questions[0];
    expect(question.generation).toBe(x.live().generation);
    const gate = gateNextWrite(x.service, (...args) =>
      String(args[1]).includes('"deliveryStatus":"saved"'),
    );
    const answer = x.service.invoke("question.answer", {
      id: question.id,
      optionId: "once",
    });
    await gate.entered;
    const cancel = x.service.invoke("session.cancel", { id: x.a.id });
    expect(await x.checkBinding()).toBe(401);
    gate.release();
    expect(await answer).toMatchObject({ status: "stale", delivered: false });
    await cancel;
    await until(() => !(x.service as any).launches.has(x.a.id));
    const receipts = (await x.logs()).filter(
      (entry) => entry.type === "permission",
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0].result).toEqual({ outcome: { outcome: "cancelled" } });
    expect(x.service.snapshot().questions[0].deliveryStatus).toBe("stale");
  });

  it("saves a late free answer as reference but never reports delivery to a retired question waiter", async () => {
    const x = await setup();
    await x.start();
    const question = await x.service.invoke("question.create", {
      sessionId: x.a.id,
      title: "Real question",
      delivery: "tool",
      generation: x.live().generation,
    });
    const waiting = x.service.invoke("question.wait", { id: question.id });
    const gate = gateNextWrite(x.service, (...args) =>
      String(args[1]).includes('"deliveryStatus":"saved"'),
    );
    const answer = x.service.invoke("question.answer", {
      id: question.id,
      text: "Actual human answer",
    });
    await gate.entered;
    const cancel = x.service.invoke("session.cancel", { id: x.a.id });
    expect(await waiting).toHaveProperty("error");
    gate.release();
    expect(await answer).toMatchObject({ status: "saved", delivered: false });
    await cancel;
    expect(x.service.snapshot().questions[0]).toMatchObject({
      answer: "Actual human answer",
      deliveryStatus: "stale",
    });
    await expect(
      x.service.invoke("question.wait", { id: question.id }),
    ).rejects.toThrow(/no longer live/i);
    expect(x.state().queue).toHaveLength(0);
  });
});
