import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { bundledCli } from "../electron/bundled-cli";
it("selects Qwen only without a vendor manifest and verifies the imported entry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-runtime-"));
  try {
    expect(await bundledCli(root, "qwen.js")).toEqual({
      path: "qwen.js",
      label: "Qwen Code",
    });
    await fs.mkdir(path.join(root, "package"));
    const entry = path.join(root, "package", "cli.js");
    await fs.writeFile(entry, "process.exit(0)");
    await fs.writeFile(
      path.join(root, "runtime.json"),
      JSON.stringify({
        entry: "package/cli.js",
        label: "Local CLI",
        sha256: createHash("sha256").update("process.exit(0)").digest("hex"),
      }),
    );
    expect((await bundledCli(root, "qwen.js"))?.path).toBe(await fs.realpath(entry));
    await fs.writeFile(entry, "changed");
    await expect(bundledCli(root, "qwen.js")).rejects.toThrow("сумма");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
