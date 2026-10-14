import type { AppState } from "../shared/types";

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const identified = (value: unknown) =>
  record(value) && typeof value.id === "string";
/** Reject incomplete transport data before it can replace a usable workspace. */
export function validSnapshot(value: unknown): value is AppState {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !record(value.settings)
  )
    return false;
  for (const key of [
    "projects",
    "tasks",
    "sessions",
    "profiles",
    "artifacts",
    "questions",
  ])
    if (!Array.isArray(value[key]) || !value[key].every(identified))
      return false;
  return (
    value.projects.every(
      (p: any) => typeof p.name === "string" && typeof p.path === "string",
    ) &&
    value.tasks.every(
      (t: any) =>
        typeof t.title === "string" && typeof t.projectId === "string",
    ) &&
    value.sessions.every(
      (s: any) =>
        typeof s.taskId === "string" &&
        typeof s.title === "string" &&
        typeof s.profileId === "string" &&
        typeof s.status === "string" &&
        record(s.context) &&
        Array.isArray(s.messages) &&
        s.messages.every(
          (m: any) =>
            identified(m) &&
            typeof m.content === "string" &&
            typeof m.role === "string",
        ) &&
        Array.isArray(s.queue) &&
        s.queue.every(
          (q: any) => identified(q) && typeof q.text === "string",
        ) &&
        Array.isArray(s.todos) &&
        s.todos.every(
          (t: any) =>
            identified(t) &&
            typeof t.text === "string" &&
            typeof t.status === "string",
        ),
    ) &&
    value.profiles.every(
      (p: any) =>
        typeof p.name === "string" &&
        typeof p.description === "string" &&
        typeof p.prompt === "string",
    ) &&
    value.questions.every(
      (q: any) =>
        typeof q.title === "string" &&
        Array.isArray(q.options) &&
        q.options.every(
          (o: any) => identified(o) && typeof o.label === "string",
        ),
    )
  );
}

/** Only reads state; reconnection never repeats a user message or mutation. */
export class SnapshotFeed {
  private active = false;
  private current?: Promise<void>;
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private outstanding = 0;
  private blocked = false;
  private lastStarted = 0;
  private revision = -1;
  private failures = 0;
  private retryNotBefore = 0;
  constructor(
    private options: {
      read: () => Promise<unknown>;
      onState: (state: AppState) => void;
      onError: (message: string) => void;
      visible?: () => boolean;
      deadlineMs?: number;
      visiblePollMs?: number;
      hiddenPollMs?: number;
      minIntervalMs?: number;
    },
  ) {}
  start() {
    this.active = true;
    return this.refresh();
  }
  stop() {
    this.active = false;
    this.dirty = false;
    clearTimeout(this.timer);
  }
  invalidate() {
    if (!this.active) return;
    this.dirty = true;
    if (!this.current)
      this.schedule(
        Math.max(
          0,
          (this.options.minIntervalMs ?? 75) - (Date.now() - this.lastStarted),
        ),
      );
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (this.active)
      this.timer = setTimeout(
        () => {
          void this.refresh();
        },
        Math.max(delay, this.retryNotBefore - Date.now()),
      );
  }
  refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.current) {
      this.dirty = true;
      return this.current;
    }
    if (Date.now() < this.retryNotBefore) {
      this.schedule(this.retryNotBefore - Date.now());
      return Promise.resolve();
    }
    clearTimeout(this.timer);
    if (this.outstanding >= 2) {
      this.blocked = true;
      this.options.onError(
        "Интерфейс ждёт ответа приложения. История и текущий ввод остаются на месте.",
      );
      this.schedule(5000);
      return Promise.resolve();
    }
    this.dirty = false;
    this.lastStarted = Date.now();
    this.outstanding++;
    let expired = false;
    let deadline: ReturnType<typeof setTimeout>;
    // Keep the underlying read observed after its timeout; late data is discarded.
    const read = Promise.resolve()
      .then(this.options.read)
      .finally(() => {
        this.outstanding--;
        if (this.active && this.blocked) {
          this.blocked = false;
          this.invalidate();
        }
      });
    const attempt = Promise.race([
      read,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          expired = true;
          reject(new Error("snapshot deadline"));
        }, this.options.deadlineMs ?? 5000);
      }),
    ])
      .then((next) => {
        if (!this.active || expired) return;
        if (!validSnapshot(next)) throw new Error("invalid snapshot");
        if (next.revision < this.revision) throw new Error("stale snapshot");
        this.revision = next.revision;
        this.failures = 0;
        this.retryNotBefore = 0;
        this.options.onState(next);
        this.options.onError("");
      })
      .catch(() => {
        if (!this.active) return;
        this.failures++;
        this.retryNotBefore =
          Date.now() +
          Math.min(5000, 500 * 2 ** Math.min(this.failures - 1, 4));
        this.options.onError(
          "Не удалось обновить данные. Повторяем подключение; текущая работа и ввод сохранены в окне.",
        );
      })
      .finally(() => {
        clearTimeout(deadline);
        if (this.current === attempt) this.current = undefined;
        if (!this.active) return;
        const delay = this.dirty
          ? Math.max(
              0,
              (this.options.minIntervalMs ?? 75) -
                (Date.now() - this.lastStarted),
            )
          : this.failures
            ? Math.min(5000, 500 * 2 ** Math.min(this.failures - 1, 4))
            : (this.options.visible?.() ?? true)
              ? (this.options.visiblePollMs ?? 2000)
              : (this.options.hiddenPollMs ?? 10000);
        this.schedule(delay);
      });
    this.current = attempt;
    return attempt;
  }
}
