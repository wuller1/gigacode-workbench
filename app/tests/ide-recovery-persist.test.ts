import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SerializedRecoveryPublisher } from "../electron/ide-recovery-persist";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function destination() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wb-ide-recovery-publish-"),
  );
  directories.push(directory);
  const file = path.join(directory, "workbench-recovery.json");
  await fs.writeFile(file, "previous-confirmed-recovery");
  return { directory, file };
}

describe("host offline IDE recovery publication", () => {
  it("invalidates timed-out A before publication and serializes retry B behind A's late fsync", async () => {
    const { file, directory } = await destination();
    const enteredA = latch(),
      releaseA = latch(),
      enteredB = latch(),
      releaseB = latch();
    let syncing = 0;
    const publisher = new SerializedRecoveryPublisher({
      syncFile: async (handle) => {
        syncing++;
        if (syncing === 1) {
          enteredA.release();
          await releaseA.promise;
        } else {
          enteredB.release();
          await releaseB.promise;
        }
        await handle.sync();
      },
    });
    const a = publisher.begin(file);
    const writingA = publisher.persist(a, "T0-old-editor");
    let writingB: Promise<void> | undefined;
    try {
      await enteredA.promise;
      await expect(a.withTimeout(writingA, 25)).rejects.toThrow(
        /IDE_CLOSE_BLOCKED/,
      );
      expect(() => a.assertCurrent()).toThrow(/IDE_RECOVERY_CANCELLED/);
      const b = publisher.begin(file);
      writingB = publisher.persist(b, "T1-new-editor");
      await Promise.resolve();
      expect(syncing).toBe(1);
      releaseA.release();
      await expect(writingA).rejects.toThrow(/IDE_RECOVERY_CANCELLED/);
      await enteredB.promise;
      // A's real filesystem write/sync finished after timeout. It must not
      // replace the prior confirmed file even while B is waiting on its sync.
      expect(await fs.readFile(file, "utf8")).toBe(
        "previous-confirmed-recovery",
      );
      releaseB.release();
      await writingB;
      expect(await fs.readFile(file, "utf8")).toBe("T1-new-editor");
      expect(
        (await fs.readdir(directory)).filter((name) =>
          name.includes(".partial-"),
        ),
      ).toEqual([]);
      b.cancel();
    } finally {
      a.cancel();
      releaseA.release();
      releaseB.release();
      await Promise.allSettled([writingA, ...(writingB ? [writingB] : [])]);
    }
  });

  it("a newer attempt supersedes an old in-flight writer even without an explicit cancel", async () => {
    const { file } = await destination();
    const enteredA = latch(),
      releaseA = latch();
    let syncing = 0;
    const publisher = new SerializedRecoveryPublisher({
      syncFile: async (handle) => {
        if (++syncing === 1) {
          enteredA.release();
          await releaseA.promise;
        }
        await handle.sync();
      },
    });
    const a = publisher.begin(file);
    const writingA = publisher.persist(a, "T0");
    let writingB: Promise<void> | undefined;
    try {
      await enteredA.promise;
      const b = publisher.begin(file);
      writingB = publisher.persist(b, "T1");
      expect(() => a.assertCurrent()).toThrow(/IDE_RECOVERY_CANCELLED/);
      releaseA.release();
      await expect(writingA).rejects.toThrow(/IDE_RECOVERY_CANCELLED/);
      await writingB;
      expect(await fs.readFile(file, "utf8")).toBe("T1");
      b.cancel();
    } finally {
      a.cancel();
      releaseA.release();
      await Promise.allSettled([writingA, ...(writingB ? [writingB] : [])]);
    }
  });
});
