import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { AcpConnection, McpReadinessError } from "../electron/acp.js";
import { WorkbenchService } from "../electron/service.js";
import * as binding from "../electron/prompt-binding.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function temporary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-readiness-"));
  cleanup.push(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
async function until(predicate: () => unknown | Promise<unknown>) {
  await vi.waitFor(async () => expect(await predicate()).toBeTruthy(), {
    timeout: 5000,
    interval: 10,
  });
}
const status = (discoveryState = "completed", server = {}) => ({
  sessionId: "remote-42",
  mcp: {
    initialized: true,
    discoveryState,
    servers: [
      {
        name: "workbench-ui",
        disabled: false,
        status: "ok",
        mcpStatus: "connected",
        ...server,
      },
    ],
  },
});
const unitConnection = () => {
  const connection = new AcpConnection({
    executable: process.execPath,
    args: [],
    cwd: process.cwd(),
  });
  (connection as any).ownedSession = "remote-42";
  return connection;
};

describe("reviewed Qwen session-bound MCP readiness", () => {
  it("waits for completed discovery even when transport already says connected, then accepts only the requested remote session", async () => {
    const connection = unitConnection();
    const request = vi
      .spyOn(connection, "request")
      .mockResolvedValueOnce(
        status("not_started", { status: "error", mcpStatus: "disconnected" }),
      )
      .mockResolvedValueOnce(status("in_progress"))
      .mockResolvedValue(status());
    await connection.waitForMcpReady("remote-42", "workbench-ui", 2000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls.every(
        ([method, params]) =>
          method === "qwen/status/session/resources" &&
          (params as any).sessionId === "remote-42",
      ),
    ).toBe(true);
    await expect(
      connection.waitForMcpReady("host-id", "workbench-ui"),
    ).rejects.toMatchObject({ kind: "invalid_status", ambiguous: false });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("tolerates a progressively absent own server and unrelated failed MCP servers without granting their readiness", async () => {
    const connection = unitConnection();
    const ready = status();
    (ready.mcp as any).errors = [{ kind: "unrelated", status: "error" }];
    ready.mcp.servers.push({
      name: "unrelated",
      disabled: false,
      status: "error",
      mcpStatus: "disconnected",
    });
    const request = vi
      .spyOn(connection, "request")
      .mockResolvedValueOnce({
        ...status("not_started"),
        mcp: { initialized: true, discoveryState: "not_started", servers: [] },
      })
      .mockResolvedValue(ready);
    await connection.waitForMcpReady("remote-42", "workbench-ui", 2000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    [
      "wrong session",
      { ...status(), sessionId: "different" },
      "invalid_status",
    ],
    [
      "malformed state",
      {
        ...status(),
        mcp: { initialized: true, discoveryState: "invented", servers: [] },
      },
      "invalid_status",
    ],
    [
      "completed without own server",
      {
        ...status(),
        mcp: { initialized: true, discoveryState: "completed", servers: [] },
      },
      "invalid_status",
    ],
    [
      "disabled",
      status("completed", { disabled: true, status: "disabled" }),
      "unavailable",
    ],
    [
      "disconnected",
      status("completed", { mcpStatus: "disconnected", status: "error" }),
      "unavailable",
    ],
    [
      "pending approval",
      status("completed", { approvalState: "pending" }),
      "unavailable",
    ],
  ])(
    "holds invalid/unavailable %s before any prompt",
    async (_label, result, kind) => {
      const connection = unitConnection();
      vi.spyOn(connection, "request").mockResolvedValue(result);
      await expect(
        connection.waitForMcpReady("remote-42", "workbench-ui"),
      ).rejects.toMatchObject({ kind, ambiguous: false, retryable: false });
    },
  );
  it("does not reject an explicitly approved own server", async () => {
    const connection = unitConnection();
    vi.spyOn(connection, "request").mockResolvedValue(
      status("completed", { approvalState: "approved" }),
    );
    await connection.waitForMcpReady("remote-42", "workbench-ui");
  });
  it("times out a never-ending status request and removes the pending request/abort listener", async () => {
    const connection = unitConnection();
    vi.spyOn(connection as any, "send").mockImplementation(() => undefined);
    await expect(
      connection.waitForMcpReady("remote-42", "workbench-ui", 30),
    ).rejects.toMatchObject({ kind: "timeout", ambiguous: false });
    expect((connection as any).pending.size).toBe(0);
    expect((connection as any).mcpReadinessAbort).toBeUndefined();
  });
  it("cancels a held status request immediately without leaving it pending or permitting a prompt", async () => {
    const connection = unitConnection();
    vi.spyOn(connection as any, "send").mockImplementation(() => undefined);
    const result = expect(
      connection.waitForMcpReady("remote-42", "workbench-ui"),
    ).rejects.toMatchObject({ kind: "cancelled", ambiguous: false });
    connection.cancel("remote-42");
    await result;
    expect((connection as any).pending.size).toBe(0);
    expect((connection as any).mcpReadinessAbort).toBeUndefined();
  });

  it("observes the ordinary installed Qwen extension through actual ACP while real HTTP tool discovery is held", async () => {
    const dir = await temporary(),
      home = path.join(dir, "home");
    await fs.mkdir(home);
    const listed = gate(),
      release = gate();
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (message.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "owned", version: "1" },
        };
      else if (message.method === "tools/list") {
        listed.release();
        await release.promise;
        result = {
          tools: [
            {
              name: "role_transition_request",
              description: "Owned readiness proof only",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      } else {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Not supported" },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(async () => {
      release.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await fs.writeFile(path.join(dir, "system.json"), "{}");
    await fs.writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({
        security: { auth: { selectedType: "openai" } },
        model: { name: "owned-readiness-proof" },
        modelProviders: {
          openai: [
            {
              id: "owned-readiness-proof",
              baseUrl: "http://127.0.0.1:9/v1",
              envKey: "OPENAI_API_KEY",
            },
          ],
        },
        memory: {
          enableManagedAutoMemory: false,
          enableManagedAutoDream: false,
          enableAutoSkill: false,
        },
        general: { chatRecording: false, enableAutoUpdate: false },
        telemetry: { enabled: false },
      }),
    );
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (
        /OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(https?|all|no)_proxy$/i.test(
          key,
        )
      )
        delete env[key];
    Object.assign(env, {
      QWEN_HOME: home,
      QWEN_RUNTIME_DIR: path.join(home, "runtime"),
      QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(dir, "system.json"),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(dir, "system.json"),
      OPENAI_API_KEY: "owned-no-external-provider",
      QWEN_CODE_DISABLE_CRON: "1",
      QWEN_CODE_MEMORY_TEAM: "0",
      QWEN_CODE_MEMORY_TEAM_SYNC: "0",
      NO_PROXY: "127.0.0.1,localhost",
    });
    const connection = new AcpConnection({
      executable: fileURLToPath(
        new URL("../node_modules/@qwen-code/qwen-code/cli.js", import.meta.url),
      ),
      args: ["--acp", "--auth-type", "openai", "--no-chat-recording"],
      cwd: dir,
      env,
    });
    cleanup.push(() => connection.dispose());
    await connection.start();
    const created = await connection.newSession({
      cwd: dir,
      mcpServers: [
        {
          type: "http",
          name: "workbench-ui",
          url: `http://127.0.0.1:${(server.address() as any).port}/mcp`,
          headers: [],
        },
      ],
    });
    await until(() => listed.promise.then(() => true));
    const pending = await connection.request("qwen/status/session/resources", {
      sessionId: created.sessionId,
    });
    expect(pending.sessionId).toBe(created.sessionId);
    expect(pending.mcp.discoveryState).toBe("in_progress");
    // Manager status may still be disconnected while this authenticated HTTP
    // tools/list is in flight; neither state permits model dispatch yet.
    expect(["connected", "connecting", "disconnected"]).toContain(
      pending.mcp.servers.find((s: any) => s.name === "workbench-ui").mcpStatus,
    );
    let acknowledged = false;
    const ready = connection
      .waitForMcpReady(created.sessionId, "workbench-ui", 5000)
      .then(() => {
        acknowledged = true;
      });
    try {
      expect(acknowledged).toBe(false);
      release.release();
      await ready;
      expect(acknowledged).toBe(true);
    } finally {
      release.release();
      await ready.catch(() => undefined);
    }
  }, 30000);
});

async function host(reviewed: boolean) {
  const dir = await temporary(),
    bundleDir = path.join(dir, "bundle");
  await fs.mkdir(path.join(bundleDir, "profiles"), { recursive: true });
  await fs.writeFile(
    path.join(bundleDir, "CORE.md"),
    "Facts and accepted scope.",
  );
  for (const role of ["backend", "frontend"])
    await fs.writeFile(
      path.join(bundleDir, "profiles", role + ".md"),
      role + " role",
    );
  const executable = path.join(dir, "fixture.mjs");
  await fs.writeFile(
    executable,
    `import readline from 'node:readline';import fs from 'node:fs';const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')reply(m.id,{protocolVersion:1});if(m.method==='session/new')reply(m.id,{sessionId:'remote-42'});if(m.method==='session/prompt'){fs.appendFileSync('prompts.jsonl',JSON.stringify(m.params)+'\\n');reply(m.id,{stopReason:'end_turn'});}});`,
  );
  if (reviewed)
    vi.spyOn(binding, "discoverPromptCapability").mockImplementation(
      async ({ executable }) => ({
        executablePath: executable,
        runtimeFingerprint: "a".repeat(64),
        runtimeVersion: "0.25.1",
        family: "qwen",
        support: "source_verified",
        supportsToollessRouter: true,
        helpVerified: true,
        evidenceScope: "reviewed_qwen_0.25.1_source",
        reason: "Synthetic capability fixture, not actual Qwen proof.",
      }),
    );
  const service = new WorkbenchService({
    dataDir: path.join(dir, "data"),
    bundleDir,
    emit: () => undefined,
    routeProfile: async (input) => ({
      profileId: input.roleHint || "backend",
      confidence: 1,
      reason: "Fixture route",
    }),
    mcpServersForSession: () => [
      {
        type: "http",
        name: "workbench-ui",
        url: "http://127.0.0.1:9/mcp",
        headers: [],
      },
    ],
  });
  cleanup.push(() => service.dispose());
  await service.init();
  await service.invoke("settings.update", {
    patch: { cliPath: executable, cliArgs: ["--acp"], startupRetries: 0 },
  });
  const project = await service.invoke("project.create", {
    name: "Readiness",
    path: dir,
  });
  const task = await service.invoke("task.create", {
    projectId: project.id,
    title: "Accepted task",
  });
  const session = await service.invoke("session.create", { taskId: task.id });
  const current = () =>
    service.snapshot().sessions.find((s) => s.id === session.id)!;
  const prompts = async () =>
    fs.readFile(path.join(dir, "prompts.jsonl"), "utf8").then(
      (s) => s.trim().split("\n").filter(Boolean),
      () => [],
    );
  return { service, session, current, prompts };
}
describe("host admission around MCP readiness", () => {
  it("does not guess the Qwen status extension for an unknown Giga-like CLI", async () => {
    const wait = vi.spyOn(AcpConnection.prototype, "waitForMcpReady");
    const h = await host(false);
    await h.service.invoke("session.send", {
      id: h.session.id,
      text: "Small accepted task",
    });
    await until(() => h.current().status === "completed");
    expect(wait).not.toHaveBeenCalled();
    expect(await h.prompts()).toHaveLength(1);
  });
  it("retains the human queue until reviewed MCP readiness, and rechecks cancellation after the await", async () => {
    const reached = gate(),
      release = gate();
    vi.spyOn(AcpConnection.prototype, "waitForMcpReady").mockImplementation(
      async (remoteId, name) => {
        expect(remoteId).toBe("remote-42");
        expect(name).toBe("workbench-ui");
        reached.release();
        await release.promise;
      },
    );
    const h = await host(true);
    await h.service.invoke("session.send", {
      id: h.session.id,
      text: "Accepted work",
    });
    await until(() => reached.promise.then(() => true));
    try {
      expect(h.current().queue).toHaveLength(1);
      expect(
        h.current().messages.filter((m) => m.role === "user"),
      ).toHaveLength(0);
      expect(await h.prompts()).toHaveLength(0);
      await h.service.invoke("session.cancel", { id: h.session.id });
    } finally {
      release.release();
    }
    await until(() => h.current().status === "failed");
    expect(h.current().queue).toHaveLength(1);
    expect(await h.prompts()).toHaveLength(0);
  });
  it("holds failed MCP discovery before dispatch, preserving input and requiring explicit resume", async () => {
    vi.spyOn(AcpConnection.prototype, "waitForMcpReady").mockRejectedValue(
      new McpReadinessError("unavailable", "Own MCP unavailable"),
    );
    const h = await host(true);
    await h.service.invoke("session.send", {
      id: h.session.id,
      text: "Accepted work",
    });
    await until(() => h.current().status === "failed");
    expect(h.current().queue).toHaveLength(1);
    expect(h.current().error).toContain("Own MCP unavailable");
    expect(await h.prompts()).toHaveLength(0);
    expect((h.service as any).store.read()._controls[h.session.id].paused).toBe(
      true,
    );
  });
  it("cancels a real pending status request during idle model-picker preparation without waiting for its deadline", async () => {
    const h = await host(true);
    const preparing = h.service.invoke("session.prepare", { id: h.session.id });
    const rejected = expect(preparing).rejects.toMatchObject({
      kind: "cancelled",
    });
    await until(
      () =>
        (h.service as any).live.get(h.session.id)?.client?.mcpReadinessAbort,
    );
    expect(h.current().status).toBe("idle");
    await h.service.invoke("session.cancel", { id: h.session.id });
    await rejected;
    expect((h.service as any).live.has(h.session.id)).toBe(false);
    expect(await h.prompts()).toHaveLength(0);
  });
});
