import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileInstructions,
  discoverPromptCapability,
  planPromptBinding,
  windowsCommandLineUnits,
  type PromptCapabilityEvidence,
} from "../electron/prompt-binding";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(execFile).mockReset();
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function temp() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "workbench-instructions-"),
  );
  temporary.push(directory);
  return directory;
}
async function freezeStatMetadata(files: string[]) {
  const stat = fs.stat.bind(fs);
  const open = fs.open.bind(fs);
  const snapshots = new Map(
    await Promise.all(
      files.map(async (file) => [file, await stat(file)] as const),
    ),
  );
  vi.spyOn(fs, "stat").mockImplementation(
    (async (file: Parameters<typeof fs.stat>[0]) =>
      snapshots.get(String(file)) ?? stat(file)) as typeof fs.stat,
  );
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    const snapshot = snapshots.get(String(args[0]));
    if (snapshot) vi.spyOn(handle, "stat").mockResolvedValue(snapshot);
    return handle;
  });
  return snapshots;
}
const core =
  "Check current sources. Preserve user changes. Report actual evidence.";
const reviewed: PromptCapabilityEvidence = {
  executablePath: "/runtime/cli.js",
  runtimeFingerprint: "a".repeat(64),
  runtimeVersion: "0.25.1",
  family: "qwen",
  support: "source_verified",
  supportsToollessRouter: true,
  helpVerified: true,
  evidenceScope: "reviewed_qwen_0.25.1_source",
  reason: "Reviewed source; no provider-message or model-obedience claim.",
};
const compiled = () =>
  compileInstructions({
    core,
    role: "Implement accepted server contracts.",
    profileId: "backend",
  });
const launch = (patch: Partial<Parameters<typeof planPromptBinding>[0]> = {}) =>
  planPromptBinding({
    executable: "/runtime/cli.js",
    args: ["--acp"],
    compiled: compiled(),
    capability: reviewed,
    env: {},
    platform: "linux",
    ...patch,
  });

describe("instruction compiler", () => {
  it("builds one deterministic immutable core+role snapshot and normalizes only declared whitespace", () => {
    const a = compileInstructions({
      core: " \r\nFacts\r\nnext\r ",
      role: "Role\r\n",
      profileId: "analyst",
    });
    const b = compileInstructions({
      core: "Facts\nnext",
      role: "Role",
      profileId: "analyst",
    });
    expect(a).toEqual(b);
    expect(a.text).toBe(
      "# Workbench common instructions\n\nFacts\nnext\n\n# Workbench role: analyst\n\nRole",
    );
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.manifest.role)).toBe(true);
    expect(a.manifest.normalization).toContain("CRLF/CR to LF");
  });
  it("captures source versions and changes identity for role, content and explicit version changes", () => {
    const base = compiled();
    const variants = [
      compileInstructions({
        core,
        role: "Implement accepted server contracts.",
        profileId: "frontend",
      }),
      compileInstructions({
        core: `${core} More evidence.`,
        role: "Implement accepted server contracts.",
        profileId: "backend",
      }),
      compileInstructions({
        core,
        role: "Implement accepted server contracts.",
        profileId: "backend",
        roleVersion: "v2",
      }),
    ];
    expect(
      new Set([base, ...variants].map((entry) => entry.fingerprint)).size,
    ).toBe(4);
    expect(variants[2].contentHash).toBe(base.contentHash);
    expect(variants[2].manifest.role.version).toBe("v2");
  });
  it.each(["", " ", "bad\0data", "broken\ud800", "x".repeat(65_537)])(
    "rejects empty/invalid/oversized common input %j",
    (value) => {
      expect(() =>
        compileInstructions({
          core: value,
          role: "Valid role",
          profileId: "qa",
        }),
      ).toThrow();
    },
  );
  it("rejects multiple or missing role identities rather than silently choosing a profile", () => {
    for (const profileId of [
      "backend,reviewer",
      "",
      "../analyst",
      "analyst\nreviewer",
    ])
      expect(() =>
        compileInstructions({ core, role: "role", profileId }),
      ).toThrow("identity");
    expect(() =>
      compileInstructions({ core, role: "", profileId: "qa" }),
    ).toThrow("empty");
    expect(() =>
      compileInstructions({
        core,
        role: "role",
        profileId: "qa",
        coreVersion: "v1\nv2",
      }),
    ).toThrow("version");
  });
});

describe("process-scoped prompt launch", () => {
  it("adds exactly one native append without replacing the CLI base or mutating input/env", () => {
    const args = ["--acp"],
      env = { PATH: "safe", OPENAI_API_KEY: "never-in-instructions" };
    const prior = { ...env };
    const plan = launch({ args, env });
    expect(plan.args).toEqual([
      "--acp",
      "--append-system-prompt",
      compiled().text,
    ]);
    expect(plan.args).not.toContain("--system-prompt");
    expect(plan.contextInstructions).toBeUndefined();
    expect(plan.receipt).toMatchObject({
      delivery: "append_system",
      state: "prepared",
      profileId: "backend",
    });
    expect(JSON.stringify(plan.receipt)).not.toContain("never-in-instructions");
    expect(args).toEqual(["--acp"]);
    expect(env).toEqual(prior);
  });
  it("keeps two role launches isolated, including identical shared core", () => {
    const a = launch();
    const b = launch({
      compiled: compileInstructions({
        core,
        role: "Independently review actual changes.",
        profileId: "reviewer",
      }),
    });
    expect(a.args.at(-1)).not.toContain("Independently review");
    expect(b.args.at(-1)).not.toContain("Implement accepted server");
    expect(a.receipt.fingerprint).not.toBe(b.receipt.fingerprint);
    expect(
      a.args.filter((arg) => arg === "--append-system-prompt"),
    ).toHaveLength(1);
  });
  it("does not reuse evidence for a different executable or a mismatched runtime family", () => {
    expect(
      launch({ executable: "/another/gigacode.js" }).receipt,
    ).toMatchObject({ delivery: "context_only" });
    expect(
      launch({ capability: { ...reviewed, family: "unknown" } }).receipt,
    ).toMatchObject({ delivery: "context_only" });
  });
  it("honestly uses context for an unknown fork, preserving all native launch arguments", () => {
    const unknown: PromptCapabilityEvidence = {
      ...reviewed,
      family: "unknown",
      support: "unknown",
      supportsToollessRouter: false,
      evidenceScope: "unverified_runtime",
      reason: "GigaCode26.9.75 needs its own ACP probe.",
    };
    const plan = launch({ capability: unknown });
    expect(plan.args).toEqual(["--acp"]);
    expect(plan.contextInstructions).toBe(compiled().text);
    expect(plan.receipt).toMatchObject({
      delivery: "context_only",
      reason: unknown.reason,
    });
  });
  it.each([
    "--append-system-prompt",
    "--append-system-prompt=existing",
    "--appendSystemPrompt",
    "--append-system-prompt-file",
  ])("rejects competing append ownership %s", (flag) => {
    expect(() => launch({ args: ["--acp", flag, "existing"] })).toThrow(
      "already has",
    );
  });
  it.each([
    "--system-prompt",
    "--system-prompt=existing",
    "--systemPrompt",
    "--system-prompt-file",
  ])(
    "preserves a deliberate native base override %s via explicit fallback",
    (flag) => {
      const plan = launch({ args: ["--acp", flag, "existing"] });
      expect(plan.receipt.delivery).toBe("context_only");
      expect(plan.args).toEqual(["--acp", flag, "existing"]);
      expect(plan.receipt.reason).toContain("preserved");
    },
  );
  it.each([
    "QWEN_SYSTEM_MD",
    "GIGACODE_SYSTEM_MD",
    "QWEN_WRITE_SYSTEM_MD",
    "gigacode_write_system_md",
  ])("never overwrites inherited %s or writes a prompt dump", (key) => {
    const env = { [key]: "/private/user-owned-system.md" };
    const plan = launch({ env });
    expect(plan.receipt.delivery).toBe("context_only");
    expect(plan.receipt.reason).not.toContain("/private");
    expect(env[key]).toBe("/private/user-owned-system.md");
    expect(launch({ env: { [key]: "FALSE" } }).receipt.delivery).toBe(
      "append_system",
    );
  });
  it("avoids cmd.exe quoting/8191 limits and an argument terminator", () => {
    expect(
      launch({ executable: "C:\\runtime\\gigacode.cmd", platform: "win32" })
        .receipt,
    ).toMatchObject({ delivery: "context_only" });
    expect(launch({ args: ["--acp", "--"] }).receipt).toMatchObject({
      delivery: "context_only",
    });
  });
  it("retains all source bytes when Windows launch would exceed its UTF-16 command-line budget", () => {
    const large = compileInstructions({
      core: "x".repeat(28_000),
      role: "y".repeat(5_000),
      profileId: "backend",
    });
    const plan = launch({ compiled: large, platform: "win32" });
    expect(plan.receipt.delivery).toBe("context_only");
    expect(plan.receipt.reason).toContain("Windows");
    expect(plan.contextInstructions).toBe(large.text);
    expect(
      launch({ compiled: large, platform: "linux" }).receipt.delivery,
    ).toBe("append_system");
    expect(
      windowsCommandLineUnits("a.exe", ['a"b', "ends\\", "😀"]),
    ).toBeGreaterThan('a.exe a"b ends\\ 😀'.length);
  });
  it("rejects a modified snapshot and invalid launch instead of forging a receipt", () => {
    expect(() =>
      launch({ compiled: { ...compiled(), text: "changed after compile" } }),
    ).toThrow("mismatch");
    expect(() => launch({ args: ["--acp", "line\nbreak"] })).toThrow(
      "Invalid CLI",
    );
    expect(() =>
      launch({ capability: { ...reviewed, runtimeFingerprint: "unbound" } }),
    ).toThrow("fingerprint");
  });
});

describe("runtime capability evidence", () => {
  it("invalidates unknown CLI evidence when content changes with identical stat metadata", async () => {
    const directory = await temp(),
      executable = path.join(directory, "gigacode.exe");
    await fs.writeFile(executable, "GigaCode26.10.6:first");
    const metadata = await freezeStatMetadata([executable]);
    const a = await discoverPromptCapability({ executable });
    expect(await discoverPromptCapability({ executable })).toBe(a);
    await fs.writeFile(executable, "GigaCode26.10.6:other");
    expect(await fs.stat(executable)).toBe(metadata.get(executable));
    const b = await discoverPromptCapability({ executable });
    expect(b.runtimeFingerprint).not.toBe(a.runtimeFingerprint);
    expect(b.support).toBe("unknown");
    expect(execFile).not.toHaveBeenCalled();
  });
  it("revokes reviewed Qwen evidence after an anchor rewrite despite identical metadata, caching help only for unchanged content", async () => {
    const directory = await temp();
    const installed = fileURLToPath(
      new URL("../node_modules/@qwen-code/qwen-code/", import.meta.url),
    );
    const names = [
      "package.json",
      "cli-entry.js",
      "cli.js",
      "chunks/chunk-A5MAHML6.js",
      "chunks/chunk-HO724RA7.js",
      "chunks/acpAgent-FSCEU2SB.js",
      "chunks/chunk-WCM7H5HK.js",
      "chunks/chunk-DMQ2VTH6.js",
      "chunks/chunk-BFTRLQJP.js",
      "chunks/chunk-GT4TCQ3R.js",
      "chunks/chunk-ZZZAYAJW.js",
    ];
    await fs.mkdir(path.join(directory, "chunks"));
    await Promise.all(
      names.map((name) =>
        fs.copyFile(path.join(installed, name), path.join(directory, name)),
      ),
    );
    const executable = path.join(directory, "cli.js"),
      anchor = path.join(directory, "chunks/chunk-A5MAHML6.js");
    const metadata = await freezeStatMetadata(
      names.map((name) => path.join(directory, name)),
    );
    vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: null,
        stdout: string,
        stderr: string,
      ) => void;
      queueMicrotask(() =>
        callback(
          null,
          "--append-system-prompt --safe-mode --max-tool-calls --max-session-turns --max-wall-time --output-format",
          "",
        ),
      );
      return {};
    }) as typeof execFile);
    const a = await discoverPromptCapability({ executable });
    expect(a.support).toBe("source_verified");
    expect(a.helpVerified).toBe(true);
    expect(await discoverPromptCapability({ executable })).toBe(a);
    expect(execFile).toHaveBeenCalledTimes(1);
    const changed = await fs.readFile(anchor);
    changed[0] ^= 1;
    await fs.writeFile(anchor, changed);
    expect(await fs.stat(anchor)).toBe(metadata.get(anchor));
    const b = await discoverPromptCapability({ executable });
    expect(b.runtimeFingerprint).not.toBe(a.runtimeFingerprint);
    expect(b).toMatchObject({
      family: "qwen",
      support: "unknown",
      supportsToollessRouter: false,
      helpVerified: false,
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it("does not trust a fork name, a package claim or --append text in a fake executable", async () => {
    const directory = await temp();
    const executable = path.join(directory, "cli.js");
    await fs.writeFile(
      executable,
      "throw new Error('Never execute an unknown CLI during capability discovery'); // --append-system-prompt",
    );
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "@qwen-code/qwen-code", version: "0.25.1" }),
    );
    const a = await discoverPromptCapability({ executable });
    expect(a).toMatchObject({
      support: "unknown",
      supportsToollessRouter: false,
      helpVerified: false,
    });
    await fs.writeFile(executable, "changed fake CLI");
    const b = await discoverPromptCapability({ executable });
    expect(b.runtimeFingerprint).not.toBe(a.runtimeFingerprint);
  });
  it("recognizes exact installed Qwen source plus real --help without sending a model prompt", async () => {
    const executable = fileURLToPath(
      new URL("../node_modules/@qwen-code/qwen-code/cli.js", import.meta.url),
    );
    const a = await discoverPromptCapability({ executable });
    const b = await discoverPromptCapability({ executable });
    expect(a).toMatchObject({
      family: "qwen",
      runtimeVersion: "0.25.1",
      support: "source_verified",
      supportsToollessRouter: true,
      helpVerified: true,
    });
    expect(a).toBe(b);
    expect(a.reason).toContain("separate checks");
  });
  it("rejects unscoped PATH lookup and observes a changed unknown executable", async () => {
    await expect(
      discoverPromptCapability({ executable: "qwen" }),
    ).rejects.toThrow("absolute");
    const directory = await temp(),
      executable = path.join(directory, "gigacode.exe");
    await fs.writeFile(executable, "GigaCode26.9.75");
    const a = await discoverPromptCapability({ executable });
    expect(a.family).toBe("unknown");
    expect(a.supportsToollessRouter).toBe(false);
    await fs.writeFile(executable, "GigaCode26.9.76");
    const b = await discoverPromptCapability({ executable });
    expect(b.runtimeFingerprint).not.toBe(a.runtimeFingerprint);
  });
});
