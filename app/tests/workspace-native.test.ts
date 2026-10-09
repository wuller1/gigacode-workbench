import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace, scopedPath, isWithin } from "../electron/workspace";

describe("workspace boundary and concurrent changes", () => {
  it("rejects parent traversal and enforces optimistic save", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-workspace-"));
    try {
      const project = { id: "p", name: "fixture", path: base, createdAt: "" };
      const w = new Workspace(
        () => project,
        async () => {},
      );
      expect(isWithin(base, base + "-other/file")).toBe(false);
      await expect(scopedPath(project, "../secret", true)).rejects.toThrow();
      await fs.writeFile(path.join(base, "note.md"), "before");
      const read: any = await w.invoke("fs.read", {
        projectId: "p",
        path: "note.md",
      });
      await expect(
        w.invoke("fs.write", {
          projectId: "p",
          path: "note.md",
          text: "bad",
          expectedMtime: read.mtime - 100,
        }),
      ).rejects.toThrow();
      await w.invoke("fs.write", {
        projectId: "p",
        path: "note.md",
        text: "after",
        expectedMtime: read.mtime,
      });
      expect(await fs.readFile(path.join(base, "note.md"), "utf8")).toBe(
        "after",
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  it("concurrent rename never overwrites the winning file", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-rename-"));
    try {
      await fs.writeFile(path.join(base, "a"), "A");
      await fs.writeFile(path.join(base, "b"), "B");
      const w = new Workspace(
        () => ({ id: "p", name: "fixture", path: base, createdAt: "" }),
        async () => {},
      );
      const result = await Promise.allSettled(
        ["a", "b"].map((file) =>
          w.invoke("fs.rename", {
            projectId: "p",
            path: file,
            newPath: "winner",
          }),
        ),
      );
      expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const winner = await fs.readFile(path.join(base, "winner"), "utf8");
      expect(
        await fs.readFile(path.join(base, winner === "A" ? "b" : "a"), "utf8"),
      ).toBe(winner === "A" ? "B" : "A");
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === "win32")(
    "rejects a symlink escaping the project",
    async () => {
      const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-links-"));
      try {
        const root = path.join(base, "project");
        await fs.mkdir(root);
        await fs.writeFile(path.join(base, "secret"), "private");
        await fs.symlink(base, path.join(root, "escape"));
        await expect(
          scopedPath(
            { id: "p", name: "fixture", path: root, createdAt: "" },
            "escape/secret",
          ),
        ).rejects.toThrow();
      } finally {
        await fs.rm(base, { recursive: true, force: true });
      }
    },
  );
  it("rejects invalid UTF-8 without a lossy read or write", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-encoding-"));
    try {
      const file = path.join(base, "legacy.txt"),
        original = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
      await fs.writeFile(file, original);
      const w = new Workspace(
        () => ({ id: "p", name: "fixture", path: base, createdAt: "" }),
        async () => {},
      );
      await expect(
        w.invoke("fs.read", { projectId: "p", path: "legacy.txt" }),
      ).rejects.toThrow("UTF-8");
      await expect(
        w.invoke("fs.write", {
          projectId: "p",
          path: "legacy.txt",
          text: "replacement",
          expectedMtime: (await fs.stat(file)).mtimeMs,
        }),
      ).rejects.toThrow("UTF-8");
      expect(await fs.readFile(file)).toEqual(original);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  it("preserves BOM and CRLF for an existing UTF-8 file", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-bom-"));
    try {
      const file = path.join(base, "note.txt");
      await fs.writeFile(file, "\uFEFFПервая\r\nВторая\r\n");
      const w = new Workspace(
        () => ({ id: "p", name: "fixture", path: base, createdAt: "" }),
        async () => {},
      );
      const read: any = await w.invoke("fs.read", {
        projectId: "p",
        path: "note.txt",
      });
      expect(read.text).toBe("Первая\r\nВторая\r\n");
      await w.invoke("fs.write", {
        projectId: "p",
        path: "note.txt",
        text: "Первая\nНовая\n",
        expectedMtime: read.mtime,
        expectedHash: read.hash,
      });
      expect(await fs.readFile(file, "utf8")).toBe("\uFEFFПервая\r\nНовая\r\n");
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  it("keeps the old bytes if atomic replacement fails", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-save-failure-"));
    try {
      const file = path.join(base, "note.txt");
      await fs.writeFile(file, "original");
      const w = new Workspace(
        () => ({ id: "p", name: "fixture", path: base, createdAt: "" }),
        async () => {},
      );
      const read: any = await w.invoke("fs.read", {
        projectId: "p",
        path: "note.txt",
      });
      const rename = vi
        .spyOn(fs, "rename")
        .mockRejectedValueOnce(
          Object.assign(new Error("Injected disk error"), { code: "EIO" }),
        );
      try {
        await expect(
          w.invoke("fs.write", {
            projectId: "p",
            path: "note.txt",
            text: "new text",
            expectedMtime: read.mtime,
            expectedHash: read.hash,
          }),
        ).rejects.toThrow("disk error");
      } finally {
        rename.mockRestore();
      }
      expect(await fs.readFile(file, "utf8")).toBe("original");
      expect(await fs.readdir(base)).toEqual(["note.txt"]);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  it("refuses a changed content hash even if the caller supplies current mtime", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "wb-save-version-"));
    try {
      const file = path.join(base, "note.txt");
      await fs.writeFile(file, "original");
      const w = new Workspace(
        () => ({ id: "p", name: "fixture", path: base, createdAt: "" }),
        async () => {},
      );
      const read: any = await w.invoke("fs.read", {
        projectId: "p",
        path: "note.txt",
      });
      await fs.writeFile(file, "external");
      await expect(
        w.invoke("fs.write", {
          projectId: "p",
          path: "note.txt",
          text: "new text",
          expectedMtime: (await fs.stat(file)).mtimeMs,
          expectedHash: read.hash,
        }),
      ).rejects.toThrow("Содержимое");
      expect(await fs.readFile(file, "utf8")).toBe("external");
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
