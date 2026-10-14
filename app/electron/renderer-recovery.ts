/** Per-window crash budget survives renderer reloads; it never restarts a task. */
export class RendererRecoveryBudget {
  private failures = new Map<number, number[]>();
  constructor(
    private limit = 3,
    private intervalMs = 60000,
  ) {}
  claim(
    windowId: number,
    at = Date.now(),
  ): { allowed: boolean; attempt: number } {
    const previous = this.failures.get(windowId) || [];
    const recent =
      previous.at(-1)! > at
        ? []
        : previous.filter((time) => time > at - this.intervalMs);
    if (recent.length >= this.limit) {
      this.failures.set(windowId, recent);
      return { allowed: false, attempt: recent.length };
    }
    recent.push(at);
    this.failures.set(windowId, recent);
    return { allowed: true, attempt: recent.length };
  }
  forget(windowId: number): void {
    this.failures.delete(windowId);
  }
}
