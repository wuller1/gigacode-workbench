import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { AcpConnection } from "../electron/acp.js";
import { discoverPromptCapability } from "../electron/prompt-binding.js";
import {
  contextModelKey,
  resolveContextEnvelope,
  createContextSupervisor,
  observeContext,
  contextDecision,
  parseReviewedQwenCompaction,
  parseReviewedQwenContextUsage,
  buildContextRecoveryPacket,
} from "../electron/context-supervisor.js";

const identity = {
  provider: "corporate-gateway",
  model: "flash",
  endpointKey: "endpoint-fingerprint",
  reasoning: "high",
};
const envelope = () =>
  resolveContextEnvelope({ identity, configuredLimitTokens: 256000 });
const usage = (usedTokens: number, at = 1) => ({
  kind: "usage" as const,
  id: `usage-${at}`,
  at,
  usedTokens,
  estimated: false,
  basis: "cli_context" as const,
});
const state = () => createContextSupervisor(contextModelKey(identity), 1);

describe("flash context envelope and loop supervisor", () => {
  it("keeps a 64k/96k working set under a 256k window and separates reserves", () => {
    const e = envelope();
    expect(e).toMatchObject({
      effectiveLimitTokens: 256000,
      highWaterTokens: 96000,
      lowWaterTokens: 64000,
      fullContextVerified: false,
    });
    expect(
      e.outputReserveTokens + e.safetyReserveTokens + e.promptBudgetTokens,
    ).toBe(256000);
    expect(e.recoveryPacketBudgetBytes).toBeLessThan(e.lowWaterTokens);
  });
  it("does not borrow limits from the same model behind another endpoint/provider/reasoning route", () => {
    const original = contextModelKey(identity);
    for (const altered of [
      { ...identity, provider: "another" },
      { ...identity, endpointKey: "another" },
      { ...identity, reasoning: "none" },
    ])
      expect(contextModelKey(altered)).not.toBe(original);
    const e = resolveContextEnvelope({
      identity,
      evidence: [
        {
          modelKey: "a".repeat(64),
          kind: "structured_token_limit",
          tokens: 4096,
          at: 1,
          reference: "foreign",
        },
      ],
    });
    expect(e.effectiveLimitTokens).toBe(256000);
  });
  it("acceptance is only a lower bound; structured rejection and multi-location recall are distinct evidence", () => {
    const modelKey = contextModelKey(identity);
    const accepted = {
      modelKey,
      kind: "accepted_request" as const,
      tokens: 100000,
      at: 1,
      reference: "accepted",
    };
    expect(
      resolveContextEnvelope({ identity, evidence: [accepted] }),
    ).toMatchObject({
      effectiveLimitTokens: 256000,
      observedAcceptedTokens: 100000,
    });
    expect(
      resolveContextEnvelope({
        identity,
        evidence: [
          accepted,
          { ...accepted, kind: "verified_recall", tokens: 120000 },
        ],
      }),
    ).toMatchObject({
      effectiveLimitTokens: 256000,
      observedRecallTokens: 120000,
      fullContextVerified: false,
    });
    expect(
      resolveContextEnvelope({
        identity,
        evidence: [
          accepted,
          { ...accepted, kind: "structured_token_limit", tokens: 90000 },
        ],
      }),
    ).toMatchObject({
      effectiveLimitTokens: 89999,
      structuredRejectedTokens: 90000,
    });
  });
  it("uses conservative lower CLI/configured declarations and validates overrides", () => {
    const e = resolveContextEnvelope({
      identity,
      configuredLimitTokens: 256000,
      cliLimitTokens: 128000,
      declaredLimitTokens: 512000,
    });
    expect(e).toMatchObject({
      effectiveLimitTokens: 128000,
      limitBasis: "cli_reported",
    });
    expect(e.highWaterTokens).toBeLessThan(e.promptBudgetTokens);
    expect(() =>
      resolveContextEnvelope({ identity, configuredLimitTokens: NaN }),
    ).toThrow();
    expect(() =>
      resolveContextEnvelope({
        identity,
        highWaterTokens: 4096,
        lowWaterTokens: 8000,
      }),
    ).toThrow();
  });
  it("detects the real reported 227414→203202 ineffective cycle and waits for a clean boundary", () => {
    let s = state();
    for (const at of [1000, 2000])
      s = observeContext(s, {
        kind: "compaction",
        id: `compact-${at}`,
        at,
        beforeTokens: 227414,
        afterTokens: 203202,
        estimated: false,
        basis: "reviewed_qwen_diagnostic",
      });
    expect(
      contextDecision(s, envelope(), { now: 2000, cleanEndTurn: false }),
    ).toMatchObject({
      action: "defer_until_boundary",
      reason: "ineffective_compaction_loop",
      poorCompactions: 2,
      targetTokens: 64000,
    });
    expect(
      contextDecision(s, envelope(), { now: 2000, cleanEndTurn: true }),
    ).toMatchObject({ action: "rotate_at_boundary" });
    expect(
      contextDecision(s, envelope(), {
        now: 2000,
        cleanEndTurn: true,
        unknownOutcome: true,
      }),
    ).toMatchObject({ action: "hold_unknown", reason: "unknown_effects" });
  });
  it("does not interrupt tools/questions or claim that ordinary output is context progress", () => {
    const s = observeContext(state(), usage(96000));
    for (const pending of [{ pendingTools: true }, { waitingQuestions: true }])
      expect(
        contextDecision(s, envelope(), {
          now: 1,
          cleanEndTurn: true,
          ...pending,
        }).action,
      ).toBe("defer_until_boundary");
    expect(
      contextDecision(s, envelope(), { now: 1, cleanEndTurn: true }).action,
    ).toBe("rotate_at_boundary");
  });
  it("ignores duplicate/late telemetry, bounds retained observations and resets on a new generation", () => {
    let s = state();
    for (let at = 1; at <= 100; at++)
      s = observeContext(s, usage(at * 1000, at));
    expect(s.observations).toHaveLength(24);
    expect(observeContext(s, usage(1, 100))).toBe(s);
    expect(observeContext(s, usage(1, 3))).toBe(s);
    expect(s.latestUsage?.usedTokens).toBe(100000);
    expect(createContextSupervisor(s.modelKey, 2).observations).toEqual([]);
  });
  it("keeps unknown usage unknown and considers the next bounded input before dispatch", () => {
    expect(
      contextDecision(state(), envelope(), { now: 1, cleanEndTurn: true }),
    ).toMatchObject({ action: "continue", estimated: true });
    expect(
      contextDecision(observeContext(state(), usage(95000)), envelope(), {
        now: 1,
        cleanEndTurn: true,
        nextPromptEstimatedTokens: 2000,
      }),
    ).toMatchObject({
      action: "rotate_at_boundary",
      projectedTokens: 97000,
      estimated: true,
    });
  });
  it("holds a single oversized input even with no usage instead of rotating endlessly into the same request", () => {
    const decision = contextDecision(state(), envelope(), {
      now: 1,
      cleanEndTurn: true,
      nextPromptEstimatedTokens: 100000,
    });
    expect(decision).toMatchObject({
      action: "hold_input",
      reason: "single_input_exceeds_budget",
      projectedTokens: 100000,
      estimated: true,
    });
    expect(decision.usedTokens).toBeUndefined();
    expect(
      contextDecision(observeContext(state(), usage(10000)), envelope(), {
        now: 1,
        cleanEndTurn: true,
        nextPromptEstimatedTokens: 100000,
      }).action,
    ).toBe("hold_input");
    expect(
      contextDecision(state(), envelope(), {
        now: 1,
        cleanEndTurn: true,
        nextPromptEstimatedTokens: 100000,
        unknownOutcome: true,
      }).action,
    ).toBe("hold_unknown");
  });
  it("recognizes only the reviewed diagnostic format and retains estimate markers", () => {
    const text =
      "IMPORTANT: This conversation approached the input token limit for flash. A compressed context will be sent for future messages (compressed from: 227414 to 203202 tokens).";
    expect(parseReviewedQwenCompaction(text)).toEqual({
      beforeTokens: 227414,
      afterTokens: 203202,
      estimated: false,
    });
    expect(
      parseReviewedQwenCompaction(text.replace("227414", "~227414"))?.estimated,
    ).toBe(true);
    expect(
      parseReviewedQwenCompaction("compressed from: 227414 to 203202 tokens"),
    ).toBeUndefined();
    expect(
      parseReviewedQwenCompaction(text.replace("203202", "99999999999")),
    ).toBeUndefined();
  });
  it("does not claim a pre-request Qwen total=0 estimate means an empty context", () => {
    const base = {
      v: 1,
      sessionId: "remote",
      usage: {
        modelName: "flash",
        totalTokens: 0,
        contextWindowSize: 256000,
        isEstimated: true,
        breakdown: { systemPrompt: 5000, builtinTools: 4000 },
      },
    };
    expect(parseReviewedQwenContextUsage(base, "remote")).toMatchObject({
      estimated: true,
      limitTokens: 256000,
      breakdown: { systemPrompt: 5000 },
    });
    expect(
      parseReviewedQwenContextUsage(base, "remote").usedTokens,
    ).toBeUndefined();
    expect(() => parseReviewedQwenContextUsage(base, "wrong")).toThrow();
    expect(() =>
      parseReviewedQwenContextUsage(
        { ...base, usage: { ...base.usage, breakdown: { messages: -1 } } },
        "remote",
      ),
    ).toThrow();
  });
  it("session-binds the read-only extension and never issues a prompt or compaction command", async () => {
    const connection = new AcpConnection({
      executable: process.execPath,
      args: [],
      cwd: process.cwd(),
    });
    (connection as any).ownedSession = "remote";
    const request = vi.spyOn(connection, "request").mockResolvedValue({
      v: 1,
      sessionId: "remote",
      usage: {
        modelName: "flash",
        totalTokens: 100,
        contextWindowSize: 256000,
        isEstimated: false,
        breakdown: {},
      },
    });
    await expect(connection.getContextUsage("other")).rejects.toThrow(
      "Wrong ACP session",
    );
    expect(request).not.toHaveBeenCalled();
    expect(await connection.getContextUsage("remote")).toMatchObject({
      usedTokens: 100,
      estimated: false,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "qwen/status/session/context_usage",
      { sessionId: "remote", detail: false },
      5000,
      undefined,
    );
  });
  it("reads actual unchanged Qwen 0.25.1 context without a model/provider request", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "context-native-qwen-"),
    );
    const home = path.join(root, "home");
    await fs.mkdir(home);
    let providerRequests = 0;
    const provider = createServer((_req, res) => {
      providerRequests++;
      res.writeHead(503).end();
    });
    await new Promise<void>((resolve) =>
      provider.listen(0, "127.0.0.1", resolve),
    );
    const executable = fileURLToPath(
      new URL("../node_modules/@qwen-code/qwen-code/cli.js", import.meta.url),
    );
    let connection: AcpConnection | undefined;
    let ownedChild:
      import("node:child_process").ChildProcessWithoutNullStreams | undefined;
    let childClosed: Promise<void> | undefined;
    try {
      const capability = await discoverPromptCapability({ executable });
      expect(capability.support).toBe("source_verified");
      await fs.writeFile(path.join(root, "system.json"), "{}");
      await fs.writeFile(
        path.join(home, "settings.json"),
        JSON.stringify({
          security: { auth: { selectedType: "openai" } },
          model: { name: "owned-context-proof" },
          modelProviders: {
            openai: [
              {
                id: "owned-context-proof",
                baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
                envKey: "OPENAI_API_KEY",
                contextWindowSize: 256000,
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
          /OPENAI|OPENROUTER|ANTHROPIC|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$|^(https?|all|no)_proxy$/i.test(
            key,
          )
        )
          delete env[key];
      Object.assign(env, {
        QWEN_HOME: home,
        QWEN_RUNTIME_DIR: path.join(home, "runtime"),
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(root, "system.json"),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(root, "system.json"),
        OPENAI_API_KEY: "owned-loopback-only",
        QWEN_CODE_DISABLE_CRON: "1",
        QWEN_CODE_MEMORY_TEAM: "0",
        QWEN_CODE_MEMORY_TEAM_SYNC: "0",
        NO_PROXY: "127.0.0.1,localhost",
      });
      connection = new AcpConnection({
        executable,
        args: ["--acp", "--auth-type", "openai", "--no-chat-recording"],
        cwd: root,
        env,
      });
      const starting = connection.start();
      // start() spawns synchronously. Observe close before awaiting initialize,
      // including a failed startup; dispose's bounded stop is not a close event.
      ownedChild = (connection as any).child;
      if (ownedChild)
        childClosed = new Promise<void>((resolve) =>
          ownedChild!.once("close", () => resolve()),
        );
      await starting;
      const created = await connection.newSession({
        cwd: root,
        mcpServers: [],
      });
      const read = await connection.getContextUsage(created.sessionId);
      expect(read).toMatchObject({
        model: "owned-context-proof",
        basis: "reviewed_qwen_context_usage",
        estimated: true,
      });
      expect(read.usedTokens).toBeUndefined();
      expect(read.limitTokens).toBeGreaterThan(0);
      expect(read.breakdown.systemPrompt).toBeGreaterThan(0);
      expect(providerRequests).toBe(0);
    } finally {
      try {
        await connection?.dispose();
        if (childClosed) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              childClosed,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error("Owned Qwen process close was not confirmed."),
                    ),
                  5000,
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
          expect(
            ownedChild!.exitCode !== null || ownedChild!.signalCode !== null,
          ).toBe(true);
        }
      } finally {
        provider.closeAllConnections();
        await new Promise<void>((resolve) => provider.close(() => resolve()));
      }
      // Only after confirmed child close: Windows can briefly retain filesystem
      // handles while the OS finishes teardown. Bound those owned-temp retries.
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }, 30000);
});

describe("bounded context recovery packet", () => {
  const input = () => ({
    taskId: "task-1",
    sessionId: "session-1",
    generation: 3,
    goal: "Implement the accepted behavior.",
    instructionsReference: "instruction_snapshot:sha",
    historyReference: "task_history:task-1",
    facts: [{ text: "API returns 429 HTML.", reference: "receipt:1" }],
    decisions: [
      { text: "Do not replay unknown POST.", reference: "decision:1" },
    ],
    plan: [
      {
        text: "Reconcile remote write",
        status: "in_progress" as const,
        reference: "todo:1",
      },
    ],
    toolOutcomes: [
      {
        operationId: "mutation-1",
        status: "unknown" as const,
        text: "No reply",
        reference: "receipt:unknown",
      },
    ],
    artifactReferences: ["artifact:report"],
  });
  it("preserves the accepted goal, source references, unresolved writes and current plan without fabricating a user turn", () => {
    const packet = buildContextRecoveryPacket(input());
    expect(packet.requiresReconciliation).toBe(true);
    for (const phrase of [
      "not new authorization or a human message",
      "Implement the accepted behavior",
      "UNKNOWN mutation-1",
      "receipt:unknown",
      "Plan in_progress",
      "task_history:task-1",
      "instruction_snapshot:sha",
    ])
      expect(packet.text).toContain(phrase);
    expect(buildContextRecoveryPacket(input()).sha256).toBe(packet.sha256);
  });
  it("bounds huge evidence in bytes, gives unknown references priority and leaves full data in durable history", () => {
    const packet = buildContextRecoveryPacket(
      {
        ...input(),
        facts: Array.from({ length: 1000 }, (_, i) => ({
          text: "界".repeat(4000),
          reference: `fact:${i}`,
        })),
      },
      4096,
    );
    expect(packet.bytes).toBeLessThanOrEqual(4096);
    expect(packet.omittedItems).toBeGreaterThan(0);
    expect(packet.text).toContain("UNKNOWN mutation-1");
    expect(packet.text).toContain("read linked durable history");
  });
  it("refuses an undersized mandatory packet instead of silently losing context", () => {
    expect(() =>
      buildContextRecoveryPacket(
        {
          ...input(),
          historyReference: "界".repeat(1000),
          instructionsReference: "界".repeat(1000),
        },
        2048,
      ),
    ).toThrow("Mandatory context references");
    expect(() => buildContextRecoveryPacket(input(), 100)).toThrow();
  });
});
