import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shutdownUnconfirmed,
  startShutdown,
  waitForShutdown,
} from "../electron/shutdown";

afterEach(() => vi.useRealTimers());

describe("bounded owned shutdown", () => {
  it("narrows unknown receipt shapes without treating arbitrary strings or arrays as persistence evidence", () => {
    expect(
      shutdownUnconfirmed([
        { status: "fulfilled", value: "saved" },
        { status: "fulfilled", value: null },
        { status: "fulfilled", value: { unconfirmed: "not-an-array" } },
        { status: "fulfilled", value: [] },
        { status: "fulfilled", value: false },
        { status: "fulfilled", value: undefined },
      ]),
    ).toEqual([]);
    expect(
      shutdownUnconfirmed([
        { status: "rejected", reason: undefined },
        { status: "fulfilled", value: undefined },
        { status: "rejected", reason: null },
      ]),
    ).toEqual(["agent runtime", "terminal"]);
  });
  it.each(["failed", "pending"])(
    "reports known %s persistence even when cleanup settles before the deadline",
    async (persistence) => {
      const outcome = await waitForShutdown(
        startShutdown([
          () => ({ persistence }),
          () => undefined,
          () => ({ unconfirmed: [] }),
          () => undefined,
          () => undefined,
          () => undefined,
        ]),
        1000,
      );
      expect(outcome.settled).toBe(true);
      if (!outcome.settled) throw new Error("Expected actual settled cleanup");
      expect(shutdownUnconfirmed(outcome.results)).toEqual(["agent runtime"]);
    },
  );
  it("accepts explicit saved persistence and empty terminal uncertainty without inventing owner failures", async () => {
    const results = await startShutdown([
      () => ({ persistence: "saved" }),
      () => undefined,
      () => ({ unconfirmed: [] }),
      () => undefined,
      () => undefined,
      () => undefined,
    ]);
    expect(shutdownUnconfirmed(results)).toEqual([]);
    expect(shutdownUnconfirmed([])).toEqual([]);
  });
  it("reports terminal uncertainty even though its close promise fulfilled", async () => {
    const results = await startShutdown([
      () => ({ persistence: "saved" }),
      () => undefined,
      () => ({ unconfirmed: ["owned-terminal-1"] }),
    ]);
    expect(shutdownUnconfirmed(results)).toEqual(["terminal"]);
  });
  it("keeps every rejected owner and combines independent failures without calling them saved", async () => {
    const results = await startShutdown([
      () => ({ persistence: "failed" }),
      () => {
        throw new Error("MCP cleanup fault");
      },
      () => ({ unconfirmed: ["terminal-1"] }),
      () => Promise.reject(new Error("IDE cleanup fault")),
      () => Promise.reject(new Error("Data cleanup fault")),
      () => Promise.reject(new Error("Operations cleanup fault")),
    ]);
    expect(shutdownUnconfirmed(results)).toEqual([
      "agent runtime",
      "MCP",
      "terminal",
      "IDE",
      "Data",
      "Operations",
    ]);
  });
  it("starts every cleanup despite synchronous throws and rejected owners", async () => {
    const failure = new Error("sync cleanup failure");
    const calls: string[] = [];
    const pending = startShutdown([
      () => {
        calls.push("first");
        throw failure;
      },
      () => {
        calls.push("second");
        return Promise.reject(new Error("async cleanup failure"));
      },
      () => {
        calls.push("third");
        return "closed";
      },
    ]);
    expect(calls).toEqual(["first", "second", "third"]);
    const result = await waitForShutdown(pending, 100);
    expect(result).toEqual({
      settled: true,
      results: [
        { status: "rejected", reason: failure },
        { status: "rejected", reason: expect.any(Error) },
        { status: "fulfilled", value: "closed" },
      ],
    });
  });

  it("times out without cancelling hung cleanup and keeps a late rejection observed", async () => {
    vi.useFakeTimers();
    let reject!: (reason: unknown) => void;
    const hung = new Promise((_, fail) => {
      reject = fail;
    });
    const cleanup = startShutdown([
      () => hung,
      () => Promise.resolve("other closed"),
    ]);
    const waiting = waitForShutdown(cleanup, 50);
    await vi.advanceTimersByTimeAsync(49);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toEqual({ settled: false });
    const late = new Error("late owner failure");
    reject(late);
    expect(await cleanup).toEqual([
      { status: "rejected", reason: late },
      { status: "fulfilled", value: "other closed" },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline when all owners settle before it", async () => {
    vi.useFakeTimers();
    const waiting = waitForShutdown(startShutdown([() => "closed"]), 5000);
    expect(await waiting).toEqual({
      settled: true,
      results: [{ status: "fulfilled", value: "closed" }],
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes an unexpected aggregate rejection even after timeout", async () => {
    vi.useFakeTimers();
    let reject!: (reason: unknown) => void;
    const aggregate = new Promise<PromiseSettledResult<unknown>[]>(
      (_, fail) => {
        reject = fail;
      },
    );
    const waiting = waitForShutdown(aggregate, 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toEqual({ settled: false });
    reject(new Error("unexpected aggregate failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
