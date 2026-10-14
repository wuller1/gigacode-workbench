/** Data tools use captured connection + console IDs, never the currently focused UI. */
export type DatabaseConnection = {
  id: string;
  name: string;
  environment: string;
  projectIds: string[];
  transport: "postgres-mcp" | "stdio" | "http";
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: boolean;
  ca?: string;
  readOnly: boolean;
  command?: string;
  args?: string[];
  url?: string;
  secretEnv?: string;
  secretHeader?: string;
  secretPrefix?: string;
  /** Operation -> actual discovered MCP tool name. No guessed tool names. */
  bindings?: Record<string, string>;
  hasSecret?: boolean;
  /** Fingerprint of the configured target, excluding display labels/secrets. */
  targetHash?: string;
};
export type DatabaseConsole = {
  id: string;
  projectId: string;
  connectionId: string;
  targetHash?: string;
  title: string;
  sql: string;
  revision: number;
  /** Host-owned session activity counter; not persisted or a caller permission. */
  readonly activityRevision?: number;
  closed?: boolean;
  updatedAt: string;
  mode: "auto" | "manual";
  schema: string;
  leaseId?: string;
  object?: { oid: string; kind: string };
  /** Host-owned DDL baseline. Metadata reads never implicitly accept a new version. */
  routineBaseline?: {
    committedHash: string;
    /** Initial source hash has been checked against the actual database. */
    verified: boolean;
    /** Uncommitted DDL belongs only to this physical PostgreSQL session. */
    session?: { leaseId: string; generation: string; hash: string };
    /** Complex/unknown transaction transitions require explicit DDL reload. */
    blocked?: string;
  };
  pendingEffect?: {
    operationId: string;
    kind: "changes" | "transaction" | "routine";
    phase: "submitting" | "unknown";
    at: string;
    requestHash: string;
    intent?: Record<string, unknown>;
    reason?: string;
    jobId?: string;
  };
  lastResolution?: {
    operationId: string;
    outcome: "applied" | "notApplied";
    note: string;
    evidenceJobIds: string[];
    at: string;
  };
};
export type DatabaseField = {
  name: string;
  typeId: number;
  tableId?: number;
  columnId?: number;
};
export type DatabaseResult = {
  id: string;
  fields: DatabaseField[];
  rows: number;
  bytes: number;
  command: string;
  truncated?: boolean;
  elapsedMs: number;
  source?: {
    tableOid: string;
    offset: number;
    pageSize: number;
    filter?: { column: string; operator: string; value?: string }[];
    sort?: string;
    descending?: boolean;
  };
};
export type DatabaseJob = {
  id: string;
  operationId: string;
  consoleId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  kind: string;
  results: DatabaseResult[];
  rows: number;
  bytes: number;
  startedAt: string;
  finishedAt?: string;
  error?: {
    message: string;
    code?: string;
    position?: number;
    statementOffset?: number;
  };
  sql?: string;
  sqlPath?: string;
  sqlHash?: string;
  requestPath?: string;
  requestHash?: string;
  routine?: {
    oid: string;
    previousHash: string;
    appliedHash: string;
    committed: boolean;
  };
  file?: {
    path: string;
    size: number;
    inputHash?: string;
    copyUtf8Hash?: string;
  };
};
export type DatabaseLease = {
  id: string;
  connectionId: string;
  database: string;
  user: string;
  server: string;
  transaction: "idle" | "active" | "failed" | "unknown";
  mode: "auto" | "manual";
  readOnly: boolean;
  busy: boolean;
  generation: string;
};
export type DatabaseObject = {
  oid: string;
  schema: string;
  name: string;
  kind: string;
};
export type DatabaseRelationColumn = {
  ordinal: number;
  name: string;
  type: string;
  primaryKey: boolean;
};
export type DatabaseRelationNode = {
  oid: string;
  schema: string;
  name: string;
  /** PostgreSQL relkind: r (ordinary), p (partitioned), f (foreign table). */
  kind: string;
  columns: DatabaseRelationColumn[];
  columnCount: number;
  columnsTruncated: boolean;
};
export type DatabaseRelationEdge = {
  oid: string;
  name: string;
  /** Referencing table -> referenced table, including self-references once. */
  sourceOid: string;
  targetOid: string;
  columns: { ordinal: number; source: string; target: string }[];
  onUpdate: "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
  onDelete: "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
  match: "SIMPLE" | "FULL" | "PARTIAL";
  validated: boolean;
  deferrable: boolean;
  initiallyDeferred: boolean;
};
export type DatabaseRelations = {
  rootOid: string;
  capturedAt: string;
  /** Only direct incoming/outgoing foreign keys of rootOid, not a full ERD. */
  scope: "direct-foreign-keys";
  nodes: DatabaseRelationNode[];
  edges: DatabaseRelationEdge[];
  /** Complete direct-neighborhood counts before the display limits. */
  totals: { nodes: number; edges: number };
  limits: { nodes: number; edges: number; columnsPerNode: number };
  /** Also true when any displayed node's column preview was shortened. */
  truncated: boolean;
};
export type DatabaseChange = {
  kind: "update" | "insert" | "delete";
  key?: { tableoid: string; ctid: string; xmin: string };
  values?: Record<string, string | null | { default: true }>;
};
export type DatabaseSnapshot = {
  connections: DatabaseConnection[];
  consoles: DatabaseConsole[];
  leases: DatabaseLease[];
  jobs: DatabaseJob[];
};
