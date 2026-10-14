import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { UiMcpServer } from "../electron/mcp";
import type { AppState } from "../shared/types";

const servers: UiMcpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
});
async function fixture(generation?: number) {
  const calls: any[] = [];
  const state = {
    sessions: [{ id: "session", taskId: "task" }],
    tasks: [{ id: "task", projectId: "project" }],
    profiles: [{ id: "backend" }, { id: "diagnostics" }],
  } as AppState;
  const server = new UiMcpServer(
    () => state,
    async (method, p, sessionId) => {
      calls.push({ method, p, sessionId });
      return { transition: { status: "pending" }, replayed: false };
    },
  );
  servers.push(server);
  await server.start();
  const binding = server.binding("session", generation)[0];
  const rpc = async (method: string, params: any = {}, b = binding) => {
    const response = await fetch(b.url, {
      method: "POST",
      headers: { Authorization: b.headers[0].value },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, body: await response.json() };
  };
  const args = {
    operationId: "backend-diagnostics-1",
    roleHint: "diagnostics",
    reason: "The observed failure needs a separate diagnostic stage.",
    continuation:
      "Preserve the user goal; inspect the recorded failed scenario before changing code.",
    evidenceRefs: ["tests/reproduction.test.ts"],
  };
  const invoke = (arguments_: any = args, b = binding) =>
    rpc(
      "tools/call",
      { name: "role_transition_request", arguments: arguments_ },
      b,
    );
  return { server, binding, rpc, invoke, calls, args };
}

describe("generation-bound role transition MCP", () => {
  it("publishes bounded model arguments without host identity or generation", async () => {
    const x = await fixture(4);
    const listed = await x.rpc("tools/list");
    const schema = listed.body.result.tools.find(
      (t: any) => t.name === "role_transition_request",
    ).inputSchema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["operationId", "reason", "continuation"]);
    expect(schema.properties.generation).toBeUndefined();
    expect(schema.properties.sessionId).toBeUndefined();
    expect(schema.properties.continuation.maxLength).toBe(12000);
    expect(schema.properties.evidenceRefs.maxItems).toBe(16);
    const response = await x.invoke();
    expect(response.body.result.isError).not.toBe(true);
    expect(x.calls).toEqual([
      {
        method: "role.transition.request",
        p: { ...x.args, sessionId: "session", generation: 4 },
        sessionId: "session",
      },
    ]);
  });
  it("refuses unbound generations and forged, invalid or oversized inputs before invocation", async () => {
    const x = await fixture();
    expect((await x.invoke()).body.result.isError).toBe(true);
    const binding = x.server.binding("session", 7)[0];
    for (const invalid of [
      { ...x.args, generation: 8 },
      { ...x.args, sessionId: "foreign" },
      { ...x.args, roleHint: "invented-role" },
      { ...x.args, operationId: " " },
      { ...x.args, reason: "bad\0reason" },
      { ...x.args, continuation: "x".repeat(12001) },
      { ...x.args, evidenceRefs: Array(17).fill("ref") },
      { ...x.args, evidenceRefs: [null] },
    ])
      expect((await x.invoke(invalid, binding)).body.result.isError).toBe(true);
    expect(x.calls).toHaveLength(0);
    expect(() => x.server.binding("session", 0)).toThrow("generation");
    expect(() => x.server.binding("session", 1.5)).toThrow("generation");
  });
  it("rotation fences an already authenticated uploading request and new calls use only the new generation", async () => {
    const x = await fixture(3);
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "role_transition_request", arguments: x.args },
    });
    const accepted = new Promise<void>((resolve) =>
      (x.server as any).server.once("request", resolve),
    );
    let request!: ReturnType<typeof httpRequest>;
    const received = new Promise<number>((resolve, reject) => {
      request = httpRequest(
        x.binding.url,
        {
          method: "POST",
          headers: { Authorization: x.binding.headers[0].value },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode!));
        },
      );
      request.once("error", reject);
      request.setTimeout(3000, () =>
        request.destroy(new Error("Body barrier timed out")),
      );
    });
    try {
      request.write(payload.slice(0, 50));
      await accepted;
      const fresh = x.server.binding("session", 4)[0];
      request.end(payload.slice(50));
      expect(await received).toBe(401);
      expect(x.calls).toHaveLength(0);
      expect((await x.invoke(x.args, fresh)).body.result.isError).not.toBe(
        true,
      );
      expect(x.calls[0].p.generation).toBe(4);
      x.server.revokeBinding("session");
      expect((await x.invoke(x.args, fresh)).status).toBe(401);
      const noGeneration = x.server.binding("session")[0];
      expect((await x.invoke(x.args, noGeneration)).body.result.isError).toBe(
        true,
      );
      expect(x.calls).toHaveLength(1);
    } finally {
      request.destroy();
    }
  });
});
