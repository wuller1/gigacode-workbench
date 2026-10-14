import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent } from "undici";
import Ajv, { type ValidateFunction } from "ajv";
import { createHash } from "node:crypto";
import type {
  OpsConnection,
  OpsError,
  OpsInventory,
  OpsOperation,
} from "../../shared/operations";
import { trustedCAs } from "../database/tls";
import { mcpFetch } from "../database/http";
import { checkedUrl } from "./http";
import { OpsFailure, failure, normalizeError, redact } from "./errors";
export class OpsMcpClient {
  onclose?: () => void;
  private client = new Client({
    name: "gigacode-workbench-operations",
    version: "1.0.0",
  });
  private validators = new Map<string, ValidateFunction>();
  private agent?: Agent;
  private discovered!: OpsInventory;
  constructor(
    private connection: OpsConnection,
    private runtime: { node: string; provider: string },
    private secret?: string,
  ) {
    this.client.onclose = () => this.onclose?.();
  }
  private scrub(value: any): any {
    return typeof value === "string"
      ? redact(
          redact(value, this.secret),
          this.secret && this.connection.username
            ? this.connection.username + ":" + this.secret
            : undefined,
        )
      : Array.isArray(value)
        ? value.map((v) => this.scrub(v))
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, this.scrub(v)]),
            )
          : value;
  }
  async connect() {
    const c = this.connection;
    if (c.transport === "http") {
      const url = checkedUrl(c.url || "");
      this.agent = new Agent({
        connect: { ca: trustedCAs(c.ca), rejectUnauthorized: true },
      });
      await this.client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: this.secret
              ? {
                  [c.secretHeader || "Authorization"]:
                    (c.secretPrefix ?? "Bearer ") + this.secret,
                }
              : {},
          },
          fetch: (input, init) => mcpFetch(input, init, this.agent!),
        }),
      );
    } else {
      const transport = new StdioClientTransport({
        command: c.transport === "builtin" ? this.runtime.node : c.command!,
        args:
          c.transport === "builtin" ? [this.runtime.provider] : c.args || [],
        env: {
          ...getDefaultEnvironment(),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          ...(c.transport === "stdio" && this.secret
            ? { [c.secretEnv || "WORKBENCH_MCP_TOKEN"]: this.secret }
            : {}),
        },
        stderr: "pipe",
        maxBufferSize: 5 * 1024 ** 2,
      });
      transport.stderr?.on("data", () => {});
      await this.client.connect(transport);
    }
    await this.inventory();
    if (c.transport === "builtin")
      await this.call("configure", { connection: c, secret: this.secret });
  }
  async inventory(): Promise<OpsInventory> {
    const tools: OpsInventory["tools"] = [],
      seen = new Set<string>();
    let cursor: string | undefined;
    const ajv = new Ajv({ strict: false, allErrors: true });
    this.validators.clear();
    do {
      const page = await this.client.listTools({ cursor });
      for (const t of page.tools) {
        if (tools.length >= 1000 || seen.has(t.name))
          throw failure(
            "protocol",
            "MCP inventory слишком велик либо содержит повтор tool name.",
          );
        seen.add(t.name);
        this.validators.set(t.name, ajv.compile(t.inputSchema));
        tools.push({
          name: t.name,
          description: t.description?.slice(0, 4000),
          inputSchema: t.inputSchema,
        });
      }
      if (page.nextCursor === cursor && cursor)
        throw failure("protocol", "MCP inventory повторяет cursor.");
      cursor = page.nextCursor;
    } while (cursor);
    const sanitized = this.scrub(tools);
    if (Buffer.byteLength(JSON.stringify(sanitized)) > 1024 ** 2)
      throw failure("payload_too_large", "MCP inventory превышает1MiB.");
    const schemaHash = createHash("sha256")
      .update(
        JSON.stringify([...tools].sort((a, b) => a.name.localeCompare(b.name))),
      )
      .digest("hex");
    const server = this.client.getServerVersion();
    this.discovered = {
      server: { name: server?.name || "MCP", version: server?.version },
      tools: sanitized,
      schemaHash,
      capabilities: [],
      observedAt: new Date().toISOString(),
    };
    return structuredClone(this.discovered);
  }
  async call(
    operation:
      | OpsOperation
      | "configure"
      | "probe"
      | "prepare"
      | "execute"
      | "reconcile",
    input: Record<string, any>,
    options: {
      timeoutMs?: number;
      actionOperation?: OpsOperation;
      dispatched?: boolean;
    } = {},
  ) {
    const builtin = this.connection.transport === "builtin";
    const key =
      operation === "execute" &&
      options.actionOperation &&
      !this.connection.bindings?.execute
        ? options.actionOperation
        : operation;
    const name = builtin
      ? "operations_operation"
      : this.connection.bindings?.[
          key as keyof NonNullable<OpsConnection["bindings"]>
        ];
    if (!name || !this.validators.has(name))
      throw failure(
        "unsupported",
        `MCP binding для ${operation} не настроен/не обнаружен. Проверьте inventory.`,
      );
    const args = builtin
      ? { operation, arguments: input }
      : key === options.actionOperation
        ? input.input
        : input;
    if (!this.validators.get(name)!(args))
      throw failure(
        "validation",
        "Аргументы не соответствуют фактической MCP tool schema.",
      );
    try {
      const timeout = options.timeoutMs || 30000;
      const response: any = await this.client.callTool(
        { name, arguments: args as Record<string, unknown> },
        undefined,
        { timeout, maxTotalTimeout: timeout, resetTimeoutOnProgress: false },
      );
      const raw = (response.content || [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      if (Buffer.byteLength(raw) > 4 * 1024 ** 2)
        throw failure(
          "payload_too_large",
          "MCP ответ превышает4MiB.",
          options.dispatched ? "unknown" : "notApplied",
        );
      let value: any;
      try {
        value = response.structuredContent || JSON.parse(raw);
      } catch {
        throw failure(
          "protocol",
          "MCP Operations ответ не JSON; HTML не считается успехом.",
          options.dispatched ? "unknown" : "notApplied",
        );
      }
      if (response.isError || value.error) {
        const upstream = value.error;
        const kinds: OpsError["kind"][] = [
          "unauthenticated",
          "forbidden",
          "not_found",
          "validation",
          "conflict",
          "payload_too_large",
          "rate_limited",
          "offline",
          "timeout",
          "unsupported",
          "protocol",
          "unknown",
        ];
        const error: OpsError = {
          kind: kinds.includes(upstream?.kind) ? upstream.kind : "protocol",
          message: this.scrub(
            String(upstream?.message || "MCP Operations tool вернул ошибку."),
          ).slice(0, 2000),
          outcome:
            upstream?.outcome === "unknown" ||
            upstream?.outcome === "notApplied"
              ? upstream.outcome
              : options.dispatched
                ? "unknown"
                : "notApplied",
          ...(Number.isSafeInteger(upstream?.status) &&
          upstream.status >= 100 &&
          upstream.status <= 599
            ? { status: upstream.status }
            : {}),
          ...(typeof upstream?.retryAfterMs === "number" &&
          Number.isFinite(upstream.retryAfterMs) &&
          upstream.retryAfterMs >= 0
            ? { retryAfterMs: Math.min(upstream.retryAfterMs, 3600000) }
            : {}),
        };
        throw new OpsFailure(error);
      }
      const result = Object.hasOwn(value, "value") ? value.value : value;
      if (
        operation === "prepare" &&
        result?.input &&
        JSON.stringify(result.input) !==
          JSON.stringify(this.scrub(result.input))
      )
        throw failure(
          "unsupported",
          "MCP prepare содержит credentials в action input. Нужен защищённый adapter/secretRef; редактированный payload не исполняется.",
        );
      return this.scrub(result);
    } catch (e) {
      if (e instanceof OpsFailure) throw e;
      throw new OpsFailure(normalizeError(e, !!options.dispatched));
    }
  }
  async close() {
    await Promise.allSettled([this.client.close(), this.agent?.close()]);
  }
}
