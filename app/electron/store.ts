import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** One main-process owner. JSON updates are serialized and acknowledged only after rename. */
export class AtomicStore<T extends object> {
  private value!: T;
  private tail: Promise<unknown> = Promise.resolve();
  private token = randomUUID();
  private locked = false;
  recoveryNotice?: string;
  readonly filename: string;
  constructor(
    readonly directory: string,
    private initial: () => T,
    private validate: (data: unknown) => data is T,
  ) {
    this.filename = path.join(directory, "state.json");
  }
  async init(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, "owner.lock");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.open(lock, "wx", 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, token: this.token }),
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.locked = true;
        break;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        let owner: any;
        try {
          owner = JSON.parse(await fs.readFile(lock, "utf8"));
        } catch {
          throw new Error(
            "Storage owner lock is unreadable; preserve it and inspect before recovery.",
          );
        }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
          throw new Error(
            "Invalid storage owner lock; refusing a second writer.",
          );
        let alive = true;
        try {
          process.kill(owner.pid, 0);
        } catch (e: any) {
          if (e.code === "ESRCH") alive = false;
        }
        if (alive)
          throw new Error(
            "This data directory is already owned by another running application.",
          );
        await fs.rename(
          lock,
          path.join(this.directory, `owner.abandoned-${randomUUID()}.json`),
        );
      }
    }
    if (!this.locked) throw new Error("Could not acquire storage ownership.");
    try {
      try {
        this.value = await this.readValid(this.filename);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          // A previous backup means this is recovery, not an empty installation.
          try {
            this.value = await this.readValid(this.filename + ".bak");
            this.recoveryNotice =
              "Recovered the previous confirmed storage snapshot; inspect interrupted operations.";
          } catch (backupError: any) {
            if (backupError.code !== "ENOENT") throw backupError;
            this.value = this.initial();
          }
        } else {
          let recovered: T;
          try {
            recovered = await this.readValid(this.filename + ".bak");
          } catch {
            throw new Error(
              "State is invalid and no valid backup is available. Files were preserved; refusing to reset your history.",
            );
          }
          await fs.copyFile(
            this.filename,
            path.join(this.directory, `state.invalid-${randomUUID()}.json`),
          );
          this.value = recovered;
          this.recoveryNotice =
            "Invalid state was preserved; recovered the previous confirmed snapshot. The latest operation may need reconciliation.";
        }
        await this.atomic(this.filename, JSON.stringify(this.value));
      }
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  private async readValid(file: string): Promise<T> {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 128 * 1024 * 1024)
      throw new Error(
        "Storage file is not regular or exceeds the supported 128 MiB limit.",
      );
    const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!this.validate(value))
      throw new Error("Unsupported or invalid storage schema.");
    return value;
  }
  read(): T {
    return structuredClone(this.value);
  }
  update<R>(change: (draft: T) => R): Promise<R> {
    const next = this.tail.then(async () => {
      if (!this.locked) throw new Error("Storage is closed.");
      const draft = structuredClone(this.value);
      const result = change(draft);
      if (!this.validate(draft))
        throw new Error("Refused an invalid state transition.");
      const text = JSON.stringify(draft);
      if (Buffer.byteLength(text) > 128 * 1024 * 1024)
        throw new Error(
          "Storage size limit reached; export or archive data before adding more.",
        );
      await this.atomic(this.filename + ".bak", JSON.stringify(this.value));
      await this.atomic(this.filename, text);
      this.value = draft;
      return result;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async atomic(destination: string, text: string): Promise<void> {
    const temp = destination + `.tmp-${randomUUID()}`;
    let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600);
      await handle.writeFile(text, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temp, destination);
      // Directory fsync is not supported on every Windows filesystem.
      if (process.platform !== "win32") {
        const directory = await fs.open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(temp).catch(() => undefined);
    }
  }
  async close(): Promise<void> {
    await this.tail;
    if (!this.locked) return;
    const lock = path.join(this.directory, "owner.lock");
    try {
      const owner = JSON.parse(await fs.readFile(lock, "utf8"));
      if (owner.token === this.token) await fs.unlink(lock);
    } finally {
      this.locked = false;
    }
  }
}
