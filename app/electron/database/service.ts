import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AtomicStore } from "../store";
import { DatabaseMcpClient } from "./client";
import type {
  DatabaseConnection,
  DatabaseConsole,
  DatabaseSnapshot,
  DatabaseJob,
  DatabaseLease,
} from "../../shared/database";
import type { DatabaseOperation } from "./protocol";
type Recovery = {
  id: string;
  consoleId: string;
  projectId: string;
  connectionId: string;
  targetHash?: string;
  title: string;
  sql: string;
  revision: number;
  at: string;
};
type DataState = {
  version: 1;
  connections: DatabaseConnection[];
  consoles: DatabaseConsole[];
  secrets: Record<string, string>;
  recoveries?: Recovery[];
};
type Vault = {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
};
function targetHash(c: DatabaseConnection) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        transport: c.transport,
        host: c.host || "localhost",
        port: c.port || 5432,
        database: c.database,
        user: c.user,
        ssl: !!c.ssl,
        ca: c.ca,
        readOnly: !!c.readOnly,
        command: c.command,
        args: c.args,
        url: c.url,
        bindings: c.bindings,
        secretEnv: c.secretEnv,
        secretHeader: c.secretHeader,
        secretPrefix: c.secretPrefix,
      }),
    )
    .digest("hex");
}
export class DatabaseService {
  private store: AtomicStore<DataState>;
  private clients = new Map<string, Promise<DatabaseMcpClient>>();
  private leases = new Map<string, DatabaseLease>();
  private jobs = new Map<string, DatabaseJob>();
  private pending = new Map<string, Promise<any>>();
  private operations = new Map<string, Promise<any>>();
  constructor(
    private options: {
      dataDir: string;
      node: string;
      provider: string;
      vault: Vault;
      changed: (projectId?: string) => void;
      project: (id: string) => unknown;
    },
  ) {
    this.store = new AtomicStore<DataState>(
      path.join(options.dataDir, "database"),
      () => ({ version: 1, connections: [], consoles: [], secrets: {} }),
      (v): v is DataState =>
        !!v &&
        (v as any).version === 1 &&
        Array.isArray((v as any).connections) &&
        Array.isArray((v as any).consoles) &&
        typeof (v as any).secrets === "object",
    );
  }
  async init() {
    await this.store.init();
    await this.store.update((s) => {
      for (const connection of s.connections)
        connection.targetHash ||= targetHash(connection);
      for (const c of s.consoles) {
        c.targetHash ||= s.connections.find(
          (x) => x.id === c.connectionId,
        )?.targetHash;
        c.leaseId = undefined;
        if (c.pendingEffect) {
          c.pendingEffect.phase = "unknown";
          c.pendingEffect.reason =
            "Приложение перезапущено до подтверждения записи. Сверьте данные перед повтором.";
        }
      }
    });
  }
  private secret(id: string) {
    const v = this.store.read().secrets[id];
    return v ? this.options.vault.decrypt(Buffer.from(v, "base64")) : undefined;
  }
  private connection(id: string, projectId?: string) {
    const c = this.store.read().connections.find((c) => c.id === id);
    if (!c) throw new Error("Подключение не найдено");
    if (projectId && !c.projectIds.includes(projectId))
      throw new Error("Подключение не привязано к этому проекту");
    return c;
  }
  private console(id: string, projectId: string) {
    const c = this.store
      .read()
      .consoles.find((c) => c.id === id && c.projectId === projectId);
    if (!c) throw new Error("Консоль другого проекта или не существует");
    this.connection(c.connectionId, projectId);
    return c;
  }
  private async client(id: string) {
    if (!this.clients.has(id)) {
      const p = (async () => {
        const c = this.connection(id);
        const client = new DatabaseMcpClient(
          c,
          {
            node: this.options.node,
            provider: this.options.provider,
            directory: path.join(
              this.options.dataDir,
              "database",
              "providers",
              id,
            ),
          },
          this.secret(id),
        );
        client.client.onclose = () => {
          if (this.clients.get(id) === p) this.clients.delete(id);
          for (const l of this.leases.values())
            if (l.connectionId === id) {
              l.transaction = "unknown";
              l.busy = false;
            }
          const consoles = new Set(
            this.store
              .read()
              .consoles.filter((c) => c.connectionId === id)
              .map((c) => c.id),
          );
          for (const j of this.jobs.values())
            if (consoles.has(j.consoleId) && j.status === "running")
              j.status = "unknown";
          this.options.changed();
        };
        try {
          await client.connect();
          return client;
        } catch (e) {
          await client.close().catch(() => {});
          this.clients.delete(id);
          throw e;
        }
      })();
      this.clients.set(id, p);
    }
    return this.clients.get(id)!;
  }
  private publicConnections(projectId?: string) {
    const s = this.store.read();
    return s.connections
      .filter((c) => !projectId || c.projectIds.includes(projectId))
      .map((c) => ({ ...c, hasSecret: !!s.secrets[c.id] }));
  }
  private async refresh(projectId: string) {
    const own = this.store
        .read()
        .consoles.filter((c) => c.projectId === projectId),
      ids = new Set(own.map((c) => c.id)),
      leaseIds = new Set(own.map((c) => c.leaseId));
    for (const connectionId of new Set(own.map((c) => c.connectionId))) {
      const pending = this.clients.get(connectionId);
      if (!pending) continue;
      try {
        const r = await (await pending).call("status", {});
        for (const l of r.leases || [])
          if (leaseIds.has(l.id)) this.leases.set(l.id, l);
        for (const j of r.jobs || [])
          if (ids.has(j.consoleId)) this.jobs.set(j.id, j);
      } catch {
        for (const c of own.filter((c) => c.connectionId === connectionId)) {
          const l = c.leaseId ? this.leases.get(c.leaseId) : undefined;
          if (l) l.transaction = "unknown";
          for (const j of this.jobs.values())
            if (j.consoleId === c.id && j.status === "running")
              j.status = "unknown";
        }
      }
    }
  }
  async snapshot(projectId: string): Promise<DatabaseSnapshot> {
    this.options.project(projectId);
    await this.refresh(projectId);
    const consoles = this.store
        .read()
        .consoles.filter((c) => c.projectId === projectId),
      ids = new Set(consoles.map((c) => c.id));
    return {
      connections: this.publicConnections(projectId),
      consoles: consoles.map((c) => ({
        ...c,
        pendingEffect: c.pendingEffect
          ? { ...c.pendingEffect, intent: undefined }
          : undefined,
      })),
      leases: [...this.leases.values()].filter((l) =>
        consoles.some((c) => c.leaseId === l.id),
      ),
      jobs: [...this.jobs.values()].filter((j) => ids.has(j.consoleId)),
    };
  }
  async invoke(method: string, p: any, agent = false): Promise<any> {
    if (
      !p.consoleId ||
      ["database.cancel", "database.snapshot", "database.page"].includes(method)
    )
      return this.invokeActual(method, p, agent);
    const key = String(p.consoleId),
      previous = this.operations.get(key) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(() => this.invokeActual(method, p, agent));
    this.operations.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.operations.get(key) === operation) this.operations.delete(key);
    }
  }
  private async invokeActual(
    method: string,
    p: any,
    agent = false,
  ): Promise<any> {
    const op = method.replace(/^database\./, "");
    if (
      [
        "connections",
        "connection.save",
        "connection.remove",
        "connection.probe",
      ].includes(op)
    ) {
      if (agent)
        throw new Error(
          "Настройка подключений и секретов доступна пользователю",
        );
      if (op === "connections")
        return {
          connections: this.publicConnections(),
          secretStorage: this.options.vault.available(),
        };
      if (op === "connection.save") {
        const c = p.connection as DatabaseConnection,
          old = c.id
            ? this.store.read().connections.find((x) => x.id === c.id)
            : undefined;
        if (
          !c.name?.trim() ||
          !["postgres-mcp", "stdio", "http"].includes(c.transport)
        )
          throw new Error("Нужны название и тип MCP подключения");
        if (!Array.isArray(c.projectIds))
          throw new Error("Привяжите подключение к проектам");
        for (const id of c.projectIds) this.options.project(id);
        const clean: DatabaseConnection = {
          id: old?.id || randomUUID(),
          name: c.name.trim().slice(0, 120),
          environment: String(c.environment || "").slice(0, 80),
          projectIds: [...new Set(c.projectIds)],
          transport: c.transport,
          host: c.host,
          port: c.port,
          database: c.database,
          user: c.user,
          ssl: !!c.ssl,
          ca: c.ca,
          readOnly: !!c.readOnly,
          command: c.command,
          args: c.args,
          url: c.url,
          bindings: c.bindings,
          secretEnv: c.secretEnv,
          secretHeader: c.secretHeader,
          secretPrefix: c.secretPrefix,
        };
        clean.targetHash = targetHash(clean);
        if (
          clean.secretEnv &&
          (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(clean.secretEnv) ||
            [
              "PATH",
              "HOME",
              "USERPROFILE",
              "NODE_OPTIONS",
              "NODE_PATH",
              "ELECTRON_RUN_AS_NODE",
              "WORKBENCH_DATABASE_DIR",
            ].includes(clean.secretEnv))
        )
          throw new Error("Неверное имя переменной для токена");
        if (
          clean.secretHeader &&
          (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(clean.secretHeader) ||
            [
              "host",
              "connection",
              "content-length",
              "transfer-encoding",
              "cookie",
              "set-cookie",
            ].includes(clean.secretHeader.toLowerCase()))
        )
          throw new Error("Неверный заголовок авторизации");
        if (clean.secretPrefix && /[\r\n]/.test(clean.secretPrefix))
          throw new Error("Префикс токена не может содержать перевод строки");
        if (
          clean.port &&
          (!Number.isInteger(clean.port) ||
            clean.port < 1 ||
            clean.port > 65535)
        )
          throw new Error("Порт: 1–65535");
        if (
          typeof p.secret === "string" &&
          p.secret &&
          !this.options.vault.available()
        )
          throw new Error(
            "Системное шифрование недоступно. Секрет не будет сохранён открытым текстом.",
          );
        if (
          old &&
          this.store
            .read()
            .consoles.some(
              (x) =>
                x.connectionId === old.id && (x.leaseId || x.pendingEffect),
            )
        )
          throw new Error(
            "Закройте соединения консолей перед изменением подключения",
          );
        await this.store.update((s) => {
          s.connections = s.connections.filter((x) => x.id !== clean.id);
          s.connections.push(clean);
          if (typeof p.secret === "string" && p.secret)
            s.secrets[clean.id] = this.options.vault
              .encrypt(p.secret)
              .toString("base64");
          if (p.clearSecret) delete s.secrets[clean.id];
        });
        const existing = this.clients.get(clean.id);
        this.clients.delete(clean.id);
        if (existing) await (await existing).close();
        this.options.changed();
        return { ...clean, hasSecret: !!this.store.read().secrets[clean.id] };
      }
      const c = this.connection(p.connectionId);
      if (op === "connection.remove") {
        if (this.store.read().consoles.some((x) => x.connectionId === c.id))
          throw new Error("Сначала удалите консоли этого подключения");
        const existing = this.clients.get(c.id);
        this.clients.delete(c.id);
        if (existing) await (await existing).close();
        await this.store.update((s) => {
          s.connections = s.connections.filter((x) => x.id !== c.id);
          delete s.secrets[c.id];
        });
        this.options.changed();
        return { removed: true };
      }
      const client = await this.client(c.id);
      const inventory = client.inventory();
      if (c.transport === "postgres-mcp") {
        const lease = await client.call("open", {
          connection: c,
          password: this.secret(c.id),
        });
        try {
          return {
            ...inventory,
            server: lease.server,
            database: lease.database,
            user: lease.user,
          };
        } finally {
          await client.call("close", { leaseId: lease.id });
        }
      }
      return inventory;
    }
    this.options.project(p.projectId);
    if (op === "snapshot") {
      const snapshot = await this.snapshot(p.projectId);
      if (!agent) return snapshot;
      const consoleOffset = Math.max(0, Math.floor(p.consoleOffset || 0)),
        jobOffset = Math.max(0, Math.floor(p.jobOffset || 0));
      return {
        connections: snapshot.connections.map((c) => ({
          id: c.id,
          name: c.name,
          environment: c.environment,
          transport: c.transport,
          database: c.database,
          user: c.user,
          readOnly: c.readOnly,
        })),
        consoleTotal: snapshot.consoles.length,
        jobTotal: snapshot.jobs.length,
        consoles: snapshot.consoles
          .slice(
            consoleOffset,
            consoleOffset + Math.min(30, p.consoleLimit || 30),
          )
          .map(({ sql, ...c }) => ({ ...c, sqlLength: sql.length })),
        leases: snapshot.leases,
        jobs: snapshot.jobs
          .slice()
          .reverse()
          .slice(jobOffset, jobOffset + Math.min(20, p.jobLimit || 20))
          .map(({ sql, sqlPath, ...j }) => j),
      };
    }
    if (op === "recovery.list")
      return (this.store.read().recoveries || [])
        .filter((r) => r.projectId === p.projectId)
        .map(({ sql, ...r }) => r);
    if (op === "recovery.restore") {
      const r = this.store
        .read()
        .recoveries?.find((r) => r.id === p.id && r.projectId === p.projectId);
      if (!r) throw new Error("Черновик не найден");
      this.connection(r.connectionId, p.projectId);
      const c: DatabaseConsole = {
        id: randomUUID(),
        projectId: r.projectId,
        connectionId: r.connectionId,
        targetHash: r.targetHash || this.connection(r.connectionId).targetHash,
        title: r.title + " · восстановлено",
        sql: r.sql,
        revision: 1,
        schema: "public",
        mode: "auto",
        updatedAt: new Date().toISOString(),
      };
      await this.store.update((s) => {
        s.consoles.push(c);
        s.recoveries = s.recoveries?.filter((x) => x.id !== r.id);
      });
      this.options.changed(p.projectId);
      return c;
    }
    if (op === "console.create") {
      const target = this.connection(p.connectionId, p.projectId);
      const c: DatabaseConsole = {
        id: randomUUID(),
        projectId: p.projectId,
        connectionId: p.connectionId,
        targetHash: target.targetHash,
        title: p.title || "SQL-консоль",
        sql: p.sql || "",
        revision: 1,
        schema: "public",
        mode: "auto",
        updatedAt: new Date().toISOString(),
      };
      if (p.object) {
        if (
          !/^\d+$/.test(p.object.oid) ||
          ![
            "table",
            "view",
            "materialized view",
            "foreign table",
            "function",
            "procedure",
            "sequence",
          ].includes(p.object.kind)
        )
          throw new Error("Неверный объект БД");
        c.object = { oid: p.object.oid, kind: p.object.kind };
      }
      await this.store.update((s) => s.consoles.push(c));
      this.options.changed(p.projectId);
      return c;
    }
    const c = this.console(p.consoleId, p.projectId);
    if (op === "history.load") {
      const status = await (
        await this.client(c.connectionId)
      ).call("status", {});
      const own = new Set(
        this.store
          .read()
          .consoles.filter(
            (d) =>
              d.projectId === p.projectId && d.connectionId === c.connectionId,
          )
          .map((d) => d.id),
      );
      for (const job of status.jobs)
        if (own.has(job.consoleId)) this.jobs.set(job.id, job);
      return { loaded: true };
    }
    if (op === "job.read") {
      const job = this.jobs.get(p.jobId);
      if (!job || job.consoleId !== c.id)
        throw new Error("Операция другой консоли или ещё не загружена");
      return (await this.client(c.connectionId)).call("jobRead", {
        jobId: p.jobId,
        offset: p.offset,
        limit: p.limit,
        part: p.part,
      });
    }
    if (op === "effect.read") {
      if (!c.pendingEffect) return { pending: false };
      const body = JSON.stringify(c.pendingEffect.intent || {}, null, 2),
        offset = Math.max(0, Math.floor(p.offset || 0)),
        limit = Math.min(32768, Math.max(1, Math.floor(p.limit || 8192)));
      return {
        ...c.pendingEffect,
        intent: body.slice(offset, offset + limit),
        offset,
        total: body.length,
        truncated: offset + limit < body.length,
      };
    }
    if (op === "effect.resolve") {
      if (!c.pendingEffect || c.pendingEffect.operationId !== p.operationId)
        throw new Error("Нет этой несверенной операции");
      if (c.pendingEffect.phase !== "unknown")
        throw new Error("Операция ещё выполняется; дождитесь исхода");
      if (
        !["applied", "notApplied"].includes(p.outcome) ||
        typeof p.note !== "string" ||
        p.note.trim().length < 10
      )
        throw new Error(
          "Укажите результат сверки и факты, на которых он основан",
        );
      const evidenceJobIds: string[] = Array.isArray(p.evidenceJobIds)
        ? p.evidenceJobIds
        : [];
      if (agent) {
        await this.refresh(p.projectId);
        const own = this.store
          .read()
          .consoles.filter(
            (d) =>
              d.projectId === p.projectId && d.connectionId === c.connectionId,
          );
        if (
          !evidenceJobIds.length ||
          evidenceJobIds.some((id) => {
            const j = this.jobs.get(id);
            return (
              !j ||
              j.status !== "completed" ||
              j.startedAt < c.pendingEffect!.at ||
              !own.some((d) => d.id === j.consoleId)
            );
          })
        )
          throw new Error(
            "Для агентской сверки нужны завершённые проверки на том же подключении. Не подменяйте их текстом «всё работает».",
          );
      }
      const resolution = {
        operationId: p.operationId,
        outcome: p.outcome as "applied" | "notApplied",
        note: p.note.trim().slice(0, 2000),
        evidenceJobIds: evidenceJobIds.slice(0, 20),
        at: new Date().toISOString(),
      };
      await this.store.update((s) => {
        const d = s.consoles.find((d) => d.id === c.id)!;
        if (d.pendingEffect?.operationId !== p.operationId)
          throw new Error("Операция изменилась во время сверки");
        d.lastResolution = resolution;
        d.pendingEffect = undefined;
      });
      this.options.changed(p.projectId);
      return resolution;
    }
    if (op === "console.read") {
      if (!agent)
        return {
          ...c,
          pendingEffect: c.pendingEffect
            ? { ...c.pendingEffect, intent: undefined }
            : undefined,
        };
      const offset = Math.max(0, Math.floor(p.offset || 0)),
        limit = Math.min(32768, Math.max(1, Math.floor(p.limit || 8192)));
      return {
        ...c,
        pendingEffect: c.pendingEffect
          ? { ...c.pendingEffect, intent: undefined }
          : undefined,
        sql: c.sql.slice(offset, offset + limit),
        offset,
        offsetUnit: "utf16",
        total: c.sql.length,
        truncated: offset + limit < c.sql.length,
      };
    }
    if (op === "console.update") {
      if (
        p.sql !== undefined &&
        (typeof p.sql !== "string" || Buffer.byteLength(p.sql) > 2 * 1024 ** 2)
      )
        throw new Error("SQL слишком большой");
      if (p.revision !== c.revision && typeof p.sql === "string") {
        await this.store.update((s) => {
          s.recoveries ??= [];
          if (s.recoveries.some((r) => r.consoleId === c.id && r.sql === p.sql))
            return;
          if (s.recoveries.length >= 40)
            throw new Error(
              "Хранилище конфликтных черновиков заполнено. Сохраните копию SQL перед закрытием вкладки.",
            );
          s.recoveries.push({
            id: randomUUID(),
            consoleId: c.id,
            projectId: c.projectId,
            connectionId: c.connectionId,
            targetHash: c.targetHash,
            title: c.title,
            sql: p.sql,
            revision: p.revision,
            at: new Date().toISOString(),
          });
        });
        this.options.changed(p.projectId);
        throw new Error(
          "Консоль изменена в другом окне. Ваш SQL сохранён в восстановлении; чужой текст не перезаписан.",
        );
      }
      await this.store.update((s) => {
        const d = s.consoles.find((x) => x.id === c.id)!;
        if (p.revision !== d.revision)
          throw new Error(
            "Консоль изменена в другом окне. Обновите состояние; ваш текст не перезаписан.",
          );
        if (p.sql !== undefined) {
          if (
            typeof p.sql !== "string" ||
            Buffer.byteLength(p.sql) > 2 * 1024 ** 2
          )
            throw new Error("SQL слишком большой");
          d.sql = p.sql;
        }
        if (p.title !== undefined) d.title = String(p.title).slice(0, 120);
        if (p.schema !== undefined) d.schema = String(p.schema);
        if (p.closed !== undefined) d.closed = !!p.closed;
        d.revision++;
        d.updatedAt = new Date().toISOString();
      });
      this.options.changed(p.projectId);
      return this.console(c.id, p.projectId);
    }
    if (op === "console.open") {
      if (c.targetHash !== this.connection(c.connectionId).targetHash)
        throw new Error(
          "Адрес или параметры подключения изменились. Этот документ относится к прежнему серверу; создайте новую консоль или копию SQL для нового подключения.",
        );
      if (c.leaseId) {
        const l = this.leases.get(c.leaseId);
        if (l && l.transaction !== "unknown") return l;
        throw new Error(
          "Старая сессия потеряна. Выполните Disconnect перед новым подключением.",
        );
      }
      const existing = this.pending.get(c.id);
      if (existing) return existing;
      const opening = (async () => {
        const client = await this.client(c.connectionId),
          connection = this.connection(c.connectionId, p.projectId);
        const l: DatabaseLease = await client.call("open", {
          connection,
          password: this.secret(connection.id),
          consoleId: c.id,
          projectId: p.projectId,
        });
        try {
          if (c.mode === "manual")
            await client.call("transaction", {
              leaseId: l.id,
              action: "mode",
              mode: "manual",
            });
          await this.store.update((s) => {
            const d = s.consoles.find((x) => x.id === c.id);
            if (!d) throw new Error("Консоль удалена");
            d.leaseId = l.id;
          });
          this.leases.set(l.id, { ...l, mode: c.mode });
          this.options.changed(p.projectId);
          return l;
        } catch (e) {
          await client.call("close", { leaseId: l.id }).catch(() => {});
          throw e;
        }
      })();
      this.pending.set(c.id, opening);
      try {
        return await opening;
      } finally {
        this.pending.delete(c.id);
      }
    }
    const client = await this.client(c.connectionId);
    if (op === "console.disconnect") {
      if (c.leaseId) {
        const l = this.leases.get(c.leaseId);
        try {
          await client.call("close", { leaseId: c.leaseId });
        } catch (e) {
          if (l?.transaction !== "unknown") throw e;
        }
        this.leases.delete(c.leaseId);
      }
      await this.store.update((s) => {
        s.consoles.find((x) => x.id === c.id)!.leaseId = undefined;
      });
      this.options.changed(p.projectId);
      return { closed: true };
    }
    if (op === "console.remove") {
      if (c.leaseId) throw new Error("Сначала Disconnect");
      if (c.pendingEffect)
        throw new Error("Сначала сверка неизвестного исхода записи");
      await this.store.update((s) => {
        s.consoles = s.consoles.filter((x) => x.id !== c.id);
      });
      this.options.changed(p.projectId);
      return { removed: true };
    }
    if (!c.leaseId && !["page", "dropResult", "metrics"].includes(op))
      throw new Error("Сначала подключите консоль");
    if (
      ![
        "execute",
        "cancel",
        "page",
        "dropResult",
        "catalog",
        "describe",
        "transaction",
        "table",
        "changes",
        "routineApply",
        "admin",
        "import",
        "export",
        "metrics",
      ].includes(op)
    )
      throw new Error("Операция БД недоступна");
    const args = { ...p, leaseId: c.leaseId, consoleId: c.id };
    delete args.projectId;
    if (
      ["page", "dropResult", "export"].includes(op) &&
      ![...this.jobs.values()].some(
        (j) =>
          j.consoleId === c.id && j.results.some((r) => r.id === p.resultId),
      )
    )
      throw new Error("Результат принадлежит другой консоли");
    if (agent && op === "page") args.limit = Math.min(50, p.limit || 50);
    if (c.pendingEffect && ["changes", "routineApply", "import"].includes(op))
      throw new Error(
        "Есть несверенная запись. Сначала проверьте данные; повтор заблокирован.",
      );
    let result: any;
    if (op === "changes") {
      if (
        typeof p.operationId !== "string" ||
        !p.operationId ||
        p.operationId.length > 128 ||
        !Array.isArray(p.changes) ||
        !p.changes.length ||
        p.changes.length > 1000
      )
        throw new Error("Нужны operationId и changeset из 1–1000 строк");
      const intent = {
        leaseId: c.leaseId,
        consoleId: c.id,
        oid: p.oid,
        changes: p.changes,
        operationId: p.operationId,
      };
      const pending: NonNullable<DatabaseConsole["pendingEffect"]> = {
        operationId: p.operationId,
        kind: "changes",
        phase: "submitting",
        at: new Date().toISOString(),
        requestHash: createHash("sha256")
          .update(JSON.stringify(intent))
          .digest("hex"),
        intent,
      };
      await this.store.update((s) => {
        s.consoles.find((d) => d.id === c.id)!.pendingEffect = pending;
      });
      this.options.changed(p.projectId);
      try {
        result = await client.call("changes", intent);
        await this.store.update((s) => {
          const d = s.consoles.find((d) => d.id === c.id)!;
          if (d.pendingEffect?.operationId === p.operationId)
            d.pendingEffect = undefined;
        });
      } catch (error: any) {
        await this.store.update((s) => {
          const d = s.consoles.find((d) => d.id === c.id)!;
          if (error.outcome === "notApplied") d.pendingEffect = undefined;
          else if (d.pendingEffect) {
            d.pendingEffect.phase = "unknown";
            d.pendingEffect.reason = String(error.message).slice(0, 2000);
          }
        });
        this.options.changed(p.projectId);
        throw error;
      }
    } else result = await client.call(op as DatabaseOperation, args);
    if (agent && op === "page") {
      const fields = result.fields.slice(0, 200),
        values: unknown[][] = [],
        truncatedCells: { row: number; column: number; length: number }[] = [];
      let budget = 32768;
      for (let ri = 0; ri < result.values.length && budget > 0; ri++) {
        const row = [];
        for (let ci = 0; ci < fields.length && budget > 0; ci++) {
          const value = result.values[ri][ci];
          if (typeof value === "string") {
            const take = Math.max(0, Math.min(4096, budget, value.length));
            row.push(value.slice(0, take));
            budget -= take + 8;
            if (take < value.length)
              truncatedCells.push({
                row: result.offset + ri,
                column: ci,
                length: value.length,
              });
          } else {
            row.push(value);
            budget -= 16;
          }
        }
        values.push(row);
      }
      return {
        ...result,
        fields,
        fieldTotal: result.fields.length,
        values,
        truncatedCells,
        partialPage:
          values.length < result.values.length ||
          values.some((v) => v.length < result.fields.length) ||
          truncatedCells.length > 0,
        notice:
          "Agent preview is bounded to 32 Ki characters/200 columns. Truncated cells are previews; never write them back as complete values.",
      };
    }
    if (
      op === "execute" ||
      op === "table" ||
      op === "import" ||
      op === "export"
    ) {
      this.jobs.set(result.id, result);
    }
    if (op === "transaction") {
      this.leases.set(result.id, result);
      if (p.action === "mode")
        await this.store.update((s) => {
          s.consoles.find((x) => x.id === c.id)!.mode = p.mode;
        });
    }
    this.options.changed(p.projectId);
    return result;
  }
  async dispose() {
    await Promise.allSettled(
      [...this.clients.values()].map(async (p) => (await p).close()),
    );
    await this.store.close();
  }
}
