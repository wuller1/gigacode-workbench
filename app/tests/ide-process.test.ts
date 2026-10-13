import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IdeProcessPool } from "../electron/ide-process";
import type { Project } from "../shared/types";
const fixture = fileURLToPath(
  new URL("./fixtures/ide-fixture.mjs", import.meta.url),
);
const pools: IdeProcessPool[] = [],
  directories: string[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.dispose()));
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function setup(names = ["project"], timeout = 5000) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-ide-process-"));
  directories.push(directory);
  const projects: Project[] = [];
  for (const [i, name] of names.entries()) {
    const root = path.join(directory, name);
    await fs.mkdir(root);
    projects.push({ id: "project-" + i, name, path: root, createdAt: "" });
  }
  const pool = new IdeProcessPool({
    runtimeRoot: directory,
    entrypoint: fixture,
    nodePath: process.execPath,
    dataDir: path.join(directory, "data"),
    startupTimeoutMs: timeout,
    changed: () => {},
  });
  pools.push(pool);
  return { pool, projects, directory };
}
describe("IDE backend ownership, startup and recovery", () => {
  it("concurrent requests and project aliases start only one backend for the same real root", async () => {
    const {
      pool,
      projects: [project],
    } = await setup();
    const [a, b, c] = await Promise.all([
      pool.ensure(project),
      pool.ensure(project),
      pool.ensure({ ...project, id: "alias" }),
    ]);
    expect(new Set([a.child?.pid, b.child?.pid, c.child?.pid]).size).toBe(1);
    expect(pool.snapshot()).toHaveLength(1);
    expect(a.projectIds.has("alias")).toBe(true);
    const response = await fetch(`http://127.0.0.1:${a.port}/`, {
      headers: { "x-workbench-ide-token": a.token },
    });
    const actual = await response.json();
    expect(actual.root).toBe(await fs.realpath(project.path));
    expect(actual.config).toBe(a.configPath);
    expect((await fetch(`http://127.0.0.1:${a.port}/`)).status).toBe(401);
  });
  it("parallel projects have separate ports, secrets, config and process lifetimes", async () => {
    const { pool, projects } = await setup(["frontend", "backend"]);
    const [a, b] = await Promise.all(
      projects.map((project) => pool.ensure(project)),
    );
    expect(a.port).not.toBe(b.port);
    expect(a.token).not.toBe(b.token);
    expect(a.configPath).not.toBe(b.configPath);
    await pool.terminate(a);
    expect(a.status).toBe("stopped");
    expect(b.status).toBe("ready");
    expect(
      (
        await fetch(`http://127.0.0.1:${b.port}/`, {
          headers: { "x-workbench-ide-token": b.token },
        })
      ).status,
    ).toBe(200);
  });
  it("never treats an early process exit as a ready IDE", async () => {
    const {
      pool,
      projects: [project],
    } = await setup(["exit-before-ready"]);
    await expect(pool.ensure(project)).rejects.toThrow("IDE_PROCESS_EXITED");
    expect(pool.snapshot()[0].status).toBe("failed");
  });
  it("bounds startup time and stops a process that never sends the readiness handshake", async () => {
    const {
      pool,
      projects: [project],
    } = await setup(["never-ready"], 400);
    await expect(pool.ensure(project)).rejects.toThrow("IDE_START_TIMEOUT");
    await pool.dispose();
    expect(pool.snapshot()[0].status).toBe("failed");
    expect(pool.snapshot()[0].pid).toBeUndefined();
  });
  it("redacts its private transport secret from persisted logs and public snapshots", async () => {
    const {
      pool,
      projects: [project],
    } = await setup();
    const engine = await pool.ensure(project);
    const token = engine.token;
    await pool.terminate(engine);
    const log = await fs.readFile(engine.logPath, "utf8");
    expect(log).not.toContain(token);
    expect(log).toContain("[REDACTED]");
    expect(JSON.stringify(pool.snapshot())).not.toContain(token);
  });
});
