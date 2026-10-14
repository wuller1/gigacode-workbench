import {
  opsReadOperations,
  opsActionOperations,
} from "../../shared/operations";
export const operationsProtocol = [
  "configure",
  "probe",
  "prepare",
  "execute",
  "reconcile",
  ...opsReadOperations,
];
export const operationsToolSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: operationsProtocol },
    arguments: { type: "object" },
  },
  required: ["operation", "arguments"],
  additionalProperties: false,
};
export function validateEnvelope(
  value: any,
  operation?: string,
  input: Record<string, any> = {},
) {
  if (
    !value ||
    typeof value !== "object" ||
    !("data" in value) ||
    typeof value.observedAt !== "string" ||
    !Array.isArray(value.warnings)
  )
    throw new Error("Operations response does not match query protocol v1");
  const d = value.data,
    record = (v: any) => !!v && typeof v === "object" && !Array.isArray(v),
    str = (v: any) => typeof v === "string",
    integer = (v: any) => Number.isSafeInteger(v) && v >= 0;
  const job = (j: any) =>
    record(j) &&
    ["id", "name", "fullName", "url", "kind"].every((k) => str(j[k])) &&
    ["folder", "runnable", "disabled"].every((k) => typeof j[k] === "boolean");
  const item = (o: any) =>
    record(o) && record(o.metadata) && str(o.metadata.name);
  let valid = true;
  if (operation === "ci.jobs")
    valid =
      record(d) &&
      Array.isArray(d.jobs) &&
      d.jobs.length <= 500 &&
      d.jobs.every(job) &&
      typeof d.complete === "boolean";
  if (operation === "ci.job")
    valid =
      job(d) &&
      Array.isArray(d.parameters) &&
      d.parameters.every(
        (p: any) =>
          record(p) &&
          str(p.name) &&
          str(p.type) &&
          typeof p.supported === "boolean",
      ) &&
      Array.isArray(d.builds);
  if (operation === "ci.queue")
    valid =
      record(d) &&
      Array.isArray(d.items) &&
      d.items.length <= 1000 &&
      d.items.every((q: any) => record(q) && integer(q.id));
  if (operation === "ci.run")
    valid =
      record(d) &&
      (input.queueId !== undefined
        ? integer(d.id)
        : integer(d.number) &&
          d.number > 0 &&
          typeof d.building === "boolean" &&
          (d.result === null || str(d.result)));
  if (operation === "ci.logs" || operation === "cluster.logs")
    valid =
      record(d) &&
      str(d.text) &&
      Buffer.byteLength(d.text) <= 512 * 1024 &&
      typeof d.hasMore === "boolean" &&
      typeof d.truncated === "boolean" &&
      (operation !== "ci.logs" ||
        (str(d.cursor) && /^\d+(?:\.wb\.[0-9a-f-]{36}\.\d+)?$/.test(d.cursor)));
  if (operation === "ci.artifacts")
    valid =
      record(d) &&
      Array.isArray(d.artifacts) &&
      d.artifacts.length <= 1000 &&
      d.artifacts.every(
        (a: any) => record(a) && str(a.fileName) && str(a.relativePath),
      );
  if (
    ["cluster.list", "cluster.namespaces", "cluster.events"].includes(
      operation || "",
    )
  )
    valid =
      record(d) &&
      Array.isArray(d.items) &&
      d.items.length <= 500 &&
      d.items.every(item) &&
      record(d.metadata);
  if (operation === "cluster.get")
    valid = item(d) && str(d.apiVersion) && str(d.kind);
  if (operation === "cluster.discovery")
    valid =
      record(d) &&
      record(d.version) &&
      Array.isArray(d.resources) &&
      d.resources.length <= 10000 &&
      d.resources.every(
        (r: any) =>
          record(r) &&
          ["group", "version", "resource", "kind"].every((k) => str(r[k])) &&
          typeof r.namespaced === "boolean" &&
          Array.isArray(r.verbs) &&
          r.verbs.every(str),
      );
  if (operation === "cluster.watch")
    valid =
      record(d) &&
      Array.isArray(d.events) &&
      d.events.length <= 500 &&
      d.events.every(
        (e: any) =>
          record(e) &&
          ["ADDED", "MODIFIED", "DELETED", "BOOKMARK"].includes(e.type) &&
          record(e.object) &&
          record(e.object.metadata),
      );
  if (!valid)
    throw new Error(
      "Operations response does not match " + operation + " output schema",
    );
  return value;
}
export function isAction(
  value: unknown,
): value is (typeof opsActionOperations)[number] {
  return opsActionOperations.includes(value as any);
}
