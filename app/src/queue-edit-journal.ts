export type QueueEditDraft = { id: string; text: string; baseText?: string };
type Entry = {
  version: 1;
  windowKey: string;
  sessionId: string;
  id: string;
  at: number;
  text?: string;
  baseText?: string;
  cleared?: true;
};

/** Queue edits belong to one window, session and message, independently of the
 * host queue. A disappeared message is recovered as text, never written back. */
export class QueueEditJournal {
  private prefix: string;
  private pointer: string;
  private lastAt = 0;
  constructor(
    private storage: Storage,
    private windowKey: string,
    private sessionId: string,
    private clock = Date.now,
  ) {
    this.prefix = `workbench.queue-edit.v1.${encodeURIComponent(windowKey)}.${encodeURIComponent(sessionId)}.`;
    this.pointer = this.prefix + "active";
  }
  private key(id: string) {
    return this.prefix + "message." + encodeURIComponent(id);
  }
  private readEntry(key: string): Entry | undefined {
    try {
      const value = JSON.parse(this.storage.getItem(key) || "null");
      return value?.version === 1 &&
        value.windowKey === this.windowKey &&
        value.sessionId === this.sessionId &&
        typeof value.id === "string" &&
        Number.isFinite(value.at) &&
        (value.baseText === undefined || typeof value.baseText === "string") &&
        (typeof value.text === "string" || value.cleared === true) &&
        (key === this.pointer || key === this.key(value.id))
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }
  active(): QueueEditDraft | undefined {
    // Inspect the owning entries as well: a quota failure may have committed
    // the message entry but failed to update the active pointer.
    let latest = this.readEntry(this.pointer);
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key?.startsWith(this.prefix + "message.")) {
          const candidate = this.readEntry(key);
          if (candidate && (!latest || candidate.at > latest.at))
            latest = candidate;
        }
      }
    } catch {}
    this.lastAt = Math.max(this.lastAt, latest?.at || 0);
    return latest && !latest.cleared && typeof latest.text === "string"
      ? {
          id: latest.id,
          text: latest.text,
          ...(latest.baseText !== undefined
            ? { baseText: latest.baseText }
            : {}),
        }
      : undefined;
  }
  read(id: string): QueueEditDraft | undefined {
    const saved = this.readEntry(this.key(id));
    return saved && !saved.cleared && typeof saved.text === "string"
      ? {
          id,
          text: saved.text,
          ...(saved.baseText !== undefined ? { baseText: saved.baseText } : {}),
        }
      : undefined;
  }
  private commit(
    id: string,
    value: { text: string; baseText?: string } | { cleared: true },
  ) {
    this.lastAt = Math.max(
      this.clock(),
      this.lastAt + 1,
      (this.readEntry(this.pointer)?.at || 0) + 1,
      (this.readEntry(this.key(id))?.at || 0) + 1,
    );
    const entry: Entry = {
      version: 1,
      windowKey: this.windowKey,
      sessionId: this.sessionId,
      id,
      at: this.lastAt,
      ...value,
    };
    const serialized = JSON.stringify(entry);
    this.storage.setItem(this.key(id), serialized);
    this.storage.setItem(this.pointer, serialized);
  }
  write(draft: QueueEditDraft) {
    this.commit(draft.id, {
      text: draft.text,
      ...(draft.baseText !== undefined ? { baseText: draft.baseText } : {}),
    });
  }
  clear(id: string, expectedText?: string, expectedBaseText?: string): boolean {
    const saved = this.read(id);
    if (
      !saved ||
      (expectedText !== undefined &&
        (saved.text !== expectedText || saved.baseText !== expectedBaseText))
    )
      return false;
    // A reply to an unmounted editor must not hide another edit opened since
    // that request began. Keep that newer owner intact.
    const active = this.active();
    if (active && active.id !== id) return false;
    this.commit(id, { cleared: true });
    return true;
  }
}
