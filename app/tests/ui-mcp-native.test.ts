import { describe, it, expect } from "vitest";
import { UiMcpServer } from "../electron/mcp";
import type { AppState } from "../shared/types";
describe("UI MCP security and tool dispatch", () => {
  it("requires a per-session secret and rejects browser origins", async () => {
    const state = {
      sessions: [{ id: "s", taskId: "t" }],
      tasks: [{ id: "t", projectId: "p" }],
    } as AppState;
    const calls: any[] = [];
    const server = new UiMcpServer(
      () => state,
      async (m, p, s) => {
        calls.push({ m, p, s });
        return { ok: true };
      },
    );
    await server.start();
    try {
      const binding = server.binding("s")[0];
      const message = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "plan_replace", arguments: { items: [] } },
      };
      const send = (headers: Record<string, string>) =>
        fetch(binding.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(message),
        });
      expect((await send({})).status).toBe(401);
      expect(
        (
          await send({
            Authorization: binding.headers[0].value,
            Origin: "https://untrusted.test",
          })
        ).status,
      ).toBe(403);
      const response = await send({ Authorization: binding.headers[0].value });
      expect(response.status).toBe(200);
      expect((await response.json()).result.isError).not.toBe(true);
      expect(calls).toEqual([
        { m: "todo.replace", p: { sessionId: "s", items: [] }, s: "s" },
      ]);
    } finally {
      await server.dispose();
    }
  });
});
it("retrieves the tail of long messages and keeps history inside the current task", async () => {
  const state = {
    sessions: [
      {
        id: "s",
        taskId: "t",
        messages: [
          {
            id: "m",
            role: "assistant",
            at: "2026-10-10",
            content: "a".repeat(14000) + "TAIL",
          },
        ],
      },
      { id: "foreign", taskId: "another", messages: [] },
    ],
    tasks: [{ id: "t", projectId: "p" }],
  } as AppState;
  const server = new UiMcpServer(
    () => state,
    async () => ({}),
  );
  await server.start();
  try {
    const b = server.binding("s")[0];
    const call = async (args: any) => {
      const r = await fetch(b.url, {
        method: "POST",
        headers: { Authorization: b.headers[0].value },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "task_history", arguments: args },
        }),
      });
      return (await r.json()).result;
    };
    const first = JSON.parse(
      (await call({ id: "s", messageId: "m" })).content[0].text,
    );
    expect(first.nextOffset).toBe(12000);
    const tail = JSON.parse(
      (await call({ id: "s", messageId: "m", offset: first.nextOffset }))
        .content[0].text,
    );
    expect(tail.content.endsWith("TAIL")).toBe(true);
    expect(tail.nextOffset).toBe(null);
    expect((await call({ id: "foreign" })).isError).toBe(true);
  } finally {
    await server.dispose();
  }
});
