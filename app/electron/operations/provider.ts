import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpsHttp } from "./http";
import { JenkinsApi } from "./jenkins";
import { KubernetesApi } from "./kubernetes";
import { operationsToolSchema, operationsProtocol } from "./protocol";
import { failure, normalizeError, redact } from "./errors";
async function main() {
  let http: OpsHttp | undefined,
    api: JenkinsApi | KubernetesApi | undefined,
    secret: string | undefined;
  const server = new Server(
    { name: "workbench-operations-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "operations_operation",
        description:
          "Workbench Operations protocol v1. Real Jenkins/Kubernetes API behind stdio MCP; bounded reads, prepared mutations and read-only reconciliation.",
        inputSchema: operationsToolSchema,
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const p: any = request.params.arguments,
      op = p?.operation,
      input = p?.arguments || {};
    try {
      if (
        request.params.name !== "operations_operation" ||
        !operationsProtocol.includes(op)
      )
        throw failure("unsupported", "Неизвестная Operations operation.");
      let value: any;
      if (op === "configure") {
        if (http)
          throw failure("conflict", "Этот MCP worker уже привязан к target.");
        secret = input.secret;
        http = new OpsHttp(input.connection, secret);
        api =
          input.connection.kind === "jenkins"
            ? new JenkinsApi(http)
            : new KubernetesApi(http);
        value = { configured: true };
      } else {
        if (!api) throw failure("validation", "Operations worker не настроен.");
        if (op === "probe") value = await api.probe();
        else if (op === "prepare")
          value = await api.prepare(input.operation, input.input);
        else if (op === "execute")
          value = await api.execute(input.operation, input.input);
        else if (op === "reconcile")
          value = await api.reconcile(
            input.operation,
            input.input,
            input.remoteId,
            input.data,
          );
        else value = await api.query(op, input);
      }
      return { content: [{ type: "text", text: JSON.stringify({ value }) }] };
    } catch (e) {
      const error = normalizeError(e, op === "execute");
      error.message = redact(error.message, secret);
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error }) }],
      };
    }
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    await http?.close();
    if (api instanceof JenkinsApi) await api.dispose();
    process.exit(0);
  };
  process.stdin.on("end", () => void stop());
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  await server.connect(new StdioServerTransport());
}
void main().catch(() => {
  process.stderr.write("Operations provider could not initialize.\n");
  process.exit(1);
});
