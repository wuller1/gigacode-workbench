import type { DatabaseOperation } from "./protocol";
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: any) => typeof v === "string";
const integer = (v: any) => Number.isSafeInteger(v) && v >= 0;
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
  v.results.every(result);
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
  else if (op === "describe")
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
