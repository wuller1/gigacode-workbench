import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  ELECTRON_NODE_ARGV_IMPORT,
  javascriptEntrypointArgs,
  launchSpec,
} from "../electron/acp.js";

describe("Electron node-mode CLI argv normalization", () => {
  it("keeps ordinary Node and native executable argument vectors unchanged", () => {
    expect(javascriptEntrypointArgs("/owned/cli.js", false)).toEqual([
      "--expose-gc",
      "/owned/cli.js",
    ]);
    expect(launchSpec("/owned/cli", ["-p", "one prompt"]).args).toEqual([
      "-p",
      "one prompt",
    ]);
  });
  it("prepends a static child bootstrap without moving CLI flags into evaluated source", () => {
    expect(javascriptEntrypointArgs("C:\\owned folder\\cli.js", true)).toEqual([
      "--expose-gc",
      "--import",
      ELECTRON_NODE_ARGV_IMPORT,
      "C:\\owned folder\\cli.js",
    ]);
    expect(decodeURIComponent(ELECTRON_NODE_ARGV_IMPORT)).toContain(
      "process.env.ELECTRON_RUN_AS_NODE==='1'",
    );
  });
  it("actual Electron Node runtime observes normal entrypoint arguments before CLI code runs", async () => {
    const require = createRequire(import.meta.url);
    const inherited = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    const original = process.env.ELECTRON_RUN_AS_NODE;
    // The evaluated diagnostic is only an owned argv observer, never CLI source.
    const args = [
      "--import",
      ELECTRON_NODE_ARGV_IMPORT,
      "-e",
      "console.log(JSON.stringify({marker:process.defaultApp,argv:process.argv.slice(1)}))",
      "owned-entry.js",
      "-p",
      "one prompt",
    ];
    const { stdout } = await promisify(execFile)(require("electron"), args, {
      env: inherited,
      timeout: 10000,
      maxBuffer: 4096,
    });
    expect(JSON.parse(stdout.trim())).toEqual({
      marker: true,
      argv: ["owned-entry.js", "-p", "one prompt"],
    });
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe(original);
  });
});
