import { describe, expect, it, afterEach } from "vitest";
import { UiMcpServer } from "../electron/mcp";
import type { AppState } from "../shared/types";
const servers: UiMcpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
});
async function connection() {
  const calls: any[] = [];
  const state = {
    sessions: [{ id: "session", taskId: "task" }],
    tasks: [{ id: "task", projectId: "project" }],
  } as AppState;
  const server = new UiMcpServer(
    () => state,
    async (method, p, sessionId) => {
      calls.push({ method, p, sessionId });
      return { observed: true };
    },
  );
  servers.push(server);
  await server.start();
  const binding = server.binding("session")[0];
  const rpc = async (method: string, params: any = {}) => {
    const response = await fetch(binding.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: binding.headers[0].value,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return response.json();
  };
  return { rpc, calls, binding };
}
describe("IDE MCP contracts", () => {
  it("exposes lifetime revisions for every versioned mutation", async () => {
    const { rpc } = await connection();
    const listed = await rpc("tools/list");
    for (const name of [
      "ide_edit",
      "ide_save",
      "ide_rename_prepare",
      "ide_refactor_actions",
    ]) {
      const tool = listed.result.tools.find((tool: any) => tool.name === name);
      expect(tool.inputSchema.properties.expectedRevision).toEqual({
        type: "string",
      });
      expect(tool.inputSchema.required).toContain("expectedRevision");
    }
  });
  it("routes semantic and execution tools with trusted session/project identity", async () => {
    const { rpc, calls } = await connection();
    for (const [name, method] of [
      ["ide_rename_prepare", "ide.semantic.rename"],
      ["ide_tests_run", "ide.tests.run"],
      ["ide_debug_request", "ide.debug.request"],
      ["ide_output", "ide.output"],
    ]) {
      const response = await rpc("tools/call", {
        name,
        arguments: {
          projectId: "foreign",
          sessionId: "foreign",
          path: "src/a.ts",
        },
      });
      expect(response.result.isError).not.toBe(true);
      expect(calls.at(-1)).toEqual({
        method,
        p: {
          projectId: "project",
          sessionId: "session",
          taskId: "task",
          path: "src/a.ts",
        },
        sessionId: "session",
      });
    }
  });
  it("rejects unauthenticated access to the actual MCP HTTP endpoint", async () => {
    const { binding } = await connection();
    expect(
      (await fetch(binding.url, { method: "POST", body: "{}" })).status,
    ).toBe(401);
  });
});
