import { readDatabaseRelations } from "./relations";
import pg, { type ClientConfig } from "pg";
import { SafeQueryStream as QueryStream } from "./query-stream";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import {
  countingStream,
  decodedFile,
  readXlsx,
  csvCell,
  writeRows,
} from "./files";
import { sqlFile, sqlKeyword } from "./sql-file";
import { wireLimit } from "./wire-limit";
import { trustedCAs } from "./tls";
import { statements, identifier, qualified, literal } from "../../shared/sql";
import type {
  DatabaseChange,
  DatabaseConnection,
  DatabaseJob,
  DatabaseLease,
  DatabaseResult,
} from "../../shared/database";

const MAX_SQL = 2 * 1024 * 1024,
  QUOTA = 2 * 1024 ** 3,
  MAX_CELL = 16 * 1024 ** 2;
const textTypes = {
  getTypeParser: (_oid: number, format?: string) =>
    format === "binary" ? (v: Buffer) => v.toString("hex") : (v: string) => v,
};
type Lease = {
  info: DatabaseLease;
  client: pg.Client;
  config: ClientConfig;
  pid: number;
  job?: DatabaseJob;
  cancelled?: boolean;
  cancelling?: boolean;
  abort?: AbortController;
  phase?: "query" | "copy" | "file" | "control";
};
type Receipt = {
  hash: string;
  value?: unknown;
  error?: string;
  status: "pending" | "done" | "failed";
};
export class DatabaseEngine {
  private leases = new Map<string, Lease>();
  private jobs = new Map<string, DatabaseJob>();
  private receipts = new Map<string, Receipt>();
  private receiptBytes = new Map<string, number>();
  private db!: DatabaseSync;
  private bytes = 0;
  private tasks = new Set<Promise<void>>();
  private pinnedResults = new Map<string, Set<string>>();
  private memoryTimer?: ReturnType<typeof setInterval>;
  private peakHeap = 0;
  private peakRss = 0;
  private spawn(task: Promise<void>) {
    const safe = task.catch(() => {});
    this.tasks.add(safe);
    void safe.finally(() => this.tasks.delete(safe));
  }
  constructor(readonly directory: string) {}
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(this.directory, "results.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS rows(result TEXT, n INTEGER, body TEXT, PRIMARY KEY(result,n)); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, body TEXT); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, body TEXT); CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,job TEXT,body TEXT)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,console TEXT,at TEXT,kind TEXT,body TEXT);CREATE INDEX IF NOT EXISTS intents_console ON intents(console)",
    );
    await fs.chmod(path.join(this.directory, "results.sqlite"), 0o600);
    for (const r of this.db
      .prepare("SELECT id, body FROM receipts ORDER BY rowid DESC LIMIT 1000")
      .iterate())
      this.cacheReceipt(String(r.id), String(r.body));
    for (const r of this.db
      .prepare("SELECT id, body FROM jobs ORDER BY rowid DESC LIMIT 200")
      .all()
      .reverse()) {
      const j: DatabaseJob = JSON.parse(String(r.body));
      if (j.status === "running") j.status = "unknown";
      this.jobs.set(j.id, j);
      this.save(j);
    }
    this.bytes = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) n FROM rows",
        )
        .get()?.n || 0,
    );
    this.memoryTimer = setInterval(() => {
      if (this.tasks.size) {
        const m = process.memoryUsage();
        this.peakHeap = Math.max(this.peakHeap, m.heapUsed);
        this.peakRss = Math.max(this.peakRss, m.rss);
      }
    }, 100);
    this.memoryTimer.unref();
  }
  metrics() {
    return {
      process: process.memoryUsage(),
      sampledPeak: {
        heapUsed: this.peakHeap,
        rss: this.peakRss,
        intervalMs: 100,
      },
      activeJobs: this.tasks.size,
      physicalSessions: this.leases.size,
      spoolBytes: this.bytes,
      limits: {
        spoolBytes: QUOTA,
        wireMessageBytes: 8 * 1024 ** 2,
        concurrentJobs: 4,
        physicalSessions: 32,
      },
    };
  }
  private receipt(id: string, r: Receipt) {
    const body = JSON.stringify(r);
    this.cacheReceipt(id, body);
    this.db
      .prepare("INSERT OR REPLACE INTO receipts VALUES(?,?)")
      .run(id, body);
  }
  private cacheReceipt(id: string, body: string) {
    // Do not retain a reference to the growing live job's result array.
    this.receipts.set(id, JSON.parse(body));
    this.receiptBytes.set(id, Buffer.byteLength(body));
    let size = [...this.receiptBytes.values()].reduce((a, b) => a + b, 0);
    while (this.receipts.size > 1000 || size > 8 * 1024 ** 2) {
      const key = this.receipts.keys().next().value!;
      size -= this.receiptBytes.get(key) || 0;
      this.receipts.delete(key);
      this.receiptBytes.delete(key);
    }
  }
  private save(job: DatabaseJob) {
    this.db
      .prepare("INSERT OR REPLACE INTO jobs VALUES(?,?)")
      .run(job.id, JSON.stringify(job));
    for (const r of job.results)
      this.db
        .prepare("INSERT OR REPLACE INTO results VALUES(?,?,?)")
        .run(r.id, job.id, JSON.stringify(r));
    if (this.jobs.size > 200) {
      const oldest = [...this.jobs.values()].find(
        (j) => j.status !== "running",
      );
      if (oldest) this.jobs.delete(oldest.id);
    }
  }
  private result(id: string): DatabaseResult | undefined {
    const recent = [...this.jobs.values()]
      .flatMap((j) => j.results)
      .find((r) => r.id === id);
    if (recent) return recent;
    const r = this.db.prepare("SELECT body FROM results WHERE id=?").get(id);
    return r ? JSON.parse(String(r.body)) : undefined;
  }
  private lease(id: string): Lease {
    const l = this.leases.get(id);
    if (!l)
      throw new Error(
        "Сессия БД потеряна. Откройте новую; запросы автоматически не повторяются.",
      );
    return l;
  }
  private available(id: string) {
    const l = this.lease(id);
    if (l.info.busy || l.cancelling)
      throw new Error("В этой консоли выполняется операция");
    if (l.info.transaction === "unknown")
      throw new Error(
        "Состояние сессии неизвестно; требуется новое подключение",
      );
    return l;
  }
  private async commit(l: Lease) {
    const r = await l.client.query("COMMIT");
    if (r.command !== "COMMIT")
      throw Object.assign(
        new Error(
          "Сервер вернул ROLLBACK вместо COMMIT. Изменения не подтверждены.",
        ),
        { code: "WB_COMMIT_ROLLED_BACK" },
      );
  }
  async open(
    connection: DatabaseConnection,
    password?: string,
  ): Promise<DatabaseLease> {
    if (this.leases.size >= 32)
      throw new Error(
        "Лимит 32 физических сессии на подключение. Отключите неиспользуемые консоли.",
      );
    const config: ClientConfig = {
      host: connection.host || "localhost",
      port: connection.port || 5432,
      database: connection.database,
      user: connection.user,
      password,
      application_name: "GigaCode Workbench",
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      ssl: connection.ssl
        ? { rejectUnauthorized: true, ca: trustedCAs(connection.ca) }
        : false,
      types: textTypes,
    };
    const client = new pg.Client(config);
    const info: DatabaseLease = {
      id: randomUUID(),
      connectionId: connection.id,
      database: "",
      user: "",
      server: "",
      transaction: "idle",
      mode: "auto",
      readOnly: connection.readOnly,
      busy: false,
      generation: randomUUID(),
    };
    const lease: Lease = { info, client, config, pid: 0 };
    client.on("error", (error: any) => {
      info.transaction = "unknown";
      if (lease.job?.status === "running") {
        lease.job.status = "unknown";
        lease.job.error = {
          message: String(error.message).slice(0, 4000),
          code: error.code,
        };
        this.save(lease.job);
      }
    });
    // pg 8 protocol field; pinned dependency + live I/T/E regression tests protect it.
    (client as any).connection.on("readyForQuery", (m: { status: string }) => {
      if ((client as any)._queryable === false) return;
      info.transaction =
        m.status === "I"
          ? "idle"
          : m.status === "T"
            ? "active"
            : m.status === "E"
              ? "failed"
              : "unknown";
    });
    try {
      await client.connect();
      wireLimit((client as any).connection.stream);
      await client.query(
        "SET statement_timeout='60s'; SET idle_in_transaction_session_timeout='15min'; SET standard_conforming_strings=on",
      );
      if (info.readOnly)
        await client.query("SET default_transaction_read_only=on");
      const r = await client.query(
        "SELECT current_database() db, current_user usr, version() version, pg_backend_pid() pid",
      );
      Object.assign(info, {
        database: r.rows[0].db,
        user: r.rows[0].usr,
        server: r.rows[0].version,
      });
      lease.pid = Number(r.rows[0].pid);
      this.leases.set(info.id, lease);
      return { ...info };
    } catch (e) {
      await client.end().catch(() => {});
      throw e;
    }
  }
  async close(id: string) {
    const l = this.lease(id);
    if (l.info.busy || l.cancelling)
      throw new Error("Сначала отмените выполняющуюся операцию");
    if (l.info.transaction === "unknown") {
      await l.client.end().catch(() => {});
      this.leases.delete(id);
      return { closed: true, transactionOutcome: "unknown" };
    }
    if (l.info.transaction !== "idle") await l.client.query("ROLLBACK");
    await l.client.end();
    this.leases.delete(id);
    return { closed: true };
  }
  status() {
    return {
      leases: [...this.leases.values()].map((l) => ({
        ...l.info,
        busy: l.info.busy || !!l.cancelling,
      })),
      jobs: [...this.jobs.values()].slice(-200),
    };
  }
  async transaction(
    id: string,
    action: string,
    mode?: "auto" | "manual",
    name?: string,
    operationId?: string,
    consoleId?: string,
  ) {
    if (action === "commit")
      return this.once(
        operationId || randomUUID(),
        { leaseId: id, consoleId, action },
        () => this.transactionActual(id, action, mode, name),
      )
        .then((value) =>
          this.leases.has(id)
            ? { ...this.leases.get(id)!.info, busy: false }
            : value,
        )
        .catch((error: any) => {
          if (!error.outcome) error.outcome = "notApplied";
          throw error;
        });
    return this.transactionActual(id, action, mode, name);
  }
  private async transactionActual(
    id: string,
    action: string,
    mode?: "auto" | "manual",
    name?: string,
  ) {
    const l = this.available(id);
    l.info.busy = true;
    try {
      if (action === "mode") {
        if (l.info.transaction !== "idle")
          throw new Error("Сначала Commit или Rollback");
        if (!["auto", "manual"].includes(mode || ""))
          throw new Error("Неверный режим");
        l.info.mode = mode!;
      } else if (action === "begin")
        await l.client.query("BEGIN" + (l.info.readOnly ? " READ ONLY" : ""));
      else if (action === "commit") await this.commit(l);
      else if (action === "rollback") await l.client.query("ROLLBACK");
      else if (action === "savepoint")
        await l.client.query("SAVEPOINT " + identifier(name || "workbench"));
      else if (action === "rollbackTo")
        await l.client.query(
          "ROLLBACK TO SAVEPOINT " + identifier(name || "workbench"),
        );
      else throw new Error("Неизвестное действие транзакции");
      return { ...l.info, busy: false };
    } catch (error: any) {
      error.outcome =
        l.info.transaction === "unknown" ? "unknown" : "notApplied";
      throw error;
    } finally {
      l.info.busy = false;
    }
  }
  /** Receipt is synced before submission. A pending receipt is never replayed after a crash. */
  private async once<T>(
    operationId: string,
    request: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    if (!operationId || operationId.length > 128)
      throw new Error("Нужен уникальный operationId");
    const captured = JSON.stringify(request);
    if (Buffer.byteLength(captured) > 8 * 1024 ** 2)
      throw new Error(
        "Операция превышает 8 MiB. Разделите её на проверяемые порции.",
      );
    const hash = createHash("sha256").update(captured).digest("hex");
    const stored = this.db
      .prepare("SELECT body FROM receipts WHERE id=?")
      .get(operationId);
    const previous: Receipt | undefined =
      this.receipts.get(operationId) ||
      (stored ? JSON.parse(String(stored.body)) : undefined);
    if (previous) {
      if (previous.hash !== hash)
        throw new Error("operationId уже использован для другой операции");
      if (previous.status === "pending")
        throw Object.assign(
          new Error(
            "Исход предыдущей операции неизвестен. Автоматический повтор запрещён.",
          ),
          { code: "WB_OPERATION_PENDING", outcome: "unknown" },
        );
      if (previous.status === "failed")
        throw new Error(previous.error || "Операция завершилась ошибкой");
      const recorded = previous.value as any;
      if (recorded?.id && recorded?.operationId === operationId) {
        const row = this.db
          .prepare("SELECT body FROM jobs WHERE id=?")
          .get(recorded.id);
        const current: DatabaseJob | undefined =
          this.jobs.get(recorded.id) ||
          (row ? JSON.parse(String(row.body)) : undefined);
        if (current) {
          if (
            current.status === "running" &&
            ![...this.leases.values()].some((l) => l.job?.id === current.id)
          ) {
            current.status = "unknown";
            this.save(current);
          }
          return current as T;
        }
      }
      return previous.value as T;
    }
    const input = request as Record<string, any>;
    this.db
      .prepare("INSERT INTO intents VALUES(?,?,?,?,?)")
      .run(
        operationId,
        String(input.consoleId || ""),
        new Date().toISOString(),
        input.action
          ? "transaction"
          : input.sql
            ? "query"
            : input.changes
              ? "changes"
              : "file",
        captured,
      );
    this.receipt(operationId, { hash, status: "pending" });
    try {
      const value = await execute();
      this.receipt(operationId, { hash, status: "done", value });
      return value;
    } catch (e: any) {
      this.receipt(operationId, {
        hash,
        status: e.outcome === "unknown" ? "pending" : "failed",
        error: e.message,
      });
      throw e;
    }
  }
  async execute(p: {
    leaseId: string;
    consoleId: string;
    sql: string;
    params?: unknown[];
    operationId: string;
    limit?: number;
    source?: DatabaseResult["source"];
    routineTarget?: { oid: string; originalHash: string };
  }) {
    if (typeof p.sql !== "string" || Buffer.byteLength(p.sql) > MAX_SQL)
      throw new Error("SQL превышает 2 MiB; используйте потоковый импорт SQL");
    const parts = statements(p.sql);
    if (!parts.length) throw new Error("Пустой запрос");
    if (parts.length > 1000 || (parts.length > 1 && p.params?.length))
      throw new Error(
        "Параметры поддерживаются для одного statement; максимум 1000 statement в консоли",
      );
    if (Buffer.byteLength(JSON.stringify(p.params || [])) > MAX_SQL)
      throw new Error("Параметры SQL превышают 2 MiB");
    return this.once(p.operationId, p, async () => {
      const l = this.available(p.leaseId);
      if (this.tasks.size >= 4)
        throw new Error(
          "Выполняются четыре операции БД. Дождитесь завершения или отмените ненужную.",
        );
      l.info.busy = true;
      l.cancelled = false;
      const id = randomUUID(),
        queries = path.join(this.directory, "queries"),
        sqlPath = path.join(queries, id + ".sql"),
        requestPath = path.join(queries, id + ".request.json"),
        sqlHash = createHash("sha256").update(p.sql).digest("hex"),
        capturedAt = new Date().toISOString(),
        captured = JSON.stringify(
          {
            version: 1,
            operationId: p.operationId,
            consoleId: p.consoleId,
            connectionId: l.info.connectionId,
            database: l.info.database,
            user: l.info.user,
            server: l.info.server,
            mode: l.info.mode,
            readOnly: l.info.readOnly,
            params: p.params || [],
            source: p.source,
            routineTarget: p.routineTarget,
            sqlHash,
            capturedAt,
          },
          null,
          2,
        );
      try {
        await fs.mkdir(queries, { recursive: true, mode: 0o700 });
        await fs.writeFile(sqlPath, p.sql, { mode: 0o600, flag: "wx" });
        await fs.writeFile(requestPath, captured, { mode: 0o600, flag: "wx" });
      } catch (e) {
        l.info.busy = false;
        throw e;
      }
      if (l.info.transaction === "unknown") {
        l.info.busy = false;
        throw new Error(
          "Сессия потеряна до отправки SQL; запрос не был отправлен.",
        );
      }
      const job: DatabaseJob = {
        id,
        operationId: p.operationId,
        consoleId: p.consoleId,
        status: "running",
        kind: "query",
        results: [],
        rows: 0,
        bytes: 0,
        startedAt: capturedAt,
        sql: p.sql.slice(0, 8192),
        sqlPath,
        sqlHash,
        requestPath,
        requestHash: createHash("sha256").update(captured).digest("hex"),
      };
      l.info.busy = true;
      l.job = job;
      this.jobs.set(job.id, job);
      this.save(job);
      this.spawn(
        this.run(
          l,
          job,
          parts.map((s) => s.text),
          p.params || [],
          Math.max(1, Math.min(10_000_000, p.limit || 100000)),
          p.source,
          parts.map((s) => s.start),
          p.routineTarget,
        ),
      );
      return { ...job };
    });
  }
  private async run(
    l: Lease,
    job: DatabaseJob,
    parts: string[],
    params: unknown[],
    limit: number,
    source?: DatabaseResult["source"],
    starts: number[] = [],
    routineTarget?: { oid: string; originalHash: string },
  ) {
    let statementIndex = 0;
    const ownRoutineTransaction =
      !!routineTarget &&
      l.info.transaction === "idle" &&
      l.info.mode === "auto";
    let routineSavepoint = false;
    try {
      if (l.cancelled)
        throw Object.assign(new Error("Отменено до отправки SQL"), {
          code: "57014",
        });
      if (
        (l.info.mode === "manual" || routineTarget) &&
        l.info.transaction === "idle"
      )
        await l.client.query("BEGIN" + (l.info.readOnly ? " READ ONLY" : ""));
      if (routineTarget) {
        await l.client.query("SAVEPOINT wb_routine");
        routineSavepoint = true;
        const source = await l.client.query(
          "SELECT pg_get_functiondef($1::oid) ddl",
          [routineTarget.oid],
        );
        if (
          createHash("sha256").update(source.rows[0].ddl).digest("hex") !==
          routineTarget.originalHash
        )
          throw new Error(
            "Определение изменилось перед применением. Обновите серверную версию.",
          );
      }
      for (const sql of parts) {
        statementIndex++;
        if (l.cancelled)
          throw Object.assign(new Error("Отменено"), { code: "57014" });
        const began = Date.now();
        const result: DatabaseResult = {
          id: randomUUID(),
          fields: [],
          rows: 0,
          bytes: 0,
          command: "",
          elapsedMs: 0,
          source,
        };
        job.results.push(result);
        const stream = l.client.query(
          new QueryStream(sql, params, {
            batchSize: 8,
            rowMode: "array",
            types: textTypes,
          }),
        );
        l.phase = "query";
        let batch: string[] = [],
          batchBytes = 0;
        const insert = this.db.prepare("INSERT INTO rows VALUES(?,?,?)");
        const flush = () => {
          this.db.exec("BEGIN");
          try {
            for (const body of batch)
              insert.run(result.id, result.rows++, body);
            // Rows + progress are one durable SQLite commit. Separate FULL
            // fsyncs per metadata row make small-row streams very slow on Windows.
            this.save(job);
            this.db.exec("COMMIT");
          } catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
          }
          batch = [];
          batchBytes = 0;
        };
        try {
          for await (const row of stream) {
            const body = JSON.stringify(row),
              size = Buffer.byteLength(body);
            if (size > MAX_CELL || this.bytes + size > QUOTA)
              throw new Error(
                "Лимит результата: строка 16 MiB, локальное хранилище 2 GiB. Освободите результаты или экспортируйте меньший диапазон.",
              );
            if (result.rows + batch.length >= limit) {
              result.truncated = true;
              stream.destroy();
              break;
            }
            batch.push(body);
            batchBytes += size;
            result.bytes += size;
            this.bytes += size;
            job.rows++;
            job.bytes += size;
            if (batch.length >= 1024 || batchBytes >= 1024 ** 2) {
              flush();
              await new Promise<void>((r) => setImmediate(r));
            }
          }
        } finally {
          if (!stream.destroyed) stream.destroy();
          // Fields belong to partial results too: cancellation or a later server
          // error must not turn captured rows into an untyped result.
          const meta = (stream as any)._result;
          result.fields = (meta?.fields || []).map((f: any) => ({
            name: f.name,
            typeId: f.dataTypeID,
            tableId: f.tableID,
            columnId: f.columnID,
          }));
          result.command = meta?.command || "";
          result.elapsedMs = Date.now() - began;
          if (batch.length) flush();
        }
        this.save(job);
      }
      if (routineTarget) {
        l.phase = "control";
        const source = await l.client.query(
          "SELECT pg_get_functiondef($1::oid) ddl",
          [routineTarget.oid],
        );
        const appliedHash = createHash("sha256")
          .update(source.rows[0].ddl)
          .digest("hex");
        if (appliedHash === routineTarget.originalHash)
          throw new Error(
            "Целевой объект не изменился; операция отменена. Проверьте имя/сигнатуру. Для нового объекта используйте SQL-консоль.",
          );
        job.routine = {
          oid: routineTarget.oid,
          previousHash: routineTarget.originalHash,
          appliedHash,
          committed: false,
        };
        await l.client.query("RELEASE SAVEPOINT wb_routine");
        routineSavepoint = false;
        if (ownRoutineTransaction) {
          await this.commit(l);
          job.routine.committed = true;
        }
      }
      job.status = "completed";
    } catch (e: any) {
      if (routineTarget && l.info.transaction !== "unknown") {
        l.phase = "control";
        if (routineSavepoint)
          await l.client
            .query("ROLLBACK TO SAVEPOINT wb_routine")
            .catch(() => {});
        if (ownRoutineTransaction)
          await l.client.query("ROLLBACK").catch(() => {});
      }
      if (job.status !== "unknown")
        job.status = e.code === "57014" && l.cancelled ? "cancelled" : "failed";
      if (!job.error || job.status !== "unknown")
        job.error = {
          message: String(e.message).slice(0, 4000),
          code: e.code,
          position: e.position ? Number(e.position) : undefined,
          statementOffset: starts[Math.max(0, statementIndex - 1)] || 0,
        };
    } finally {
      job.finishedAt = new Date().toISOString();
      l.info.busy = false;
      l.job = undefined;
      l.phase = undefined;
      this.save(job);
    }
  }
  async cancel(id: string) {
    const l = this.lease(id);
    if (!l.info.busy) return { requested: false };
    if (l.cancelling) return { requested: true };
    const jobId = l.job?.id;
    l.cancelling = true;
    l.cancelled = true;
    l.abort?.abort();
    const cancel = new pg.Client({ ...l.config, statement_timeout: 10000 });
    try {
      await cancel.connect();
      if (
        l.job?.id !== jobId ||
        !l.info.busy ||
        (l.abort && l.phase !== "query")
      )
        return { requested: !!l.abort };
      const r = await cancel.query("SELECT pg_cancel_backend($1) cancelled", [
        l.pid,
      ]);
      return { requested: [true, "t", "true"].includes(r.rows[0].cancelled) };
    } finally {
      await cancel.end().catch(() => {});
      l.cancelling = false;
    }
  }
  page(resultId: string, offset = 0, limit = 200) {
    const result = this.result(resultId);
    if (!result) throw new Error("Результат не найден");
    offset = Math.max(0, Math.floor(offset));
    limit = Math.max(1, Math.min(500, Math.floor(limit)));
    const indices = this.db
      .prepare(
        "SELECT n,length(CAST(body AS BLOB)) bytes FROM rows WHERE result=? AND n>=? ORDER BY n LIMIT ?",
      )
      .all(resultId, offset, limit);
    // Check bytes in SQLite before materializing any potentially large values.
    if (indices.reduce((n, r) => n + Number(r.bytes) + 1, 2) > 3 * 1024 ** 2)
      throw new Error(
        "Страница превышает 3 MiB; уменьшите размер страницы. Для большой ячейки используйте substring или потоковый экспорт.",
      );
    const get = this.db.prepare("SELECT body FROM rows WHERE result=? AND n=?");
    const rows = indices.map((r) =>
      JSON.parse(String(get.get(resultId, r.n)!.body)),
    );
    return { ...result, offset, values: rows };
  }
  async jobRead(p: {
    jobId: string;
    part?: "sql" | "request";
    offset?: number;
    limit?: number;
  }) {
    const row = this.db
      .prepare("SELECT body FROM jobs WHERE id=?")
      .get(p.jobId);
    if (!row) throw new Error("Операция не найдена");
    const job: DatabaseJob = JSON.parse(String(row.body));
    const request = p.part === "request",
      file = request ? job.requestPath : job.sqlPath;
    if (
      !file ||
      path.dirname(file) !== path.join(this.directory, "queries") ||
      path.basename(file) !== job.id + (request ? ".request.json" : ".sql")
    )
      throw new Error("Для этой операции сохранённого текста нет");
    const body = await fs.readFile(file, "utf8"),
      hash = createHash("sha256").update(body).digest("hex");
    if (hash !== (request ? job.requestHash : job.sqlHash))
      throw new Error("Сохранённый запрос изменён на диске; хеш не совпадает");
    const offset = Math.max(0, Math.floor(p.offset || 0)),
      limit = Math.min(32768, Math.max(1, Math.floor(p.limit || 8192)));
    return {
      jobId: job.id,
      part: request ? "request" : "sql",
      text: body.slice(offset, offset + limit),
      offset,
      offsetUnit: "utf16",
      total: body.length,
      truncated: offset + limit < body.length,
      hash,
    };
  }
  operationList(p: { consoleId: string; offset?: number; limit?: number }) {
    const offset = Math.max(0, Math.floor(p.offset || 0)),
      limit = Math.min(50, Math.max(1, Math.floor(p.limit || 20)));
    const rows = this.db
      .prepare(
        "SELECT i.id operationId,i.at,i.kind,json_extract(r.body,'$.status') receiptStatus,json_extract(r.body,'$.hash') hash,json_extract(r.body,'$.value.id') jobId,json_extract(j.body,'$.status') jobStatus FROM intents i LEFT JOIN receipts r ON r.id=i.id LEFT JOIN jobs j ON j.id=json_extract(r.body,'$.value.id') WHERE i.console=? ORDER BY i.rowid DESC LIMIT ? OFFSET ?",
      )
      .all(p.consoleId, limit + 1, offset);
    return {
      operations: rows.slice(0, limit),
      offset,
      hasMore: rows.length > limit,
    };
  }
  operationRead(p: {
    consoleId: string;
    operationId: string;
    offset?: number;
    limit?: number;
  }) {
    const row = this.db
      .prepare(
        "SELECT i.body,json_extract(r.body,'$.status') status,json_extract(r.body,'$.hash') hash FROM intents i LEFT JOIN receipts r ON r.id=i.id WHERE i.id=? AND i.console=?",
      )
      .get(p.operationId, p.consoleId);
    if (!row)
      throw new Error(
        "Операция другой консоли или исходный payload не сохранён",
      );
    const text = String(row.body),
      hash = createHash("sha256").update(text).digest("hex");
    if (row.hash && hash !== row.hash)
      throw new Error("Хеш исходной операции не совпадает");
    const offset = Math.max(0, Math.floor(p.offset || 0)),
      limit = Math.min(32768, Math.max(1, Math.floor(p.limit || 8192)));
    return {
      consoleId: p.consoleId,
      operationId: p.operationId,
      text: text.slice(offset, offset + limit),
      hash,
      receiptStatus: row.status,
      offset,
      total: text.length,
      truncated: offset + limit < text.length,
    };
  }
  dropResult(id: string) {
    if (this.pinnedResults.get(id)?.size)
      throw new Error(
        "Результат используется экспортом; дождитесь его завершения",
      );
    if (
      [...this.leases.values()].some((l) =>
        l.job?.results.some((r) => r.id === id),
      )
    )
      throw new Error("Результат ещё записывается");
    const size = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) n FROM rows WHERE result=?",
        )
        .get(id)?.n || 0,
    );
    const owner = this.db.prepare("SELECT job FROM results WHERE id=?").get(id);
    this.db.prepare("DELETE FROM rows WHERE result=?").run(id);
    this.bytes -= size;
    this.db.prepare("DELETE FROM results WHERE id=?").run(id);
    if (owner) {
      const cached = this.jobs.get(String(owner.job)),
        stored = this.db
          .prepare("SELECT body FROM jobs WHERE id=?")
          .get(String(owner.job));
      const job: DatabaseJob | undefined =
        cached || (stored ? JSON.parse(String(stored.body)) : undefined);
      if (job) {
        job.results = job.results.filter((r) => r.id !== id);
        this.save(job);
      }
    }
    return { deleted: true };
  }
  async catalog(
    id: string,
    schema?: string,
    options: {
      schemas?: string[];
      search?: string;
      offset?: number;
      limit?: number;
      includeSystem?: boolean;
    } = {},
  ) {
    const selected = options.schemas ?? (schema ? [schema] : []);
    if (
      !Array.isArray(selected) ||
      selected.length > 100 ||
      selected.some(
        (s) => typeof s !== "string" || !s || Buffer.byteLength(s) > 63,
      )
    )
      throw new Error("Выберите до 100 схем из каталога");
    const search = String(options.search || "").slice(0, 256),
      offset = Math.max(0, Math.floor(options.offset || 0)),
      limit = Math.min(500, Math.max(1, Math.floor(options.limit || 200)));
    // A fast query may finish between two UI snapshots. Catalog refresh waits;
    // it must not fail or preempt the query merely because the UI missed 'busy'.
    const deadline = Date.now() + 65000;
    while (
      (this.lease(id).info.busy || this.lease(id).cancelling) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 25));
    const l = this.available(id);
    l.info.busy = true;
    try {
      const schemas = await l.client.query(
        "SELECT nspname name FROM pg_namespace WHERE $1::boolean OR (nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema') ORDER BY nspname LIMIT 10000",
        [!!options.includeSystem],
      );
      if (!selected.length)
        return {
          schemas: schemas.rows,
          objects: [],
          offset,
          total: 0,
          hasMore: false,
        };
      const r = await l.client.query(
        `WITH objects AS (SELECT c.oid::text, n.nspname schema, c.relname name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'S' THEN 'sequence' WHEN 'f' THEN 'foreign table' END kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','S','f') UNION ALL SELECT p.oid::text,n.nspname,p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) AND p.prokind IN ('p','f','w')) SELECT *,count(*) OVER()::text AS total FROM objects WHERE strpos(lower(name),lower($2))>0 ORDER BY schema,kind,name,oid LIMIT $3 OFFSET $4`,
        [selected, search, limit + 1, offset],
      );
      return {
        schemas: schemas.rows,
        objects: r.rows.slice(0, limit).map(({ total, ...o }) => o),
        offset,
        total: Number(r.rows[0]?.total || 0),
        hasMore: r.rows.length > limit,
      };
    } finally {
      l.info.busy = false;
    }
  }
  async relations(id: string, oid: string) {
    const l = this.available(id);
    l.info.busy = true;
    try {
      return await readDatabaseRelations(l.client, oid);
    } finally {
      l.info.busy = false;
    }
  }
  async describe(id: string, oid: string, kind: string) {
    const l = this.available(id);
    l.info.busy = true;
    try {
      if (["function", "procedure"].includes(kind)) {
        const r = await l.client.query(
          "SELECT p.oid::text,n.nspname schema,p.proname name,pg_get_functiondef(p.oid) ddl,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result, obj_description(p.oid) comment FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=$1::oid",
          [oid],
        );
        if (!r.rows.length) throw new Error("Процедура больше не существует");
        return {
          ...r.rows[0],
          hash: createHash("sha256").update(r.rows[0].ddl).digest("hex"),
        };
      }
      const table = await l.client.query(
        "SELECT c.oid::text,n.nspname schema,c.relname name,c.relkind kind,obj_description(c.oid) comment FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::oid",
        [oid],
      );
      if (!table.rows.length) throw new Error("Объект больше не существует");
      const columns = await l.client.query(
        `SELECT a.attnum::text ordinal,a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull::text required,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid) default,col_description(a.attrelid,a.attnum) comment FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [oid],
      );
      const constraints = await l.client.query(
        "SELECT conname name,contype type,pg_get_constraintdef(oid,true) definition,confrelid::text target FROM pg_constraint WHERE conrelid=$1::oid ORDER BY conname",
        [oid],
      );
      const indexes = await l.client.query(
        "SELECT indexname name,indexdef definition FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname",
        [table.rows[0].schema, table.rows[0].name],
      );
      const triggers = await l.client.query(
        "SELECT tgname name,pg_get_triggerdef(oid,true) definition FROM pg_trigger WHERE tgrelid=$1::oid AND NOT tgisinternal",
        [oid],
      );
      const dependencies = await l.client.query(
        "SELECT DISTINCT pg_describe_object(d.classid,d.objid,d.objsubid) object,d.deptype type FROM pg_depend d WHERE d.refclassid='pg_class'::regclass AND d.refobjid=$1::oid LIMIT 1000",
        [oid],
      );
      const t = table.rows[0];
      let ddl = "";
      if (["v", "m"].includes(t.kind)) {
        const v = await l.client.query(
          "SELECT pg_get_viewdef($1::oid,true) ddl",
          [oid],
        );
        ddl = `CREATE ${t.kind === "m" ? "MATERIALIZED " : ""}VIEW ${qualified(t.schema, t.name)} AS\n${v.rows[0].ddl}`;
      } else if (["r", "p"].includes(t.kind)) {
        const definitions = columns.rows.map(
          (c) =>
            `  ${identifier(c.name)} ${c.type}${c.identity ? ` GENERATED ${c.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY` : c.generated ? ` GENERATED ALWAYS AS (${c.default}) STORED` : c.default ? " DEFAULT " + c.default : ""}${c.required === "true" ? " NOT NULL" : ""}`,
        );
        definitions.push(
          ...constraints.rows.map(
            (c) => `  CONSTRAINT ${identifier(c.name)} ${c.definition}`,
          ),
        );
        ddl = `CREATE TABLE ${qualified(t.schema, t.name)} (\n${definitions.join(",\n")}\n);\n${indexes.rows
          .filter((i) => !constraints.rows.some((c) => c.name === i.name))
          .map((i) => i.definition + ";")
          .join("\n")}`;
      }
      return {
        ...t,
        columns: columns.rows,
        constraints: constraints.rows,
        indexes: indexes.rows,
        triggers: triggers.rows,
        dependencies: dependencies.rows,
        ddl,
        ddlScope:
          "Columns, defaults, identities, generated columns, constraints and indexes. Storage, partitions, policies, ownership and grants require their catalog views; this is not a full backup.",
      };
    } finally {
      l.info.busy = false;
    }
  }
  async routineApply(p: {
    leaseId: string;
    consoleId: string;
    oid: string;
    originalHash: string;
    sql: string;
    operationId: string;
  }) {
    try {
      const old = await this.describe(p.leaseId, p.oid, "function");
      if (old.hash !== p.originalHash)
        throw new Error(
          "Определение изменено на сервере. Обновите и сравните версии.",
        );
      if (
        statements(p.sql).length !== 1 ||
        !/^\s*CREATE\s+OR\s+REPLACE\s+(FUNCTION|PROCEDURE)\b/i.test(p.sql)
      )
        throw new Error(
          "Редактор процедуры принимает один CREATE OR REPLACE FUNCTION/PROCEDURE",
        );
    } catch (error: any) {
      // This branch precedes execution; no routine DDL has been dispatched.
      error.outcome = "notApplied";
      throw error;
    }
    return this.execute({
      ...p,
      routineTarget: { oid: p.oid, originalHash: p.originalHash },
    });
  }
  async table(p: {
    leaseId: string;
    consoleId: string;
    oid: string;
    operationId: string;
    offset?: number;
    limit?: number;
    sort?: string;
    descending?: boolean;
    filter?: { column: string; operator: string; value?: string }[];
  }) {
    const t = await this.describe(p.leaseId, p.oid, "table"),
      names = new Set(t.columns.map((c: any) => c.name));
    const values: string[] = [],
      where: string[] = [];
    for (const f of p.filter || []) {
      if (!names.has(f.column)) throw new Error("Столбец не существует");
      if (["IS NULL", "IS NOT NULL"].includes(f.operator))
        where.push(`${identifier(f.column)} ${f.operator}`);
      else {
        if (
          !["=", "<>", ">", ">=", "<", "<=", "LIKE", "ILIKE"].includes(
            f.operator,
          )
        )
          throw new Error("Неверный оператор");
        values.push(f.value || "");
        where.push(`${identifier(f.column)} ${f.operator} $${values.length}`);
      }
    }
    if (p.sort && !names.has(p.sort))
      throw new Error("Столбец сортировки не существует");
    const editable = ["r", "p"].includes(t.kind);
    if (
      t.columns.some((c: any) =>
        ["__wb_tableoid", "__wb_ctid", "__wb_xmin"].includes(c.name),
      )
    )
      throw new Error(
        "Имена служебных row keys совпадают со столбцами таблицы. Используйте SQL-консоль для этой таблицы.",
      );
    const size = Math.min(9999, Math.max(1, p.limit || 200)),
      offset = Math.max(0, Math.floor(p.offset || 0));
    const sql = `SELECT ${editable ? 'tableoid::text AS "__wb_tableoid",ctid::text AS "__wb_ctid",xmin::text AS "__wb_xmin",' : ""}* FROM ${qualified(t.schema, t.name)}${where.length ? " WHERE " + where.join(" AND ") : ""}${p.sort ? " ORDER BY " + identifier(p.sort) + (p.descending ? " DESC" : " ASC") : ""} LIMIT ${size + 1} OFFSET ${offset}`;
    return this.execute({
      leaseId: p.leaseId,
      consoleId: p.consoleId,
      sql,
      params: values,
      operationId: p.operationId,
      limit: 10000,
      source: {
        tableOid: p.oid,
        offset,
        pageSize: size,
        filter: p.filter,
        sort: p.sort,
        descending: p.descending,
      },
    });
  }
  async changes(p: {
    leaseId: string;
    oid: string;
    changes: DatabaseChange[];
    operationId: string;
  }) {
    if (!p.changes?.length || p.changes.length > 1000)
      throw Object.assign(new Error("Changeset: 1–1000 строк"), {
        outcome: "notApplied",
      });
    return this.once(p.operationId, p, async () => {
      const t = await this.describe(p.leaseId, p.oid, "table");
      if (!["r", "p"].includes(t.kind))
        throw new Error(
          "Для представлений и произвольного SQL автоматическое редактирование отключено",
        );
      const l = this.available(p.leaseId),
        columns = new Map<string, any>(t.columns.map((c: any) => [c.name, c]));
      const own = l.info.transaction === "idle" && l.info.mode === "auto";
      l.info.busy = true;
      let entered = false;
      try {
        if (l.info.transaction === "idle")
          await l.client.query("BEGIN" + (l.info.readOnly ? " READ ONLY" : ""));
        await l.client.query("SAVEPOINT wb_changes");
        entered = true;
        const keys = [];
        for (const change of p.changes) {
          const values: unknown[] = [],
            assignments: string[] = [],
            names: string[] = [],
            expressions: string[] = [];
          for (const [name, value] of Object.entries(change.values || {})) {
            const col = columns.get(name);
            if (!col || col.generated || col.identity === "a")
              throw new Error("Столбец доступен только для чтения: " + name);
            names.push(identifier(name));
            let expression: string;
            if (value && typeof value === "object" && value.default === true)
              expression = "DEFAULT";
            else {
              if (value !== null && typeof value !== "string")
                throw new Error("Значение ячейки должно быть текстом или NULL");
              values.push(value);
              expression = "$" + values.length;
            }
            expressions.push(expression);
            assignments.push(identifier(name) + "=" + expression);
          }
          let sql: string;
          if (change.kind === "insert")
            sql = names.length
              ? `INSERT INTO ${qualified(t.schema, t.name)} (${names.join(",")}) VALUES (${expressions.join(",")})`
              : `INSERT INTO ${qualified(t.schema, t.name)} DEFAULT VALUES`;
          else {
            if (!change.key?.ctid || !change.key.xmin || !change.key.tableoid)
              throw new Error(
                "Нет optimistic row key; массовая запись запрещена",
              );
            values.push(change.key.tableoid, change.key.ctid, change.key.xmin);
            const condition = ` WHERE tableoid=$${values.length - 2}::oid AND ctid=$${values.length - 1}::tid AND xmin=$${values.length}::xid`;
            if (change.kind === "update") {
              if (!assignments.length) continue;
              sql = `UPDATE ${qualified(t.schema, t.name)} SET ${assignments.join(",")}${condition}`;
            } else if (change.kind === "delete")
              sql = `DELETE FROM ${qualified(t.schema, t.name)}${condition}`;
            else throw new Error("Неверное изменение");
          }
          const r = await l.client.query(
            sql + " RETURNING tableoid::text,ctid::text,xmin::text",
            values,
          );
          if (r.rowCount !== 1)
            throw new Error(
              "Конфликт строки: она изменена или удалена. Весь changeset отменён; ваши правки сохранены.",
            );
          keys.push(r.rows[0]);
        }
        await l.client.query("RELEASE SAVEPOINT wb_changes");
        if (own) await this.commit(l);
        return {
          applied: keys.length,
          keys,
          committed: own,
          transaction: l.info.transaction,
        };
      } catch (e: any) {
        if (entered)
          await l.client
            .query("ROLLBACK TO SAVEPOINT wb_changes")
            .catch(() => {});
        if (own) await l.client.query("ROLLBACK").catch(() => {});
        e.outcome = l.info.transaction === "unknown" ? "unknown" : "notApplied";
        if (e.outcome === "unknown") {
          e.code = "WB_OUTCOME_UNKNOWN";
          e.message =
            "Исход записи неизвестен. Сверьте данные перед повтором. " +
            e.message;
        }
        throw e;
      } finally {
        l.info.busy = false;
      }
    }).catch((error: any) => {
      if (!error.outcome) error.outcome = "notApplied";
      throw error;
    });
  }
  async admin(id: string, action: string, pid?: number) {
    const l = this.available(id);
    l.info.busy = true;
    try {
      if (action === "sessions")
        return (
          await l.client.query(
            "SELECT pid::text,usename,datname,application_name,state,wait_event_type,wait_event,query_start::text,LEFT(query,2000) query FROM pg_stat_activity WHERE datname=current_database() ORDER BY query_start LIMIT 1000",
          )
        ).rows;
      if (action === "locks")
        return (
          await l.client.query(
            "SELECT pid::text,locktype,relation::regclass::text,mode,granted::text FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) LIMIT 1000",
          )
        ).rows;
      if (action === "roles")
        return (
          await l.client.query(
            "SELECT rolname,rolsuper::text,rolcanlogin::text,rolcreatedb::text FROM pg_roles ORDER BY rolname LIMIT 1000",
          )
        ).rows;
      if (action === "extensions")
        return (
          await l.client.query(
            "SELECT extname,extversion FROM pg_extension ORDER BY extname",
          )
        ).rows;
      if (["cancel", "terminate"].includes(action) && Number.isSafeInteger(pid))
        return (
          await l.client.query(
            `SELECT ${action === "cancel" ? "pg_cancel_backend" : "pg_terminate_backend"}($1) requested`,
            [pid],
          )
        ).rows;
      throw new Error("Неизвестное административное действие");
    } finally {
      l.info.busy = false;
    }
  }
  async importFile(p: {
    leaseId: string;
    consoleId: string;
    oid: string;
    file: string;
    format: "csv" | "xlsx" | "sql";
    columns: string[];
    header?: boolean;
    delimiter?: string;
    nullValue?: string;
    encoding?: string;
    sheetIndex?: number;
    operationId: string;
  }) {
    if (!["csv", "xlsx", "sql"].includes(p.format))
      throw new Error("Импорт: CSV, XLSX или SQL");
    const info = await fs.stat(p.file);
    if (!info.isFile()) throw new Error("Нужен обычный файл");
    const t =
      p.format === "sql"
        ? undefined
        : await this.describe(p.leaseId, p.oid, "table");
    if (t && !["r", "p"].includes(t.kind))
      throw new Error("COPY импорт доступен для таблиц");
    const columns = new Map<string, any>(
      t?.columns.map((c: any) => [c.name, c]) || [],
    );
    if (
      t &&
      (!p.columns?.length ||
        new Set(p.columns).size !== p.columns.length ||
        p.columns.some((c) => !columns.has(c) || columns.get(c).generated))
    )
      throw new Error(
        "Проверьте столбцы COPY: существующие, без повторов и вычисляемых столбцов",
      );
    if (
      p.delimiter &&
      (Buffer.byteLength(p.delimiter) !== 1 ||
        ["\r", "\n", '"'].includes(p.delimiter))
    )
      throw new Error(
        "Разделитель COPY — один ASCII символ, кроме кавычки и перевода строки",
      );
    return this.once(p.operationId, p, async () => {
      const l = this.available(p.leaseId);
      if (this.tasks.size >= 4)
        throw new Error("Выполняются четыре операции БД");
      const job: DatabaseJob = {
        id: randomUUID(),
        operationId: p.operationId,
        consoleId: p.consoleId,
        kind: "import",
        status: "running",
        results: [],
        rows: 0,
        bytes: 0,
        startedAt: new Date().toISOString(),
        file: { path: p.file, size: info.size },
      };
      l.info.busy = true;
      l.job = job;
      l.cancelled = false;
      l.abort = new AbortController();
      this.jobs.set(job.id, job);
      this.save(job);
      this.spawn(
        (async () => {
          const own = l.info.transaction === "idle" && l.info.mode === "auto";
          let entered = false;
          try {
            if (l.info.transaction === "idle")
              await l.client.query(
                "BEGIN" + (l.info.readOnly ? " READ ONLY" : ""),
              );
            await l.client.query("SAVEPOINT wb_import");
            entered = true;
            if (p.format === "sql") {
              let lastProgress = 0;
              const hash = createHash("sha256");
              for await (const sql of sqlFile(
                p.file,
                l.abort!.signal,
                (chunk) => {
                  hash.update(chunk);
                },
              )) {
                const keyword = sqlKeyword(sql);
                if (!keyword) continue;
                if (
                  [
                    "BEGIN",
                    "START",
                    "COMMIT",
                    "END",
                    "ROLLBACK",
                    "ABORT",
                    "SAVEPOINT",
                    "RELEASE",
                    "PREPARE",
                    "COPY",
                  ].includes(keyword)
                )
                  throw new Error(
                    "SQL import выполняется в одной транзакции. Уберите transaction/psql/COPY-команды; для COPY используйте CSV import.",
                  );
                const stream = l.client.query(
                  new QueryStream(sql, [], {
                    batchSize: 8,
                    rowMode: "array",
                    types: textTypes,
                  }),
                );
                l.phase = "query";
                try {
                  for await (const _row of stream)
                    l.abort!.signal.throwIfAborted();
                } finally {
                  if (!stream.destroyed) stream.destroy();
                }
                job.rows += Number((stream as any)._result.rowCount || 0);
                job.bytes += Buffer.byteLength(sql);
                if (Date.now() - lastProgress >= 500) {
                  lastProgress = Date.now();
                  this.save(job);
                }
              }
              job.file!.inputHash = hash.digest("hex");
            } else {
              const nullValue =
                p.format === "xlsx" ? "\\N" : (p.nullValue ?? "\\N");
              const copy = l.client.query(
                copyFrom(
                  `COPY ${qualified(t!.schema, t!.name)} (${p.columns.map(identifier).join(",")}) FROM STDIN WITH (FORMAT csv, HEADER ${p.format === "csv" && p.header ? "true" : "false"}, DELIMITER ${literal(p.format === "xlsx" ? "," : p.delimiter || ",")}, NULL ${literal(nullValue)}, ENCODING 'UTF8')`,
                ),
              );
              l.phase = "copy";
              const signal = l.abort!.signal,
                hash = createHash("sha256");
              let lastProgress = 0;
              const progress = () => {
                if (Date.now() - lastProgress >= 500) {
                  lastProgress = Date.now();
                  this.save(job);
                }
              };
              if (p.format === "xlsx") {
                const self = this;
                async function* csv() {
                  let first = true;
                  for await (const row of readXlsx(
                    p.file,
                    self.directory,
                    signal,
                    p.sheetIndex,
                  )) {
                    if (first && p.header) {
                      first = false;
                      continue;
                    }
                    first = false;
                    if (row.length > p.columns.length)
                      throw new Error("В XLSX больше столбцов, чем в mapping");
                    job.rows++;
                    yield Array.from({ length: p.columns.length }, (_, i) =>
                      csvCell(row[i]),
                    ).join(",") + "\n";
                  }
                }
                await pipeline(
                  Readable.from(csv(), {
                    objectMode: false,
                    highWaterMark: 64 * 1024,
                  }),
                  countingStream(
                    (bytes) => {
                      job.bytes = bytes;
                      progress();
                    },
                    (chunk) => {
                      hash.update(chunk);
                    },
                  ),
                  copy,
                  { signal },
                );
              } else
                await pipeline(
                  decodedFile(p.file, p.encoding || "utf8"),
                  countingStream(
                    (bytes) => {
                      job.bytes = bytes;
                      if (bytes % (8 * 1024 ** 2) < 65536) this.save(job);
                    },
                    (chunk) => {
                      hash.update(chunk);
                    },
                  ),
                  copy,
                  { signal },
                );
              job.rows = copy.rowCount;
              job.file!.copyUtf8Hash = hash.digest("hex");
            }
            const after = await fs.stat(p.file);
            if (
              after.size !== info.size ||
              after.mtimeMs !== info.mtimeMs ||
              after.ino !== info.ino ||
              after.dev !== info.dev
            )
              throw new Error(
                "Исходный файл изменился во время импорта. Транзакция отменена.",
              );
            l.phase = "control";
            await l.client.query("RELEASE SAVEPOINT wb_import");
            if (own) await this.commit(l);
            job.status = "completed";
          } catch (e: any) {
            l.phase = "control";
            if (entered)
              await l.client
                .query("ROLLBACK TO SAVEPOINT wb_import")
                .catch(() => {});
            if (own) await l.client.query("ROLLBACK").catch(() => {});
            job.status =
              l.info.transaction === "unknown"
                ? "unknown"
                : l.cancelled
                  ? "cancelled"
                  : "failed";
            job.error = {
              message: String(e.message).slice(0, 4000),
              code: e.code,
            };
          } finally {
            job.finishedAt = new Date().toISOString();
            l.info.busy = false;
            l.job = undefined;
            l.abort = undefined;
            l.phase = undefined;
            this.save(job);
          }
        })(),
      );
      return { ...job };
    });
  }
  async exportFile(p: {
    leaseId: string;
    consoleId: string;
    resultId: string;
    file: string;
    format: "csv" | "sql" | "xlsx";
    table?: string;
    tableSchema?: string;
    allRows?: boolean;
    operationId: string;
  }) {
    if (!["csv", "sql", "xlsx"].includes(p.format))
      throw new Error("Экспорт: CSV, SQL или XLSX");
    const result = this.result(p.resultId);
    if (!result) throw new Error("Результат не найден");
    if (
      [...this.leases.values()].some((l) =>
        l.job?.results.some((r) => r.id === result.id),
      )
    )
      throw new Error("Дождитесь завершения результата");
    const table =
      p.allRows && result.source
        ? await this.describe(p.leaseId, result.source.tableOid, "table")
        : undefined;
    if (p.allRows && !table)
      throw new Error("Полный экспорт доступен для документа таблицы");
    return this.once(p.operationId, p, async () => {
      const l = this.available(p.leaseId);
      if (this.tasks.size >= 4)
        throw new Error("Выполняются четыре операции БД");
      const job: DatabaseJob = {
        id: randomUUID(),
        operationId: p.operationId,
        consoleId: p.consoleId,
        kind: "export",
        status: "running",
        results: [],
        rows: 0,
        bytes: 0,
        startedAt: new Date().toISOString(),
      };
      if (!this.pinnedResults.has(result.id))
        this.pinnedResults.set(result.id, new Set());
      this.pinnedResults.get(result.id)!.add(job.id);
      l.info.busy = true;
      l.job = job;
      l.cancelled = false;
      l.abort = new AbortController();
      this.jobs.set(job.id, job);
      this.save(job);
      l.phase = "file";
      this.spawn(
        (async () => {
          const staging = p.file + ".workbench-" + job.id + ".partial";
          try {
            const db = this.db;
            const keyCount =
              result.source &&
              result.fields
                .slice(0, 3)
                .map((f) => f.name)
                .join(",") === "__wb_tableoid,__wb_ctid,__wb_xmin"
                ? 3
                : 0;
            async function* rows() {
              let offset = 0;
              const getRow = db.prepare(
                "SELECT body FROM rows WHERE result=? AND n=?",
              );
              while (true) {
                const batch = db
                  .prepare(
                    "SELECT n FROM rows WHERE result=? AND n>=? ORDER BY n LIMIT 128",
                  )
                  .all(result!.id, offset);
                if (!batch.length) return;
                for (const r of batch) {
                  if (result!.source && offset++ >= result!.source.pageSize)
                    return;
                  const captured = getRow.get(result!.id, r.n)!;
                  yield JSON.parse(String(captured.body)).slice(keyCount);
                }
                if (!result!.source) offset += batch.length;
                await new Promise<void>((r) => setImmediate(r));
              }
            }
            let stream: QueryStream | undefined,
              lastProgress = 0;
            async function* live() {
              if (l.info.mode === "manual" && l.info.transaction === "idle")
                await l.client.query(
                  "BEGIN" + (l.info.readOnly ? " READ ONLY" : ""),
                );
              l.phase = "query";
              stream = l.client.query(
                new QueryStream(
                  `SELECT * FROM ${qualified(table!.schema, table!.name)}`,
                  [],
                  { batchSize: 8, rowMode: "array", types: textTypes },
                ),
              );
              try {
                for await (const row of stream) yield row;
              } finally {
                if (!stream.destroyed) stream.destroy();
              }
            }
            await writeRows(
              staging,
              p.format,
              table
                ? table.columns.map((c: any) => c.name)
                : result.fields.slice(keyCount).map((f) => f.name),
              table ? live() : rows(),
              l.abort!.signal,
              (count, bytes) => {
                job.rows = count;
                job.bytes = bytes;
                if (Date.now() - lastProgress >= 500) {
                  lastProgress = Date.now();
                  this.save(job);
                }
              },
              p.table || table?.name,
              p.tableSchema || table?.schema,
            );
            l.phase = "file";
            // Hard-link publishes without overwriting an existing file; same filesystem staging.
            await fs.link(staging, p.file);
            await fs.unlink(staging);
            job.status = "completed";
          } catch (e: any) {
            job.status = l.cancelled ? "cancelled" : "failed";
            job.error = { message: String(e.message).slice(0, 4000) };
            await fs.rm(staging, { force: true }).catch(() => {});
          } finally {
            job.finishedAt = new Date().toISOString();
            l.info.busy = false;
            l.job = undefined;
            l.abort = undefined;
            l.phase = undefined;
            this.pinnedResults.get(result.id)?.delete(job.id);
            if (!this.pinnedResults.get(result.id)?.size)
              this.pinnedResults.delete(result.id);
            this.save(job);
          }
        })(),
      );
      return { ...job };
    });
  }
  async dispose() {
    clearInterval(this.memoryTimer);
    for (const l of this.leases.values()) {
      l.abort?.abort();
      if (l.job?.status === "running") {
        l.job.status = "unknown";
        this.save(l.job);
      }
      if (l.info.busy) (l.client as any).connection.stream.destroy();
    }
    await Promise.allSettled(
      [...this.leases.values()].map((l) => l.client.end()),
    );
    await Promise.allSettled([...this.tasks]);
    this.leases.clear();
    this.db?.close();
  }
}
