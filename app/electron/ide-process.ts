import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import type { Project } from "../shared/types";
import { redact } from "./acp";

export interface IdeEngine {
  id: string;
  root: string;
  projectIds: Set<string>;
  status: "starting" | "ready" | "stopped" | "failed";
  port?: number;
  token: string;
  child?: ChildProcess;
  error?: string;
  logPath: string;
  configPath: string;
  ready?: Promise<IdeEngine>;
  logWrites?: Promise<unknown>;
  toolchains?: {
    languageServerJavaHome?: string;
    defaultBuildJavaHome?: string;
    mavenHome?: string;
    managedJavaVersion?: string;
    managedMavenVersion?: string;
  };
}
export interface IdeProcessOptions {
  runtimeRoot: string;
  nodePath: string;
  dataDir: string;
  entrypoint?: string;
  changed: () => void;
  startupTimeoutMs?: number;
  toolchainsRoot?: string;
}
export class IdeProcessPool {
  readonly engines = new Map<string, IdeEngine>();
  private starting = new Map<string, Promise<IdeEngine>>();
  private closing = false;
  constructor(readonly options: IdeProcessOptions) {}
  snapshot() {
    return [...this.engines.values()].map((engine) => ({
      id: engine.id,
      root: engine.root,
      projectIds: [...engine.projectIds],
      status: engine.status,
      pid: engine.child?.pid,
      error: engine.error,
      logPath: engine.logPath,
      toolchains: engine.toolchains,
      engine: "theia",
      version: "1.76.0",
    }));
  }
  async ensure(project: Project): Promise<IdeEngine> {
    if (this.closing) throw new Error("IDE is shutting down");
    const root = await fs.realpath(project.path);
    if (this.closing) throw new Error("IDE is shutting down");
    const identity = process.platform === "win32" ? root.toLowerCase() : root;
    const id = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const pending = this.starting.get(id);
    if (pending) {
      const engine = await pending;
      engine.projectIds.add(project.id);
      return engine;
    }
    const existing = this.engines.get(id);
    if (existing?.child && ["starting", "ready"].includes(existing.status)) {
      existing.projectIds.add(project.id);
      return existing.ready || existing;
    }
    const startup = this.start(project, root, id).finally(() =>
      this.starting.delete(id),
    );
    this.starting.set(id, startup);
    return startup;
  }
  private async start(
    project: Project,
    root: string,
    id: string,
  ): Promise<IdeEngine> {
    const previous = this.engines.get(id);
    if (previous?.child) await this.terminate(previous);
    const entrypoint =
      this.options.entrypoint ||
      path.join(this.options.runtimeRoot, "src-gen/backend/main.js");
    if (
      !(await fs.stat(entrypoint).catch(() => undefined))?.isFile() ||
      !(await fs.stat(this.options.nodePath).catch(() => undefined))?.isFile()
    ) {
      throw new Error(
        "IDE_NOT_INSTALLED: выполните npm run setup:ide из app; сборка должна включать IDE runtime",
      );
    }
    const directory = path.join(this.options.dataDir, "ide", id);
    await fs.mkdir(directory, { recursive: true });
    const configPath = path.join(directory, "config");
    await fs.mkdir(configPath, { recursive: true });
    const toolchains = await this.toolchains();
    await fs
      .writeFile(
        path.join(configPath, "settings.json"),
        JSON.stringify(
          {
            "workbench.colorTheme": "workbench-dark",
            "workbench.startupEditor": "none",
            "editor.fontSize": 13,
            "editor.minimap.enabled": false,
            "files.autoSave": "off",
            "python.languageServer": "None",
            "security.workspace.trust.enabled": false,
            "telemetry.enableTelemetry": false,
            "telemetry.telemetryLevel": "off",
            "redhat.telemetry.enabled": false,
            "java.compile.nullAnalysis.mode": "automatic",
            "java.inlayHints.parameterNames.enabled": "none",
            "extensions.autoUpdate": false,
            "extensions.ignoreRecommendations": true,
            "java.configuration.updateBuildConfiguration": "automatic",
            "java.server.launchMode": "Standard",
            "java.import.gradle.wrapper.enabled": true,
            "terminal.integrated.fontSize": 13,
            "workbench.reduceMotion": "off",
            ...(toolchains.languageServerJavaHome
              ? { "java.jdt.ls.java.home": toolchains.languageServerJavaHome }
              : {}),
            ...(toolchains.mavenHome
              ? {
                  "maven.executable.path": path.join(
                    toolchains.mavenHome,
                    "bin",
                    process.platform === "win32" ? "mvn.cmd" : "mvn",
                  ),
                  "maven.executable.preferMavenWrapper": true,
                }
              : {}),
          },
          null,
          2,
        ),
        { flag: "wx" },
      )
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    if (this.closing) throw new Error("IDE is shutting down");
    const engine: IdeEngine = {
      id,
      root,
      projectIds: new Set([project.id]),
      status: "starting",
      token: randomBytes(32).toString("hex"),
      configPath,
      logPath: path.join(directory, "backend.log"),
      toolchains,
    };
    this.engines.set(id, engine);
    const child = spawn(
      this.options.nodePath,
      [
        entrypoint,
        root,
        "--hostname=127.0.0.1",
        "--port=0",
        `--plugins=local-dir:${path.join(this.options.runtimeRoot, "plugins")}`,
      ],
      {
        cwd: this.options.runtimeRoot,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          THEIA_CONFIG_DIR: configPath,
          THEIA_DEFAULT_PLUGINS: `local-dir:${path.join(this.options.runtimeRoot, "plugins")}`,
          WORKBENCH_IDE_TOKEN: engine.token,
          WORKBENCH_IDE_ROOT: root,
          ...(toolchains.defaultBuildJavaHome
            ? { JAVA_HOME: toolchains.defaultBuildJavaHome }
            : {}),
          ...(toolchains.mavenHome ? { MAVEN_HOME: toolchains.mavenHome } : {}),
          // Keep native modules on the pinned independent Node ABI, including extension-host children.
          PATH: [
            path.dirname(this.options.nodePath),
            toolchains.defaultBuildJavaHome &&
              path.join(toolchains.defaultBuildJavaHome, "bin"),
            toolchains.mavenHome && path.join(toolchains.mavenHome, "bin"),
            process.env.PATH || "",
          ]
            .filter(Boolean)
            .join(path.delimiter),
        },
      },
    );
    engine.child = child;
    let carry = "",
      settled = false;
    let logWrites: Promise<unknown> = Promise.resolve();
    const writeLog = (chunk: Buffer) => {
      const safe = redact(chunk.toString("utf8"))
        .replaceAll(engine.token, "[REDACTED]")
        .slice(0, 32768);
      logWrites = logWrites
        .catch(() => {})
        .then(async () => {
          const size = await fs.stat(engine.logPath).then(
            (stat) => stat.size,
            () => 0,
          );
          if (size > 5 * 1024 * 1024)
            await fs
              .rename(engine.logPath, engine.logPath + ".previous")
              .catch(() => {});
          await fs.appendFile(engine.logPath, safe);
        });
      engine.logWrites = logWrites;
    };
    engine.ready = new Promise<IdeEngine>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        engine.status = "failed";
        engine.error = "IDE_START_TIMEOUT";
        void this.terminate(engine);
        this.options.changed();
        reject(new Error(engine.error));
      }, this.options.startupTimeoutMs || 90_000);
      const failed = (error: Error) => {
        clearTimeout(timer);
        engine.status = "failed";
        engine.error = redact(error.message);
        this.options.changed();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      child.once("error", failed);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        engine.child = undefined;
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* Process group has already exited. */
          }
        }
        if (engine.status !== "failed") {
          engine.status =
            code === 0 || signal === "SIGTERM" ? "stopped" : "failed";
          if (engine.status === "failed")
            engine.error = `IDE_PROCESS_EXITED: ${code ?? signal}`;
        }
        this.options.changed();
        if (!settled) {
          settled = true;
          reject(new Error(engine.error || "IDE stopped before startup"));
        }
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        writeLog(chunk);
        carry = (carry + chunk.toString("utf8")).slice(-65536);
        let newline;
        while ((newline = carry.indexOf("\n")) >= 0) {
          const line = carry.slice(0, newline);
          carry = carry.slice(newline + 1);
          const index = line.indexOf("WORKBENCH_IDE_READY ");
          if (index < 0 || settled) continue;
          try {
            const info = JSON.parse(
              line.slice(index + "WORKBENCH_IDE_READY ".length),
            );
            if (
              !Number.isInteger(info.port) ||
              info.port < 1 ||
              info.port > 65535
            )
              continue;
            engine.port = info.port;
            engine.status = "ready";
            settled = true;
            clearTimeout(timer);
            this.options.changed();
            resolve(engine);
          } catch {
            /* A partial or unrelated log line is not readiness. */
          }
        }
      });
      child.stderr?.on("data", writeLog);
    });
    this.options.changed();
    return engine.ready;
  }
  private async toolchains(): Promise<NonNullable<IdeEngine["toolchains"]>> {
    if (!this.options.toolchainsRoot) return {};
    const directory = this.options.toolchainsRoot;
    const bindings = await fs
      .readFile(path.join(directory, "bindings.json"), "utf8")
      .then((value) => JSON.parse(value))
      .catch(() => ({}));
    const binding = bindings[`${process.platform}-${process.arch}`];
    if (!binding) return {};
    const resolve = (relative: unknown) => {
      if (typeof relative !== "string") return undefined;
      const resolved = path.resolve(directory, relative),
        within = path.relative(directory, resolved);
      return within === ".." ||
        within.startsWith(".." + path.sep) ||
        path.isAbsolute(within)
        ? undefined
        : resolved;
    };
    const javaHome = resolve(binding.javaHome),
      mavenHome = resolve(binding.mavenHome);
    const validJava =
      javaHome &&
      (
        await fs
          .stat(
            path.join(
              javaHome,
              "bin",
              process.platform === "win32" ? "java.exe" : "java",
            ),
          )
          .catch(() => undefined)
      )?.isFile();
    return {
      languageServerJavaHome: validJava ? javaHome : undefined,
      defaultBuildJavaHome:
        process.env.JAVA_HOME || (validJava ? javaHome : undefined),
      mavenHome,
      managedJavaVersion: binding.javaVersion,
      managedMavenVersion: binding.mavenVersion,
    };
  }
  async terminate(engine: IdeEngine): Promise<void> {
    const failed = engine.status === "failed";
    const child = engine.child;
    if (!child?.pid) return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("error", () => {
          child.kill();
          resolve();
        });
        killer.once("exit", () => resolve());
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (engine.child?.pid) {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGKILL",
        );
      } catch {
        /* Already exited. */
      }
    }
    await engine.logWrites?.catch(() => {});
    engine.child = undefined;
    engine.status = failed ? "failed" : "stopped";
    this.options.changed();
  }
  async dispose(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(
      [...this.engines.values()].map((engine) => this.terminate(engine)),
    );
  }
}
