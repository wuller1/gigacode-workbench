import { describe, expect, it } from "vitest";
import {
  createContextCalibrationProbe,
  scoreContextCalibration,
  runContextCalibration,
} from "../electron/context-calibration.js";

const identity = {
  provider: "fixture",
  model: "owned-loopback",
  endpointKey: "loopback-only",
};
describe("opt-in context calibration without false capacity claims", () => {
  it("randomizes five independent positions and fits the exact requested byte length", () => {
    const p = createContextCalibrationProbe(10000),
      second = createContextCalibrationProbe(10000);
    expect(p.inputBytes).toBe(10000);
    expect(p.oracle).not.toEqual(second.oracle);
    const indexes = Object.entries(p.oracle).map(([key, value]) =>
      p.input.indexOf(`CALIBRATION_VALUE ${key}=${value}`),
    );
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(indexes[4]).toBeGreaterThan(9500);
    expect(scoreContextCalibration(p, JSON.stringify(p.oracle))).toBe(true);
    expect(
      scoreContextCalibration(
        p,
        JSON.stringify({ ...p.oracle, middle: "guessed" }),
      ),
    ).toBe(false);
    expect(
      scoreContextCalibration(
        p,
        JSON.stringify({ ...p.oracle, explanation: "extra" }),
      ),
    ).toBe(false);
    expect(
      scoreContextCalibration(
        p,
        "```json\n" + JSON.stringify(p.oracle) + "\n```",
      ),
    ).toBe(false);
  });
  const options = (patch: Record<string, unknown> = {}) => ({
    identity,
    explicitlyEnabled: true,
    maxBudgetUsd: 0.01,
    inputBytes: [2048, 4096],
    timeoutMs: 100,
    quoteCeilingUsd: () => 0.004,
    execute: async (
      probe: ReturnType<typeof createContextCalibrationProbe>,
    ) => ({
      output: JSON.stringify(probe.oracle),
      promptTokens: probe.inputBytes / 2,
      requestReference: "owned-request",
    }),
    persistReceipt: async () => {},
    ...patch,
  });
  it("requires explicit enablement and a price ceiling before any execution", async () => {
    let dispatched = 0;
    const execute = async () => {
      dispatched++;
      return { output: "{}" };
    };
    await expect(
      runContextCalibration(options({ explicitlyEnabled: false, execute })),
    ).rejects.toThrow("disabled");
    await expect(
      runContextCalibration(options({ quoteCeilingUsd: () => 1, execute })),
    ).rejects.toThrow("ceiling");
    expect(dispatched).toBe(0);
  });
  it("quotes the entire bounded series before dispatch so an unaffordable later size cannot lose paid partial evidence", async () => {
    let dispatched = 0;
    await expect(
      runContextCalibration(
        options({
          maxBudgetUsd: 0.007,
          execute: async () => {
            dispatched++;
            return { output: "{}" };
          },
        }),
      ),
    ).rejects.toThrow(/ceiling/);
    expect(dispatched).toBe(0);
  });
  it("persists each receipt before the next probe and records recall separately from request acceptance", async () => {
    const order: string[] = [];
    const result = await runContextCalibration(
      options({
        execute: async (
          p: ReturnType<typeof createContextCalibrationProbe>,
        ) => {
          order.push("execute");
          return { output: JSON.stringify(p.oracle), promptTokens: 1000 };
        },
        persistReceipt: async () => {
          order.push("persist");
        },
      }),
    );
    expect(order).toEqual(["execute", "persist", "execute", "persist"]);
    expect(result).toMatchObject({
      fullContextVerified: false,
      reservedBudgetUsd: 0.008,
    });
    expect(result.receipts.every((r) => r.status === "recall_passed")).toBe(
      true,
    );
    expect(result.evidence.map((e) => e.kind)).toEqual([
      "accepted_request",
      "verified_recall",
      "accepted_request",
      "verified_recall",
    ]);
  });
  it("does not equate a successful HTTP response with usable recall or infer token counts from bytes", async () => {
    let calls = 0;
    const result = await runContextCalibration(
      options({
        execute: async () => {
          calls++;
          return { output: "{}" };
        },
      }),
    );
    expect(calls).toBe(1);
    expect(result.receipts[0].status).toBe("recall_failed");
    expect(result.receipts[0].promptTokens).toBeUndefined();
    expect(result.evidence).toEqual([]);
  });
  it("bounds a hung request, persists UNKNOWN and never retries or dispatches the next step", async () => {
    let calls = 0,
      saved = 0;
    const result = await runContextCalibration(
      options({
        execute: async () => {
          calls++;
          return new Promise(() => {});
        },
        persistReceipt: async () => {
          saved++;
        },
      }),
    );
    expect(calls).toBe(1);
    expect(saved).toBe(1);
    expect(result.receipts[0].status).toBe("unknown");
  });
  it("stops after a persistence failure and redacts URL-like request references by omission", async () => {
    let calls = 0;
    await expect(
      runContextCalibration(
        options({
          execute: async (
            p: ReturnType<typeof createContextCalibrationProbe>,
          ) => {
            calls++;
            return { output: JSON.stringify(p.oracle) };
          },
          persistReceipt: async () => {
            throw new Error("disk");
          },
        }),
      ),
    ).rejects.toThrow("disk");
    expect(calls).toBe(1);
    const result = await runContextCalibration(
      options({
        inputBytes: [2048],
        execute: async (
          p: ReturnType<typeof createContextCalibrationProbe>,
        ) => ({
          output: JSON.stringify(p.oracle),
          requestReference: "https://user:secret@example.test?token=hidden",
        }),
      }),
    );
    expect(result.receipts[0].requestReference).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("hidden");
  });
});
