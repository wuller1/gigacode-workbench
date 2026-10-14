import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { UiMcpServer } from "../electron/mcp";
import type { AppState } from "../shared/types";

const servers: UiMcpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
});
async function fixture(
  options: ConstructorParameters<typeof UiMcpServer>[2] = {},
) {
  const state = {
    sessions: [{ id: "s", taskId: "t", status: "running" }],
    tasks: [{ id: "t", projectId: "p" }],
    profiles: [],
    questions: [],
  } as unknown as AppState;
  let admitted!: () => void;
  const dispatches: { method: string; params: any }[] = [];
  const created = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const server = new UiMcpServer(
    () => state,
    async (method, params) => {
      dispatches.push({ method, params });
      if (method === "question.create") {
        state.questions.push({
          id: "q",
          sessionId: "s",
          title: "Original",
          status: "pending",
          kind: "question",
          options: [],
        });
        admitted();
        return state.questions[0];
      }
      throw new Error("Unexpected dispatch");
    },
    { questionPollMs: 5, questionTimeoutMs: 1000, ...options },
  );
  servers.push(server);
  await server.start();
  const binding = server.binding("s", 1)[0];
  const rpc = async (method: string, params: unknown = {}, b = binding) => {
    const response = await fetch(b.url, {
      method: "POST",
      headers: { Authorization: b.headers[0].value },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, body: await response.json() };
  };
  const ask = () =>
    rpc("tools/call", {
      name: "ask_user",
      arguments: { title: "Original", options: ["A", "B"] },
    });
  const answer = () => {
    state.questions[0].status = "answered";
    state.questions[0].answer = "SAVED_LATE_ANSWER";
  };
  return { state, server, binding, rpc, ask, created, answer, dispatches };
}
function rawPost(
  binding: ReturnType<UiMcpServer["binding"]>[number],
  body: Buffer,
  split?: number,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      binding.url,
      {
        method: "POST",
        headers: {
          Authorization: binding.headers[0].value,
          "Content-Type": "application/json",
          "Content-Length": String(body.length),
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.once("end", () => {
          try {
            resolve({ status: response.statusCode!, body: JSON.parse(text) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(2000, () =>
      request.destroy(new Error("Raw body probe timed out")),
    );
    if (split === undefined) request.end(body);
    else {
      request.write(body.subarray(0, split));
      setTimeout(() => request.end(body.subarray(split)), 5);
    }
  });
}
describe("MCP interruption and bounded HTTP intake", () => {
  it("rejects malformed UTF-8 inside JSON before dispatching a tool or creating a question", async () => {
    const x = await fixture({ questionTimeoutMs: 25 });
    const body = Buffer.concat([
      Buffer.from(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ask_user","arguments":{"title":"ASK_',
      ),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('","options":["A"]}}}'),
    ]);
    expect((await rawPost(x.binding, body)).status).toBe(400);
    expect(x.dispatches).toHaveLength(0);
    expect(x.state.questions).toHaveLength(0);
    expect((await x.rpc("ping")).status).toBe(200);
  });
  it("retains valid multibyte JSON text split across incoming HTTP chunks", async () => {
    const x = await fixture();
    const title = "Выберите 猫🙂";
    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "ask_user", arguments: { title, options: ["Да"] } },
      }),
    );
    const pending = rawPost(
      x.binding,
      body,
      body.indexOf(Buffer.from("猫")) + 1,
    );
    await x.created;
    x.answer();
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.body.result.isError).not.toBe(true);
    expect(x.dispatches).toHaveLength(1);
    expect(x.dispatches[0].params.title).toBe(title);
  });
  it("delivers a saved answer to the still-current executor", async () => {
    const x = await fixture();
    const pending = x.ask();
    await x.created;
    x.answer();
    const result = (await pending).body.result;
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      answer: "SAVED_LATE_ANSWER",
    });
  });
  it.each([1, 2])(
    "keeps a late answer but never delivers it after bearer replacement (generation %s)",
    async (generation) => {
      const x = await fixture();
      const pending = x.ask();
      await x.created;
      x.server.revokeBinding("s");
      const replacement = x.server.binding("s", generation)[0];
      x.answer();
      const result = (await pending).body.result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).not.toContain("SAVED_LATE_ANSWER");
      expect(x.state.questions[0].answer).toBe("SAVED_LATE_ANSWER");
      expect((await x.rpc("ping", {}, replacement)).status).toBe(200);
    },
  );
  it.each(["cancelling", "unknown", "failed"] as const)(
    "does not interpret a late saved answer as delivery to a %s session",
    async (status) => {
      const x = await fixture();
      const pending = x.ask();
      await x.created;
      x.state.sessions[0].status = status;
      x.answer();
      expect((await pending).body.result.isError).toBe(true);
      expect(x.state.questions[0].status).toBe("answered");
    },
  );
  it("expires waiting without inventing an answer", async () => {
    const x = await fixture({ questionTimeoutMs: 25 });
    const result = (await x.ask()).body.result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("do not assume approval");
    expect(x.state.questions[0].status).toBe("pending");
  });
  it.each(["admission", "deadline"] as const)(
    "bounds slow bodies through %s and releases subsequent calls",
    async (mode) => {
      const x = await fixture({
        bodyTimeoutMs: mode === "admission" ? 5000 : 80,
        maxPendingBodies: 1,
      });
      const accepted = new Promise<void>((resolve) =>
        (x.server as any).server.once("request", resolve),
      );
      let request!: ReturnType<typeof httpRequest>;
      const closed = new Promise<void>((resolve, reject) => {
        request = httpRequest(
          x.binding.url,
          {
            method: "POST",
            headers: { Authorization: x.binding.headers[0].value },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve());
          },
        );
        request.once("error", () => resolve());
        request.once("close", () => resolve());
        request.setTimeout(2000, () => {
          request.destroy();
          reject(new Error("Body deadline did not release the connection"));
        });
      });
      try {
        request.write('{"jsonrpc":"2.0",');
        await accepted;
        if (mode === "admission") {
          expect((await x.rpc("ping")).status).toBe(429);
          request.destroy();
        }
        await closed;
        const deadline = Date.now() + 1000;
        while ((x.server as any).pendingBodies && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 1));
        expect((x.server as any).pendingBodies).toBe(0);
        expect((await x.rpc("ping")).status).toBe(200);
        expect(x.state.questions).toHaveLength(0);
      } finally {
        request.destroy();
      }
    },
  );
  it("rejects oversized bodies without poisoning the next request", async () => {
    const x = await fixture();
    const response = await fetch(x.binding.url, {
      method: "POST",
      headers: { Authorization: x.binding.headers[0].value },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(400);
    expect((await x.rpc("ping")).status).toBe(200);
    expect(x.state.questions).toHaveLength(0);
  });
  it("reports a post-start listener fault through the host callback", async () => {
    const observed: Error[] = [];
    const x = await fixture({ onFault: (error) => observed.push(error) });
    const fault = new Error("Controlled listener failure");
    (x.server as any).server.emit("error", fault);
    expect(observed).toEqual([fault]);
  });
});
