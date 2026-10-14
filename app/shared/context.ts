/** A route is more specific than a model name: gateways and reasoning change its envelope. */
export interface ContextModelIdentity {
  provider: string;
  model: string;
  endpointKey: string;
  reasoning?: string;
}

export type ContextEvidenceKind =
  | "declared_limit"
  | "structured_token_limit"
  | "accepted_request"
  | "verified_recall";
export interface ContextEvidence {
  modelKey: string;
  kind: ContextEvidenceKind;
  tokens: number;
  at: number;
  /** Receipt/source reference only. Never store API keys, payloads or raw error pages. */
  reference: string;
}
export interface ContextEnvelope {
  modelKey: string;
  nominalLimitTokens: number;
  effectiveLimitTokens: number;
  limitBasis:
    "configured" | "declared" | "cli_reported" | "conservative_default";
  observedAcceptedTokens?: number;
  observedRecallTokens?: number;
  structuredRejectedTokens?: number;
  /** Acceptance and a sampled recall test do not prove the full context window. */
  fullContextVerified: false;
  outputReserveTokens: number;
  safetyReserveTokens: number;
  promptBudgetTokens: number;
  highWaterTokens: number;
  lowWaterTokens: number;
  recoveryPacketBudgetBytes: number;
}
export interface ContextUsageObservation {
  kind: "usage";
  id: string;
  at: number;
  usedTokens: number;
  estimated: boolean;
  basis: "cli_context" | "cli_usage" | "host_estimate";
}
export interface ContextCompactionObservation {
  kind: "compaction";
  id: string;
  at: number;
  beforeTokens: number;
  afterTokens: number;
  estimated: boolean;
  basis: "reviewed_qwen_diagnostic" | "verified_adapter";
}
export type ContextObservation =
  ContextUsageObservation | ContextCompactionObservation;
export interface ContextSupervisorState {
  version: 1;
  modelKey: string;
  generation: number;
  observations: ContextObservation[];
  latestUsage?: ContextUsageObservation;
  /** A new executor is created once at a safe boundary, never from a streaming token. */
  rotations: number;
}
export interface ContextDecision {
  action:
    | "continue"
    | "rotate_at_boundary"
    | "defer_until_boundary"
    | "hold_unknown"
    | "hold_input"
    | "hold_configuration";
  reason:
    | "within_budget"
    | "high_water"
    | "ineffective_compaction_loop"
    | "unknown_effects"
    | "single_input_exceeds_budget"
    | "irreducible_context_overhead";
  usedTokens?: number;
  projectedTokens?: number;
  targetTokens: number;
  estimated: boolean;
  poorCompactions: number;
}

export interface ReviewedContextUsage {
  usedTokens?: number;
  limitTokens: number;
  estimated: boolean;
  model: string;
  breakdown: Record<string, number>;
  basis: "reviewed_qwen_context_usage";
}
