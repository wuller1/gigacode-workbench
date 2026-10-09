import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project } from "../shared/types";
const exec = promisify(execFile);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const bom = Buffer.from([0xef, 0xbb, 0xbf]);
function utf8(bytes: Buffer) {
  if (bytes.includes(0))
    throw new Error("Двоичный файл нельзя открыть как текст");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "Кодировка файла не UTF-8. Откройте его в редакторе с поддержкой этой кодировки; файл не изменён",
    );
  }
}
async function readVersion(file: string) {
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 2 * 1024 * 1024)
      throw new Error("Просмотр поддерживает текстовые файлы до 2 МБ");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      bytes.length > 2 * 1024 * 1024
    )
      throw new Error("Файл изменился во время чтения; перечитайте его");
    return { bytes, text: utf8(bytes), stat: after, hash: sha(bytes) };
  } finally {
    await handle.close();
  }
}
export function isWithin(root: string, file: string) {
  const rel = path.relative(root, file);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export async function scopedPath(
  project: Project,
  requested = "",
  create = false,
) {
  const root = await fs.realpath(project.path);
  const dest = path.resolve(root, requested || ".");
  if (!isWithin(root, dest))
    throw new Error("Путь находится за пределами проекта");
  let actual: string;
  try {
    actual = await fs.realpath(dest);
  } catch (error: any) {
    if (!create || error.code !== "ENOENT") throw error;
    actual = path.join(
      await fs.realpath(path.dirname(dest)),
      path.basename(dest),
    );
  }
  if (!isWithin(root, actual))
    throw new Error("Ссылка ведёт за пределы проекта");
  return { root, full: actual, relative: path.relative(root, actual) };
}
const locked = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, action: () => Promise<T>) {
  const before = locked.get(key) || Promise.resolve();
  const p = before.catch(() => {}).then(action);
  locked.set(key, p);
  try {
    return await p;
  } finally {
    if (locked.get(key) === p) locked.delete(key);
  }
}
export class Workspace {
  private reads = new Map<string, { mtime: number; hash: string }>();
  constructor(
    private getProject: (id: string) => Project,
    private trash: (p: string) => Promise<void>,
  ) {}
  async invoke(method: string, p: any) {
    const project = this.getProject(String(p.projectId || ""));
    if (method.startsWith("git.")) return this.git(method, project, p);
    const loc = await scopedPath(
      project,
      String(p.path || ""),
      method === "fs.create" || method === "fs.write",
    );
    if (method === "fs.list") {
      const entries = await fs.readdir(loc.full, { withFileTypes: true });
      const result = await Promise.all(
        entries
          .filter(
            (x) => ![".git", "node_modules", ".DS_Store"].includes(x.name),
          )
          .slice(0, 2000)
          .map(async (x) => {
            const full = path.join(loc.full, x.name);
            let stat;
            try {
              stat = await fs.stat(full);
            } catch {
              return null;
            }
            return {
              name: x.name,
              path: path.relative(loc.root, full),
              directory: stat.isDirectory(),
              size: stat.size,
              symlink: x.isSymbolicLink(),
            };
          }),
      );
      return result
        .filter(Boolean)
        .sort(
          (a: any, b: any) =>
            Number(b.directory) - Number(a.directory) ||
            a.name.localeCompare(b.name),
        );
    }
    if (method === "fs.read") {
      const version = await readVersion(loc.full);
      this.reads.set(loc.full, {
        mtime: version.stat.mtimeMs,
        hash: version.hash,
      });
      while (this.reads.size > 200)
        this.reads.delete(this.reads.keys().next().value!);
      return {
        text: version.text,
        path: loc.relative,
        mtime: version.stat.mtimeMs,
        hash: version.hash,
      };
    }
    if (!loc.relative) throw new Error("Нельзя изменять корень проекта");
    if (loc.relative.split(path.sep).includes(".git"))
      throw new Error("Служебные данные Git нельзя менять из проводника");
    if (method === "fs.write")
      return serial(loc.full, async () => {
        if (
          typeof p.text !== "string" ||
          Buffer.byteLength(p.text) > 2 * 1024 * 1024
        )
          throw new Error("Недопустимый размер текста");
        const before = await readVersion(loc.full).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (before && typeof p.expectedMtime !== "number")
          throw new Error("Сначала прочитайте текущую версию файла");
        if (
          (before && p.expectedMtime !== before.stat.mtimeMs) ||
          (!before && p.expectedMtime !== undefined)
        )
          throw new Error(
            "Файл изменился на диске. Перечитайте его перед сохранением",
          );
        const remembered = this.reads.get(loc.full);
        const expectedHash =
          p.expectedHash ??
          (remembered && remembered.mtime === p.expectedMtime
            ? remembered.hash
            : undefined);
        if (
          before &&
          expectedHash !== undefined &&
          expectedHash !== before.hash
        )
          throw new Error(
            "Содержимое файла изменилось. Перечитайте его перед сохранением",
          );
        if (before) await fs.access(loc.full, constants.W_OK);
        // Preserve UTF-8 BOM and a uniform CRLF convention when the textarea normalizes newlines.
        let content = p.text;
        if (
          before?.text.includes("\r\n") &&
          !before.text.replace(/\r\n/g, "").includes("\n")
        )
          content = content.replace(/\r?\n/g, "\r\n");
        let bytes = Buffer.from(content, "utf8");
        if (
          before?.bytes.subarray(0, 3).equals(bom) &&
          !bytes.subarray(0, 3).equals(bom)
        )
          bytes = Buffer.concat([bom, bytes]);
        const temporary = path.join(
          path.dirname(loc.full),
          `.workbench-save-${randomUUID()}.tmp`,
        );
        let handle;
        try {
          handle = await fs.open(
            temporary,
            "wx",
            before ? before.stat.mode & 0o777 : 0o600,
          );
          if (before && process.platform !== "win32")
            await handle.chmod(before.stat.mode & 0o777);
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.close();
          handle = undefined;
          const refreshed = await scopedPath(
            project,
            String(p.path || ""),
            true,
          );
          if (refreshed.root !== loc.root || refreshed.full !== loc.full)
            throw new Error("Путь проекта изменился во время сохранения");
          if (before) {
            const current = await readVersion(loc.full);
            if (
              current.hash !== before.hash ||
              current.stat.dev !== before.stat.dev ||
              current.stat.ino !== before.stat.ino ||
              current.stat.mtimeMs !== before.stat.mtimeMs
            )
              throw new Error(
                "Файл изменился во время сохранения; черновик сохранён в редакторе",
              );
            // Atomic replacement protects old bytes from a partial write. An unrelated external writer
            // can still race the final check; this is not a filesystem-wide compare-and-swap lock.
            await fs.rename(temporary, loc.full);
          } else {
            await fs.link(temporary, loc.full);
            await fs.unlink(temporary);
          }
          const stat = await fs.stat(loc.full);
          const hash = sha(bytes);
          this.reads.set(loc.full, { mtime: stat.mtimeMs, hash });
          return { mtime: stat.mtimeMs, hash };
        } finally {
          if (handle) await handle.close().catch(() => {});
          await fs.unlink(temporary).catch(() => {});
        }
      });
    if (method === "fs.create") {
      if (p.directory) await fs.mkdir(loc.full);
      else await fs.writeFile(loc.full, "", { flag: "wx" });
      return { path: loc.relative };
    }
    if (method === "fs.rename")
      return serial(loc.root, async () => {
        const source = await scopedPath(project, String(p.path || ""));
        const next = await scopedPath(project, String(p.newPath || ""), true);
        if (!next.relative || next.relative.split(path.sep).includes(".git"))
          throw new Error("Недопустимый путь");
        if (!(await fs.lstat(source.full)).isFile())
          throw new Error(
            "Безопасное переименование сейчас поддерживается для обычных файлов. Каталог можно переименовать средствами ОС",
          );
        // link is atomic and refuses an existing destination even when another process races us.
        await fs.link(source.full, next.full);
        try {
          await fs.unlink(source.full);
        } catch {
          throw new Error(
            "Новое имя создано, но исходное имя осталось. Проверьте оба пути; повтор автоматически не выполняется",
          );
        }
        return { path: next.relative };
      });
    if (method === "fs.trash") {
      await this.trash(loc.full);
      return { trashed: true };
    }
    throw new Error("Неизвестное действие с файлами");
  }
  private async git(method: string, project: Project, p: any) {
    const run = async (args: string[]) => {
      const r = await exec("git", ["-C", project.path, ...args], {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 15000,
        windowsHide: true,
      });
      return r.stdout;
    };
    if (method === "git.diff") {
      const args = ["diff", "--no-ext-diff", "--"];
      if (p.path) {
        const v = await scopedPath(project, p.path);
        args.push(v.relative);
      }
      return { text: await run(args) };
    }
    const raw = await run(["status", "--porcelain=v1", "-z"]);
    const parts = raw.split("\0");
    const changes = [];
    for (let i = 0; i < parts.length; i++) {
      const row = parts[i];
      if (!row) continue;
      const status = row.slice(0, 2);
      const file = row.slice(3);
      changes.push({ path: file, status });
      if (/[RC]/.test(status)) i++;
    }
    const branch =
      (await run(["branch", "--show-current"])).trim() || "detached HEAD";
    return {
      branch,
      changes,
      diff: await run(["diff", "--stat", "--no-ext-diff"]),
    };
  }
}
