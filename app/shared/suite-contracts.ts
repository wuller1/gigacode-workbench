/** Canonical contracts for the suite upgrade. They are deliberately transport-neutral. */
export type WorkspaceKind =
  | "chat"
  | "ide"
  | "browser"
  | "design"
  | "tasks"
  | "operations"
  | "data"
  | "source-control";

export type RiskClass = "read" | "reversible" | "disruptive" | "destructive";
export type OperationStatus =
  | "prepared"
  | "accepted"
  | "running"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface ResourceRef {
  kind: string;
  id: string;
  projectId: string;
  taskId?: string;
  connectionId?: string;
  revision?: string;
  label?: string;
}

export interface ProjectBinding {
  id: string;
  projectId: string;
  adapterId: string;
  connectionId: string;
  capabilityIds: string[];
  target: Record<string, string>;
  environmentId?: string;
  secretRefs?: string[];
  schemaHash: string;
  verifiedAt?: string;
  enabled: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  title: string;
  mode: "query" | "prepare-execute" | "subscribe";
  risk: RiskClass;
  inputSchema: unknown;
  outputSchema?: unknown;
  supportsCancellation?: boolean;
  idempotency: "safe" | "keyed" | "reconcile-first" | "never-repeat";
}

export interface AdapterDescriptor {
  id: string;
  kind:
    | "mcp"
    | "api"
    | "cli"
    | "native"
    | "database"
    | "browser";
  title: string;
  version?: string;
  schemaHash: string;
  capabilities: CapabilityDescriptor[];
}

export interface RequestActor {
  kind: "user" | "agent" | "system";
  id: string;
  taskId?: string;
  sessionId?: string;
}

export interface RequestContext {
  actor: RequestActor;
  projectId: string;
  taskId?: string;
  connectionId?: string;
  environmentId?: string;
  target: Record<string, string>;
  correlationId: string;
  operationId: string;
  expectedRevision?: string;
}

export interface QueryEnvelope<TInput = unknown> {
  operation: string;
  input: TInput;
  context: RequestContext;
  cursor?: string;
  limit?: number;
}

export interface QueryResult<T = unknown> {
  data: T;
  observedAt: string;
  sourceRevision?: string;
  cursor?: string;
  stale: boolean;
  warnings: string[];
}

export interface PreparedAction {
  id: string;
  operation: string;
  context: RequestContext;
  target: ResourceRef;
  summary: string;
  impact: string[];
  risk: Exclude<RiskClass, "read">;
  diff?: unknown;
  expectedRevision?: string;
  idempotencyKey?: string;
  fingerprint: string;
  expiresAt: string;
}

export interface OperationReceipt {
  id: string;
  preparedActionId?: string;
  operation: string;
  status: OperationStatus;
  context: RequestContext;
  remoteId?: string;
  startedAt: string;
  updatedAt: string;
  verification?: {
    observedAt: string;
    sourceRevision?: string;
    evidence: ResourceRef[];
  };
  error?: ConnectorError;
}

export type ConnectorErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "offline"
  | "timeout"
  | "unsupported"
  | "server"
  | "cancelled"
  | "unknown";

export interface ConnectorError {
  kind: ConnectorErrorKind;
  message: string;
  retryAfterMs?: number;
  remoteRequestId?: string;
  responseFormat?: "json" | "html" | "text" | "binary";
  diagnosticExcerpt?: string;
  uncertainOutcome: boolean;
}

export interface SuiteEvent<T = unknown> {
  type: string;
  seq: number;
  projectId: string;
  taskId?: string;
  resource?: ResourceRef;
  correlationId?: string;
  resourceRevision?: string;
  emittedAt: string;
  payload: T;
}

export interface ConnectorAdapter {
  describe(): Promise<AdapterDescriptor>;
  discover(context: RequestContext): Promise<QueryResult<unknown>>;
  query<T>(request: QueryEnvelope): Promise<QueryResult<T>>;
  prepare(
    operation: string,
    input: unknown,
    context: RequestContext,
  ): Promise<PreparedAction>;
  execute(action: PreparedAction): Promise<OperationReceipt>;
  reconcile(receipt: OperationReceipt): Promise<OperationReceipt>;
  cancel?(receipt: OperationReceipt): Promise<OperationReceipt>;
}

export interface ViewStateKey {
  windowId: number;
  projectId: string;
  workspace: WorkspaceKind;
  panelInstanceId: string;
}

export interface ContextBudget {
  limitTokens: number;
  estimatedUsedTokens: number;
  reservedResponseTokens: number;
  pinnedRefs: ResourceRef[];
  summaryRevision?: string;
}

export type ArtifactKind =
  | "design-brief"
  | "flow-map"
  | "wireframe"
  | "interactive-prototype"
  | "component-spec"
  | "design-tokens"
  | "vector-asset"
  | "image"
  | "browser-capture"
  | "visual-diff"
  | "test-trace"
  | "document"
  | "dataset"
  | "build-output";

export type ArtifactReviewState =
  | "draft"
  | "review"
  | "changes-requested"
  | "approved"
  | "ready-for-development"
  | "implemented"
  | "verified";

export interface ArtifactProvenance {
  origin: "original" | "generated" | "user-provided" | "oss";
  sourceRef?: string;
  authorOrTool?: string;
  licenseSpdx?: string;
  attribution?: string;
  contentHash: string;
  createdAt: string;
}

export interface ArtifactVersion {
  artifactId: string;
  versionId: string;
  kind: ArtifactKind;
  projectId: string;
  taskId: string;
  authorSessionId?: string;
  parentVersionId?: string;
  sourceBlobRef: ResourceRef;
  previewRefs: ResourceRef[];
  provenance: ArtifactProvenance[];
  reviewState: ArtifactReviewState;
  viewportMatrix?: Array<{
    width: number;
    height: number;
    deviceScaleFactor?: number;
    theme?: string;
    state?: string;
  }>;
  createdAt: string;
}

export interface DesignAuditFinding {
  id: string;
  ruleId: string;
  category:
    | "accessibility"
    | "geometry"
    | "responsive"
    | "interaction"
    | "performance"
    | "heuristic";
  severity: "info" | "warning" | "error";
  measurement?: { value: number; unit: string; threshold?: number };
  elementRef?: string;
  viewport?: { width: number; height: number; theme?: string; state?: string };
  message: string;
  evidenceRefs: ResourceRef[];
}

export interface InstructionBinding {
  projectId: string;
  taskId: string;
  sessionId: string;
  roleId: string;
  roleVersion: string;
  instructionFingerprint: string;
  deliveryMode:
    | "system-replace"
    | "system-append"
    | "context-instruction"
    | "native-agent"
    | "unknown";
  requestedModel?: string;
  actualModel?: string;
  requestedReasoning?: string;
  actualReasoning?: string;
  capabilityFingerprint: string;
  activatedAt?: string;
  evidenceRefs: ResourceRef[];
}

export interface ContextCheckpoint {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  taskRevision: string;
  objective: string;
  constraints: string[];
  decisionRefs: ResourceRef[];
  changedResourceRefs: ResourceRef[];
  evidenceRefs: ResourceRef[];
  pendingEffectRefs: ResourceRef[];
  openQuestionRefs: ResourceRef[];
  nextStep: string;
  summaryRevision?: string;
  createdAt: string;
}

export type ExecutionPolicyMode = "auto_allow_bound";
export type ExecutionPolicyScope = "global" | "project" | "task" | "session";

export interface ExecutionPolicyDisable {
  capabilityId: string;
  scope: ExecutionPolicyScope;
  scopeId: string;
  reason: string;
  sourceRevision: string;
}

/** Persisted readback after global → project → task → session policy inheritance. */
export interface EffectiveExecutionPolicy {
  mode: ExecutionPolicyMode;
  projectId: string;
  taskId?: string;
  sessionId?: string;
  projectBindingIds: string[];
  discoveredCapabilityIds: string[];
  allowedCapabilityIds: string[];
  disabledCapabilities: ExecutionPolicyDisable[];
  inheritedPolicyRefs: ResourceRef[];
  fingerprint: string;
  evaluatedAt: string;
}

export interface AutomaticRoleDecision {
  selectionMode: "automatic";
  roleId: string;
  roleVersion: string;
  confidence: number;
  factors: Array<{
    kind:
      | "request"
      | "project-purpose"
      | "project-stack"
      | "task"
      | "selected-resource"
      | "previous-role"
      | "expected-output";
    summary: string;
    evidenceRef?: ResourceRef;
  }>;
  selectedAt: string;
}

export interface PendingRoleHandoff {
  fromRoleId: string;
  toRoleId: string;
  reason: string;
  boundary:
    | "after-current-read"
    | "after-current-test"
    | "after-current-operation"
    | "before-next-operation";
  preserves: {
    task: true;
    todo: true;
    context: true;
    artifacts: true;
    evidence: true;
    permissions: true;
  };
  requestedAt: string;
}

export interface AgentRuntimeReadback {
  requestedModel?: string;
  actualModel: string;
  requestedReasoning?: string;
  actualReasoning: string;
  context: ContextBudget;
  role: AutomaticRoleDecision;
  pendingRoleHandoff?: PendingRoleHandoff;
  git?: {
    repositoryRef: ResourceRef;
    branch: string;
    worktreeId?: string;
    revision?: string;
    dirty: boolean;
  };
  observedAt: string;
}

export interface AgentSurfaceSelection {
  workspace: WorkspaceKind;
  resource: ResourceRef;
  revision?: string;
  summary: string;
  attachmentRefs: ResourceRef[];
}

export type AgentOperationPhase =
  | "proposal"
  | "preview"
  | "execute"
  | "result"
  | "verify"
  | "evidence"
  | "reconcile";

/** Durable operation record shared by Chat, IDE, Browser, Design, Tasks, Ops, Data and Source Control. */
export interface AgentOperation {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  workspace: WorkspaceKind;
  phase: AgentOperationPhase;
  status: OperationStatus;
  operation: string;
  actor: RequestActor;
  target: ResourceRef;
  selection?: AgentSurfaceSelection;
  risk: RiskClass;
  effectivePolicyFingerprint: string;
  preparedActionId?: string;
  operationReceiptId?: string;
  idempotencyKey?: string;
  expectedRevision?: string;
  resultRefs: ResourceRef[];
  verificationRefs: ResourceRef[];
  evidenceRefs: ResourceRef[];
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSurfaceState {
  projectId: string;
  taskId: string;
  activeSessionId: string;
  availableSessionIds: string[];
  selection?: AgentSurfaceSelection;
  runtime: AgentRuntimeReadback;
  effectivePolicy: EffectiveExecutionPolicy;
  currentOperationId?: string;
  queuedOperationIds: string[];
  recoveredAt?: string;
}

export type UiKitEntityKind = "token-set" | "component" | "icon" | "template";
export type UiKitMaturity =
  | "specified"
  | "reference-source"
  | "candidate"
  | "stable"
  | "deprecated";
export type UiKitReleaseChannel = "canary" | "next" | "stable";
export type UiKitReviewState =
  | "draft"
  | "review"
  | "changes-requested"
  | "approved"
  | "blocked";
export type UiKitAgentActionStage =
  | "proposal"
  | "preview"
  | "execute"
  | "result"
  | "verify"
  | "evidence";

export interface UiKitEntityRef {
  kind: UiKitEntityKind;
  id: string;
  version: string;
  revision: string;
}

/** A provider-neutral binding to a forge and package registry. Secret values never cross this contract. */
export interface UiKitRepositoryBinding {
  id: string;
  projectId: string;
  connectionId: string;
  forgeWorkspace: string;
  repository: string;
  defaultBranch: string;
  packageRegistryBindingId: string;
  packageName: string;
  catalogArtifactName: string;
  accessPolicy: "allow-bound-capabilities";
  enabledCapabilities: string[];
  disabledCapabilities: Array<{ capabilityId: string; reason: string }>;
  protectedBranchPatterns: string[];
  requiredOwnerGroups: string[];
  secretRefs: string[];
  schemaHash: string;
  verifiedAt?: string;
  enabled: boolean;
}

export interface UiKitTokenSet {
  id: string;
  version: string;
  theme: "core" | "light" | "dark" | "high-contrast" | string;
  format: "dtcg-json";
  sourceRef: ResourceRef;
  semanticPaths: string[];
  contentHash: string;
  maturity: UiKitMaturity;
}

export interface UiKitComponentStateDefinition {
  id: string;
  variants: Record<string, string>;
  interactionState: string;
  theme: string;
  viewport?: { width: number; height: number };
  reducedMotion?: boolean;
  fixtureRef?: ResourceRef;
  evidenceRefs: ResourceRef[];
}

export interface UiKitComponentDefinition {
  id: string;
  version: string;
  title: string;
  category: string;
  maturity: UiKitMaturity;
  ownerGroupIds: string[];
  sourceRefs: ResourceRef[];
  publicApiRef?: ResourceRef;
  tokenPaths: string[];
  states: UiKitComponentStateDefinition[];
  keyboardContract: string[];
  accessibilityContract: string[];
  deprecatedBy?: UiKitEntityRef;
}

export interface UiKitIconDefinition {
  id: string;
  version: string;
  sourceRef: ResourceRef;
  viewBox: string;
  origin: ArtifactProvenance["origin"];
  licenseSpdx: string;
  contentHash: string;
  tags: string[];
  maturity: UiKitMaturity;
}

export interface UiKitTemplateDefinition {
  id: string;
  version: string;
  title: string;
  maturity: UiKitMaturity;
  slotIds: string[];
  requiredStates: string[];
  sourceRef: ResourceRef;
  componentRefs: UiKitEntityRef[];
  evidenceRefs: ResourceRef[];
}

export interface UiKitReleaseEvidence {
  sourceRevision: string;
  packageDigest: string;
  tokenBundleDigest: string;
  iconRegistryDigest: string;
  visualBaselineId: string;
  checkRefs: ResourceRef[];
  consumerFixtureRefs: ResourceRef[];
  sbomRef?: ResourceRef;
  signatureRef?: ResourceRef;
  provenanceRef?: ResourceRef;
}

export interface UiKitPublication {
  id: string;
  projectId: string;
  repositoryBindingId: string;
  version: string;
  channel: UiKitReleaseChannel;
  sourceBranch: string;
  sourceRevision: string;
  reviewState: UiKitReviewState;
  reviewRef?: ResourceRef;
  immutableDigest?: string;
  evidence?: UiKitReleaseEvidence;
  operationReceiptId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UiKitConsumerBinding {
  id: string;
  projectId: string;
  repositoryBindingId: string;
  packageName: string;
  pinnedVersion: string;
  allowedVersionRange?: string;
  availableVersion?: string;
  compatibility: "unknown" | "compatible" | "migration-required" | "blocked";
  lockfileRef?: ResourceRef;
  fixtureEvidenceRefs: ResourceRef[];
  updateReviewRef?: ResourceRef;
}

export interface UiKitAgentActionLifecycle {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  repositoryBindingId: string;
  entityRefs: UiKitEntityRef[];
  stage: UiKitAgentActionStage;
  target: {
    repository: string;
    branch: string;
    packageName?: string;
    version?: string;
    channel?: UiKitReleaseChannel;
  };
  preparedActionId?: string;
  operationReceiptId?: string;
  resultRefs: ResourceRef[];
  verificationRefs: ResourceRef[];
  evidenceRefs: ResourceRef[];
  updatedAt: string;
}
