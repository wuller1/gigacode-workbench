import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpsService } from "../electron/operations/service";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const directories: string[] = [];
const services: OpsService[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.dispose();
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ops-retire-"));
  directories.push(directory);
  const options = {
    dataDir: directory,
    node: process.execPath,
    provider: "unused-provider",
    vault: {
      available: () => true,
      encrypt: (s: string) => Buffer.from(s),
      decrypt: (b: Buffer) => b.toString(),
    },
    project: (id: string) => (id === "p" ? { id: "p" } : undefined),
    changed: () => undefined,
  };
  const service = new OpsService(options);
  services.push(service);
  await service.init();
  await (service as any).store.update((state: any) => {
    state.connections.push({
      id: "c",
      revision: 1,
      kind: "jenkins",
      name: "Local fixture",
      environment: "test",
      enabled: true,
      projectIds: ["p"],
      transport: "builtin",
      credentialConfigured: false,
      targetHash: "target",
      authGeneration: 1,
    });
    state.prepared.push({
      id: "a",
      operationId: "operation-1",
      projectId: "p",
      connectionId: "c",
      operation: "ci.trigger",
      input: { job: "Build" },
      targetHash: "target",
      authGeneration: 1,
      schemaHash: "schema",
      summary: "Accepted fixture trigger",
      preview: {},
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  });
  return { service, options, internals: service as any };
}
function bindClient(x: Awaited<ReturnType<typeof fixture>>, client: any) {
  x.internals.clients.set("c", Promise.resolve(client));
  vi.spyOn(x.internals, "inventory").mockResolvedValue({
    client,
    inventory: { schemaHash: "schema" },
  });
}

describe("Operations resource retirement without mutation replay", () => {
  it("starts existing client retirement before a stalled disk write and returns one disposal promise", async () => {
    const x = await fixture();
    const stalled = deferred();
    const close = vi.fn(async () => undefined);
    x.internals.clients.set("c", Promise.resolve({ close }));
    vi.spyOn(x.internals, "update").mockImplementation(() => stalled.promise);
    const disposal = x.service.dispose();
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(close).toHaveBeenCalledTimes(1);
      expect(x.service.dispose()).toBe(disposal);
    } finally {
      stalled.resolve();
      await disposal;
    }
  });

  it("does not dispatch a prepared mutation if shutdown happens while its committed receipt return is stalled", async () => {
    const x = await fixture();
    const entered = deferred(),
      release = deferred();
    const client = {
      close: vi.fn(async () => undefined),
      call: vi.fn(async () => ({
        status: "confirmed",
        remoteId: "unexpected",
      })),
    };
    bindClient(x, client);
    const update = x.internals.update.bind(x.service);
    let held = false;
    vi.spyOn(x.internals, "update").mockImplementation(async (fn: any) => {
      const result = await update(fn);
      if (
        !held &&
        x.internals.store
          .read()
          .receipts.some((r: any) => r.status === "dispatching")
      ) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return result;
    });
    const execution = x.service.invoke("ops.execute", {
      projectId: "p",
      preparedActionId: "a",
    });
    await entered.promise;
    const disposal = x.service.dispose();
    release.resolve();
    const receipt = await execution;
    await disposal;
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.call).not.toHaveBeenCalled();
    expect(receipt.status).toBe("failed");
    expect(receipt.error.outcome).toBe("notApplied");
    expect(x.service.snapshot("p").receipts[0].error?.outcome).toBe(
      "notApplied",
    );
  });

  it("keeps an already dispatched mutation unknown through shutdown and restart instead of replaying it", async () => {
    const x = await fixture();
    const entered = deferred(),
      remote = deferred<any>();
    const client = {
      call: vi.fn(() => {
        entered.resolve();
        return remote.promise;
      }),
      close: vi.fn(async () => {
        remote.reject(new Error("Transport retired after dispatch"));
      }),
    };
    bindClient(x, client);
    const execution = x.service.invoke("ops.execute", {
      projectId: "p",
      preparedActionId: "a",
    });
    await entered.promise;
    const disposal = x.service.dispose();
    const receipt = await execution;
    await disposal;
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(receipt.status).toBe("unknown");
    expect(receipt.error.outcome).toBe("unknown");
    const restarted = new OpsService(x.options);
    services.push(restarted);
    await restarted.init();
    const freshCall = vi.fn();
    vi.spyOn(restarted as any, "inventory").mockResolvedValue({
      client: { call: freshCall },
      inventory: { schemaHash: "schema" },
    });
    const retained = await restarted.invoke("ops.execute", {
      projectId: "p",
      preparedActionId: "a",
    });
    expect(retained.id).toBe(receipt.id);
    expect(retained.status).toBe("unknown");
    expect(freshCall).not.toHaveBeenCalled();
  });
});
