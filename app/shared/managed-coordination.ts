/** Durable host metadata. Session/Control remain the process and queue authority. */
export type ManagedAgentPhase =
  | "queued"
  | "leased"
  | "dispatched"
  | "retry_wait"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed"
  | "unknown";

export interface ManagedFence {
  /** Host-generated, never accepted from an agent as its authenticated identity. */
  leaseId: string;
  epoch: number;
}
export interface ManagedAttempt extends ManagedFence {
  ownerId: string;
  startedAt: number;
  expiresAt: number;
  phase: "leased" | "dispatched" | "terminal" | "revoked";
  sessionGeneration?: number;
}
export interface ManagedCheckpoint {
  summary: string;
  evidenceRefs: string[];
  remaining: string[];
  at: number;
}
export interface ManagedReconciliation {
  humanRequestId: string;
  epoch: number;
  outcome: "applied" | "not_applied";
  evidenceRefs: string[];
  source: "human_host_ui";
  at: number;
  /** Exact stopped assistant turn covered by this host-authenticated attestation. */
  assistantMessageId?: string;
}
export interface ManagedAgentRecord {
  sessionId: string;
  parentId: string;
  projectId: string;
  taskId: string;
  operationId: string;
  inputHash: string;
  dependencies: string[];
  /** Host-resolved canonical file/directory scopes, not a filesystem sandbox. */
  writeScopes: string[];
  /** Worker task packet allowance; excludes opaque native CLI base/tool overhead. */
  contextBudget: number;
  phase: ManagedAgentPhase;
  epoch: number;
  attempts: number;
  attempt?: ManagedAttempt;
  effectFence: boolean;
  desired?: "paused" | "cancelled";
  retryAt?: number;
  failure?: { kind: ManagedFailureKind; summary: string };
  checkpoint?: ManagedCheckpoint;
  reconciliations?: ManagedReconciliation[];
  retryMode?: "captured_human" | "fresh_followup_only";
  retryInputMessageId?: string;
  retryInputHash?: string;
  createdAt: number;
  updatedAt: number;
}
export type ManagedFailureKind =
  | "rate_limit"
  | "transient"
  | "needs_context"
  | "unauthorized"
  | "permanent"
  | "unknown_effects";
export interface ManagedFailure {
  kind: ManagedFailureKind;
  summary: string;
  retryable: boolean;
  retryAfterMs?: number;
}
export interface ManagedSchedulerPolicy {
  maxConcurrent: number;
  maxPerParent: number;
  /** Sum of admitted worker packet reservations, including unknown owners.
   * Not provider KV memory, billed tokens, or exact total prompt size. */
  maxContextTokens: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
}
export interface ProjectCoordinationLink {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  actions: ("note" | "delegate")[];
  /** Captured from a real human request by the host, never a peer message. */
  authorizationRef: string;
  enabled: boolean;
  createdAt: number;
}
export interface CoordinationIdentity {
  sessionId: string;
  taskId: string;
  projectId: string;
  generation: number;
}
export interface CoordinationDelivery {
  id: string;
  operationId: string;
  source: CoordinationIdentity;
  target: Omit<CoordinationIdentity, "generation">;
  kind: "note" | "delegation" | "result";
  text: string;
  inputHash: string;
  linkId?: string;
  authorizationRef?: string;
  /** Notes/results are always reference data, not fresh user permissions. */
  authority: "reference_only" | "authorized_task";
  parentDeliveryId?: string;
  hops: number;
  phase:
    | "retained"
    | "claimed"
    | "dispatched"
    | "observed"
    | "unknown"
    | "cancelled";
  epoch: number;
  attempt?: ManagedAttempt;
  createdAt: number;
  updatedAt: number;
}
export interface ManagedCoordinationState {
  schemaVersion: 1;
  agents: Record<string, ManagedAgentRecord>;
  links: ProjectCoordinationLink[];
  deliveries: CoordinationDelivery[];
}
