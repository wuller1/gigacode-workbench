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
  closed?: boolean;
  updatedAt: string;
  mode: "auto" | "manual";
  schema: string;
  leaseId?: string;
  object?: { oid: string; kind: string };
  pendingEffect?: {
    operationId: string;
    kind: "changes";
    phase: "submitting" | "unknown";
    at: string;
    requestHash: string;
    intent?: Record<string, unknown>;
    reason?: string;
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
