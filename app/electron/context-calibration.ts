import { randomBytes, createHash } from "node:crypto";
import type {
  ContextEvidence,
  ContextModelIdentity,
} from "../shared/context.js";
import { contextModelKey } from "./context-supervisor.js";

export interface ContextCalibrationProbe {
  id: string;
  input: string;
  inputBytes: number;
  /** Token counts require the actual route tokenizer/response; bytes are not tokens. */
  requestedInputBytes: number;
  maxOutputTokens: 512;
  oracle: Readonly<Record<string, string>>;
}
export interface ContextCalibrationReceipt {
  id: string;
  modelKey: string;
  inputBytes: number;
  promptTokens?: number;
  status: "recall_passed" | "recall_failed" | "unknown";
  chargedBudgetUsd: number;
  requestReference?: string;
  fullContextVerified: false;
}
export interface ContextCalibrationResult {
  modelKey: string;
  receipts: ContextCalibrationReceipt[];
  evidence: ContextEvidence[];
  reservedBudgetUsd: number;
  /** Single-position retrieval or successful HTTP acceptance is not a capacity test. */
  fullContextVerified: false;
}

export function createContextCalibrationProbe(
  inputBytes: number,
): ContextCalibrationProbe {
  if (
    !Number.isSafeInteger(inputBytes) ||
    inputBytes < 2048 ||
    inputBytes > 1024 * 1024
  )
    throw new Error("Calibration input must be between 2 KiB and 1 MiB.");
  const id = randomBytes(12).toString("hex");
  const oracle = Object.fromEntries(
    ["start", "quarter", "middle", "late", "end"].map((key) => [
      key,
      randomBytes(12).toString("hex"),
    ]),
  );
  const intro =
    "This is a bounded context-retrieval calibration. Read the five CALIBRATION_VALUE records in this document. Return ONLY a JSON object with their exact keys and values; do not infer missing values. Filler is irrelevant.\n";
  const footer =
    "\nReturn exactly the five named values as one JSON object; no explanation.";
  const records = Object.entries(oracle).map(
    ([key, value]) => `\nCALIBRATION_VALUE ${key}=${value}\n`,
  );
  const overhead = Buffer.byteLength(intro + footer + records.join(""));
  const fillerLength = inputBytes - overhead;
  if (fillerLength < 0)
    throw new Error("Calibration input budget is too small.");
  const fillerLine = "Ordinary neutral filler line without records.\n";
  const filler = fillerLine
    .repeat(Math.ceil(fillerLength / fillerLine.length))
    .slice(0, fillerLength);
  const positions = [0, 0.25, 0.5, 0.85, 1];
  let text = intro,
    offset = 0;
  for (let i = 0; i < positions.length; i++) {
    const end = Math.floor(filler.length * positions[i]);
    text += filler.slice(offset, end) + records[i];
    offset = end;
  }
  text += footer;
  return {
    id,
    input: text,
    inputBytes: Buffer.byteLength(text),
    requestedInputBytes: inputBytes,
    maxOutputTokens: 512,
    oracle,
  };
}

export function scoreContextCalibration(
  probe: ContextCalibrationProbe,
  output: unknown,
): boolean {
  if (typeof output !== "string" || output.length > 8192) return false;
  let result: unknown;
  try {
    result = JSON.parse(output);
  } catch {
    return false;
  }
  return Boolean(
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.keys(result).length === Object.keys(probe.oracle).length &&
    Object.entries(probe.oracle).every(
      ([key, value]) =>
        Object.hasOwn(result, key) &&
        (result as Record<string, unknown>)[key] === value,
    ),
  );
}

/**
 * Deliberately opt-in and sequential. The caller supplies an isolated no-tools
 * model transport, a real route-bound price ceiling and durable receipt storage.
 * A hung/error request is UNKNOWN; it is never repeated or followed by another probe.
 */
export async function runContextCalibration(options: {
  identity: ContextModelIdentity;
  explicitlyEnabled: boolean;
  maxBudgetUsd: number;
  inputBytes: readonly number[];
  timeoutMs?: number;
  signal?: AbortSignal;
  quoteCeilingUsd: (probe: ContextCalibrationProbe) => number;
  execute: (
    probe: ContextCalibrationProbe,
    signal: AbortSignal,
  ) => Promise<{
    output: string;
    promptTokens?: number;
    requestReference?: string;
  }>;
  persistReceipt: (receipt: ContextCalibrationReceipt) => Promise<void>;
}): Promise<ContextCalibrationResult> {
  if (options.explicitlyEnabled !== true)
    throw new Error(
      "Context calibration is disabled; explicit bounded paid-probe authorization is required.",
    );
  if (
    !Number.isFinite(options.maxBudgetUsd) ||
    options.maxBudgetUsd <= 0 ||
    options.maxBudgetUsd > 25 ||
    !Array.isArray(options.inputBytes) ||
    options.inputBytes.length < 1 ||
    options.inputBytes.length > 4 ||
    options.inputBytes.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 2048 || value > 1024 * 1024,
    )
  )
    throw new Error("Invalid context calibration budget.");
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    throw new Error("Invalid context calibration deadline.");
  const modelKey = contextModelKey(options.identity);
  const result: ContextCalibrationResult = {
    modelKey,
    receipts: [],
    evidence: [],
    reservedBudgetUsd: 0,
    fullContextVerified: false,
  };
  const probes = options.inputBytes.map((bytes) => {
    const probe = createContextCalibrationProbe(bytes);
    return { probe, price: options.quoteCeilingUsd(probe) };
  });
  if (
    probes.some(({ price }) => !Number.isFinite(price) || price < 0) ||
    probes.reduce((sum, { price }) => sum + price, 0) >
      options.maxBudgetUsd + 1e-10
  )
    throw new Error(
      "Context calibration price ceiling exceeds the authorized budget; no probe dispatched.",
    );
  for (const { probe, price } of probes) {
    options.signal?.throwIfAborted();
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      price > options.maxBudgetUsd - result.reservedBudgetUsd + 1e-10
    )
      throw new Error(
        "Context calibration price ceiling exceeds the remaining authorized budget.",
      );
    // Reserve before dispatch. No billing data or rejection allows increasing this budget.
    result.reservedBudgetUsd += price;
    const controller = new AbortController();
    const abort = () =>
      controller.abort(
        options.signal?.reason ?? new Error("Context calibration cancelled."),
      );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeDeadlineAbort = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      const onAbort = () =>
        reject(
          controller.signal.reason ?? new Error("Context calibration aborted."),
        );
      controller.signal.addEventListener("abort", onAbort, { once: true });
      removeDeadlineAbort = () =>
        controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) onAbort();
      timer = setTimeout(
        () =>
          controller.abort(new Error("Context calibration deadline exceeded.")),
        timeoutMs,
      );
    });
    const receipt: ContextCalibrationReceipt = {
      id: probe.id,
      modelKey,
      inputBytes: probe.inputBytes,
      status: "unknown",
      chargedBudgetUsd: price,
      fullContextVerified: false,
    };
    try {
      // Promise.race observes late rejection too; a cancelled transport may finish
      // remotely but cannot cause a second probe or claim a confirmed outcome.
      const response = await Promise.race([
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return options.execute(probe, controller.signal);
        }),
        deadline,
      ]);
      controller.signal.throwIfAborted();
      receipt.status = scoreContextCalibration(probe, response.output)
        ? "recall_passed"
        : "recall_failed";
      if (
        Number.isSafeInteger(response.promptTokens) &&
        response.promptTokens! > 0 &&
        response.promptTokens! <= 8 * 1024 * 1024
      )
        receipt.promptTokens = response.promptTokens;
      if (
        typeof response.requestReference === "string" &&
        /^[A-Za-z0-9._:-]{1,200}$/.test(response.requestReference)
      )
        receipt.requestReference = response.requestReference;
    } catch {
      receipt.status = "unknown";
    } finally {
      if (timer) clearTimeout(timer);
      removeDeadlineAbort();
      options.signal?.removeEventListener("abort", abort);
    }
    // Persist before any subsequent network call. A storage failure aborts the run.
    await options.persistReceipt(receipt);
    result.receipts.push(receipt);
    if (receipt.promptTokens !== undefined && receipt.status !== "unknown") {
      const reference = `calibration:${createHash("sha256")
        .update(modelKey + ":" + receipt.id)
        .digest("hex")}`;
      result.evidence.push({
        modelKey,
        kind: "accepted_request",
        tokens: receipt.promptTokens,
        at: Date.now(),
        reference,
      });
      if (receipt.status === "recall_passed")
        result.evidence.push({
          modelKey,
          kind: "verified_recall",
          tokens: receipt.promptTokens,
          at: Date.now(),
          reference,
        });
    }
    if (receipt.status !== "recall_passed") break;
  }
  return result;
}
