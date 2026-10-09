import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readReference } from "../electron/reference";
it("pages references, lists documents, and rejects files outside the bundle", async () => {
  const outer = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-ref-"));
  const root = path.join(outer, "bundle");
  await fs.mkdir(root);
  try {
    await fs.writeFile(path.join(root, "CORE.md"), "a".repeat(25000));
    await fs.writeFile(path.join(outer, "secret.md"), "not part of the bundle");
    expect((await readReference(root, {})).documents).toEqual(["CORE.md"]);
    expect((await readReference(root, { path: "CORE.md" })).nextOffset).toBe(
      20000,
    );
    expect(
      (await readReference(root, { path: "CORE.md", offset: 20000 })).text,
    ).toHaveLength(5000);
    await expect(readReference(root, { path: "../secret.md" })).rejects.toThrow(
      "outside",
    );
    await expect(
      readReference(root, { path: "CORE.md", offset: -1 }),
    ).rejects.toThrow("offset");
  } finally {
    await fs.rm(outer, { recursive: true, force: true });
  }
});
