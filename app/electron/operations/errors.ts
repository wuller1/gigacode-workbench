import type { OpsError, OpsErrorKind } from "../../shared/operations";
export class OpsFailure extends Error {
  readonly kind: OpsErrorKind;
  readonly outcome: OpsError["outcome"];
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(error: OpsError) {
    super(error.message);
    Object.assign(this, error);
    this.kind = error.kind;
    this.outcome = error.outcome;
  }
  toJSON(): OpsError {
    return {
      kind: this.kind,
      message: this.message,
      outcome: this.outcome,
      ...(this.status ? { status: this.status } : {}),
      ...(this.retryAfterMs !== undefined
        ? { retryAfterMs: this.retryAfterMs }
        : {}),
    };
  }
}
export function failure(
  kind: OpsErrorKind,
  message: string,
  outcome: OpsError["outcome"] = "notApplied",
  status?: number,
): OpsFailure {
  return new OpsFailure({
    kind,
    message: message.slice(0, 2000),
    outcome,
    ...(status ? { status } : {}),
  });
}
export function normalizeError(error: unknown, dispatched = false): OpsError {
  if (error instanceof OpsFailure) return error.toJSON();
  const e = error as any;
  const kind: OpsErrorKind =
    ["AbortError", "TimeoutError"].includes(e?.name) || e?.code === "ETIMEDOUT"
      ? "timeout"
      : "offline";
  return {
    kind,
    message:
      kind === "timeout"
        ? "Время ожидания Operations истекло. Проверьте исход перед повтором."
        : "Operations недоступен; проверьте подключение и его состояние.",
    outcome: dispatched ? "unknown" : "notApplied",
  };
}
export function redact(text: string, secret?: string): string {
  let result = text;
  if (secret)
    for (const value of [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
    ])
      if (value) result = result.split(value).join("[redacted]");
  return result.replace(
    /(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s<]+/gi,
    "$1[redacted]",
  );
}
