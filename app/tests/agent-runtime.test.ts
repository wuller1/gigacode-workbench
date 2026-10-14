import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { UiMcpServer } from "../electron/mcp";
import { WorkbenchService, type WorkbenchOptions } from "../electron/service";
import {
  compileInstructions,
  retainInstructions,
} from "../electron/prompt-binding";

const servers: UiMcpServer[] = [];
const services: WorkbenchService[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function runtime(
  routeProfile?: WorkbenchOptions["routeProfile"],
  options: Pick<WorkbenchOptions, "cancelTimeoutMs"> = {},
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "worker-runtime-"));
  directories.push(directory);
  const bundle = path.join(directory, "bundle");
  const projectPath = path.join(directory, "project");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(bundle, "CORE.md"), "Verify observed results.");
  for (const name of ["analyst", "reviewer"])
    await fs.writeFile(
      path.join(bundle, "profiles", `${name}.md`),
      `# ${name}\nUse current evidence.`,
    );
  let server: UiMcpServer | undefined;
  const bindings = new Map<
    string,
    ReturnType<UiMcpServer["binding"]>[number]
  >();
  const service = new WorkbenchService({
    bundleDir: bundle,
    dataDir: path.join(directory, "data"),
    emit: () => undefined,
    routeProfile,
    ...options,
    revokeSessionTools: (sessionId) => server?.revokeBinding(sessionId),
    mcpServersForSession: (sessionId) => {
      if (!server) return [];
      const result = server.binding(sessionId);
      bindings.set(sessionId, result[0]);
      return result;
    },
  });
  services.push(service);
  await service.init();
  const project = await service.invoke("project.create", {
    name: "Worker tests",
    path: projectPath,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Review changes",
  });
  const parent = await service.invoke("session.create", {
    taskId: task.id,
    title: "Parent",
  });
  server = new UiMcpServer(
    () => service.snapshot(),
    (method, params) => service.invoke(method, params),
  );
  servers.push(server);
  await server.start();
  const binding = server.binding(parent.id)[0];
  bindings.set(parent.id, binding);
  let requestId = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const response = await fetch(binding.url, {
      method: "POST",
      headers: { Authorization: binding.headers[0].value },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).result;
  };
  const spawn = (args: Record<string, unknown>) =>
    rpc("tools/call", { name: "agent_spawn", arguments: args });
  const receipt = (response: any) => {
    expect(response.isError, response.content?.[0]?.text).not.toBe(true);
    return JSON.parse(response.content[0].text);
  };
  return {
    service,
    server,
    binding,
    bindings,
    parent,
    task,
    projectPath,
    rpc,
    spawn,
    receipt,
  };
}

async function until(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeout)
      throw new Error("Runtime condition did not become true.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixturePrompts(projectPath: string) {
  return (
    await fs.readFile(path.join(projectPath, "fixture-events.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "prompt");
}

describe("host-owned subagent lifecycle", () => {
  it("publishes automatic role hints and idempotent spawn in the actual MCP schema", async () => {
    const x = await runtime();
    const listed = await x.rpc("tools/list");
    const tool = listed.tools.find(
      (entry: any) => entry.name === "agent_spawn",
    );
    expect(tool.inputSchema.required).toEqual([
      "title",
      "prompt",
      "operationId",
    ]);
    expect(tool.description).toContain("not a forced role");
    expect(tool.description).toContain("retrieve the original child");
  });

  it("creates and queues one child through MCP without the forbidden manual profile override", async () => {
    const x = await runtime();
    const result = x.receipt(
      await x.spawn({
        title: "Independent review",
        prompt: "Inspect the accepted changes and report concrete defects.",
        profileId: "reviewer",
        operationId: "review-1",
      }),
    );
    expect(result.operationId).toBe("review-1");
    expect(result.replayed).toBe(false);
    const children = x.service
      .snapshot()
      .sessions.filter((session) => session.parentId === x.parent.id);
    expect(children).toHaveLength(1);
    expect(result.session.id).toBe(children[0].id);
    expect(children[0].taskId).toBe(x.task.id);
    expect(children[0].queue).toHaveLength(1);
    expect(children[0].queue[0].text).toBe(
      "Inspect the accepted changes and report concrete defects.",
    );
    await expect(
      x.service.invoke("session.create", {
        taskId: x.task.id,
        title: "Manual role override",
        profileId: "reviewer",
      }),
    ).rejects.toThrow("selected automatically");
  });

  it("deduplicates concurrent retries and rejects changed payload under the same operation ID", async () => {
    const x = await runtime();
    const args = {
      title: "Review",
      prompt: "Inspect behavior without changing files.",
      operationId: "same-operation",
    };
    const results = (await Promise.all([x.spawn(args), x.spawn(args)])).map(
      x.receipt,
    );
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      x.service.snapshot().sessions.filter((session) => session.parentId),
    ).toHaveLength(1);
    const conflict = await x.spawn({ ...args, prompt: "Changed task." });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toMatch(/different|reused|conflict/i);
    expect(
      x.service.snapshot().sessions.filter((session) => session.parentId),
    ).toHaveLength(1);
  });

  it("rejects malformed or foreign bindings before creating a child", async () => {
    const x = await runtime();
    const args = {
      title: "Review",
      prompt: "Inspect current evidence.",
      operationId: "valid-operation",
    };
    for (const invalid of [
      { ...args, operationId: undefined },
      { ...args, operationId: " " },
      { ...args, prompt: "" },
      { ...args, prompt: "x".repeat(20001) },
      { ...args, profileId: "unknown-profile" },
      { ...args, parentId: "foreign-parent" },
      { ...args, taskId: "foreign-task" },
    ]) {
      expect((await x.spawn(invalid)).isError).toBe(true);
    }
    expect(
      x.service.snapshot().sessions.filter((session) => session.parentId),
    ).toHaveLength(0);
  });

  it("pages worker status with bounded Unicode output and rejects foreign identities", async () => {
    const x = await runtime();
    for (let index = 0; index < 25; index++)
      await x.service.invoke("session.create", {
        taskId: x.task.id,
        parentId: x.parent.id,
        title: `Worker ${index}`,
      });
    const fullResult = "結果😀".repeat(3000) + "FINAL-OBSERVATION";
    await (x.service as any).store.update((state: any) => {
      for (const child of state.sessions.filter(
        (session: any) => session.parentId,
      ))
        child.messages.push({
          id: `result-${child.id}`,
          role: "assistant",
          at: new Date().toISOString(),
          content: fullResult,
        });
    });
    const read = async (arguments_: Record<string, unknown> = {}) => {
      const response = await x.rpc("tools/call", {
        name: "agent_status",
        arguments: arguments_,
      });
      return x.receipt(response);
    };
    const first = await read({ limit: 20 });
    expect(first.agents).toHaveLength(20);
    expect(first.totalAgents).toBe(25);
    expect(first.nextOffset).toBe(20);
    expect(
      Buffer.byteLength(JSON.stringify(first), "utf8"),
    ).toBeLessThanOrEqual(64 * 1024);
    for (const agent of first.agents) {
      expect(agent.result.endsWith("FINAL-OBSERVATION")).toBe(true);
      expect(agent.result).not.toContain("\ufffd");
      expect(Buffer.byteLength(agent.result, "utf8")).toBeLessThanOrEqual(1500);
      expect(agent.resultTotalBytes).toBe(
        Buffer.byteLength(fullResult, "utf8"),
      );
      expect(agent.resultTruncated).toBe(true);
    }
    const rest = await read({ offset: first.nextOffset, limit: 20 });
    expect(rest.agents).toHaveLength(5);
    expect(rest.nextOffset).toBe(null);
    expect((await read({ id: first.agents[0].id })).agents).toHaveLength(1);
    for (const invalid of [
      { id: x.parent.id },
      { id: "foreign" },
      { limit: 21 },
      { offset: -1 },
      { sessionId: "foreign" },
    ]) {
      const response = await x.rpc("tools/call", {
        name: "agent_status",
        arguments: invalid,
      });
      expect(response.isError).toBe(true);
    }
  });
});

describe("context recovery admission", () => {
  it("holds a concurrently resumed message until process retirement and checkpoint are complete", async () => {
    const x = await runtime();
    await x.service.invoke("settings.update", {
      patch: {
        cliPath: fileURLToPath(
          new URL("./fixtures/acp-fixture.mjs", import.meta.url),
        ),
        cliArgs: ["--acp"],
        startupRetries: 0,
      },
    });
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "preserve-recovery-marker",
    });
    await until(
      () =>
        x.service
          .snapshot()
          .sessions.some(
            (session) =>
              session.id === x.parent.id && session.status === "completed",
          ) && !(x.service as any).launches.has(x.parent.id),
    );
    const live = (x.service as any).live.get(x.parent.id);
    const originalDispose = live.client.dispose.bind(live.client);
    let entered = false;
    let release!: () => void;
    const retirement = new Promise<void>((resolve) => (release = resolve));
    live.client.dispose = async () => {
      entered = true;
      await retirement;
      await originalDispose();
    };
    const recovery = x.service.invoke("session.compact", { id: x.parent.id });
    try {
      await until(() => entered);
      await x.service.invoke("session.send", {
        id: x.parent.id,
        text: "continue-after-recovery",
      });
      await x.service.invoke("queue.resume", { id: x.parent.id });
      // No timing assertion: a pump pass, observed under the same retirement
      // barrier, must refuse admission even if a user has just resumed the queue.
      await (x.service as any).pump();
      expect((x.service as any).launches.has(x.parent.id)).toBe(false);
      expect(await fixturePrompts(x.projectPath)).toHaveLength(1);
    } finally {
      release();
      await recovery;
    }
    const held = x.service
      .snapshot()
      .sessions.find((session) => session.id === x.parent.id)!;
    expect(held.status).toBe("idle");
    expect(held.queue).toHaveLength(1);
    await x.service.invoke("queue.resume", { id: x.parent.id });
    await until(() =>
      x.service
        .snapshot()
        .sessions.some(
          (session) =>
            session.id === x.parent.id && session.status === "completed",
        ),
    );
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].content).toContain("Host recovery checkpoint");
    expect(prompts[1].content).toContain("preserve-recovery-marker");
    expect(prompts[1].command).toBe("continue-after-recovery");
  });
});

describe("bounded task context retrieval", () => {
  it("recovers the full oversized goal by explicit versioned pages", async () => {
    const x = await runtime();
    const description =
      "Accepted requirement. ".repeat(2500) + "FINAL-REQUIREMENT";
    await x.service.invoke("task.update", { id: x.task.id, description });
    const read = async (arguments_: Record<string, unknown> = {}) => {
      const result = await x.rpc("tools/call", {
        name: "task_context",
        arguments: arguments_,
      });
      return x.receipt(result);
    };
    const pages: string[] = [];
    let offset: number | null = 0;
    let revision: number | undefined;
    while (offset !== null) {
      const page = await read({ section: "description", offset });
      expect(page.taskId).toBe(x.task.id);
      expect(page.sessionId).toBe(x.parent.id);
      expect(page.taskUpdatedAt).toBeTruthy();
      expect(page.totalCharacters).toBe(description.length);
      expect(page.text.length).toBeLessThanOrEqual(12000);
      revision ??= page.snapshotRevision;
      expect(page.snapshotRevision).toBe(revision);
      pages.push(page.text);
      offset = page.nextOffset;
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("")).toBe(description);
    const invalid = await x.rpc("tools/call", {
      name: "task_context",
      arguments: { offset: description.length + 1 },
    });
    expect(invalid.isError).toBe(true);
  });

  it("pages plans without losing long todo details or accepting a foreign todo", async () => {
    const x = await runtime();
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `todo-${index}`,
      text: index === 0 ? "full-detail ".repeat(700) : `Step ${index}`,
      status: "pending",
    }));
    await x.service.invoke("todo.replace", { sessionId: x.parent.id, items });
    const read = async (arguments_: Record<string, unknown>) => {
      const result = await x.rpc("tools/call", {
        name: "task_context",
        arguments: arguments_,
      });
      return x.receipt(result);
    };
    const first = await read({ section: "todos" });
    expect(first.items).toHaveLength(20);
    expect(first.totalItems).toBe(25);
    expect(first.nextOffset).toBe(20);
    expect(first.items[0].text).toHaveLength(1000);
    expect(first.items[0].truncated).toBe(true);
    const tail = await read({ section: "todos", offset: first.nextOffset });
    expect(tail.items).toHaveLength(5);
    expect(tail.nextOffset).toBe(null);
    const full = await read({ section: "todos", todoId: "todo-0" });
    expect(full.text).toBe(items[0].text);
    const foreign = await x.rpc("tools/call", {
      name: "task_context",
      arguments: { section: "todos", todoId: "foreign-todo" },
    });
    expect(foreign.isError).toBe(true);
    const invalid = await x.rpc("tools/call", {
      name: "task_context",
      arguments: { section: "description", todoId: "todo-0" },
    });
    expect(invalid.isError).toBe(true);
  });
});

describe("retained instruction MCP evidence", () => {
  it("reads the exact historic version within the session and rejects a valid foreign snapshot", async () => {
    const x = await runtime(async (input) => ({
      profileId: input.request === "switch-role" ? "reviewer" : "analyst",
      reason: "Deterministic routing fixture for snapshot lifecycle.",
      confidence: 0.9,
    }));
    await x.service.invoke("settings.update", {
      patch: {
        cliPath: fileURLToPath(
          new URL("./fixtures/acp-fixture.mjs", import.meta.url),
        ),
        cliArgs: ["--acp"],
        startupRetries: 0,
      },
    });
    const sendAndWait = async (text: string) => {
      await x.service.invoke("session.send", { id: x.parent.id, text });
      await until(
        () =>
          x.service
            .snapshot()
            .sessions.some(
              (session) =>
                session.id === x.parent.id && session.status === "completed",
            ) && !(x.service as any).launches.has(x.parent.id),
      );
      return x.service
        .snapshot()
        .sessions.find((session) => session.id === x.parent.id)!;
    };
    const first = await sendAndWait("retain-version-A");
    const originalFingerprint = first.instructionBinding!.fingerprint;
    expect(
      first.messages.some(
        (message) => message.instructionFingerprint === originalFingerprint,
      ),
    ).toBe(true);
    const second = await sendAndWait("switch-role");
    const currentFingerprint = second.instructionBinding!.fingerprint;
    expect(currentFingerprint).not.toBe(originalFingerprint);
    expect(second.profileId).toBe("reviewer");
    const call = async (name: string, args: Record<string, unknown>) => {
      const binding = x.bindings.get(x.parent.id)!;
      const response = await fetch(binding.url, {
        method: "POST",
        headers: { Authorization: binding.headers[0].value },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      expect(response.status).toBe(200);
      return (await response.json()).result;
    };
    const read = (args: Record<string, unknown>) =>
      call("instruction_snapshot", args);
    const history = x.receipt(await call("task_history", { id: x.parent.id }));
    expect(
      history.messages.some(
        (message: any) =>
          message.instructionFingerprint === originalFingerprint,
      ),
    ).toBe(true);
    expect(
      history.messages.some(
        (message: any) => message.instructionFingerprint === currentFingerprint,
      ),
    ).toBe(true);
    const conversations = x.receipt(await call("task_history", {}));
    expect(
      conversations.sessions.find((session: any) => session.id === x.parent.id)
        .instructionFingerprint,
    ).toBe(currentFingerprint);
    const detail = x.receipt(
      await call("task_history", {
        id: x.parent.id,
        messageId: first.messages[0].id,
      }),
    );
    expect(detail.instructionFingerprint).toBe(originalFingerprint);
    const historic = x.receipt(
      await read({ fingerprint: originalFingerprint }),
    );
    expect(historic.fingerprint).toBe(originalFingerprint);
    expect(historic.manifest.role.id).toBe("analyst");
    expect(historic.content).toContain("# analyst");
    expect(historic.content.length).toBeLessThanOrEqual(12000);
    expect(historic.trust).toContain("Reference only");
    const active = x.receipt(await read({ fingerprint: currentFingerprint }));
    expect(active.manifest.role.id).toBe("reviewer");
    expect(
      x.service
        .snapshot()
        .sessions.find((session) => session.id === x.parent.id)!
        .instructionBinding!.fingerprint,
    ).toBe(currentFingerprint);
    const foreign = compileInstructions({
      core: "Foreign project policy.",
      role: "Foreign specialist role.",
      profileId: "security",
    });
    await retainInstructions(x.service.options.dataDir, foreign);
    for (const invalid of [
      { fingerprint: foreign.fingerprint },
      { fingerprint: "../instructions" },
      { fingerprint: currentFingerprint, sessionId: "foreign-session" },
      { fingerprint: currentFingerprint, offset: -1 },
      { fingerprint: currentFingerprint, offset: active.totalCharacters + 1 },
    ])
      expect((await read(invalid)).isError).toBe(true);
  });
});

describe("MCP client generation fencing", () => {
  async function fixture() {
    const calls: unknown[] = [];
    const state = {
      sessions: [
        { id: "session", taskId: "task" },
        { id: "other", taskId: "task" },
      ],
      tasks: [{ id: "task", projectId: "project" }],
    } as any;
    const server = new UiMcpServer(
      () => state,
      async (...args) => {
        calls.push(args);
        return { saved: true };
      },
    );
    servers.push(server);
    await server.start();
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "plan_replace", arguments: { items: [] } },
    });
    const send = (binding: ReturnType<UiMcpServer["binding"]>[number]) =>
      fetch(binding.url, {
        method: "POST",
        headers: { Authorization: binding.headers[0].value },
        body: payload,
      });
    return { server, calls, payload, send };
  }

  it("rejects the previous ACP bearer without invalidating another host session", async () => {
    const x = await fixture();
    const previous = x.server.binding("session")[0];
    const other = x.server.binding("other")[0];
    const current = x.server.binding("session")[0];
    expect(current.headers[0].value).not.toBe(previous.headers[0].value);
    expect((await x.send(previous)).status).toBe(401);
    expect(x.calls).toHaveLength(0);
    expect((await x.send(current)).status).toBe(200);
    expect((await x.send(other)).status).toBe(200);
    expect(x.calls).toHaveLength(2);
  });

  it("revokes a retired client immediately and permits a later new binding", async () => {
    const x = await fixture();
    const retired = x.server.binding("session")[0];
    const other = x.server.binding("other")[0];
    x.server.revokeBinding("session");
    expect((await x.send(retired)).status).toBe(401);
    expect(x.calls).toHaveLength(0);
    expect((await x.send(other)).status).toBe(200);
    const current = x.server.binding("session")[0];
    expect((await x.send(current)).status).toBe(200);
    expect((await x.send(retired)).status).toBe(401);
    expect(x.calls).toHaveLength(2);
  });

  it("retires the actual Workbench client's bearer before context recovery", async () => {
    const x = await runtime();
    await x.service.invoke("session.compact", { id: x.parent.id });
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "task_context", arguments: {} },
    });
    const send = (binding: typeof x.binding) =>
      fetch(binding.url, {
        method: "POST",
        headers: { Authorization: binding.headers[0].value },
        body: payload,
      });
    expect((await send(x.binding)).status).toBe(401);
    expect((await send(x.server.binding(x.parent.id)[0])).status).toBe(200);
  });

  it("continues after cancellation in a fresh ACP process with a fresh usable MCP binding", async () => {
    const x = await runtime();
    await x.service.invoke("settings.update", {
      patch: {
        cliPath: fileURLToPath(
          new URL("./fixtures/acp-fixture.mjs", import.meta.url),
        ),
        cliArgs: ["--acp"],
        startupRetries: 0,
      },
    });
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "hold cancellation-binding",
    });
    await until(async () => {
      try {
        return (await fixturePrompts(x.projectPath)).length === 1;
      } catch {
        return false;
      }
    });
    const retired = x.bindings.get(x.parent.id)!;
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "continue-with-fresh-tools",
    });
    await x.service.invoke("session.cancel", { id: x.parent.id });
    await until(
      () =>
        x.service
          .snapshot()
          .sessions.some(
            (session) =>
              session.id === x.parent.id && session.status === "idle",
          ) && !(x.service as any).launches.has(x.parent.id),
    );
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "task_context", arguments: {} },
    });
    const send = (binding: typeof x.binding) =>
      fetch(binding.url, {
        method: "POST",
        headers: { Authorization: binding.headers[0].value },
        body: payload,
      });
    expect((await send(retired)).status).toBe(401);
    await x.service.invoke("queue.resume", { id: x.parent.id });
    await until(
      () =>
        x.service
          .snapshot()
          .sessions.some(
            (session) =>
              session.id === x.parent.id && session.status === "completed",
          ) && !(x.service as any).launches.has(x.parent.id),
    );
    const current = x.bindings.get(x.parent.id)!;
    expect(current.headers[0].value).not.toBe(retired.headers[0].value);
    expect((await send(current)).status).toBe(200);
    expect((await send(retired)).status).toBe(401);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
    expect(prompts[1].command).toBe("continue-with-fresh-tools");
    expect(prompts[1].content).toContain("Host recovery checkpoint");
  });

  it("rechecks the bearer after an already authenticated slow request body", async () => {
    const x = await fixture();
    const previous = x.server.binding("session")[0];
    // This listener runs after the server's async request handler reaches body
    // consumption; no elapsed-time assumption is used to cause the overlap.
    const accepted = new Promise<void>((resolve) => {
      (x.server as any).server.once("request", () => resolve());
    });
    let request!: ReturnType<typeof httpRequest>;
    const response = new Promise<number>((resolve, reject) => {
      request = httpRequest(
        previous.url,
        {
          method: "POST",
          headers: {
            Authorization: previous.headers[0].value,
            "Content-Type": "application/json",
          },
        },
        (result) => {
          result.resume();
          result.once("end", () => resolve(result.statusCode!));
        },
      );
      request.once("error", reject);
      request.setTimeout(3000, () => {
        request.destroy(new Error("Controlled body barrier timed out."));
      });
    });
    const midpoint = Math.floor(x.payload.length / 2);
    try {
      request.write(x.payload.slice(0, midpoint));
      await accepted;
      const current = x.server.binding("session")[0];
      request.end(x.payload.slice(midpoint));
      expect(await response).toBe(401);
      expect(x.calls).toHaveLength(0);
      expect((await x.send(current)).status).toBe(200);
      expect(x.calls).toHaveLength(1);
    } finally {
      request.destroy();
    }
  });
});

describe("bounded warm executor pool and cancellation deadlines", () => {
  async function configure(
    x: Awaited<ReturnType<typeof runtime>>,
    maxConcurrent = 2,
    extraArgs: string[] = [],
  ) {
    await x.service.invoke("settings.update", {
      patch: {
        cliPath: fileURLToPath(
          new URL("./fixtures/acp-fixture.mjs", import.meta.url),
        ),
        cliArgs: ["--acp", ...extraArgs],
        startupRetries: 0,
        maxConcurrent,
      },
    });
  }
  const settled = async (
    x: Awaited<ReturnType<typeof runtime>>,
    id: string,
  ) => {
    await until(
      () =>
        x.service
          .snapshot()
          .sessions.some(
            (session) => session.id === id && session.status === "completed",
          ) && !(x.service as any).launches.has(id),
    );
    await (x.service as any).trimIdlePool();
  };
  const create = (x: Awaited<ReturnType<typeof runtime>>, title: string) =>
    x.service.invoke("session.create", { taskId: x.task.id, title });
  const checkBinding = (binding: ReturnType<UiMcpServer["binding"]>[number]) =>
    fetch(binding.url, {
      method: "POST",
      headers: { Authorization: binding.headers[0].value },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "task_context", arguments: {} },
      }),
    });

  it("captures accepted parent model settings at spawn without sharing later changes", async () => {
    const x = await runtime();
    await configure(x);
    await x.service.invoke("session.prepare", { id: x.parent.id });
    expect(
      await x.service.invoke("session.config", {
        id: x.parent.id,
        configId: "model",
        value: "fixture-reasoning",
      }),
    ).toMatchObject({ status: "applied" });
    await x.service.invoke("session.config", {
      id: x.parent.id,
      configId: "reasoning_effort",
      value: "low",
    });
    const spawned = await x.service.invoke("agent.spawn", {
      parentId: x.parent.id,
      title: "Captured model worker",
      prompt: "child-captured-first",
      operationId: "captured-model-1",
    });
    await settled(x, spawned.session.id);
    expect(
      (await fixturePrompts(x.projectPath)).find(
        (entry) => entry.command === "child-captured-first",
      ),
    ).toMatchObject({
      model: "fixture-reasoning",
      reasoning: "low",
    });
    await x.service.invoke("session.config", {
      id: x.parent.id,
      configId: "model",
      value: "fixture-fast",
    });
    await x.service.invoke("session.send", {
      id: spawned.session.id,
      text: "child-captured-second",
    });
    await settled(x, spawned.session.id);
    expect(
      (await fixturePrompts(x.projectPath)).find(
        (entry) => entry.command === "child-captured-second",
      ),
    ).toMatchObject({
      model: "fixture-reasoning",
      reasoning: "low",
    });
  });

  it("keeps at most two safe warm processes and retires the least recently used one", async () => {
    const x = await runtime();
    await configure(x);
    const sessions = [
      x.parent,
      await create(x, "B"),
      await create(x, "C"),
      await create(x, "D"),
    ];
    const retired: any[] = [];
    for (const session of sessions) {
      await x.service.invoke("session.prepare", { id: session.id });
      retired.push((x.service as any).live.get(session.id));
      await (x.service as any).trimIdlePool();
      expect((x.service as any).live.size).toBeLessThanOrEqual(2);
    }
    expect([...(x.service as any).live.keys()]).toEqual(
      sessions.slice(-2).map((session) => session.id),
    );
    expect(retired[0].client.alive).toBe(false);
    expect(retired[1].client.alive).toBe(false);
    expect(x.service.snapshot().sessions).toHaveLength(4);
  });

  it("reuses the hot executor and protects active and queued owners from eviction", async () => {
    const x = await runtime();
    await configure(x);
    const b = await create(x, "B"),
      c = await create(x, "C");
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "warm-first",
    });
    await settled(x, x.parent.id);
    const hot = (x.service as any).live.get(x.parent.id);
    await x.service.invoke("session.prepare", { id: b.id });
    await x.service.invoke("session.prepare", { id: x.parent.id });
    await x.service.invoke("session.prepare", { id: c.id });
    await (x.service as any).trimIdlePool();
    expect((x.service as any).live.get(x.parent.id)).toBe(hot);
    expect((x.service as any).live.has(b.id)).toBe(false);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "warm-second",
    });
    await settled(x, x.parent.id);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).toBe(prompts[0].pid);
    expect((x.service as any).live.get(x.parent.id)).toBe(hot);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "hold ui active-owner",
    });
    await until(() =>
      x.service
        .snapshot()
        .sessions.some(
          (session) =>
            session.id === x.parent.id && session.status === "running",
        ),
    );
    const d = await create(x, "D"),
      e = await create(x, "E");
    await x.service.invoke("session.prepare", { id: d.id });
    await x.service.invoke("session.prepare", { id: e.id });
    await (x.service as any).trimIdlePool();
    expect((x.service as any).live.get(x.parent.id)).toBe(hot);
    await x.service.invoke("session.cancel", { id: d.id });
    await x.service.invoke("session.send", {
      id: d.id,
      text: "held-queued-owner",
    });
    await (x.service as any).trimIdlePool();
    expect((x.service as any).live.has(d.id)).toBe(true);
    expect(
      x.service.snapshot().sessions.find((session) => session.id === d.id)!
        .queue,
    ).toHaveLength(1);
    await x.service.invoke("session.cancel", { id: x.parent.id });
    await until(() => !(x.service as any).launches.has(x.parent.id));
  });

  it("restores an evicted conversation from its checkpoint without replay and revokes its old MCP bearer", async () => {
    const x = await runtime();
    await configure(x, 1);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "completed-before-eviction",
    });
    await settled(x, x.parent.id);
    const oldBinding = x.bindings.get(x.parent.id)!;
    const oldFingerprint = x.service
      .snapshot()
      .sessions.find((session) => session.id === x.parent.id)!
      .instructionBinding!.fingerprint;
    const b = await create(x, "New warm owner");
    await x.service.invoke("session.prepare", { id: b.id });
    await (x.service as any).trimIdlePool();
    expect((x.service as any).live.has(x.parent.id)).toBe(false);
    expect((await checkBinding(oldBinding)).status).toBe(401);
    expect(
      x.service
        .snapshot()
        .sessions.find((session) => session.id === x.parent.id)!
        .instructionBinding!.state,
    ).toBe("closed");
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "continue-after-idle-eviction",
    });
    await settled(x, x.parent.id);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
    expect(prompts[1].command).toBe("continue-after-idle-eviction");
    expect(prompts[1].content).toContain("completed-before-eviction");
    expect(prompts[1].content).toContain("Host recovery checkpoint");
    expect(
      x.service
        .snapshot()
        .sessions.find((session) => session.id === x.parent.id)!.messages,
    ).toHaveLength(4);
    expect(
      (
        await x.service.invoke("instruction.read", {
          sessionId: x.parent.id,
          fingerprint: oldFingerprint,
        })
      ).fingerprint,
    ).toBe(oldFingerprint);
    expect((await checkBinding(x.bindings.get(x.parent.id)!)).status).toBe(200);
    expect((await checkBinding(oldBinding)).status).toBe(401);
  });

  it("refreshes a revoked warm client after cancelling an already completed turn", async () => {
    const x = await runtime();
    await configure(x);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "completed-idle-cancel",
    });
    await settled(x, x.parent.id);
    const oldBinding = x.bindings.get(x.parent.id)!;
    await x.service.invoke("session.cancel", { id: x.parent.id });
    expect((await checkBinding(oldBinding)).status).toBe(401);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "resume-idle-cancel",
    });
    await x.service.invoke("queue.resume", { id: x.parent.id });
    await settled(x, x.parent.id);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
    expect((await checkBinding(x.bindings.get(x.parent.id)!)).status).toBe(200);
  });

  it("times out an ignored cancel into UNKNOWN, preserves priority input and requires explicit recovery", async () => {
    const x = await runtime(undefined, { cancelTimeoutMs: 50 });
    await configure(x);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "ignore-cancel",
    });
    await until(async () => {
      try {
        return (await fixturePrompts(x.projectPath)).length === 1;
      } catch {
        return false;
      }
    });
    const priority = await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "priority-after-ignored-cancel",
    });
    await x.service.invoke("queue.sendNow", {
      sessionId: x.parent.id,
      id: priority.id,
    });
    await until(
      () =>
        x.service
          .snapshot()
          .sessions.some(
            (session) =>
              session.id === x.parent.id && session.status === "unknown",
          ) && !(x.service as any).launches.has(x.parent.id),
    );
    const interrupted = x.service
      .snapshot()
      .sessions.find((session) => session.id === x.parent.id)!;
    expect(interrupted.error).toContain("Cancellation timed out");
    expect(interrupted.queue.map((item) => item.text)).toEqual([
      "priority-after-ignored-cancel",
    ]);
    expect(interrupted.messages.at(-1)!.outcome).toBe("unknown");
    expect(await fixturePrompts(x.projectPath)).toHaveLength(1);
    await expect(
      x.service.invoke("queue.resume", { id: x.parent.id }),
    ).rejects.toThrow(/unknown/i);
    await x.service.invoke("session.recover", {
      id: x.parent.id,
      summary:
        "Fixture produced no external effects; inspect retained trace and continue the different queued request.",
    });
    await x.service.invoke("queue.resume", { id: x.parent.id });
    await settled(x, x.parent.id);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].command).toBe("priority-after-ignored-cancel");
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
  });

  it("keeps an input undispatched when startup is cancelled before session/new returns", async () => {
    const x = await runtime(undefined, { cancelTimeoutMs: 50 });
    await configure(x, 2, ["--hold-new-session"]);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "must-stay-undispatched",
    });
    await until(async () => {
      try {
        return (
          await fs.readFile(
            path.join(x.projectPath, "fixture-events.jsonl"),
            "utf8",
          )
        ).includes('"session_new"');
      } catch {
        return false;
      }
    });
    await x.service.invoke("session.cancel", { id: x.parent.id });
    await until(() => !(x.service as any).launches.has(x.parent.id));
    const session = x.service
      .snapshot()
      .sessions.find((item) => item.id === x.parent.id)!;
    expect(session.status).not.toBe("unknown");
    expect(session.queue.map((item) => item.text)).toEqual([
      "must-stay-undispatched",
    ]);
    expect(session.messages).toHaveLength(0);
    expect(await fixturePrompts(x.projectPath)).toHaveLength(0);
  });

  it("retires a revoked warm executor when cancellation interrupts routing before dispatch", async () => {
    let routeEntered = false;
    const x = await runtime(async (input) => {
      if (input.request === "cancel-during-routing") {
        routeEntered = true;
        return new Promise(() => undefined);
      }
      return {
        profileId: input.currentProfileId,
        confidence: 1,
        reason: "Fixture keeps the current role.",
      };
    });
    await configure(x);
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "warm-before-route-cancel",
    });
    await settled(x, x.parent.id);
    const oldLive = (x.service as any).live.get(x.parent.id);
    const oldBinding = x.bindings.get(x.parent.id)!;
    await x.service.invoke("session.send", {
      id: x.parent.id,
      text: "cancel-during-routing",
    });
    await until(() => routeEntered);
    await x.service.invoke("session.cancel", { id: x.parent.id });
    await until(() => !(x.service as any).launches.has(x.parent.id));
    expect(oldLive.client.alive).toBe(false);
    expect((x.service as any).live.has(x.parent.id)).toBe(false);
    expect((await checkBinding(oldBinding)).status).toBe(401);
    expect(await fixturePrompts(x.projectPath)).toHaveLength(1);
    const queued = x.service
      .snapshot()
      .sessions.find((session) => session.id === x.parent.id)!.queue[0];
    expect(queued.text).toBe("cancel-during-routing");
    await x.service.invoke("queue.update", {
      sessionId: x.parent.id,
      id: queued.id,
      text: "resume-after-route-cancel",
    });
    await x.service.invoke("queue.resume", { id: x.parent.id });
    await settled(x, x.parent.id);
    const prompts = await fixturePrompts(x.projectPath);
    expect(prompts).toHaveLength(2);
    expect(prompts[1].pid).not.toBe(prompts[0].pid);
    expect(prompts[1].content).toContain("Host recovery checkpoint");
    expect(prompts[1].content).toContain("warm-before-route-cancel");
    expect((await checkBinding(x.bindings.get(x.parent.id)!)).status).toBe(200);
  });
});
