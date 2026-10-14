#!/usr/bin/env node
/** Source-only, compare-first migration. Node 22+, no npm/global CLI installation. */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const PRIVATE = ".gigacode-upgrade";
const MAX_FILES = 20000,
  MAX_FILE = 16 * 1024 ** 2,
  MAX_TOTAL = 256 * 1024 ** 2;
const ROOTS = new Set([
  "app",
  "ide",
  "ui-kit",
  "workbench",
  "docs",
  "suite",
  "tools",
  "design",
]);
const ROOT_FILES = new Set([
  "LICENSE",
  "NOTICE",
  "MIGRATE-GIGACODE.md",
  "WORK-COMPUTER-BOOTSTRAP.md",
  "SUITE-UPGRADE-AGENT.md",
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const hashObject = (value) => sha(Buffer.from(json(value)));
const own = (value, key) => Object.hasOwn(value, key);
function rejectEmbeddedCredential(name, bytes) {
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|toml|ini|conf|txt|md|ps1)$/i.test(name))
    return;
  const text = bytes.toString("utf8");
  if (
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/.test(text) ||
    /\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|AKIA[0-9A-Z]{16})\b/.test(
      text,
    ) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(
      text,
    )
  )
    throw new Error(
      "Selected source contains a private-key/token marker; no credential content was printed. Remove it from the source bundle before migration.",
    );
}

export function safeRelative(value, allowRoot = false) {
  if (allowRoot && (value === "" || value === ".")) return "";
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2000 ||
    /[\\\x00-\x1f<>:"|?*]/.test(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error("Unsafe relative migration path.");
  return value;
}
function sourceAllowed(name) {
  const pieces = name.split("/"),
    base = pieces.at(-1);
  if (!ROOTS.has(pieces[0]) && !(pieces.length === 1 && ROOT_FILES.has(base)))
    return false;
  if (
    pieces.some((piece) =>
      [
        ".git",
        ".gigacode",
        ".qwen",
        ".codex",
        ".ssh",
        ".aws",
        ".idea",
        ".theia",
        PRIVATE,
        "node_modules",
        "dist",
        "dist-electron",
        "release",
        "runtime",
        "bundled-cli",
        "local-data",
        "workbench-memory",
        "plugin-cache",
        "plugins",
        "test-results",
        "playwright-report",
      ].includes(piece.toLowerCase()),
    )
  )
    return false;
  if (
    /^(?:\.env(?:\..*)?|state\.json(?:\..*)?|owner\.lock|local-context\.json|mcp\.json|credentials?(?:\..*)?|secrets?(?:\..*)?|settings\.local\..*|\.DS_Store)$/i.test(
      base,
    )
  )
    return false;
  if (
    /\.(?:exe|dll|so|dylib|msi|dmg|jar|class|zip|7z|gz|tar|vsix|pem|key|p12|pfx|jks|kdb|crt|cer|log)$/i.test(
      base,
    )
  )
    return false;
  return true;
}
function destinationAllowed(name) {
  safeRelative(name);
  if (
    name.toLowerCase() === "agents.md" ||
    name.split("/").some((piece) => piece.toLowerCase() === PRIVATE) ||
    !sourceAllowed("app/" + name)
  )
    throw new Error(
      "Migration destination is reserved or contains protected runtime/credential data.",
    );
}
export function normalizeMappings(value = [{ source: "", target: "" }]) {
  if (!Array.isArray(value) || !value.length || value.length > 32)
    throw new Error("Expected 1–32 prefix mappings.");
  const mappings = value
    .map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).some((key) => !["source", "target"].includes(key))
      )
        throw new Error("Invalid migration mapping.");
      const normalize = (prefix) =>
        safeRelative(
          typeof prefix === "string" ? prefix.replace(/\/$/, "") : prefix,
          true,
        );
      const source = normalize(item.source),
        target = normalize(item.target);
      if (
        target &&
        (target.split("/").some((piece) => piece.toLowerCase() === PRIVATE) ||
          !sourceAllowed("app/" + target + "/file.txt"))
      )
        throw new Error("Protected migration mapping destination.");
      return { source, target };
    })
    .sort(
      (a, b) =>
        b.source.length - a.source.length || a.source.localeCompare(b.source),
    );
  if (new Set(mappings.map((item) => item.source)).size !== mappings.length)
    throw new Error("Duplicate source mapping.");
  return mappings;
}
function mapped(name, mappings) {
  const mapping = mappings.find(
    (item) =>
      !item.source ||
      name === item.source ||
      name.startsWith(item.source + "/"),
  );
  if (!mapping) return;
  const remainder = mapping.source
    ? name.slice(mapping.source.length).replace(/^\//, "")
    : name;
  const result = [mapping.target, remainder].filter(Boolean).join("/");
  destinationAllowed(result);
  return result;
}
function selected(name, mappings, directory = false) {
  return mappings.some(
    (mapping) =>
      !mapping.source ||
      name === mapping.source ||
      name.startsWith(mapping.source + "/") ||
      (directory && mapping.source.startsWith(name + "/")),
  );
}
async function rootDirectory(input, label) {
  const absolute = path.resolve(input),
    stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a real directory, not a symlink.`);
  const root = path.parse(absolute).root;
  let ancestor = root;
  for (const part of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    if ((await fs.lstat(ancestor)).isSymbolicLink())
      throw new Error(`${label} directory has a symlink/junction ancestor.`);
  }
  const real = await fs.realpath(absolute);
  if (path.resolve(real) !== absolute && process.platform !== "win32")
    throw new Error(`${label} directory has a symlink ancestor.`);
  return real;
}
async function safePath(root, name, allowMissing = true) {
  safeRelative(name);
  let current = root;
  for (const [index, part] of name.split("/").entries()) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (
        stat.isSymbolicLink() ||
        (index < name.split("/").length - 1 && !stat.isDirectory())
      )
        throw new Error(
          "Migration path contains a symlink or non-directory ancestor.",
        );
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing)
        return path.join(root, ...name.split("/"));
      throw error;
    }
  }
  return current;
}
async function readBounded(file, maximum = MAX_FILE) {
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum)
      throw new Error(
        "Migration file is not regular or exceeds its byte limit.",
      );
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error("Migration file changed while being read.");
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}
async function targetBytes(root, name) {
  try {
    return await readBounded(await safePath(root, name));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Small bounded ZIP reader for our source archives; no shell extraction or path trust. */
function zipFiles(bytes, mappings) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error("Unsupported or invalid source ZIP.");
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    central = bytes.readUInt32LE(end + 16);
  if (
    count > MAX_FILES ||
    count === 0xffff ||
    central === 0xffffffff ||
    central + centralSize > end ||
    bytes.readUInt16LE(end + 8) !== count
  )
    throw new Error(
      "ZIP64/multi-disk or oversized ZIP is unsupported; unpack the trusted source first.",
    );
  const entries = [],
    names = new Set();
  let offset = central,
    total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid source ZIP central directory.");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      checksum = bytes.readUInt32LE(offset + 16),
      compressed = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      mode = bytes.readUInt32LE(offset + 38) >>> 16,
      local = bytes.readUInt32LE(offset + 42);
    if (
      offset + 46 + length + extra + comment > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > MAX_FILE ||
      compressed > MAX_FILE ||
      ![0, 0x8000, 0x4000].includes(mode & 0xf000)
    )
      throw new Error(
        "Source ZIP contains encrypted, linked, unsupported or oversized entries.",
      );
    const raw = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    );
    const directory = raw.endsWith("/"),
      name = safeRelative(directory ? raw.slice(0, -1) : raw);
    if (names.has(name.toLowerCase()))
      throw new Error("Source ZIP has duplicate or case-colliding paths.");
    names.add(name.toLowerCase());
    total += size;
    if (total > MAX_TOTAL)
      throw new Error("Source ZIP exceeds the expanded byte budget.");
    if (!directory)
      entries.push({ name, local, flags, method, compressed, size, checksum });
    offset += 46 + length + extra + comment;
  }
  if (offset !== central + centralSize)
    throw new Error("Source ZIP directory bounds do not match.");
  const first = entries[0]?.name.split("/")[0];
  const strip =
    first &&
    !ROOTS.has(first) &&
    entries.every((entry) => entry.name.startsWith(first + "/"))
      ? first + "/"
      : "";
  const files = new Map();
  for (const entry of entries) {
    const name = safeRelative(
      strip ? entry.name.slice(strip.length) : entry.name,
    );
    if (!sourceAllowed(name) || !selected(name, mappings)) continue;
    const start = entry.local;
    if (start + 30 > central || bytes.readUInt32LE(start) !== 0x04034b50)
      throw new Error("Invalid ZIP local header.");
    const nameLength = bytes.readUInt16LE(start + 26),
      extraLength = bytes.readUInt16LE(start + 28),
      data = start + 30 + nameLength + extraLength;
    if (
      data + entry.compressed > central ||
      bytes.readUInt16LE(start + 8) !== entry.method ||
      bytes.readUInt16LE(start + 6) !== entry.flags ||
      decoder.decode(bytes.subarray(start + 30, start + 30 + nameLength)) !==
        entry.name
    )
      throw new Error("ZIP local/central entries do not match.");
    const compressed = bytes.subarray(data, data + entry.compressed);
    const content =
      entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, {
            maxOutputLength: Math.max(1, entry.size),
          });
    if (content.length !== entry.size || crc32(content) !== entry.checksum)
      throw new Error("ZIP content checksum/size mismatch.");
    rejectEmbeddedCredential(name, content);
    files.set(name, content);
  }
  return files;
}
async function sourceFiles(input, mappings) {
  const absolute = path.resolve(input),
    stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error("Source must not be a symlink.");
  if (stat.isFile()) {
    if (!/\.zip$/i.test(absolute))
      throw new Error(
        "Source file must be a ZIP of source code, or an unpacked checkout directory.",
      );
    const content = await readBounded(absolute, MAX_TOTAL);
    return {
      kind: "zip",
      root: absolute,
      archiveHash: sha(content),
      files: zipFiles(content, mappings),
      read: async (name, files) => files.get(name),
    };
  }
  const root = await rootDirectory(absolute, "Source");
  const files = new Map();
  let total = 0,
    visited = 0;
  async function walk(directory, prefix = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > MAX_FILES * 2)
        throw new Error("Source directory exceeds the file inventory budget.");
      const name = prefix + entry.name;
      if (
        !sourceAllowed(entry.isDirectory() ? name + "/file.txt" : name) ||
        !selected(name, mappings, entry.isDirectory())
      )
        continue;
      safeRelative(name);
      if (entry.isSymbolicLink())
        throw new Error(
          "Source contains a symlink in its selected source paths.",
        );
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), name + "/");
      else if (entry.isFile()) {
        const content = await readBounded(await safePath(root, name, false));
        rejectEmbeddedCredential(name, content);
        total += content.length;
        if (files.size >= MAX_FILES || total > MAX_TOTAL)
          throw new Error("Source exceeds its file/byte budget.");
        files.set(name, content);
      }
    }
  }
  await walk(root);
  return {
    kind: "directory",
    root,
    files,
    read: async (name) => readBounded(await safePath(root, name, false)),
  };
}
async function receiptAt(root) {
  const bytes = await targetBytes(root, `${PRIVATE}/receipt.json`);
  if (!bytes) return { bytes: null, value: { schemaVersion: 1, entries: {} } };
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(
      "Migration receipt is invalid; preserve it before recovery.",
    );
  }
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !value.entries ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries) ||
    Object.keys(value.entries).length > MAX_FILES
  )
    throw new Error(
      "Unsupported migration receipt; do not reset adapted baselines.",
    );
  for (const [name, entry] of Object.entries(value.entries)) {
    safeRelative(name);
    destinationAllowed(entry.target);
    if (
      !/^[a-f0-9]{64}$/.test(entry.sourceHash) ||
      !/^[a-f0-9]{64}$/.test(entry.targetHash) ||
      !["source_equal", "adapted"].includes(entry.mode)
    )
      throw new Error("Invalid migration baseline entry.");
    if (
      entry.sourceBase !== undefined &&
      entry.sourceBase !== `${PRIVATE}/source-bases/${entry.sourceHash}/${name}`
    )
      throw new Error("Invalid retained source baseline reference.");
  }
  return { bytes, value };
}
function quickInstructions() {
  return `# Быстрая миграция GigaCode Desktop\n\nЭтот проект — существующая пользовательская оболочка. Следующее обновление переносится из исходников GigaCode (историческое имя GigaCode Workbench), а не в установленный CLI.\n\n1. Прочитай новый исходный MIGRATE-GIGACODE.md и локальный receipt.json рядом с этим файлом. Используй сохранённые prefix mappings; не загружай весь пакет/историю.\n2. Сначала план: node <new-source>/tools/upgrade-workbench.mjs --source <new-source-or-source.zip> --target <this-project> --mappings <saved-mappings.json>. План не изменяет код.\n3. Сравни merge_required с прошлой базой/резервной копией, текущим проектом и новым source. Сохраняй доказуемо лучшие локальные решения. Не заменяй адаптированные файлы исходным вариантом автоматически.\n4. Проверь реальные затронутые сценарии и UI/UX. Только если оба варианта имеют несовместимые преимущества, покажи diff/аргументы и спроси какой оставить.\n5. Применяй новый подтверждённый план через --apply --expected-plan-hash <hash>. После ручного merge запиши его через --record-adapted <source-path> --verification-ref <test-or-decision-reference> с новым планом/hash; эта команда не переписывает целевой файл.\n6. Не копируй CLI, node_modules/runtime/installed plugins, credentials, MCP bindings, личную память, историю или local state. GigaCode CLI 26.10.6 и его настройки остаются локальными. Не запускай глобальную установку CLI.\n7. Сохрани результаты/следующий шаг рядом с receipt. При interrupted journal сначала проверь реальный target и backup; не повторяй неизвестную запись.\n\nИнструмент переносит только совместимые неизменённые source baselines и новые файлы. Он не доказывает семантическую совместимость архитектур и не выполняет тесты/команды приложения.\n`;
}
const POINTER = `\n<!-- gigacode-desktop-upgrade:v1 -->\n## Обновление GigaCode Desktop\nДля переноса следующей сборки сначала прочитай [локальные инструкции быстрой миграции](.gigacode-upgrade/QUICK-UPGRADE.md) и receipt.json рядом с ними. Переноси исходники оболочки, сохраняя более удачный локальный код; установленный GigaCode CLI, credentials, MCP bindings, память и runtime не заменяй.\n<!-- /gigacode-desktop-upgrade:v1 -->\n`;
export async function planUpgrade(options) {
  const targetRoot = await rootDirectory(options.target, "Target");
  const mappings = normalizeMappings(options.mappings);
  const source = await sourceFiles(options.source, mappings);
  if (
    source.kind === "directory" &&
    (source.root === targetRoot ||
      source.root.startsWith(targetRoot + path.sep) ||
      targetRoot.startsWith(source.root + path.sep))
  )
    throw new Error(
      "Source and target must be separate non-nested source directories.",
    );
  const baseline = await receiptAt(targetRoot),
    entries = [],
    destinations = new Set();
  for (const [name, bytes] of [...source.files.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const target = mapped(name, mappings);
    if (!target) continue;
    if (destinations.has(target.toLowerCase()))
      throw new Error("Migration mappings have a destination collision.");
    destinations.add(target.toLowerCase());
    const sourceHash = sha(bytes),
      current = await targetBytes(targetRoot, target),
      targetHash = current ? sha(current) : null;
    const prior = own(baseline.value.entries, name)
      ? baseline.value.entries[name]
      : undefined;
    let decision, reason;
    if (!current) {
      decision = "create";
      reason = "Target file is absent; no existing implementation is replaced.";
    } else if (targetHash === sourceHash) {
      decision = "unchanged";
      reason = "Target already has these exact source bytes.";
    } else if (!prior || prior.target !== target) {
      decision = "merge_required";
      reason =
        "Existing target has no matching imported baseline; compare its implementation.";
    } else if (
      prior.mode === "adapted" ||
      prior.targetHash !== prior.sourceHash
    ) {
      decision = "merge_required";
      reason =
        "Target baseline is adapted; upstream changes require an explicit merge, even if target is unchanged.";
    } else if (targetHash !== prior.targetHash) {
      decision = "merge_required";
      reason =
        "Target changed since the last confirmed import; preserve the local work.";
    } else {
      decision = "update";
      reason = "Target still equals the prior unmodified source baseline.";
    }
    entries.push({
      source: name,
      target,
      sourceHash,
      targetHash,
      decision,
      reason,
      ...(prior
        ? {
            previousSourceHash: prior.sourceHash,
            previousTargetHash: prior.targetHash,
            previousMode: prior.mode,
            ...(prior.sourceBase
              ? { previousSourceBase: prior.sourceBase }
              : {}),
          }
        : {}),
    });
  }
  if (!entries.length)
    throw new Error("No allowed source files match these prefix mappings.");
  const agents = await targetBytes(targetRoot, "AGENTS.md"),
    quick = await targetBytes(targetRoot, `${PRIVATE}/QUICK-UPGRADE.md`),
    savedMappings = await targetBytes(targetRoot, `${PRIVATE}/mappings.json`),
    ignore = await targetBytes(targetRoot, `${PRIVATE}/.gitignore`);
  let agentsText = "";
  if (agents) {
    try {
      agentsText = new TextDecoder("utf-8", { fatal: true }).decode(agents);
    } catch {
      throw new Error(
        "Existing AGENTS.md is not UTF-8; preserve it and merge its pointer explicitly.",
      );
    }
    if (agentsText.includes("\0"))
      throw new Error(
        "Existing AGENTS.md has an unsupported/binary encoding; preserve it before merging.",
      );
  }
  const body = {
    schemaVersion: 1,
    product: "GigaCode Desktop source migration",
    source: {
      kind: source.kind,
      root: source.root,
      manifestHash: hashObject(
        entries.map((entry) => [entry.source, entry.sourceHash]),
      ),
      ...(source.archiveHash ? { archiveHash: source.archiveHash } : {}),
    },
    targetRoot,
    mappings,
    baselineReceiptHash: baseline.bytes ? sha(baseline.bytes) : null,
    entries,
    metadata: {
      agentsHash: agents ? sha(agents) : null,
      quickInstructionsHash: quick ? sha(quick) : null,
      mappingsHash: savedMappings ? sha(savedMappings) : null,
      privateIgnoreHash: ignore ? sha(ignore) : null,
      pointerNeeded: !agentsText.includes(
        "<!-- gigacode-desktop-upgrade:v1 -->",
      ),
    },
  };
  return { ...body, planHash: hashObject(body) };
}
async function mkdirSafe(root, name) {
  const parent = name.split("/").slice(0, -1).join("/");
  if (!parent) return;
  for (let i = 1; i <= parent.split("/").length; i++) {
    const prefix = parent.split("/").slice(0, i).join("/");
    const full = await safePath(root, prefix);
    await fs.mkdir(full).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await fs.lstat(full);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Migration directory changed or is linked.");
  }
}
async function durableFile(file, bytes) {
  const handle = await fs.open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncParent(file) {
  if (process.platform === "win32") return;
  const directory = await fs.open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function exclusiveInstall(source, destination) {
  try {
    await fs.link(source, destination);
  } catch (error) {
    if (
      !["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(
        error.code,
      )
    )
      throw error;
    // SMB/policy may forbid hard links. EXCL still refuses an appearing file;
    // interrupted copies remain prepared/unknown until readback, never confirmed.
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}
/** No overwrite rename: move old bytes to a unique recovery backup, then link exclusively. */
async function installFile(root, name, bytes, expectedHash, backupName) {
  await mkdirSafe(root, name);
  const destination = await safePath(root, name),
    current = await targetBytes(root, name);
  if ((current ? sha(current) : null) !== expectedHash)
    throw new Error(
      "Target CAS mismatch before file commit; no replacement performed.",
    );
  const temp = destination + `.gigacode-new-${randomUUID()}`;
  await durableFile(temp, bytes);
  let backup;
  try {
    if (current) {
      await mkdirSafe(root, backupName);
      backup = await safePath(root, backupName);
      await fs.rename(destination, backup);
      if (sha(await readBounded(backup)) !== expectedHash) {
        await exclusiveInstall(backup, destination).catch(() => undefined);
        throw new Error(
          "Target changed at the commit boundary; recovery backup preserved, newer destination was not overwritten.",
        );
      }
    }
    try {
      await exclusiveInstall(temp, destination);
    } catch (error) {
      if (backup)
        await exclusiveInstall(backup, destination).catch(() => undefined);
      throw new Error(
        "Destination appeared or exclusive file installation failed; target/recovery backup were preserved.",
        { cause: error },
      );
    }
    if (backup && sha(await readBounded(backup)) !== expectedHash)
      throw new Error(
        "An editor changed the old file during migration; preserve backup and reconcile before continuing.",
      );
    if (sha(await readBounded(destination)) !== sha(bytes))
      throw new Error(
        "Target changed immediately after commit; migration is unconfirmed.",
      );
    await syncParent(destination);
    if (backup) await syncParent(backup);
    return backupName && backup ? backupName : undefined;
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}
export async function applyUpgrade(options) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedPlanHash || ""))
    throw new Error("Apply requires the exact reviewed ExpectedPlanHash.");
  const plan = await planUpgrade(options);
  if (plan.planHash !== options.expectedPlanHash)
    throw new Error(
      "Migration plan changed: source, target, mappings or receipt CAS mismatch. Review a fresh plan.",
    );
  const root = plan.targetRoot;
  await mkdirSafe(root, `${PRIVATE}/lock`);
  const lockPath = await safePath(root, `${PRIVATE}/owner.lock`);
  let lock;
  try {
    lock = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Another or interrupted upgrade owns this target. Inspect its journal before explicit recovery.",
      );
    throw error;
  }
  const token = randomUUID(),
    run = randomUUID(),
    journalPath = `${PRIVATE}/journal-${run}.json`;
  const journal = {
    schemaVersion: 1,
    id: run,
    token,
    planHash: plan.planHash,
    status: "preparing",
    actions: [],
  };
  let journalHash;
  const saveJournal = async () => {
    const file = await safePath(root, journalPath),
      bytes = Buffer.from(json(journal));
    if (!journalHash) await durableFile(file, bytes);
    else {
      if (sha(await readBounded(file)) !== journalHash)
        throw new Error(
          "Migration journal changed outside its owner; preserve it before recovery.",
        );
      const temp = file + ".tmp-" + randomUUID();
      await durableFile(temp, bytes);
      await fs.rename(temp, file);
    }
    await syncParent(file);
    journalHash = sha(bytes);
  };
  try {
    await lock.writeFile(json({ pid: process.pid, token }));
    await lock.sync();
    // Acquire first, then recheck all inputs. The lock only coordinates this tool,
    // not arbitrary editors; stop target agents/editors before applying source changes.
    const lockedPlan = await planUpgrade(options);
    if (lockedPlan.planHash !== plan.planHash)
      throw new Error(
        "Migration inputs changed while acquiring the upgrade lock.",
      );
    const source = await sourceFiles(options.source, plan.mappings),
      baseline = await receiptAt(root);
    const next = structuredClone(baseline.value);
    next.source = plan.source;
    next.mappings = plan.mappings;
    next.pendingMerges = plan.entries
      .filter((entry) => entry.decision === "merge_required")
      .map((entry) => ({
        source: entry.source,
        target: entry.target,
        sourceHash: entry.sourceHash,
        targetHash: entry.targetHash,
      }));
    const adapted = options.recordAdapted ?? [];
    if (
      !Array.isArray(adapted) ||
      adapted.length > 100 ||
      adapted.some((name) => typeof name !== "string") ||
      (adapted.length &&
        (typeof options.verificationRef !== "string" ||
          !options.verificationRef.trim() ||
          options.verificationRef.length > 1000 ||
          /[\x00-\x1f]/.test(options.verificationRef)))
    )
      throw new Error(
        "Recording adapted files requires bounded source paths and a real test/decision verification reference.",
      );
    for (const name of adapted)
      if (
        !plan.entries.some(
          (entry) =>
            entry.source === name && entry.decision === "merge_required",
        )
      )
        throw new Error(
          "Only a held merge from this exact plan can be recorded as adapted.",
        );
    await saveJournal();
    for (const entry of plan.entries) {
      if (
        entry.decision === "merge_required" &&
        !adapted.includes(entry.source)
      )
        continue;
      const current = await targetBytes(root, entry.target);
      if ((current ? sha(current) : null) !== entry.targetHash)
        throw new Error(
          "Target changed after migration preflight; remaining writes stopped.",
        );
      const bytes = await source.read(entry.source, source.files);
      if (!bytes || sha(bytes) !== entry.sourceHash)
        throw new Error(
          "Source changed after migration preflight; remaining writes stopped.",
        );
      const sourceBase = `${PRIVATE}/source-bases/${entry.sourceHash}/${entry.source}`;
      const retained = await targetBytes(root, sourceBase);
      if (retained && sha(retained) !== entry.sourceHash)
        throw new Error(
          "Retained source baseline is corrupt; preserve it before merging or importing.",
        );
      if (!retained) {
        const action = {
          target: sourceBase,
          beforeHash: null,
          afterHash: entry.sourceHash,
          phase: "prepared",
          metadata: true,
          sourceBase: true,
        };
        journal.actions.push(action);
        await saveJournal();
        await installFile(root, sourceBase, bytes, null);
        action.phase = "confirmed";
        await saveJournal();
      }
      if (["create", "update"].includes(entry.decision)) {
        const commitBytes = await source.read(entry.source, source.files);
        if (!commitBytes || sha(commitBytes) !== entry.sourceHash)
          throw new Error(
            "Source changed at the file commit boundary; remaining writes stopped.",
          );
        const action = {
          source: entry.source,
          target: entry.target,
          beforeHash: entry.targetHash,
          afterHash: entry.sourceHash,
          phase: "prepared",
        };
        journal.actions.push(action);
        journal.status = "applying";
        await saveJournal();
        action.backup = await installFile(
          root,
          entry.target,
          commitBytes,
          entry.targetHash,
          `${PRIVATE}/backups/${run}/${entry.target}`,
        );
        if (
          sha(await source.read(entry.source, source.files)) !==
          entry.sourceHash
        )
          throw new Error(
            "Source changed during file commit; journal remains unconfirmed for reconciliation.",
          );
        action.phase = "confirmed";
        await saveJournal();
      }
      const isAdapted = adapted.includes(entry.source);
      next.entries[entry.source] = {
        target: entry.target,
        sourceHash: entry.sourceHash,
        targetHash: isAdapted ? entry.targetHash : entry.sourceHash,
        sourceBase,
        mode: isAdapted ? "adapted" : "source_equal",
        ...(isAdapted ? { verificationRef: options.verificationRef } : {}),
      };
    }
    next.pendingMerges = next.pendingMerges.filter(
      (entry) => !adapted.includes(entry.source),
    );
    const metadata = [
      {
        name: `${PRIVATE}/mappings.json`,
        bytes: Buffer.from(json(plan.mappings)),
        expected: plan.metadata.mappingsHash,
      },
    ];
    // Preserve local migration notes/instructions rather than regenerating them.
    if (plan.metadata.quickInstructionsHash === null)
      metadata.push({
        name: `${PRIVATE}/QUICK-UPGRADE.md`,
        bytes: Buffer.from(quickInstructions()),
        expected: null,
      });
    if (plan.metadata.privateIgnoreHash === null)
      metadata.push({
        name: `${PRIVATE}/.gitignore`,
        bytes: Buffer.from("*\n"),
        expected: null,
      });
    if (plan.metadata.pointerNeeded) {
      const current = await targetBytes(root, "AGENTS.md");
      metadata.push({
        name: "AGENTS.md",
        bytes: Buffer.concat([
          current || Buffer.alloc(0),
          Buffer.from(POINTER),
        ]),
        expected: plan.metadata.agentsHash,
      });
    }
    metadata.push({
      name: `${PRIVATE}/receipt.json`,
      bytes: Buffer.from(json(next)),
      expected: plan.baselineReceiptHash,
    });
    for (const item of metadata) {
      if (sha(item.bytes) === item.expected) continue;
      const action = {
        target: item.name,
        beforeHash: item.expected,
        afterHash: sha(item.bytes),
        phase: "prepared",
        metadata: true,
      };
      journal.actions.push(action);
      await saveJournal();
      action.backup = await installFile(
        root,
        item.name,
        item.bytes,
        item.expected,
        `${PRIVATE}/backups/${run}/${item.name}`,
      );
      action.phase = "confirmed";
      await saveJournal();
    }
    journal.status = "complete";
    await saveJournal();
    return {
      status: "complete",
      planHash: plan.planHash,
      copied: journal.actions.filter((action) => !action.metadata).length,
      heldMerges: next.pendingMerges.length,
      receipt: `${PRIVATE}/receipt.json`,
      instructions: `${PRIVATE}/QUICK-UPGRADE.md`,
      journal: journalPath,
      noCliChanges: true,
    };
  } catch (error) {
    // The journal remains authoritative for partial application; do not roll
    // back changed/user files or hide a confirmed subset as an all-or-nothing failure.
    journal.status = "interrupted";
    journal.error = String(error.message).slice(0, 1000);
    await saveJournal().catch(() => undefined);
    throw new Error(
      `Migration stopped; preserve ${journalPath} (if present) and recovery backups. ${error.message}`,
    );
  } finally {
    await lock.close().catch(() => undefined);
    const owner = await fs
      .readFile(lockPath, "utf8")
      .then(
        (bytes) => JSON.parse(bytes),
        () => undefined,
      )
      .catch(() => undefined);
    if (owner?.token === token) await fs.unlink(lockPath);
  }
}
async function main(argv) {
  const options = {},
    adapted = [];
  let output, mappingFile;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--apply") options.apply = true;
    else if (key === "--plan-only") options.apply = false;
    else if (key === "--source") options.source = argv[++i];
    else if (key === "--target") options.target = argv[++i];
    else if (key === "--mappings") mappingFile = argv[++i];
    else if (key === "--expected-plan-hash")
      options.expectedPlanHash = argv[++i];
    else if (key === "--record-adapted") adapted.push(argv[++i]);
    else if (key === "--verification-ref") options.verificationRef = argv[++i];
    else if (key === "--out") output = argv[++i];
    else
      throw new Error(
        "Unknown option. Use --source <checkout|source.zip> --target <existing-desktop-source> [--mappings <json>] [--apply --expected-plan-hash <hash>] [--out <plan.json>].",
      );
  }
  if (!options.source || !options.target)
    throw new Error(
      "Source and existing desktop target paths are required. This tool does not install or configure the CLI.",
    );
  if (mappingFile) {
    const bytes = await readBounded(path.resolve(mappingFile), 100000);
    try {
      // Windows PowerShell 5.1 writes a UTF-8 BOM with -Encoding UTF8.
      // The fatal decoder accepts/removes that leading BOM only; invalid UTF-8
      // and UTF-16 remain errors rather than silently changing mapped paths.
      options.mappings = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error(
        "Migration mappings must be UTF-8 JSON (a leading UTF-8 BOM is accepted).",
      );
    }
  }
  options.recordAdapted = adapted;
  const result = options.apply
    ? await applyUpgrade(options)
    : await planUpgrade(options);
  if (output)
    await fs.writeFile(path.resolve(output), json(result), {
      flag: "wx",
      mode: 0o600,
    });
  else process.stdout.write(json(result));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
