import { describe, expect, it } from "vitest";
import { QueueEditJournal } from "../src/queue-edit-journal";

class MemoryStorage {
  values = new Map<string, string>();
  failPointer = false;
  fail = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail || (this.failPointer && key.endsWith(".active")))
      throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
describe("per-window queue edit recovery", () => {
  it("retains the captured original version through reload and subsequent editing", () => {
    const storage = new MemoryStorage();
    new QueueEditJournal(storage, "A", "S").write({
      id: "M",
      text: "My edit",
      baseText: "Original queued text",
    });
    const reopened = new QueueEditJournal(storage, "A", "S");
    const retained = reopened.active()!;
    expect(retained.baseText).toBe("Original queued text");
    reopened.write({ ...retained, text: "Further local editing" });
    expect(new QueueEditJournal(storage, "A", "S").read("M")).toEqual({
      id: "M",
      text: "Further local editing",
      baseText: "Original queued text",
    });
    // Legacy entries remain recoverable, but their missing base is explicit;
    // the UI offers composer restoration rather than an unguarded host update.
    reopened.write({ id: "legacy", text: "Old unsaved edit" });
    expect(reopened.read("legacy")?.baseText).toBeUndefined();
  });
  it("retains the exact message edit after navigation or renderer reload", () => {
    const storage = new MemoryStorage();
    const first = new QueueEditJournal(storage, "primary", "session");
    first.write({ id: "message", text: "Unsent edited instructions" });
    const remounted = new QueueEditJournal(storage, "primary", "session");
    expect(remounted.active()).toEqual({
      id: "message",
      text: "Unsent edited instructions",
    });
    // The journal does not need the item to remain in the host queue: the UI
    // offers composer recovery instead of updating an already dispatched item.
    expect(remounted.read("message")).toEqual(remounted.active());
  });
  it("isolates two windows and two sessions editing the same message ID", () => {
    const storage = new MemoryStorage();
    const a = new QueueEditJournal(storage, "A", "S");
    const b = new QueueEditJournal(storage, "B", "S");
    const other = new QueueEditJournal(storage, "A", "T");
    a.write({ id: "M", text: "A edit" });
    b.write({ id: "M", text: "B edit" });
    other.write({ id: "M", text: "Other session" });
    expect(new QueueEditJournal(storage, "A", "S").active()?.text).toBe(
      "A edit",
    );
    expect(new QueueEditJournal(storage, "B", "S").active()?.text).toBe(
      "B edit",
    );
    expect(new QueueEditJournal(storage, "A", "T").active()?.text).toBe(
      "Other session",
    );
  });
  it("explicit save/discard tombstones survive reload and do not resurrect old edits", () => {
    const storage = new MemoryStorage();
    const journal = new QueueEditJournal(storage, "A", "S", () => 0);
    journal.write({ id: "M", text: "Original edit" });
    expect(journal.clear("M", "Original edit")).toBe(true);
    expect(new QueueEditJournal(storage, "A", "S").active()).toBeUndefined();
    expect(journal.read("M")).toBeUndefined();
    journal.write({ id: "N", text: "Next edit" });
    journal.clear("N");
    expect(new QueueEditJournal(storage, "A", "S").active()).toBeUndefined();
  });
  it("a late save acknowledgment cannot clear newer typed text", () => {
    const storage = new MemoryStorage();
    const journal = new QueueEditJournal(storage, "A", "S");
    journal.write({ id: "M", text: "Captured" });
    journal.write({ id: "M", text: "Newer local edit" });
    expect(journal.clear("M", "Captured")).toBe(false);
    expect(new QueueEditJournal(storage, "A", "S").active()?.text).toBe(
      "Newer local edit",
    );
  });
  it("a late save acknowledgment cannot clear identical text with a newer captured base", () => {
    const storage = new MemoryStorage();
    const old = new QueueEditJournal(storage, "A", "S");
    old.write({
      id: "M",
      text: "Same intended text",
      baseText: "Original base",
    });
    const remounted = new QueueEditJournal(storage, "A", "S");
    remounted.write({
      id: "M",
      text: "Same intended text",
      baseText: "Changed host base",
    });
    expect(old.clear("M", "Same intended text", "Original base")).toBe(false);
    expect(new QueueEditJournal(storage, "A", "S").active()).toEqual({
      id: "M",
      text: "Same intended text",
      baseText: "Changed host base",
    });
    expect(
      remounted.clear("M", "Same intended text", "Changed host base"),
    ).toBe(true);
    expect(new QueueEditJournal(storage, "A", "S").active()).toBeUndefined();
  });
  it("a late reply to an unmounted editor cannot hide a newer message edit", () => {
    const storage = new MemoryStorage();
    const old = new QueueEditJournal(storage, "A", "S", () => 0);
    old.write({ id: "M", text: "Captured" });
    const remounted = new QueueEditJournal(storage, "A", "S", () => 0);
    remounted.active();
    remounted.clear("M", "Captured");
    remounted.write({ id: "N", text: "Newer message edit" });
    expect(old.clear("M", "Captured")).toBe(false);
    expect(new QueueEditJournal(storage, "A", "S").active()).toEqual({
      id: "N",
      text: "Newer message edit",
    });
  });
  it("clock rollback after reopening cannot restore an older pointer over a new edit", () => {
    const storage = new MemoryStorage();
    new QueueEditJournal(storage, "A", "S", () => 100).write({
      id: "M",
      text: "Earlier",
    });
    new QueueEditJournal(storage, "A", "S", () => 1).write({
      id: "M",
      text: "Later despite clock rollback",
    });
    expect(new QueueEditJournal(storage, "A", "S").active()?.text).toBe(
      "Later despite clock rollback",
    );
  });
  it("recovers a committed entry or tombstone even if active-pointer storage failed", () => {
    const storage = new MemoryStorage();
    const journal = new QueueEditJournal(storage, "A", "S", () => 0);
    journal.write({ id: "M", text: "Before" });
    storage.failPointer = true;
    expect(() =>
      journal.write({ id: "M", text: "Committed before pointer failure" }),
    ).toThrow();
    expect(new QueueEditJournal(storage, "A", "S").active()?.text).toBe(
      "Committed before pointer failure",
    );
    expect(() => journal.clear("M")).toThrow();
    expect(new QueueEditJournal(storage, "A", "S").active()).toBeUndefined();
  });
  it("keeps previous durable text when storage fails before committing the edit", () => {
    const storage = new MemoryStorage();
    const journal = new QueueEditJournal(storage, "A", "S");
    journal.write({ id: "M", text: "Durable" });
    storage.fail = true;
    expect(() => journal.write({ id: "M", text: "Not confirmed" })).toThrow();
    expect(new QueueEditJournal(storage, "A", "S").active()?.text).toBe(
      "Durable",
    );
  });
});
