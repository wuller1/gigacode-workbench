import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export class AcpError extends Error {
  constructor(
    message: string,
    readonly ambiguous = false,
    readonly code?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AcpError";
  }
}
export function redact(value: unknown): string {
  return String(value)
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?[redacted]");
}
export function classifyTransportText(
  body: unknown,
  httpStatus?: number,
): {
  kind: "html_gateway" | "not_json" | "unknown";
  message: string;
  httpStatus?: number;
} {
  const original = String(body).slice(0, 32768);
  const html = /<(?:!doctype\s+html|html|head|body|title|script)\b/i.test(
    original,
  );
  const cleaned = html
    ? original
        .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
        .replace(/<!--[^]*?(?:-->|$)/g, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, " ")
    : original;
  const excerpt = redact(cleaned)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  const known =
    Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599
      ? httpStatus
      : undefined;
  return {
    kind: html ? "html_gateway" : excerpt ? "not_json" : "unknown",
    httpStatus: known,
    message: `${html ? "Gateway returned HTML instead of ACP JSON" : "Invalid ACP response"}${known ? ` (HTTP ${known})` : ""}${excerpt ? `: ${excerpt}` : ""}. HTTP status is ${known ? "provided by the transport" : "not known from this CLI output"}.`,
  };
}
export interface AcpOptions {
  executable: string;
  args: string[];
  cwd: string;
  onUpdate?: (params: any) => void;
  onPermission?: (params: any) => Promise<any>;
  onClose?: (error: Error) => void;
  onDiagnostic?: (text: string) => void;
  startupTimeoutMs?: number;
}
export function launchSpec(
  executable: string,
  args: string[],
  platform = process.platform,
): {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
} {
  if (
    !executable ||
    /[\r\n\0]/.test(executable) ||
    args.some((a) => typeof a !== "string" || /[\r\n\0]/.test(a))
  )
    throw new Error("Invalid CLI executable or arguments.");
  const env = { ...process.env };
  if (/\.(?:c?js|mjs)$/i.test(executable)) {
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    return {
      file: process.execPath,
      args: ["--expose-gc", executable, ...args],
      env,
    };
  }
  if (/\.(?:cmd|bat)$/i.test(executable)) {
    if (platform !== "win32")
      throw new Error(
        "Windows command wrappers require Windows; choose the CLI JavaScript entrypoint or executable.",
      );
    // cmd has different escaping from CreateProcess. Reject expansion/metacharacters instead of guessing.
    if ([executable, ...args].some((a) => /[&|<>^%!()"`]/.test(a)))
      throw new Error(
        "Unsafe .cmd arguments; choose the CLI .js entrypoint or .exe instead.",
      );
    const quoted = [executable, ...args].map((a) => '"' + a + '"').join(" ");
    return {
      file:
        process.env.ComSpec ||
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "cmd.exe",
        ),
      args: ["/d", "/v:off", "/s", "/c", '"' + quoted + '"'],
      env,
      windowsVerbatimArguments: true,
    };
  }
  return { file: executable, args, env };
}
export function windowsTreeTermination(pid: number): {
  file: string;
  args: string[];
} {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Invalid owned process identity.");
  return {
    file: path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    ),
    args: ["/PID", String(pid), "/T", "/F"],
  };
}

/** ACP NDJSON client: one connection per host session, no prompt replay and no guessed extensions. */
export class AcpConnection {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  private ended = false;
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private promptActive = false;
  private ownedSession?: string;
  private stderr = "";
  private termination?: Promise<void>;
  capabilities: any;
  constructor(readonly options: AcpOptions) {}
  get alive(): boolean {
    return !!this.child && !this.ended;
  }
  async start(): Promise<any> {
    if (this.child) throw new Error("ACP connection has already started.");
    const spec = launchSpec(this.options.executable, this.options.args);
    this.child = spawn(spec.file, spec.args, {
      cwd: this.options.cwd,
      env: spec.env,
      stdio: "pipe",
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    this.child.stdout.on("data", (chunk) =>
      this.consume(this.decoder.write(chunk)),
    );
    this.child.stderr.on("data", (chunk) => {
      this.stderr = redact(this.stderr + chunk.toString("utf8")).slice(-8192);
      this.options.onDiagnostic?.(
        redact(chunk.toString("utf8")).slice(0, 2048),
      );
    });
    this.child.on("error", (error: NodeJS.ErrnoException) =>
      this.fail(
        new AcpError(
          `CLI could not start: ${redact(error.message)}`,
          false,
          undefined,
          ["EAGAIN", "EBUSY"].includes(error.code || ""),
        ),
      ),
    );
    this.child.on("exit", (code, signal) =>
      this.fail(
        new AcpError(
          `CLI exited (${code ?? signal ?? "unknown"}). ${this.stderr}`,
          this.promptActive,
        ),
      ),
    );
    this.child.stdin.on("error", (error) =>
      this.fail(
        new AcpError(
          `CLI input disconnected: ${redact(error.message)}`,
          this.promptActive,
        ),
      ),
    );
    this.capabilities = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "gigacode-workbench", version: "0.1.0" },
      },
      this.options.startupTimeoutMs ?? 15000,
    );
    if (this.capabilities?.protocolVersion !== 1) {
      await this.dispose();
      throw new AcpError("Unsupported ACP protocol version.");
    }
    return this.capabilities;
  }
  private consume(text: string): void {
    if (this.ended) return;
    this.buffer += text;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024)
      return this.fail(
        new AcpError(
          `ACP frame exceeded the 8 MiB limit. ${classifyTransportText(this.buffer).message}`,
          this.promptActive,
        ),
      );
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail(
          new AcpError(classifyTransportText(line).message, this.promptActive),
        );
        return;
      }
      if (
        !message ||
        message.jsonrpc !== "2.0" ||
        typeof message !== "object"
      ) {
        this.fail(
          new AcpError(
            "CLI produced an invalid JSON-RPC envelope.",
            this.promptActive,
          ),
        );
        return;
      }
      this.receive(message);
    }
  }
  private receive(message: any): void {
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        if (
          message.method === "session/request_permission" &&
          this.options.onPermission
        ) {
          if (
            this.ownedSession &&
            message.params?.sessionId !== this.ownedSession
          ) {
            this.reply(message.id, undefined, {
              code: -32602,
              message: "Wrong session binding",
            });
            return;
          }
          Promise.resolve()
            .then(() => this.options.onPermission!(message.params))
            .then((result) => this.reply(message.id, result))
            .catch(() =>
              this.reply(message.id, { outcome: { outcome: "cancelled" } }),
            );
        } else
          this.reply(message.id, undefined, {
            code: -32601,
            message: "Client method is not supported",
          });
      } else if (
        message.method === "session/update" ||
        message.method.startsWith("qwen/")
      ) {
        if (
          this.ownedSession &&
          message.params?.sessionId &&
          message.params.sessionId !== this.ownedSession
        )
          return;
        try {
          this.options.onUpdate?.(message.params);
        } catch (e) {
          this.options.onDiagnostic?.(redact(e));
        }
      }
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) return; // late response to a timed-out request cannot settle a new one
    this.pending.delete(message.id);
    if (waiting.timer) clearTimeout(waiting.timer);
    if (message.error) {
      const body =
        message.error.data?.body ??
        message.error.message ??
        "ACP request failed";
      const safe = /<(?:html|!doctype|head|title|script)\b/i.test(String(body))
        ? classifyTransportText(
            body,
            message.error.data?.httpStatus ?? message.error.data?.status,
          ).message
        : redact(body);
      waiting.reject(
        new AcpError(
          safe,
          waiting.method === "session/prompt",
          message.error.code,
        ),
      );
    } else if ("result" in message) waiting.resolve(message.result);
    else
      waiting.reject(
        new AcpError(
          "ACP response has no result or error.",
          waiting.method === "session/prompt",
        ),
      );
  }
  private send(message: object): void {
    if (!this.child || this.ended || this.child.stdin.destroyed)
      throw new AcpError("CLI is disconnected.", this.promptActive);
    const payload = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024)
      throw new AcpError("Outgoing ACP message exceeds the local 4 MiB limit.");
    this.child.stdin.write(payload);
  }
  private reply(id: unknown, result?: unknown, error?: unknown): void {
    if (this.ended) return;
    try {
      this.send({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) });
    } catch {
      /* connection outcome is handled by its owner */
    }
  }
  request(method: string, params: object, timeoutMs = 30000): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new AcpError(
                  `ACP ${method} timed out.`,
                  method === "session/prompt",
                ),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async newSession(params: {
    cwd: string;
    mcpServers: unknown[];
  }): Promise<any> {
    const result = await this.request("session/new", params);
    if (typeof result?.sessionId !== "string" || !result.sessionId)
      throw new AcpError("CLI did not return a session identity.");
    this.ownedSession = result.sessionId;
    return result;
  }
  async prompt(sessionId: string, text: string): Promise<any> {
    if (this.promptActive)
      throw new Error("A prompt is already active in this session.");
    if (sessionId !== this.ownedSession)
      throw new Error("Wrong ACP session binding.");
    this.promptActive = true;
    try {
      return await this.request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text }] },
        0,
      );
    } finally {
      this.promptActive = false;
    }
  }
  cancel(sessionId: string): void {
    if (sessionId !== this.ownedSession)
      throw new Error("Wrong ACP session binding.");
    this.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId },
    });
  }
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<any> {
    return this.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
  }
  private fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.termination ||= this.terminateOwnedTree();
    this.options.onClose?.(error);
  }
  private async terminateOwnedTree(): Promise<void> {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    if (process.platform === "win32") {
      const command = windowsTreeTermination(child.pid);
      const killed = await new Promise<boolean>((resolve) => {
        execFile(
          command.file,
          command.args,
          { shell: false, windowsHide: true, timeout: 4000, maxBuffer: 65536 },
          (error) => resolve(!error),
        );
      });
      if (killed) return;
      this.options.onDiagnostic?.(
        "Could not confirm Windows process-tree termination; remaining external effects require reconciliation.",
      );
    }
    // POSIX receives a graceful signal. External/daemon operations are not claimed to be rolled back.
    child.kill();
  }
  async dispose(): Promise<void> {
    this.fail(new AcpError("CLI connection was closed.", this.promptActive));
    await this.termination;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
