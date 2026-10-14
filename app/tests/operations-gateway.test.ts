import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UiMcpServer } from "../electron/mcp";
import { OpsService } from "../electron/operations/service";
import type { AppState } from "../shared/types";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "workbench-ops-gateway-"),
  );
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const state = {
    sessions: [
      { id: "a", taskId: "ta" },
      { id: "another-a", taskId: "ta" },
      { id: "b", taskId: "tb" },
    ],
    tasks: [
      { id: "ta", projectId: "pa" },
      { id: "tb", projectId: "pb" },
    ],
  } as AppState;
  const ops = new OpsService({
    dataDir: directory,
    node: process.execPath,
    provider: "unused-scope-fixture",
    project: (id) => (["pa", "pb"].includes(id) ? { id } : undefined),
    changed: () => {},
    vault: {
      available: () => true,
      encrypt: (v) => Buffer.from(v),
      decrypt: (b) => b.toString(),
    },
  });
  await ops.init();
  cleanups.push(() => ops.dispose());
  // This suite exercises the real HTTP MCP gateway and real host scope/generation
  // checks. The remote client is a fixture; live Jenkins/Kubernetes have a separate suite.
  const remote = {
    inventory: async () => ({
      server: { name: "scope fixture" },
      schemaHash: "fixture-v1",
      tools: [],
      capabilities: [],
      observedAt: new Date().toISOString(),
    }),
    call: vi.fn(async (operation: string, input: any) => {
      if (operation === "prepare")
        return {
          summary: "Run captured job",
          input: input.input,
          preview: { jobId: input.input.jobId },
        };
      if (operation === "execute")
        return { status: "accepted", remoteId: "1", data: { queueId: 1 } };
      return {
        data: { jobs: [], complete: true },
        observedAt: new Date().toISOString(),
        warnings: [],
      };
    }),
  };
  const client = vi.spyOn(ops as any, "client").mockResolvedValue(remote);
  cleanups.push(async () => {
    client.mockRestore();
  });
  const ca = await ops.invoke("ops.connection.save", {
    connection: {
      name: "A controller",
      kind: "jenkins",
      transport: "builtin",
      url: "http://127.0.0.1:65534",
      enabled: true,
      projectIds: ["pa"],
    },
  });
  const cb = await ops.invoke("ops.connection.save", {
    connection: {
      name: "B controller",
      kind: "jenkins",
      transport: "builtin",
      url: "http://127.0.0.1:65533",
      enabled: true,
      projectIds: ["pb"],
    },
  });
  const calls: { method: string; p: any; sessionId: string }[] = [];
  const server = new UiMcpServer(
    () => state,
    async (method, p, sessionId) => {
      calls.push({ method, p, sessionId });
      return ops.invoke(method, p, true);
    },
  );
  await server.start();
  cleanups.push(() => server.dispose());
  const rpc = async (sessionId: string, name: string, args: any = {}) => {
    const binding = server.binding(sessionId)[0];
    const response = await fetch(binding.url, {
      method: "POST",
      headers: {
        Authorization: binding.headers[0].value,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()).result;
    return {
      isError: !!result.isError,
      value: JSON.parse(result.content[0].text),
    };
  };
  return { ops, state, ca, cb, calls, remote, rpc };
}
describe("Operations session MCP target capture", () => {
  it("requires each session's own initial snapshot and keeps another session's cache independent", async () => {
    const f = await fixture();
    const args = { connectionId: f.ca.id, operation: "ci.jobs", input: {} };
    expect((await f.rpc("a", "ops_query", args)).value.error.kind).toBe(
      "validation",
    );
    expect(f.remote.call).not.toHaveBeenCalled();
    const snap = await f.rpc("a", "ops_snapshot");
    expect(snap.value.connections.map((c: any) => c.id)).toEqual([f.ca.id]);
    expect((await f.rpc("another-a", "ops_query", args)).value.error.kind).toBe(
      "validation",
    );
    await f.rpc("b", "ops_snapshot");
    const read = await f.rpc("a", "ops_query", {
      ...args,
      expectedTargetHash: "model-invented",
      expectedAuthGeneration: 999,
    });
    expect(read.isError).toBe(false);
    expect(f.calls.at(-1)?.p).toMatchObject({
      projectId: "pa",
      sessionId: "a",
      taskId: "ta",
      expectedTargetHash: f.ca.targetHash,
      expectedAuthGeneration: f.ca.authGeneration,
    });
    expect(f.remote.call).toHaveBeenCalledTimes(1);
  });
  it("rejects stale captured target/auth before any remote read or preflight even if the caller supplies new guards", async () => {
    const f = await fixture();
    await f.rpc("a", "ops_snapshot");
    const current = await f.ops.invoke("ops.connection.save", {
      connection: { ...f.ca, url: "http://127.0.0.1:65532" },
      secret: "new-generation-fixture",
    });
    for (const [name, operation] of [
      ["ops_query", "ci.jobs"],
      ["ops_prepare", "ci.trigger"],
    ]) {
      const rejected = await f.rpc("a", name, {
        connectionId: current.id,
        operation,
        input: { jobId: "Build" },
        expectedTargetHash: current.targetHash,
        expectedAuthGeneration: current.authGeneration,
      });
      expect(rejected.value.error).toMatchObject({
        kind: "conflict",
        outcome: "notApplied",
      });
    }
    expect(f.remote.call).not.toHaveBeenCalled();
    await f.rpc("a", "ops_snapshot");
    expect(
      (
        await f.rpc("a", "ops_query", {
          connectionId: current.id,
          operation: "ci.jobs",
          input: {},
        })
      ).isError,
    ).toBe(false);
    expect(f.remote.call).toHaveBeenCalledTimes(1);
  });
  it("overwrites forged project/session scope and rejects foreign action IDs and moved-project stale cache", async () => {
    const f = await fixture();
    await f.rpc("a", "ops_snapshot");
    await f.rpc("b", "ops_snapshot");
    const foreign = await f.ops.invoke("ops.prepare", {
      projectId: "pb",
      connectionId: f.cb.id,
      expectedTargetHash: f.cb.targetHash,
      expectedAuthGeneration: f.cb.authGeneration,
      operation: "ci.trigger",
      input: { jobId: "Build" },
    });
    f.remote.call.mockClear();
    expect(
      (
        await f.rpc("a", "ops_query", {
          projectId: "pb",
          sessionId: "b",
          connectionId: f.cb.id,
          operation: "ci.jobs",
        })
      ).value.error.kind,
    ).toBe("validation");
    expect(
      (
        await f.rpc("a", "ops_execute", {
          projectId: "pb",
          sessionId: "b",
          preparedActionId: foreign.id,
        })
      ).value.error.kind,
    ).toBe("not_found");
    expect(f.remote.call).not.toHaveBeenCalled();
    const own = await f.rpc("a", "ops_query", {
      projectId: "pb",
      sessionId: "b",
      taskId: "tb",
      connectionId: f.ca.id,
      operation: "ci.jobs",
      input: {},
    });
    expect(own.isError).toBe(false);
    expect(f.calls.at(-1)?.p).toMatchObject({
      projectId: "pa",
      sessionId: "a",
      taskId: "ta",
    });
    f.state.tasks.find((t) => t.id === "ta")!.projectId = "pb";
    const before = f.remote.call.mock.calls.length;
    expect(
      (
        await f.rpc("a", "ops_query", {
          connectionId: f.ca.id,
          operation: "ci.jobs",
        })
      ).value.error.kind,
    ).toBe("validation");
    expect(f.remote.call).toHaveBeenCalledTimes(before);
  });
});
