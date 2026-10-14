// Actual Qwen runtime against a controlled loopback provider. No real LLM,
// account credentials, corporate MCP servers, or external API calls are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";

const app = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(app, "node_modules/@qwen-code/qwen-code/cli.js");
const packageMetadata = JSON.parse(
  await fs.readFile(path.join(path.dirname(cli), "package.json"), "utf8"),
);
assert.equal(
  packageMetadata.version,
  "0.25.1",
  "Review guards before changing the pinned CLI.",
);
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "qwen-router-offline-"),
);
const home = path.join(temporary, "qwen");
const cwd = path.join(temporary, "project");
const writePath = path.join(cwd, "guard-write.txt");
const mcpPath = path.join(temporary, "mcp-start.txt");
const contextMarker = "PROJECT-CONTEXT-MUST-NOT-LOAD-97531";
const routerModule = path.join(temporary, "router.mjs");
const routerSource = await fs.readFile(
  path.join(app, "electron/role-router.ts"),
  "utf8",
);
const currentRouterSourceSha256 = createHash("sha256")
  .update(routerSource)
  .digest("hex");
await build({
  stdin: {
    contents: routerSource,
    loader: "ts",
    resolveDir: path.join(app, "electron"),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: routerModule,
  logLevel: "silent",
});
const { parseRouterOutput } = await import(pathToFileURL(routerModule).href);
await fs.mkdir(home);
await fs.mkdir(cwd);
await fs.writeFile(path.join(cwd, "QWEN.md"), contextMarker);
await fs.writeFile(
  path.join(home, "settings.json"),
  JSON.stringify({
    mcpServers: {
      guardProbe: {
        command: process.execPath,
        args: [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(mcpPath)},'started')`,
        ],
      },
    },
    telemetry: { enabled: false },
    privacy: { usageStatisticsEnabled: false },
  }),
);
const exists = (filename) =>
  fs.stat(filename).then(
    () => true,
    () => false,
  );
const roleDecision = {
  profileId: "reviewer",
  reason: "Independent review requested",
  confidence: 0.9,
};
const roleSchema = {
  type: "object",
  properties: {
    profileId: { type: "string", enum: ["analyst", "reviewer"] },
    reason: { type: "string", minLength: 1, maxLength: 1000 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["profileId", "reason", "confidence"],
  additionalProperties: false,
};
const classifierMarker = "CONTROLLED-ROLE-CLASSIFIER-SYSTEM-97531";
const inheritedSystemMarker = "INHERITED-SYSTEM-MUST-NOT-LOAD-13579";
let current;
const server = createServer(async (request, response) => {
  try {
    assert.ok(current, "Unexpected fixture request outside an owned scenario.");
    assert.equal(request.url, "/v1/chat/completions");
    let text = "";
    for await (const chunk of request) {
      text += chunk;
      assert.ok(text.length <= 1024 * 1024, "Oversized fixture request.");
    }
    const body = JSON.parse(text);
    current.requests++;
    current.projectContextLoaded ||= JSON.stringify(body.messages).includes(
      contextMarker,
    );
    const names = (body.tools || []).map(
      (tool) => tool.function?.name || tool.name,
    );
    current.writeToolAdvertised ||= names.includes("write_file");
    current.structuredOutputAdvertised ||= names.includes("structured_output");
    const systemMessages = JSON.stringify(
      body.messages.filter((message) => message.role === "system"),
    );
    current.dedicatedSystemObserved ||=
      systemMessages.includes(classifierMarker) ||
      systemMessages.includes("Select exactly one primary work role");
    current.inheritedSystemObserved ||= JSON.stringify(body.messages).includes(
      inheritedSystemMarker,
    );
    (current.declaredToolNames ||= []).push(names);
    (current.providerModelIds ||= []).push(body.model);
    const ordinaryCall = {
      index: 0,
      id: "controlled-write-probe",
      type: "function",
      function: {
        name: "write_file",
        arguments: JSON.stringify({
          file_path: writePath,
          content: "CONTROLLED-SENTINEL",
        }),
      },
    };
    const structuredCall = {
      index: current.kind === "mixed" ? 1 : 0,
      id: "controlled-structured-reply",
      type: "function",
      function: {
        name: "structured_output",
        arguments: JSON.stringify(roleDecision),
      },
    };
    const delta = current.kind.startsWith("route_")
      ? current.kind.startsWith("route_tool") && current.requests === 1
        ? { role: "assistant", tool_calls: [ordinaryCall] }
        : {
            role: "assistant",
            content:
              current.requests > 1
                ? JSON.stringify(roleDecision)
                : current.kind === "route_invalid_role"
                  ? JSON.stringify({
                      ...roleDecision,
                      profileId: "not-in-the-role-catalog",
                    })
                  : "This is deliberately invalid classifier JSON.",
          }
      : current.kind === "plain" || current.kind.startsWith("tool_less_")
        ? {
            role: "assistant",
            content: JSON.stringify(roleDecision),
          }
        : {
            role: "assistant",
            tool_calls:
              current.kind === "structured"
                ? [structuredCall]
                : current.kind === "mixed"
                  ? [ordinaryCall, structuredCall]
                  : [ordinaryCall],
          };
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunks = [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: delta.tool_calls ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
    ];
    for (const chunk of chunks)
      response.write(
        `data: ${JSON.stringify({ id: "offline-fixture", object: "chat.completion.chunk", model: "fixture", ...chunk })}\n\n`,
      );
    response.end("data: [DONE]\n\n");
  } catch (error) {
    current.failure = String(error);
    response.writeHead(500);
    response.end("Controlled fixture failed.");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const env = {};
for (const key of [
  "PATH",
  "HOME",
  "LANG",
  "TEMP",
  "TMP",
  "SystemRoot",
  "ComSpec",
])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  QWEN_HOME: home,
  QWEN_RUNTIME_DIR: path.join(temporary, "runtime"),
  QWEN_CODE_DISABLE_CRON: "1",
});
async function run(kind, maxToolCalls) {
  const structured = kind === "structured" || kind === "mixed";
  const toolless = kind.startsWith("tool_less_");
  const excluded18 = [
    "glob",
    "grep_search",
    "read_file",
    "skill",
    "tool_call",
    "tool_search",
    "agent",
    "enter_worktree",
    "exit_worktree",
    "get_goal",
    "list_agents",
    "read_mcp_resource",
    "record_artifact",
    "report_findings",
    "send_message",
    "task_stop",
    "update_goal",
    "web_fetch",
  ];
  const toolExclusions =
    kind === "tool_less_wildcard"
      ? "*"
      : (kind === "tool_less_explicit22"
          ? [
              ...excluded18,
              "edit",
              "notebook_edit",
              "run_shell_command",
              "write_file",
            ]
          : excluded18
        ).join(",");
  await fs.rm(writePath, { force: true });
  current = {
    kind,
    requests: 0,
    projectContextLoaded: false,
    writeToolAdvertised: false,
    structuredOutputAdvertised: false,
    dedicatedSystemObserved: false,
  };
  let stdout = "",
    stderr = "";
  const child = spawn(
    process.execPath,
    [
      cli,
      "--safe-mode",
      "--max-tool-calls",
      String(maxToolCalls),
      "--max-session-turns",
      structured ? "2" : "1",
      "--max-wall-time",
      "15s",
      "--output-format",
      "json",
      "--chat-recording",
      "false",
      "--approval-mode",
      "yolo",
      "--auth-type",
      "openai",
      "--openai-api-key",
      "fixture-local-only",
      "--openai-base-url",
      endpoint,
      "--model",
      "fixture",
      ...(structured
        ? [
            "--system-prompt",
            `${classifierMarker}. You are only a role classifier. Return a role decision through structured_output. Never use other tools.`,
            "--json-schema",
            JSON.stringify(roleSchema),
          ]
        : []),
      ...(toolless
        ? [
            "--system-prompt",
            `${classifierMarker}. You are only a role classifier. Return a JSON role decision. Never use tools.`,
            "--exclude-tools",
            toolExclusions,
          ]
        : []),
      "--prompt",
      "Select a role; respond with JSON only.",
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 25000);
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    assert.equal(current.failure, undefined);
    const result = {
      ...current,
      maxToolCalls,
      exitCode,
      writeOccurred: await exists(writePath),
      mcpStarted: await exists(mcpPath),
      budgetReported: /tool-call budget of 0 exceeded/.test(stdout + stderr),
      plainResultPresent: stdout.includes("reviewer"),
      ...(kind === "plain" || structured || toolless
        ? {
            plainEnvelopeKeys: Object.keys(JSON.parse(stdout)),
            parsedRoleId: parseRouterOutput(stdout, {
              currentProfileId: "analyst",
              project: { id: "p", name: "fixture", directory: "project" },
              task: {
                id: "t",
                title: "Review",
                description: "Review observed changes",
              },
              request: "Review current changes",
              history: [],
              profiles: ["analyst", "reviewer"].map((id) => ({
                id,
                name: id,
                description: id,
              })),
            }).profileId,
          }
        : {}),
      ...(toolless
        ? {
            toolExclusionOption: toolExclusions,
            toolDeclarationsRemoved: current.declaredToolNames.every(
              (names) => names.length === 0,
            ),
          }
        : {}),
    };
    assert.equal(result.requests, 1);
    assert.equal(result.projectContextLoaded, false);
    assert.equal(result.mcpStarted, false);
    if (kind === "plain" || structured || toolless) {
      assert.equal(exitCode, 0);
      assert.equal(result.plainResultPresent, true);
      assert.equal(result.parsedRoleId, "reviewer");
      assert.equal(result.writeOccurred, false);
      if (structured) {
        assert.equal(result.structuredOutputAdvertised, true);
        assert.equal(result.dedicatedSystemObserved, true);
        assert.equal(result.budgetReported, false);
      }
      if (toolless) {
        assert.equal(result.dedicatedSystemObserved, true);
        if (kind === "tool_less_wildcard")
          assert.equal(
            result.toolDeclarationsRemoved,
            false,
            "Reviewed Qwen wildcard negative control changed; review the runtime before treating this option as supported.",
          );
        if (kind === "tool_less_explicit22")
          assert.equal(
            result.toolDeclarationsRemoved,
            true,
            "Reviewed explicit tool deny list must leave no provider tool declarations.",
          );
      }
    } else {
      assert.equal(result.writeToolAdvertised, true);
      assert.equal(result.writeOccurred, maxToolCalls > 0);
      if (maxToolCalls === 0) {
        assert.equal(exitCode, 55);
        assert.equal(result.budgetReported, true);
      }
    }
    return result;
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
}
async function runCurrentRouter(kind, model = "fixture", acpModelOptions) {
  await fs.rm(writePath, { force: true });
  const inheritedSystem = path.join(temporary, "inherited-system.md");
  const inheritedDump = path.join(temporary, "MUST-NOT-DUMP-SYSTEM.md");
  await fs.writeFile(inheritedSystem, inheritedSystemMarker);
  await fs.rm(inheritedDump, { force: true });
  const worker = path.join(temporary, "current-router-worker.mjs");
  await fs.writeFile(
    worker,
    `
import {routeWithQwen} from ${JSON.stringify(pathToFileURL(routerModule).href)};
let attempts = 0;
const profile = await routeWithQwen({
  currentProfileId: "analyst", project: {id:"p",name:"fixture",directory:"project"},
  task:{id:"t",title:"Review",description:"Review current behavior"},
  request:"Review current changes",history:[],
  profiles:["analyst","reviewer"].map(id=>({id,name:id,description:id}))
}, {
  executable: ${JSON.stringify(cli)}, model:${JSON.stringify(model)},
  acpModelOptions:${JSON.stringify(acpModelOptions)},
  authArgs:["--auth-type","openai","--openai-api-key","fixture-local-only","--openai-base-url",${JSON.stringify(endpoint)}],
  signal: AbortSignal.timeout(25000), onAttempt:()=>{attempts++;}
});
process.stdout.write(JSON.stringify({attempts,profileId:profile.profileId,confidence:profile.confidence}));
`,
  );
  current = {
    kind,
    requests: 0,
    projectContextLoaded: false,
    writeToolAdvertised: false,
    structuredOutputAdvertised: false,
    dedicatedSystemObserved: false,
    inheritedSystemObserved: false,
    declaredToolNames: [],
  };
  const child = spawn(process.execPath, [worker], {
    cwd,
    env: {
      ...env,
      QWEN_SYSTEM_MD: inheritedSystem,
      QWEN_WRITE_SYSTEM_MD: inheritedDump,
      GIGACODE_SYSTEM_MD: inheritedSystem,
      GIGACODE_WRITE_SYSTEM_MD: inheritedDump,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    assert.equal(
      exitCode,
      0,
      `Controlled current router failed: ${stderr.slice(-1000)}`,
    );
    assert.equal(current.failure, undefined);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.profileId, "reviewer");
    assert.equal(parsed.attempts, 2);
    assert.equal(current.requests, 2);
    assert.equal(current.inheritedSystemObserved, false);
    assert.equal(current.dedicatedSystemObserved, true);
    assert.equal(current.projectContextLoaded, false);
    const excluded = [
      "glob",
      "grep_search",
      "read_file",
      "skill",
      "tool_call",
      "tool_search",
    ];
    assert.ok(
      current.declaredToolNames.every((names) =>
        excluded.every((name) => !names.includes(name)),
      ),
    );
    assert.ok(
      current.declaredToolNames.every(
        (names) => !names.includes("structured_output"),
      ),
    );
    assert.equal(await exists(writePath), false);
    assert.equal(await exists(mcpPath), false);
    assert.equal(await exists(inheritedDump), false);
    if (kind.startsWith("route_tool_flag"))
      assert.deepEqual(current.providerModelIds, [
        "--max-tool-calls=1",
        "--max-tool-calls=1",
      ]);
    return {
      ...current,
      exitCode,
      attempts: parsed.attempts,
      parsedRoleId: parsed.profileId,
      writeOccurred: false,
      mcpStarted: false,
      inheritedSystemDumpCreated: false,
      currentRouterSourceSha256,
      toolDeclarationsRemoved: current.declaredToolNames.every(
        (names) => names.length === 0,
      ),
      note: "Actual current routeWithQwen in a separately spawned worker with isolated environment; first invalid/tool response repaired by a second classifier-only attempt. No executor task replay.",
    };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
}
try {
  const scenarios = [
    await run("plain", 0),
    await run("tool", 0),
    await run("tool", 1),
    await run("structured", 0),
    await run("mixed", 0),
    await runCurrentRouter("route_invalid_json"),
    await runCurrentRouter("route_invalid_role"),
    await runCurrentRouter("route_tool"),
    await runCurrentRouter("route_tool_flag_model", "--max-tool-calls=1"),
    await runCurrentRouter(
      "route_tool_flag_acp_model",
      "--max-tool-calls=1(openai)",
      ["--max-tool-calls=1(openai)"],
    ),
    await run("tool_less_wildcard", 0),
    await run("tool_less_explicit18", 0),
    await run("tool_less_explicit22", 0),
  ];
  const report = {
    createdAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      qwen: packageMetadata.version,
    },
    transport:
      "Controlled loopback OpenAI SSE fixture; no real LLM or external provider calls",
    scope:
      "Actual headless Qwen safe-mode isolation and ordinary-tool budget; exploratory pure structured_output exception; actual current routeWithQwen with dedicated classifier system, six eager tools denied, host JSON validation and bounded classifier retry. No routing-quality, GigaCode-compatibility, or ACP-executor-binding claim.",
    currentRouterSourceSha256,
    excluded22Status:
      "Exploratory alternative: removes provider tool declarations in this fixture, but not the selected runtime; separate live-model evaluation rejected it for worse routing behavior.",
    scenarios,
    sensitiveNegativeControl:
      "With the same malicious tool response and a budget of one, write_file creates the controlled sentinel; zero blocks it before execution.",
    cleanup:
      "Owned temporary CLI home, runtime, project, sentinel files and fixture listener removed in finally",
  };
  const destination = path.resolve(
    app,
    "../docs/suite/evidence/agent-runtime-qwen/offline-router.json",
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
