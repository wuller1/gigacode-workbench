import { afterEach, describe, expect, it } from "vitest";
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
});
