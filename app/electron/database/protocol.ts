export const databaseOperations = [
  "open",
  "close",
  "status",
  "execute",
  "cancel",
  "page",
  "dropResult",
  "catalog",
  "describe",
  "transaction",
  "table",
  "changes",
  "routineApply",
  "admin",
  "import",
  "export",
  "metrics",
  "jobRead",
] as const;
export type DatabaseOperation = (typeof databaseOperations)[number];
export const databaseToolSchema = {
  type: "object" as const,
  properties: {
    operation: { type: "string", enum: [...databaseOperations] },
    arguments: { type: "object", additionalProperties: true },
  },
  required: ["operation", "arguments"],
  additionalProperties: false,
};
