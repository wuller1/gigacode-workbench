import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import { TextDecoder } from "node:util";
import { parseReviewedQwenContextUsage } from "./context-supervisor.js";
import type { ReviewedContextUsage } from "../shared/context.js";

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
export class McpReadinessError extends AcpError {
  constructor(
    readonly kind: "cancelled" | "timeout" | "invalid_status" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "McpReadinessError";
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
  /** Complete child-only environment, useful for isolated probes; never mutates process.env. */
  env?: NodeJS.ProcessEnv;
  onUpdate?: (params: any) => void;
  onPermission?: (params: any) => Promise<any>;
  onClose?: (error: Error) => void;
  onDiagnostic?: (text: string) => void;
  startupTimeoutMs?: number;
}
// yargs/hideBin skips one argv element in a packaged Electron process, even
// with ELECTRON_RUN_AS_NODE. Node-mode children run a JS entrypoint and need
// the usual two-element skip. Set this child-only marker before importing the
// unchanged CLI; otherwise its entrypoint becomes a positional prompt.
export const ELECTRON_NODE_ARGV_IMPORT =
  "data:text/javascript,if(process.versions.electron%26%26process.env.ELECTRON_RUN_AS_NODE%3D%3D%3D'1')process.defaultApp%3Dtrue%3B";
export function javascriptEntrypointArgs(
  executable: string,
  electron = Boolean(process.versions.electron),
): string[] {
  return [
    "--expose-gc",
    ...(electron ? ["--import", ELECTRON_NODE_ARGV_IMPORT] : []),
    executable,
  ];
}
export function launchSpec(
  executable: string,
  args: string[],
  platform = process.platform,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
} {
  if (
    !executable ||
    /[\r\n\0]/.test(executable) ||
    args.some((a) => typeof a !== "string" || /\0/.test(a))
  )
    throw new Error("Invalid CLI executable or arguments.");
  const env = { ...inheritedEnv };
  if (/\.(?:c?js|mjs)$/i.test(executable)) {
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    return {
      file: process.execPath,
      args: [...javascriptEntrypointArgs(executable), ...args],
      env,
    };
  }
  if (/\.(?:cmd|bat)$/i.test(executable)) {
    if (platform !== "win32")
      throw new Error(
        "Windows command wrappers require Windows; choose the CLI JavaScript entrypoint or executable.",
      );
    // cmd has different escaping from CreateProcess. Reject expansion/metacharacters instead of guessing.
    if ([executable, ...args].some((a) => /[\r\n&|<>^%!()"`]/.test(a)))
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
      cleanupAbort?: () => void;
      method: string;
    }
  >();
  private ended = false;
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private exitDrainTimer?: ReturnType<typeof setTimeout>;
  private promptActive = false;
  private ownedSession?: string;
  private stderr = "";
  private stderrBuffer = "";
  private stderrDiscarding = false;
  private stderrDecoder = new TextDecoder("utf-8");
  private termination?: Promise<void>;
  private mcpReadinessAbort?: AbortController;
  capabilities: any;
  constructor(readonly options: AcpOptions) {}
  get alive(): boolean {
    return !!this.child && !this.ended;
  }
  async start(): Promise<any> {
    if (this.child) throw new Error("ACP connection has already started.");
    const spec = launchSpec(
      this.options.executable,
      this.options.args,
      process.platform,
      this.options.env ?? process.env,
    );
    this.child = spawn(spec.file, spec.args, {
      cwd: this.options.cwd,
      env: spec.env,
      stdio: "pipe",
      shell: false,
      windowsHide: true,
      // Own a separate POSIX process group so retiring this CLI also retires
      // ordinary MCP/command descendants without signalling the app's group.
      detached: process.platform !== "win32",
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    this.child.stdout.on("data", (chunk) => {
      try {
        this.consume(this.decoder.decode(chunk, { stream: true }));
      } catch {
        this.fail(
          new AcpError(
            "CLI produced invalid UTF-8 ACP output.",
            this.promptActive,
          ),
        );
      }
    });
    this.child.stdout.once("end", () => {
      if (this.ended) return;
      try {
        this.consume(this.decoder.decode());
      } catch {
        this.fail(
          new AcpError(
            "CLI ended with incomplete or invalid UTF-8 ACP output.",
            this.promptActive,
          ),
        );
        return;
      }
      if (this.buffer.trim())
        this.fail(
          new AcpError(
            `CLI ended with an incomplete ACP frame. ${classifyTransportText(this.buffer).message}`,
            this.promptActive,
          ),
        );
      else
        this.exitDrainTimer ||= setTimeout(
          () =>
            this.fail(
              new AcpError(
                `CLI output stream closed before process close. ${this.stderr}`,
                this.promptActive,
              ),
            ),
          1000,
        );
    });
    this.child.stderr.on("data", (chunk) => {
      this.consumeStderr(this.stderrDecoder.decode(chunk, { stream: true }));
    });
    this.child.stderr.once("end", () =>
      this.consumeStderr(this.stderrDecoder.decode(), true),
    );
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
    // exit may precede the final pipe data. close follows drained stdio; an
    // exited parent whose descendant holds a pipe must still fail boundedly.
    this.child.on("exit", (code, signal) => {
      if (this.ended) return;
      this.exitDrainTimer ||= setTimeout(
        () =>
          this.fail(
            new AcpError(
              `CLI exited (${code ?? signal ?? "unknown"}) before its output stream closed. ${this.stderr}`,
              this.promptActive,
            ),
          ),
        1000,
      );
    });
    this.child.on("close", (code, signal) =>
      this.fail(
        new AcpError(
          `CLI closed (${code ?? signal ?? "unknown"}). ${this.stderr}`,
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
  private consumeStderr(text: string, end = false): void {
    const publish = (line: string) => {
      const safe =
        Buffer.byteLength(line) > 8192
          ? "[CLI stderr line exceeded 8 KiB; content omitted]"
          : redact(line);
      this.stderr = (this.stderr + safe + "\n").slice(-8192);
      this.options.onDiagnostic?.(safe.slice(0, 2048));
    };
    this.stderrBuffer += text;
    let index: number;
    while ((index = this.stderrBuffer.indexOf("\n")) >= 0) {
      if (!this.stderrDiscarding) publish(this.stderrBuffer.slice(0, index));
      this.stderrBuffer = this.stderrBuffer.slice(index + 1);
      this.stderrDiscarding = false;
    }
    if (Buffer.byteLength(this.stderrBuffer) > 8192) {
      if (!this.stderrDiscarding)
        publish("[CLI stderr line exceeded 8 KiB; content omitted]");
      this.stderrBuffer = "";
      this.stderrDiscarding = true;
    }
    if (end) {
      if (this.stderrBuffer && !this.stderrDiscarding)
        publish(this.stderrBuffer);
      this.stderrBuffer = "";
      this.stderrDiscarding = false;
    }
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
    waiting.cleanupAbort?.();
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
  request(
    method: string,
    params: object,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new AcpError("ACP request was aborted."));
        return;
      }
      const abort = () => {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? new AcpError("ACP request was aborted."));
      };
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              signal?.removeEventListener("abort", abort);
              reject(
                new AcpError(
                  `ACP ${method} timed out.`,
                  method === "session/prompt",
                ),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        method,
        cleanupAbort: () => signal?.removeEventListener("abort", abort),
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
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
  /** Read-only extension. Owner MUST gate on the exact reviewed Qwen bytes; forks need their own adapter. */
  async getContextUsage(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ReviewedContextUsage> {
    if (!this.ownedSession || sessionId !== this.ownedSession)
      throw new AcpError("Wrong ACP session for context usage.");
    // detail=false avoids loading full file/tool bodies and cannot trigger a model request.
    const result = await this.request(
      "qwen/status/session/context_usage",
      { sessionId, detail: false },
      5000,
      signal,
    );
    return parseReviewedQwenContextUsage(result, sessionId);
  }
  /** Exact reviewed Qwen extension only; the host decides whether it may be used. */
  async waitForMcpReady(
    sessionId: string,
    serverName: string,
    timeoutMs = 30000,
  ): Promise<void> {
    if (sessionId !== this.ownedSession)
      throw new McpReadinessError(
        "invalid_status",
        "Wrong ACP session for MCP readiness.",
      );
    if (this.mcpReadinessAbort)
      throw new McpReadinessError(
        "invalid_status",
        "MCP readiness is already being checked.",
      );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000)
      throw new McpReadinessError(
        "invalid_status",
        "Invalid MCP readiness deadline.",
      );
    const controller = new AbortController();
    this.mcpReadinessAbort = controller;
    const timeout = new McpReadinessError(
      "timeout",
      "MCP discovery did not become ready before its deadline; input was not dispatched.",
    );
    const timer = setTimeout(() => controller.abort(timeout), timeoutMs);
    try {
      while (true) {
        controller.signal.throwIfAborted();
        let result: any;
        try {
          result = await this.request(
            "qwen/status/session/resources",
            { sessionId },
            0,
            controller.signal,
          );
          controller.signal.throwIfAborted();
        } catch (error) {
          if (error instanceof McpReadinessError) throw error;
          throw new McpReadinessError(
            "unavailable",
            "Reviewed Qwen MCP status could not be read: " +
              redact(error instanceof Error ? error.message : error).slice(
                0,
                600,
              ),
          );
        }
        if (
          !result ||
          result.sessionId !== sessionId ||
          result.mcp?.initialized !== true ||
          !["not_started", "in_progress", "completed"].includes(
            result.mcp?.discoveryState,
          ) ||
          !Array.isArray(result.mcp?.servers) ||
          (result.mcp.errors !== undefined && !Array.isArray(result.mcp.errors))
        )
          throw new McpReadinessError(
            "invalid_status",
            "Qwen returned an invalid session-bound MCP status; input was not dispatched.",
          );
        const matches = result.mcp.servers.filter(
          (server: any) => server?.name === serverName,
        );
        if (matches.length === 0 && result.mcp.discoveryState !== "completed") {
          // Configuration/discovery may still be arriving progressively.
        } else if (
          matches.length !== 1 ||
          typeof matches[0].disabled !== "boolean" ||
          ![
            "ok",
            "warning",
            "error",
            "disabled",
            "not_started",
            "unknown",
          ].includes(matches[0].status) ||
          !["connected", "connecting", "disconnected"].includes(
            matches[0].mcpStatus,
          )
        )
          throw new McpReadinessError(
            "invalid_status",
            "Qwen did not report the configured host MCP server unambiguously; input was not dispatched.",
          );
        const server = matches[0];
        if (
          server &&
          (server.disabled ||
            ["pending", "rejected"].includes(server.approvalState) ||
            server.authenticationState === "failed")
        )
          throw new McpReadinessError(
            "unavailable",
            "The host MCP server is disabled, unapproved or unavailable; input was not dispatched.",
          );
        if (result.mcp.discoveryState === "completed") {
          if (server?.mcpStatus === "connected" && server.status === "ok")
            return;
          throw new McpReadinessError(
            "unavailable",
            "Host MCP discovery finished without a connected server; input was not dispatched.",
          );
        }
        await new Promise<void>((resolve, reject) => {
          if (controller.signal.aborted) {
            reject(controller.signal.reason);
            return;
          }
          const abort = () => {
            clearTimeout(poll);
            reject(controller.signal.reason);
          };
          const poll = setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, 100);
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      }
    } finally {
      clearTimeout(timer);
      if (this.mcpReadinessAbort === controller)
        this.mcpReadinessAbort = undefined;
    }
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
    this.cancelMcpReadiness();
    this.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId },
    });
  }
  cancelMcpReadiness(): void {
    this.mcpReadinessAbort?.abort(
      new McpReadinessError(
        "cancelled",
        "MCP readiness was cancelled before input dispatch.",
      ),
    );
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
    this.mcpReadinessAbort?.abort(
      new McpReadinessError(
        "cancelled",
        "CLI closed during MCP readiness; input was not dispatched.",
      ),
    );
    if (this.exitDrainTimer) clearTimeout(this.exitDrainTimer);
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.cleanupAbort?.();
      item.reject(error);
    }
    this.pending.clear();
    this.termination ||= this.terminateOwnedTree();
    this.options.onClose?.(error);
  }
  private async terminateOwnedTree(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    if (process.platform === "win32") {
      if (child.exitCode !== null || child.signalCode !== null) return;
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
      child.kill();
      return;
    }
    const pid = child.pid;
    const signalGroup = (signal: NodeJS.Signals): boolean => {
      try {
        process.kill(-pid, signal);
        return true;
      } catch (error: any) {
        if (error.code === "ESRCH") return false;
        // Preserve a direct-child fallback if group signalling is unavailable.
        child.kill(signal);
        return false;
      }
    };
    if (!signalGroup("SIGTERM")) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(deadline);
        clearInterval(probe);
        resolve();
      };
      const probe = setInterval(() => {
        try {
          process.kill(-pid, 0);
        } catch (error: any) {
          if (error.code === "ESRCH") finish();
        }
      }, 25);
      const deadline = setTimeout(() => {
        signalGroup("SIGKILL");
        finish();
      }, 1500);
    });
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
