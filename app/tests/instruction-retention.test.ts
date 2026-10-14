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
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
async function entered(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Write barrier not reached")),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  it("coalesces eight held publications before rename, validates every joining caller and never suppresses a collision", async () => {
    const dir = await temporary();
    const compiled = compileInstructions({
      core: "Common",
      role: "One publisher",
      profileId: "backend",
    });
    const reached = barrier(),
      release = barrier();
    const originalRename = fs.rename.bind(fs);
    const rename = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (from, to) => {
        if (rename.mock.calls.length > 1)
          throw Object.assign(new Error("Concurrent destination replacement"), {
            code: "EPERM",
          });
        reached.release();
        await release.promise;
        await originalRename(from, to);
      });
    let acknowledgements = 0;
    const writers = Array.from({ length: 8 }, (_, i) =>
      retainInstructions(
        i % 3 === 1
          ? path.relative(process.cwd(), dir)
          : i % 3 === 2 && process.platform === "win32"
            ? dir.toUpperCase()
            : dir,
        compiled,
      ).then(() => {
        acknowledgements++;
      }),
    );
    const settled = Promise.allSettled(writers);
    try {
      await entered(reached.promise);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(acknowledgements).toBe(0);
      expect(await fs.readdir(path.join(dir, "instructions"))).toHaveLength(1);
      await expect(
        retainInstructions(dir, {
          ...compiled,
          text: "Invalid joining caller",
        }),
      ).rejects.toThrow("Invalid instruction snapshot");
      expect(acknowledgements).toBe(0);
    } finally {
      release.release();
      await settled;
    }
    expect(
      (await settled).every((result) => result.status === "fulfilled"),
    ).toBe(true);
    expect(acknowledgements).toBe(8);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(path.join(dir, "instructions"))).toEqual([
      `${compiled.fingerprint}.json`,
    ]);
    expect(await readRetainedInstructions(dir, compiled.fingerprint)).toEqual(
      compiled,
    );
  });
  it("rejects all joined writers on a real write failure, clears the in-flight entry and permits a clean retry", async () => {
    const dir = await temporary();
    const compiled = compileInstructions({
      core: "Common",
      role: "Retry after failed publication",
      profileId: "backend",
    });
    const reached = barrier(),
      release = barrier();
    const open = fs.open.bind(fs);
    let failing = true,
      publications = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(".tmp")) {
        publications++;
        if (failing)
          vi.spyOn(handle, "writeFile").mockImplementation(async () => {
            reached.release();
            await release.promise;
            throw Object.assign(new Error("Injected write failure"), {
              code: "EIO",
            });
          });
      }
      return handle;
    });
    const settled = Promise.allSettled(
      Array.from({ length: 8 }, () => retainInstructions(dir, compiled)),
    );
    try {
      await entered(reached.promise);
      expect(publications).toBe(1);
    } finally {
      release.release();
      await settled;
    }
    expect(
      (await settled).every(
        (result) =>
          result.status === "rejected" && result.reason?.code === "EIO",
      ),
    ).toBe(true);
    expect(await fs.readdir(path.join(dir, "instructions"))).toEqual([]);
    failing = false;
    await retainInstructions(dir, compiled);
    expect(publications).toBe(2);
    expect(await readRetainedInstructions(dir, compiled.fingerprint)).toEqual(
      compiled,
    );
    expect(await fs.readdir(path.join(dir, "instructions"))).toEqual([
      `${compiled.fingerprint}.json`,
    ]);
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
    "joins the whole durable barrier and revalidates a later existing-file call after settlement",
    async () => {
      const dir = await temporary();
      const compiled = compileInstructions({
        core: "Common",
        role: "Concurrent",
        profileId: "qa",
      });
      const directories = [barrier(), barrier()];
      const parents = [barrier(), barrier()];
      const directoryReleases = [barrier(), barrier()];
      const parentReleases = [barrier(), barrier()];
      let directoryCalls = 0,
        parentCalls = 0,
        fileCalls = 0;
      observeSync(async (location, sync) => {
        if (location === path.join(dir, "instructions")) {
          const index = directoryCalls++;
          directories[index]?.release();
          if (index < directoryReleases.length)
            await directoryReleases[index].promise;
        } else if (location === dir) {
          const index = parentCalls++;
          parents[index]?.release();
          if (index < parentReleases.length)
            await parentReleases[index].promise;
        } else fileCalls++;
        await sync();
      });
      const rename = vi.spyOn(fs, "rename");
      let acknowledgements = 0;
      const first = retainInstructions(dir, compiled).then(() => {
        acknowledgements++;
      });
      let second: Promise<void> | undefined;
      let later: Promise<void> | undefined;
      try {
        await entered(directories[0].promise);
        second = retainInstructions(dir, compiled).then(() => {
          acknowledgements++;
        });
        expect(acknowledgements).toBe(0);
        expect(fileCalls).toBe(1);
        expect(directoryCalls).toBe(1);
        directoryReleases[0].release();
        await entered(parents[0].promise);
        expect(acknowledgements).toBe(0);
        expect(parentCalls).toBe(1);
        parentReleases[0].release();
        await Promise.all([first, second]);
        expect(acknowledgements).toBe(2);
        expect(rename).toHaveBeenCalledTimes(1);

        later = retainInstructions(dir, compiled).then(() => {
          acknowledgements++;
        });
        await entered(directories[1].promise);
        expect(acknowledgements).toBe(2);
        directoryReleases[1].release();
        await entered(parents[1].promise);
        expect(acknowledgements).toBe(2);
        parentReleases[1].release();
        await later;
        expect(acknowledgements).toBe(3);
        expect(fileCalls).toBe(1);
        expect(directoryCalls).toBe(2);
        expect(parentCalls).toBe(2);
        expect(rename).toHaveBeenCalledTimes(1);
      } finally {
        [...directoryReleases, ...parentReleases].forEach((release) =>
          release.release(),
        );
        await Promise.allSettled([
          first,
          ...(second ? [second] : []),
          ...(later ? [later] : []),
        ]);
      }
      expect(
        (await readRetainedInstructions(dir, compiled.fingerprint)).text,
      ).toBe(compiled.text);
    },
  );
});
