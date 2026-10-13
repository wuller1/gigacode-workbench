import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readReference } from "../electron/reference";

it("declares every self-hosting reference in the desktop package", async () => {
  const packageFile = fileURLToPath(
    new URL("../package.json", import.meta.url),
  );
  const manifest = JSON.parse(await fs.readFile(packageFile, "utf8"));
  expect(manifest.license).toBe("Apache-2.0");
  const mappings = new Map(
    manifest.build.extraResources.map((entry: any) => [entry.to, entry.from]),
  );
  for (const [target, source] of new Map([
    ["workbench", "../workbench"],
    ["docs/suite", "../docs/suite"],
    ["suite/implementation-plan.json", "../suite/implementation-plan.json"],
    [
      "design/suite-workspace-prototype.html",
      "../design/suite-workspace-prototype.html",
    ],
    ["ui-kit", "../ui-kit"],
    ["LICENSE", "../LICENSE"],
    ["NOTICE", "../NOTICE"],
    ["THIRD_PARTY_NOTICES.md", "../docs/THIRD_PARTY_NOTICES.md"],
  ]))
    expect(mappings.get(target)).toBe(source);
});

it("lists and pages only the shipped reference namespaces", async () => {
  const outer = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-ref-"));
  const root = path.join(outer, "resources");
  try {
    await Promise.all([
      fs.mkdir(path.join(root, "workbench/source"), { recursive: true }),
      fs.mkdir(path.join(root, "docs/suite"), { recursive: true }),
      fs.mkdir(path.join(root, "suite"), { recursive: true }),
      fs.mkdir(path.join(root, "design"), { recursive: true }),
      fs.mkdir(path.join(root, "ui-kit/src"), { recursive: true }),
      fs.mkdir(path.join(root, "ui-kit/node_modules/dependency"), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(root, "workbench/CORE.md"), "core"),
      fs.writeFile(path.join(root, "workbench/source/private.txt"), "hidden"),
      fs.writeFile(path.join(root, "docs/suite/README.md"), "suite docs"),
      fs.writeFile(
        path.join(root, "suite/implementation-plan.json"),
        '{"cards":[]}',
      ),
      fs.writeFile(
        path.join(root, "design/suite-workspace-prototype.html"),
        "a".repeat(25_000),
      ),
      fs.writeFile(path.join(root, "ui-kit/src/index.ts"), "export {};"),
      fs.writeFile(
        path.join(root, "ui-kit/node_modules/dependency/README.md"),
        "hidden",
      ),
      fs.writeFile(path.join(root, "unrelated.md"), "not shipped"),
      fs.writeFile(path.join(outer, "secret.md"), "outside"),
    ]);

    expect((await readReference(root, {})).documents).toEqual([
      "design/suite-workspace-prototype.html",
      "docs/suite/README.md",
      "suite/implementation-plan.json",
      "ui-kit/src/index.ts",
      "workbench/CORE.md",
    ]);
    expect(await readReference(root, { path: "CORE.md" })).toMatchObject({
      path: "workbench/CORE.md",
      text: "core",
    });
    expect(
      await readReference(root, { path: "docs/suite/README.md" }),
    ).toMatchObject({ path: "docs/suite/README.md", text: "suite docs" });
    expect(
      await readReference(root, {
        path: "design/suite-workspace-prototype.html",
      }),
    ).toMatchObject({ nextOffset: 20_000 });
    expect(
      (
        await readReference(root, {
          path: "design/suite-workspace-prototype.html",
          offset: 20_000,
        })
      ).text,
    ).toHaveLength(5_000);

    await expect(readReference(root, { path: "../secret.md" })).rejects.toThrow(
      "outside",
    );
    await expect(
      readReference(root, { path: "unrelated.md" }),
    ).rejects.toThrow();
    await expect(
      readReference(root, { path: "workbench/source/private.txt" }),
    ).rejects.toThrow();
    await expect(
      readReference(root, { path: "ui-kit/node_modules/x.md" }),
    ).rejects.toThrow();
    await expect(
      readReference(root, { path: "CORE.md", offset: -1 }),
    ).rejects.toThrow("offset");
  } finally {
    await fs.rm(outer, { recursive: true, force: true });
  }
});

it("rejects a readable-looking symlink that escapes the resource root", async () => {
  if (process.platform === "win32") return;
  const outer = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-ref-link-"));
  const root = path.join(outer, "resources");
  try {
    await fs.mkdir(path.join(root, "docs/suite"), { recursive: true });
    await fs.writeFile(path.join(outer, "secret.md"), "outside");
    await fs.symlink(
      path.join(outer, "secret.md"),
      path.join(root, "docs/suite/linked.md"),
    );
    expect((await readReference(root, {})).documents).toEqual([]);
    await expect(
      readReference(root, { path: "docs/suite/linked.md" }),
    ).rejects.toThrow("outside");
  } finally {
    await fs.rm(outer, { recursive: true, force: true });
  }
});
