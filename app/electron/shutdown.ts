export type ShutdownResults = PromiseSettledResult<unknown>[];
export type ShutdownOutcome =
  { settled: true; results: ShutdownResults } | { settled: false };

const ownerLabels = [
  "agent runtime",
  "MCP",
  "terminal",
  "IDE",
  "Data",
  "Operations",
] as const;

/** Report explicit failures, never confuse settled with confirmed persistence.
 * No listed failure is not independent proof that every owner saved data.
 */
export function shutdownUnconfirmed(results: ShutdownResults): string[] {
  return results.flatMap((result, index) => {
    const label = ownerLabels[index] ?? `owner ${index + 1}`;
    if (result.status === "rejected") return [label];
    const value = result.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const receipt = value as Record<string, unknown>;
    if (
      index === 0 &&
      (receipt.persistence === "failed" || receipt.persistence === "pending")
    )
      return [label];
    if (
      index === 2 &&
      Array.isArray(receipt.unconfirmed) &&
      receipt.unconfirmed.length > 0
    )
      return [label];
    return [];
  });
}

/** Start every owned cleanup independently and observe every rejection now. */
export function startShutdown(
  actions: readonly (() => unknown | Promise<unknown>)[],
): Promise<ShutdownResults> {
  const pending = actions.map((action) => {
    try {
      return Promise.resolve(action());
    } catch (reason) {
      return Promise.reject(reason);
    }
  });
  return Promise.allSettled(pending);
}

/** A deadline only stops waiting; it does not cancel cleanup or prove exit. */
export function waitForShutdown(
  cleanup: Promise<ShutdownResults>,
  timeoutMs: number,
): Promise<ShutdownOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ settled: false }),
      Math.max(0, Number.isFinite(timeoutMs) ? timeoutMs : 0),
    );
    void cleanup.then(
      (results) => {
        clearTimeout(timer);
        resolve({ settled: true, results });
      },
      (reason) => {
        // Keep an unexpected aggregate rejection observed, including after the
        // deadline. Normal startShutdown results never take this branch.
        clearTimeout(timer);
        resolve({ settled: true, results: [{ status: "rejected", reason }] });
      },
    );
  });
}
