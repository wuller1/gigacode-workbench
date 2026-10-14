/** Opt-in upstream Jenkins and Kubernetes tests. No corporate endpoints or paid model calls. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { build } from "esbuild";
import { appRoot, testAssets } from "./ops-test-assets.mjs";
import {
  startOpsServers,
  startJenkins,
  until,
  bounded,
} from "./ops-test-servers.mjs";
import {
  runOperationsUi,
  loadedFixtureHash,
} from "../tests/fixtures/ops-ui-checks.mjs";

const require = createRequire(import.meta.url);
const kubernetes = !process.argv.includes("--jenkins-only");
const collectFailures = process.argv.includes("--collect-failures");
const ui = process.argv.includes("--ui");
const packaged = process.argv.includes("--packaged");
for (const flag of process.argv.slice(2))
  if (
    !["--collect-failures", "--ui", "--packaged", "--jenkins-only"].includes(
      flag,
    )
  )
    throw new Error("Unknown Operations test flag: " + flag);
if (packaged && !ui)
  throw new Error(
    "--packaged requires --ui to test the actual packaged provider",
  );
const reportSuffix = process.platform + (packaged ? "-packaged" : "");
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-operations-live-"),
);
const cache = path.join(appRoot, "node_modules/.cache");
await fs.mkdir(cache, { recursive: true });
const runtime = await fs.mkdtemp(path.join(cache, "operations-live-"));
const results = [],
  failedCases = [],
  changes = [],
  observations = {};
const secrets = [],
  started = new Date().toISOString();
let servers,
  secondary,
  service,
  serviceFactory,
  current = "upstream server startup",
  failure,
  cleanup;
process.on("unhandledRejection", (error) => {
  const entry = {
    test: current + " (unhandled harness promise)",
    message: String(error?.message || error),
    stack: error?.stack,
  };
  failedCases.push(entry);
  failure ||= entry;
  process.exitCode = 1;
});
const sourceHashes = {};
const loadedHarnessHash = createHash("sha256")
  .update(await fs.readFile(new URL(import.meta.url)))
  .digest("hex");
const check = async (name, fn) => {
  current = name;
  await fs.writeFile(
    path.join(directory, "phase.json"),
    JSON.stringify({ current, at: new Date().toISOString() }),
  );
  const began = Date.now();
  try {
    await fn();
    results.push({ name, elapsedMs: Date.now() - began });
    await fs.appendFile(
      path.join(directory, "progress.jsonl"),
      JSON.stringify({ status: "passed", name }) + "\n",
    );
    console.log("PASS " + name);
  } catch (error) {
    if (!collectFailures) throw error;
    const entry = {
      test: name,
      message: String(error?.message || error),
      kind: error?.kind,
      stack: error?.stack,
    };
    failedCases.push(entry);
    await fs.appendFile(
      path.join(directory, "progress.jsonl"),
      JSON.stringify({ status: "failed", name, message: entry.message }) + "\n",
    );
    failure ||= entry;
    process.exitCode = 1;
    console.log("FAIL " + name + ": " + entry.message);
  }
};
const expectFailure = async (promise, kinds) => {
  let actual;
  try {
    await promise;
  } catch (e) {
    actual = e;
  }
  assert.ok(actual, "Expected a real failed request, got success");
  assert.ok(
    kinds.includes(actual.kind),
    "Unexpected error kind: " + actual.kind,
  );
  return actual;
};
const vaultKey = randomBytes(32);
const vault = {
  available: () => true,
  encrypt(value) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
    return Buffer.concat([
      iv,
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  },
  decrypt(value) {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      vaultKey,
      value.subarray(0, 12),
    );
    cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([
      cipher.update(value.subarray(12, -16)),
      cipher.final(),
    ]).toString("utf8");
  },
};
const invoke = (method, params) => service.invoke("ops." + method, params);
const target = (connection) => ({
  connectionId: connection.id,
  expectedTargetHash: connection.targetHash,
  expectedAuthGeneration: connection.authGeneration,
});
const query = (connection, operation, input = {}, projectId = "p1") =>
  invoke("query", { projectId, ...target(connection), operation, input });
const prepare = (connection, operation, input, projectId = "p1") =>
  invoke("prepare", { projectId, ...target(connection), operation, input });
const execute = (prepared) =>
  invoke("execute", {
    projectId: prepared.projectId,
    preparedActionId: prepared.id,
  });
const reconcile = (receipt) =>
  invoke("reconcile", { projectId: receipt.projectId, receiptId: receipt.id });
async function complete(receipt, states = ["confirmed", "cancelled"]) {
  return until(
    async () => {
      const updated = await reconcile(receipt);
      if (["failed", "unknown"].includes(updated.status))
        throw Object.assign(
          new Error(
            "Unexpected action outcome " +
              updated.status +
              ": " +
              (updated.error?.message || updated.data?.reason || ""),
          ),
          { fatal: true },
        );
      return states.includes(updated.status) && updated;
    },
    { timeout: 30000, label: "Actual remote action completion", interval: 120 },
  );
}
try {
  console.log(
    JSON.stringify({
      suite: "operations-upstream-live",
      directory,
      phase: current,
    }),
  );
  const assets = await testAssets({ kubernetes });
  servers = await startOpsServers({ directory, assets, kubernetes });
  secrets.push(
    servers.jenkins.token,
    servers.cluster?.adminToken,
    servers.cluster?.readerToken,
  );
  observations.upstream = {
    jenkins: servers.jenkins.provenance,
    ...(servers.cluster ? { kubernetes: servers.cluster.provenance } : {}),
  };
  const files = [
    ...(await fs.readdir(path.join(appRoot, "electron/operations")))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => "electron/operations/" + file),
    "shared/operations.ts",
    "tools/ops-test-assets.mjs",
    "tools/ops-test-servers.mjs",
    "tools/test-operations-live.mjs",
    "tests/fixtures/ops-ui-checks.mjs",
    ...(ui
      ? [
          "electron/main.ts",
          "electron/mcp.ts",
          "src/App.tsx",
          "src/Workspace.tsx",
          "src/SettingsView.tsx",
          "src/JenkinsPanel.tsx",
          "src/ClusterPanel.tsx",
          "src/OperationsSettings.tsx",
          "src/ToolBoundary.tsx",
          "src/ops-ui.tsx",
          "src/operations.css",
        ]
      : []),
  ];
  for (const file of files)
    sourceHashes[file] = createHash("sha256")
      .update(await fs.readFile(path.join(appRoot, file)))
      .digest("hex");
  assert.equal(
    sourceHashes["tools/test-operations-live.mjs"],
    loadedHarnessHash,
    "Harness source changed after Node loaded it",
  );
  assert.equal(
    sourceHashes["tests/fixtures/ops-ui-checks.mjs"],
    loadedFixtureHash,
    "UI helper source changed after Node loaded it",
  );
  for (const [entry, name] of [
    ["service", "service"],
    ["provider", "provider"],
  ])
    await build({
      entryPoints: [path.join(appRoot, "electron/operations", entry + ".ts")],
      bundle: true,
      packages: "external",
      platform: "node",
      format: "cjs",
      target: "node22",
      outfile: path.join(runtime, name + ".cjs"),
      logLevel: "silent",
    });
  const { OpsService } = require(path.join(runtime, "service.cjs"));
  serviceFactory = () =>
    new OpsService({
      dataDir: path.join(directory, "workbench-data"),
      node: process.execPath,
      provider: path.join(runtime, "provider.cjs"),
      vault,
      changed: (projectId) => changes.push({ projectId, at: Date.now() }),
      project: (id) =>
        ["p1", "p2", "p3"].includes(id)
          ? { id, path: path.join(directory, id) }
          : undefined,
    });
  service = serviceFactory();
  await service.init();
  let ci = await invoke("connection.save", {
    connection: {
      kind: "jenkins",
      name: "Shared CI",
      environment: "User-named environment",
      enabled: true,
      projectIds: ["p1", "p2"],
      transport: "builtin",
      url: servers.jenkins.base,
      username: servers.jenkins.username,
    },
    secret: servers.jenkins.token,
  });
  await check(
    "Actual stdio MCP discovers the pinned secured Jenkins server",
    async () => {
      const inventory = await invoke("connection.probe", target(ci));
      assert.equal(inventory.server.name, "Jenkins");
      assert.equal(inventory.server.version, assets.pins.jenkins.version);
      assert.ok(inventory.capabilities.includes("ci.trigger"));
      assert.match(inventory.schemaHash, /^[a-f0-9]{64}$/);
      assert.ok(
        inventory.tools.some((tool) => tool.name === "operations_operation"),
      );
      const crumb = (await servers.jenkins.request("crumbIssuer/api/json"))
        .value;
      assert.equal(typeof crumb.crumbRequestField, "string");
    },
  );
  await check("Real root pagination and nested folder identity", async () => {
    const a = await query(ci, "ci.jobs", { limit: 2 });
    assert.equal(a.hasMore, true);
    assert.equal(typeof a.cursor, "string");
    assert.ok(a.cursor.length > 0);
    const b = await query(ci, "ci.jobs", { limit: 2, cursor: a.cursor });
    assert.equal(b.hasMore, false);
    const jobs = [...a.data.jobs, ...b.data.jobs];
    assert.equal(new Set(jobs.map((job) => job.id)).size, 4);
    assert.equal(jobs.find((job) => job.id === "Team").runnable, false);
    assert.equal(jobs.find((job) => job.id === "Disabled").disabled, true);
    const folder = await query(ci, "ci.jobs", { folder: "Team" });
    assert.deepEqual(
      folder.data.jobs.map((job) => job.fullName),
      ["Team/Build"],
    );
    observations.jenkinsCatalog = jobs.map(({ id, kind, runnable }) => ({
      id,
      kind,
      runnable,
    }));
  });
  await check(
    "Real Jenkins parameter discovery validates booleans and choices",
    async () => {
      const job = (await query(ci, "ci.job", { jobId: "Team/Build" })).data;
      assert.deepEqual(
        job.parameters.map((p) => p.name),
        ["message", "fast", "mode"],
      );
      assert.deepEqual(job.parameters.find((p) => p.name === "mode").choices, [
        "one",
        "two",
      ]);
      await expectFailure(
        prepare(ci, "ci.trigger", {
          jobId: "Team/Build",
          parameters: { fast: "true" },
        }),
        ["validation"],
      );
      await expectFailure(
        prepare(ci, "ci.trigger", {
          jobId: "Team/Build",
          parameters: { mode: "missing" },
        }),
        ["validation"],
      );
      await expectFailure(prepare(ci, "ci.trigger", { jobId: "Disabled" }), [
        "forbidden",
      ]);
    },
  );
  let buildReceipt;
  await check(
    "Prepared trigger has no side effect and duplicate execute creates one actual build",
    async () => {
      const action = await prepare(ci, "ci.trigger", {
        jobId: "Team/Build",
        parameters: {
          message: "Привет 😀 from Workbench",
          fast: false,
          mode: "two",
        },
      });
      assert.equal(
        (
          await servers.jenkins.request(
            "job/Team/job/Build/api/json?tree=builds[number]",
          )
        ).value.builds.length,
        0,
      );
      const [a, b] = await Promise.all([execute(action), execute(action)]);
      assert.equal(a.id, b.id);
      assert.equal(a.status, "accepted");
      assert.ok(a.remoteId);
      buildReceipt = await complete(a);
      assert.equal(buildReceipt.data.result, "SUCCESS");
      assert.equal(buildReceipt.data.number, 1);
      assert.equal(
        (
          await servers.jenkins.request(
            "job/Team/job/Build/api/json?tree=builds[number]",
          )
        ).value.builds.length,
        1,
      );
      assert.equal((await execute(action)).id, a.id);
      observations.jenkinsBuild = {
        receiptId: a.id,
        queueId: a.remoteId,
        number: buildReceipt.data.number,
        result: buildReceipt.data.result,
      };
    },
  );
  await check(
    "Actual progressive log preserves Unicode and its upstream byte cursor",
    async () => {
      const upstream = await servers.jenkins.request(
        `job/Team/job/Build/${buildReceipt.data.number}/logText/progressiveText?start=0`,
        { type: "text" },
      );
      observations.jenkinsProgressiveOffsets = {
        opaqueUpstreamCursor: upstream.headers["x-text-size"],
        plainUtf8BodyBytes: Buffer.byteLength(upstream.value),
        explanation:
          "Raw offsets include ConsoleNotes; plain UTF-8 body length is not a Jenkins byte cursor",
      };
      const rawLog = await fs.readFile(
        path.join(
          servers.jenkins.home,
          "jobs/Team/jobs/Build/builds",
          String(buildReceipt.data.number),
          "log",
        ),
      );
      Object.assign(observations.jenkinsProgressiveOffsets, {
        actualLogFileBytes: rawLog.length,
        consoleNoteObserved: rawLog.includes(Buffer.from("\u001b[8mha:")),
      });
      let cursor,
        text = "",
        pages = 0;
      do {
        const page = (
          await query(ci, "ci.logs", {
            jobId: "Team/Build",
            number: buildReceipt.data.number,
            ...(cursor ? { cursor } : {}),
          })
        ).data;
        assert.equal(typeof page.cursor, "string");
        assert.ok(page.cursor.length > 0);
        text += page.text;
        pages++;
        if (!page.hasMore) {
          assert.equal(
            page.cursor,
            upstream.headers["x-text-size"],
            "Final cursor must equal the actual opaque upstream offset",
          );
          break;
        }
        assert.notEqual(page.cursor, cursor);
        assert.ok(pages < 20);
        cursor = page.cursor;
      } while (true);
      assert.match(text, /WB_LIVE_DONE/);
      assert.match(text, /Привет 😀 from Workbench/);
      assert.match(text, /fast=false mode=two/);
      assert.ok(!text.includes("�"));
      observations.jenkinsLog = {
        pages,
        unicodeObserved: true,
        characters: text.length,
      };
    },
  );
  await check(
    "Absent Pipeline and JUnit plugins remain explicitly unsupported",
    async () => {
      for (const operation of ["ci.stages", "ci.tests"])
        await expectFailure(
          query(ci, operation, { jobId: "Team/Build", number: 1 }),
          ["unsupported"],
        );
    },
  );
  await check(
    "Actual running freestyle build is stopped and reconciles to ABORTED",
    async () => {
      const started = await execute(
        await prepare(ci, "ci.trigger", { jobId: "Hold" }),
      );
      const running = await until(
        async () => {
          const r = await reconcile(started);
          return r.status === "running" && r;
        },
        { timeout: 20000, label: "Actual running Jenkins build" },
      );
      const logs = (
        await query(ci, "ci.logs", {
          jobId: "Hold",
          number: running.data.number,
        })
      ).data;
      assert.match(logs.text, /WB_HOLD_BEGIN/);
      const stopped = await complete(
        await execute(
          await prepare(ci, "ci.stop", {
            jobId: "Hold",
            number: running.data.number,
          }),
        ),
      );
      assert.equal(stopped.data.result, "ABORTED");
      const source = (
        await servers.jenkins.request(
          `job/Hold/${running.data.number}/api/json?tree=building,result`,
        )
      ).value;
      assert.deepEqual(
        { building: source.building, result: source.result },
        { building: false, result: "ABORTED" },
      );
      // The original trigger receipt must also become terminal after an external stop.
      assert.equal((await complete(started)).data.result, "ABORTED");
    },
  );
  await check(
    "Actual non-runnable-node queue entry can be cancelled without creating a build",
    async () => {
      const queued = await execute(
        await prepare(ci, "ci.trigger", { jobId: "Queued" }),
      );
      const queue = (await query(ci, "ci.queue")).data.items;
      assert.ok(queue.some((item) => String(item.id) === queued.remoteId));
      const cancelled = await complete(
        await execute(
          await prepare(ci, "ci.queueCancel", {
            queueId: Number(queued.remoteId),
          }),
        ),
      );
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.data.cancelled, true);
      assert.equal(
        (
          await servers.jenkins.request(
            "job/Queued/api/json?tree=builds[number]",
          )
        ).value.builds.length,
        0,
      );
      assert.equal((await complete(queued)).status, "cancelled");
    },
  );
  await check(
    "Shared connection favorites and project fences are enforced by actual service",
    async () => {
      await invoke("favorite", {
        projectId: "p1",
        connectionId: ci.id,
        jobId: "Team/Build",
        enabled: true,
      });
      assert.deepEqual(service.snapshot("p2").favorites, [
        { connectionId: ci.id, jobId: "Team/Build" },
      ]);
      await expectFailure(query(ci, "ci.jobs", {}, "p3"), ["forbidden"]);
      await expectFailure(
        invoke("query", {
          projectId: "p1",
          ...target(ci),
          expectedTargetHash: "outdated",
          operation: "ci.jobs",
          input: {},
        }),
        ["conflict"],
      );
    },
  );
  await check(
    "A second real Jenkins instance has isolated jobs and routing",
    async () => {
      secondary = await startJenkins({
        directory: path.join(directory, "secondary-ci"),
        assets,
      });
      secrets.push(secondary.token);
      const connection = await invoke("connection.save", {
        connection: {
          kind: "jenkins",
          name: "Independent CI",
          environment: "Renamable CI",
          enabled: true,
          projectIds: ["p2"],
          transport: "builtin",
          url: secondary.base,
          username: secondary.username,
        },
        secret: secondary.token,
      });
      await invoke("connection.probe", target(connection));
      assert.equal(
        (await query(connection, "ci.job", { jobId: "Team/Build" }, "p2")).data
          .builds.length,
        0,
      );
      const receipt = await complete(
        await execute(
          await prepare(
            connection,
            "ci.trigger",
            { jobId: "Team/Build", parameters: { message: "SECOND_INSTANCE" } },
            "p2",
          ),
        ),
      );
      assert.equal(receipt.data.number, 1);
      assert.equal(
        (await query(ci, "ci.job", { jobId: "Team/Build" })).data.builds.length,
        1,
      );
      assert.match(
        (
          await query(
            connection,
            "ci.logs",
            { jobId: "Team/Build", number: 1 },
            "p2",
          )
        ).data.text,
        /SECOND_INSTANCE/,
      );
      await expectFailure(query(connection, "ci.jobs", {}, "p1"), [
        "forbidden",
      ]);
      observations.secondJenkins = {
        version: secondary.provenance.version,
        independentHome: true,
        independentQueueAndBuild: true,
      };
    },
  );
  if (servers.cluster) {
    const cluster = servers.cluster,
      ns = "workbench-live";
    await cluster.request("api/v1/namespaces", {
      method: "POST",
      body: { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } },
    });
    const cm = (name, value) => ({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name, namespace: ns },
      data: { value },
    });
    await cluster.request(
      `api/v1/namespaces/${ns}/configmaps/editable?fieldManager=gigacode-workbench`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/apply-patch+yaml" },
        body: cm("editable", "before"),
      },
    );
    let k = await invoke("connection.save", {
      connection: {
        kind: "kubernetes",
        name: "Native test cluster",
        environment: "User-defined DEV label",
        enabled: true,
        projectIds: ["p1", "p2"],
        transport: "builtin",
        url: cluster.base,
        ca: cluster.ca,
      },
      secret: cluster.adminToken,
    });
    const kInput = (name = "editable") => ({
      group: "",
      version: "v1",
      resource: "configmaps",
      namespace: ns,
      name,
    });
    const actual = (name = "editable") =>
      cluster
        .request(`api/v1/namespaces/${ns}/configmaps/${name}`)
        .then((r) => r.value);
    await check(
      "Real TLS Kubernetes discovery identifies supported resources and absent OpenShift groups",
      async () => {
        const probe = await invoke("connection.probe", target(k));
        assert.equal(probe.server.name, "Kubernetes");
        assert.equal(probe.server.version, "v1.36.2");
        const discovered = (await query(k, "cluster.discovery")).data;
        assert.ok(
          discovered.resources.some(
            (r) => r.group === "apps" && r.resource === "deployments",
          ),
        );
        assert.ok(
          !discovered.resources.some((r) => r.group.endsWith("openshift.io")),
        );
        observations.kubernetesResources = discovered.resources.length;
        const missingCA = await invoke("connection.save", {
          connection: {
            kind: "kubernetes",
            name: "Untrusted CA negative control",
            environment: "",
            enabled: true,
            projectIds: ["p1"],
            transport: "builtin",
            url: cluster.base,
          },
          secret: cluster.adminToken,
        });
        await expectFailure(invoke("connection.probe", target(missingCA)), [
          "offline",
        ]);
        await invoke("connection.delete", { connectionId: missingCA.id });
      },
    );
    await check(
      "Unsafe Kubernetes path components cannot retarget a ConfigMap read or delete preflight to its namespace",
      async () => {
        const namespaceBefore = (
            await cluster.request(`api/v1/namespaces/${ns}`)
          ).value,
          objectBefore = await actual();
        await expectFailure(query(k, "cluster.get", kInput("..")), [
          "validation",
        ]);
        await expectFailure(prepare(k, "cluster.delete", kInput("..")), [
          "validation",
        ]);
        const namespaceAfter = await cluster.request(
            `api/v1/namespaces/${ns}`,
            { allowError: true },
          ),
          objectAfter = await cluster.request(
            `api/v1/namespaces/${ns}/configmaps/editable`,
            { allowError: true },
          );
        assert.equal(namespaceAfter.status, 200);
        assert.equal(objectAfter.status, 200);
        assert.equal(
          namespaceAfter.value.metadata.uid,
          namespaceBefore.metadata.uid,
        );
        assert.equal(objectAfter.value.metadata.uid, objectBefore.metadata.uid);
        assert.equal(
          objectAfter.value.metadata.resourceVersion,
          objectBefore.metadata.resourceVersion,
        );
        observations.kubernetesPathScope = {
          unsafeName: "..",
          getAndDeletePreflight: "validation rejection",
          namespaceUidPreserved: true,
          configMapUidAndRevisionPreserved: true,
          boundary:
            "Actual API state verified; zero-outbound assertion is covered separately by the provider unit fixture",
        };
      },
    );
    await check(
      "Actual Kubernetes list pagination preserves complete stable identities",
      async () => {
        for (const name of ["page-a", "page-b"])
          await cluster.request(`api/v1/namespaces/${ns}/configmaps`, {
            method: "POST",
            body: cm(name, "data"),
          });
        let cursor,
          ids = [],
          rv;
        do {
          const page = await query(k, "cluster.list", {
            ...kInput(),
            name: undefined,
            limit: 1,
            ...(cursor ? { cursor } : {}),
          });
          ids.push(...page.data.items.map((item) => item.metadata.uid));
          rv ||= page.sourceRevision;
          assert.equal(page.sourceRevision, rv);
          if (!page.hasMore) break;
          assert.ok(page.cursor);
          cursor = page.cursor;
          assert.ok(ids.length < 10);
        } while (true);
        assert.equal(ids.length, 3);
        assert.equal(new Set(ids).size, 3);
      },
    );
    await check(
      "Prepared Kubernetes dry run is read-only and exact apply is visible at the real API",
      async () => {
        const before = await actual();
        const manifest = cm("editable", "after");
        const action = await prepare(k, "cluster.apply", {
          ...kInput(),
          manifest,
        });
        assert.equal(
          (await actual()).metadata.resourceVersion,
          before.metadata.resourceVersion,
        );
        const receipt = await complete(await execute(action));
        assert.equal(receipt.status, "confirmed");
        assert.equal((await actual()).data.value, "after");
      },
    );
    await check(
      "Real stale resourceVersion is rejected without overwriting a concurrent change",
      async () => {
        const action = await prepare(k, "cluster.apply", {
          ...kInput(),
          manifest: cm("editable", "stale-write"),
        });
        await cluster.request(`api/v1/namespaces/${ns}/configmaps/editable`, {
          method: "PATCH",
          headers: { "Content-Type": "application/merge-patch+json" },
          body: { data: { value: "other-writer" } },
        });
        const failed = await execute(action);
        assert.equal(failed.status, "failed");
        assert.equal(failed.error.kind, "conflict");
        assert.equal((await actual()).data.value, "other-writer");
      },
    );
    await check(
      "Actual RBAC permits reader lists and denies reader mutation preflight",
      async () => {
        await cluster.request(
          `apis/rbac.authorization.k8s.io/v1/namespaces/${ns}/roles`,
          {
            method: "POST",
            body: {
              apiVersion: "rbac.authorization.k8s.io/v1",
              kind: "Role",
              metadata: { name: "readonly", namespace: ns },
              rules: [
                {
                  apiGroups: [""],
                  resources: ["configmaps"],
                  verbs: ["get", "list", "watch"],
                },
              ],
            },
          },
        );
        await cluster.request(
          `apis/rbac.authorization.k8s.io/v1/namespaces/${ns}/rolebindings`,
          {
            method: "POST",
            body: {
              apiVersion: "rbac.authorization.k8s.io/v1",
              kind: "RoleBinding",
              metadata: { name: "readonly", namespace: ns },
              subjects: [
                {
                  kind: "User",
                  name: "workbench-reader",
                  apiGroup: "rbac.authorization.k8s.io",
                },
              ],
              roleRef: {
                apiGroup: "rbac.authorization.k8s.io",
                kind: "Role",
                name: "readonly",
              },
            },
          },
        );
        const reader = await invoke("connection.save", {
          connection: {
            kind: "kubernetes",
            name: "Actual RBAC reader",
            environment: "Readonly",
            enabled: true,
            projectIds: ["p1"],
            transport: "builtin",
            url: cluster.base,
            ca: cluster.ca,
          },
          secret: cluster.readerToken,
        });
        assert.equal(
          (
            await query(reader, "cluster.list", {
              ...kInput(),
              name: undefined,
            })
          ).data.items.length,
          3,
        );
        await expectFailure(
          prepare(reader, "cluster.apply", {
            ...kInput(),
            manifest: cm("editable", "forbidden"),
          }),
          ["forbidden"],
        );
        assert.equal((await actual()).data.value, "other-writer");
      },
    );
    await check(
      "Real Secret responses expose metadata without secret payloads",
      async () => {
        const value = randomBytes(20).toString("hex");
        secrets.push(value);
        await cluster.request(`api/v1/namespaces/${ns}/secrets`, {
          method: "POST",
          body: {
            apiVersion: "v1",
            kind: "Secret",
            metadata: { name: "private", namespace: ns },
            stringData: { password: value },
          },
        });
        const listed = await query(k, "cluster.list", {
          group: "",
          version: "v1",
          resource: "secrets",
          namespace: ns,
        });
        const item = listed.data.items[0];
        assert.equal(item.workbenchMetadataOnly, true);
        assert.ok(!("data" in item));
        assert.ok(
          !JSON.stringify(listed).includes(
            Buffer.from(value).toString("base64"),
          ),
        );
        await expectFailure(
          prepare(k, "cluster.apply", {
            group: "",
            version: "v1",
            resource: "secrets",
            namespace: ns,
            name: "private",
            manifest: {},
          }),
          ["unsupported"],
        );
      },
    );
    await check(
      "Real Kubernetes watch observes a versioned external change without repeated mutation",
      async () => {
        const listing = await query(k, "cluster.list", {
          ...kInput(),
          name: undefined,
        });
        const watch = query(k, "cluster.watch", {
          ...kInput(),
          name: undefined,
          resourceVersion: listing.sourceRevision,
          timeoutSeconds: 1,
        });
        // The request runs concurrently with the external update. Attach its
        // rejection immediately, then await the original promise below.
        void watch.catch(() => {});
        await cluster.request(`api/v1/namespaces/${ns}/configmaps/editable`, {
          method: "PATCH",
          headers: { "Content-Type": "application/merge-patch+json" },
          body: { data: { value: "watch-observed" } },
        });
        const observed = await watch;
        assert.ok(
          observed.data.events.some(
            (e) =>
              e.type === "MODIFIED" &&
              e.object.metadata.name === "editable" &&
              e.object.data.value === "watch-observed",
          ),
        );
        assert.ok(observed.sourceRevision);
      },
    );
    await check(
      "Real Deployment scale and restart modify desired state without claiming a rollout",
      async () => {
        const name = "deployment";
        await cluster.request(`apis/apps/v1/namespaces/${ns}/deployments`, {
          method: "POST",
          body: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name, namespace: ns },
            spec: {
              replicas: 1,
              selector: { matchLabels: { app: "workbench" } },
              template: {
                metadata: { labels: { app: "workbench" } },
                spec: {
                  containers: [
                    { name: "app", image: "example.invalid/workbench:not-run" },
                  ],
                },
              },
            },
          },
        });
        const input = {
          group: "apps",
          version: "v1",
          resource: "deployments",
          namespace: ns,
          name,
        };
        await complete(
          await execute(
            await prepare(k, "cluster.scale", { ...input, replicas: 2 }),
          ),
        );
        assert.equal(
          (
            await cluster.request(
              `apis/apps/v1/namespaces/${ns}/deployments/${name}`,
            )
          ).value.spec.replicas,
          2,
        );
        const restarted = await complete(
          await execute(await prepare(k, "cluster.restart", input)),
        );
        assert.ok(
          restarted.data.spec.template.metadata.annotations[
            "kubectl.kubernetes.io/restartedAt"
          ],
        );
        assert.ok(
          !restarted.data.status?.readyReplicas,
          "No kubelet/controller exists in this harness",
        );
      },
    );
    await check(
      "Test-registered mesh CRDs are discovered by the native API and their persisted resources can be read",
      async () => {
        for (const [resource, kind] of [
          ["envoyfilters", "EnvoyFilter"],
          ["destinationrules", "DestinationRule"],
        ]) {
          const plural = resource;
          await cluster.request(
            "apis/apiextensions.k8s.io/v1/customresourcedefinitions",
            {
              method: "POST",
              body: {
                apiVersion: "apiextensions.k8s.io/v1",
                kind: "CustomResourceDefinition",
                metadata: { name: plural + ".networking.istio.io" },
                spec: {
                  group: "networking.istio.io",
                  scope: "Namespaced",
                  names: { plural, singular: plural.slice(0, -1), kind },
                  versions: [
                    {
                      name: "v1alpha3",
                      served: true,
                      storage: true,
                      schema: {
                        openAPIV3Schema: {
                          type: "object",
                          properties: {
                            spec: {
                              type: "object",
                              "x-kubernetes-preserve-unknown-fields": true,
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          );
          await until(
            async () => {
              const r = await cluster.request(
                "apis/apiextensions.k8s.io/v1/customresourcedefinitions/" +
                  plural +
                  ".networking.istio.io",
              );
              return r.value.status.conditions?.some(
                (c) => c.type === "Established" && c.status === "True",
              );
            },
            { label: "Actual CRD establishment" },
          );
          await cluster.request(
            `apis/networking.istio.io/v1alpha3/namespaces/${ns}/${plural}`,
            {
              method: "POST",
              body: {
                apiVersion: "networking.istio.io/v1alpha3",
                kind,
                metadata: { name: "test", namespace: ns },
                spec: { workbenchTest: true },
              },
            },
          );
        }
        const discovery = (await query(k, "cluster.discovery")).data;
        for (const resource of ["envoyfilters", "destinationrules"]) {
          assert.ok(
            discovery.resources.some(
              (r) =>
                r.resource === resource && r.group === "networking.istio.io",
            ),
          );
          assert.equal(
            (
              await query(k, "cluster.list", {
                group: "networking.istio.io",
                version: "v1alpha3",
                resource,
                namespace: ns,
              })
            ).data.items[0].metadata.name,
            "test",
          );
        }
        observations.meshBoundary =
          "Minimal test-registered EnvoyFilter/DestinationRule schemas and native Kubernetes persistence; no official Istio CRD bundle, istiod, OpenShift controllers or Envoy data plane";
      },
    );
    await check(
      "Recreated Kubernetes name does not inherit an old UID action",
      async () => {
        const previous = await actual();
        const action = await prepare(k, "cluster.delete", kInput());
        const afterPreview = await cluster.request(
          `api/v1/namespaces/${ns}/configmaps/editable`,
          { allowError: true },
        );
        assert.equal(
          afterPreview.status,
          200,
          "Delete preflight mutated the actual API before execute",
        );
        assert.equal(afterPreview.value.metadata.uid, previous.metadata.uid);
        await cluster.request(`api/v1/namespaces/${ns}/configmaps/editable`, {
          method: "DELETE",
        });
        await cluster.request(`api/v1/namespaces/${ns}/configmaps`, {
          method: "POST",
          body: cm("editable", "new-identity"),
        });
        const replacement = await actual();
        assert.notEqual(replacement.metadata.uid, previous.metadata.uid);
        const rejected = await execute(action);
        assert.equal(rejected.status, "failed");
        assert.equal(rejected.error.kind, "conflict");
        assert.equal((await actual()).metadata.uid, replacement.metadata.uid);
        await complete(
          await execute(await prepare(k, "cluster.delete", kInput())),
        );
        assert.equal(
          (
            await cluster.request(
              `api/v1/namespaces/${ns}/configmaps/editable`,
              { allowError: true },
            )
          ).status,
          404,
        );
      },
    );
    await check(
      "Environment labels can be renamed without changing the actual target",
      async () => {
        const renamed = await invoke("connection.save", {
          connection: {
            ...k,
            name: "My preferred name",
            environment: "Integration test stand",
          },
        });
        assert.equal(renamed.targetHash, k.targetHash);
        assert.equal(renamed.authGeneration, k.authGeneration);
        assert.equal(
          (await query(renamed, "cluster.namespaces")).data.items.some(
            (n) => n.metadata.name === ns,
          ),
          true,
        );
        k = renamed;
      },
    );
  }
  if (ui) {
    current = "Actual shipped Electron Operations acceptance";
    const report = await runOperationsUi({
      root: appRoot,
      directory,
      servers,
      secondary,
      packaged,
    });
    observations.ui = {
      status: report.status,
      passed: report.passed,
      screenshots: report.screenshots,
    };
    if (report.status !== "passed")
      throw new Error(
        "Actual Electron Operations failed at " +
          report.failure?.test +
          ": " +
          report.failure?.message,
      );
  }
  await check(
    "Durable Operations restart preserves receipts, bindings and encrypted credentials",
    async () => {
      const actualBuildNumbers = (
        await query(ci, "ci.job", { jobId: "Team/Build" })
      ).data.builds.map((b) => b.number);
      const before = service.snapshot();
      await bounded(service.dispose(), 15000, "Operations source dispose");
      service = serviceFactory();
      await service.init();
      const after = service.snapshot();
      assert.deepEqual(
        after.receipts.map((r) => [r.id, r.status]),
        before.receipts.map((r) => [r.id, r.status]),
      );
      assert.deepEqual(after.favorites, before.favorites);
      assert.deepEqual(
        (await query(ci, "ci.job", { jobId: "Team/Build" })).data.builds.map(
          (b) => b.number,
        ),
        actualBuildNumbers,
        "Restart repeated or lost a real upstream build",
      );
      const persisted = await fs.readFile(
        path.join(directory, "workbench-data/operations/state.json"),
        "utf8",
      );
      for (const secret of secrets.filter(Boolean))
        assert.ok(
          !persisted.includes(secret),
          "Plaintext credential leaked to the Operations store",
        );
      assert.ok(changes.some((e) => e.projectId === "p1"));
      observations.changeEvents = changes.length;
    },
  );
  for (const [file, executedHash] of Object.entries(sourceHashes))
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(path.join(appRoot, file)))
        .digest("hex"),
      executedHash,
      "Source changed during execution: " + file,
    );
} catch (error) {
  failure = {
    test: current,
    message: String(error?.message || error),
    kind: error?.kind,
    stack: error?.stack,
  };
  process.exitCode = 1;
} finally {
  const cleanupResults = await Promise.allSettled([
    service
      ? bounded(service.dispose(), 15000, "Operations cleanup")
      : undefined,
    secondary?.stop(),
    servers?.stop(),
  ]);
  cleanup = cleanupResults.map((r) =>
    r.status === "fulfilled"
      ? { status: "fulfilled", value: r.value }
      : { status: "rejected", message: String(r.reason?.message || r.reason) },
  );
  if (cleanupResults.some((r) => r.status === "rejected")) {
    failure ||= {
      test: "Owned server cleanup",
      message: "One or more exact owned processes could not stop",
    };
    process.exitCode = 1;
  }
  const report = {
    suite: "operations-upstream-live",
    status: failure ? "failed" : "passed",
    started,
    ended: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      uiMode: ui
        ? packaged
          ? "packaged App and its actual MCP provider"
          : "source App and its actual MCP provider"
        : "not requested",
      scope: `Actual OpsService → stdio MCP → ${secondary ? "two" : servers?.jenkins ? "one" : "no initialized"} secured real Jenkins instances${servers?.cluster ? " / native Kubernetes API" : "; Kubernetes not run"}; no provider/model/corporate access`,
      vaultBoundary:
        "Ephemeral test AES-GCM vault, Electron OS credential encryption verified separately",
    },
    passed: results.length,
    cases: results,
    failedCases,
    observations,
    sourceHashes,
    cleanup,
    ...(failure ? { failure } : {}),
  };
  let serialized = JSON.stringify(report, null, 2);
  for (const secret of secrets.filter(Boolean))
    serialized = serialized.split(secret).join("[redacted]");
  await fs.writeFile(path.join(directory, "result.json"), serialized);
  const published = path.join(appRoot, "test-results/operations");
  await fs.mkdir(published, { recursive: true });
  await fs.writeFile(
    path.join(published, `result-${reportSuffix}.json`),
    serialized,
  );
  await fs.rm(runtime, { recursive: true, force: true }).catch(() => {});
  console.log(serialized);
  console.log("Evidence: " + path.join(directory, "result.json"));
}
