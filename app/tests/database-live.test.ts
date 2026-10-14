import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { DatabaseEngine } from "../electron/database/engine";
import { DatabaseMcpClient } from "../electron/database/client";
import { DatabaseService } from "../electron/database/service";
import type { DatabaseConnection, DatabaseJob } from "../shared/database";
import { readXlsx, writeRows } from "../electron/database/files";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { sqlFile } from "../electron/database/sql-file";
import { createServer as createHttps } from "node:https";
import {
  createServer as createTcpServer,
  connect as connectTcp,
  type Socket,
} from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const url = process.env.WORKBENCH_DATABASE_TEST_URL,
  metrics: Record<string, any> = {};
describe.skipIf(!url)(
  "live PostgreSQL data workspace through real driver/MCP",
  () => {
    let engine: DatabaseEngine,
      admin: pg.Client,
      connection: DatabaseConnection,
      lease: any,
      second: any,
      temp: string;
    const op = () => crypto.randomUUID();
    async function wait(id: string): Promise<DatabaseJob> {
      for (let i = 0; i < 6000; i++) {
        const j = engine.status().jobs.find((j) => j.id === id)!;
        if (j.status !== "running") return j;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("Job did not terminate");
    }
    async function query(sql: string, l = lease, params: unknown[] = []) {
      const j = await engine.execute({
        leaseId: l.id,
        consoleId: l.id,
        sql,
        params,
        operationId: op(),
      });
      return wait(j.id);
    }
    async function rows(sql: string, l = lease) {
      const j = await query(sql, l);
      expect(j.status, j.error?.message).toBe("completed");
      return engine.page(j.results[0].id).values;
    }
    beforeAll(async () => {
      const u = new URL(url!);
      temp = path.join(process.env.WORKBENCH_DATABASE_TEST_TEMP!, "engine");
      await fs.mkdir(temp);
      connection = {
        id: "live",
        name: "Isolated test",
        environment: "test",
        projectIds: ["p"],
        transport: "postgres-mcp",
        host: u.hostname,
        port: Number(u.port),
        database: "postgres",
        user: u.username,
        readOnly: false,
      };
      admin = new pg.Client({ connectionString: url });
      await admin.connect();
      metrics.serverVersion = (
        await admin.query("SELECT version() v")
      ).rows[0].v;
      await admin.query(
        `CREATE TABLE public.wb_data(id bigint PRIMARY KEY,value text,n numeric(40,20),payload jsonb);INSERT INTO wb_data VALUES(1,'first',12345678901234567890.12345678901234567890,'{"ok":true}'),(2,NULL,NULL,NULL);CREATE FUNCTION public.wb_twice(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1*2';`,
      );
      engine = new DatabaseEngine(temp);
      await engine.init();
      lease = await engine.open(connection, u.password);
      second = await engine.open(connection, u.password);
    }, 30000);
    afterAll(async () => {
      if (engine)
        await fs.writeFile(
          path.join(process.env.WORKBENCH_DATABASE_TEST_TEMP!, "metrics.json"),
          JSON.stringify({
            ...metrics,
            node: process.versions.node,
            engine: engine.metrics(),
          }),
        );
      await engine?.dispose();
      await admin?.end();
    });
    it("preserves BIGINT, NUMERIC, timestamps, JSON text and NULL without JavaScript coercion", async () => {
      await query("SET TIME ZONE 'UTC'");
      const r = await rows(
        "SELECT 9223372036854775807::bigint,12345678901234567890.12345678901234567890::numeric,timestamptz '2026-10-14 01:02:03+00',NULL::text,''::text,'\\x00ff'::bytea",
      );
      expect(r[0]).toEqual([
        "9223372036854775807",
        "12345678901234567890.12345678901234567890",
        "2026-10-14 01:02:03+00",
        null,
        "",
        "\\x00ff",
      ]);
    });
    it("isolates physical sessions, temporary tables and manual transactions", async () => {
      await engine.transaction(lease.id, "mode", "manual");
      await query(
        "INSERT INTO wb_data VALUES(3,'private',NULL,NULL);CREATE TEMP TABLE wb_temp(n int)",
      );
      expect(await rows("SELECT count(*) FROM wb_data", second)).toEqual([
        ["2"],
      ]);
      expect(
        engine.status().leases.find((l) => l.id === lease.id)?.transaction,
      ).toBe("active");
      await engine.transaction(lease.id, "rollback");
      expect((await query("SELECT * FROM wb_temp", second)).status).toBe(
        "failed",
      );
      await engine.transaction(lease.id, "mode", "auto");
    });
    it("reports syntax positions and actual failed transaction state, then recovers with rollback", async () => {
      await engine.transaction(lease.id, "mode", "manual");
      const j = await query("SELECT broken syntax +");
      expect(j.status).toBe("failed");
      expect(j.error?.code).toBe("42601");
      expect(j.error?.position).toBeGreaterThan(0);
      expect(
        engine.status().leases.find((l) => l.id === lease.id)?.transaction,
      ).toBe("failed");
      await engine.transaction(lease.id, "rollback");
      await engine.transaction(lease.id, "mode", "auto");
    });
    it("cancels a running server query and observes terminal cancellation", async () => {
      const j = await engine.execute({
        leaseId: lease.id,
        consoleId: lease.id,
        sql: "SELECT pg_sleep(10)",
        operationId: op(),
      });
      await new Promise((r) => setTimeout(r, 100));
      await engine.cancel(lease.id);
      const done = await wait(j.id);
      expect(done.status).toBe("cancelled");
      expect(await rows("SELECT 1")).toEqual([["1"]]);
    });
    it("streams 100000 rows to disk and pages without storing all rows in a job", async () => {
      const before = process.memoryUsage().heapUsed;
      const j = await query("SELECT generate_series(1,100000) n");
      expect(j.status, j.error?.message).toBe("completed");
      expect(j.results[0].rows).toBe(100000);
      expect(engine.page(j.results[0].id, 99990, 20).values).toHaveLength(10);
      expect(JSON.stringify(j).length).toBeLessThan(3000);
      expect(process.memoryUsage().heapUsed - before).toBeLessThan(
        128 * 1024 ** 2,
      );
    });
    it("returns multiple result sets without splitting semicolons inside literals/functions", async () => {
      const j = await query("SELECT ';' text;SELECT 2 n;");
      expect(j.results).toHaveLength(2);
      expect(engine.page(j.results[0].id).values).toEqual([[";"]]);
      expect(engine.page(j.results[1].id).values).toEqual([["2"]]);
    });
    it("captures wide rows with a byte-bounded batch, rejects oversized pages before materialization and streams export", async () => {
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      const timer = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed);
      }, 10);
      try {
        const j = await query(
          "SELECT n,repeat('x',524288) payload FROM generate_series(1,256) n",
        );
        expect(j.status, j.error?.message).toBe("completed");
        expect(j.results[0].rows).toBe(256);
        expect(() => engine.page(j.results[0].id, 0, 500)).toThrow(/3 MiB/);
        expect(engine.page(j.results[0].id, 0, 1).values[0][1]).toHaveLength(
          524288,
        );
        const file = path.join(temp, "wide.csv");
        const transfer = await engine.exportFile({
          leaseId: lease.id,
          consoleId: lease.id,
          resultId: j.results[0].id,
          file,
          format: "csv",
          operationId: op(),
        });
        expect((await wait(transfer.id)).status).toBe("completed");
        expect((await fs.stat(file)).size).toBeGreaterThan(128 * 1024 ** 2);
        const delta = peak - before;
        metrics.wideRows = {
          rows: 256,
          cellBytes: 524288,
          sampledHeapDelta: delta,
          exportBytes: (await fs.stat(file)).size,
        };
        // Informational in the shared Vitest VM: GC scheduling includes the
        // harness/other cases. A separate real MCP worker below enforces the
        // hard memory bound for this workload instead of a flaky GC threshold.
        await fs.rm(file);
        engine.dropResult(j.results[0].id);
      } finally {
        clearInterval(timer);
      }
    }, 30000);
    it("real stdio worker streams 128 MiB wide rows and exports under a 64 MiB old-space cap without materializing an oversized page", async () => {
      const client = new DatabaseMcpClient(
        connection,
        {
          node: process.execPath,
          provider: path.resolve("dist-electron/database-provider.cjs"),
          directory: path.join(temp, "hard-heap-provider"),
          heapMiB: 64,
        },
        new URL(url!).password,
      );
      try {
        await client.connect();
        const l = await client.call("open", {
          connection,
          password: new URL(url!).password,
        });
        const started = await client.call("execute", {
          leaseId: l.id,
          consoleId: "hard-heap",
          operationId: op(),
          sql: "SELECT n,repeat('x',524288) payload FROM generate_series(1,256) n",
        });
        async function terminal(id: string) {
          for (let i = 0; i < 3000; i++) {
            const j = (await client.call("status", {})).jobs.find(
              (j: any) => j.id === id,
            );
            if (j?.status !== "running") return j;
            await new Promise((r) => setTimeout(r, 20));
          }
          throw new Error("Bounded worker did not terminate");
        }
        const completed = await terminal(started.id);
        expect(completed.status, completed.error?.message).toBe("completed");
        expect(completed.results[0].rows).toBe(256);
        await expect(
          client.call("page", {
            resultId: completed.results[0].id,
            offset: 0,
            limit: 500,
          }),
        ).rejects.toThrow(/3 MiB/);
        expect(
          (
            await client.call("page", {
              resultId: completed.results[0].id,
              offset: 0,
              limit: 1,
            })
          ).values[0][1],
        ).toHaveLength(524288);
        const file = path.join(temp, "hard-heap.csv"),
          transfer = await client.call("export", {
            leaseId: l.id,
            consoleId: "hard-heap",
            operationId: op(),
            file,
            format: "csv",
            resultId: completed.results[0].id,
          });
        expect((await terminal(transfer.id)).status).toBe("completed");
        expect((await fs.stat(file)).size).toBeGreaterThan(128 * 1024 ** 2);
        const observed = await client.call("metrics", {});
        metrics.hardHeapWorker = {
          oldSpaceMiB: 64,
          semiSpaceMiB: 4,
          observed,
          exportBytes: (await fs.stat(file)).size,
        };
        expect(observed.sampledPeak.heapUsed).toBeLessThan(96 * 1024 ** 2);
        await client.call("close", { leaseId: l.id });
        await fs.rm(file);
      } finally {
        await client.close();
      }
    }, 60000);
    it("retains column metadata and captured rows when a later fetched row raises a server error", async () => {
      const j = await query(
        "SELECT n, 1/(200-n) AS calculated FROM generate_series(1,300) n",
      );
      expect(j.status).toBe("failed");
      expect(j.error?.code).toBe("22012");
      expect(j.results[0].rows).toBeGreaterThan(0);
      expect(j.results[0].fields.map((f) => f.name)).toEqual([
        "n",
        "calculated",
      ]);
      expect(engine.page(j.results[0].id).values[0]).toEqual(["1", "0"]);
    });
    it("discovers actual catalog columns, keys, indexes, dependencies and routine definitions", async () => {
      const c = await engine.catalog(lease.id, "public"),
        t = c.objects.find((o: any) => o.name === "wb_data")!,
        f = c.objects.find((o: any) => o.name.startsWith("wb_twice("))!;
      const d = await engine.describe(lease.id, t.oid, "table");
      expect(d.columns.map((c: any) => c.name)).toEqual([
        "id",
        "value",
        "n",
        "payload",
      ]);
      expect(d.constraints.some((c: any) => c.type === "p")).toBe(true);
      expect(d.ddl).toContain("PRIMARY KEY");
      const routine = await engine.describe(lease.id, f.oid, "function");
      expect(routine.ddl).toContain("wb_twice");
      expect(routine.hash).toHaveLength(64);
    });
    it("selects several schemas, pages/searches objects on the server and exposes system schemas only when requested", async () => {
      await admin.query(
        "CREATE SCHEMA wb_alpha;CREATE SCHEMA wb_beta;CREATE TABLE wb_alpha.same_name(id int);CREATE TABLE wb_beta.same_name(id int);CREATE TABLE wb_beta.other_name(id int)",
      );
      const both = await engine.catalog(lease.id, undefined, {
        schemas: ["wb_alpha", "wb_beta"],
        limit: 2,
      });
      expect(both.objects).toHaveLength(2);
      expect(both.total).toBe(3);
      expect(both.hasMore).toBe(true);
      expect(new Set(both.objects.map((o: any) => o.schema))).toEqual(
        new Set(["wb_alpha", "wb_beta"]),
      );
      const next = await engine.catalog(lease.id, undefined, {
        schemas: ["wb_alpha", "wb_beta"],
        limit: 2,
        offset: 2,
      });
      expect(next.objects).toHaveLength(1);
      expect(next.hasMore).toBe(false);
      expect(
        new Set([...both.objects, ...next.objects].map((o: any) => o.oid)).size,
      ).toBe(3);
      const found = await engine.catalog(lease.id, undefined, {
        schemas: ["wb_alpha", "wb_beta"],
        search: "same_name",
      });
      expect(found.objects).toHaveLength(2);
      expect(
        (await engine.catalog(lease.id, undefined, { schemas: [] })).objects,
      ).toHaveLength(0);
      expect(both.schemas.some((s: any) => s.name === "pg_catalog")).toBe(
        false,
      );
      expect(
        (
          await engine.catalog(lease.id, undefined, { includeSystem: true })
        ).schemas.some((s: any) => s.name === "pg_catalog"),
      ).toBe(true);
      const injection = await engine.catalog(lease.id, undefined, {
        schemas: ["public' OR true --"],
        search: "' OR true --",
      });
      expect(injection.objects).toHaveLength(0);
      expect(
        (await admin.query("SELECT to_regclass('wb_data') present")).rows[0]
          .present,
      ).toBe("wb_data");
    });
    it("optimistic changesets are atomic and reject stale row identities", async () => {
      const t = (await engine.catalog(lease.id, "public")).objects.find(
        (o: any) => o.name === "wb_data",
      )!;
      let j = await engine.table({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: t.oid,
        operationId: op(),
        sort: "id",
      });
      j = await wait(j.id);
      const page = engine.page(j.results[0].id),
        key = {
          tableoid: page.values[0][0],
          ctid: page.values[0][1],
          xmin: page.values[0][2],
        };
      await admin.query("UPDATE wb_data SET value='external' WHERE id=1");
      await expect(
        engine.changes({
          leaseId: lease.id,
          oid: t.oid,
          operationId: op(),
          changes: [
            { kind: "insert", values: { id: "9", value: "must rollback" } },
            { kind: "update", key, values: { value: "overwrite" } },
          ],
        }),
      ).rejects.toThrow(/Конфликт/);
      expect(await rows("SELECT count(*) FROM wb_data WHERE id=9")).toEqual([
        ["0"],
      ]);
      expect(await rows("SELECT value FROM wb_data WHERE id=1")).toEqual([
        ["external"],
      ]);
    });
    it("does not replay a duplicate operation ID or accept different SQL under it", async () => {
      const operationId = op(),
        p = {
          leaseId: lease.id,
          consoleId: lease.id,
          sql: "INSERT INTO wb_data(id,value) VALUES(4,'once')",
          operationId,
        };
      const first = await engine.execute(p);
      await wait(first.id);
      expect((await engine.execute(p)).id).toBe(first.id);
      await expect(
        engine.execute({ ...p, sql: "DELETE FROM wb_data" }),
      ).rejects.toThrow(/другой/);
      expect(await rows("SELECT count(*) FROM wb_data WHERE id=4")).toEqual([
        ["1"],
      ]);
    });
    it("COPY streams CSV and distinguishes NULL, empty text, quoted delimiters and numeric precision", async () => {
      await admin.query(
        "CREATE TABLE wb_import(id bigint,value text,n numeric)",
      );
      const t = (await engine.catalog(lease.id, "public")).objects.find(
          (o: any) => o.name === "wb_import",
        )!,
        file = path.join(temp, "data.csv");
      await fs.writeFile(
        file,
        'id,value,n\n1,"",12345678901234567890.123456789\n2,\\N,\\N\n3,"a,b",2\n',
      );
      const j = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: t.oid,
        file,
        format: "csv",
        header: true,
        columns: ["id", "value", "n"],
        operationId: op(),
      });
      const done = await wait(j.id);
      expect(done.status, done.error?.message).toBe("completed");
      expect(done.rows).toBe(3);
      expect(await rows("SELECT * FROM wb_import ORDER BY id")).toEqual([
        ["1", "", "12345678901234567890.123456789"],
        ["2", null, null],
        ["3", "a,b", "2"],
      ]);
    });
    it("rolls back a malformed COPY input without partial rows", async () => {
      const t = (await engine.catalog(lease.id, "public")).objects.find(
          (o: any) => o.name === "wb_import",
        )!,
        file = path.join(temp, "bad.csv");
      await fs.writeFile(file, "9,valid,1\nnot-an-id,bad,2\n");
      const j = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: t.oid,
        file,
        format: "csv",
        columns: ["id", "value", "n"],
        operationId: op(),
      });
      expect((await wait(j.id)).status).toBe("failed");
      expect(await rows("SELECT count(*) FROM wb_import WHERE id=9")).toEqual([
        ["0"],
      ]);
    });
    it("exports CSV, SQL and XLSX from the captured result without reexecuting SQL", async () => {
      const q = await query("SELECT id,value,n FROM wb_import ORDER BY id");
      for (const format of ["csv", "sql", "xlsx"] as const) {
        const file = path.join(temp, "export." + format),
          j = await engine.exportFile({
            leaseId: lease.id,
            consoleId: lease.id,
            resultId: q.results[0].id,
            file,
            format,
            table: "target",
            operationId: op(),
          });
        const done = await wait(j.id);
        expect(done.status, done.error?.message).toBe("completed");
        expect(done.rows).toBe(3);
        if (format === "xlsx") {
          const rows = [];
          for await (const row of readXlsx(
            file,
            temp,
            new AbortController().signal,
          ))
            rows.push(row);
          expect(rows[1]).toEqual(["1", "", "12345678901234567890.123456789"]);
          expect(rows[2]).toEqual(["2", null, null]);
        } else {
          const text = await fs.readFile(file, "utf8");
          expect(text).toContain("12345678901234567890.123456789");
          expect(text).toContain(format === "csv" ? "\\N" : "NULL");
        }
      }
    });
    it("large CSV chunks preserve a split surrogate pair, quotes, newline and NULL on COPY round trip", async () => {
      const value = "x".repeat(65535) + "😀" + '"tail\n' + "y".repeat(1000),
        file = path.join(temp, "unicode-wide.csv");
      async function* source() {
        yield [value];
        yield [null];
      }
      await writeRows(
        file,
        "csv",
        ["value"],
        source(),
        new AbortController().signal,
        () => {},
      );
      await admin.query("CREATE TABLE wb_unicode_wide(value text)");
      const oid = (
        await admin.query("SELECT 'wb_unicode_wide'::regclass::oid::text oid")
      ).rows[0].oid;
      const imported = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid,
        file,
        format: "csv",
        columns: ["value"],
        header: true,
        operationId: op(),
      });
      expect((await wait(imported.id)).status).toBe("completed");
      const observed = (
        await admin.query(
          "SELECT value FROM wb_unicode_wide ORDER BY value NULLS LAST",
        )
      ).rows;
      expect(observed.map((r) => r.value)).toEqual([value, null]);
    });
    it("never overwrites an existing export destination", async () => {
      const q = await query("SELECT 1 n"),
        file = path.join(temp, "existing.csv");
      await fs.writeFile(file, "keep");
      const j = await engine.exportFile({
        leaseId: lease.id,
        consoleId: lease.id,
        resultId: q.results[0].id,
        file,
        format: "csv",
        operationId: op(),
      });
      expect((await wait(j.id)).status).toBe("failed");
      expect(await fs.readFile(file, "utf8")).toBe("keep");
    });
    it("preserves duplicate SQL column names by position in the result contract", async () => {
      const j = await query("SELECT 1 AS duplicate,2 AS duplicate");
      expect(engine.page(j.results[0].id).values).toEqual([["1", "2"]]);
      expect(j.results[0].fields.map((f) => f.name)).toEqual([
        "duplicate",
        "duplicate",
      ]);
    });
    it("materializes bounded table pages using captured filters and exact server offsets", async () => {
      await admin.query(
        "CREATE TABLE wb_pages(id integer PRIMARY KEY);INSERT INTO wb_pages SELECT generate_series(1,501)",
      );
      const t = (await engine.catalog(lease.id, "public")).objects.find(
        (o: any) => o.name === "wb_pages",
      )!;
      const first = await wait(
          (
            await engine.table({
              leaseId: lease.id,
              consoleId: lease.id,
              oid: t.oid,
              limit: 200,
              sort: "id",
              filter: [{ column: "id", operator: ">", value: "1" }],
              operationId: op(),
            })
          ).id,
        ),
        next = await wait(
          (
            await engine.table({
              leaseId: lease.id,
              consoleId: lease.id,
              oid: t.oid,
              limit: 200,
              offset: 200,
              sort: "id",
              filter: first.results[0].source!.filter,
              operationId: op(),
            })
          ).id,
        );
      expect(first.results[0].rows).toBe(201);
      expect(engine.page(first.results[0].id).values[0][3]).toBe("2");
      expect(engine.page(next.results[0].id).values[0][3]).toBe("202");
      expect(next.results[0].source?.offset).toBe(200);
    });
    it("a result display limit does not silently limit INSERT RETURNING side effects", async () => {
      await admin.query("CREATE TABLE wb_returning(id int)");
      const j = await engine.execute({
        leaseId: lease.id,
        consoleId: lease.id,
        sql: "INSERT INTO wb_returning SELECT generate_series(1,2000) RETURNING id",
        limit: 1,
        operationId: op(),
      });
      const r = await wait(j.id);
      expect(r.status, r.error?.message).toBe("completed");
      expect(r.results[0].truncated).toBe(true);
      expect(await rows("SELECT count(*) FROM wb_returning")).toEqual([
        ["2000"],
      ]);
    });
    it("large protocol values lose the session with an explicit unknown outcome instead of unbounded buffering", async () => {
      const l = await engine.open(connection, new URL(url!).password);
      const j = await query("SELECT repeat('x',20*1024*1024)", l);
      expect(j.status).toBe("unknown");
      expect(
        engine.status().leases.find((x) => x.id === l.id)?.transaction,
      ).toBe("unknown");
      expect(j.error?.message).toContain("8 MiB");
    });
    it("streams SQL files across chunk boundaries, rejects transaction control and rolls back the entire file on failure", async () => {
      const file = path.join(temp, "script.sql");
      await fs.writeFile(
        file,
        "/*" +
          "x".repeat(65530) +
          "*/ CREATE TABLE wb_sql_file(id int,value text);INSERT INTO wb_sql_file VALUES(1,'semi;colon');DO $body$ BEGIN PERFORM 1; END; $body$;",
      );
      const parsed = [];
      for await (const s of sqlFile(file, new AbortController().signal))
        parsed.push(s);
      expect(parsed).toHaveLength(3);
      const j = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: "",
        file,
        format: "sql",
        columns: [],
        operationId: op(),
      });
      const done = await wait(j.id);
      expect(done.status, done.error?.message).toBe("completed");
      expect(await rows("SELECT * FROM wb_sql_file")).toEqual([
        ["1", "semi;colon"],
      ]);
      await fs.writeFile(
        file,
        "INSERT INTO wb_sql_file VALUES(2,'must rollback');/* outer /* nested */ ok */ COMMIT;",
      );
      const bad = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: "",
        file,
        format: "sql",
        columns: [],
        operationId: op(),
      });
      expect((await wait(bad.id)).status).toBe("failed");
      expect(await rows("SELECT count(*) FROM wb_sql_file WHERE id=2")).toEqual(
        [["0"]],
      );
    });
    it("XLSX follows workbook tab order, streams Unicode shared strings and does not evaluate formulas", async () => {
      const file = path.join(temp, "shared-strings.xlsx"),
        zip = new yazl.ZipFile(),
        long = "汉".repeat(22000);
      zip.addBuffer(
        Buffer.from(
          '<workbook xmlns:r="urn:r"><sheets><sheet r:id="r2"/><sheet r:id="r1"/></sheets></workbook>',
        ),
        "xl/workbook.xml",
      );
      zip.addBuffer(
        Buffer.from(
          '<Relationships><Relationship Id="r1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="x/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
        ),
        "xl/_rels/workbook.xml.rels",
      );
      zip.addBuffer(
        Buffer.from("<sst><si><t>" + long + "</t></si></sst>"),
        "xl/sharedStrings.xml",
      );
      zip.addBuffer(
        Buffer.from(
          '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>second tab</t></is></c></row></sheetData></worksheet>',
        ),
        "xl/worksheets/sheet1.xml",
      );
      zip.addBuffer(
        Buffer.from(
          '<x:worksheet xmlns:x="urn:x"><x:sheetData><x:row><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1"><x:f>1+1</x:f><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>',
        ),
        "xl/worksheets/sheet2.xml",
      );
      zip.end();
      await pipeline(zip.outputStream, createWriteStream(file));
      const values = [];
      for await (const row of readXlsx(
        file,
        temp,
        new AbortController().signal,
      ))
        values.push(row);
      expect(values).toEqual([[long, "2"]]);
    });
    it("COPY and full-table CSV export stream a 73 MB file with measured bounded JavaScript heap", async () => {
      await admin.query("CREATE TABLE wb_bulk(n integer,payload text)");
      const t = (await engine.catalog(lease.id, "public")).objects.find(
          (o: any) => o.name === "wb_bulk",
        )!,
        file = path.join(temp, "bulk.csv"),
        payload = "x".repeat(240),
        block = ("1," + payload + "\n").repeat(1000);
      async function* blocks() {
        for (let i = 0; i < 300; i++) yield block;
      }
      await pipeline(Readable.from(blocks()), createWriteStream(file));
      expect((await fs.stat(file)).size).toBe(72900000);
      const initial = process.memoryUsage().heapUsed,
        started = performance.now();
      let peak = initial;
      const sampler = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed);
      }, 10);
      try {
        const imported = await wait(
          (
            await engine.importFile({
              leaseId: lease.id,
              consoleId: lease.id,
              oid: t.oid,
              file,
              format: "csv",
              columns: ["n", "payload"],
              operationId: op(),
            })
          ).id,
        );
        expect(imported.status, imported.error?.message).toBe("completed");
        expect(imported.rows).toBe(300000);
        const page = await wait(
            (
              await engine.table({
                leaseId: lease.id,
                consoleId: lease.id,
                oid: t.oid,
                operationId: op(),
              })
            ).id,
          ),
          out = path.join(temp, "bulk-out.csv");
        const exported = await wait(
          (
            await engine.exportFile({
              leaseId: lease.id,
              consoleId: lease.id,
              resultId: page.results[0].id,
              file: out,
              format: "csv",
              allRows: true,
              operationId: op(),
            })
          ).id,
        );
        expect(exported.status, exported.error?.message).toBe("completed");
        expect(exported.rows).toBe(300000);
        expect((await fs.stat(out)).size).toBeGreaterThan(72900000);
        expect(peak - initial).toBeLessThan(64 * 1024 ** 2);
        metrics.bulk = {
          inputBytes: 72900000,
          exportBytes: (await fs.stat(out)).size,
          rows: 300000,
          sampledHeapDelta: peak - initial,
          sampleIntervalMs: 10,
          copyAndExportMs: Math.round(performance.now() - started),
        };
      } finally {
        clearInterval(sampler);
      }
    }, 60000);
    it("manual savepoints preserve prior writes and commit only the intended rows", async () => {
      await engine.transaction(lease.id, "mode", "manual");
      await query("INSERT INTO wb_data(id,value) VALUES(10,'keep')");
      await engine.transaction(
        lease.id,
        "savepoint",
        undefined,
        "developer_savepoint",
      );
      await query("INSERT INTO wb_data(id,value) VALUES(11,'rollback')");
      await engine.transaction(
        lease.id,
        "rollbackTo",
        undefined,
        "developer_savepoint",
      );
      expect(await rows("SELECT id FROM wb_data WHERE id IN (10,11)")).toEqual([
        ["10"],
      ]);
      expect(
        await rows("SELECT id FROM wb_data WHERE id IN (10,11)", second),
      ).toEqual([]);
      await engine.transaction(lease.id, "commit");
      expect(
        await rows("SELECT id FROM wb_data WHERE id IN (10,11)", second),
      ).toEqual([["10"]]);
      await engine.transaction(lease.id, "mode", "auto");
    });
    it("invalid UTF-8 is rejected instead of silently replacing source data", async () => {
      const table = (await engine.catalog(lease.id, "public")).objects.find(
          (o: any) => o.name === "wb_import",
        )!,
        file = path.join(temp, "invalid-utf8.csv");
      await fs.writeFile(
        file,
        Buffer.concat([
          Buffer.from("9,good,1\n10,"),
          Buffer.from([255]),
          Buffer.from(",2\n"),
        ]),
      );
      const job = await wait(
        (
          await engine.importFile({
            leaseId: lease.id,
            consoleId: lease.id,
            oid: table.oid,
            file,
            format: "csv",
            columns: ["id", "value", "n"],
            operationId: op(),
          })
        ).id,
      );
      expect(job.status).toBe("failed");
      expect(job.error?.message).toContain("кодировку");
      expect(await rows("SELECT id FROM wb_import WHERE id IN (9,10)")).toEqual(
        [],
      );
    });
    it("a changing SQL input file rolls back its completed statements", async () => {
      const file = path.join(temp, "changing.sql");
      await fs.writeFile(
        file,
        "SELECT pg_sleep(0.2);INSERT INTO wb_import VALUES(12,'must rollback',NULL);",
      );
      const job = await engine.importFile({
        leaseId: lease.id,
        consoleId: lease.id,
        oid: "",
        file,
        format: "sql",
        columns: [],
        operationId: op(),
      });
      await fs.appendFile(file, "\n-- changed during import");
      const completed = await wait(job.id);
      expect(completed.status).toBe("failed");
      expect(completed.error?.message).toContain("изменился");
      expect(await rows("SELECT id FROM wb_import WHERE id=12")).toEqual([]);
    });
    it("script errors identify the actual second statement and retain the captured SQL hash", async () => {
      const sql = "SELECT '汉';\n  SELECT +;",
        job = await query(sql);
      expect(job.status).toBe("failed");
      expect(job.error?.statementOffset).toBe(sql.indexOf("SELECT +"));
      expect(job.error?.position).toBeGreaterThan(0);
      expect(job.sqlHash).toHaveLength(64);
      expect(await fs.readFile(job.sqlPath!, "utf8")).toBe(sql);
    });
    it("real stdio MCP performs inventory, open, execute, page and close", async () => {
      const client = new DatabaseMcpClient(
        connection,
        {
          node: process.execPath,
          provider: path.resolve("dist-electron/database-provider.cjs"),
          directory: path.join(temp, "mcp"),
        },
        new URL(url!).password,
      );
      try {
        await client.connect();
        expect(client.inventory().tools[0].name).toBe("database_operation");
        const l = await client.call("open", {
          connection,
          password: new URL(url!).password,
        });
        const j = await client.call("execute", {
          leaseId: l.id,
          consoleId: "mcp",
          sql: "SELECT 42 n",
          operationId: op(),
        });
        let r: any;
        for (let i = 0; i < 100; i++) {
          r = (await client.call("status", {})).jobs.find(
            (x: any) => x.id === j.id,
          );
          if (r.status !== "running") break;
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(r.status, r.error?.message).toBe("completed");
        expect(
          (await client.call("page", { resultId: r.results[0].id })).values,
        ).toEqual([["42"]]);
        const catalog = await client.call("catalog", {
            leaseId: l.id,
            schema: "public",
          }),
          routine = catalog.objects.find((o: any) =>
            o.name.startsWith("wb_twice("),
          ),
          definition = await client.call("describe", {
            leaseId: l.id,
            oid: routine.oid,
            kind: "function",
          });
        const edit = await client.call("routineApply", {
          leaseId: l.id,
          consoleId: "mcp",
          oid: routine.oid,
          originalHash: definition.hash,
          sql: "CREATE OR REPLACE FUNCTION public.wb_twice(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1*3'",
          operationId: op(),
        });
        let edited: any;
        for (let i = 0; i < 100; i++) {
          edited = (await client.call("status", {})).jobs.find(
            (j: any) => j.id === edit.id,
          );
          if (edited.status !== "running") break;
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(edited.status, edited.error?.message).toBe("completed");
        expect(edited.consoleId).toBe("mcp");
        expect(edited.routine.committed).toBe(true);
        expect(edited.routine.appliedHash).not.toBe(definition.hash);
        expect(await rows("SELECT wb_twice(3)")).toEqual([["9"]]);
        await expect(
          client.call("routineApply", {
            leaseId: l.id,
            consoleId: "mcp",
            oid: routine.oid,
            originalHash: definition.hash,
            sql: definition.ddl,
            operationId: op(),
          }),
        ).rejects.toThrow(/изменено/);
        const actual = await client.call("describe", {
            leaseId: l.id,
            oid: routine.oid,
            kind: "function",
          }),
          wrong = await client.call("routineApply", {
            leaseId: l.id,
            consoleId: "mcp",
            oid: routine.oid,
            originalHash: actual.hash,
            sql: "CREATE OR REPLACE FUNCTION public.wb_wrong_target(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1'",
            operationId: op(),
          });
        let rejected: any;
        for (let i = 0; i < 100; i++) {
          rejected = (await client.call("status", {})).jobs.find(
            (j: any) => j.id === wrong.id,
          );
          if (rejected.status !== "running") break;
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(rejected.status).toBe("failed");
        expect(
          await rows(
            "SELECT count(*) FROM pg_proc WHERE proname='wb_wrong_target'",
          ),
        ).toEqual([["0"]]);
        await client.call("close", { leaseId: l.id });
      } finally {
        await client.close();
      }
    });
    it("HTTPS MCP validates its certificate, configurable credential header and actual tool schema", async () => {
      const certificate = path.join(temp, "test-ca.pem"),
        key = path.join(temp, "test-key.pem"),
        config = path.join(temp, "openssl.cnf");
      await fs.writeFile(
        config,
        "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:true\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n",
      );
      await promisify(execFile)("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        certificate,
        "-days",
        "1",
        "-config",
        config,
      ]);
      const token = op(),
        servers = new Set<Server>();
      let calls = 0;
      const https = createHttps(
        { cert: await fs.readFile(certificate), key: await fs.readFile(key) },
        (req, res) => {
          if (req.headers["x-workbench-test-key"] !== token) {
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>Unauthorized</h1>");
            return;
          }
          // MCP SDK 1.32 requires a fresh transport per stateless request.
          const server = new Server(
              { name: "tls-protocol-fixture", version: "1" },
              { capabilities: { tools: {} } },
            ),
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            });
          servers.add(server);
          server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
              {
                name: "facts",
                inputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                  additionalProperties: false,
                },
              },
            ],
          }));
          server.setRequestHandler(CallToolRequestSchema, async (r) => {
            calls++;
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    value:
                      r.params.arguments?.value === "malformed"
                        ? { schemas: "wrong", objects: [] }
                        : {
                            schemas: [],
                            objects: [],
                            echo: r.params.arguments?.value,
                          },
                  }),
                },
              ],
            };
          });
          res.once("close", () => {
            void server.close();
            servers.delete(server);
          });
          void server
            .connect(transport)
            .then(() => transport.handleRequest(req, res));
        },
      );
      await new Promise<void>((r) => https.listen(0, "127.0.0.1", r));
      const address = https.address() as any;
      const c: DatabaseConnection = {
        ...connection,
        id: "https",
        transport: "http",
        url: `https://127.0.0.1:${address.port}/mcp`,
        ca: await fs.readFile(certificate, "utf8"),
        secretHeader: "X-Workbench-Test-Key",
        secretPrefix: "",
        bindings: { catalog: "facts" },
      };
      const client = new DatabaseMcpClient(
          c,
          { node: "", provider: "", directory: "" },
          token,
        ),
        untrusted = new DatabaseMcpClient(
          { ...c, ca: undefined },
          { node: "", provider: "", directory: "" },
          token,
        );
      try {
        await expect(untrusted.connect()).rejects.toThrow();
        await client.connect();
        expect(await client.call("catalog", { value: "verified" })).toEqual({
          schemas: [],
          objects: [],
          echo: "verified",
        });
        await expect(client.call("catalog", { value: 123 })).rejects.toThrow(
          /схеме/,
        );
        expect(calls).toBe(1);
        await expect(
          client.call("catalog", { value: "malformed" }),
        ).rejects.toThrow(/Data protocol/);
      } finally {
        await client.close();
        await untrusted.close();
        await Promise.allSettled([...servers].map((s) => s.close()));
        https.closeAllConnections();
        await new Promise<void>((r) => https.close(() => r()));
      }
    }, 30000);
    it.each(["changes", "manual-commit"])(
      "survives actual COMMIT response loss for %s without repeating INSERT, persists intent and requires observed reconciliation",
      async (mode) => {
        await admin.query(
          "DROP TABLE IF EXISTS wb_lost_commit;CREATE TABLE wb_lost_commit(id int PRIMARY KEY, value text)",
        );
        const oid = (
          await admin.query("SELECT 'wb_lost_commit'::regclass::oid::text oid")
        ).rows[0].oid;
        const sockets = new Set<Socket>();
        let dropped = false,
          armed = false,
          sawCommit = false;
        const target = new URL(url!);
        const proxy = createTcpServer((front) => {
          const back = connectTcp(Number(target.port), target.hostname);
          sockets.add(front);
          sockets.add(back);
          for (const socket of [front, back]) {
            socket.on("error", () => {});
            socket.on("close", () => sockets.delete(socket));
          }
          let held = Buffer.alloc(0),
            scan = Buffer.alloc(0);
          front.on("data", (data) => {
            // Fixture sends simple-query COMMIT through pg; no production parsing.
            if (!dropped && data.includes(Buffer.from("COMMIT\0")))
              armed = true;
            back.write(data);
          });
          back.on("data", (data) => {
            if (!armed) {
              front.write(data);
              return;
            }
            held = Buffer.concat([held, data]);
            scan = Buffer.concat([scan, data]);
            while (scan.length >= 5) {
              const length = scan.readUInt32BE(1) + 1;
              if (scan.length < length) break;
              const packet = scan.subarray(0, length);
              scan = scan.subarray(length);
              if (
                packet[0] === 67 &&
                packet.subarray(5).toString() === "COMMIT\0"
              ) {
                sawCommit = true;
                dropped = true;
                armed = false;
                // The server committed; deliberately withhold that acknowledgement.
                front.destroy();
                back.destroy();
                return;
              }
              if (packet[0] === 69) {
                armed = false;
                front.write(held);
                held = Buffer.alloc(0);
                return;
              }
            }
          });
          front.on("close", () => back.destroy());
          back.on("close", () => front.destroy());
        });
        await new Promise<void>((resolve) =>
          proxy.listen(0, "127.0.0.1", resolve),
        );
        const port = (proxy.address() as any).port;
        const options = {
          dataDir: path.join(temp, "lost-commit-host"),
          node: process.execPath,
          provider: path.resolve("dist-electron/database-provider.cjs"),
          project: (_id: string) => {},
          changed: () => {},
          vault: {
            available: () => true,
            encrypt: (s: string) => Buffer.from(s.split("").reverse().join("")),
            decrypt: (b: Buffer) => b.toString().split("").reverse().join(""),
          },
        };
        let service = new DatabaseService(options);
        try {
          await service.init();
          const saved = await service.invoke("database.connection.save", {
            connection: { ...connection, id: undefined, port },
            secret: target.password,
          });
          const doc = await service.invoke("database.console.create", {
            projectId: "p",
            connectionId: saved.id,
          });
          const params = { projectId: "p", consoleId: doc.id };
          await service.invoke("database.console.open", params);
          const operationId = op();
          const intent = {
            ...params,
            oid,
            operationId: mode === "changes" ? operationId : op(),
            changes: [
              { kind: "insert", values: { id: "1", value: "committed-once" } },
            ],
          };
          if (mode === "changes")
            await expect(
              service.invoke("database.changes", intent),
            ).rejects.toThrow(/неизвестен/);
          else {
            await service.invoke("database.transaction", {
              ...params,
              action: "mode",
              mode: "manual",
            });
            expect(
              (await service.invoke("database.changes", intent)).committed,
            ).toBe(false);
            expect(
              (await admin.query("SELECT count(*) FROM wb_lost_commit")).rows[0]
                .count,
            ).toBe("0");
            await expect(
              service.invoke("database.transaction", {
                ...params,
                action: "commit",
                operationId,
              }),
            ).rejects.toThrow(/terminated|неизвест/i);
          }
          expect(sawCommit).toBe(true);
          expect(
            (await admin.query("SELECT count(*) FROM wb_lost_commit")).rows[0]
              .count,
          ).toBe("1");
          let current = await service.invoke("database.console.read", params);
          expect(current.pendingEffect.phase).toBe("unknown");
          expect(current.pendingEffect.operationId).toBe(operationId);
          await expect(
            service.invoke("database.changes", {
              ...intent,
              operationId: op(),
            }),
          ).rejects.toThrow(/свер/);
          await service.invoke("database.console.disconnect", params);
          await expect(
            service.invoke("database.connection.save", {
              connection: { ...saved, port: connection.port },
            }),
          ).rejects.toThrow();
          await service.dispose();
          service = new DatabaseService(options);
          await service.init();
          current = await service.invoke("database.console.read", params);
          expect(current.pendingEffect.operationId).toBe(operationId);
          const recorded = await service.invoke(
            "database.effect.read",
            params,
            true,
          );
          expect(recorded.intent).toContain(
            mode === "changes" ? "committed-once" : "commit",
          );
          const ledger = await service.invoke(
            "database.operation.list",
            params,
            true,
          );
          const submitted = ledger.operations.find(
            (o: any) => o.operationId === operationId,
          );
          expect(submitted.receiptStatus).toBe("pending");
          const original = await service.invoke(
            "database.operation.read",
            { ...params, operationId: intent.operationId },
            true,
          );
          expect(original.text).toContain("committed-once");
          await expect(
            service.invoke(
              "database.effect.resolve",
              {
                ...params,
                operationId,
                outcome: "applied",
                note: "I think it worked",
              },
              true,
            ),
          ).rejects.toThrow(/проверки/);
          const readback = await service.invoke("database.console.create", {
            projectId: "p",
            connectionId: saved.id,
          });
          await service.invoke("database.console.open", {
            ...params,
            consoleId: readback.id,
          });
          const job = await service.invoke("database.execute", {
            projectId: "p",
            consoleId: readback.id,
            operationId: op(),
            sql: "SELECT * FROM wb_lost_commit WHERE id=1",
          });
          let terminal: any;
          for (let i = 0; i < 200; i++) {
            terminal = (await service.snapshot("p")).jobs.find(
              (j) => j.id === job.id,
            );
            if (terminal?.status !== "running") break;
            await new Promise((r) => setTimeout(r, 20));
          }
          expect(terminal.status).toBe("completed");
          const observed = await service.invoke("database.page", {
            projectId: "p",
            consoleId: readback.id,
            resultId: terminal.results[0].id,
          });
          expect(observed.values).toEqual([["1", "committed-once"]]);
          await service.invoke(
            "database.effect.resolve",
            {
              ...params,
              operationId,
              outcome: "applied",
              note: "Readback found id=1 and value=committed-once; row count is one.",
              evidenceJobIds: [job.id],
            },
            true,
          );
          current = await service.invoke("database.console.read", params);
          expect(current.pendingEffect).toBeUndefined();
          expect(current.lastResolution.evidenceJobIds).toEqual([job.id]);
          expect(
            (
              await service.invoke("database.operation.read", {
                ...params,
                operationId: intent.operationId,
              })
            ).text,
          ).toContain("committed-once");
          await expect(
            service.invoke(
              "database.operation.read",
              {
                projectId: "p",
                consoleId: readback.id,
                operationId: intent.operationId,
              },
              true,
            ),
          ).rejects.toThrow(/другой консоли/);
          expect(
            (await admin.query("SELECT count(*) FROM wb_lost_commit")).rows[0]
              .count,
          ).toBe("1");
        } finally {
          await service.dispose();
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
      },
      30000,
    );
    it("recovers offline results and exact parameters after restart, and prevents silent retargeting of old documents", async () => {
      const options = {
        dataDir: path.join(temp, "offline-host"),
        node: process.execPath,
        provider: path.resolve("dist-electron/database-provider.cjs"),
        project: (_id: string) => {},
        changed: () => {},
        vault: {
          available: () => true,
          encrypt: (s: string) => Buffer.from(s.split("").reverse().join("")),
          decrypt: (b: Buffer) => b.toString().split("").reverse().join(""),
        },
      };
      let service = new DatabaseService(options);
      try {
        await service.init();
        const saved = await service.invoke("database.connection.save", {
          connection: { ...connection, id: undefined },
          secret: new URL(url!).password,
        });
        const doc = await service.invoke("database.console.create", {
          projectId: "p",
          connectionId: saved.id,
          sql: "SELECT $1::numeric AS precise",
        });
        const p = { projectId: "p", consoleId: doc.id };
        await service.invoke("database.console.open", p);
        const job = await service.invoke("database.execute", {
          ...p,
          sql: doc.sql,
          params: ["12345678901234567890.12345678901234567890"],
          operationId: op(),
        });
        let terminal: any;
        for (let i = 0; i < 200; i++) {
          terminal = (await service.snapshot("p")).jobs.find(
            (j) => j.id === job.id,
          );
          if (terminal?.status !== "running") break;
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(terminal.status).toBe("completed");
        const resultId = terminal.results[0].id;
        const request = await service.invoke(
          "database.job.read",
          { ...p, jobId: job.id, part: "request" },
          true,
        );
        expect(JSON.parse(request.text).params).toEqual([
          "12345678901234567890.12345678901234567890",
        ]);
        expect(request.text).not.toContain(new URL(url!).password);
        const chunk = await service.invoke(
          "database.job.read",
          { ...p, jobId: job.id, offset: 7, limit: 2 },
          true,
        );
        expect(chunk.text).toBe("$1");
        expect(chunk.truncated).toBe(true);
        await service.invoke("database.console.disconnect", p);
        await service.dispose();
        service = new DatabaseService(options);
        await service.init();
        await service.invoke("database.history.load", p, true);
        expect((await service.snapshot("p")).leases).toHaveLength(0);
        expect(
          (await service.invoke("database.page", { ...p, resultId })).values,
        ).toEqual([["12345678901234567890.12345678901234567890"]]);
        await service.invoke("database.connection.save", {
          connection: { ...saved, database: "different_database" },
        });
        await expect(
          service.invoke("database.console.open", p),
        ).rejects.toThrow(/прежнему серверу/);
        expect((await service.invoke("database.console.read", p)).sql).toBe(
          doc.sql,
        );
        await service.invoke("database.history.load", p);
        expect(
          (await service.invoke("database.page", { ...p, resultId })).values,
        ).toHaveLength(1);
      } finally {
        await service.dispose();
      }
    });
    it("host enforces project bindings, version conflicts and encrypted credential persistence", async () => {
      const service = new DatabaseService({
        dataDir: path.join(temp, "host"),
        node: process.execPath,
        provider: path.resolve("dist-electron/database-provider.cjs"),
        project: (id) => {
          if (!["p", "other"].includes(id)) throw new Error("unknown project");
        },
        changed: () => {},
        vault: {
          available: () => true,
          encrypt: (s) => Buffer.from(s.split("").reverse().join("")),
          decrypt: (b) => b.toString().split("").reverse().join(""),
        },
      });
      try {
        await service.init();
        const c = await service.invoke("database.connection.save", {
          connection: { ...connection, id: undefined },
          secret: new URL(url!).password,
        });
        await expect(
          service.invoke("database.console.create", {
            projectId: "other",
            connectionId: c.id,
          }),
        ).rejects.toThrow(/не привязано/);
        const doc = await service.invoke("database.console.create", {
          projectId: "p",
          connectionId: c.id,
        });
        await service.invoke("database.console.update", {
          projectId: "p",
          consoleId: doc.id,
          revision: 1,
          sql: "SELECT 1",
        });
        await expect(
          service.invoke("database.console.update", {
            projectId: "p",
            consoleId: doc.id,
            revision: 1,
            sql: "overwrite",
          }),
        ).rejects.toThrow(/другом окне/);
        const snapshot = await service.invoke("database.snapshot", {
          projectId: "p",
        });
        expect(JSON.stringify(snapshot)).not.toContain(new URL(url!).password);
        const agentSnapshot = await service.invoke(
          "database.snapshot",
          { projectId: "p" },
          true,
        );
        expect(agentSnapshot.consoles[0]).not.toHaveProperty("sql");
        const chunk = await service.invoke(
          "database.console.read",
          { projectId: "p", consoleId: doc.id, offset: 0, limit: 3 },
          true,
        );
        expect(chunk.sql).toBe("SEL");
        expect(chunk.truncated).toBe(true);
        const recoveries = await service.invoke("database.recovery.list", {
          projectId: "p",
        });
        expect(recoveries).toHaveLength(1);
        const restored = await service.invoke("database.recovery.restore", {
          projectId: "p",
          id: recoveries[0].id,
        });
        expect(restored.sql).toBe("overwrite");
        expect(
          (
            await service.invoke("database.console.read", {
              projectId: "p",
              consoleId: doc.id,
            })
          ).sql,
        ).toBe("SELECT 1");
        expect(
          await fs.readFile(
            path.join(temp, "host/database/state.json"),
            "utf8",
          ),
        ).not.toContain(new URL(url!).password);
        await expect(
          service.invoke(
            "database.connection.probe",
            { connectionId: c.id },
            true,
          ),
        ).rejects.toThrow(/пользователю/);
      } finally {
        await service.dispose();
      }
    });
  },
);
