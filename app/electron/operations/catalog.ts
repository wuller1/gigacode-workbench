import { randomUUID } from "node:crypto";
import type { OpsJenkinsJob, OpsQueryResult } from "../../shared/operations";
import { failure } from "./errors";

type Folder = { name: string; offset: number; depth: number };
type Scan = {
  active: boolean;
  key: string;
  expires: number;
  pending: Folder[];
  seen: Set<string>;
  visited: Set<string>;
  buffered: OpsJenkinsJob[];
  bytes: number;
  scanned: number;
  requests: number;
  warnings: string[];
  folder: string;
  search: string;
  limit: number;
  recursive: boolean;
  stopped: boolean;
};
type CatalogResult = OpsQueryResult<{
  jobs: OpsJenkinsJob[];
  folder: string;
  search: string;
  recursive: boolean;
  complete: boolean;
  scanned: number;
  pendingFolders: number;
  requests: number;
  observedCatalog: boolean;
}>;
type Page = {
  scan: Scan;
  result?: CatalogResult;
  promise?: Promise<CatalogResult>;
};
/** Bounded breadth-first catalog. Continuations are opaque, expiring, and replayable.
 * Pages are observations of a changing Jenkins catalog, not a server snapshot. */
export class JenkinsCatalog {
  private pages = new Map<string, Page>();
  private scans: Scan[] = [];
  constructor(
    private read: (
      folder: string,
      offset: number,
      limit: number,
    ) => Promise<OpsJenkinsJob[]>,
    private limits = {
      scans: 4,
      bytes: 8 * 1024 ** 2,
      jobs: 20_000,
      folders: 2_000,
      depth: 32,
      pages: 500,
      requestsPerPage: 12,
      ttlMs: 300_000,
    },
  ) {}
  async query(input: Record<string, any>): Promise<CatalogResult> {
    this.prune();
    const folder = input.folder || "",
      search = String(input.search || "")
        .trim()
        .toLocaleLowerCase();
    if (search.length > 500)
      throw failure("validation", "Поиск Jenkins: не более500 символов.");
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw failure("validation", "Размер страницы Jenkins:1–500.");
    const recursive = input.recursive === true;
    const key = JSON.stringify({ folder, search, limit, recursive });
    if (input.cursor) {
      const page = this.pages.get(String(input.cursor));
      if (!page || page.scan.expires <= Date.now())
        throw failure(
          "conflict",
          "Каталог Jenkins устарел. Обновите поиск с первой страницы.",
        );
      if (page.scan.key !== key)
        throw failure(
          "validation",
          "Курсор Jenkins принадлежит другому поиску или папке.",
        );
      return this.page(page);
    }
    if (this.scans.length >= this.limits.scans) {
      const oldest = this.scans.shift()!;
      this.evict(oldest);
    }
    const scan: Scan = {
      active: true,
      key,
      folder,
      search,
      limit,
      recursive,
      expires: Date.now() + this.limits.ttlMs,
      pending: [{ name: folder, offset: 0, depth: 0 }],
      visited: new Set([folder]),
      seen: new Set(),
      buffered: [],
      bytes: 0,
      scanned: 0,
      requests: 0,
      warnings: [],
      stopped: false,
    };
    this.scans.push(scan);
    return this.page({ scan });
  }
  private evict(scan: Scan) {
    scan.active = false;
    for (const [token, page] of this.pages)
      if (page.scan === scan) this.pages.delete(token);
  }
  private prune() {
    for (const [token, page] of this.pages)
      if (!page.scan.active || page.scan.expires <= Date.now())
        this.pages.delete(token);
    this.scans = this.scans.filter((scan) => {
      if (scan.expires > Date.now()) return true;
      this.evict(scan);
      return false;
    });
  }
  private page(page: Page): Promise<CatalogResult> {
    if (page.result) return Promise.resolve(structuredClone(page.result));
    if (!page.promise)
      page.promise = this.advance(page.scan)
        .then((result) => {
          page.result = result;
          return result;
        })
        .finally(() => {
          page.promise = undefined;
        });
    return page.promise.then((result) => structuredClone(result));
  }
  private async advance(original: Scan): Promise<CatalogResult> {
    const scan: Scan = {
      ...original,
      pending: original.pending.map((folder) => ({ ...folder })),
      seen: new Set(original.seen),
      visited: new Set(original.visited),
      buffered: [...original.buffered],
      warnings: [...original.warnings],
    };
    const jobs: OpsJenkinsJob[] = [];
    let requests = 0;
    const warn = (message: string) => {
      if (!scan.warnings.includes(message)) scan.warnings.push(message);
    };
    while (jobs.length < scan.limit) {
      while (scan.buffered.length && jobs.length < scan.limit)
        jobs.push(scan.buffered.shift()!);
      if (
        jobs.length === scan.limit ||
        scan.stopped ||
        !scan.pending.length ||
        requests >= this.limits.requestsPerPage
      )
        break;
      if (scan.scanned >= this.limits.jobs) {
        scan.stopped = true;
        warn("Достигнут предел каталога. Уточните папку или поиск.");
        break;
      }
      const folder = scan.pending[0],
        amount = Math.min(200, this.limits.jobs - scan.scanned);
      // Advance only after a successful read. A failed token can safely be retried.
      let items: OpsJenkinsJob[];
      try {
        items = await this.read(folder.name, folder.offset, amount);
      } catch (e: any) {
        if (
          folder.name === scan.folder ||
          !["forbidden", "not_found"].includes(e.kind)
        )
          throw e;
        warn(
          `Папка ${folder.name}: ${e.kind === "forbidden" ? "нет доступа" : "больше не существует"}.`,
        );
        scan.pending.shift();
        ++requests;
        ++scan.requests;
        continue;
      }
      ++requests;
      ++scan.requests;
      const hasMore = items.length > amount;
      if (hasMore) folder.offset += amount;
      else scan.pending.shift();
      let added = 0;
      for (const item of items.slice(0, amount)) {
        if (scan.seen.has(item.id)) continue;
        const bytes = Buffer.byteLength(JSON.stringify(item));
        if (scan.bytes + bytes > this.limits.bytes) {
          scan.stopped = true;
          warn("Каталог достиг предела памяти. Уточните папку или поиск.");
          break;
        }
        scan.bytes += bytes;
        scan.seen.add(item.id);
        ++scan.scanned;
        ++added;
        if (
          !scan.search ||
          item.fullName.toLocaleLowerCase().includes(scan.search)
        )
          scan.buffered.push(item);
        if (scan.recursive && item.folder && !scan.visited.has(item.id)) {
          scan.visited.add(item.id);
          if (
            folder.depth >= this.limits.depth ||
            scan.visited.size > this.limits.folders
          )
            warn(
              "Часть вложенных папок пропущена: достигнут предел глубины или числа папок.",
            );
          else
            scan.pending.push({
              name: item.id,
              offset: 0,
              depth: folder.depth + 1,
            });
        }
      }
      if (hasMore && !added) {
        scan.stopped = true;
        warn(
          "Jenkins повторяет одну страницу каталога. Поиск остановлен без объявления полноты.",
        );
      }
    }
    let hasMore =
      !!scan.buffered.length || (!scan.stopped && !!scan.pending.length);
    if (hasMore && this.pages.size >= this.limits.pages) {
      hasMore = false;
      scan.stopped = true;
      warn("Достигнут предел страниц. Уточните папку или поиск.");
    }
    const cursor = hasMore ? randomUUID() : undefined;
    if (!original.active || original.expires <= Date.now())
      throw failure(
        "conflict",
        "Каталог Jenkins истёк или вытеснен новым поиском. Обновите его с первой страницы.",
      );
    Object.assign(original, scan);
    if (cursor) this.pages.set(cursor, { scan: original });
    return {
      data: {
        jobs,
        folder: scan.folder,
        search: scan.search,
        recursive: scan.recursive,
        complete: !hasMore && !scan.stopped && scan.warnings.length === 0,
        scanned: scan.scanned,
        pendingFolders: scan.pending.length,
        requests: scan.requests,
        observedCatalog: true,
      },
      observedAt: new Date().toISOString(),
      warnings: [...scan.warnings],
      hasMore,
      ...(cursor ? { cursor } : {}),
    };
  }
}
