import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const cancelled = () =>
  new Error(
    "IDE_RECOVERY_CANCELLED: Попытка сохранения recovery отменена или заменена новой.",
  );

export class RecoveryPublishAttempt {
  private active = true;
  constructor(
    readonly file: string,
    readonly key: string,
    private current: () => boolean,
    private invalidate: () => void,
  ) {}
  assertCurrent() {
    if (!this.active || !this.current()) throw cancelled();
  }
  cancel() {
    this.active = false;
    this.invalidate();
  }
  async withTimeout<T>(operation: Promise<T>, timeoutMs = 5000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // Invalidating publication must precede restoring the editor and
            // allowing another attempt. Promise.race alone does not stop I/O.
            this.cancel();
            reject(
              new Error(
                "IDE_CLOSE_BLOCKED: IDE не подтвердила сохранение за 5 секунд. Окно сохранено; проверьте файлы и используйте Save As при необходимости.",
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      this.cancel();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A timed-out fsync may finish later, but it cannot replace a newer recovery. */
export class SerializedRecoveryPublisher {
  private latest = new Map<string, RecoveryPublishAttempt>();
  private tails = new Map<string, Promise<void>>();
  constructor(
    private options: {
      /** Tests can delay a real FileHandle.sync without mocking filesystem I/O. */
      syncFile?: (handle: FileHandle) => Promise<void>;
    } = {},
  ) {}

  begin(file: string, guard: () => boolean = () => true) {
    const resolved = path.resolve(file),
      key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const attempt: RecoveryPublishAttempt = new RecoveryPublishAttempt(
      resolved,
      key,
      () => this.latest.get(key) === attempt && guard(),
      () => {
        if (this.latest.get(key) === attempt) this.latest.delete(key);
      },
    );
    this.latest.set(key, attempt);
    return attempt;
  }

  persist(attempt: RecoveryPublishAttempt, contents: string): Promise<void> {
    const previous = this.tails.get(attempt.key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.publish(attempt, contents));
    this.tails.set(attempt.key, next);
    return next.finally(() => {
      if (this.tails.get(attempt.key) === next) this.tails.delete(attempt.key);
    });
  }

  private async publish(attempt: RecoveryPublishAttempt, contents: string) {
    attempt.assertCurrent();
    const directory = path.dirname(attempt.file),
      temporary = attempt.file + ".partial-" + randomUUID();
    await fs.mkdir(directory, { recursive: true });
    let handle: FileHandle | undefined;
    try {
      attempt.assertCurrent();
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await (this.options.syncFile
        ? this.options.syncFile(handle)
        : handle.sync());
      await handle.close();
      handle = undefined;
      attempt.assertCurrent();
      await fs.rename(temporary, attempt.file);
      // A rename already issued to the OS cannot be cancelled. The per-file
      // queue keeps any newer publication behind it, so an older in-flight
      // rename can never overwrite a newer completed snapshot.
      attempt.assertCurrent();
      if (process.platform !== "win32") {
        const parent = await fs.open(directory, "r");
        try {
          await parent.sync();
        } catch (error) {
          if (
            !["EINVAL", "ENOTSUP"].includes(
              (error as NodeJS.ErrnoException).code || "",
            )
          )
            throw error;
        } finally {
          await parent.close();
        }
      }
      attempt.assertCurrent();
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  }
}
