import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  compileInstructions,
  retainInstructions,
  readRetainedInstructions,
} from "../electron/prompt-binding.js";
const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of folders.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
async function temporary() {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "workbench-instructions-"),
  );
  folders.push(dir);
  return dir;
}
describe("recoverable instruction versions", () => {
  it("binds retained content into the historical fingerprint even if its standalone hash is recomputed", async () => {
    const dir = await temporary();
    const compiled = compileInstructions({
      core: "Common",
      role: "Accepted version",
      profileId: "qa",
    });
    await retainInstructions(dir, compiled);
    const altered = {
      ...compiled,
      text: "Different instructions",
      contentHash: createHash("sha256")
        .update("Different instructions")
        .digest("hex"),
    };
    await fs.writeFile(
      path.join(dir, "instructions", `${compiled.fingerprint}.json`),
      JSON.stringify(altered),
    );
    await expect(
      readRetainedInstructions(dir, compiled.fingerprint),
    ).rejects.toThrow("corrupt");
  });
  it("retains exact old versions after a role is updated, without cross-version overwrite", async () => {
    const dir = await temporary();
    const old = compileInstructions({
      core: "Facts and recovery",
      role: "Old accepted role",
      profileId: "analyst",
    });
    const next = compileInstructions({
      core: "Facts and recovery",
      role: "Updated role",
      profileId: "analyst",
    });
    await retainInstructions(dir, old);
    await retainInstructions(dir, next);
    expect((await readRetainedInstructions(dir, old.fingerprint)).text).toBe(
      old.text,
    );
    expect((await readRetainedInstructions(dir, next.fingerprint)).text).toBe(
      next.text,
    );
  });
  it("deduplicates simultaneous identical snapshots and leaves no temporary files", async () => {
    const dir = await temporary();
    const compiled = compileInstructions({
      core: "Общие правила",
      role: "Роль разработчика",
      profileId: "backend",
    });
    await Promise.all(
      Array.from({ length: 8 }, () => retainInstructions(dir, compiled)),
    );
    expect(await fs.readdir(path.join(dir, "instructions"))).toEqual([
      `${compiled.fingerprint}.json`,
    ]);
    expect(
      (await readRetainedInstructions(dir, compiled.fingerprint)).contentHash,
    ).toBe(compiled.contentHash);
  });
  it("preserves a corrupt version instead of silently rewriting historical evidence", async () => {
    const dir = await temporary();
    const compiled = compileInstructions({
      core: "Common",
      role: "Role",
      profileId: "qa",
    });
    await retainInstructions(dir, compiled);
    const file = path.join(dir, "instructions", `${compiled.fingerprint}.json`);
    await fs.writeFile(file, "{corrupt");
    await expect(retainInstructions(dir, compiled)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("{corrupt");
    await expect(readRetainedInstructions(dir, "../escape")).rejects.toThrow(
      "fingerprint",
    );
  });

  const observeSync = (
    around: (location: string, sync: () => Promise<void>) => Promise<void>,
  ) => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(() =>
        around(String(file), sync),
      );
      return handle;
    });
  };

  it.skipIf(process.platform === "win32")(
    "acknowledges a new snapshot only after its file and containing directory entries are synced",
    async () => {
      const dir = await temporary();
      const compiled = compileInstructions({
        core: "Common",
        role: "Durable",
        profileId: "qa",
      });
      const steps: string[] = [];
      observeSync(async (location, sync) => {
        await sync();
        steps.push(
          location === dir
            ? "parent"
            : location === path.join(dir, "instructions")
              ? "directory"
              : "file",
        );
      });
      const rename = fs.rename.bind(fs);
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await rename(from, to);
        steps.push("rename");
      });
      await retainInstructions(dir, compiled);
      steps.push("acknowledged");
      expect(steps).toEqual([
        "file",
        "rename",
        "directory",
        "parent",
        "acknowledged",
      ]);
    },
  );

  it.skipIf(process.platform === "win32").each(["directory", "parent"])(
    "refuses acknowledgement when the %s sync fails, including an existing-file retry",
    async (failure) => {
      const dir = await temporary();
      const compiled = compileInstructions({
        core: "Common",
        role: "Failure preserved",
        profileId: "qa",
      });
      const failedPath =
        failure === "directory" ? path.join(dir, "instructions") : dir;
      let failing = true;
      observeSync(async (location, sync) => {
        if (failing && location === failedPath)
          throw new Error("Injected directory sync failure");
        await sync();
      });
      const rename = vi.spyOn(fs, "rename");
      await expect(retainInstructions(dir, compiled)).rejects.toThrow(
        "Injected directory sync failure",
      );
      expect(
        (await readRetainedInstructions(dir, compiled.fingerprint)).text,
      ).toBe(compiled.text);
      // A visible rename is insufficient: retry must establish its own durability barrier.
      await expect(retainInstructions(dir, compiled)).rejects.toThrow(
        "Injected directory sync failure",
      );
      expect(rename).toHaveBeenCalledTimes(1);
      failing = false;
      await retainInstructions(dir, compiled);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(await fs.readdir(path.join(dir, "instructions"))).toEqual([
        `${compiled.fingerprint}.json`,
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not acknowledge a concurrent existing-file writer before that writer's own directory barrier",
    async () => {
      const dir = await temporary();
      const compiled = compileInstructions({
        core: "Common",
        role: "Concurrent",
        profileId: "qa",
      });
      const releases: (() => void)[] = [];
      const entered: (() => void)[] = [];
      const barriers = [0, 1].map(
        () => new Promise<void>((resolve) => entered.push(resolve)),
      );
      const waits = [0, 1].map(
        () => new Promise<void>((resolve) => releases.push(resolve)),
      );
      let calls = 0;
      observeSync(async (location, sync) => {
        if (location === path.join(dir, "instructions")) {
          const index = calls++;
          entered[index]?.();
          if (index < waits.length) await waits[index];
        }
        await sync();
      });
      const first = retainInstructions(dir, compiled);
      let second: Promise<void> | undefined;
      const enter = async (barrier: Promise<void>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            barrier,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Directory barrier was bypassed")),
                1000,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      try {
        await enter(barriers[0]);
        let acknowledged = false;
        second = retainInstructions(dir, compiled).then(() => {
          acknowledged = true;
        });
        await enter(barriers[1]);
        expect(acknowledged).toBe(false);
        releases[1]();
        await second;
        expect(acknowledged).toBe(true);
        expect(calls).toBe(2);
      } finally {
        releases.forEach((release) => release());
        await Promise.allSettled([first, ...(second ? [second] : [])]);
      }
      expect(
        (await readRetainedInstructions(dir, compiled.fingerprint)).text,
      ).toBe(compiled.text);
    },
  );
});
