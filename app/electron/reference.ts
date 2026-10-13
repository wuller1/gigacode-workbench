import { promises as fs } from "node:fs";
import path from "node:path";
import { isWithin } from "./workspace";

const pageSize = 20_000;
const maxFileSize = 2 * 1024 * 1024;
const readableExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const ignoredDirectories = new Set([".git", "dist", "node_modules", "release"]);

function normalizeRequestedPath(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500)
    throw new Error("Choose a document from workbench_reference");
  const logical = value.replaceAll("\\", "/");
  if (
    logical.includes("\0") ||
    path.posix.isAbsolute(logical) ||
    /^[a-z]:/i.test(logical)
  )
    throw new Error("Reference is outside the bundle");
  const normalized = path.posix.normalize(logical);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../"))
    throw new Error("Reference is outside the bundle");
  return normalized;
}

function canonicalPath(requested: string) {
  if (
    requested.startsWith("workbench/") ||
    requested.startsWith("docs/suite/") ||
    requested.startsWith("ui-kit/") ||
    requested === "suite/implementation-plan.json" ||
    requested === "design/suite-workspace-prototype.html"
  )
    return requested;
  // Compatibility with the original workbench-only library.
  return `workbench/${requested}`;
}

function isAllowed(logical: string) {
  if (!readableExtensions.has(path.posix.extname(logical).toLowerCase()))
    return false;
  if (logical.startsWith("workbench/"))
    return !logical.startsWith("workbench/source/");
  if (logical.startsWith("docs/suite/")) return true;
  if (logical.startsWith("ui-kit/"))
    return !logical
      .split("/")
      .some((segment) => ignoredDirectories.has(segment));
  return (
    logical === "suite/implementation-plan.json" ||
    logical === "design/suite-workspace-prototype.html"
  );
}

async function listDirectory(
  root: string,
  relative: string,
  documents: string[],
) {
  const directory = path.join(root, ...relative.split("/"));
  let items;
  try {
    items = await fs.readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const item of items) {
    if (item.isSymbolicLink()) continue;
    const logical = `${relative}/${item.name}`;
    if (item.isDirectory()) {
      if (!ignoredDirectories.has(item.name) && logical !== "workbench/source")
        await listDirectory(root, logical, documents);
    } else if (item.isFile() && isAllowed(logical)) documents.push(logical);
  }
}

/**
 * Read-only, bounded access to the packaged reference library.
 * Only the explicitly shipped namespaces below are visible, even in development.
 */
export async function readReference(
  directory: string,
  request: { path?: unknown; offset?: unknown },
) {
  const root = await fs.realpath(directory);
  if (request.path === undefined) {
    const documents: string[] = [];
    await listDirectory(root, "workbench", documents);
    await listDirectory(root, "docs/suite", documents);
    await listDirectory(root, "ui-kit", documents);
    for (const logical of [
      "suite/implementation-plan.json",
      "design/suite-workspace-prototype.html",
    ]) {
      try {
        const stat = await fs.lstat(path.join(root, ...logical.split("/")));
        if (stat.isFile() && !stat.isSymbolicLink()) documents.push(logical);
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return {
      documents: documents.sort(),
      note: "Read only the reference relevant to the current role and next step.",
    };
  }

  const logical = canonicalPath(normalizeRequestedPath(request.path));
  if (!isAllowed(logical))
    throw new Error("Choose a document from workbench_reference");
  const candidate = path.resolve(root, ...logical.split("/"));
  if (!isWithin(root, candidate))
    throw new Error("Reference is outside the bundle");
  let file: string;
  try {
    file = await fs.realpath(candidate);
  } catch (error: any) {
    if (error?.code === "ENOENT") throw new Error("Reference was not found");
    throw error;
  }
  if (!isWithin(root, file)) throw new Error("Reference is outside the bundle");
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maxFileSize)
    throw new Error("Reference exceeds supported size");
  const offset = request.offset ?? 0;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0)
    throw new Error("Invalid reference offset");
  const text = await fs.readFile(file, "utf8"),
    start = Number(offset);
  if (start > text.length) throw new Error("Offset exceeds reference length");
  const end = Math.min(start + pageSize, text.length);
  return {
    path: logical,
    text: text.slice(start, end),
    offset: start,
    totalCharacters: text.length,
    nextOffset: end < text.length ? end : null,
  };
}
