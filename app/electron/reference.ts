import { promises as fs } from "node:fs";
import path from "node:path";
import { isWithin } from "./workspace";

/** Read-only, bounded access to shipped instructions; never executes their contents. */
export async function readReference(
  directory: string,
  request: { path?: unknown; offset?: unknown },
) {
  const root = await fs.realpath(directory);
  if (request.path === undefined) {
    const documents: string[] = [];
    const visit = async (dir: string) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) await visit(file);
        else if (
          item.isFile() &&
          /\.(md|json|txt)$/i.test(item.name) &&
          !file.includes(`${path.sep}source${path.sep}`)
        )
          documents.push(path.relative(root, file).split(path.sep).join("/"));
      }
    };
    await visit(root);
    return {
      documents: documents.sort(),
      note: "Read only the reference relevant to the current role and next step.",
    };
  }
  if (
    typeof request.path !== "string" ||
    request.path.length > 500 ||
    !/\.(md|json|txt)$/i.test(request.path)
  )
    throw new Error("Choose a text document from workbench_reference");
  const file = await fs.realpath(path.resolve(root, request.path));
  if (!isWithin(root, file)) throw new Error("Reference is outside the bundle");
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
    throw new Error("Reference exceeds supported size");
  const offset = request.offset ?? 0;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0)
    throw new Error("Invalid reference offset");
  const text = await fs.readFile(file, "utf8"),
    start = Number(offset);
  if (start > text.length) throw new Error("Offset exceeds reference length");
  const end = Math.min(start + 20000, text.length);
  return {
    path: request.path,
    text: text.slice(start, end),
    offset: start,
    totalCharacters: text.length,
    nextOffset: end < text.length ? end : null,
  };
}
