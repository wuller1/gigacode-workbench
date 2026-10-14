import type { DatabaseOperation } from "./protocol";
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: any) => typeof v === "string";
const integer = (v: any) => Number.isSafeInteger(v) && v >= 0;
const routine = (v: any) =>
  object(v) &&
  text(v.oid) &&
  /^\d{1,10}$/.test(v.oid) &&
  Number(v.oid) > 0 &&
  Number(v.oid) <= 4294967295 &&
  [v.previousHash, v.appliedHash].every(
    (hash) => text(hash) && /^[0-9a-f]{64}$/.test(hash),
  ) &&
  typeof v.committed === "boolean";
const field = (v: any) => object(v) && text(v.name) && integer(v.typeId);
const result = (v: any) =>
  object(v) &&
  text(v.id) &&
  Array.isArray(v.fields) &&
  v.fields.length <= 2000 &&
  v.fields.every(field) &&
  integer(v.rows) &&
  integer(v.bytes) &&
  text(v.command) &&
  Number.isFinite(v.elapsedMs);
const lease = (v: any) =>
  object(v) &&
  ["id", "connectionId", "database", "user", "server", "generation"].every(
    (k) => text(v[k]),
  ) &&
  ["idle", "active", "failed", "unknown"].includes(v.transaction) &&
  ["auto", "manual"].includes(v.mode) &&
  typeof v.busy === "boolean" &&
  typeof v.readOnly === "boolean";
const job = (v: any) =>
  object(v) &&
  ["id", "operationId", "consoleId", "kind", "startedAt"].every((k) =>
    text(v[k]),
  ) &&
  ["running", "completed", "failed", "cancelled", "unknown"].includes(
    v.status,
  ) &&
  integer(v.rows) &&
  integer(v.bytes) &&
  Array.isArray(v.results) &&
  v.results.length <= 1000 &&
  v.results.every(result) &&
  (v.routine === undefined || routine(v.routine));
/** External MCP adapters must prove their Data v1 output before it reaches canonical state/UI. */
export function validateDatabaseResponse(
  op: DatabaseOperation,
  value: any,
  args: Record<string, any>,
) {
  let valid = true;
  if (op === "open" || op === "transaction")
    valid =
      lease(value) &&
      (op !== "open" || value.connectionId === args.connection?.id);
  else if (op === "status")
    valid =
      object(value) &&
      Array.isArray(value.leases) &&
      value.leases.length <= 100 &&
      value.leases.every(lease) &&
      Array.isArray(value.jobs) &&
      value.jobs.length <= 500 &&
      value.jobs.every(job);
  else if (
    ["execute", "table", "routineApply", "import", "export"].includes(op)
  )
    valid = job(value) && value.consoleId === args.consoleId;
  else if (op === "page")
    valid =
      result(value) &&
      value.id === args.resultId &&
      integer(value.offset) &&
      Array.isArray(value.values) &&
      value.values.length <= 500 &&
      value.values.every(
        (row: any) =>
          Array.isArray(row) &&
          row.length === value.fields.length &&
          row.every((cell: any) => cell === null || text(cell)),
      );
  else if (op === "catalog")
    valid =
      object(value) &&
      Array.isArray(value.schemas) &&
      value.schemas.length <= 10000 &&
      value.schemas.every((s: any) => object(s) && text(s.name)) &&
      Array.isArray(value.objects) &&
      value.objects.length <= 10000 &&
      value.objects.every(
        (o: any) =>
          object(o) &&
          ["oid", "schema", "name", "kind"].every((k) => text(o[k])),
      );
  else if (op === "relations") {
    const oid = (v: any) => text(v) && /^\d{1,10}$/.test(v);
    const action = (v: any) =>
      ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"].includes(
        v,
      );
    valid =
      object(value) &&
      value.rootOid === args.oid &&
      text(value.capturedAt) &&
      value.scope === "direct-foreign-keys" &&
      object(value.limits) &&
      value.limits.nodes === 30 &&
      value.limits.edges === 50 &&
      value.limits.columnsPerNode === 8 &&
      object(value.totals) &&
      integer(value.totals.nodes) &&
      integer(value.totals.edges) &&
      typeof value.truncated === "boolean" &&
      Array.isArray(value.nodes) &&
      value.nodes.length > 0 &&
      value.nodes.length <= 30 &&
      value.nodes.every(
        (n: any) =>
          object(n) &&
          oid(n.oid) &&
          text(n.schema) &&
          text(n.name) &&
          ["r", "p", "f"].includes(n.kind) &&
          integer(n.columnCount) &&
          typeof n.columnsTruncated === "boolean" &&
          Array.isArray(n.columns) &&
          n.columns.length <= 8 &&
          n.columnCount >= n.columns.length &&
          n.columns.every(
            (c: any) =>
              object(c) &&
              integer(c.ordinal) &&
              c.ordinal > 0 &&
              text(c.name) &&
              text(c.type) &&
              typeof c.primaryKey === "boolean",
          ),
      ) &&
      value.nodes.some((n: any) => n.oid === args.oid) &&
      new Set(value.nodes.map((n: any) => n.oid)).size === value.nodes.length &&
      Array.isArray(value.edges) &&
      value.edges.length <= 50 &&
      value.edges.every(
        (e: any) =>
          object(e) &&
          oid(e.oid) &&
          text(e.name) &&
          [e.sourceOid, e.targetOid].every((id) =>
            value.nodes.some((n: any) => n.oid === id),
          ) &&
          [e.sourceOid, e.targetOid].includes(value.rootOid) &&
          Array.isArray(e.columns) &&
          e.columns.length > 0 &&
          e.columns.length <= 1600 &&
          e.columns.every(
            (c: any, i: number) =>
              object(c) &&
              c.ordinal === i + 1 &&
              text(c.source) &&
              text(c.target),
          ) &&
          action(e.onUpdate) &&
          action(e.onDelete) &&
          ["SIMPLE", "FULL", "PARTIAL"].includes(e.match) &&
          [e.validated, e.deferrable, e.initiallyDeferred].every(
            (v) => typeof v === "boolean",
          ),
      ) &&
      new Set(value.edges.map((e: any) => e.oid)).size === value.edges.length &&
      value.totals.nodes >= value.nodes.length &&
      value.totals.edges >= value.edges.length;
  } else if (op === "describe")
    valid =
      object(value) &&
      text(value.oid) &&
      text(value.name) &&
      text(value.schema) &&
      (["function", "procedure"].includes(args.kind)
        ? text(value.ddl) && /^[0-9a-f]{64}$/.test(value.hash)
        : Array.isArray(value.columns) &&
          value.columns.length <= 2000 &&
          value.columns.every(
            (c: any) => object(c) && text(c.name) && text(c.type),
          ));
  else if (op === "changes")
    valid =
      object(value) &&
      integer(value.applied) &&
      typeof value.committed === "boolean";
  else if (op === "close") valid = object(value) && value.closed === true;
  else if (op === "cancel")
    valid = object(value) && typeof value.requested === "boolean";
  else if (op === "dropResult") valid = object(value) && value.deleted === true;
  else if (op === "admin") valid = Array.isArray(value) && value.length <= 1000;
  else if (op === "metrics") valid = object(value);
  else if (op === "operationList")
    valid =
      object(value) &&
      Array.isArray(value.operations) &&
      value.operations.length <= 50 &&
      value.operations.every(
        (o: any) =>
          object(o) && text(o.operationId) && text(o.kind) && text(o.at),
      ) &&
      integer(value.offset) &&
      typeof value.hasMore === "boolean";
  else if (op === "operationRead")
    valid =
      object(value) &&
      value.consoleId === args.consoleId &&
      value.operationId === args.operationId &&
      text(value.text) &&
      value.text.length <= 32768 &&
      integer(value.offset) &&
      integer(value.total) &&
      /^[0-9a-f]{64}$/.test(value.hash);
  else if (op === "jobRead")
    valid =
      object(value) &&
      value.jobId === args.jobId &&
      text(value.text) &&
      value.text.length <= 32768 &&
      integer(value.offset) &&
      integer(value.total) &&
      /^[0-9a-f]{64}$/.test(value.hash) &&
      ["sql", "request"].includes(value.part);
  if (!valid)
    throw new Error(
      `Ответ MCP для «${op}» не соответствует Data protocol v1. Состояние приложения не обновлено; проверьте адаптер.`,
    );
  return value;
}
