import { createHash } from "node:crypto";
import type { AppState, Session } from "../shared/types";
import type {
  ContextDecision,
  ContextEnvelope,
  ContextEvidence,
  ContextSupervisorState,
  ContextUsageObservation,
} from "../shared/context";
import {
  buildContextRecoveryPacket,
  contextDecision,
  createContextSupervisor,
  resolveContextEnvelope,
  observeContext,
} from "./context-supervisor";

export interface RuntimeContextPolicy {
  enabled: boolean;
  highWaterTokens: number;
  lowWaterTokens: number;
  routeKey: string;
}
export const defaultContextPolicy: RuntimeContextPolicy = {
  enabled: true,
  highWaterTokens: 96000,
  lowWaterTokens: 64000,
  routeKey: "unverified-cli-route",
};
export interface RuntimeContextRecord {
  supervisor: ContextSupervisorState;
  evidence: ContextEvidence[];
  rotations: number;
  ineffectiveRotations?: number;
  measuredRotation?: number;
  estimatedIneffectiveRotations?: number;
  estimatedRotation?: number;
  /** Message offset at executor creation, not the retained full task history. */
  historyFromIndex?: number;
  /** Only an observed host generation boundary can exclude old unresolved tool metadata. */
  historyBoundaryKnown?: boolean;
  /** Known dispatched wrappers/checkpoint. Opaque native system/tool overhead is excluded. */
  historyBaselineBytes?: number;
  historyBytes?: number;
  dispatches?: number;
  measuredHistoryBytes?: number;
  measuredUsageId?: string;
  /** A byte estimate, never a tokenizer result or evidence of provider capacity. */
  hostEstimate?: ContextUsageObservation;
  /** Conservative carry-over within one executor after a route identity edit.
   * Old-route telemetry is not a measurement of the new route's tokenizer. */
  inheritedRoutePressure?: {
    usedTokens: number;
    historyBytes: number;
    sourceModelKey: string;
  };
  lastRotation?: {
    at: string;
    beforeTokens?: number;
    checkpointSha256: string;
    checkpointBytes: number;
  };
}

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const TOOL_TEXT_BYTES = 64 * 1024;
const cappedBytes = (value: string, max = MAX_HISTORY_BYTES) =>
  Math.min(max, Buffer.byteLength(value));

/** Read only actual visible content; do not serialize retained history or arbitrary tool objects. */
function visibleHistoryBytes(session: Session, from: number): number {
  let total = 0;
  const add = (n: number) => {
    total = Math.min(MAX_HISTORY_BYTES, total + n);
  };
  for (const message of session.messages.slice(from)) {
    if (message.role === "system" && message.kind !== "role_continuation")
      continue;
    add(cappedBytes(message.content));
    for (const tool of (message.tools || []).slice(0, 256)) {
      add(cappedBytes(tool.title, TOOL_TEXT_BYTES));
      if (typeof tool.output === "string")
        add(cappedBytes(tool.output, TOOL_TEXT_BYTES));
      let remaining = TOOL_TEXT_BYTES,
        nodes = 0;
      const seen = new Set<object>();
      const visit = (value: unknown, depth: number) => {
        if (remaining <= 0 || depth > 6 || ++nodes > 128) return;
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          const bytes = cappedBytes(String(value), remaining);
          add(bytes);
          remaining -= bytes;
        } else if (value && typeof value === "object" && !seen.has(value)) {
          seen.add(value);
          let fields = 0;
          for (const key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            if (++fields > 128) break;
            visit(key, depth + 1);
            visit((value as Record<string, unknown>)[key], depth + 1);
            if (remaining <= 0 || nodes > 128) break;
          }
        }
      };
      visit(tool.input, 0);
    }
    if (total >= MAX_HISTORY_BYTES) break;
  }
  return total;
}

function refreshHostEstimate(record: RuntimeContextRecord, session: Session) {
  const bytes = Math.min(
    MAX_HISTORY_BYTES,
    (record.historyBaselineBytes || 0) +
      visibleHistoryBytes(session, record.historyFromIndex || 0),
  );
  record.historyBytes = bytes;
  const actual = record.supervisor.latestUsage;
  const measured = actual && !actual.estimated;
  // A known irreducible wrapper is enough to stop repeated estimated renewals.
  // This is separate from native usage and never establishes a provider limit.
  if (
    !measured &&
    record.lastRotation &&
    record.dispatches &&
    record.estimatedRotation !== record.rotations
  ) {
    const before = record.lastRotation.beforeTokens;
    record.estimatedIneffectiveRotations =
      before && (record.historyBaselineBytes || 0) / 2 > before * 0.75
        ? (record.estimatedIneffectiveRotations || 0) + 1
        : 0;
    record.estimatedRotation = record.rotations;
  }
  const delta =
    measured && record.measuredUsageId === actual.id
      ? Math.max(0, bytes - (record.measuredHistoryBytes || 0))
      : 0;
  const inherited = record.inheritedRoutePressure;
  const inheritedTokens = inherited
    ? inherited.usedTokens +
      Math.ceil(Math.max(0, bytes - inherited.historyBytes) / 2)
    : 0;
  const usedTokens = measured
    ? Math.min(MAX_HISTORY_BYTES / 2, actual.usedTokens + Math.ceil(delta / 2))
    : Math.min(
        MAX_HISTORY_BYTES / 2,
        Math.max(Math.ceil(bytes / 2), inheritedTokens),
      );
  const observation: ContextUsageObservation = {
    kind: "usage",
    id: `host:${record.supervisor.generation}:${bytes}:${measured ? actual.id : "unmeasured"}`.slice(
      0,
      160,
    ),
    at: Date.now(),
    usedTokens,
    estimated: true,
    basis: "host_estimate",
  };
  record.hostEstimate = observation;
  // Preserve the native measurement and its provenance. Estimated growth is used separately in decisions.
  if (
    !measured &&
    (!actual ||
      actual.usedTokens !== usedTokens ||
      actual.basis !== "host_estimate")
  )
    record.supervisor = observeContext(record.supervisor, observation);
}

/** Persist in the dispatch transaction before appending this turn's messages. No prompt text is stored. */
export function recordRuntimeDispatch(
  record: RuntimeContextRecord,
  input: {
    historyLength: number;
    promptBytes: number;
    visibleInputBytes: number;
  },
) {
  for (const n of [
    input.historyLength,
    input.promptBytes,
    input.visibleInputBytes,
  ])
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("Invalid context dispatch byte accounting.");
  record.historyFromIndex ??= input.historyLength;
  record.historyBoundaryKnown = true;
  const overhead = Math.min(
    MAX_HISTORY_BYTES,
    Math.max(0, input.promptBytes - input.visibleInputBytes),
  );
  const before = record.historyBaselineBytes || 0;
  record.historyBaselineBytes = Math.min(
    MAX_HISTORY_BYTES,
    record.dispatches ? before + overhead : Math.max(before, overhead),
  );
  record.historyBytes = Math.min(
    MAX_HISTORY_BYTES,
    (record.historyBytes || 0) + record.historyBaselineBytes - before,
  );
  record.dispatches = Math.min(1000000, (record.dispatches || 0) + 1);
}
export function validateContextPolicy(input: unknown): RuntimeContextPolicy {
  const p = input as RuntimeContextPolicy;
  if (
    !p ||
    typeof p.enabled !== "boolean" ||
    !Number.isSafeInteger(p.highWaterTokens) ||
    !Number.isSafeInteger(p.lowWaterTokens) ||
    p.lowWaterTokens < 2048 ||
    p.highWaterTokens < 4096 ||
    p.highWaterTokens > 1024 * 1024 ||
    p.lowWaterTokens >= p.highWaterTokens ||
    typeof p.routeKey !== "string" ||
    !p.routeKey.trim() ||
    p.routeKey.length > 200 ||
    /[\x00-\x1f]/.test(p.routeKey)
  )
    throw new Error(
      "Invalid context policy: choose a short non-secret route key and low-water below high-water.",
    );
  return { ...p };
}
export function runtimeContext(
  state: AppState,
  session: Session,
  generation: number,
  policy: RuntimeContextPolicy,
  previous?: RuntimeContextRecord,
) {
  const identity = {
    provider: "cli",
    model: session.model || state.settings.model || "native-default",
    endpointKey: createHash("sha256")
      .update(
        JSON.stringify([
          policy.routeKey,
          session.instructionBinding?.runtimeFingerprint ||
            state.settings.cliPath,
        ]),
      )
      .digest("hex"),
    ...(session.reasoning ? { reasoning: session.reasoning } : {}),
  };
  const validLimit = (v: unknown) =>
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= 4096 &&
    v <= 8 * 1024 * 1024
      ? v
      : undefined;
  const worker = !!session.managed || !!session.parentId;
  const envelope = resolveContextEnvelope({
    identity,
    configuredLimitTokens: validLimit(state.settings.contextLimit),
    cliLimitTokens: validLimit(session.context.limitTokens),
    highWaterTokens: Math.min(
      policy.highWaterTokens,
      worker ? 48000 : policy.highWaterTokens,
    ),
    lowWaterTokens: Math.min(
      policy.lowWaterTokens,
      worker ? 24000 : policy.lowWaterTokens,
    ),
    // Route measurements expire; model aliases and gateway behavior can change.
    evidence: (previous?.evidence || [])
      .filter((v) => Date.now() - v.at < 24 * 60 * 60 * 1000)
      .slice(-128),
  });
  let record: RuntimeContextRecord;
  if (previous?.supervisor.generation === generation) {
    // A label/model/reasoning edit is not an executor reset. Preserve its known
    // history boundary and pressure while invalidating route-specific evidence.
    record = structuredClone(previous);
    record.historyFromIndex ??= session.messages.length;
    if (previous.supervisor.modelKey !== envelope.modelKey) {
      refreshHostEstimate(record, session);
      const pressure = Math.max(
        record.supervisor.latestUsage?.usedTokens || 0,
        record.hostEstimate?.usedTokens || 0,
      );
      const sourceModelKey =
        record.supervisor.latestUsage?.estimated === false
          ? record.supervisor.modelKey
          : record.inheritedRoutePressure?.sourceModelKey ||
            record.supervisor.modelKey;
      record.supervisor = createContextSupervisor(
        envelope.modelKey,
        generation,
      );
      record.evidence = record.evidence.filter(
        (item) => item.modelKey === envelope.modelKey,
      );
      delete record.measuredUsageId;
      delete record.measuredHistoryBytes;
      delete record.hostEstimate;
      if (pressure > 0)
        record.inheritedRoutePressure = {
          usedTokens: pressure,
          historyBytes: record.historyBytes || 0,
          sourceModelKey,
        };
      else delete record.inheritedRoutePressure;
    }
  } else {
    record = {
      supervisor: createContextSupervisor(envelope.modelKey, generation),
      evidence:
        previous?.evidence
          ?.filter((v) => v.modelKey === envelope.modelKey)
          .slice(-128) || [],
      rotations: previous?.rotations || 0,
      historyFromIndex: session.messages.length,
      historyBoundaryKnown:
        session.messages.length === 0 ||
        (!!previous && previous.supervisor.generation !== generation),
      historyBaselineBytes:
        previous?.supervisor.modelKey === envelope.modelKey
          ? previous.lastRotation?.checkpointBytes || 0
          : 0,
      dispatches: 0,
      ...(previous?.supervisor.modelKey === envelope.modelKey
        ? {
            lastRotation: previous.lastRotation,
            ineffectiveRotations: previous.ineffectiveRotations,
            estimatedIneffectiveRotations:
              previous.estimatedIneffectiveRotations,
            // A manual recovery may keep the rotation count. Its first fresh
            // baseline must still re-evaluate and release a resolved overhead hold.
          }
        : {}),
    };
  }
  // Records from earlier builds acquire an explicit boundary on first observation.
  record.historyFromIndex ??= session.messages.length;
  refreshHostEstimate(record, session);
  return { identity, envelope, record };
}
export function runtimeContextDecision(
  state: AppState,
  session: Session,
  record: RuntimeContextRecord,
  envelope: ContextEnvelope,
  cleanEndTurn: boolean,
  nextInput?: string,
): ContextDecision {
  const latest = session.messages.filter((m) => m.role === "assistant").at(-1);
  const olderGeneration =
    !!latest &&
    record.historyBoundaryKnown === true &&
    session.messages.indexOf(latest) < (record.historyFromIndex || 0);
  const verifiedLatest =
    !!latest &&
    session.managed?.effectFence !== true &&
    session.managed?.reconciliations?.some(
      (entry) =>
        entry.source === "human_host_ui" &&
        entry.assistantMessageId === latest.id,
    );
  const pendingTools =
    (!verifiedLatest &&
      !olderGeneration &&
      latest?.tools?.some(
        (t) => !["completed", "failed", "cancelled"].includes(t.status),
      )) ||
    false;
  const actual = record.supervisor.latestUsage;
  const supervisor =
    actual &&
    !actual.estimated &&
    record.hostEstimate &&
    record.hostEstimate.usedTokens > actual.usedTokens
      ? { ...record.supervisor, latestUsage: record.hostEstimate }
      : record.supervisor;
  let decision = contextDecision(supervisor, envelope, {
    now: Date.now(),
    cleanEndTurn,
    unknownOutcome:
      session.status === "unknown" ||
      session.managed?.effectFence === true ||
      pendingTools,
    pendingTools,
    waitingQuestions: state.questions.some(
      (q) => q.sessionId === session.id && q.status === "pending",
    ),
    // Estimate is explicitly labelled; bytes/2 is not a provider tokenizer.
    ...(nextInput
      ? {
          nextPromptEstimatedTokens: Math.ceil(
            Buffer.byteLength(nextInput) / 2,
          ),
        }
      : {}),
  });
  // Qwen emits compaction notices as untagged prose. Require actual measured pressure.
  if (
    decision.reason === "ineffective_compaction_loop" &&
    (!record.supervisor.latestUsage ||
      record.supervisor.latestUsage.estimated ||
      record.supervisor.latestUsage.usedTokens < envelope.highWaterTokens)
  )
    decision = { ...decision, action: "continue", reason: "within_budget" };
  if (
    decision.action === "rotate_at_boundary" &&
    ((record.ineffectiveRotations || 0) >= 2 ||
      (record.supervisor.latestUsage?.estimated !== false &&
        (record.estimatedIneffectiveRotations || 0) >= 2))
  )
    decision = {
      ...decision,
      action: "hold_configuration",
      reason: "irreducible_context_overhead",
    };
  return decision;
}
export function recordRuntimeUsage(
  record: RuntimeContextRecord,
  observation: Parameters<typeof observeContext>[1],
) {
  if (
    observation.kind === "usage" &&
    !observation.estimated &&
    observation.usedTokens > 0 &&
    record.lastRotation &&
    record.measuredRotation !== record.rotations
  ) {
    const before = record.lastRotation.beforeTokens;
    record.ineffectiveRotations =
      before && observation.usedTokens > before * 0.75
        ? (record.ineffectiveRotations || 0) + 1
        : 0;
    record.measuredRotation = record.rotations;
  }
  if (
    observation.kind === "usage" &&
    observation.estimated &&
    record.supervisor.latestUsage?.estimated === false
  )
    return;
  record.supervisor = observeContext(record.supervisor, observation);
  if (
    observation.kind === "usage" &&
    !observation.estimated &&
    record.supervisor.latestUsage?.id === observation.id
  ) {
    delete record.inheritedRoutePressure;
    record.measuredUsageId = observation.id;
    record.measuredHistoryBytes = record.historyBytes || 0;
    record.hostEstimate = {
      ...observation,
      id: `host:${record.supervisor.generation}:${observation.id}`.slice(
        0,
        160,
      ),
      basis: "host_estimate",
      estimated: true,
    };
  }
}
export function validateRuntimeContextRecord(
  input: unknown,
): input is RuntimeContextRecord {
  try {
    const r = input as RuntimeContextRecord;
    if (
      !r ||
      !r.supervisor ||
      !Number.isSafeInteger(r.rotations) ||
      r.rotations < 0 ||
      r.rotations > 1000000 ||
      !Array.isArray(r.evidence) ||
      r.evidence.length > 128 ||
      !Array.isArray(r.supervisor.observations) ||
      r.supervisor.observations.length > 24
    )
      return false;
    const baseline = createContextSupervisor(
      r.supervisor.modelKey,
      r.supervisor.generation,
    );
    for (const item of r.supervisor.observations)
      observeContext(baseline, item);
    if (r.supervisor.latestUsage)
      observeContext(baseline, r.supervisor.latestUsage);
    for (const n of [
      r.ineffectiveRotations,
      r.measuredRotation,
      r.estimatedIneffectiveRotations,
      r.estimatedRotation,
    ])
      if (n !== undefined && (!Number.isSafeInteger(n) || n < 0 || n > 1000000))
        return false;
    for (const n of [r.historyFromIndex, r.dispatches])
      if (n !== undefined && (!Number.isSafeInteger(n) || n < 0 || n > 1000000))
        return false;
    if (
      r.historyBoundaryKnown !== undefined &&
      typeof r.historyBoundaryKnown !== "boolean"
    )
      return false;
    for (const n of [
      r.historyBaselineBytes,
      r.historyBytes,
      r.measuredHistoryBytes,
    ])
      if (
        n !== undefined &&
        (!Number.isSafeInteger(n) || n < 0 || n > MAX_HISTORY_BYTES)
      )
        return false;
    if (
      r.measuredUsageId !== undefined &&
      (typeof r.measuredUsageId !== "string" ||
        !r.measuredUsageId ||
        r.measuredUsageId.length > 160)
    )
      return false;
    if (r.hostEstimate) {
      if (
        r.hostEstimate.basis !== "host_estimate" ||
        r.hostEstimate.estimated !== true
      )
        return false;
      observeContext(baseline, r.hostEstimate);
    }
    if (r.inheritedRoutePressure) {
      const p = r.inheritedRoutePressure;
      if (
        !Number.isSafeInteger(p.usedTokens) ||
        p.usedTokens < 0 ||
        p.usedTokens > MAX_HISTORY_BYTES / 2 ||
        !Number.isSafeInteger(p.historyBytes) ||
        p.historyBytes < 0 ||
        p.historyBytes > MAX_HISTORY_BYTES ||
        !/^[a-f0-9]{64}$/.test(p.sourceModelKey)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function runtimeRecoveryPacket(
  state: AppState,
  session: Session,
  generation: number,
  envelope: ContextEnvelope,
) {
  const task = state.tasks.find((t) => t.id === session.taskId)!;
  const users = session.messages.filter((m) => m.role === "user");
  const latest = users.at(-1);
  const original = users[0];
  const tools = session.messages.slice(-20).flatMap((m) =>
    (m.tools || []).slice(-20).map((t) => ({
      operationId: t.id,
      status: (t.status === "completed"
        ? "confirmed"
        : t.status === "failed"
          ? "failed"
          : "unknown") as "confirmed" | "failed" | "unknown",
      text: `Tool channel reported ${t.status}: ${t.title}. This does not certify business acceptance.`,
      reference: `task_history:${session.id}:${m.id}`,
    })),
  );
  return buildContextRecoveryPacket(
    {
      taskId: task.id,
      sessionId: session.id,
      generation,
      goal: [
        task.description,
        original?.content,
        latest !== original ? latest?.content : "",
      ]
        .filter(Boolean)
        .join("\n"),
      goalReference: `task_context:description:${task.id};task_history:${session.id}`,
      instructionsReference: session.instructionBinding
        ? `instruction_snapshot:${session.instructionBinding.fingerprint}`
        : "current CORE + automatically selected role",
      facts: state.questions
        .filter(
          (q) =>
            q.sessionId === session.id && q.status === "answered" && q.answer,
        )
        .slice(-8)
        .map((q) => ({
          text: `Saved answer to ${q.title}: ${q.answer}`,
          reference: `question:${q.id}`,
        })),
      plan: session.todos.slice(-40).map((t) => ({
        text: t.text,
        status: t.status,
        reference: `task_context:todos:${t.id}`,
      })),
      toolOutcomes: tools,
      artifactReferences: state.artifacts
        .filter((a) => a.taskId === task.id)
        .slice(-20)
        .map((a) => `artifact:${a.id}:${a.name}`),
      historyReference: `task_history:${session.id}`,
    },
    Math.max(2048, envelope.recoveryPacketBudgetBytes),
  );
}
