import { describe, expect, it } from "vitest";
import { prepareWindowClose, registerWindowClose } from "../src/window-close";

describe("renderer persistence before closing", () => {
  it("waits for every mounted editor and never treats a slow save as completed", async () => {
    let release!: () => void;
    let completed = false;
    const remove = registerWindowClose(
      "slow",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    try {
      const closing = prepareWindowClose().then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      release();
      await closing;
      expect(completed).toBe(true);
    } finally {
      remove();
    }
  });
  it("propagates failed persistence, permits a successful retry and does not unregister a replacement editor", async () => {
    const old = registerWindowClose("draft", async () => {});
    const replacement = registerWindowClose("draft", async () => {
      throw new Error("disk full");
    });
    old();
    try {
      await expect(prepareWindowClose()).rejects.toThrow("disk full");
    } finally {
      replacement();
    }
    const retry = registerWindowClose("draft", async () => {});
    try {
      await expect(prepareWindowClose()).resolves.toBeUndefined();
    } finally {
      retry();
    }
  });
});
