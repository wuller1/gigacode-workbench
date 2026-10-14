/** Actual Operations runtime DTOs. External MCP bindings must return these envelopes. */
export const opsReadOperations = [
  "ci.jobs",
  "ci.job",
  "ci.queue",
  "ci.run",
  "ci.logs",
  "ci.stages",
  "ci.tests",
  "ci.artifacts",
  "cluster.discovery",
  "cluster.namespaces",
  "cluster.list",
  "cluster.get",
  "cluster.events",
  "cluster.logs",
  "cluster.watch",
] as const;
export const opsActionOperations = [
  "ci.trigger",
  "ci.queueCancel",
  "ci.stop",
  "cluster.apply",
  "cluster.scale",
  "cluster.restart",
  "cluster.delete",
] as const;
export type OpsReadOperation = (typeof opsReadOperations)[number];
export type OpsActionOperation = (typeof opsActionOperations)[number];
export type OpsOperation = OpsReadOperation | OpsActionOperation;
export type OpsValue =
  null | boolean | number | string | OpsValue[] | { [key: string]: OpsValue };
export interface OpsConnection {
  id: string;
  revision: number;
  kind: "jenkins" | "kubernetes" | "openshift";
  name: string;
  environment: string;
  enabled: boolean;
  projectIds: string[];
  transport: "builtin" | "stdio" | "http";
  /** Builtin REST endpoint or external HTTP MCP endpoint; HTTPS except loopback. */
  url?: string;
  username?: string;
  command?: string;
  args?: string[];
  secretHeader?: string;
  secretPrefix?: string;
  secretEnv?: string;
  ca?: string;
  bindings?: Partial<
    Record<OpsOperation | "prepare" | "execute" | "reconcile" | "probe", string>
  >;
  credentialConfigured: boolean;
  /** Target changes invalidate prepared actions; display-name changes do not. */
  targetHash: string;
  authGeneration: number;
  discovered?: OpsInventory;
}
export interface OpsInventory {
  server: { name: string; version?: string };
  schemaHash: string;
  tools: { name: string; description?: string; inputSchema: unknown }[];
  capabilities: string[];
  /** Tool mapping alone does not prove a corporate DTO adapter conforms. */
  adapterStatus?: "inventory_only" | "target_verified";
  observedAt: string;
}
export interface OpsQueryResult<T = OpsValue> {
  data: T;
  observedAt: string;
  cursor?: string;
  hasMore?: boolean;
  sourceRevision?: string;
  warnings: string[];
}
export type OpsErrorKind =
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
  | "protocol"
  | "unknown";
export interface OpsError {
  kind: OpsErrorKind;
  message: string;
  status?: number;
  retryAfterMs?: number;
  outcome: "notApplied" | "unknown";
}
export interface OpsPreparedAction {
  id: string;
  operationId: string;
  projectId: string;
  connectionId: string;
  operation: OpsActionOperation;
  input: Record<string, OpsValue>;
  targetHash: string;
  authGeneration: number;
  schemaHash: string;
  summary: string;
  preview: OpsValue;
  createdAt: string;
  expiresAt: string;
}
export interface OpsReceipt {
  id: string;
  preparedActionId: string;
  operationId: string;
  projectId: string;
  connectionId: string;
  operation: OpsActionOperation;
  input: Record<string, OpsValue>;
  targetHash: string;
  authGeneration: number;
  /** Original dispatch authGeneration stays immutable; read-only observations may
   * use rotated credentials on the exact same target. Never authorizes a replay. */
  lastObservedAuthGeneration?: number;
  requestHash: string;
  status:
    | "dispatching"
    | "accepted"
    | "running"
    | "confirmed"
    | "failed"
    | "cancelled"
    | "unknown";
  startedAt: string;
  updatedAt: string;
  remoteId?: string;
  data?: OpsValue;
  error?: OpsError;
}
export interface OpsSnapshot {
  connections: OpsConnection[];
  prepared: OpsPreparedAction[];
  receipts: OpsReceipt[];
  /** Canonical Jenkins fullName or adapter ID; shared by all bound projects. */
  favorites: { connectionId: string; jobId: string }[];
  receiptCounts?: {
    unresolved: number;
    terminal: number;
    shown: number;
    hasMoreTerminal: boolean;
  };
}
export interface OpsJenkinsJob {
  id: string;
  fullName: string;
  name: string;
  url: string;
  kind: string;
  folder: boolean;
  runnable: boolean;
  disabled: boolean;
  building?: boolean;
  inQueue?: boolean;
  lastBuild?: {
    number: number;
    result: string | null;
    building: boolean;
    timestamp?: number;
    duration?: number;
  };
  parameters?: OpsJenkinsParameter[];
}
export interface OpsJenkinsParameter {
  name: string;
  type: string;
  description: string;
  defaultValue?: OpsValue;
  choices?: string[];
  supported: boolean;
}
export interface OpsClusterResourceType {
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
  verbs: string[];
}
export interface OpsLogPage {
  text: string;
  /** Opaque Jenkins cursor: raw upstream byte offset or bounded local spool page.
   * Consumers must pass it unchanged; display text bytes are not raw log offsets. */
  cursor?: string;
  hasMore: boolean;
  truncated: boolean;
}
