import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Ajv, { type ValidateFunction } from "ajv";
import type { DatabaseConnection } from "../../shared/database";
import type { DatabaseOperation } from "./protocol";
import { Agent } from "undici";
import { trustedCAs } from "./tls";
import { mcpFetch } from "./http";
import { validateDatabaseResponse } from "./response";

export class DatabaseMcpClient {
  readonly client = new Client({
    name: "gigacode-workbench-data",
    version: "1.0.0",
  });
  private validators = new Map<string, ValidateFunction>();
  private httpAgent?: Agent;
  tools: { name: string; description?: string; inputSchema: unknown }[] = [];
  constructor(
    private connection: DatabaseConnection,
    private runtime: {
      node: string;
      provider: string;
      directory: string;
      heapMiB?: number;
    },
    private secret?: string,
  ) {}
  async connect() {
    const c = this.connection;
    let transport;
    if (c.transport === "http") {
      const url = new URL(c.url || "");
      if (
        url.protocol !== "https:" &&
        !(
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          url.protocol === "http:"
        )
      )
        throw new Error("MCP требует HTTPS или локальный HTTP");
      if (url.username || url.password)
        throw new Error("Учётные данные храните отдельно от URL");
      this.httpAgent = new Agent({
        connect: { ca: trustedCAs(c.ca), rejectUnauthorized: true },
      });
      const header = c.secretHeader || "Authorization",
        prefix =
          c.secretPrefix ??
          (header.toLowerCase() === "authorization" ? "Bearer " : "");
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: this.secret ? { [header]: prefix + this.secret } : {},
        },
        fetch: (input, init) => mcpFetch(input, init, this.httpAgent!),
      });
    } else {
      if (c.transport === "stdio" && !c.command)
        throw new Error("Нужен путь к MCP-серверу");
      transport = new StdioClientTransport({
        command:
          c.transport === "postgres-mcp" ? this.runtime.node : c.command!,
        args:
          c.transport === "postgres-mcp"
            ? [
                "--max-old-space-size=" + (this.runtime.heapMiB || 768),
                ...(this.runtime.heapMiB ? ["--max-semi-space-size=4"] : []),
                this.runtime.provider,
              ]
            : c.args || [],
        env: {
          ...getDefaultEnvironment(),
          ...(c.transport === "postgres-mcp"
            ? { WORKBENCH_DATABASE_DIR: this.runtime.directory }
            : {}),
          ...(c.transport === "stdio" && this.secret
            ? { [c.secretEnv || "WORKBENCH_MCP_TOKEN"]: this.secret }
            : {}),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stderr: "pipe",
        maxBufferSize: 10 * 1024 ** 2,
      });
      // Drain, but do not publish arbitrary MCP stderr (it can contain secrets or SQL rows).
      transport.stderr?.on("data", () => {});
    }
    await this.client.connect(transport);
    const ajv = new Ajv({ strict: false, allErrors: true });
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools({ cursor });
      for (const tool of page.tools) {
        if (this.tools.length >= 2000)
          throw new Error("MCP inventory exceeds 2000 tools");
        this.tools.push(tool);
        this.validators.set(tool.name, ajv.compile(tool.inputSchema));
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  inventory() {
    return {
      server: this.client.getServerVersion(),
      capabilities: this.client.getServerCapabilities(),
      tools: this.tools,
    };
  }
  async call(
    operation: DatabaseOperation,
    args: Record<string, unknown>,
  ): Promise<any> {
    const builtin = this.connection.transport === "postgres-mcp";
    const name = builtin
      ? "database_operation"
      : this.connection.bindings?.[operation];
    if (!name || !this.validators.has(name))
      throw Object.assign(
        new Error(
          `MCP не предоставляет адаптированную операцию «${operation}». Проверьте inventory и bindings подключения.`,
        ),
        { outcome: "notApplied" },
      );
    const input = builtin ? { operation, arguments: args } : args;
    const validate = this.validators.get(name)!;
    if (!validate(input))
      throw Object.assign(
        new Error(
          "Аргументы не соответствуют фактической схеме MCP: " +
            JSON.stringify(validate.errors),
        ),
        { outcome: "notApplied" },
      );
    const r = await this.client.callTool(
      { name, arguments: input },
      undefined,
      { timeout: 120000 },
    );
    const parts = Array.isArray(r.content)
      ? r.content.filter((x: any) => x.type === "text").map((x: any) => x.text)
      : [];
    const raw = parts.join("\n");
    if (Buffer.byteLength(raw) > 9 * 1024 ** 2)
      throw new Error("MCP ответ превышает лимит страницы");
    let value: any;
    try {
      value = r.structuredContent || JSON.parse(raw);
    } catch {
      throw new Error(
        r.isError
          ? "MCP вернул ошибку не в формате Data protocol; проверьте адаптер"
          : "MCP ответ не соответствует Data protocol v1",
      );
    }
    if (r.isError || value.error)
      throw Object.assign(
        new Error(value.error?.message || "MCP tool failed"),
        {
          code: value.error?.code,
          position: value.error?.position,
          outcome: value.error?.outcome,
        },
      );
    return validateDatabaseResponse(
      operation,
      Object.prototype.hasOwnProperty.call(value, "value")
        ? value.value
        : value,
      args,
    );
  }
  async close() {
    try {
      await this.client.close();
    } finally {
      await this.httpAgent?.destroy();
    }
  }
}
