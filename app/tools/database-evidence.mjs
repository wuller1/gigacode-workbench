import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
export const appRoot = path.resolve(import.meta.dirname, "..");
export async function databaseHashes() {
  const files = [
    ...(await fs.readdir(path.join(appRoot, "electron/database")))
      .filter((n) => n.endsWith(".ts"))
      .map((n) => "app/electron/database/" + n),
    ...[
      "shared/database.ts",
      "shared/sql.ts",
      "src/DatabasePanel.tsx",
      "src/DatabaseEffect.tsx",
      "src/DatabaseHistory.tsx",
      "src/DatabaseExplorer.tsx",
      "src/DatabaseSettings.tsx",
      "src/SqlEditor.tsx",
      "src/SqlPlan.tsx",
      "src/database.css",
      "electron/main.ts",
      "electron/mcp.ts",
      "package-lock.json",
      "tests/database-live.test.ts",
      "tests/database-sql.test.ts",
      "tools/test-database-live.mjs",
      "tools/test-database-ui.mjs",
      "tools/database-evidence.mjs",
    ].map((n) => "app/" + n),
  ];
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.resolve(appRoot, "..", file)))
          .digest("hex"),
      ]),
    ),
  );
}
export async function databaseEvidence(name, data) {
  const dir = path.resolve(appRoot, "../docs/suite/evidence");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(
    file + ".pending",
    JSON.stringify({ ...data, sourceHashes: await databaseHashes() }, null, 2) +
      "\n",
  );
  await fs.rename(file + ".pending", file);
}
