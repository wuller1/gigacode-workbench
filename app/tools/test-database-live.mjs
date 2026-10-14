/** Own disposable PostgreSQL cluster only. Never connects to an installed service or user's DB. */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { databaseEvidence } from "./database-evidence.mjs";
import { createServer } from "node:net";
const root = path.resolve(import.meta.dirname, ".."),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-pg-live-"));
let bin = process.env.WORKBENCH_PG_BIN || process.env.PGBIN;
if (!bin && process.platform === "darwin")
  bin = "/opt/homebrew/opt/postgresql@18/bin";
if (!bin && process.platform === "win32") {
  const parent = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "PostgreSQL",
  );
  const versions = await fs.readdir(parent).catch(() => []);
  bin = versions
    .sort((a, b) => Number(b) - Number(a))
    .map((v) => path.join(parent, v, "bin"))[0];
}
if (!bin)
  throw new Error(
    "Install PostgreSQL and set WORKBENCH_PG_BIN to its bin directory. No existing server will be used.",
  );
const executable = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
async function run(command, args, env = process.env, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    let tail = "";
    if (quiet) {
      child.stdout.on(
        "data",
        (b) => (tail = (tail + b.toString()).slice(-4000)),
      );
      child.stderr.on(
        "data",
        (b) => (tail = (tail + b.toString()).slice(-4000)),
      );
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              path.basename(command) + " failed: " + (quiet ? tail : code),
            ),
          ),
    );
  });
}
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const p = server.address().port;
    server.close(() => resolve(p));
  });
});
const user = "wb_" + randomBytes(8).toString("hex"),
  password = randomBytes(24).toString("hex"),
  pwfile = path.join(temp, "password");
let started = false;
try {
  await fs.writeFile(pwfile, password, { mode: 0o600 });
  await run(
    executable("initdb"),
    [
      "-D",
      path.join(temp, "data"),
      "-U",
      user,
      "--pwfile",
      pwfile,
      "--auth-host=scram-sha-256",
      "--auth-local=trust",
      "--encoding=UTF8",
      "--no-locale",
    ],
    process.env,
    true,
  );
  await fs.rm(pwfile);
  const config =
    "\nlisten_addresses = '127.0.0.1'\nport = " +
    port +
    "\nmax_connections=30\nshared_buffers='32MB'\nlog_statement='none'\nlog_min_error_statement=panic\nlog_min_messages=panic\n" +
    (process.platform === "win32" ? "" : "unix_socket_directories=''\n");
  await fs.appendFile(path.join(temp, "data", "postgresql.conf"), config);
  await run(
    executable("pg_ctl"),
    [
      "-D",
      path.join(temp, "data"),
      "-l",
      path.join(temp, "server.log"),
      "-w",
      "start",
    ],
    process.env,
    true,
  );
  started = true;
  const env = {
    ...process.env,
    WORKBENCH_DATABASE_TEST_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`,
    WORKBENCH_DATABASE_TEST_TEMP: temp,
  };
  if (process.argv.includes("--ui"))
    await run(
      process.execPath,
      [
        "tools/test-database-ui.mjs",
        ...(process.argv.includes("--packaged") ? ["--packaged"] : []),
      ],
      env,
    );
  else {
    const reportFile = path.join(temp, "vitest.json");
    await run(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/database-live.test.ts",
        "--reporter=default",
        "--reporter=json",
        "--outputFile=" + reportFile,
      ],
      env,
    );
    const report = JSON.parse(await fs.readFile(reportFile, "utf8")),
      metrics = JSON.parse(
        await fs.readFile(path.join(temp, "metrics.json"), "utf8"),
      );
    if (!report.success || report.numFailedTests || report.numPendingTests)
      throw new Error(
        "Database suite is incomplete; no passing evidence will be written",
      );
    await databaseEvidence(
      "database-runtime-live-" + process.platform + ".json",
      {
        at: new Date().toISOString(),
        os: process.platform,
        tests: report.numTotalTests,
        passed: report.numPassedTests,
        failed: report.numFailedTests,
        cases: report.testResults.flatMap((r) =>
          r.assertionResults.map((t) => ({
            name: t.fullName,
            status: t.status,
            durationMs: t.duration,
          })),
        ),
        metrics,
        scope:
          "Real disposable PostgreSQL. Direct engine/file tests, real stdio MCP provider and HTTPS transport fixture. No workplace adapter or 10 GB stress claim.",
      },
    );
  }
} catch (error) {
  const diagnostics = path.join(root, "test-results/database");
  await fs.mkdir(diagnostics, { recursive: true });
  for (const name of ["vitest.json", "metrics.json"]) {
    const body = await fs
      .readFile(path.join(temp, name), "utf8")
      .catch(() => undefined);
    if (body)
      await fs.writeFile(
        path.join(diagnostics, name),
        body.replaceAll(password, "[isolated-test-secret]"),
      );
  }
  throw error;
} finally {
  if (started)
    await run(
      executable("pg_ctl"),
      ["-D", path.join(temp, "data"), "-m", "immediate", "-w", "stop"],
      process.env,
      true,
    ).catch((e) => console.error(e.message));
  await fs.rm(temp, { recursive: true, force: true });
}
