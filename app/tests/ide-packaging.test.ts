import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  getFileMatchers,
  copyFiles,
} = require("app-builder-lib/out/fileMatcher");
it("actual electron-builder resource mapping retains the independent IDE backend dependencies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-package-"));
  try {
    const config = JSON.parse(
      await fs.readFile(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8",
      ),
    );
    const resources = config.build.extraResources.filter((r: any) =>
      r.from.startsWith("runtime/.ide-package"),
    );
    const files = [
      "ide/src-gen/backend/main.js",
      "ide/node_modules/@theia/core/lib/node/backend-application-config-provider.js",
      "ide/plugins/example/extension/node_modules/helper/index.js",
      "ide-node/node-win-x64/node_modules/npm/package.json",
      "ide-tools/bindings.json",
    ];
    for (const name of files) {
      const file = path.join(root, "runtime/.ide-package", name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "packaged marker");
    }
    const destination = path.join(root, "release/resources");
    const matchers = getFileMatchers(
      { extraResources: resources },
      "extraResources",
      destination,
      {
        defaultSrc: root,
        macroExpander: (value: string) => value,
        customBuildOptions: {},
        globalOutDir: path.join(root, "release"),
      },
    );
    await copyFiles(matchers, null);
    for (const name of files)
      expect(await fs.readFile(path.join(destination, name), "utf8")).toBe(
        "packaged marker",
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);
