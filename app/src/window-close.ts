/** Renderer-owned persistence barriers; no timeout silently discards a failed save. */
const handlers = new Map<string, () => Promise<void>>();
export function registerWindowClose(id: string, handler: () => Promise<void>) {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}
export async function prepareWindowClose() {
  const results = await Promise.allSettled(
    [...handlers.values()].map((handler) => handler()),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
