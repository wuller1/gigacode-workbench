/** Read-only exact Qwen 0.25.1 native-tool registry probe. Never sends a model prompt. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.resolve(appRoot, "../docs/suite/evidence/flash-runtime-ui");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "gigacode-managed-native-policy-"),
);
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(500, { "content-type": "application/json" });
  response.end('{"error":"Read-only probe must not call provider"}');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const cli = path.join(appRoot, "node_modules/@qwen-code/qwen-code/cli.js");
const result = {
  schemaVersion: 1,
  platform: process.platform,
  time: new Date().toISOString(),
  scope:
    "Read-only unmodified Qwen 0.25.1 ACP initialize/session-new/native registry; no provider prompts or paid requests",
  cases: [],
  failures: [],
};
const clients = [];
try {
  const bundle = path.join(temp, "probe.cjs");
  await build({
    stdin: {
      resolveDir: appRoot,
      loader: "ts",
      contents:
        'export {AcpConnection} from "./electron/acp"; export {discoverPromptCapability} from "./electron/prompt-binding"; export {managedExecutorArgs} from "./electron/managed-runtime-policy";',
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(bundle).href);
  const { AcpConnection, discoverPromptCapability, managedExecutorArgs } =
    module.default ?? module;
  const capability = await discoverPromptCapability({ executable: cli });
  assert.equal(capability.support, "source_verified");
  assert.equal(capability.helpVerified, true);
  for (const managed of [false, true]) {
    const directory = path.join(temp, managed ? "managed" : "baseline"),
      home = path.join(directory, "home"),
      cwd = path.join(directory, "project");
    await fs.mkdir(home, { recursive: true });
    await fs.mkdir(cwd);
    const system = path.join(directory, "system.json");
    await fs.writeFile(system, "{}");
    await fs.writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({
        security: { auth: { selectedType: "openai" } },
        model: { name: "owned-readonly-fixture" },
        modelProviders: {
          openai: [
            { id: "owned-readonly-fixture", baseUrl, envKey: "OPENAI_API_KEY" },
          ],
        },
        memory: {
          enableManagedAutoMemory: false,
          enableManagedAutoDream: false,
          enableAutoSkill: false,
        },
        general: { chatRecording: false, enableAutoUpdate: false },
        telemetry: { enabled: false, logPrompts: false },
        experimental: {
          cron: false,
          agentTeam: false,
          agentCollaboration: false,
        },
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
      QWEN_CODE_SYSTEM_SETTINGS_PATH: system,
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: system,
      OPENAI_API_KEY: "owned-no-real-credential",
      OPENAI_BASE_URL: baseUrl,
      OPENAI_MODEL: "owned-readonly-fixture",
      NO_PROXY: "127.0.0.1,localhost",
    });
    const args = ["--acp", "--auth-type=openai", "--no-chat-recording"];
    const selected = managed ? managedExecutorArgs(args, capability) : args;
    const client = new AcpConnection({
      executable: cli,
      args: selected,
      cwd,
      env,
      startupTimeoutMs: 20000,
    });
    clients.push(client);
    await client.start();
    const created = await client.newSession({ cwd, mcpServers: [] });
    assert.ok(created.sessionId);
    const registry = await client.request(
      "qwen/status/workspace/tools",
      {},
      10000,
    );
    assert.ok(Array.isArray(registry.tools));
    assert.ok(registry.tools.length > 0);
    const statuses = registry.tools.map((tool) => ({
      name: tool.name,
      enabled: tool.enabled,
    }));
    const sessionUsage = await client.request(
      "qwen/status/session/context_usage",
      { sessionId: created.sessionId, detail: true },
      10000,
    );
    assert.equal(sessionUsage.sessionId, created.sessionId);
    const sessionToolNames = (sessionUsage.usage?.builtinTools ?? []).map(
      (tool) => (typeof tool === "string" ? tool : tool.name),
    );
    assert.ok(sessionToolNames.length > 0);
    if (managed) {
      for (const name of ["agent", "create_sub_session"]) {
        assert.equal(
          statuses.some((tool) => tool.name === name && tool.enabled),
          false,
          `Native ${name} remained enabled`,
        );
        assert.equal(
          sessionToolNames.includes(name),
          false,
          `Session native ${name} remained exposed`,
        );
      }
    } else
      assert.equal(
        statuses.some((tool) => tool.name === "agent" && tool.enabled),
        true,
        "Negative control: baseline native Agent absent",
      );
    result.cases.push({
      managed,
      args: selected,
      initialized: true,
      sessionCreated: true,
      nativeTools: statuses,
      sessionToolNames,
      note: "A baseline-absent CreateSubSession is not counted as an observed transition; its exclusion is additionally source-verified.",
      suppressed: managed
        ? ["agent", "create_sub_session"].map((name) => ({
            name,
            state:
              statuses.find((tool) => tool.name === name)?.enabled === false
                ? "disabled"
                : "not_registered",
          }))
        : [],
      providerRequests: requests,
    });
    await client.dispose();
  }
  assert.equal(requests, 0);
} catch (error) {
  result.failures.push(
    String(error?.message ?? error)
      .replaceAll(temp, "<owned-temp>")
      .slice(0, 2000),
  );
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled(
    clients.map((client) => client.dispose()),
  );
  result.cleanup = cleanup.map((item) => item.status);
  result.providerRequests = requests;
  result.paidRequests = 0;
  result.status =
    !result.failures.length &&
    cleanup.every((item) => item.status === "fulfilled")
      ? "passed"
      : "failed";
  const names = [
    "electron/managed-runtime-policy.ts",
    "electron/prompt-binding.ts",
    "electron/acp.ts",
    "tools/test-managed-qwen-policy.mjs",
  ];
  result.sourceHashes = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        createHash("sha256")
          .update(await fs.readFile(path.join(appRoot, name)))
          .digest("hex"),
      ]),
    ),
  );
  await fs.mkdir(output, { recursive: true });
  try {
    const previous = JSON.parse(
      await fs.readFile(
        path.join(output, "managed-qwen-readonly.json"),
        "utf8",
      ),
    );
    if (previous.status === "failed")
      await fs.writeFile(
        path.join(output, `native-policy-attempt-${Date.now()}-failed.json`),
        JSON.stringify(previous, null, 2) + "\n",
      );
  } catch {}
  await fs.writeFile(
    path.join(output, "managed-qwen-readonly.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (cleanup.every((item) => item.status === "fulfilled"))
    await fs.rm(temp, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      status: result.status,
      cases: result.cases.length,
      providerRequests: requests,
      failures: result.failures,
    }),
  );
}
