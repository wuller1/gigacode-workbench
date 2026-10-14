import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotFeed, validSnapshot } from "../src/snapshot-feed";
import type { AppState } from "../shared/types";
const snapshot = (revision: number): AppState => ({
  schemaVersion: 1,
  revision,
  projects: [],
  tasks: [],
  sessions: [],
  profiles: [],
  artifacts: [],
  questions: [],
  settings: {
    cliPath: "",
    cliArgs: [],
    model: "",
    reasoning: "",
    contextLimit: 0,
    maxConcurrent: 1,
    theme: "dark",
    reducedMotion: false,
    startupRetries: 0,
    permissionMode: "auto_allow_bound",
  },
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());
describe("read-only renderer snapshot recovery", () => {
  it("repairs a missed event by polling without requiring a click", async () => {
    vi.useFakeTimers();
    const states: number[] = [],
      read = vi
        .fn()
        .mockResolvedValueOnce(snapshot(1))
        .mockResolvedValue(snapshot(2));
    const feed = new SnapshotFeed({
      read,
      onState: (value) => states.push(value.revision),
      onError: vi.fn(),
    });
    await feed.start();
    expect(states).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(states).toEqual([1, 2]);
    feed.stop();
  });
  it("automatically retries initial failures and retains the last good screen during later failure", async () => {
    vi.useFakeTimers();
    const states: number[] = [],
      errors: string[] = [];
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("private gateway body"))
      .mockResolvedValueOnce(snapshot(1))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(snapshot(2));
    const feed = new SnapshotFeed({
      read,
      onState: (value) => states.push(value.revision),
      onError: (value) => errors.push(value),
    });
    await feed.start();
    expect(states).toEqual([]);
    expect(errors.at(-1)).not.toContain("private gateway");
    await vi.advanceTimersByTimeAsync(500);
    expect(states).toEqual([1]);
    await feed.refresh();
    expect(states).toEqual([1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(states).toEqual([1, 2]);
    expect(errors.at(-1)).toBe("");
    feed.stop();
  });
  it("a timed-out late read cannot regress or replace a newer accepted state", async () => {
    vi.useFakeTimers();
    const old = deferred(),
      states: number[] = [];
    const read = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(snapshot(3));
    const feed = new SnapshotFeed({
      read,
      deadlineMs: 50,
      onState: (value) => states.push(value.revision),
      onError: vi.fn(),
    });
    void feed.start();
    await vi.advanceTimersByTimeAsync(550);
    expect(states).toEqual([3]);
    old.resolve(snapshot(99));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([3]);
    feed.stop();
  });
  it("bounds orphaned IPC reads rather than accumulating promises indefinitely", async () => {
    vi.useFakeTimers();
    const hanging = deferred(),
      states: number[] = [];
    const read = vi.fn(() => hanging.promise);
    const feed = new SnapshotFeed({
      read,
      deadlineMs: 20,
      onState: (value) => states.push(value.revision),
      onError: vi.fn(),
    });
    void feed.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(2);
    feed.stop();
    hanging.resolve(snapshot(7));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("event storms and focus refresh cannot bypass the failed-read backoff", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const read = vi.fn(async () => {
      starts.push(Date.now());
      throw new Error("Owned failed state read");
    });
    const feed = new SnapshotFeed({ read, onState: vi.fn(), onError: vi.fn() });
    await feed.start();
    for (let elapsed = 0; elapsed < 3100; elapsed += 10) {
      feed.invalidate();
      void feed.refresh();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(read).toHaveBeenCalledTimes(3);
    expect(starts.slice(1).map((at, i) => at - starts[i])).toEqual([500, 1000]);
    feed.stop();
  });
  it("coalesces an event burst and does not lose an invalidation arriving during a read", async () => {
    vi.useFakeTimers();
    const first = deferred(),
      states: number[] = [];
    const read = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(snapshot(2));
    const feed = new SnapshotFeed({
      read,
      onState: (value) => states.push(value.revision),
      onError: vi.fn(),
    });
    void feed.start();
    for (let n = 0; n < 100; n++) feed.invalidate();
    first.resolve(snapshot(1));
    await vi.advanceTimersByTimeAsync(75);
    expect(states).toEqual([1, 2]);
    expect(read).toHaveBeenCalledTimes(2);
    feed.stop();
  });
  it("rejects a stale revision and malformed nested transport data before rendering", async () => {
    vi.useFakeTimers();
    const states: number[] = [];
    const read = vi
      .fn()
      .mockResolvedValueOnce(snapshot(5))
      .mockResolvedValueOnce(snapshot(4))
      .mockResolvedValueOnce({ ...snapshot(6), sessions: null })
      .mockResolvedValue(snapshot(7));
    const feed = new SnapshotFeed({
      read,
      onState: (value) => states.push(value.revision),
      onError: vi.fn(),
    });
    await feed.start();
    await feed.refresh();
    await feed.refresh();
    expect(states).toEqual([5]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(states).toEqual([5, 7]);
    feed.stop();
    expect(
      validSnapshot({
        ...snapshot(0),
        questions: [{ id: "q", title: "Question", options: null }],
      }),
    ).toBe(false);
    expect(validSnapshot({ ...snapshot(0), revision: NaN })).toBe(false);
  });
});
