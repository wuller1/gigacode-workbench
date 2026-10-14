import { describe, expect, it } from "vitest";
import { managedExecutorArgs } from "../electron/managed-runtime-policy";
import type { PromptCapabilityEvidence } from "../electron/prompt-binding";
const reviewed: PromptCapabilityEvidence = {
  executablePath: "/reviewed/cli.js",
  runtimeFingerprint: "a".repeat(64),
  runtimeVersion: "0.25.1",
  family: "qwen",
  support: "source_verified",
  supportsToollessRouter: true,
  helpVerified: true,
  evidenceScope: "reviewed_qwen_0.25.1_source",
  reason: "Exact source and help verified",
};
describe("managed executor native worker policy", () => {
  it("excludes native hidden Agent/CreateSubSession only in the reviewed executor args, preserving caller flags", () => {
    const input = Object.freeze(["--acp", "--exclude-tools=run_shell_command"]);
    const output = managedExecutorArgs(input, reviewed);
    expect(output).toEqual([
      "--exclude-tools=agent",
      "--exclude-tools=create_sub_session",
      ...input,
    ]);
    expect(input).toEqual(["--acp", "--exclude-tools=run_shell_command"]);
    expect(managedExecutorArgs(output, reviewed)).toEqual(output);
  });
  it.each([
    { family: "unknown" },
    { support: "unknown" },
    { runtimeVersion: "26.10.6" },
    { runtimeVersion: "0.25.2" },
    { helpVerified: false },
    { evidenceScope: "unverified_runtime" },
  ])(
    "unknown or incomplete evidence does not guess a fork's flags: %j",
    (patch) => {
      const args = ["--acp"];
      expect(
        managedExecutorArgs(args, {
          ...reviewed,
          ...patch,
        } as PromptCapabilityEvidence),
      ).toEqual(args);
    },
  );
  it("places flags before positional separator instead of silently passing prompt text", () => {
    expect(
      managedExecutorArgs(["--acp", "--", "literal user text"], reviewed).slice(
        0,
        2,
      ),
    ).toEqual(["--exclude-tools=agent", "--exclude-tools=create_sub_session"]);
  });
  it("rejects invalid argument/fingerprint input and never invents depth zero", () => {
    expect(() =>
      managedExecutorArgs(["--acp", "line\nbreak"], reviewed),
    ).toThrow("Invalid");
    expect(() =>
      managedExecutorArgs(["--acp"], {
        ...reviewed,
        runtimeFingerprint: "unbound",
      }),
    ).toThrow("fingerprint");
    expect(managedExecutorArgs(["--acp"], reviewed).join(" ")).not.toContain(
      "max-subagent-depth",
    );
  });
});
