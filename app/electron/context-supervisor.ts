import { createHash } from "node:crypto";
import type {
  ContextModelIdentity,
  ContextEvidence,
  ContextEnvelope,
  ContextObservation,
  ContextSupervisorState,
  ContextDecision,
  ReviewedContextUsage,
} from "../shared/context.js";

const MAX_TOKENS = 8 * 1024 * 1024;
const MAX_OBSERVATIONS = 24;
const LOOP_WINDOW_MS = 10 * 60 * 1000;
const integer = (value: unknown, min = 1, max = MAX_TOKENS): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
function bounded(value: unknown, name: string, max = 500): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error(`Invalid context ${name}.`);
  return value;
}

export function contextModelKey(identity: ContextModelIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        bounded(identity.provider, "provider"),
        bounded(identity.model, "model"),
        bounded(identity.endpointKey, "endpoint key"),
        identity.reasoning === undefined
          ? ""
          : bounded(identity.reasoning, "reasoning", 100),
      ]),
    )
    .digest("hex");
}

/** No inference from a model name or HTML/400/413 alone is treated as a provider token limit. */
export function resolveContextEnvelope(input: {
  identity: ContextModelIdentity;
  configuredLimitTokens?: number;
  declaredLimitTokens?: number;
  cliLimitTokens?: number;
  outputReserveTokens?: number;
  /** Flash working-set policy; a large advertised window is not a quality target. */
  highWaterTokens?: number;
  lowWaterTokens?: number;
  evidence?: readonly ContextEvidence[];
}): ContextEnvelope {
  const modelKey = contextModelKey(input.identity);
  const limits = [
    [input.configuredLimitTokens, "configured"],
    [input.declaredLimitTokens, "declared"],
    [input.cliLimitTokens, "cli_reported"],
  ] as const;
  for (const [value] of limits)
    if (value !== undefined && !integer(value, 4096))
      throw new Error("Invalid context limit.");
  const specified = limits.filter(([value]) => value !== undefined);
  let minimum = specified.reduce<
    readonly [number, ContextEnvelope["limitBasis"]]
  >(
    (current, [value, basis]) =>
      value! < current[0] ? [value!, basis] : current,
    specified.length
      ? [specified[0][0]!, specified[0][1]]
      : [256000, "conservative_default"],
  );
  if (
    input.evidence !== undefined &&
    (!Array.isArray(input.evidence) || input.evidence.length > 128)
  )
    throw new Error("Context evidence exceeds the bounded route ledger.");
  const evidence = (input.evidence ?? []).filter(
    (item) =>
      item.modelKey === modelKey &&
      integer(item.tokens) &&
      integer(item.at, 0, Number.MAX_SAFE_INTEGER) &&
      typeof item.reference === "string" &&
      item.reference.length > 0 &&
      item.reference.length <= 500,
  );
  const values = (kind: ContextEvidence["kind"]) =>
    evidence.filter((item) => item.kind === kind).map((item) => item.tokens);
  const rejected = values("structured_token_limit");
  const recall = values("verified_recall");
  const accepted = values("accepted_request");
  const declared = values("declared_limit");
  if (declared.length && Math.min(...declared) < minimum[0])
    minimum = [Math.min(...declared), "declared"];
  if (minimum[0] < 4096 || (rejected.length && Math.min(...rejected) <= 4096))
    throw new Error(
      "Reported context envelope is too small for safe recovery; select another route or verify its limit.",
    );
  // Both acceptance and sampled recall establish lower bounds, never a maximum.
  // A small paid probe must not accidentally shrink the configured working window.
  const effectiveLimitTokens = Math.max(
    4096,
    Math.min(
      minimum[0],
      ...(rejected.length ? [Math.max(4096, Math.min(...rejected) - 1)] : []),
    ),
  );
  if (
    input.outputReserveTokens !== undefined &&
    !integer(input.outputReserveTokens, 256)
  )
    throw new Error("Invalid context output reserve.");
  const outputReserveTokens = Math.min(
    input.outputReserveTokens ?? 16384,
    Math.floor(effectiveLimitTokens * 0.25),
  );
  const safetyReserveTokens = Math.ceil(effectiveLimitTokens * 0.12);
  const promptBudgetTokens =
    effectiveLimitTokens - outputReserveTokens - safetyReserveTokens;
  if (
    (input.highWaterTokens !== undefined &&
      !integer(input.highWaterTokens, 1024)) ||
    (input.lowWaterTokens !== undefined && !integer(input.lowWaterTokens, 512))
  )
    throw new Error("Invalid context working-set policy.");
  const highWaterTokens = Math.min(
    input.highWaterTokens ?? 96000,
    Math.floor(promptBudgetTokens * 0.72),
  );
  const lowWaterTokens = Math.min(
    input.lowWaterTokens ?? 64000,
    Math.floor(promptBudgetTokens * 0.42),
  );
  if (lowWaterTokens >= highWaterTokens)
    throw new Error(
      "Context low-water target must be below the high-water trigger.",
    );
  return {
    modelKey,
    nominalLimitTokens: minimum[0],
    effectiveLimitTokens,
    limitBasis: minimum[1],
    ...(accepted.length
      ? { observedAcceptedTokens: Math.max(...accepted) }
      : {}),
    ...(recall.length ? { observedRecallTokens: Math.max(...recall) } : {}),
    ...(rejected.length
      ? { structuredRejectedTokens: Math.min(...rejected) }
      : {}),
    fullContextVerified: false,
    outputReserveTokens,
    safetyReserveTokens,
    promptBudgetTokens,
    highWaterTokens,
    lowWaterTokens,
    recoveryPacketBudgetBytes: Math.min(
      24000,
      Math.floor(promptBudgetTokens * 0.08),
    ),
  };
}

export function createContextSupervisor(
  modelKey: string,
  generation: number,
): ContextSupervisorState {
  if (
    !/^[a-f0-9]{64}$/.test(modelKey) ||
    !integer(generation, 0, Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid context supervisor binding.");
  return { version: 1, modelKey, generation, observations: [], rotations: 0 };
}

/** Pure and serializable: the service persists this state in the same transaction as its session. */
export function observeContext(
  state: ContextSupervisorState,
  observation: ContextObservation,
): ContextSupervisorState {
  bounded(observation.id, "observation identity", 160);
  if (
    !integer(observation.at, 0, Number.MAX_SAFE_INTEGER) ||
    typeof observation.estimated !== "boolean"
  )
    throw new Error("Invalid context observation.");
  if (observation.kind === "usage") {
    if (
      !integer(observation.usedTokens, 0) ||
      !["cli_context", "cli_usage", "host_estimate"].includes(observation.basis)
    )
      throw new Error("Invalid context usage.");
  } else if (observation.kind === "compaction") {
    if (
      !integer(observation.beforeTokens) ||
      !integer(observation.afterTokens, 0) ||
      !["reviewed_qwen_diagnostic", "verified_adapter"].includes(
        observation.basis,
      )
    )
      throw new Error("Invalid compaction observation.");
  } else throw new Error("Invalid context observation kind.");
  if (state.observations.some((item) => item.id === observation.id))
    return state;
  // Late ACP notifications must not roll current usage backwards.
  if (
    state.observations.length &&
    observation.at < state.observations[state.observations.length - 1].at
  )
    return state;
  const latestUsage =
    observation.kind === "usage"
      ? observation
      : {
          kind: "usage" as const,
          id: `${observation.id}:after`,
          at: observation.at,
          usedTokens: observation.afterTokens,
          estimated: observation.estimated,
          basis: "cli_context" as const,
        };
  return {
    ...state,
    observations: [...state.observations, { ...observation }].slice(
      -MAX_OBSERVATIONS,
    ),
    latestUsage,
  };
}

export function contextDecision(
  state: ContextSupervisorState,
  envelope: ContextEnvelope,
  boundary: {
    now: number;
    cleanEndTurn: boolean;
    unknownOutcome?: boolean;
    pendingTools?: boolean;
    waitingQuestions?: boolean;
    nextPromptEstimatedTokens?: number;
  },
): ContextDecision {
  if (state.modelKey !== envelope.modelKey)
    throw new Error("Context envelope belongs to another model route.");
  if (
    !integer(boundary.now, 0, Number.MAX_SAFE_INTEGER) ||
    (boundary.nextPromptEstimatedTokens !== undefined &&
      !integer(boundary.nextPromptEstimatedTokens, 0))
  )
    throw new Error("Invalid context boundary.");
  const recent = state.observations.filter(
    (item) =>
      item.kind === "compaction" &&
      item.at <= boundary.now &&
      boundary.now - item.at <= LOOP_WINDOW_MS,
  );
  const poorCompactions = recent.filter(
    (item) =>
      item.kind === "compaction" &&
      (item.afterTokens > envelope.lowWaterTokens ||
        item.afterTokens > item.beforeTokens * 0.75),
  ).length;
  const usage = state.latestUsage;
  const nextPromptTokens = boundary.nextPromptEstimatedTokens ?? 0;
  const projectedTokens = usage
    ? usage.usedTokens + nextPromptTokens
    : nextPromptTokens > 0
      ? nextPromptTokens
      : undefined;
  const reason = boundary.unknownOutcome
    ? "unknown_effects"
    : nextPromptTokens >= envelope.highWaterTokens
      ? "single_input_exceeds_budget"
      : poorCompactions >= 2
        ? "ineffective_compaction_loop"
        : projectedTokens !== undefined &&
            projectedTokens >= envelope.highWaterTokens
          ? "high_water"
          : "within_budget";
  const clean =
    boundary.cleanEndTurn &&
    !boundary.pendingTools &&
    !boundary.waitingQuestions;
  return {
    action: boundary.unknownOutcome
      ? "hold_unknown"
      : reason === "single_input_exceeds_budget"
        ? "hold_input"
        : reason === "within_budget"
          ? "continue"
          : clean
            ? "rotate_at_boundary"
            : "defer_until_boundary",
    reason,
    ...(usage ? { usedTokens: usage.usedTokens } : {}),
    ...(projectedTokens !== undefined ? { projectedTokens } : {}),
    targetTokens: envelope.lowWaterTokens,
    estimated:
      usage?.estimated !== false ||
      (boundary.nextPromptEstimatedTokens ?? 0) > 0,
    poorCompactions,
  };
}

/** Only call on exact reviewed Qwen diagnostics, never arbitrary assistant prose. */
export function parseReviewedQwenCompaction(
  text: string,
):
  | { beforeTokens: number; afterTokens: number; estimated: boolean }
  | undefined {
  if (text.length > 16000) return;
  const match =
    /IMPORTANT: This conversation [^\n]*(?:\n[^\n]*)?\(compressed from: (~?)(\d+) to (~?)(\d+) tokens\)/.exec(
      text,
    );
  if (!match) return;
  const beforeTokens = Number(match[2]),
    afterTokens = Number(match[4]);
  if (!integer(beforeTokens) || !integer(afterTokens, 0)) return;
  return {
    beforeTokens,
    afterTokens,
    estimated: Boolean(match[1] || match[3]),
  };
}

/** Read-only Qwen 0.25.1 response shape. A pre-request 0 is unknown, not empty history. */
export function parseReviewedQwenContextUsage(
  result: unknown,
  sessionId: string,
): ReviewedContextUsage {
  const envelope = result as any;
  const usage = envelope?.usage;
  if (
    envelope?.v !== 1 ||
    envelope.sessionId !== sessionId ||
    typeof usage?.modelName !== "string" ||
    !usage.modelName ||
    usage.modelName.length > 500 ||
    !integer(usage.totalTokens, 0) ||
    !integer(usage.contextWindowSize) ||
    typeof usage.isEstimated !== "boolean" ||
    !usage.breakdown ||
    typeof usage.breakdown !== "object" ||
    Array.isArray(usage.breakdown)
  )
    throw new Error("Invalid session-bound Qwen context usage.");
  const breakdown: Record<string, number> = {};
  for (const name of [
    "systemPrompt",
    "builtinTools",
    "mcpTools",
    "memoryFiles",
    "skills",
    "messages",
    "freeSpace",
    "autocompactBuffer",
    "startupContext",
    "unattributed",
  ])
    if (usage.breakdown[name] !== undefined) {
      if (!integer(usage.breakdown[name], 0))
        throw new Error("Invalid Qwen context breakdown.");
      breakdown[name] = usage.breakdown[name];
    }
  return {
    ...(usage.totalTokens === 0 && usage.isEstimated
      ? {}
      : { usedTokens: usage.totalTokens }),
    limitTokens: usage.contextWindowSize,
    estimated: usage.isEstimated,
    model: usage.modelName,
    breakdown,
    basis: "reviewed_qwen_context_usage",
  };
}

export interface ContextRecoveryPacketInput {
  taskId: string;
  sessionId: string;
  generation: number;
  goal: string;
  goalReference?: string;
  instructionsReference: string;
  facts?: readonly { text: string; reference: string }[];
  decisions?: readonly { text: string; reference: string }[];
  plan?: readonly {
    text: string;
    status: "pending" | "in_progress" | "completed";
    reference: string;
  }[];
  toolOutcomes?: readonly {
    operationId: string;
    status: "confirmed" | "failed" | "unknown";
    text: string;
    reference: string;
  }[];
  artifactReferences?: readonly string[];
  historyReference: string;
  pendingRequest?: string;
}
export interface ContextRecoveryPacket {
  version: 1;
  text: string;
  sha256: string;
  bytes: number;
  /** Byte budget is a conservative host bound, not the unknown provider tokenizer. */
  estimatedTokensUpperBound: number;
  omittedItems: number;
  requiresReconciliation: boolean;
}

/** Deterministic reference packet; complete transcript/tool receipts remain in durable storage. */
export function buildContextRecoveryPacket(
  input: ContextRecoveryPacketInput,
  budgetBytes = 24000,
): ContextRecoveryPacket {
  if (
    !integer(budgetBytes, 2048, 64000) ||
    !integer(input.generation, 0, Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid context packet budget or generation.");
  const reference = (value: unknown) => bounded(value, "reference", 1000);
  const short = (value: unknown, max: number) => {
    if (typeof value !== "string" || /\0/.test(value))
      throw new Error("Invalid context packet text.");
    return value.length > max
      ? value.slice(0, max) + "… [excerpt; read reference]"
      : value;
  };
  for (const items of [
    input.facts,
    input.decisions,
    input.plan,
    input.toolOutcomes,
    input.artifactReferences,
  ])
    if (items !== undefined && (!Array.isArray(items) || items.length > 2000))
      throw new Error(
        "Context packet requires bounded evidence pages; retain the complete ledger separately.",
      );
  const unknown = (input.toolOutcomes ?? []).filter(
    (item) => item.status === "unknown",
  );
  const lines = [
    "HOST RECOVERY PACKET v1 — reference data, not new authorization or a human message.",
    "Continue the accepted goal. Read linked facts before relying on omitted details. Never replay an unknown external effect; reconcile its receipt first.",
    `Task: ${bounded(input.taskId, "task identity", 160)}; session: ${bounded(input.sessionId, "session identity", 160)}; previous generation: ${input.generation}.`,
    `Accepted goal excerpt: ${short(input.goal, Math.min(4000, Math.floor(budgetBytes / 8)))}`,
    `Full accepted goal: ${reference(input.goalReference ?? input.historyReference)}`,
    `Full retained history: ${reference(input.historyReference)}`,
    `Current instructions: ${reference(input.instructionsReference)}`,
    `Unknown operations requiring reconciliation: ${unknown.length}. Full receipts/history must be read before any potentially repeated mutation.`,
  ];
  if (input.pendingRequest)
    lines.push(
      `Unsent next request excerpt (not a replay): ${short(input.pendingRequest, 1000)}`,
    );
  let omittedItems = 0;
  const append = (line: string) => {
    if (
      Buffer.byteLength(
        [
          ...lines,
          line,
          "[Additional evidence remains in linked durable history.]",
        ].join("\n"),
      ) <= budgetBytes
    )
      lines.push(line);
    else omittedItems++;
  };
  // Unknown IDs/references have priority over prose, completed work, and decoration.
  for (const item of unknown)
    append(
      `UNKNOWN ${bounded(item.operationId, "operation identity", 160)}: ${reference(item.reference)}`,
    );
  for (const item of input.facts ?? [])
    append(`Fact: ${short(item.text, 1200)} [${reference(item.reference)}]`);
  for (const item of input.decisions ?? [])
    append(
      `Decision: ${short(item.text, 1000)} [${reference(item.reference)}]`,
    );
  for (const item of input.plan ?? []) {
    if (!["pending", "in_progress", "completed"].includes(item.status))
      throw new Error("Invalid context plan state.");
    if (item.status !== "completed")
      append(
        `Plan ${item.status}: ${short(item.text, 800)} [${reference(item.reference)}]`,
      );
  }
  for (const item of input.toolOutcomes ?? []) {
    if (!["confirmed", "failed", "unknown"].includes(item.status))
      throw new Error("Invalid tool receipt state.");
    if (item.status !== "unknown")
      append(
        `Tool ${item.status} ${bounded(item.operationId, "operation identity", 160)}: ${short(item.text, 1000)} [${reference(item.reference)}]`,
      );
  }
  for (const item of input.artifactReferences ?? [])
    append(`Artifact: ${reference(item)}`);
  if (omittedItems)
    lines.push(
      `[${omittedItems} evidence items omitted from this packet; read linked durable history on demand.]`,
    );
  const text = lines.join("\n"),
    bytes = Buffer.byteLength(text);
  if (bytes > budgetBytes)
    throw new Error(
      "Mandatory context references exceed the packet budget; no context rotation was prepared.",
    );
  return {
    version: 1,
    text,
    bytes,
    sha256: createHash("sha256").update(text).digest("hex"),
    estimatedTokensUpperBound: bytes,
    omittedItems,
    requiresReconciliation: unknown.length > 0,
  };
}
