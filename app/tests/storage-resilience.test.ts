import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtomicStore } from "../electron/store";

const directories: string[] = [];
const stores: AtomicStore<{ value: number }>[] = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "store-fault-"));
  directories.push(directory);
  const store = new AtomicStore(
    directory,
    () => ({ value: 0 }),
    (value): value is { value: number } =>
      !!value && Number.isSafeInteger((value as any).value),
  );
  stores.push(store);
  return { directory, store };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

describe("storage fault boundaries", () => {
  it.each(["write", "sync"] as const)(
    "removes only its newly created lock after initial %s failure so startup can be retried",
    async (fault) => {
      const x = await fixture();
      const open = fs.open.bind(fs);
      const failure = Object.assign(new Error(`Injected lock ${fault}`), {
        code: fault === "write" ? "ENOSPC" : "EIO",
      });
      vi.spyOn(fs, "open").mockImplementation(async (...args: any[]) => {
        const handle = await (open as any)(...args);
        if (args[0] === path.join(x.directory, "owner.lock"))
          vi.spyOn(
            handle,
            fault === "write" ? "writeFile" : "sync",
          ).mockRejectedValueOnce(failure);
        return handle;
      });
      await expect(x.store.init()).rejects.toBe(failure);
      expect(await fs.readdir(x.directory)).not.toContain("owner.lock");
      vi.restoreAllMocks();
      await x.store.init();
      expect(x.store.read()).toEqual({ value: 0 });
      await x.store.update((state) => {
        state.value = 1;
      });
      expect(x.store.read()).toEqual({ value: 1 });
    },
  );

  it.each(["state.json.bak", "state.json"])(
    "keeps the confirmed state and can retry after pre-commit %s rename failure",
    async (destination) => {
      const x = await fixture();
      await x.store.init();
      await x.store.update((state) => {
        state.value = 1;
      });
      const rename = fs.rename.bind(fs);
      let injected = false;
      vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
        if (!injected && target === path.join(x.directory, destination)) {
          injected = true;
          throw Object.assign(new Error("Injected rename failure"), {
            code: "ENOSPC",
          });
        }
        return rename(source, target);
      });
      await expect(
        x.store.update((state) => {
          state.value = 2;
        }),
      ).rejects.toThrow("Injected rename failure");
      expect(x.store.read()).toEqual({ value: 1 });
      expect(JSON.parse(await fs.readFile(x.store.filename, "utf8"))).toEqual({
        value: 1,
      });
      await x.store.update((state) => {
        state.value = 3;
      });
      expect(x.store.read()).toEqual({ value: 3 });
      expect(
        (await fs.readdir(x.directory)).some((name) => name.includes(".tmp-")),
      ).toBe(false);
    },
  );

  it.each([
    ["state.json.bak", "writeFile"],
    ["state.json.bak", "sync"],
    ["state.json", "writeFile"],
    ["state.json", "sync"],
  ] as const)(
    "keeps confirmed data after %s temporary-file %s failure",
    async (destination, method) => {
      const x = await fixture();
      await x.store.init();
      await x.store.update((state) => {
        state.value = 1;
      });
      const open = fs.open.bind(fs);
      let injected = false;
      vi.spyOn(fs, "open").mockImplementation(async (...args: any[]) => {
        const handle = await (open as any)(...args);
        if (
          !injected &&
          String(args[0]).startsWith(
            path.join(x.directory, `${destination}.tmp-`),
          )
        ) {
          injected = true;
          vi.spyOn(handle, method).mockRejectedValueOnce(
            Object.assign(new Error("Injected file persistence fault"), {
              code: method === "writeFile" ? "ENOSPC" : "EIO",
            }),
          );
        }
        return handle;
      });
      await expect(
        x.store.update((state) => {
          state.value = 2;
        }),
      ).rejects.toThrow("Injected file persistence fault");
      expect(x.store.read()).toEqual({ value: 1 });
      expect(JSON.parse(await fs.readFile(x.store.filename, "utf8"))).toEqual({
        value: 1,
      });
      expect(
        (await fs.readdir(x.directory)).some((name) => name.includes(".tmp-")),
      ).toBe(false);
      await x.store.update((state) => {
        state.value = 3;
      });
      expect(x.store.read()).toEqual({ value: 3 });
    },
  );

  it("preserves an existing unreadable owner lock instead of treating it as its own failed acquisition", async () => {
    const x = await fixture();
    await fs.writeFile(
      path.join(x.directory, "owner.lock"),
      "existing corrupt lock",
    );
    await expect(x.store.init()).rejects.toThrow("unreadable");
    expect(
      await fs.readFile(path.join(x.directory, "owner.lock"), "utf8"),
    ).toBe("existing corrupt lock");
  });
});
