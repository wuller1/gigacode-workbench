import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { javascriptEntrypointArgs } from "./acp.js";

/** Instructions and runtime capability evidence are host DTOs, never invented ACP fields. */
export interface InstructionManifest {
  schemaVersion: 1;
  compilerVersion: "workbench-instructions/1";
  normalization: "UTF-8; CRLF/CR to LF; outer whitespace trimmed";
  compiledContentSha256: string;
  core: { version: string; sha256: string };
  role: { id: string; version: string; sha256: string };
}
export interface CompiledInstructions {
  text: string;
  contentHash: string;
  fingerprint: string;
  manifest: InstructionManifest;
}
export interface PromptCapabilityEvidence {
  /** Binds this evidence to the selected path; not exposed in user-facing receipts. */
  executablePath: string;
  runtimeFingerprint: string;
  runtimeVersion?: string;
  family: "qwen" | "unknown";
  support: "source_verified" | "unknown";
  supportsToollessRouter: boolean;
  helpVerified: boolean;
  evidenceScope: "reviewed_qwen_0.25.1_source" | "unverified_runtime";
  /** Startup, effective provider request and model obedience require separate evidence. */
  reason: string;
}
export interface PromptBindingReceipt {
  schemaVersion: 1;
  delivery: "append_system" | "context_only";
  state: "prepared";
  profileId: string;
  fingerprint: string;
  contentHash: string;
  runtimeFingerprint: string;
  runtimeVersion?: string;
  evidenceScope: PromptCapabilityEvidence["evidenceScope"];
  reason: string;
}
export interface PromptLaunchPlan {
  args: string[];
  receipt: PromptBindingReceipt;
  /** Include only in the first user-context packet when system append is unavailable. */
  contextInstructions?: string;
}

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const invalidText = /[\0\x01-\x08\x0b\x0c\x0e-\x1f]/;
function normalizeInstruction(value: string, label: string): string {
  if (typeof value !== "string" || invalidText.test(value))
    throw new Error(`Invalid ${label} instructions.`);
  // Invalid UTF-16 must not collapse to identical UTF-8 replacement bytes/hashes.
  if (Buffer.from(value, "utf8").toString("utf8") !== value)
    throw new Error(`Invalid Unicode in ${label} instructions.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 64 * 1024)
    throw new Error(`${label} instructions are empty or exceed 64 KiB.`);
  return normalized;
}
function version(value: string | undefined, hash: string): string {
  const result = value ?? `sha256:${hash}`;
  if (
    typeof result !== "string" ||
    !result.trim() ||
    result.length > 160 ||
    /[\x00-\x20]/.test(result)
  )
    throw new Error("Invalid instruction version.");
  return result;
}

/** Exactly one role, no catalog/history/SDD duplication and no silent truncation. */
export function compileInstructions(input: {
  core: string;
  role: string;
  profileId: string;
  coreVersion?: string;
  roleVersion?: string;
}): CompiledInstructions {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.profileId))
    throw new Error("Invalid instruction profile identity.");
  const core = normalizeInstruction(input.core, "common");
  const role = normalizeInstruction(input.role, "role");
  const coreHash = digest(core),
    roleHash = digest(role);
  const text = [
    "# Workbench common instructions",
    core,
    `# Workbench role: ${input.profileId}`,
    role,
  ].join("\n\n");
  const manifest: InstructionManifest = {
    schemaVersion: 1,
    compilerVersion: "workbench-instructions/1",
    normalization: "UTF-8; CRLF/CR to LF; outer whitespace trimmed",
    compiledContentSha256: digest(text),
    core: { version: version(input.coreVersion, coreHash), sha256: coreHash },
    role: {
      id: input.profileId,
      version: version(input.roleVersion, roleHash),
      sha256: roleHash,
    },
  };
  if (Buffer.byteLength(text, "utf8") > 96 * 1024)
    throw new Error(
      "Compiled instructions exceed 96 KiB; simplify the sources.",
    );
  Object.freeze(manifest.core);
  Object.freeze(manifest.role);
  Object.freeze(manifest);
  return Object.freeze({
    text,
    contentHash: digest(text),
    fingerprint: digest(JSON.stringify(manifest)),
    manifest,
  });
}

async function syncInstructionDirectories(
  directory: string,
  dataDir: string,
): Promise<void> {
  // As in AtomicStore, Windows cannot promise a portable directory-fsync barrier.
  if (process.platform === "win32") return;
  for (const location of [directory, dataDir]) {
    const handle = await fs.open(location, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

const instructionWrites = new Map<string, Promise<void>>();

/** Keep the exact host-controlled instruction version, not only an unrecoverable hash. */
export async function retainInstructions(
  dataDir: string,
  compiled: CompiledInstructions,
): Promise<void> {
  if (
    digest(compiled.text) !== compiled.contentHash ||
    compiled.manifest.compiledContentSha256 !== compiled.contentHash ||
    digest(JSON.stringify(compiled.manifest)) !== compiled.fingerprint
  )
    throw new Error("Invalid instruction snapshot.");
  // Validate every caller before joining. AtomicStore owns this data directory;
  // this only coalesces its in-process identical publications, not other owners.
  const absoluteDir = path.resolve(dataDir);
  const key = JSON.stringify([
    process.platform === "win32" ? absoluteDir.toLowerCase() : absoluteDir,
    compiled.fingerprint,
  ]);
  const current = instructionWrites.get(key);
  if (current) return current;
  const pending = writeRetainedInstructions(absoluteDir, compiled).finally(
    () => {
      if (instructionWrites.get(key) === pending) instructionWrites.delete(key);
    },
  );
  instructionWrites.set(key, pending);
  return pending;
}

async function writeRetainedInstructions(
  dataDir: string,
  compiled: CompiledInstructions,
): Promise<void> {
  const directory = path.join(dataDir, "instructions");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `${compiled.fingerprint}.json`);
  let existing: CompiledInstructions | undefined;
  try {
    existing = await readRetainedInstructions(dataDir, compiled.fingerprint);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing) {
    if (existing.contentHash !== compiled.contentHash)
      throw new Error(
        "Retained instruction version conflicts with the requested snapshot.",
      );
    // A later call revalidates retained bytes and establishes its own barrier.
    await syncInstructionDirectories(directory, dataDir);
    return;
  }
  const temporary = path.join(
    directory,
    `${compiled.fingerprint}.${randomUUID()}.tmp`,
  );
  try {
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(compiled), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    // One data-directory owner and one in-flight publisher for this fingerprint.
    await fs.rename(temporary, destination);
    // Persist the file entry, then the instructions/ entry when first created.
    await syncInstructionDirectories(directory, dataDir);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readRetainedInstructions(
  dataDir: string,
  fingerprint: string,
): Promise<CompiledInstructions> {
  if (!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error("Invalid instruction fingerprint.");
  const file = path.join(dataDir, "instructions", `${fingerprint}.json`);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
    throw new Error("Invalid retained instruction file.");
  let value: CompiledInstructions;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error(
      "Retained instruction snapshot is corrupt; preserve it for recovery.",
    );
  }
  if (
    !value ||
    !value.manifest ||
    value.fingerprint !== fingerprint ||
    typeof value.text !== "string" ||
    Buffer.from(value.text, "utf8").toString("utf8") !== value.text ||
    digest(value.text) !== value.contentHash ||
    value.manifest.compiledContentSha256 !== value.contentHash ||
    digest(JSON.stringify(value.manifest)) !== fingerprint
  )
    throw new Error(
      "Retained instruction snapshot is corrupt; preserve it for recovery.",
    );
  return value;
}

// This is an explicitly reviewed upstream surface, not "any CLI with qwen in its name".
// Anchors cover entrypoints, flag declaration/parser/config, ACP argv inheritance and
// core/client assembly. They are compatibility evidence, not a software signature.
const QWEN_SOURCE_ANCHORS: Readonly<Record<string, string>> = Object.freeze({
  "package.json":
    "e573a2573c40eb6da1959e4a952beba0ca41c7cad24f9c763ada34ec0c7ef46d",
  "cli-entry.js":
    "06c2be3fcb1b451931d3e100acc7edd3ff748c74189f6fcc70300b5cd758f8e6",
  "cli.js": "96be25d7a110d2add8f63b8b1d3ac5b810c1ec91c58bdfad91d09c4a83ff2f24",
  "chunks/chunk-A5MAHML6.js":
    "71458d84f7e8933f963e0726647d1a0370753142afefdfb05ddcd0c5e1f68255",
  "chunks/chunk-HO724RA7.js":
    "c52a691e794f5908891f4c732d7dd739a3bbb17cca524cc23af8f1dcc677e77c",
  "chunks/acpAgent-FSCEU2SB.js":
    "9509f54054b2c5d65f72200407597afe4c4418e6fb8711519994f7a92eb4bbb1",
  "chunks/chunk-WCM7H5HK.js":
    "19734fcf4de3a4a9177da1a56b1b5925576147fb0c5c44e56af63e7da3763343",
  "chunks/chunk-DMQ2VTH6.js":
    "5e3d47dbd93183af382edb63885c26391b15d7292d0fde3e4f17a51bf98710df",
  // Headless dispatch checks the cumulative budget before launching each tool.
  "chunks/chunk-BFTRLQJP.js":
    "b755890e83986aabf99905088c2c45c7b3e7add7d37863102fec0bf11337198c",
  // ACP model selectors/opaque routes and the exact native AuthType enum.
  "chunks/chunk-GT4TCQ3R.js":
    "5791a3c9e56450b60e94cdcd39abde9472907fe0458d1f690160ac70a38f4691",
  "chunks/chunk-ZZZAYAJW.js":
    "985f26fc14ef5b0a45bef3ec6b375418fe5dfdd62c76852cc02989c42f4618c8",
});
const capabilityCache = new Map<string, Promise<PromptCapabilityEvidence>>();
const MAX_EVIDENCE_FILE_BYTES = 256 * 1024 * 1024;
// The 11 reviewed anchors total 5,811,298 bytes. Leave room for inspection while
// bounding aggregate reads of a modified package; unknown native CLIs retain 256 MiB.
const MAX_REVIEWED_EVIDENCE_BYTES = 32 * 1024 * 1024;

async function hashFile(
  file: string,
  budget: { remaining: number },
): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const limit = Math.min(MAX_EVIDENCE_FILE_BYTES, budget.remaining);
    const stat = await handle.stat();
    if (!stat.isFile() || limit <= 0 || stat.size > limit)
      throw new Error("CLI evidence file is invalid or too large.");
    const hash = createHash("sha256");
    // Read the same open file, including at most one byte beyond the budget to
    // detect growth after stat without allowing an unbounded stream.
    const stream = handle.createReadStream({
      autoClose: false,
      start: 0,
      end: limit,
    });
    for await (const chunk of stream) {
      budget.remaining -= chunk.length;
      if (budget.remaining < 0)
        throw new Error("CLI evidence read budget exceeded.");
      hash.update(chunk);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
async function verifiedHelp(executable: string): Promise<boolean> {
  const javascript = /\.(?:c?js|mjs)$/i.test(executable);
  const file = javascript ? process.execPath : executable;
  const args = javascript
    ? [...javascriptEntrypointArgs(executable), "--help"]
    : ["--help"];
  const env = { ...process.env };
  if (process.versions.electron && file === process.execPath)
    env.ELECTRON_RUN_AS_NODE = "1";
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { env, timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout) =>
        resolve(
          !error &&
            [
              "--append-system-prompt",
              "--safe-mode",
              "--max-tool-calls",
              "--max-session-turns",
              "--max-wall-time",
              "--output-format",
            ].every((flag) => stdout.includes(flag)),
        ),
    );
  });
}

/**
 * A bounded --help subprocess only for exact reviewed Qwen bytes; no model request,
 * settings write or global environment mutation. Unknown forks are not executed.
 * Fresh content hashes invalidate the cache even if file metadata is unchanged.
 * Giga and new Qwen versions remain
 * context-only until their own mechanism is reviewed and separately tested in ACP.
 */
export async function discoverPromptCapability(input: {
  executable: string;
  args?: string[];
  cwd?: string;
}): Promise<PromptCapabilityEvidence> {
  if (!path.isAbsolute(input.executable))
    throw new Error("Prompt binding requires an absolute CLI entrypoint.");
  const executable = await fs.realpath(input.executable);
  const packageRoot = path.dirname(executable);
  let packageInfo: { name?: string; version?: string } = {};
  let packageText: string | undefined;
  try {
    const packageFile = path.join(packageRoot, "package.json");
    const stat = await fs.stat(packageFile);
    if (stat.size <= 64 * 1024) {
      packageText = await fs.readFile(packageFile, "utf8");
      packageInfo = JSON.parse(packageText);
    }
  } catch {
    // Standalone native executables and unknown forks have no npm manifest.
  }
  const candidate =
    packageInfo?.name === "@qwen-code/qwen-code" &&
    packageInfo?.version === "0.25.1" &&
    ["cli.js", "cli-entry.js"].includes(path.basename(executable));
  const files = candidate
    ? Object.keys(QWEN_SOURCE_ANCHORS).map((name) =>
        path.join(packageRoot, name),
      )
    : [executable];
  const budget = {
    remaining: candidate
      ? MAX_REVIEWED_EVIDENCE_BYTES
      : MAX_EVIDENCE_FILE_BYTES,
  };
  const hashes: string[] = [];
  // Hash before cache lookup. Windows metadata can remain identical after an
  // in-place same-size rewrite; metadata is never evidence of reviewed bytes.
  for (const file of files)
    hashes.push(await hashFile(file, budget).catch(() => "unavailable"));
  const cacheKey = digest(
    JSON.stringify([input.executable, executable, hashes, packageText ?? null]),
  );
  const cached = capabilityCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async (): Promise<PromptCapabilityEvidence> => {
    const verified =
      candidate &&
      hashes.every(
        (hash, index) => hash === Object.values(QWEN_SOURCE_ANCHORS)[index],
      );
    const helpVerified = verified ? await verifiedHelp(executable) : false;
    const result: PromptCapabilityEvidence = {
      executablePath: input.executable,
      runtimeFingerprint: digest(
        JSON.stringify({
          entry: path.basename(executable),
          packageName: packageInfo?.name ?? null,
          packageVersion: packageInfo?.version ?? null,
          hashes,
        }),
      ),
      runtimeVersion:
        typeof packageInfo?.version === "string"
          ? packageInfo.version.slice(0, 80)
          : undefined,
      family: candidate ? "qwen" : "unknown",
      support: verified ? "source_verified" : "unknown",
      supportsToollessRouter: verified && helpVerified,
      helpVerified,
      evidenceScope: verified
        ? "reviewed_qwen_0.25.1_source"
        : "unverified_runtime",
      reason: verified
        ? "Reviewed Qwen 0.25.1 source preserves native base and appends launch instructions in ACP. Startup acceptance and model behavior are separate checks."
        : "This exact CLI has no reviewed system-append mechanism. Workbench instructions will be supplied as context; no Qwen flags are guessed for a fork.",
    };
    return Object.freeze(result);
  })();
  capabilityCache.set(cacheKey, pending);
  // This cache is process-local and bounded; no runtime/config/secret registry.
  if (capabilityCache.size > 32)
    capabilityCache.delete(capabilityCache.keys().next().value!);
  return pending;
}

/** CreateProcess limit includes executable, quoting and the terminating NUL. */
export function windowsCommandLineUnits(
  executable: string,
  args: readonly string[],
): number {
  const quote = (value: string): string => {
    // Same escaping needed by CommandLineToArgvW/node's native executable path.
    const escaped = value
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\+)$/g, "$1$1");
    return `"${escaped}"`;
  };
  return [executable, ...args].map(quote).join(" ").length + 1;
}

/**
 * Append is scoped to this process only. An existing base override is preserved
 * via explicit context fallback; duplicate appends are rejected, never stacked.
 */
export function planPromptBinding(input: {
  executable: string;
  args: string[];
  compiled: CompiledInstructions;
  capability: PromptCapabilityEvidence;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): PromptLaunchPlan {
  const { compiled, capability } = input;
  if (
    digest(compiled.text) !== compiled.contentHash ||
    compiled.manifest.compiledContentSha256 !== compiled.contentHash ||
    digest(JSON.stringify(compiled.manifest)) !== compiled.fingerprint
  )
    throw new Error("Instruction snapshot/hash mismatch.");
  if (!/^[a-f0-9]{64}$/.test(capability.runtimeFingerprint))
    throw new Error("Invalid runtime capability fingerprint.");
  if (
    !input.executable ||
    /[\0\r\n]/.test(input.executable) ||
    input.args.some((arg) => typeof arg !== "string" || /[\0\r\n]/.test(arg))
  )
    throw new Error("Invalid CLI launch arguments.");
  const argNames = input.args.map((arg) => arg.split("=", 1)[0]);
  if (
    argNames.some((arg) =>
      /^--append[-_]?system[-_]?prompt(?:[-_]?file)?$/i.test(arg),
    )
  )
    throw new Error(
      "CLI already has append-system-prompt; resolve the instruction owner instead of duplicating role instructions.",
    );
  let reason: string | undefined;
  if (capability.executablePath !== input.executable)
    reason =
      "Runtime evidence belongs to another CLI entrypoint. Workbench uses context until the selected runtime is inspected.";
  if (argNames.some((arg) => /^--system[-_]?prompt(?:[-_]?file)?$/i.test(arg)))
    reason =
      "Existing CLI system-prompt override is preserved. Workbench uses context until this composition is explicitly reviewed.";
  const activeOverride = Object.entries(input.env ?? process.env).some(
    ([key, value]) =>
      /^(?:QWEN|GIGACODE)_(?:SYSTEM_MD|WRITE_SYSTEM_MD)$/i.test(key) &&
      !!value?.trim() &&
      !/^(?:false|0)$/i.test(value.trim()),
  );
  if (activeOverride)
    reason =
      "Inherited CLI system-prompt/dump configuration is preserved. Workbench uses context rather than overwrite it or write instructions to an unexpected file.";
  if (/\.(?:cmd|bat)$/i.test(input.executable))
    reason =
      "Windows command wrapper cannot safely carry role instructions. Select its JavaScript/native entrypoint for system append; context delivery remains available.";
  if (input.args.includes("--"))
    reason =
      "CLI argument terminator prevents an appended option. Existing arguments are preserved and Workbench uses context.";
  if (capability.support !== "source_verified") reason ??= capability.reason;
  if (
    capability.support === "source_verified" &&
    (capability.family !== "qwen" ||
      capability.runtimeVersion !== "0.25.1" ||
      capability.evidenceScope !== "reviewed_qwen_0.25.1_source")
  )
    reason =
      "Inconsistent runtime evidence cannot enable a system append; Workbench uses context.";
  const args = [...input.args, "--append-system-prompt", compiled.text];
  const nativePrefix = /\.(?:c?js|mjs)$/i.test(input.executable)
    ? javascriptEntrypointArgs(input.executable)
    : [];
  if (
    (input.platform ?? process.platform) === "win32" &&
    windowsCommandLineUnits(
      nativePrefix.length ? process.execPath : input.executable,
      [...nativePrefix, ...args],
    ) > 30_000
  )
    reason =
      "Compiled instructions exceed the safe Windows command-line budget. Sources are preserved without truncation and supplied as context; no unsupported append-file mechanism is invented.";
  const delivery = reason ? "context_only" : "append_system";
  const receipt: PromptBindingReceipt = {
    schemaVersion: 1,
    delivery,
    state: "prepared",
    profileId: compiled.manifest.role.id,
    fingerprint: compiled.fingerprint,
    contentHash: compiled.contentHash,
    runtimeFingerprint: capability.runtimeFingerprint,
    runtimeVersion: capability.runtimeVersion,
    evidenceScope: capability.evidenceScope,
    reason: reason ?? capability.reason,
  };
  return {
    args: reason ? [...input.args] : args,
    receipt,
    ...(reason ? { contextInstructions: compiled.text } : {}),
  };
}
