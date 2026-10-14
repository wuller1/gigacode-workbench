/** Pinned public test servers only; never part of the desktop distribution. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
export const pins = {
  jenkins: {
    version: "2.580.1",
    url: "https://get.jenkins.io/war-stable/2.580.1/jenkins.war",
    sha256: "393bf2476352dd726519fd1f92ce66eac7d23c0936e6967420b717060c4c40d0",
    source: "https://www.jenkins.io/download/",
  },
  envtest: {
    version: "1.36.2",
    platform: "darwin-arm64",
    url: "https://github.com/kubernetes-sigs/controller-tools/releases/download/envtest-v1.36.2/envtest-v1.36.2-darwin-arm64.tar.gz",
    sha256: "f344e7c70961b100471eeea4d2555006f282a6a27bece7f42fbede77b29b886e",
    source:
      "https://github.com/kubernetes-sigs/controller-tools/releases/expanded_assets/envtest-v1.36.2",
  },
};
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function verified(file, expected) {
  try {
    if ((await fs.stat(file)).size > 256 * 1024 * 1024) return false;
    return digest(await fs.readFile(file)) === expected;
  } catch {
    return false;
  }
}
async function download(file, pin) {
  if (await verified(file, pin.sha256)) return file;
  const response = await fetch(pin.url, {
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok)
    throw new Error("Test asset download HTTP " + response.status);
  const pending = file + "." + randomUUID() + ".download";
  const stream = await fs.open(pending, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 256 * 1024 * 1024)
        throw new Error("Test asset exceeded size cap");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await stream.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (!written.bytesWritten) throw new Error("Test asset short write");
        offset += written.bytesWritten;
      }
    }
    if (hash.digest("hex") !== pin.sha256)
      throw new Error("Pinned test asset SHA-256 mismatch");
    await stream.sync();
    await stream.close();
    if (!(await verified(pending, pin.sha256)))
      throw new Error("Downloaded asset on-disk SHA-256 mismatch");
    await fs.rename(pending, file);
    return file;
  } catch (error) {
    await stream.close().catch(() => {});
    await fs.rm(pending, { force: true });
    throw error;
  }
}
export async function testAssets({ kubernetes = true } = {}) {
  const cache = path.resolve(
    process.env.WORKBENCH_OPS_TEST_CACHE ||
      path.join(os.tmpdir(), "workbench-ops-test-assets"),
  );
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const war = await download(
    path.join(cache, "jenkins-" + pins.jenkins.version + ".war"),
    pins.jenkins,
  );
  const bindings = JSON.parse(
    await fs
      .readFile(path.join(appRoot, "runtime/ide-tools/bindings.json"), "utf8")
      .catch(() => "{}"),
  );
  const javaHome = bindings[process.platform + "-" + process.arch]?.javaHome;
  const java =
    process.env.WORKBENCH_OPS_TEST_JAVA ||
    (javaHome &&
      path.join(
        appRoot,
        "runtime/ide-tools",
        javaHome,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      ));
  if (!java)
    throw new Error(
      "Set WORKBENCH_OPS_TEST_JAVA to an isolated Java 21+ executable",
    );
  const version = await exec(java, ["-jar", war, "--version"], {
    timeout: 30_000,
    maxBuffer: 1_048_576,
  });
  if (version.stdout.trim() !== pins.jenkins.version)
    throw new Error("Actual Jenkins WAR version mismatch");
  let envtest;
  if (kubernetes) {
    if (process.env.WORKBENCH_ENVTEST_BIN)
      envtest = path.resolve(process.env.WORKBENCH_ENVTEST_BIN);
    else {
      if (process.platform + "-" + process.arch !== pins.envtest.platform)
        throw new Error(
          "Native Kubernetes test assets are not pinned for this platform; set WORKBENCH_ENVTEST_BIN explicitly",
        );
      const archive = await download(
        path.join(
          cache,
          "envtest-v" +
            pins.envtest.version +
            "-" +
            pins.envtest.platform +
            ".tar.gz",
        ),
        pins.envtest,
      );
      const target = path.join(cache, "envtest-" + pins.envtest.version);
      const bin = path.join(target, "controller-tools/envtest");
      const stamp = path.join(target, ".verified-sha256");
      if (
        (await fs.readFile(stamp, "utf8").catch(() => "")) !==
        pins.envtest.sha256
      ) {
        const entries = await exec("tar", ["-tzf", archive], {
          timeout: 30_000,
          maxBuffer: 1_048_576,
        });
        for (const entry of entries.stdout.split("\n").filter(Boolean))
          if (
            path.posix.isAbsolute(entry) ||
            entry.split("/").includes("..") ||
            entry.includes("\\")
          )
            throw new Error("Unsafe test archive member");
        const details = await exec("tar", ["-tvzf", archive], {
          timeout: 30_000,
          maxBuffer: 1_048_576,
        });
        if (
          details.stdout
            .split("\n")
            .filter(Boolean)
            .some((line) => !["d", "-"].includes(line[0]))
        )
          throw new Error("Linked test archive member refused");
        const staging = target + "." + randomUUID();
        await fs.mkdir(staging, { mode: 0o700 });
        await exec("tar", ["-xzf", archive, "-C", staging], {
          timeout: 60_000,
          maxBuffer: 1_048_576,
        });
        await fs.writeFile(
          path.join(staging, ".verified-sha256"),
          pins.envtest.sha256,
        );
        try {
          await fs.rename(target, target + ".unverified." + randomUUID());
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await fs.rename(staging, target);
      }
      envtest = bin;
    }
    const api = await exec(
      path.join(envtest, "kube-apiserver"),
      ["--version"],
      { timeout: 30_000, maxBuffer: 1_048_576 },
    );
    if (!api.stdout.includes("v" + pins.envtest.version))
      throw new Error("Actual kube-apiserver version mismatch");
  }
  return { cache, war, java, envtest, pins };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const assets = await testAssets({
    kubernetes: !process.argv.includes("--jenkins-only"),
  });
  console.log(
    JSON.stringify({
      jenkins: pins.jenkins.version,
      kubernetes: assets.envtest && pins.envtest.version,
      sha256: {
        jenkins: pins.jenkins.sha256,
        envtest: assets.envtest && pins.envtest.sha256,
      },
    }),
  );
}
