import type { PromptCapabilityEvidence } from "./prompt-binding.js";

/** Native hidden workers cannot be lifecycle-owned through the host ACP process.
 * Exact reviewed Qwen supports whole-tool excludes without modifying the CLI.
 * Unknown forks retain their arguments and require a workplace adapter/probe.
 */
export const MANAGED_NATIVE_TOOL_EXCLUDES = Object.freeze([
  "agent",
  "create_sub_session",
] as const);
export function managedExecutorArgs(
  args: readonly string[],
  capability: PromptCapabilityEvidence,
): string[] {
  if (
    !Array.isArray(args) ||
    args.length > 256 ||
    args.some((value) => typeof value !== "string" || /[\r\n\0]/.test(value))
  )
    throw new Error("Invalid managed executor arguments.");
  if (
    capability.family !== "qwen" ||
    capability.support !== "source_verified" ||
    capability.runtimeVersion !== "0.25.1" ||
    capability.evidenceScope !== "reviewed_qwen_0.25.1_source" ||
    !capability.helpVerified
  )
    return [...args];
  if (!/^[a-f0-9]{64}$/.test(capability.runtimeFingerprint))
    throw new Error("Invalid reviewed managed runtime fingerprint.");
  // Prefix before a possible '--': never turn a policy flag into prompt text.
  // Yargs array options accumulate; preserve user excludes and never mutate argv.
  const flags = MANAGED_NATIVE_TOOL_EXCLUDES.map(
    (name) => `--exclude-tools=${name}`,
  ).filter((flag) => !args.includes(flag));
  return [...flags, ...args];
}
