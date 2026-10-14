import { describe, expect, it } from "vitest";
import {
  DraftJournal,
  draftStorageKey,
  emptyChatDraft,
  readStored,
  type ChatDraft,
} from "../src/local-state";
class MemoryStorage implements Storage {
  values = new Map<string, string>();
  fail = false;
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
}
const draft = (text: string): ChatDraft => ({
  text,
  attachments: [{ name: "evidence.txt", path: "/owned/evidence.txt" }],
});
describe("local renderer state and independent draft journals", () => {
  it("unavailable storage enumeration and reads cannot crash draft recovery", () => {
    const unavailable = {
      get length(): number {
        throw new Error("Storage is unavailable");
      },
      getItem() {
        throw new Error("Storage is unavailable");
      },
      key() {
        throw new Error("Storage is unavailable");
      },
    } as unknown as Storage;
    const journal = new DraftJournal(unavailable, "primary");
    expect(journal.own()).toEqual({});
    expect(journal.read("task")).toEqual(emptyChatDraft());
    expect(journal.foreign("task")).toBeUndefined();
    expect(readStored(unavailable, "workbench.sidebar", true)).toBe(true);
  });
  it("two windows cannot overwrite each other's tasks or drafts for the same conversation", () => {
    const storage = new MemoryStorage();
    let clock = 0;
    const a = new DraftJournal(storage, "primary", () => ++clock),
      b = new DraftJournal(storage, "secondary", () => ++clock);
    a.write("one", draft("A"));
    b.write("two", draft("B"));
    a.write("one", draft("A changed"));
    expect(b.read("two").text).toBe("B");
    b.write("one", draft("B alternate"));
    expect(a.read("one").text).toBe("A changed");
    expect(b.read("one").text).toBe("B alternate");
    expect(new DraftJournal(storage, "primary").read("one").text).toBe(
      "A changed",
    );
    expect(a.foreign("one")?.value.text).toBe("B alternate");
  });
  it("a new window offers a retired secondary draft without copying it into the active composer", () => {
    const storage = new MemoryStorage(),
      old = new DraftJournal(storage, "old-window");
    old.write("task", draft("Unsent secondary"));
    const before = [...storage.values];
    const reopened = new DraftJournal(storage, "primary");
    expect(reopened.read("task")).toEqual(emptyChatDraft());
    expect(reopened.foreign("task")?.value).toEqual(draft("Unsent secondary"));
    expect([...storage.values]).toEqual(before);
    expect(storage.getItem(draftStorageKey("primary", "task"))).toBeNull();
  });
  it("clear is a local tombstone and never resurrects already submitted text", () => {
    const storage = new MemoryStorage(),
      a = new DraftJournal(storage, "primary");
    a.write("task", draft("Already submitted"));
    a.write("task", emptyChatDraft());
    expect(new DraftJournal(storage, "primary").read("task")).toEqual(
      emptyChatDraft(),
    );
    expect(new DraftJournal(storage, "fresh-window").read("task")).toEqual(
      emptyChatDraft(),
    );
  });
  it("explicit alternate recovery backs up current unsent text and leaves the other window intact", () => {
    const storage = new MemoryStorage();
    let clock = 0;
    const a = new DraftJournal(storage, "primary", () => ++clock),
      b = new DraftJournal(storage, "other", () => ++clock);
    a.write("task", draft("Current"));
    b.write("task", draft("Alternate"));
    a.restore("task", a.foreign("task")!);
    expect(a.read("task").text).toBe("Alternate");
    expect(b.read("task").text).toBe("Alternate");
    const backups = [...storage.values].filter(([key]) =>
      key.startsWith("workbench.draft.backup.v2."),
    );
    expect(backups).toHaveLength(1);
    expect(JSON.parse(backups[0][1]).value.text).toBe("Current");
  });
  it("migrates only well-typed legacy entries once and preserves the original bytes", () => {
    const storage = new MemoryStorage(),
      raw = JSON.stringify({
        valid: draft("Legacy"),
        invalid: { text: null, attachments: [] },
      });
    storage.setItem("workbench.drafts.v1", raw);
    const journal = new DraftJournal(storage, "primary");
    journal.migrateLegacy();
    expect(journal.own()).toEqual({ valid: draft("Legacy") });
    expect(storage.getItem("workbench.drafts.v1")).toBe(raw);
    journal.write("valid", emptyChatDraft());
    new DraftJournal(storage, "new-window").migrateLegacy();
    expect(new DraftJournal(storage, "new-window").read("valid")).toEqual(
      emptyChatDraft(),
    );
  });
  it("invalid JSON and valid JSON of the wrong type fall back without destructive writes", () => {
    const storage = new MemoryStorage();
    storage.setItem("workbench.selection", "[]");
    storage.setItem("workbench.sidebar", '"wrong"');
    storage.setItem("workbench.answer.q", '{"text":null,"optionId":[]}');
    expect(readStored(storage, "workbench.selection", {})).toEqual({});
    expect(readStored(storage, "workbench.sidebar", true)).toBe(true);
    expect(
      readStored(storage, "workbench.answer.q", { text: "", optionId: "" }),
    ).toEqual({ text: "", optionId: "" });
    expect(storage.getItem("workbench.selection")).toBe("[]");
  });
  it("a storage failure retains the previous durable draft and reports failure to the caller", () => {
    const storage = new MemoryStorage(),
      journal = new DraftJournal(storage, "primary");
    journal.write("task", draft("Durable"));
    storage.fail = true;
    expect(() => journal.write("task", draft("Unconfirmed current"))).toThrow(
      /Quota/,
    );
    expect(journal.read("task").text).toBe("Durable");
  });
  it("rejects an envelope filed under another session or window identity", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      draftStorageKey("primary", "one"),
      JSON.stringify({
        version: 2,
        id: "two",
        windowKey: "other",
        at: 1,
        value: draft("Wrong owner"),
      }),
    );
    const journal = new DraftJournal(storage, "primary");
    expect(journal.own()).toEqual({});
    expect(journal.read("one")).toEqual(emptyChatDraft());
  });
});
