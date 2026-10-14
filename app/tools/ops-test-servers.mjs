/** Test-owned upstream servers. Never uses a corporate endpoint, home, kubeconfig or token. */
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import net from "node:net";
import https from "node:https";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { testAssets } from "./ops-test-assets.mjs";

const exec = promisify(execFile);
const groovyString = (value) => JSON.stringify(value).replaceAll("$", "\\$");
const sha = (value, algorithm = "sha256") =>
  createHash(algorithm)
    .update(value)
    .digest(algorithm === "sha1" ? "base64" : "hex");
export const pluginPins = [
  {
    name: "commons-lang3-api",
    version: "3.21.0-122.v6a_ea_4fd34049",
    sha1: "CNyk6YwkL9Se1Fyj39gdTIX20Gk=",
  },
  {
    name: "ionicons-api",
    version: "94.vcc3065403257",
    sha1: "594kBrMGiuhTjBe53vJ8P9/9AcY=",
  },
  {
    name: "cloudbees-folder",
    version: "6.1106.v3a_d9a_6d2465e",
    sha1: "Iqnkt/oldPguA9pHzj6t1weOfX4=",
  },
];
export async function until(
  test,
  { timeout = 30000, label = "server readiness", interval = 80, child } = {},
) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(label + ": owned child exited before readiness");
    try {
      const result = await test();
      if (result) return result;
    } catch (e) {
      if (e?.fatal) throw e;
      last = e;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(
    label + " timed out" + (last ? ": " + String(last.message || last) : ""),
  );
}
export function bounded(promise, timeout = 10000, label = "operation") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(label + " timed out")),
      timeout,
    );
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function privateEnvironment(home, extra = {}) {
  const env = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return { ...env, HOME: home, USERPROFILE: home, ...extra };
}
async function ownedProcess(command, args, { home, log, env = {} }) {
  const output = createWriteStream(log, { flags: "wx", mode: 0o600 });
  const child = spawn(command, args, {
    cwd: home,
    env: privateEnvironment(home, env),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let size = 0;
  const record = (chunk) => {
    if (size < 8 * 1024 ** 2) {
      output.write(chunk.subarray(0, 8 * 1024 ** 2 - size));
      size += chunk.length;
    }
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.once("close", () => output.end());
  const stopped = once(child, "close").catch(() => {});
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32")
        await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          timeout: 8000,
          windowsHide: true,
        }).catch((e) => {
          if (child.exitCode === null && child.signalCode === null) throw e;
        });
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
        }
        try {
          await bounded(stopped, 6000, "owned process graceful stop");
        } catch {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (e) {
            if (e.code !== "ESRCH") throw e;
          }
        }
      }
    }
    await bounded(stopped, 8000, "owned process stop");
    if (!output.closed)
      await bounded(once(output, "close"), 3000, "owned process log close");
    if (spawnError) throw spawnError;
    return {
      pid: child.pid,
      exited: child.exitCode !== null || child.signalCode !== null,
      exitCode: child.exitCode,
      signal: child.signalCode,
    };
  };
  return { child, stop, log };
}
async function installPlugins(cache, home) {
  const cacheDir = path.join(cache, "jenkins-live-plugins");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(path.join(home, "plugins"), { recursive: true });
  return Promise.all(
    pluginPins.map(async (pin) => {
      const url = `https://updates.jenkins.io/download/plugins/${pin.name}/${pin.version}/${pin.name}.hpi`;
      const cached = path.join(cacheDir, `${pin.name}-${pin.version}.hpi`);
      let data = await fs.readFile(cached).catch(() => undefined);
      if (!data || sha(data, "sha1") !== pin.sha1) {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok)
          throw new Error(
            "Test plugin download HTTP " + response.status + ": " + pin.name,
          );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 16 * 1024 ** 2)
            throw new Error("Test plugin download exceeded cap");
          chunks.push(chunk);
        }
        data = Buffer.concat(chunks);
        if (sha(data, "sha1") !== pin.sha1)
          throw new Error("Upstream test plugin SHA-1 mismatch: " + pin.name);
        await fs.writeFile(cached, data, { mode: 0o600 });
      }
      await fs.writeFile(path.join(home, "plugins", pin.name + ".jpi"), data, {
        mode: 0o600,
      });
      return {
        ...pin,
        sha256Observed: sha(data),
        source: `https://plugins.jenkins.io/api/plugin/${pin.name}`,
        download: url,
      };
    }),
  );
}
export async function startJenkins({ directory, assets }) {
  const home = path.join(directory, "jenkins-home");
  await fs.mkdir(path.join(home, "init.groovy.d"), {
    recursive: true,
    mode: 0o700,
  });
  const plugins = await installPlugins(assets.cache, home);
  const httpPort = await port(),
    base = `http://127.0.0.1:${httpPort}`;
  const username = "workbench-live",
    password = randomBytes(30).toString("hex"),
    credentialFile = path.join(home, "test-credentials.json");
  const groovy = `
    import jenkins.model.Jenkins
    import hudson.model.*
    import hudson.security.*
    import hudson.security.csrf.DefaultCrumbIssuer
    import hudson.tasks.*
    import jenkins.security.ApiTokenProperty
    import groovy.json.JsonOutput
    def j = Jenkins.get()
    def realm = new HudsonPrivateSecurityRealm(false)
    def u = realm.createAccount(${JSON.stringify(username)}, ${JSON.stringify(password)})
    j.setSecurityRealm(realm)
    def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
    strategy.setAllowAnonymousRead(false)
    j.setAuthorizationStrategy(strategy)
    j.setCrumbIssuer(new DefaultCrumbIssuer(false))
    j.setNumExecutors(2)
    j.getUpdateCenter().getSites().clear()
    j.setInstallState(jenkins.install.InstallState.INITIAL_SETUP_COMPLETED)
    def folder = j.createProject(com.cloudbees.hudson.plugins.folder.Folder, 'Team')
    def makeJob = { parent, name, command ->
      def p = parent.createProject(FreeStyleProject, name)
      p.getBuildersList().add(${process.platform === "win32" ? "new BatchFile(command)" : "new Shell(command)"})
      p.save(); return p
    }
    def quick = makeJob(folder, 'Build', ${groovyString(process.platform === "win32" ? "@echo off\r\nchcp 65001 >nul\r\necho WB_LIVE_BEGIN\r\necho %message%\r\necho fast=%fast% mode=%mode%\r\necho WB_LIVE_DONE" : "printf 'WB_LIVE_BEGIN\\n'; printf '%s\\n' \"$message\"; printf 'fast=%s mode=%s\\n' \"$fast\" \"$mode\"; printf 'WB_LIVE_DONE\\n'")})
    quick.addProperty(new ParametersDefinitionProperty([
      new StringParameterDefinition('message','default','Message'),
      new BooleanParameterDefinition('fast',true,'Fast'),
      new ChoiceParameterDefinition('mode',['one','two'] as String[],'Mode')
    ]));quick.save()
    makeJob(j, 'Hold', ${groovyString(process.platform === "win32" ? "@echo off\r\necho WB_HOLD_BEGIN\r\nping -n 61 127.0.0.1 >nul\r\necho WB_HOLD_END" : "printf 'WB_HOLD_BEGIN\\n'; sleep 60; printf 'WB_HOLD_END\\n'")})
    def queued = makeJob(j, 'Queued', ${groovyString(process.platform === "win32" ? "@echo off\r\necho SHOULD_NOT_RUN" : "printf 'SHOULD_NOT_RUN\\n'")})
    queued.setAssignedLabel(j.getLabel('workbench-no-such-node'));queued.save()
    def disabled = makeJob(j, 'Disabled', 'echo SHOULD_NOT_RUN');disabled.setDisabled(true);disabled.save()
    j.save()
    def token = u.getProperty(ApiTokenProperty.class).tokenStore.generateNewToken('workbench-live').plainValue
    u.save()
    def file = new File(${JSON.stringify(credentialFile.replaceAll("\\", "/"))})
    file.text = JsonOutput.toJson([username:${JSON.stringify(username)},token:token])
    file.setReadable(false,false);file.setWritable(false,false);file.setReadable(true,true);file.setWritable(true,true)
    println('WORKBENCH_TEST_READY')
  `;
  await fs.writeFile(
    path.join(home, "init.groovy.d/10-workbench-test.groovy"),
    groovy,
    { mode: 0o600 },
  );
  const owned = await ownedProcess(
    assets.java,
    [
      "-Dfile.encoding=UTF-8",
      "-Xmx512m",
      "-Dhttp.proxyHost=127.0.0.1",
      "-Dhttp.proxyPort=9",
      "-Dhttps.proxyHost=127.0.0.1",
      "-Dhttps.proxyPort=9",
      "-Dhttp.nonProxyHosts=127.0.0.1|localhost",
      "-Djenkins.install.runSetupWizard=false",
      "-Dhudson.model.UpdateCenter.never=true",
      "-Dhudson.model.UsageStatistics.disabled=true",
      "-jar",
      assets.war,
      "--httpListenAddress=127.0.0.1",
      "--httpPort=" + httpPort,
      "--webroot=" + path.join(home, "war"),
    ],
    {
      home,
      log: path.join(directory, "jenkins.log"),
      env: { JENKINS_HOME: home },
    },
  );
  try {
    const credentials = await until(
      async () => {
        const result = JSON.parse(await fs.readFile(credentialFile, "utf8"));
        const r = await fetch(base + "/api/json?tree=nodeName", {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(result.username + ":" + result.token).toString(
                "base64",
              ),
          },
          signal: AbortSignal.timeout(1500),
        });
        return r.ok && result;
      },
      {
        child: owned.child,
        timeout: 150000,
        label: "Real Jenkins initialization",
      },
    );
    const authorization =
      "Basic " +
      Buffer.from(credentials.username + ":" + credentials.token).toString(
        "base64",
      );
    const request = async (route, options = {}) => {
      const { type = "json", ...requestOptions } = options;
      const response = await fetch(base + "/" + route.replace(/^\//, ""), {
        ...requestOptions,
        headers: { Authorization: authorization, ...requestOptions.headers },
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(
          "Test Jenkins API HTTP " +
            response.status +
            " at " +
            route.split("?")[0],
        );
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        value: type === "text" ? text : text ? JSON.parse(text) : null,
      };
    };
    return {
      base,
      home,
      ...credentials,
      request,
      stop: owned.stop,
      log: owned.log,
      provenance: {
        version: assets.pins.jenkins.version,
        warSha256: assets.pins.jenkins.sha256,
        plugins,
        csrf: "DefaultCrumbIssuer enabled; actual user API token",
      },
    };
  } catch (error) {
    await owned.stop().catch(() => {});
    throw error;
  }
}
async function certificates(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const run = (args) =>
    exec("openssl", args, {
      cwd: directory,
      timeout: 15000,
      maxBuffer: 1024 ** 2,
    });
  await run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "1",
    "-subj",
    "/CN=Workbench-Operations-Test-CA",
  ]);
  await run([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  await fs.writeFile(
    path.join(directory, "extensions.cnf"),
    "subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n",
  );
  await run([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "1",
    "-extfile",
    "extensions.cnf",
  ]);
  await run(["genrsa", "-out", "service-account.key", "2048"]);
  for (const file of ["ca.key", "server.key", "service-account.key"])
    await fs.chmod(path.join(directory, file), 0o600);
  return await fs.readFile(path.join(directory, "ca.crt"), "utf8");
}
export async function startKubernetes({ directory, assets }) {
  if (!assets.envtest) throw new Error("Native envtest assets are required");
  const home = path.join(directory, "kubernetes-home"),
    pki = path.join(home, "pki");
  const ca = await certificates(pki);
  const [clientPort, peerPort, apiPort] = await Promise.all([
    port(),
    port(),
    port(),
  ]);
  const adminToken = randomBytes(32).toString("hex"),
    readerToken = randomBytes(32).toString("hex");
  const tokens = path.join(home, "tokens.csv");
  await fs.writeFile(
    tokens,
    `${adminToken},workbench-admin,workbench-admin,"system:masters"\n${readerToken},workbench-reader,workbench-reader\n`,
    { mode: 0o600 },
  );
  const etcdUrl = `http://127.0.0.1:${clientPort}`,
    peerUrl = `http://127.0.0.1:${peerPort}`,
    base = `https://127.0.0.1:${apiPort}`;
  const etcd = await ownedProcess(
    path.join(assets.envtest, "etcd"),
    [
      "--name=workbench",
      "--data-dir=" + path.join(home, "etcd"),
      "--listen-client-urls=" + etcdUrl,
      "--advertise-client-urls=" + etcdUrl,
      "--listen-peer-urls=" + peerUrl,
      "--initial-advertise-peer-urls=" + peerUrl,
      "--initial-cluster=workbench=" + peerUrl,
      "--initial-cluster-state=new",
      "--log-level=warn",
    ],
    { home, log: path.join(directory, "etcd.log") },
  );
  let api;
  const agent = new https.Agent({ ca, rejectUnauthorized: true });
  const request = (
    route,
    {
      token = adminToken,
      method = "GET",
      body,
      headers = {},
      allowError = false,
      timeout = 10000,
    } = {},
  ) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        base + "/" + route.replace(/^\//, ""),
        {
          agent,
          method,
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 ** 2)
              req.destroy(new Error("Test Kubernetes response exceeded cap"));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let value;
            try {
              value = raw ? JSON.parse(raw) : null;
            } catch {
              value = raw;
            }
            if (!allowError && (res.statusCode < 200 || res.statusCode >= 300))
              reject(
                new Error(
                  "Test Kubernetes API HTTP " +
                    res.statusCode +
                    " at " +
                    route.split("?")[0],
                ),
              );
            else
              resolve({ status: res.statusCode, value, headers: res.headers });
          });
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new Error("Test Kubernetes request timed out")),
      );
      req.on("error", reject);
      if (body !== undefined)
        req.write(typeof body === "string" ? body : JSON.stringify(body));
      req.end();
    });
  try {
    await until(
      async () =>
        (
          await fetch(etcdUrl + "/health", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok,
      { child: etcd.child, label: "Native etcd readiness" },
    );
    api = await ownedProcess(
      path.join(assets.envtest, "kube-apiserver"),
      [
        "--bind-address=127.0.0.1",
        "--advertise-address=127.0.0.1",
        "--secure-port=" + apiPort,
        "--etcd-servers=" + etcdUrl,
        "--service-cluster-ip-range=10.0.0.0/24",
        "--authorization-mode=RBAC",
        "--anonymous-auth=false",
        "--token-auth-file=" + tokens,
        "--tls-cert-file=" + path.join(pki, "server.crt"),
        "--tls-private-key-file=" + path.join(pki, "server.key"),
        "--client-ca-file=" + path.join(pki, "ca.crt"),
        "--service-account-key-file=" + path.join(pki, "service-account.key"),
        "--service-account-signing-key-file=" +
          path.join(pki, "service-account.key"),
        "--service-account-issuer=" + base,
        "--disable-admission-plugins=ServiceAccount",
        "--endpoint-reconciler-type=none",
        "--v=2",
      ],
      { home, log: path.join(directory, "kube-apiserver.log") },
    );
    await until(
      async () =>
        (await request("readyz", { allowError: true, timeout: 1000 }))
          .status === 200,
      {
        child: api.child,
        timeout: 60000,
        label: "Native kube-apiserver readiness",
      },
    );
    return {
      base,
      ca,
      adminToken,
      readerToken,
      home,
      request,
      logs: [api.log, etcd.log],
      provenance: {
        apiServer: assets.pins.envtest.version,
        envtestArchiveSha256: assets.pins.envtest.sha256,
        tls: "Generated private CA, trusted leaf certificate; rejectUnauthorized=true",
        boundary:
          "Real etcd and kube-apiserver only; no kubelet, scheduler, controller-manager or OpenShift distribution",
      },
      stop: async () => {
        agent.destroy();
        const statuses = await Promise.allSettled([api.stop(), etcd.stop()]);
        const failures = statuses.filter((r) => r.status === "rejected");
        if (failures.length)
          throw new AggregateError(
            failures.map((r) => r.reason),
            "Owned Kubernetes cleanup failed",
          );
        return statuses.map((r) => r.value);
      },
    };
  } catch (error) {
    agent.destroy();
    await Promise.allSettled([api?.stop(), etcd.stop()]);
    throw error;
  }
}
export async function startOpsServers({
  directory,
  kubernetes = true,
  assets,
} = {}) {
  if (!directory)
    throw new Error("An explicit isolated test directory is required");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  assets ||= await testAssets({ kubernetes });
  let jenkins, cluster;
  try {
    // Initializations are independent, but every child remains owned for cleanup.
    const results = await Promise.allSettled([
      startJenkins({ directory, assets }),
      kubernetes
        ? startKubernetes({ directory, assets })
        : Promise.resolve(undefined),
    ]);
    if (results[0].status === "fulfilled") jenkins = results[0].value;
    if (results[1].status === "fulfilled") cluster = results[1].value;
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((r) => r.reason),
        "Owned Operations servers failed to initialize",
      );
    return {
      jenkins,
      cluster,
      assets,
      stop: async () => {
        const results = await Promise.allSettled([
          jenkins.stop(),
          cluster?.stop(),
        ]);
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length)
          throw new AggregateError(
            failures.map((r) => r.reason),
            "Owned Operations servers cleanup failed",
          );
        return results.map((r) => r.value);
      },
    };
  } catch (error) {
    await Promise.allSettled([jenkins?.stop(), cluster?.stop()]);
    throw error;
  }
}
