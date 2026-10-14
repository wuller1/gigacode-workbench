import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

// Default: free ACP initialize/new only. --capture-local-provider additionally
// sends exactly two ACP prompts to an owned loopback protocol fixture, never to
// a real model. Captured prompts stay in memory; reports contain hashes/checks.
const captureLocal = process.argv.includes("--capture-local-provider");
const app = fileURLToPath(new URL("..", import.meta.url));
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-system-binding-"),
);
const connections = [];
const requests = [];
let provider;
let providerURL = "http://127.0.0.1:9/v1";
let dispatched = 0;
let closed = false;
const removeTemporary = () =>
  fs.rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
try {
  if (captureLocal) {
    provider = createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url === "/v1/models") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              object: "list",
              data: [{ id: "qwen3-coder-plus", object: "model" }],
            }),
          );
          return;
        }
        if (
          request.method !== "POST" ||
          request.url !== "/v1/chat/completions"
        ) {
          response.writeHead(404).end();
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024)
            throw new Error("Local request exceeds capture budget.");
          chunks.push(chunk);
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requests.push(parsed);
        if (requests.length > 2)
          throw new Error("Unexpected replay of a local provider request.");
        const content = "Local protocol fixture completed.";
        if (parsed.stream) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          for (const delta of [{ role: "assistant", content }, {}].entries()) {
            response.write(
              `data: ${JSON.stringify({ id: "local-placement-fixture", object: "chat.completion.chunk", created: 1, model: parsed.model, choices: [{ index: 0, delta: delta[1], finish_reason: delta[0] ? "stop" : null }] })}\n\n`,
            );
          }
          response.end("data: [DONE]\n\n");
        } else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              id: "local-placement-fixture",
              object: "chat.completion",
              created: 1,
              model: parsed.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          );
        }
      } catch {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", resolve);
    });
    providerURL = `http://127.0.0.1:${provider.address().port}/v1`;
  }
  const moduleFile = path.join(temporary, "probe-host.mjs");
  await build({
    stdin: {
      contents:
        'export * from "./electron/prompt-binding"; export {AcpConnection} from "./electron/acp";',
      resolveDir: app,
      loader: "ts",
    },
    outfile: moduleFile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const {
    compileInstructions,
    discoverPromptCapability,
    planPromptBinding,
    AcpConnection,
  } = await import(pathToFileURL(moduleFile).href);
  const hostBundleSha256 = createHash("sha256")
    .update(await fs.readFile(moduleFile))
    .digest("hex");
  const executable = path.join(app, "node_modules/@qwen-code/qwen-code/cli.js");
  const capability = await discoverPromptCapability({ executable });
  if (capability.support !== "source_verified")
    throw new Error(
      "The installed Qwen bytes do not match reviewed evidence. No ACP process was started.",
    );
  const core = await fs.readFile(
    path.join(app, "../workbench/CORE.md"),
    "utf8",
  );
  const lanes = [];
  for (const profileId of ["analyst", "reviewer"]) {
    const cwd = path.join(temporary, profileId),
      qwenHome = path.join(temporary, `${profileId}-home`);
    await fs.mkdir(cwd);
    await fs.mkdir(qwenHome);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/(?:key|token|secret|password|credential)/i.test(key) &&
          !/^(?:https?|all|no)_proxy$/i.test(key) &&
          !/^(?:QWEN|GIGACODE)_(?:SYSTEM_MD|WRITE_SYSTEM_MD)$/i.test(key),
      ),
    );
    Object.assign(env, {
      QWEN_HOME: qwenHome,
      QWEN_RUNTIME_DIR: path.join(qwenHome, "runtime"),
      OPENAI_API_KEY: "unused-free-probe-key",
      OPENAI_BASE_URL: providerURL,
      QWEN_CODE_UNATTENDED_RETRY: "0",
      NO_PROXY: "127.0.0.1,localhost",
    });
    const compiled = compileInstructions({
      core,
      role: await fs.readFile(
        path.join(app, `../workbench/profiles/${profileId}.md`),
        "utf8",
      ),
      profileId,
    });
    const plan = planPromptBinding({
      executable,
      args: [
        "--acp",
        "--safe-mode",
        "--telemetry=false",
        "--no-chat-recording",
        "--auth-type",
        "openai",
        "--model",
        "qwen3-coder-plus",
      ],
      compiled,
      capability,
      env,
    });
    if (plan.receipt.delivery !== "append_system")
      throw new Error(`Expected append mode: ${plan.receipt.reason}`);
    let permissionRequests = 0,
      updates = 0,
      toolCalls = 0;
    const connection = new AcpConnection({
      executable,
      args: plan.args,
      cwd,
      env,
      startupTimeoutMs: 30_000,
      onPermission: async () => {
        permissionRequests++;
        return { outcome: { outcome: "cancelled" } };
      },
      onUpdate: (params) => {
        updates++;
        if (params?.update?.sessionUpdate === "tool_call") toolCalls++;
      },
    });
    connections.push(connection);
    lanes.push({
      profileId,
      connection,
      cwd,
      plan,
      compiled,
      stats: () => ({ permissionRequests, updates, toolCalls }),
    });
  }
  const initialized = await Promise.all(
    lanes.map((lane) => lane.connection.start()),
  );
  const sessions = await Promise.all(
    lanes.map((lane) =>
      lane.connection.newSession({ cwd: lane.cwd, mcpServers: [] }),
    ),
  );
  if (
    initialized.some((result) => result?.protocolVersion !== 1) ||
    sessions.some(
      (result) => typeof result?.sessionId !== "string" || !result.sessionId,
    )
  )
    throw new Error(
      "ACP initialization/session creation was not confirmed for both processes.",
    );
  if (lanes.some((lane) => lane.stats().permissionRequests))
    throw new Error(
      "A permission was unexpectedly requested during free startup.",
    );
  let placement;
  if (captureLocal) {
    let timeout;
    const results = await Promise.race([
      Promise.all(
        lanes.map((lane, index) => {
          dispatched++;
          return lane.connection.prompt(
            sessions[index].sessionId,
            `Local protocol fixture request for role ${lane.profileId}. Return the fixture response; no tools.`,
          );
        }),
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error("Local placement capture timed out; no replay.")),
          20_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    if (
      requests.length !== 2 ||
      results.some((result) => result?.stopReason !== "end_turn")
    )
      throw new Error(
        "Expected exactly two completed loopback provider requests.",
      );
    placement = lanes.map((lane, index) => {
      const payload = requests.find((body) =>
        body.messages?.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes(`role ${lane.profileId}`),
        ),
      );
      if (!payload)
        throw new Error("Cannot correlate a captured request to its role.");
      const text = (value) =>
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value
                .map((part) => (part?.type === "text" ? part.text : ""))
                .join("\n")
            : "";
      const system = payload.messages
        .filter((message) => ["system", "developer"].includes(message.role))
        .map((message) => text(message.content))
        .join("\n");
      const user = payload.messages
        .filter((message) => message.role === "user")
        .map((message) => text(message.content))
        .join("\n");
      const otherRole = lanes[1 - index].profileId;
      const checks = {
        nativeQwenBasePreserved:
          system.includes("You are Qwen Code,") &&
          system.includes("# Core Mandates"),
        exactCompiledInstructionsInSystem: system.includes(lane.compiled.text),
        compiledInstructionsAppearOnce:
          system.split(lane.compiled.text).length - 1 === 1,
        otherRoleAbsent: !system.includes(`# Workbench role: ${otherRole}`),
        instructionsAbsentFromUserMessage: !user.includes(lane.compiled.text),
      };
      if (Object.values(checks).some((value) => !value))
        throw new Error(
          `System placement checks failed for ${lane.profileId}: ${JSON.stringify(checks)}`,
        );
      return {
        profileId: lane.profileId,
        checks,
        messageRoles: payload.messages.map((message) => message.role),
        systemBytes: Buffer.byteLength(system, "utf8"),
        systemSha256: createHash("sha256").update(system).digest("hex"),
        compiledContentHash: lane.compiled.contentHash,
        toolDefinitionsOffered: payload.tools?.length ?? 0,
        observedToolCalls: lane.stats().toolCalls,
        stopReason: results[index].stopReason,
      };
    });
    if (
      lanes.some(
        (lane) => lane.stats().toolCalls || lane.stats().permissionRequests,
      )
    )
      throw new Error(
        "A tool or permission operation occurred during local provider placement capture.",
      );
  }
  await Promise.all(connections.map((connection) => connection.dispose()));
  closed = true;
  const result = {
    probe: captureLocal
      ? "qwen-system-binding-local-provider-placement"
      : "qwen-system-binding-free-startup",
    platform: process.platform,
    runtimeVersion: capability.runtimeVersion,
    runtimeFingerprint: capability.runtimeFingerprint,
    hostBundleSha256,
    helpVerified: capability.helpVerified,
    hostPromptDispatches: dispatched,
    modelProvider: captureLocal
      ? "owned loopback OpenAI protocol fixture"
      : "not invoked",
    credentialMode:
      "dummy credential; loopback endpoint; process-scoped isolated QWEN_HOME/runtime",
    modelBehaviorChecked: false,
    providerSystemRequestCaptured: captureLocal,
    ...(placement ? { placement } : {}),
    sourceEvidence: capability.evidenceScope,
    observations: lanes.map((lane, index) => ({
      profileId: lane.profileId,
      delivery: lane.plan.receipt.delivery,
      contentHash: lane.plan.receipt.contentHash,
      instructionFingerprint: lane.plan.receipt.fingerprint,
      initialized: initialized[index].protocolVersion === 1,
      newSession: true,
      agent: initialized[index].agentInfo,
      ...lane.stats(),
    })),
    distinctRoleSnapshots:
      lanes[0].plan.receipt.fingerprint !== lanes[1].plan.receipt.fingerprint,
    cleanup: "owned connections closed; isolated files removed",
  };
  if (!result.distinctRoleSnapshots)
    throw new Error("Two role snapshots unexpectedly have the same identity.");
  await removeTemporary();
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) {
    const report = process.argv[reportIndex + 1];
    if (!report || !path.isAbsolute(report))
      throw new Error("--report requires an absolute file path.");
    await fs.mkdir(path.dirname(report), { recursive: true });
    await fs.writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // ACP errors already redact transport metadata; avoid including raw frames.
  console.error(
    JSON.stringify({
      probe: captureLocal
        ? "qwen-system-binding-local-provider-placement"
        : "qwen-system-binding-free-startup",
      status: "failed",
      message: String(error?.message ?? error).slice(0, 1000),
      hostPromptDispatches: dispatched,
    }),
  );
  process.exitCode = 1;
} finally {
  if (!closed)
    await Promise.allSettled(
      connections.map((connection) => connection.dispose()),
    );
  if (provider) {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
  await removeTemporary();
}
