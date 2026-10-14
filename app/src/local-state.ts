export const plainRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export type Decoder<T> = (value: unknown, fallback: T) => T;
export function decodeStored<T>(key: string, value: unknown, fallback: T): T {
  if (typeof fallback === "boolean")
    return (typeof value === "boolean" ? value : fallback) as T;
  if (typeof fallback === "number")
    return (
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback
    ) as T;
  if (typeof fallback === "string")
    return (typeof value === "string" ? value : fallback) as T;
  if (!plainRecord(value)) return fallback;
  if (key === "workbench.selection") {
    const next: Record<string, string> = {};
    for (const field of ["projectId", "taskId", "sessionId"])
      if (typeof value[field] === "string" && value[field].length <= 128)
        next[field] = value[field];
    return next as T;
  }
  if (key.startsWith("workbench.answer."))
    return (
      typeof value.text === "string" && typeof value.optionId === "string"
        ? value
        : fallback
    ) as T;
  if (
    /^(database\.selected\.v1|workbench\.ops\.(jenkins|cluster)\.connections\.v1)$/.test(
      key,
    )
  )
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => typeof v === "string"),
    ) as T;
  if (key === "workbench.ops.jenkins.favoriteFilters.v1")
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => typeof v === "boolean"),
    ) as T;
  if (key === "database.schemas.v1")
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, v]) =>
          Array.isArray(v) && v.every((item) => typeof item === "string"),
      ),
    ) as T;
  if (key === "workbench.file-drafts.v1")
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, v]) =>
          plainRecord(v) &&
          typeof v.text === "string" &&
          (v.file === null ||
            (plainRecord(v.file) &&
              typeof v.file.path === "string" &&
              typeof v.file.text === "string" &&
              typeof v.file.mtime === "number")),
      ),
    ) as T;
  return value as T;
}
export function readStored<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: T,
  decode: Decoder<T> = (value, initial) => decodeStored(key, value, initial),
): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : decode(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export type ChatDraft = {
  text: string;
  attachments: { path: string; name: string }[];
};
export const emptyChatDraft = (): ChatDraft => ({ text: "", attachments: [] });
export function validChatDraft(value: unknown): value is ChatDraft {
  return (
    plainRecord(value) &&
    typeof value.text === "string" &&
    Array.isArray(value.attachments) &&
    value.attachments.every(
      (item) =>
        plainRecord(item) &&
        typeof item.path === "string" &&
        typeof item.name === "string",
    )
  );
}
export interface DraftEntry {
  version: 2;
  id: string;
  windowKey: string;
  at: number;
  value: ChatDraft;
}
const ownPrefix = "workbench.draft.v2.";
const latestPrefix = "workbench.draft.latest.v2.";
const encode = encodeURIComponent;
export const draftStorageKey = (windowKey: string, id: string) =>
  ownPrefix + encode(windowKey) + "." + encode(id);
function entry(value: unknown): value is DraftEntry {
  return (
    plainRecord(value) &&
    value.version === 2 &&
    typeof value.id === "string" &&
    typeof value.windowKey === "string" &&
    Number.isFinite(value.at) &&
    validChatDraft(value.value)
  );
}
const nonempty = (value: ChatDraft) =>
  !!value.text || !!value.attachments.length;
const equalDraft = (a: ChatDraft, b: ChatDraft) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Independent journal entries avoid stale whole-record writes from another window. */
export class DraftJournal {
  private foreignCache = new Map<string, DraftEntry[]>();
  constructor(
    readonly storage: Storage,
    readonly windowKey: string,
    private clock: () => number = Date.now,
  ) {}
  private readEntry(key: string): DraftEntry | undefined {
    try {
      const parsed = JSON.parse(this.storage.getItem(key) || "null");
      return entry(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  private keys() {
    const keys: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) keys.push(key);
      }
    } catch {
      // A temporarily unavailable browser store must not prevent the host's
      // history and the current in-memory editor from being displayed.
    }
    return keys;
  }
  migrateLegacy() {
    if (this.storage.getItem("workbench.drafts.v2.migrated") === "true") return;
    let legacy: unknown;
    try {
      legacy = JSON.parse(
        this.storage.getItem("workbench.drafts.v1") || "null",
      );
    } catch {
      return;
    }
    if (!plainRecord(legacy)) return;
    for (const [id, value] of Object.entries(legacy))
      if (
        validChatDraft(value) &&
        !this.storage.getItem(draftStorageKey(this.windowKey, id))
      )
        this.write(id, value);
    // Original legacy data remains available; migration never erases it.
    this.storage.setItem("workbench.drafts.v2.migrated", "true");
  }
  own(): Record<string, ChatDraft> {
    const values: Record<string, ChatDraft> = {};
    const prefix = ownPrefix + encode(this.windowKey) + ".";
    for (const key of this.keys())
      if (key.startsWith(prefix)) {
        const found = this.readEntry(key);
        if (
          found?.windowKey === this.windowKey &&
          key === draftStorageKey(this.windowKey, found.id)
        )
          values[found.id] = found.value;
      }
    return values;
  }
  read(id: string): ChatDraft {
    const saved = this.readEntry(draftStorageKey(this.windowKey, id));
    return saved?.id === id && saved.windowKey === this.windowKey
      ? saved.value
      : emptyChatDraft();
  }
  invalidateForeign() {
    this.foreignCache.clear();
  }
  foreign(id: string): DraftEntry | undefined {
    const own = this.readEntry(draftStorageKey(this.windowKey, id));
    const cached = this.foreignCache.get(id);
    if (cached)
      return cached.find(
        (found) => !own || !equalDraft(found.value, own.value),
      );
    const latest = this.readEntry(latestPrefix + encode(id));
    const currentLatest =
      latest && this.readEntry(draftStorageKey(latest.windowKey, id));
    const candidates: DraftEntry[] = [];
    if (
      currentLatest?.id === id &&
      currentLatest.windowKey !== this.windowKey &&
      nonempty(currentLatest.value)
    )
      candidates.push(currentLatest);
    // A cleared latest entry must not resurrect a sent draft. Scan only when
    // resolving recovery, never when recording each keystroke.
    for (const key of this.keys())
      if (key.startsWith(ownPrefix) && key.endsWith("." + encode(id))) {
        const found = this.readEntry(key);
        if (
          found?.id === id &&
          found.windowKey !== this.windowKey &&
          nonempty(found.value)
        )
          candidates.push(found);
      }
    candidates.sort((a, b) => b.at - a.at);
    this.foreignCache.set(id, candidates);
    return candidates.find(
      (found) => !own || !equalDraft(found.value, own.value),
    );
  }
  write(id: string, value: ChatDraft) {
    if (!validChatDraft(value)) throw new Error("Invalid local draft.");
    const saved: DraftEntry = {
      version: 2,
      id,
      windowKey: this.windowKey,
      at: this.clock(),
      value,
    };
    // Commit the owning window entry first. An empty value is a durable local
    // tombstone, so reload never restores the already submitted text.
    this.storage.setItem(
      draftStorageKey(this.windowKey, id),
      JSON.stringify(saved),
    );
    if (nonempty(value))
      this.storage.setItem(latestPrefix + encode(id), JSON.stringify(saved));
  }
  restore(id: string, source: DraftEntry) {
    if (source.id !== id || !entry(source))
      throw new Error("Invalid draft recovery.");
    const current = this.read(id);
    if (nonempty(current) && !equalDraft(current, source.value))
      this.storage.setItem(
        `workbench.draft.backup.v2.${encode(this.windowKey)}.${encode(id)}.${this.clock()}.${crypto.randomUUID()}`,
        JSON.stringify({
          version: 2,
          id,
          windowKey: this.windowKey,
          at: this.clock(),
          value: current,
        }),
      );
    this.write(id, source.value);
    return source.value;
  }
}
