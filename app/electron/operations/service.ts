import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AtomicStore } from "../store";
import type {
  OpsConnection,
  OpsInventory,
  OpsPreparedAction,
  OpsReceipt,
  OpsSnapshot,
  OpsValue,
} from "../../shared/operations";
import {
  opsReadOperations,
  opsActionOperations,
} from "../../shared/operations";
import { OpsMcpClient } from "./client";
import { checkedUrl } from "./http";
import { failure, OpsFailure, normalizeError, redact } from "./errors";
import { isAction, validateEnvelope } from "./protocol";
type OpsState = {
  version: 1;
  connections: OpsConnection[];
  secrets: Record<string, string>;
  prepared: OpsPreparedAction[];
  receipts: OpsReceipt[];
  favorites: { connectionId: string; jobId: string }[];
};
type Options = {
  dataDir: string;
  node: string;
  provider: string;
  vault: {
    available: () => boolean;
    encrypt: (v: string) => Buffer;
    decrypt: (v: Buffer) => string;
  };
  changed: (projectId?: string) => void;
  project: (id: string) => unknown;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (r: OpsReceipt) =>
  ["confirmed", "failed", "cancelled"].includes(r.status);
const targetHash = (c: Partial<OpsConnection>) =>
  hash({
    kind: c.kind,
    transport: c.transport,
    url: c.url,
    username: c.username,
    command: c.command,
    args: c.args || [],
    secretHeader: c.secretHeader,
    secretPrefix: c.secretPrefix,
    secretEnv: c.secretEnv,
    ca: c.ca,
    bindings: c.bindings || {},
  });
function effectKey(operation: string, input: Record<string, any>) {
  if (operation === "ci.trigger")
    return "ci.trigger:" + (input.jobId || input.fullName);
  if (operation === "ci.stop")
    return "ci.stop:" + (input.jobId || input.fullName) + ":" + input.number;
  if (operation === "ci.queueCancel") return "ci.queueCancel:" + input.queueId;
  return [
    "cluster",
    input.group || "",
    input.version || "v1",
    input.resource,
    input.namespace || "",
    input.name,
  ].join(":");
}
const identity = (input: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(input)
      .filter(([k]) =>
        [
          "jobId",
          "queueId",
          "number",
          "group",
          "version",
          "resource",
          "namespace",
          "name",
          "uid",
          "resourceVersion",
          "replicas",
          "restartedAt",
        ].includes(k),
      )
      .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 2000) : v]),
  );
function summaryData(value: any): any {
  if (!value || typeof value !== "object") return value;
  const fields = [
    "jobId",
    "queueId",
    "number",
    "building",
    "result",
    "timestamp",
    "duration",
    "reason",
    "deleted",
    "cancelled",
    "blocked",
    "why",
    "uid",
    "resourceVersion",
  ];
  return {
    ...Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            fields.includes(k) &&
            (v === null || ["boolean", "string", "number"].includes(typeof v)),
        )
        .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 4000) : v]),
    ),
    ...(value.metadata ? { metadata: identity(value.metadata) } : {}),
  };
}
function safeInput(raw: unknown): Record<string, any> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Buffer.byteLength(JSON.stringify(raw)) > 2 * 1024 ** 2
  )
    throw failure("validation", "Нужен объект input до2MiB.");
  const visit = (v: any, depth = 0) => {
    if (depth > 40)
      throw failure("validation", "Operations input слишком глубоко вложен.");
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (
          /^(password|token|access_token|refresh_token|authorization|client-key-data|clientKey|secret)$/i.test(
            k,
          )
        )
          throw failure(
            "unsupported",
            "Секретные action parameters не сохраняются в журнале. Нужен защищённый adapter/secretRef.",
          );
        visit(x, depth + 1);
      }
  };
  visit(raw);
  return structuredClone(raw);
}
function output(value: any, secret?: string): any {
  if (
    value?.kind === "Secret" &&
    value.metadata &&
    typeof value.metadata === "object"
  )
    return {
      apiVersion: value.apiVersion,
      kind: "Secret",
      metadata: output(
        {
          name: value.metadata.name,
          namespace: value.metadata.namespace,
          uid: value.metadata.uid,
          resourceVersion: value.metadata.resourceVersion,
          creationTimestamp: value.metadata.creationTimestamp,
        },
        secret,
      ),
      workbenchMetadataOnly: true,
    };
  if (Array.isArray(value)) return value.map((v) => output(v, secret));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(password|token|access_token|refresh_token|authorization|client-key-data)$/i.test(
          k,
        )
          ? "[redacted]"
          : output(v, secret),
      ]),
    );
  return typeof value === "string" ? redact(value, secret) : value;
}
function secretResult(value: any, input: Record<string, any>, secret?: string) {
  if (input.resource !== "secrets") return output(value, secret);
  const clean = (v: any) => output({ ...v, kind: "Secret" }, secret);
  if (Array.isArray(value.data?.items))
    return {
      ...value,
      data: { ...value.data, items: value.data.items.map(clean) },
    };
  if (Array.isArray(value.data?.events))
    return {
      ...value,
      data: {
        ...value.data,
        events: value.data.events.map((e: any) => ({
          ...e,
          object: clean(e.object),
        })),
      },
    };
  return { ...value, data: clean(value.data) };
}
export class OpsService {
  private store: AtomicStore<OpsState>;
  private clients = new Map<string, Promise<OpsMcpClient>>();
  private serial = new Map<string, Promise<any>>();
  private dispatches = new Map<string, Promise<any>>();
  private reads = new Map<string, number>();
  private monitor?: ReturnType<typeof setTimeout>;
  private monitoring = false;
  private monitorOffset = 0;
  private monitorDelay = new Map<string, { until: number; failures: number }>();
  private reconciling = new Map<string, Promise<OpsReceipt>>();
  private closing = false;
  constructor(private options: Options) {
    this.store = new AtomicStore(
      path.join(options.dataDir, "operations"),
      () => ({
        version: 1,
        connections: [],
        secrets: {},
        prepared: [],
        receipts: [],
        favorites: [],
      }),
      (v): v is OpsState =>
        !!v &&
        (v as any).version === 1 &&
        ["connections", "prepared", "receipts", "favorites"].every((k) =>
          Array.isArray((v as any)[k]),
        ) &&
        typeof (v as any).secrets === "object",
    );
  }
  async init() {
    await this.store.init();
    await this.update((s) => {
      for (const r of s.receipts)
        if (r.status === "dispatching") {
          r.status = "unknown";
          r.updatedAt = new Date().toISOString();
          r.error = {
            kind: "unknown",
            message:
              "Приложение перезапущено до подтверждения. Только read-only reconciliation; запрос не повторён.",
            outcome: "unknown",
          };
        }
    });
    this.scheduleMonitor();
  }
  snapshot(projectId?: string): OpsSnapshot {
    if (projectId && !this.options.project(projectId))
      throw failure("validation", "Проект не найден.");
    const s = this.store.read(),
      connections = s.connections.filter(
        (c) => !projectId || c.projectIds.includes(projectId),
      ),
      ids = new Set(connections.map((c) => c.id));
    const own = s.receipts.filter(
        (r) =>
          ids.has(r.connectionId) && (!projectId || r.projectId === projectId),
      ),
      unresolved = own.filter((r) => !terminal(r)),
      done = own.filter(terminal),
      receipts = [...unresolved, ...done.slice(-100)];
    return {
      connections: connections.map((c) => ({
        ...c,
        discovered: c.discovered ? { ...c.discovered, tools: [] } : undefined,
      })),
      prepared: s.prepared
        .filter(
          (p) =>
            ids.has(p.connectionId) &&
            (!projectId || p.projectId === projectId),
        )
        .slice(-100)
        .map((p) => ({
          ...p,
          input: identity(p.input),
          preview: { omitted: true, summary: p.summary },
        })),
      receipts: receipts.map((r) => ({
        ...r,
        input: identity(r.input),
        data: summaryData(r.data),
      })),
      favorites: s.favorites.filter((f) => ids.has(f.connectionId)),
      receiptCounts: {
        unresolved: unresolved.length,
        terminal: done.length,
        shown: receipts.length,
        hasMoreTerminal: done.length > 100,
      },
    };
  }
  private secret(id: string) {
    const value = this.store.read().secrets[id];
    return value
      ? this.options.vault.decrypt(Buffer.from(value, "base64"))
      : undefined;
  }
  private update<T>(change: (draft: OpsState) => T): Promise<T> {
    return this.store.update((s) => {
      const result = change(s);
      if (Buffer.byteLength(JSON.stringify(s)) > 32 * 1024 ** 2)
        throw failure(
          "payload_too_large",
          "Хранилище Operations достигло32MiB. Сначала разберите завершённые операции.",
        );
      return result;
    });
  }
  private connection(id: string, projectId?: string) {
    const c = this.store.read().connections.find((c) => c.id === id);
    if (!c) throw failure("not_found", "Operations connection не найден.");
    if (projectId && !c.projectIds.includes(projectId))
      throw failure(
        "forbidden",
        "Operations connection не привязан к этому проекту.",
      );
    return c;
  }
  private project(id: unknown): string {
    if (typeof id !== "string" || !this.options.project(id))
      throw failure("validation", "Нужен существующий projectId.");
    return id;
  }
  private expectedTarget(c: OpsConnection, p: Record<string, any>) {
    if (
      typeof p.expectedTargetHash !== "string" ||
      !Number.isSafeInteger(p.expectedAuthGeneration)
    )
      throw failure(
        "validation",
        "Сначала прочитайте ops.snapshot; передайте expectedTargetHash и expectedAuthGeneration выбранного подключения.",
      );
    if (
      c.targetHash !== p.expectedTargetHash ||
      c.authGeneration !== p.expectedAuthGeneration
    )
      throw failure(
        "conflict",
        "Выбранное подключение изменилось в другом окне. Обновите snapshot; запрос не отправлен.",
      );
  }
  private assertKnownEffect(
    connectionId: string,
    operation: string,
    input: Record<string, any>,
    operationId?: string,
  ) {
    const blocked = this.store
      .read()
      .receipts.find(
        (r) =>
          r.connectionId === connectionId &&
          r.status === "unknown" &&
          r.operationId !== operationId &&
          effectKey(r.operation, r.input) === effectKey(operation, input),
      );
    if (blocked)
      throw failure(
        "conflict",
        "Исход прежней записи в этот target неизвестен. Выполните read-only reconciliation; новый operationId не разрешает повтор.",
        "unknown",
      );
  }
  private queue<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.serial.get(key) || Promise.resolve();
    const p = previous
      .catch(() => {})
      .then(() => {
        if (this.closing)
          throw failure(
            "conflict",
            "Operations закрывается; ожидающий dispatch отменён.",
          );
        return action();
      });
    this.serial.set(key, p);
    void p
      .finally(() => {
        if (this.serial.get(key) === p) this.serial.delete(key);
      })
      .catch(() => {});
    return p;
  }
  private scheduleMonitor() {
    if (this.closing || this.monitor) return;
    this.monitor = setTimeout(() => {
      this.monitor = undefined;
      void this.monitorReceipts().finally(() => this.scheduleMonitor());
    }, 2000);
    this.monitor.unref?.();
  }
  private async monitorReceipts() {
    if (this.monitoring || this.closing) return;
    this.monitoring = true;
    try {
      const pending = this.store
        .read()
        .receipts.filter(
          (r) =>
            ["accepted", "running"].includes(r.status) &&
            r.remoteId &&
            (this.monitorDelay.get(r.id)?.until || 0) < Date.now(),
        );
      const selected = Array.from(
        { length: Math.min(2, pending.length) },
        (_, i) => pending[(this.monitorOffset + i) % pending.length],
      );
      this.monitorOffset += selected.length;
      await Promise.allSettled(
        selected.map(async (r) => {
          if (this.closing) return;
          try {
            await this.reconcile(r.projectId, r.id);
            this.monitorDelay.delete(r.id);
          } catch (e: any) {
            const failures = (this.monitorDelay.get(r.id)?.failures || 0) + 1;
            this.monitorDelay.set(r.id, {
              failures,
              until:
                Date.now() +
                Math.max(
                  e.retryAfterMs || 0,
                  Math.min(30000, 2000 * 2 ** Math.min(failures, 4)),
                ),
            });
          }
        }),
      );
    } finally {
      this.monitoring = false;
    }
  }
  private async client(c: OpsConnection) {
    if (!c.enabled)
      throw failure("forbidden", "Operations connection отключён.");
    if (!this.clients.has(c.id)) {
      let pending!: Promise<OpsMcpClient>;
      pending = (async () => {
        const client = new OpsMcpClient(
          c,
          { node: this.options.node, provider: this.options.provider },
          this.secret(c.id),
        );
        client.onclose = () => {
          if (this.clients.get(c.id) === pending) this.clients.delete(c.id);
        };
        try {
          await client.connect();
          return client;
        } catch (e) {
          await client.close().catch(() => {});
          if (this.clients.get(c.id) === pending) this.clients.delete(c.id);
          throw e;
        }
      })();
      this.clients.set(c.id, pending);
    }
    return this.clients.get(c.id)!;
  }
  private async inventory(
    c: OpsConnection,
    verify = false,
  ): Promise<{ client: OpsMcpClient; inventory: OpsInventory }> {
    const client = await this.client(c),
      inventory = await client.inventory();
    if (
      verify &&
      c.discovered &&
      inventory.schemaHash !== c.discovered.schemaHash
    )
      throw failure(
        "conflict",
        "MCP schema изменилась. Повторите Test and discover и проверьте bindings до нового действия.",
      );
    if (c.transport !== "builtin") {
      const names = new Set(inventory.tools.map((t) => t.name)),
        mapped = (key: keyof NonNullable<OpsConnection["bindings"]>) =>
          !!c.bindings?.[key] && names.has(c.bindings[key]!);
      const family = c.kind === "jenkins" ? "ci." : "cluster.";
      inventory.capabilities = [
        ...opsReadOperations.filter(
          (op) => op.startsWith(family) && mapped(op),
        ),
        ...opsActionOperations.filter(
          (op) =>
            op.startsWith(family) &&
            mapped("prepare") &&
            mapped("reconcile") &&
            (mapped("execute") || mapped(op)),
        ),
      ];
      inventory.adapterStatus = "inventory_only";
    } else if (c.discovered?.schemaHash === inventory.schemaHash) {
      inventory.capabilities = [...c.discovered.capabilities];
      inventory.adapterStatus = c.discovered.adapterStatus;
    }
    return { client, inventory };
  }
  async invoke(
    method: string,
    p: Record<string, any> = {},
    agent = false,
  ): Promise<any> {
    const op = method.replace(/^ops\./, "");
    if (this.closing && !["snapshot"].includes(op))
      throw failure(
        "conflict",
        "Operations закрывается; новый dispatch запрещён.",
      );
    if (agent && op.startsWith("connection."))
      throw failure(
        "forbidden",
        "Агент не меняет credentials/connections через Operations tools.",
      );
    if (op === "snapshot") return this.snapshot(p.projectId);
    if (op === "connection.save")
      return this.queue(p.connection?.id || "connections", () => this.save(p));
    if (op === "connection.delete")
      return this.queue(p.connectionId, async () => {
        const c = this.connection(p.connectionId);
        if (
          this.store
            .read()
            .receipts.some((r) => r.connectionId === c.id && !terminal(r))
        )
          throw failure(
            "conflict",
            "Подключение используется незавершённой/unknown operation. Сначала выполните reconciliation.",
          );
        await this.update((s) => {
          s.connections = s.connections.filter((v) => v.id !== c.id);
          delete s.secrets[c.id];
          s.prepared = s.prepared.filter((v) => v.connectionId !== c.id);
          s.favorites = s.favorites.filter((v) => v.connectionId !== c.id);
        });
        const client = this.clients.get(c.id);
        this.clients.delete(c.id);
        await client?.then((c) => c.close()).catch(() => {});
        this.options.changed();
        return { deleted: true };
      });
    if (op === "connection.probe" || op === "connection.inventory")
      return this.queue(p.connectionId, async () => {
        const c = this.connection(p.connectionId);
        if (
          p.expectedTargetHash !== undefined ||
          p.expectedAuthGeneration !== undefined
        )
          this.expectedTarget(c, p);
        const { client, inventory } = await this.inventory(c);
        if (
          op === "connection.probe" ||
          (c.transport === "builtin" && !inventory.capabilities.length)
        ) {
          try {
            const probe = await client.call("probe", {});
            const claimed = Array.isArray(probe.capabilities)
              ? probe.capabilities.filter((v: any) => typeof v === "string")
              : [];
            inventory.capabilities =
              c.transport === "builtin"
                ? claimed
                : inventory.capabilities.filter((op) => claimed.includes(op));
            inventory.adapterStatus = "target_verified";
            if (probe.name)
              inventory.server = {
                name: String(probe.name),
                version: probe.version,
              };
          } catch (e: any) {
            if (c.transport === "builtin" || e.kind !== "unsupported") throw e;
          }
        }
        await this.update((s) => {
          s.connections.find((x) => x.id === c.id)!.discovered = inventory;
        });
        this.options.changed();
        return inventory;
      });
    const projectId = this.project(p.projectId);
    if (op === "favorite") {
      const c = this.connection(p.connectionId, projectId);
      if (
        c.kind !== "jenkins" ||
        typeof p.jobId !== "string" ||
        !p.jobId ||
        p.jobId.length > 2000 ||
        typeof p.enabled !== "boolean"
      )
        throw failure("validation", "Неверная Jenkins favorite.");
      await this.update((s) => {
        s.favorites = s.favorites.filter(
          (f) => f.connectionId !== c.id || f.jobId !== p.jobId,
        );
        if (p.enabled) s.favorites.push({ connectionId: c.id, jobId: p.jobId });
      });
      this.options.changed();
      return { enabled: p.enabled };
    }
    if (op === "query") {
      const c = this.connection(p.connectionId, projectId),
        input = safeInput(p.input || {});
      this.expectedTarget(c, p);
      if (
        typeof p.operation !== "string" ||
        !p.operation.startsWith(c.kind === "jenkins" ? "ci." : "cluster.") ||
        !opsReadOperations.includes(p.operation as any)
      )
        throw failure(
          "unsupported",
          "Это не read-only operation данного подключения.",
        );
      const count = this.reads.get(c.id) || 0;
      if (count >= 4)
        throw failure(
          "conflict",
          "Выполняются четыре Operations read-запроса. Дождитесь одной страницы.",
        );
      this.reads.set(c.id, count + 1);
      try {
        const client = await this.client(c);
        let result: any;
        try {
          result = secretResult(
            validateEnvelope(
              await client.call(p.operation as any, input),
              p.operation,
              input,
            ),
            input,
            this.secret(c.id),
          );
        } catch (e) {
          if (e instanceof OpsFailure) throw e;
          throw failure(
            "protocol",
            "Operations ответ не соответствует схеме выбранной операции; проверьте adapter.",
          );
        }
        const current = this.connection(c.id, projectId);
        if (
          current.targetHash !== c.targetHash ||
          current.authGeneration !== c.authGeneration
        )
          throw failure(
            "conflict",
            "Подключение изменилось во время чтения. Старый ответ не применяется.",
          );
        return result;
      } finally {
        const remaining = (this.reads.get(c.id) || 1) - 1;
        if (remaining) this.reads.set(c.id, remaining);
        else this.reads.delete(c.id);
      }
    }
    if (op === "prepare")
      return this.queue(p.connectionId, async () => {
        const c = this.connection(p.connectionId, projectId),
          input = safeInput(p.input || {});
        this.expectedTarget(c, p);
        if (
          typeof p.operation !== "string" ||
          !p.operation.startsWith(c.kind === "jenkins" ? "ci." : "cluster.")
        )
          throw failure(
            "unsupported",
            "Операция не соответствует типу подключения.",
          );
        if (!isAction(p.operation))
          throw failure(
            "unsupported",
            "Это не поддержанная Operations mutation.",
          );
        if (
          JSON.stringify(output(input, this.secret(c.id))) !==
          JSON.stringify(input)
        )
          throw failure(
            "unsupported",
            "Action payload содержит credentials или защищённые значения. Используйте защищённый adapter/secretRef; редактированный payload не исполняется.",
          );
        this.assertKnownEffect(c.id, p.operation, input, p.operationId);
        const { client, inventory } = await this.inventory(c, true);
        const preflight = await client.call("prepare", {
          operation: p.operation,
          input,
        });
        this.expectedTarget(this.connection(c.id, projectId), p);
        if (this.closing)
          throw failure(
            "conflict",
            "Operations закрывается; prepare не сохранён.",
          );
        if (
          !preflight ||
          typeof preflight.summary !== "string" ||
          typeof preflight.input !== "object" ||
          !("preview" in preflight)
        )
          throw failure(
            "protocol",
            "MCP prepare не вернул immutable input/preview.",
          );
        if (
          effectKey(p.operation, input) !==
          effectKey(p.operation, preflight.input)
        )
          throw failure(
            "protocol",
            "MCP prepare изменил выбранный action target; dispatch запрещён.",
          );
        this.assertKnownEffect(
          c.id,
          p.operation,
          preflight.input,
          p.operationId,
        );
        if (Buffer.byteLength(JSON.stringify(preflight.preview)) > 1024 ** 2)
          throw failure(
            "payload_too_large",
            "Operations preview превышает1MiB; уменьшите manifest/diff.",
          );
        const capturedInput = safeInput(preflight.input);
        if (
          JSON.stringify(output(capturedInput, this.secret(c.id))) !==
          JSON.stringify(capturedInput)
        )
          throw failure(
            "unsupported",
            "MCP prepare вернул secret-bearing payload. Редактированный input не исполняется; нужен защищённый adapter/secretRef.",
          );
        const action: OpsPreparedAction = {
          id: randomUUID(),
          operationId: p.operationId || randomUUID(),
          projectId,
          connectionId: c.id,
          operation: p.operation,
          input: capturedInput,
          targetHash: c.targetHash,
          authGeneration: c.authGeneration,
          schemaHash: inventory.schemaHash,
          summary: output(preflight.summary.slice(0, 500), this.secret(c.id)),
          preview: output(preflight.preview, this.secret(c.id)),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        };
        if (
          typeof action.operationId !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(action.operationId)
        )
          throw failure("validation", "Неверный operationId.");
        await this.update((s) => {
          s.prepared = s.prepared
            .filter((a) => Date.parse(a.expiresAt) > Date.now())
            .slice(-99);
          s.prepared.push(action);
        });
        this.options.changed(projectId);
        return action;
      });
    if (op === "execute") return this.execute(projectId, p.preparedActionId);
    if (op === "reconcile") {
      const receipt = this.store
        .read()
        .receipts.find(
          (r) => r.id === p.receiptId && r.projectId === projectId,
        );
      if (!receipt) throw failure("not_found", "Operations receipt не найден.");
      return this.reconcile(projectId, receipt.id);
    }
    throw failure("unsupported", "Operations method не поддерживается.");
  }
  private accept(receipt: OpsReceipt, result: any) {
    if (
      !result ||
      ![
        "accepted",
        "running",
        "confirmed",
        "failed",
        "cancelled",
        "unknown",
      ].includes(result.status)
    )
      throw failure(
        "protocol",
        "MCP action не вернул подтверждённый receipt status.",
        "unknown",
      );
    receipt.status = result.status;
    receipt.updatedAt = new Date().toISOString();
    receipt.data = output(
      result.data ?? null,
      this.secret(receipt.connectionId),
    );
    receipt.remoteId =
      result.remoteId === undefined
        ? receipt.remoteId
        : String(result.remoteId);
    receipt.error = undefined;
  }
  private reconcile(projectId: string, receiptId: string): Promise<OpsReceipt> {
    const own = this.store
      .read()
      .receipts.find((r) => r.id === receiptId && r.projectId === projectId);
    if (!own)
      return Promise.reject(
        failure("not_found", "Operations receipt не найден."),
      );
    const pending = this.reconciling.get(receiptId);
    if (pending) return pending;
    const result = this.readReconcile(projectId, receiptId);
    this.reconciling.set(receiptId, result);
    void result
      .finally(() => this.reconciling.delete(receiptId))
      .catch(() => {});
    return result;
  }
  private async readReconcile(projectId: string, receiptId: string) {
    let r = this.store
      .read()
      .receipts.find((r) => r.id === receiptId && r.projectId === projectId);
    if (!r) throw failure("not_found", "Operations receipt не найден.");
    if (terminal(r)) return r;
    if (r.status === "dispatching") {
      if (this.dispatches.has(r.preparedActionId))
        throw failure("conflict", "Dispatch ещё не завершён.");
      // A successful wire write followed by journal I/O failure can leave the last
      // durable intent dispatching after its promise has ended. Never replay it.
      // Once storage recovers, convert it durably before read-only reconciliation.
      const id = r.id;
      try {
        r = await this.update((s) => {
          const x = s.receipts.find((v) => v.id === id)!;
          if (x.status === "dispatching") {
            x.status = "unknown";
            x.updatedAt = new Date().toISOString();
            x.error = {
              kind: "unknown",
              outcome: "unknown",
              message:
                "Dispatch завершился без durable receipt. Проверяйте внешний эффект; запрос не повторён.",
            };
          }
          return structuredClone(x);
        });
      } catch {
        throw failure(
          "unknown",
          "Журнал Operations пока недоступен. Исход dispatch неизвестен; запрос не повторён.",
          "unknown",
        );
      }
      this.options.changed(projectId);
    }
    const c = this.connection(r.connectionId, projectId);
    if (c.targetHash !== r.targetHash)
      throw failure(
        "conflict",
        "Receipt относится к другому target. Сверка не переносится на другой сервер.",
      );
    const client = await this.client(c),
      result = await client.call(
        "reconcile",
        {
          operation: r.operation,
          input: r.input,
          remoteId: r.remoteId,
          data: r.data,
        },
        { timeoutMs: 10000 },
      );
    if (this.closing) return r;
    const current = this.connection(c.id, projectId);
    if (
      current.targetHash !== c.targetHash ||
      current.authGeneration !== c.authGeneration
    )
      throw failure(
        "conflict",
        "Credentials изменились во время сверки. Повторите read-only reconciliation с текущим подключением.",
      );
    const candidate = structuredClone(r);
    this.accept(candidate, result);
    candidate.lastObservedAuthGeneration = c.authGeneration;
    if (hash({ ...candidate, updatedAt: "" }) === hash({ ...r, updatedAt: "" }))
      return r;
    const updated = await this.update((s) => {
      const observedConnection = s.connections.find((v) => v.id === c.id);
      if (
        observedConnection?.targetHash !== c.targetHash ||
        observedConnection?.authGeneration !== c.authGeneration
      )
        throw failure(
          "conflict",
          "Credentials изменились до сохранения сверки. Повторите read-only reconciliation.",
        );
      const x = s.receipts.find((v) => v.id === r.id)!;
      if (!terminal(x) && x.updatedAt === r.updatedAt) {
        this.accept(x, result);
        x.lastObservedAuthGeneration = c.authGeneration;
      }
      return structuredClone(x);
    });
    this.options.changed(projectId);
    return updated;
  }
  private execute(projectId: string, actionId: string) {
    const action = this.store
      .read()
      .prepared.find((a) => a.id === actionId && a.projectId === projectId);
    if (!action)
      return Promise.reject(failure("not_found", "Prepared action не найден."));
    this.connection(action.connectionId, projectId);
    const existing = this.dispatches.get(actionId);
    if (existing) return existing;
    const p = this.queue(action.connectionId, async () => {
      const c = this.connection(action.connectionId, projectId),
        requestHash = hash({
          operation: action.operation,
          input: action.input,
          targetHash: action.targetHash,
          authGeneration: action.authGeneration,
        });
      const previous = this.store
        .read()
        .receipts.find(
          (r) =>
            r.connectionId === c.id && r.operationId === action.operationId,
        );
      if (previous) {
        if (
          previous.projectId !== projectId ||
          previous.requestHash !== requestHash
        )
          throw failure(
            "conflict",
            "operationId уже принадлежит другому input/target.",
          );
        return previous;
      }
      this.assertKnownEffect(
        c.id,
        action.operation,
        action.input,
        action.operationId,
      );
      if (
        Date.parse(action.expiresAt) < Date.now() ||
        c.targetHash !== action.targetHash ||
        c.authGeneration !== action.authGeneration
      )
        throw failure(
          "conflict",
          "Prepared action устарел. Создайте новый preview.",
        );
      const { client, inventory } = await this.inventory(c, true);
      if (inventory.schemaHash !== action.schemaHash)
        throw failure("conflict", "MCP schema изменилась после preview.");
      if (this.closing)
        throw failure(
          "conflict",
          "Operations закрывается; mutation не отправлена.",
        );
      if (this.store.read().receipts.filter((r) => !terminal(r)).length >= 100)
        throw failure(
          "conflict",
          "Достигнут лимит100 незавершённых Operations. Все доступны в журнале; завершите или сверьте их.",
        );
      const receipt: OpsReceipt = {
        id: randomUUID(),
        preparedActionId: action.id,
        operationId: action.operationId,
        projectId,
        connectionId: c.id,
        operation: action.operation,
        input: action.input,
        targetHash: c.targetHash,
        authGeneration: c.authGeneration,
        requestHash,
        status: "dispatching",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.update((s) => {
        if (s.receipts.length >= 1000)
          throw failure(
            "payload_too_large",
            "Журнал Operations содержит1000 записей; экспорт/retention ещё не реализованы.",
          );
        s.receipts.push(receipt);
      });
      this.options.changed(projectId);
      try {
        const result = await client.call(
          "execute",
          { operation: action.operation, input: action.input },
          {
            actionOperation: action.operation,
            dispatched: true,
            timeoutMs: 30000,
          },
        );
        await this.update((s) => {
          const r = s.receipts.find((r) => r.id === receipt.id)!;
          if (!this.closing) this.accept(r, result);
        });
      } catch (error) {
        const e = normalizeError(error, true);
        await this.update((s) => {
          const r = s.receipts.find((r) => r.id === receipt.id)!;
          r.status = e.outcome === "notApplied" ? "failed" : "unknown";
          r.error = e;
          r.updatedAt = new Date().toISOString();
        });
      }
      this.options.changed(projectId);
      return this.store.read().receipts.find((r) => r.id === receipt.id)!;
    });
    this.dispatches.set(actionId, p);
    void p.finally(() => this.dispatches.delete(actionId)).catch(() => {});
    return p;
  }
  private async save(p: Record<string, any>) {
    const raw = p.connection;
    if (!raw || typeof raw !== "object")
      throw failure("validation", "Нужно описание connection.");
    const existing = raw.id ? this.connection(raw.id) : undefined;
    if (!existing && this.store.read().connections.length >= 50)
      throw failure(
        "payload_too_large",
        "Достигнут лимит50 Operations connections.",
      );
    if (existing && raw.revision !== existing.revision)
      throw failure(
        "conflict",
        "Operations connection изменился в другом окне. Обновите настройки.",
      );
    const c: OpsConnection = {
      ...existing,
      ...raw,
      id: existing?.id || randomUUID(),
      revision: (existing?.revision || 0) + 1,
      credentialConfigured: existing?.credentialConfigured || false,
      authGeneration: existing?.authGeneration || 0,
      targetHash: "",
    };
    if (
      !["jenkins", "kubernetes", "openshift"].includes(c.kind) ||
      !["builtin", "stdio", "http"].includes(c.transport) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 100
    )
      throw failure("validation", "Неверные kind/transport/name подключения.");
    c.environment = String(c.environment || "").slice(0, 100);
    c.enabled = c.enabled !== false;
    if (
      !Array.isArray(c.projectIds) ||
      c.projectIds.length > 100 ||
      c.projectIds.some(
        (id) => typeof id !== "string" || !this.options.project(id),
      )
    )
      throw failure("validation", "Выберите существующие проекты.");
    c.projectIds = [...new Set(c.projectIds)];
    if (c.transport !== "stdio")
      c.url = checkedUrl(c.url || "").href.replace(/\/$/, "");
    else if (
      typeof c.command !== "string" ||
      !c.command ||
      c.command.length > 2000 ||
      !Array.isArray(c.args || [])
    )
      throw failure("validation", "Нужны executable и argv для stdio MCP.");
    if (
      c.username !== undefined &&
      (typeof c.username !== "string" || c.username.length > 300)
    )
      throw failure("validation", "Неверное имя пользователя.");
    if (
      c.secretPrefix !== undefined &&
      (typeof c.secretPrefix !== "string" ||
        c.secretPrefix.length > 100 ||
        /[\r\n]/.test(c.secretPrefix))
    )
      throw failure("validation", "Неверный credential prefix.");
    if (
      (c.args || []).length > 100 ||
      Buffer.byteLength(JSON.stringify(c.args || [])) > 16000
    )
      throw failure("validation", "MCP argv превышает100 arguments/16KiB.");
    if (
      (c.args || []).some(
        (a) =>
          typeof a !== "string" ||
          a.length > 4000 ||
          /(?:password|bearer|authorization|--token)[=: ]/i.test(a),
      )
    )
      throw failure("validation", "Не помещайте credentials в MCP argv.");
    if (
      c.secretHeader &&
      (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.secretHeader) ||
        /^(host|cookie|content-length|transfer-encoding|connection|content-type)$/i.test(
          c.secretHeader,
        ))
    )
      throw failure("validation", "Неверное credential header.");
    if (
      c.secretEnv &&
      (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.secretEnv) ||
        /^(HOME|PATH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|CODEX_HOME)$/i.test(
          c.secretEnv,
        ))
    )
      throw failure("validation", "Неверное credential environment name.");
    if (
      c.ca &&
      (typeof c.ca !== "string" ||
        c.ca.length > 256000 ||
        !c.ca.includes("-----BEGIN CERTIFICATE-----"))
    )
      throw failure("validation", "CA должен содержать PEM certificate.");
    const bindingKeys = [
      ...opsReadOperations,
      ...opsActionOperations,
      "prepare",
      "execute",
      "reconcile",
      "probe",
    ];
    if (
      c.bindings &&
      (typeof c.bindings !== "object" ||
        Object.entries(c.bindings).some(
          ([k, v]) =>
            !bindingKeys.includes(k as any) ||
            typeof v !== "string" ||
            !v ||
            v.length > 200,
        ))
    )
      throw failure("validation", "Неверные exact MCP bindings.");
    const oldSecret = existing ? this.secret(c.id) : undefined;
    if (
      p.secret !== undefined &&
      (typeof p.secret !== "string" || !p.secret || p.secret.length > 16000)
    )
      throw failure(
        "validation",
        "Credential должен быть непустой строкой до16k.",
      );
    const newSecret = p.clearSecret
      ? undefined
      : p.secret === undefined
        ? oldSecret
        : p.secret;
    const authChanged = newSecret !== oldSecret;
    if (newSecret && !this.options.vault.available())
      throw failure(
        "unsupported",
        "Шифрование credentials недоступно; plaintext fallback запрещён.",
      );
    c.credentialConfigured = !!newSecret;
    c.authGeneration += authChanged ? 1 : 0;
    c.targetHash = targetHash(c);
    const targetChanged =
      !!existing &&
      (c.targetHash !== existing.targetHash ||
        c.enabled !== existing.enabled ||
        existing.projectIds.some((id) => !c.projectIds.includes(id)));
    const changed = targetChanged || (!!existing && authChanged);
    if (
      targetChanged &&
      this.store
        .read()
        .receipts.some((r) => r.connectionId === c.id && !terminal(r))
    )
      throw failure(
        "conflict",
        "Незавершённая/unknown operation удерживает target/binding. Можно переименовать подключение или обновить credentials для того же сервера.",
      );
    if (!existing || changed) c.discovered = undefined;
    // Copy only defined public connection fields: never persist a renderer's extra secret property.
    const clean = Object.fromEntries(
      Object.entries(c).filter(([k]) =>
        [
          "id",
          "revision",
          "kind",
          "name",
          "environment",
          "enabled",
          "projectIds",
          "transport",
          "url",
          "username",
          "command",
          "args",
          "secretHeader",
          "secretPrefix",
          "secretEnv",
          "ca",
          "bindings",
          "credentialConfigured",
          "targetHash",
          "authGeneration",
          "discovered",
        ].includes(k),
      ),
    ) as unknown as OpsConnection;
    await this.update((s) => {
      if (newSecret)
        s.secrets[c.id] = this.options.vault
          .encrypt(newSecret)
          .toString("base64");
      else delete s.secrets[c.id];
      const i = s.connections.findIndex((v) => v.id === c.id);
      if (i < 0) s.connections.push(clean);
      else s.connections[i] = clean;
    });
    if (changed) {
      const previous = this.clients.get(c.id);
      this.clients.delete(c.id);
      await previous?.then((c) => c.close()).catch(() => {});
    }
    this.options.changed();
    return clean;
  }
  async dispose() {
    this.closing = true;
    clearTimeout(this.monitor);
    this.monitor = undefined;
    await this.update((s) => {
      for (const r of s.receipts)
        if (r.status === "dispatching") {
          r.status = "unknown";
          r.updatedAt = new Date().toISOString();
          r.error = {
            kind: "unknown",
            message:
              "Workbench закрыт во время dispatch. Только read-only reconciliation; запрос не повторён.",
            outcome: "unknown",
          };
        }
    });
    const deadline = async (p: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          p,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    await deadline(
      Promise.allSettled(
        [...this.clients.values()].map((p) => p.then((c) => c.close())),
      ),
    );
    await deadline(Promise.allSettled([...this.dispatches.values()]));
    await this.store.close();
  }
}
