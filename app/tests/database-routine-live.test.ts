import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, connect, type Socket } from "node:net";
import { createServer as createHttpServer } from "node:http";
import pg from "pg";
import { DatabaseService } from "../electron/database/service";
import { DatabaseMcpClient } from "../electron/database/client";
import type { DatabaseConsole, DatabaseConnection } from "../shared/database";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const url = process.env.WORKBENCH_DATABASE_TEST_URL;
describe.skipIf(!url)(
  "Persisted routine editor baseline against real PostgreSQL",
  () => {
    let admin: pg.Client;
    beforeAll(async () => {
      admin = new pg.Client({ connectionString: url });
      await admin.connect();
    });
    afterAll(async () => {
      await admin?.end();
    });

    function ddl(name: string, value: number) {
      return `CREATE OR REPLACE FUNCTION public.${name}() RETURNS integer LANGUAGE sql AS $$SELECT ${value}$$;`;
    }
    async function slowStatusFixture() {
      let hanging = true,
        cancellations = 0;
      const server = new Server(
        { name: "shutdown-status-timeout-fixture", version: "1" },
        { capabilities: { tools: {} } },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });
      const response = () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ value: { leases: [], jobs: [] } }),
          },
        ],
      });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "status_fixture",
            inputSchema: { type: "object", additionalProperties: false },
          },
        ],
      }));
      server.setRequestHandler(
        CallToolRequestSchema,
        async (_request, extra) => {
          if (!hanging) return response();
          return new Promise((resolve) => {
            extra.signal.addEventListener(
              "abort",
              () => {
                cancellations++;
                resolve(response());
              },
              { once: true },
            );
          });
        },
      );
      await server.connect(transport);
      const http = createHttpServer((req, res) => {
        void transport.handleRequest(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const client = new DatabaseMcpClient(
        {
          id: "status-fixture",
          name: "Controlled status",
          environment: "test",
          projectIds: [],
          transport: "http",
          readOnly: true,
          url: `http://127.0.0.1:${(http.address() as any).port}/mcp`,
          bindings: { status: "status_fixture" },
        },
        { node: "", provider: "", directory: "" },
      );
      await client.connect();
      return {
        client,
        get cancellations() {
          return cancellations;
        },
        ready() {
          hanging = false;
        },
        async close() {
          await client.close();
          await server.close();
          http.closeAllConnections();
          await new Promise<void>((resolve) => http.close(() => resolve()));
        },
      };
    }
    async function fixture(port?: number) {
      const source = new URL(url!);
      const name = "wb_routine_" + randomUUID().replaceAll("-", "");
      await admin.query(ddl(name, 1));
      const original = (
        await admin.query(
          "SELECT p.oid::text,pg_get_functiondef(p.oid) ddl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",
          [name],
        )
      ).rows[0];
      const options = {
        dataDir: path.join(
          process.env.WORKBENCH_DATABASE_TEST_TEMP!,
          "routine-host-" + randomUUID(),
        ),
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
      await service.init();
      const connection: DatabaseConnection = await service.invoke(
        "database.connection.save",
        {
          connection: {
            name: "Routine isolated test",
            environment: "test",
            projectIds: ["routine-p"],
            transport: "postgres-mcp",
            host: source.hostname,
            port: port || Number(source.port),
            database: "postgres",
            user: source.username,
            readOnly: false,
          },
          secret: source.password,
        },
      );
      const initial: DatabaseConsole = await service.invoke(
        "database.console.create",
        {
          projectId: "routine-p",
          connectionId: connection.id,
          title: name,
          sql: original.ddl,
          object: { oid: original.oid, kind: "function" },
        },
      );
      const params = { projectId: "routine-p", consoleId: initial.id };
      await service.invoke("database.console.open", params);
      return {
        name,
        params,
        options,
        connection,
        get service() {
          return service;
        },
        async read(): Promise<DatabaseConsole> {
          return service.invoke("database.console.read", params);
        },
        async apply(value: number, extra: Record<string, unknown> = {}) {
          const current = await this.read();
          await service.invoke("database.console.update", {
            ...params,
            revision: current.revision,
            sql: ddl(name, value),
          });
          return service.invoke("database.routineApply", {
            ...params,
            oid: original.oid,
            sql: ddl(name, value),
            operationId: randomUUID(),
            ...extra,
          });
        },
        async restart(legacy = false) {
          await service.dispose();
          if (legacy) {
            const file = path.join(options.dataDir, "database/state.json");
            const state = JSON.parse(await fs.readFile(file, "utf8"));
            delete state.consoles.find(
              (c: DatabaseConsole) => c.id === initial.id,
            ).routineBaseline;
            await fs.writeFile(file, JSON.stringify(state));
          }
          service = new DatabaseService(options);
          await service.init();
          await service.invoke("database.console.open", params);
        },
        async value() {
          return (await admin.query(`SELECT public.${name}() value`)).rows[0]
            .value;
        },
        async close() {
          await service.dispose();
          await admin.query(`DROP FUNCTION IF EXISTS public.${name}()`);
        },
      };
    }

    it("keeps a host-owned committed baseline across repeated auto applies and restart", async () => {
      const f = await fixture();
      try {
        const initial = await f.read();
        expect(initial.routineBaseline?.verified).toBe(true);
        const first = await f.apply(2);
        expect(first.status).toBe("completed");
        expect(first.routine.committed).toBe(true);
        expect(await f.value()).toBe(2);
        const confirmed = await f.read();
        expect(confirmed.pendingEffect).toBeUndefined();
        expect(confirmed.routineBaseline!.committedHash).toBe(
          first.routine.appliedHash,
        );
        expect(confirmed.routineBaseline!.session).toBeUndefined();
        await f.restart();
        expect((await f.read()).routineBaseline!.committedHash).toBe(
          first.routine.appliedHash,
        );
        const second = await f.apply(3, {
          originalHash: "caller hash is not authoritative",
        });
        expect(second.routine.previousHash).toBe(first.routine.appliedHash);
        expect(await f.value()).toBe(3);
      } finally {
        await f.close();
      }
    }, 30000);

    it("rejects external DDL after restart even with the new caller hash; explicit reload preserves draft and uses revision CAS", async () => {
      const f = await fixture();
      try {
        const old = await f.read();
        await f.restart();
        await admin.query(ddl(f.name, 9));
        const server = await f.service.invoke("database.describe", {
          ...f.params,
          oid: old.object!.oid,
          kind: "function",
        });
        await expect(f.apply(2, { originalHash: server.hash })).rejects.toThrow(
          /изменено на сервере/,
        );
        expect(await f.value()).toBe(9);
        const current = await f.read();
        expect(current.routineBaseline!.committedHash).toBe(
          old.routineBaseline!.committedHash,
        );
        expect(current.pendingEffect).toBeUndefined();
        await expect(
          f.service.invoke("database.routine.reload", {
            ...f.params,
            revision: current.revision - 1,
          }),
        ).rejects.toThrow(/Консоль изменена/);
        await expect(
          f.service.invoke(
            "database.routine.reload",
            {
              ...f.params,
              revision: current.revision,
            },
            true,
          ),
        ).rejects.toThrow(/adoptServerVersion/);
        const loaded = await f.service.invoke(
          "database.routine.reload",
          {
            ...f.params,
            revision: current.revision,
            adoptServerVersion: true,
          },
          true,
        );
        expect(loaded.sql).toBe(server.ddl);
        expect(loaded.routineBaseline.committedHash).toBe(server.hash);
        const recoveries = await f.service.invoke("database.recovery.list", {
          projectId: "routine-p",
        });
        const saved = recoveries.find((r: any) => r.consoleId === current.id);
        expect(saved).toBeDefined();
        const restored = await f.service.invoke("database.recovery.restore", {
          projectId: "routine-p",
          id: saved.id,
        });
        expect(restored.sql).toBe(ddl(f.name, 2));
        const applied = await f.apply(4);
        expect(applied.routine.previousHash).toBe(server.hash);
        expect(await f.value()).toBe(4);
      } finally {
        await f.close();
      }
    }, 30000);

    it("advances only the manual session baseline, rolls back repeated edits, then atomically promotes known Commit", async () => {
      const f = await fixture();
      try {
        const initial = await f.read();
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "mode",
          mode: "manual",
        });
        const first = await f.apply(2),
          second = await f.apply(3);
        expect(first.routine.committed).toBe(false);
        expect(second.routine.previousHash).toBe(first.routine.appliedHash);
        expect(await f.value()).toBe(1);
        let current = await f.read();
        expect(current.routineBaseline!.committedHash).toBe(
          initial.routineBaseline!.committedHash,
        );
        expect(current.routineBaseline!.session!.hash).toBe(
          second.routine.appliedHash,
        );
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "rollback",
        });
        current = await f.read();
        expect(current.routineBaseline!.session).toBeUndefined();
        expect(current.sql).toBe(ddl(f.name, 3));
        const third = await f.apply(4);
        expect(third.routine.previousHash).toBe(
          initial.routineBaseline!.committedHash,
        );
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "commit",
          operationId: randomUUID(),
        });
        current = await f.read();
        expect(current.pendingEffect).toBeUndefined();
        expect(current.routineBaseline!.session).toBeUndefined();
        expect(current.routineBaseline!.committedHash).toBe(
          third.routine.appliedHash,
        );
        expect(await f.value()).toBe(4);
        await f.restart();
        expect((await f.read()).routineBaseline!.committedHash).toBe(
          third.routine.appliedHash,
        );
      } finally {
        await f.close();
      }
    }, 30000);

    it("does not promote an abandoned manual transaction on restart; savepoint rollback blocks blind subsequent apply", async () => {
      const f = await fixture();
      try {
        const initial = await f.read();
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "mode",
          mode: "manual",
        });
        await f.apply(2);
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "savepoint",
          name: "routine_before",
        });
        await f.apply(3);
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "rollbackTo",
          name: "routine_before",
        });
        await expect(f.apply(4)).rejects.toThrow(/Rollback to savepoint/);
        await f.restart();
        const current = await f.read();
        expect(current.routineBaseline!.session).toBeUndefined();
        expect(current.routineBaseline!.committedHash).toBe(
          initial.routineBaseline!.committedHash,
        );
        expect(await f.value()).toBe(1);
        await f.service.invoke("database.routine.reload", {
          ...f.params,
          revision: current.revision,
        });
        const applied = await f.apply(5);
        expect(applied.routine.committed).toBe(false);
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "rollback",
        });
      } finally {
        await f.close();
      }
    }, 30000);

    it("requires explicit reload for legacy documents lacking a trusted original baseline", async () => {
      const f = await fixture();
      try {
        await f.restart(true);
        await expect(f.apply(2)).rejects.toThrow(/Исходная версия DDL/);
        expect(await f.value()).toBe(1);
        const current = await f.read();
        await f.service.invoke("database.routine.reload", {
          ...f.params,
          revision: current.revision,
        });
        await f.apply(3);
        expect(await f.value()).toBe(3);
      } finally {
        await f.close();
      }
    }, 30000);

    it("blocks shutdown for active manual transactions and unavailable/timed-out status without changing private DDL", async () => {
      const f = await fixture();
      try {
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "mode",
          mode: "manual",
        });
        const applied = await f.apply(2);
        const current = await f.read();
        await f.service.invoke("database.console.update", {
          ...f.params,
          revision: current.revision,
          closed: true,
        });
        await expect(f.service.assertShutdownReady()).rejects.toThrow(
          /Перед закрытием завершите транзакции БД.*Commit или Rollback/,
        );
        const client = await (f.service as any).clients.get(f.connection.id);
        const originalCall = client.call.bind(client);
        client.call = async (
          operation: string,
          args: Record<string, unknown>,
          options?: { timeoutMs?: number },
        ) => {
          if (operation === "status")
            throw new Error(
              "Controlled unavailable status while PostgreSQL session remains alive",
            );
          return originalCall(operation, args, options);
        };
        try {
          await expect(f.service.assertShutdownReady()).rejects.toThrow(
            /Не удалось подтвердить состояние БД перед закрытием/,
          );
        } finally {
          client.call = originalCall;
        }
        const slow = await slowStatusFixture();
        try {
          client.call = (
            operation: string,
            args: Record<string, unknown>,
            options?: { timeoutMs?: number },
          ) =>
            operation === "status"
              ? slow.client.call("status", args, options)
              : originalCall(operation, args, options);
          const started = performance.now();
          await expect(f.service.assertShutdownReady()).rejects.toThrow(
            /Не удалось подтвердить состояние БД перед закрытием/,
          );
          const elapsed = performance.now() - started;
          expect(elapsed).toBeGreaterThanOrEqual(4500);
          expect(elapsed).toBeLessThan(9000);
          for (let i = 0; i < 80 && !slow.cancellations; i++)
            await new Promise((resolve) => setTimeout(resolve, 25));
          expect(slow.cancellations).toBe(1);
          slow.ready();
          expect(await slow.client.call("status", {})).toEqual({
            leases: [],
            jobs: [],
          });
        } finally {
          client.call = originalCall;
          await slow.close();
        }
        const retained = await f.read();
        expect(retained.routineBaseline!.session!.hash).toBe(
          applied.routine.appliedHash,
        );
        expect(retained.leaseId).toBe(current.leaseId);
        const observed = await f.service.invoke("database.describe", {
          ...f.params,
          oid: retained.object!.oid,
          kind: "function",
        });
        expect(observed.hash).toBe(applied.routine.appliedHash);
        expect(await f.value()).toBe(1);
        await f.service.invoke("database.transaction", {
          ...f.params,
          action: "rollback",
        });
        await expect(f.service.assertShutdownReady()).resolves.toBeUndefined();
        expect(await f.value()).toBe(1);
      } finally {
        await f.close();
      }
    }, 30000);

    it("retains an unknown auto-Commit effect after actual acknowledgement loss and never repeats DDL", async () => {
      const target = new URL(url!),
        sockets = new Set<Socket>();
      let armed = false,
        dropped = false;
      const proxy = createServer((front) => {
        const back = connect(Number(target.port), target.hostname);
        sockets.add(front);
        sockets.add(back);
        for (const socket of [front, back]) {
          socket.on("error", () => {});
          socket.on("close", () => sockets.delete(socket));
        }
        let scan = Buffer.alloc(0),
          held = Buffer.alloc(0);
        front.on("data", (data) => {
          if (!dropped && data.includes(Buffer.from("COMMIT\0"))) armed = true;
          back.write(data);
        });
        back.on("data", (data) => {
          if (!armed) {
            front.write(data);
            return;
          }
          scan = Buffer.concat([scan, data]);
          held = Buffer.concat([held, data]);
          while (scan.length >= 5) {
            const length = scan.readUInt32BE(1) + 1;
            if (scan.length < length) break;
            const packet = scan.subarray(0, length);
            scan = scan.subarray(length);
            if (
              packet[0] === 67 &&
              packet.subarray(5).toString() === "COMMIT\0"
            ) {
              dropped = true;
              armed = false;
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
      const f = await fixture((proxy.address() as any).port);
      try {
        await expect(f.apply(2)).rejects.toThrow();
        expect(dropped).toBe(true);
        expect(await f.value()).toBe(2);
        let current = await f.read();
        expect(current.pendingEffect?.kind).toBe("routine");
        expect(current.pendingEffect?.phase).toBe("unknown");
        const operationId = current.pendingEffect!.operationId;
        await f.restart();
        current = await f.read();
        expect(current.pendingEffect!.operationId).toBe(operationId);
        await expect(f.apply(3)).rejects.toThrow(/несверенная запись/);
        await expect(
          f.service.invoke("database.routine.reload", {
            ...f.params,
            revision: current.revision,
          }),
        ).rejects.toThrow(/сверка/);
        await f.service.invoke("database.effect.resolve", {
          ...f.params,
          operationId,
          outcome: "applied",
          note: "Independent PostgreSQL readback confirms the function returns 2 after the withheld COMMIT acknowledgement.",
        });
        current = await f.read();
        expect(current.routineBaseline!.verified).toBe(false);
        await expect(f.apply(3)).rejects.toThrow(/неизвестен/);
        current = await f.read();
        await f.service.invoke("database.routine.reload", {
          ...f.params,
          revision: current.revision,
        });
        expect(await f.value()).toBe(2);
        await f.apply(3);
        expect(await f.value()).toBe(3);
      } finally {
        await f.close();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      }
    }, 30000);
  },
);
