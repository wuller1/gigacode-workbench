import { describe, expect, it } from "vitest";
import { validateDatabaseResponse } from "../electron/database/response";

const job = () => ({
  id: "job-1",
  operationId: "operation-1",
  consoleId: "console-1",
  kind: "query",
  startedAt: "2026-10-14T00:00:00Z",
  status: "completed",
  rows: 0,
  bytes: 0,
  results: [],
});
const routine = (committed = false) => ({
  oid: "42",
  previousHash: "a".repeat(64),
  appliedHash: "b".repeat(64),
  committed,
});
const args = { consoleId: "console-1" };

describe("Database MCP routine outcome boundary", () => {
  it.each([false, true])(
    "accepts an explicit boolean committed=%s for direct and status job responses",
    (committed) => {
      const direct = { ...job(), routine: routine(committed) };
      expect(validateDatabaseResponse("routineApply", direct, args)).toBe(
        direct,
      );
      const status = { leases: [], jobs: [direct] };
      expect(validateDatabaseResponse("status", status, {})).toBe(status);
    },
  );

  it.each([
    ["string false", { ...routine(), committed: "false" }],
    ["string true", { ...routine(), committed: "true" }],
    ["numeric committed", { ...routine(), committed: 0 }],
    ["missing committed", { ...routine(), committed: undefined }],
    ["short previous hash", { ...routine(), previousHash: "a" }],
    ["nonhex applied hash", { ...routine(), appliedHash: "z".repeat(64) }],
    ["missing applied hash", { ...routine(), appliedHash: undefined }],
    ["nonnumeric OID", { ...routine(), oid: "another-object" }],
    ["numeric rather than text OID", { ...routine(), oid: 42 }],
    ["zero OID", { ...routine(), oid: "0" }],
    ["OID outside PostgreSQL uint32", { ...routine(), oid: "4294967296" }],
    ["null routine metadata", null],
  ])(
    "rejects %s before it can update the canonical job or committed baseline",
    (_name, outcome) => {
      const direct = { ...job(), routine: outcome };
      expect(() =>
        validateDatabaseResponse("routineApply", direct, args),
      ).toThrow(/Data protocol/);
      expect(() =>
        validateDatabaseResponse("status", { leases: [], jobs: [direct] }, {}),
      ).toThrow(/Data protocol/);
    },
  );

  it("keeps routine metadata optional for ordinary query jobs", () => {
    const direct = job();
    expect(validateDatabaseResponse("execute", direct, args)).toBe(direct);
    const status = { leases: [], jobs: [direct] };
    expect(validateDatabaseResponse("status", status, {})).toBe(status);
  });
});
