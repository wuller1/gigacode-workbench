import { createReadStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { isWithin } from "./workspace";

/** The imported runtime has priority, but an invalid manifest never silently selects another CLI. */
export async function bundledCli(
  runtimeRoot: string,
  qwenPath?: string,
): Promise<{ path: string; label: string } | undefined> {
  const file = path.join(runtimeRoot, "runtime.json");
  let manifest: any;
  try {
    manifest = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error: any) {
    if (error.code === "ENOENT")
      return qwenPath ? { path: qwenPath, label: "Qwen Code" } : undefined;
    throw new Error("Не удалось прочитать описание встроенного CLI");
  }
  if (
    typeof manifest.entry !== "string" ||
    !/^package\//.test(manifest.entry) ||
    !/\.(exe|cjs|mjs|js)$/i.test(manifest.entry) ||
    !/^[a-f0-9]{64}$/i.test(manifest.sha256)
  )
    throw new Error("Неверное описание встроенного CLI");
  const root = await fs.realpath(runtimeRoot),
    entry = await fs.realpath(path.resolve(root, manifest.entry));
  if (!isWithin(root, entry))
    throw new Error("Встроенный CLI находится вне поставки");
  const stat = await fs.stat(entry);
  if (!stat.isFile() || stat.size > 1024 * 1024 * 1024)
    throw new Error("Неверный файл встроенного CLI");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(entry)) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha256.toLowerCase())
    throw new Error("Контрольная сумма встроенного CLI не совпала");
  return {
    path: entry,
    label:
      typeof manifest.label === "string"
        ? manifest.label.slice(0, 80)
        : "GigaCode CLI",
  };
}
