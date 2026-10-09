import * as pty from "@lydell/node-pty";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { windowsTreeTermination } from "./acp";
import type { HostEvent, Project } from "../shared/types";
type TerminalEntry = {
  id: string;
  title: string;
  projectId: string;
  process: pty.IPty;
  history: string;
  closing: boolean;
  exited: boolean;
  exit: Promise<void>;
  resolveExit: () => void;
  dataListener?: pty.IDisposable;
  exitListener?: pty.IDisposable;
  closePromise?: Promise<boolean>;
};
export class TerminalService {
  private items = new Map<string, TerminalEntry>();
  private stopping = false;
  private disposal?: Promise<{ unconfirmed: string[] }>;
  constructor(
    private emit: (e: HostEvent) => void,
    private project: (id: string) => Project,
  ) {}
  shells() {
    if (process.platform === "win32") {
      const system = process.env.SystemRoot || "C:\\Windows";
      return [
        {
          id: "powershell",
          name: "Windows PowerShell 5.1",
          path: path.join(
            system,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          args: ["-NoLogo"],
        },
        {
          id: "cmd",
          name: "Command Prompt",
          path: path.join(system, "System32", "cmd.exe"),
          args: [],
        },
      ];
    }
    const list = [process.env.SHELL, "/bin/zsh", "/bin/bash"].filter(
      (s): s is string => !!s && existsSync(s),
    );
    return [...new Set(list)].map((s) => ({
      id: s,
      name: path.basename(s),
      path: s,
      args: [],
    }));
  }
  async invoke(method: string, p: any) {
    if (this.stopping) throw new Error("Терминалы завершаются");
    if (method === "terminal.shells") return this.shells();
    if (method === "terminal.list")
      return [...this.items.values()].map(
        ({ id, title, projectId, history }) => ({
          id,
          title,
          projectId,
          history,
        }),
      );
    if (method === "terminal.create") {
      if (this.items.size >= 12)
        throw new Error("Открыто 12 терминалов. Закройте неиспользуемый");
      const project = this.project(p.projectId);
      const shell =
        this.shells().find((x) => x.id === p.shellId) || this.shells()[0];
      if (!shell) throw new Error("Оболочка не найдена");
      const id = randomUUID();
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = pty.spawn(shell.path, shell.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd: project.path,
        env: env as Record<string, string>,
      });
      let resolveExit!: () => void;
      const entry: TerminalEntry = {
        id,
        title: shell.name,
        projectId: project.id,
        process: child,
        history: "",
        closing: false,
        exited: false,
        exit: new Promise<void>((resolve) => {
          resolveExit = resolve;
        }),
        resolveExit: () => resolveExit(),
      };
      this.items.set(id, entry);
      entry.dataListener = child.onData((data) => {
        if (this.stopping || entry.closing || entry.exited) return;
        entry.history = (entry.history + data).slice(-150000);
        this.safeEmit({ type: "terminal.data", payload: { id, data } });
      });
      entry.exitListener = child.onExit(({ exitCode }) => {
        if (entry.exited) return;
        entry.exited = true;
        entry.closing = true;
        entry.dataListener?.dispose();
        entry.exitListener?.dispose();
        this.items.delete(id);
        entry.resolveExit();
        if (!this.stopping)
          this.safeEmit({ type: "terminal.exit", payload: { id, exitCode } });
      });
      return { id, title: entry.title, projectId: project.id };
    }
    const item = this.items.get(p.id);
    if (!item) throw new Error("Терминал уже закрыт");
    if (method === "terminal.close") {
      if (!(await this.closeEntry(item)))
        throw new Error(
          "Выход терминала пока не подтверждён; повторный ввод отключён",
        );
      return;
    }
    if (item.closing) throw new Error("Терминал завершается");
    if (method === "terminal.write") {
      if (typeof p.data !== "string" || p.data.length > 65536)
        throw new Error("Слишком большой ввод");
      item.process.write(p.data);
      return;
    }
    if (method === "terminal.resize") {
      if (!Number.isFinite(p.cols) || !Number.isFinite(p.rows))
        throw new Error("Недопустимый размер терминала");
      item.process.resize(
        Math.max(10, Math.min(500, Math.round(p.cols))),
        Math.max(2, Math.min(200, Math.round(p.rows))),
      );
      return;
    }
    if (method === "terminal.rename") {
      item.title = String(p.title || p.name || "Терминал").slice(0, 120);
      return { id: item.id, title: item.title };
    }
    throw new Error("Неизвестное действие терминала");
  }
  private safeEmit(event: HostEvent) {
    // A window can disappear between the main-process ownership check and IPC send.
    // Never throw through a native PTY callback during teardown.
    try {
      this.emit(event);
    } catch {}
  }
  private async waitForExit(item: TerminalEntry, milliseconds: number) {
    if (item.exited) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        item.exit.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private closeEntry(item: TerminalEntry): Promise<boolean> {
    if (item.closePromise) return item.closePromise;
    item.closing = true;
    item.dataListener?.dispose();
    item.closePromise = (async () => {
      if (!item.exited) {
        try {
          item.process.kill();
        } catch {}
      }
      if (!(await this.waitForExit(item, 1500))) {
        if (process.platform === "win32") {
          const spec = windowsTreeTermination(item.process.pid);
          await new Promise<void>((resolve) =>
            execFile(
              spec.file,
              spec.args,
              {
                shell: false,
                windowsHide: true,
                timeout: 4000,
                maxBuffer: 65536,
              },
              () => resolve(),
            ),
          );
        } else {
          try {
            item.process.kill("SIGKILL");
          } catch {}
        }
        await this.waitForExit(item, 1500);
      }
      // onExit resolves inside the native callback; let it and queued stream callbacks unwind.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return item.exited;
    })();
    return item.closePromise;
  }
  dispose(): Promise<{ unconfirmed: string[] }> {
    if (this.disposal) return this.disposal;
    this.stopping = true;
    const entries = [...this.items.values()];
    this.disposal = Promise.all(
      entries.map(async (item) => ({
        id: item.id,
        exited: await this.closeEntry(item),
      })),
    ).then((results) => ({
      unconfirmed: results
        .filter((result) => !result.exited)
        .map((result) => result.id),
    }));
    return this.disposal;
  }
}
