import { describe, it, expect } from "vitest";
import { JenkinsCatalog } from "../electron/operations/catalog";
import { failure } from "../electron/operations/errors";
import type { OpsJenkinsJob } from "../shared/operations";
const job = (id: string, folder = false): OpsJenkinsJob => ({
  id,
  fullName: id,
  name: id.split("/").at(-1)!,
  url: "",
  kind: folder ? "folder" : "job",
  folder,
  runnable: !folder,
  disabled: false,
});
const limits = {
  scans: 4,
  bytes: 8 * 1024 ** 2,
  jobs: 20000,
  folders: 2000,
  depth: 32,
  pages: 500,
  requestsPerPage: 12,
  ttlMs: 300000,
};
const input = { recursive: true, search: "needle", limit: 75 };
describe("Jenkins recursive paged catalog", () => {
  it("searches all folders across more than1000 jobs, with replayable immutable continuations", async () => {
    const nodes = new Map([
      [
        "",
        [
          job("Team", true),
          ...Array.from({ length: 1100 }, (_, i) => job("job-" + i)),
        ],
      ],
      ["Team", Array.from({ length: 850 }, (_, i) => job("Team/needle-" + i))],
    ]);
    let calls = 0;
    const catalog = new JenkinsCatalog(async (folder, offset, limit) => {
      calls++;
      return nodes.get(folder)!.slice(offset, offset + limit + 1);
    });
    let page = await catalog.query(input),
      found = (page.data as any).jobs.map((j: any) => j.id);
    const token = page.cursor!;
    const [a, b] = await Promise.all([
      catalog.query({ ...input, cursor: token }),
      catalog.query({ ...input, cursor: token }),
    ]);
    expect(a).toEqual(b);
    const before = calls;
    expect(await catalog.query({ ...input, cursor: token })).toEqual(a);
    expect(calls).toBe(before);
    page = a;
    found.push(...(page.data as any).jobs.map((j: any) => j.id));
    while (page.hasMore) {
      page = await catalog.query({ ...input, cursor: page.cursor });
      found.push(...(page.data as any).jobs.map((j: any) => j.id));
    }
    expect(found.length).toBe(850);
    expect(new Set(found).size).toBe(850);
    expect((page.data as any).complete).toBe(true);
    expect((page.data as any).scanned).toBe(1951);
    await expect(
      catalog.query({ ...input, search: "other", cursor: token }),
    ).rejects.toMatchObject({ kind: "validation" });
  });
  it("keeps partial permission failures explicit and does not infer an empty complete catalog", async () => {
    const catalog = new JenkinsCatalog(async (folder) => {
      if (folder === "Denied") throw failure("forbidden", "Denied");
      return [job("Denied", true), job("Visible")];
    });
    const r = await catalog.query({ recursive: true });
    expect((r.data as any).jobs).toHaveLength(2);
    expect((r.data as any).complete).toBe(false);
    expect(r.warnings[0]).toContain("Denied");
  });
  it("does not lose results when an API read fails and the same cursor is retried", async () => {
    let fail = true;
    const catalog = new JenkinsCatalog(
      async (folder) => {
        if (folder === "Folder" && fail) throw failure("timeout", "Timed out");
        return folder
          ? [job("Folder/last")]
          : [job("Folder", true), job("First")];
      },
      { ...limits, requestsPerPage: 1 },
    );
    const first = await catalog.query({ recursive: true, limit: 1 });
    const second = await catalog.query({
      recursive: true,
      limit: 1,
      cursor: first.cursor,
    });
    await expect(
      catalog.query({ recursive: true, limit: 3, cursor: second.cursor }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      catalog.query({ recursive: true, limit: 1, cursor: second.cursor }),
    ).rejects.toMatchObject({ kind: "timeout" });
    fail = false;
    const third = await catalog.query({
      recursive: true,
      limit: 1,
      cursor: second.cursor,
    });
    expect((third.data as any).jobs[0].id).toBe("Folder/last");
  });
  it("stops an API ignoring its pagination instead of looping or claiming completeness", async () => {
    const catalog = new JenkinsCatalog(async () =>
      Array.from({ length: 201 }, (_, i) => job("job" + i)),
    );
    let r = await catalog.query({ limit: 500 });
    while (r.hasMore) r = await catalog.query({ limit: 500, cursor: r.cursor });
    expect((r.data as any).complete).toBe(false);
    expect(r.warnings.join()).toContain("повторяет");
  });
  it("bounds work per page when a search has no matches, and expires its cursor", async () => {
    let calls = 0;
    const catalog = new JenkinsCatalog(
      async (_f, offset, n) => {
        calls++;
        return Array.from({ length: n + 1 }, (_, i) =>
          job("job" + (offset + i)),
        );
      },
      { ...limits, requestsPerPage: 2, ttlMs: 5 },
    );
    const r = await catalog.query(input);
    expect(calls).toBe(2);
    expect(r.hasMore).toBe(true);
    expect((r.data as any).jobs).toEqual([]);
    await new Promise((r) => setTimeout(r, 10));
    await expect(
      catalog.query({ ...input, cursor: r.cursor }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
});
it("an evicted in-flight catalog cannot publish orphan continuation pages", async () => {
  let release!: () => void;
  let began!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (began = r));
  const catalog = new JenkinsCatalog(
    async (folder, offset, n) => {
      if (folder === "A" && offset === 0) {
        began();
        await gate;
      }
      return Array.from({ length: n + 1 }, (_, i) =>
        job(folder + "/job" + (offset + i)),
      );
    },
    { ...limits, scans: 1, requestsPerPage: 1 },
  );
  const first = catalog.query({ folder: "A", limit: 1 });
  // Attach the rejection handler before releasing a concurrent operation.
  const rejected = expect(first).rejects.toMatchObject({ kind: "conflict" });
  await started;
  const second = await catalog.query({ folder: "B", limit: 1 });
  release();
  await rejected;
  expect((catalog as any).scans).toHaveLength(1);
  expect((catalog as any).pages.size).toBe(1);
  expect(
    (await catalog.query({ folder: "B", limit: 1, cursor: second.cursor }))
      .hasMore,
  ).toBe(true);
});
