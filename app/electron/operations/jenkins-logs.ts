import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { OpsLogPage } from "../../shared/operations";
import { OpsHttp } from "./http";
import { failure } from "./errors";

const PAGE = 256 * 1024,
  MAXIMUM = 32 * 1024 ** 2,
  TTL = 5 * 60 * 1000;
type Snapshot = {
  id: string;
  file: string;
  job: string;
  build: string;
  start: number;
  end: string;
  more: boolean;
  bytes: number;
  created: number;
};
/** X-Text-Size counts raw Jenkins log bytes, including hidden ConsoleNotes. Display
 * bytes must never be substituted for that offset. A private, redacted spool lets
 * a bounded progressive response be paged losslessly before using its raw cursor. */
export class JenkinsLogs {
  private directory?: Promise<string>;
  private snapshots = new Map<string, Snapshot>();
  constructor(private http: OpsHttp) {}
  private async prune(forNew = false) {
    for (const [id, s] of this.snapshots)
      if (
        Date.now() - s.created > TTL ||
        (forNew && this.snapshots.size >= 8)
      ) {
        this.snapshots.delete(id);
        await fs.rm(s.file, { force: true });
      }
  }
  async read(job: string, build: string, cursor?: string): Promise<OpsLogPage> {
    await this.prune();
    const local = cursor && /^(\d+)\.wb\.([0-9a-f-]{36})\.(\d+)$/.exec(cursor);
    if (local) {
      const s = this.snapshots.get(local[2]),
        offset = Number(local[3]);
      if (
        !s ||
        s.job !== job ||
        s.build !== build ||
        s.start !== Number(local[1]) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= s.bytes
      )
        throw failure(
          "conflict",
          "Jenkins log cursor истёк или относится к другой сборке. Начните чтение логов заново.",
        );
      return this.page(s, offset);
    }
    if (cursor !== undefined && !/^\d+$/.test(cursor))
      throw failure("validation", "Неверный Jenkins log cursor.");
    const start = Number(cursor || 0);
    if (!Number.isSafeInteger(start) || start < 0)
      throw failure("validation", "Неверный Jenkins log byte offset.");
    await this.prune(true);
    this.directory ||= fs
      .mkdtemp(path.join(os.tmpdir(), "workbench-ops-logs-"))
      .then(async (dir) => {
        await fs.chmod(dir, 0o700);
        return dir;
      });
    const id = randomUUID(),
      file = path.join(await this.directory, id + ".txt"),
      handle = await fs.open(file, "wx", 0o600);
    const decoder = new TextDecoder("utf-8", { fatal: true }),
      patterns = this.http.redactionPatterns();
    const overlap = Math.max(256, ...patterns.map((p) => p.length + 256));
    let carry = "",
      bytes = 0,
      checkedHtml = false;
    const write = async (text: string) => {
      if (!text) return;
      const safe = this.http.redactText(text),
        size = Buffer.byteLength(safe);
      if (bytes + size > MAXIMUM)
        throw failure(
          "payload_too_large",
          "Jenkins log snapshot превышает32MiB после скрытия credentials. Cursor не продвинут.",
        );
      await handle.writeFile(safe);
      bytes += size;
    };
    try {
      const response = await this.http.request(
        build + "logText/progressiveText?start=" + start,
        {
          type: "text",
          maximum: MAXIMUM,
          textSink: async (chunk) => {
            carry += decoder.decode(chunk, { stream: true });
            if (!checkedHtml && carry.length >= 256) {
              checkedHtml = true;
              if (/^\s*<!doctype html/i.test(carry))
                throw failure("protocol", "Вместо логов получен HTML.");
            }
            let cut = Math.max(0, carry.length - overlap);
            for (const pattern of patterns) {
              const i = carry.lastIndexOf(pattern, cut);
              if (i >= 0 && i + pattern.length > cut) cut = Math.min(cut, i);
            }
            if (
              cut > 0 &&
              /[\uD800-\uDBFF]/.test(carry[cut - 1]) &&
              /[\uDC00-\uDFFF]/.test(carry[cut])
            )
              cut--;
            if (cut) {
              await write(carry.slice(0, cut));
              carry = carry.slice(cut);
            }
          },
        },
      );
      carry += decoder.decode();
      if (/^\s*<!doctype html/i.test(carry) && !checkedHtml)
        throw failure("protocol", "Вместо логов получен HTML.");
      await write(carry);
      await handle.close();
      const end = response.headers["x-text-size"];
      if (
        !end ||
        !/^\d+$/.test(end) ||
        !Number.isSafeInteger(Number(end)) ||
        Number(end) < start
      )
        throw failure(
          "protocol",
          "Jenkins progressive log не вернул корректный raw byte cursor.",
        );
      const snapshot: Snapshot = {
        id,
        file,
        job,
        build,
        start,
        end,
        more: response.headers["x-more-data"] === "true",
        bytes,
        created: Date.now(),
      };
      this.snapshots.set(id, snapshot);
      return this.page(snapshot, 0);
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.rm(file, { force: true });
      throw error;
    }
  }
  private async page(s: Snapshot, offset: number): Promise<OpsLogPage> {
    const handle = await fs.open(s.file, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(Math.min(PAGE, s.bytes - offset)),
        read = await handle.read(buffer, 0, buffer.length, offset);
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, read.bytesRead),
        { stream: offset + read.bytesRead < s.bytes },
      );
    } finally {
      await handle.close();
    }
    const next = offset + Buffer.byteLength(text),
      more = next < s.bytes;
    if (more && next === offset)
      throw failure("protocol", "Jenkins log page не продвинула UTF-8 cursor.");
    return {
      text,
      cursor: more ? `${s.start}.wb.${s.id}.${next}` : s.end,
      hasMore: more || s.more,
      truncated: more,
    };
  }
  async dispose() {
    this.snapshots.clear();
    if (this.directory)
      await fs.rm(await this.directory, { recursive: true, force: true });
  }
}
