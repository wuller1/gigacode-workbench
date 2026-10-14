import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { OpsService } from "../electron/operations/service";
import { OpsMcpClient } from "../electron/operations/client";
import { OpsHttp } from "../electron/operations/http";
import { JenkinsApi } from "../electron/operations/jenkins";
import { KubernetesApi } from "../electron/operations/kubernetes";
import { validateEnvelope } from "../electron/operations/protocol";
import type { OpsConnection } from "../shared/operations";

let server: Server, base: string, provider: string, temporary: string;
const token = "OPS_SECRET_CANARY_786291+?&",
  state = {
    buildPosts: 0,
    buildEndpoint: "",
    queueId: 91,
    queueBuilt: false,
    buildDone: false,
    dropBuild: false,
    deny: false,
    expireWatch: false,
    mutationPosts: 0,
    patchPosts: 0,
    rv: 1,
    deleted: false,
    denyGroup: false,
    logRawExtra: 0,
    logOversized: false,
    createRaceOnPost: false,
    requiredBearer: undefined as string | undefined,
    dropClusterWrite: false,
    optionalReports: false,
    oversizedQueue: false,
    triggerLocation: undefined as string | undefined,
    queueReportedId: undefined as number | undefined,
    queueTaskName: undefined as string | undefined,
    runQueueId: undefined as number | undefined,
  };
let logStarts: number[] = [];
let deleteRequests: any[] = [];
const text = Buffer.from(
  (
    "Привет 😀 " +
    token +
    " " +
    encodeURIComponent(token) +
    " " +
    Buffer.from(token).toString("base64") +
    "\n"
  ).repeat(14000),
  "utf8",
);
function deferred() {
  let resolve!: (v?: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let queueGate:
  | {
      started: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  | undefined;
let triggerGate:
  | {
      started: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  | undefined;
const cm = () => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: {
    name: "fixture",
    namespace: "demo",
    uid: "uid-cm",
    resourceVersion: String(state.rv),
  },
  data: { value: "before" },
});
let current: any;
let requests = 0;
function conn(kind: OpsConnection["kind"] = "jenkins"): OpsConnection {
  return {
    id: "c",
    revision: 1,
    name: "Local",
    kind,
    transport: "builtin",
    environment: "any display name",
    enabled: true,
    projectIds: ["p1"],
    url: base,
    username: kind === "jenkins" ? "tester" : undefined,
    credentialConfigured: true,
    targetHash: "h",
    authGeneration: 1,
  };
}
function job(name = "Build", fullName = name, folder = false) {
  return {
    name,
    fullName,
    url: base + "/job/" + name + "/",
    _class: folder
      ? "com.cloudbees.hudson.plugins.folder.Folder"
      : "hudson.model.FreeStyleProject",
    buildable: !folder,
    disabled: false,
    inQueue: false,
    color: "blue",
    lastBuild: { number: 7, result: "SUCCESS", building: false },
  };
}
async function listen() {
  server = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url!, base || "http://127.0.0.1");
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (
      value: any,
      status = 200,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "x-jenkins": "2.test",
        ...headers,
      });
      res.end(JSON.stringify(value));
    };
    if (
      state.requiredBearer &&
      req.headers.authorization !== "Bearer " + state.requiredBearer
    ) {
      send({ message: "Expired credential" }, 401);
      return;
    }
    if (url.pathname.startsWith("/fault/")) {
      const name = url.pathname.split("/").at(-1)!;
      const oversized = /^large-(\d+)-(header|chunked)$/.exec(name);
      if (oversized) {
        const payload = Buffer.alloc(4 * 1024 ** 2 + 1024, "x");
        payload.write("<html>gateway " + token + "</html>");
        res.writeHead(Number(oversized[1]), {
          "content-type": "text/html",
          "retry-after": "2",
          ...(oversized[2] === "header"
            ? { "content-length": String(payload.length) }
            : {}),
        });
        if (oversized[2] === "chunked") res.flushHeaders();
        res.end(payload);
        return;
      }
      if (name === "invalid") {
        res.end("<html>login " + token + "</html>");
        return;
      }
      const status = Number(name);
      res.writeHead(status, {
        "content-type": "text/html",
        "retry-after": "2",
      });
      res.end("<html>error " + token + "</html>");
      return;
    }
    if (url.pathname === "/api/json") {
      send({
        jobs: [job("Folder", "Folder", true), job()],
        nodeName: "controller",
      });
      return;
    }
    if (url.pathname === "/job/Folder/api/json") {
      send({ jobs: [job("Build", "Folder/Build")] });
      return;
    }
    if (url.pathname === "/crumbIssuer/api/json") {
      send({ crumbRequestField: "Jenkins-Crumb", crumb: "test-crumb" });
      return;
    }
    if (url.pathname === "/job/Build/api/json") {
      send({
        ...job(),
        property: [
          {
            parameterDefinitions: [
              {
                name: "message",
                type: "StringParameterDefinition",
                defaultParameterValue: { value: "hello" },
              },
              {
                name: "fast",
                type: "BooleanParameterDefinition",
                defaultParameterValue: { value: true },
              },
              {
                name: "mode",
                type: "ChoiceParameterDefinition",
                choices: ["one", "two"],
              },
              {
                name: "credential",
                type: "PasswordParameterDefinition",
                defaultParameterValue: { value: token },
              },
            ],
          },
        ],
        builds: [
          {
            number: 7,
            result: state.buildDone ? "SUCCESS" : null,
            building: !state.buildDone,
            queueId: state.queueId,
          },
        ],
      });
      return;
    }
    if (url.pathname === "/job/Other/api/json") {
      send({ ...job("Other"), property: [], builds: [] });
      return;
    }
    if (/\/job\/(Build|Other)\/build(?:WithParameters)?$/.test(url.pathname)) {
      state.buildPosts++;
      state.buildEndpoint = url.pathname;
      if (triggerGate) {
        triggerGate.started.resolve();
        await triggerGate.release.promise;
      }
      if (state.dropBuild) {
        req.socket.destroy();
        return;
      }
      res.writeHead(201, {
        Location:
          state.triggerLocation || base + "/queue/item/" + state.queueId + "/",
      });
      res.end();
      return;
    }
    if (url.pathname === "/queue/api/json") {
      if (queueGate) {
        queueGate.started.resolve();
        await queueGate.release.promise;
      }
      send({
        items: state.oversizedQueue
          ? Array.from({ length: 1001 }, (_, i) => ({ id: i + 1 }))
          : [
              {
                id: state.queueId,
                why: "Waiting for executor",
                task: {
                  name: "Build",
                  fullName: "Build",
                  url: base + "/job/Build/",
                },
              },
            ],
      });
      return;
    }
    if (url.pathname === `/queue/item/${state.queueId}/api/json`) {
      send({
        id: state.queueReportedId ?? state.queueId,
        why: state.queueBuilt ? undefined : "Waiting",
        task: { fullName: state.queueTaskName ?? "Build" },
        ...(state.queueBuilt
          ? { executable: { number: 7, url: base + "/job/Build/7/" } }
          : {}),
      });
      return;
    }
    if (/\/job\/Build\/(?:7|lastBuild)\/api\/json/.test(url.pathname)) {
      send({
        number: 7,
        result: state.buildDone ? "SUCCESS" : null,
        building: !state.buildDone,
        queueId: state.runQueueId ?? state.queueId,
        artifacts: [{ fileName: "report.txt", relativePath: "report.txt" }],
      });
      return;
    }
    if (url.pathname.includes("/logText/progressiveText")) {
      const start = Number(url.searchParams.get("start") || 0);
      logStarts.push(start);
      res.writeHead(200, {
        "content-type": "text/plain",
        "X-Text-Size": String(text.length + state.logRawExtra),
        "X-More-Data": "false",
        ...(state.logOversized
          ? { "Content-Length": String(32 * 1024 ** 2 + 1) }
          : {}),
      });
      res.end(text.subarray(start));
      return;
    }
    if (
      url.pathname.endsWith("/wfapi/describe") ||
      url.pathname.endsWith("/testReport/api/json")
    ) {
      send(
        state.optionalReports
          ? {
              stages: [{ name: "Build", status: "SUCCESS" }],
              suites: [{ name: "tests", failCount: 0 }],
            }
          : { error: "no plugin" },
        state.optionalReports ? 200 : 404,
      );
      return;
    }
    if (url.pathname === "/version") {
      send({ gitVersion: "v1.test" });
      return;
    }
    if (url.pathname === "/apis") {
      send({
        groups: [
          { name: "apps", preferredVersion: { groupVersion: "apps/v1" } },
          {
            name: "networking.istio.io",
            preferredVersion: { groupVersion: "networking.istio.io/v1alpha3" },
          },
        ],
      });
      return;
    }
    if (url.pathname === "/api/v1") {
      send({
        resources: [
          {
            name: "namespaces",
            kind: "Namespace",
            namespaced: false,
            verbs: ["get", "list", "watch"],
          },
          {
            name: "configmaps",
            kind: "ConfigMap",
            namespaced: true,
            verbs: ["get", "list", "watch", "patch", "delete"],
          },
          {
            name: "secrets",
            kind: "Secret",
            namespaced: true,
            verbs: ["get", "list", "watch"],
          },
          {
            name: "events",
            kind: "Event",
            namespaced: true,
            verbs: ["list", "watch"],
          },
          {
            name: "pods",
            kind: "Pod",
            namespaced: true,
            verbs: ["get", "list"],
          },
        ],
      });
      return;
    }
    if (url.pathname === "/apis/apps/v1") {
      send({
        resources: [
          {
            name: "deployments",
            kind: "Deployment",
            namespaced: true,
            verbs: ["get", "list", "patch"],
          },
        ],
      });
      return;
    }
    if (url.pathname === "/apis/networking.istio.io/v1alpha3") {
      send(
        state.denyGroup
          ? { message: "Forbidden" }
          : {
              resources: [
                {
                  name: "envoyfilters",
                  kind: "EnvoyFilter",
                  namespaced: true,
                  verbs: ["list", "get"],
                },
                {
                  name: "destinationrules",
                  kind: "DestinationRule",
                  namespaced: true,
                  verbs: ["list", "get"],
                },
              ],
            },
        state.denyGroup ? 403 : 200,
      );
      return;
    }
    if (url.pathname.includes("selfsubjectaccessreviews")) {
      send({ status: { allowed: !state.deny } });
      return;
    }
    if (url.searchParams.get("watch") === "true") {
      if (req.headers.accept !== "application/json") {
        send({ code: 406 }, 406);
        return;
      }
      if (state.expireWatch) {
        send({ code: 410 }, 410);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ type: "ADDED", object: current }) +
          "\n" +
          JSON.stringify({
            type: "BOOKMARK",
            object: { metadata: { resourceVersion: "8" } },
          }) +
          "\n",
      );
      return;
    }
    if (url.pathname === "/api/v1/namespaces") {
      send({
        apiVersion: "v1",
        kind: "NamespaceList",
        metadata: { resourceVersion: "1" },
        items: [
          {
            apiVersion: "v1",
            kind: "Namespace",
            metadata: { name: "demo", uid: "ns" },
          },
        ],
      });
      return;
    }
    if (url.pathname === "/api/v1/namespaces/demo/secrets") {
      send({
        kind: "SecretList",
        metadata: { resourceVersion: "1" },
        items: [
          {
            apiVersion: "v1",
            kind: "Secret",
            metadata: {
              name: "private",
              namespace: "demo",
              uid: "s",
              annotations: {
                "kubectl.kubernetes.io/last-applied-configuration": token,
              },
            },
            data: { password: Buffer.from(token).toString("base64") },
          },
        ],
      });
      return;
    }
    if (url.pathname === "/api/v1/namespaces/demo/configmaps") {
      if (req.method === "POST") {
        const input = JSON.parse(body);
        if (url.searchParams.has("dryRun")) {
          send({
            ...input,
            metadata: {
              ...input.metadata,
              uid: "dry-uid",
              resourceVersion: "dry",
            },
          });
          return;
        }
        if (state.createRaceOnPost) {
          state.deleted = false;
          current = { ...cm(), data: { value: "external-owner" } };
        }
        if (!state.deleted) {
          send({ code: 409 }, 409);
          return;
        }
        state.mutationPosts++;
        state.deleted = false;
        state.rv++;
        current = {
          ...input,
          metadata: {
            ...input.metadata,
            uid: "new-uid",
            resourceVersion: String(state.rv),
          },
        };
        send(current, 201);
        return;
      }
      send({
        kind: "ConfigMapList",
        metadata: { resourceVersion: String(state.rv) },
        items: [current],
      });
      return;
    }
    if (url.pathname === "/api/v1/namespaces/demo/configmaps/fixture") {
      if (req.method === "GET") {
        send(
          state.deleted ? { code: 404 } : current,
          state.deleted ? 404 : 200,
        );
        return;
      }
      const input = JSON.parse(body || "{}");
      if (req.method === "DELETE") {
        deleteRequests.push(input);
        if (
          input.preconditions?.uid !== current.metadata.uid ||
          input.preconditions?.resourceVersion !==
            current.metadata.resourceVersion
        ) {
          send({ code: 409 }, 409);
          return;
        }
      }
      if (
        input.metadata?.resourceVersion &&
        input.metadata.resourceVersion !== String(state.rv)
      ) {
        send({ code: 409 }, 409);
        return;
      }
      if (
        req.method === "PATCH" &&
        req.headers["content-type"] === "application/apply-patch+yaml" &&
        input.metadata?.managedFields
      ) {
        send({ message: "metadata.managedFields must be nil" }, 400);
        return;
      }
      if (req.method === "PATCH") state.patchPosts++;
      // Native DELETE decodes DeleteOptions from the body; query dryRun is not
      // merged into it. This fixture must fail if prepare omits body.dryRun.
      if (
        req.method === "DELETE"
          ? input.dryRun?.includes("All")
          : url.searchParams.has("dryRun")
      ) {
        send(
          req.method === "DELETE"
            ? { kind: "Status", status: "Success" }
            : { ...current, ...input },
        );
        return;
      }
      state.mutationPosts++;
      if (req.method === "DELETE") {
        state.deleted = true;
        send({ kind: "Status", status: "Success" });
        return;
      }
      state.rv++;
      current = {
        ...current,
        ...input,
        metadata: {
          ...current.metadata,
          ...input.metadata,
          resourceVersion: String(state.rv),
        },
      };
      if (state.dropClusterWrite) {
        req.socket.destroy();
        return;
      }
      send(current);
      return;
    }
    send({ message: "not found" }, 404);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      base = "http://127.0.0.1:" + (server.address() as any).port;
      resolve();
    }),
  );
}
beforeAll(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ops-backend-"));
  const cache = path.resolve("node_modules/.cache");
  await fs.mkdir(cache, { recursive: true });
  provider = path.join(
    await fs.mkdtemp(path.join(cache, "ops-provider-")),
    "provider.cjs",
  );
  await build({
    entryPoints: [path.resolve("electron/operations/provider.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    packages: "external",
    outfile: provider,
    logLevel: "silent",
  });
  current = cm();
  await listen();
}, 20000);
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(path.dirname(provider), { recursive: true, force: true });
  await fs.rm(temporary, { recursive: true, force: true });
});
function service(dir: string) {
  return new OpsService({
    dataDir: dir,
    node: process.execPath,
    provider,
    vault: {
      available: () => true,
      encrypt: (v) => Buffer.from(Buffer.from(v).map((b) => b ^ 83)),
      decrypt: (b) => Buffer.from(Buffer.from(b).map((v) => v ^ 83)).toString(),
    },
    changed: () => {},
    project: (id) => (["p1", "p2"].includes(id) ? { id } : undefined),
  });
}

describe("Operations real MCP and local API integration", () => {
  it("validates HTTPS/credentials without plaintext fallback or project escape", async () => {
    const s = service(path.join(temporary, "validation"));
    await s.init();
    try {
      await expect(
        s.invoke("ops.connection.save", {
          connection: { ...conn(), id: undefined, url: "http://example.com" },
        }),
      ).rejects.toMatchObject({ kind: "validation" });
      await expect(
        s.invoke("ops.connection.save", {
          connection: {
            ...conn(),
            id: undefined,
            url: "https://user:password@example.com",
          },
        }),
      ).rejects.toMatchObject({ kind: "validation" });
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      expect(JSON.stringify(s.snapshot())).not.toContain(token);
      expect(
        await fs.readFile(
          path.join(temporary, "validation/operations/state.json"),
          "utf8",
        ),
      ).not.toContain(token);
      await expect(
        s.invoke("ops.query", {
          projectId: "p2",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
          operation: "ci.jobs",
          input: {},
        }),
      ).rejects.toMatchObject({ kind: "forbidden" });
      await expect(
        s.invoke("ops.connection.save", { connection: c, secret: "x" }, true),
      ).rejects.toMatchObject({ kind: "forbidden" });
    } finally {
      await s.dispose();
    }
  });
  it("actual stdio MCP discovers jobs, folders and real parameter schemas, never returning password defaults", async () => {
    const s = service(path.join(temporary, "jobs"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      const inventory = await s.invoke("ops.connection.probe", {
        connectionId: c.id,
      });
      expect(inventory.server.name).toBe("Jenkins");
      expect(inventory.capabilities).toContain("ci.jobs");
      const r = await s.invoke("ops.query", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.jobs",
        input: {},
      });
      expect(r.data.jobs.map((j: any) => j.fullName)).toEqual([
        "Folder",
        "Build",
      ]);
      expect(r.data.jobs[0].runnable).toBe(false);
      const nested = await s.invoke("ops.query", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.jobs",
        input: { folder: "Folder" },
      });
      expect(nested.data.jobs[0].fullName).toBe("Folder/Build");
      const j = await s.invoke("ops.query", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.job",
        input: { jobId: "Build" },
      });
      expect(j.data.parameters[3]).toMatchObject({ supported: false });
      expect(JSON.stringify(j)).not.toContain(token);
      await s.invoke("ops.favorite", {
        projectId: "p1",
        connectionId: c.id,
        jobId: "Folder/Build",
        enabled: true,
      });
      expect(s.snapshot("p1").favorites).toEqual([
        { connectionId: c.id, jobId: "Folder/Build" },
      ]);
    } finally {
      await s.dispose();
    }
  });
  it("progressive logs preserve every Unicode display byte while raw ConsoleNote offsets differ, with immutable opaque page replay", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    try {
      state.logRawExtra = 317;
      logStarts = [];
      const first: any = (
        await api.query("ci.logs", { jobId: "Build", number: 7 })
      ).data;
      expect(first.truncated).toBe(true);
      expect(first.hasMore).toBe(true);
      expect(first.cursor).toMatch(/^0\.wb\./);
      expect(Buffer.byteLength(first.text)).toBeLessThanOrEqual(256 * 1024);
      expect(first.text).not.toContain(token);
      expect(first.text).not.toContain("�");
      const second: any = (
        await api.query("ci.logs", {
          jobId: "Build",
          number: 7,
          cursor: first.cursor,
        })
      ).data;
      expect(
        (
          await api.query("ci.logs", {
            jobId: "Build",
            number: 7,
            cursor: first.cursor,
          })
        ).data,
      ).toEqual(second);
      await expect(
        api.query("ci.logs", {
          jobId: "Other",
          number: 7,
          cursor: first.cursor,
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      const pages = [first, second];
      while (pages.at(-1).hasMore) {
        expect(pages.length).toBeLessThan(20);
        pages.push(
          (
            await api.query("ci.logs", {
              jobId: "Build",
              number: 7,
              cursor: pages.at(-1).cursor,
            })
          ).data,
        );
      }
      expect(pages.map((p) => p.text).join("")).toBe(
        h.redactText(text.toString("utf8")),
      );
      expect(
        pages.every(
          (p) =>
            Buffer.byteLength(p.text) <= 256 * 1024 && !p.text.includes("�"),
        ),
      ).toBe(true);
      expect(pages.at(-1).cursor).toBe(String(text.length + 317));
      expect(logStarts).toEqual([0]);
    } finally {
      state.logRawExtra = 0;
      await h.close();
      await api.dispose();
    }
  });
  it("oversized progressive responses fail without returning an advanced cursor", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.logOversized = true;
    try {
      await expect(
        api.query("ci.logs", { jobId: "Build", number: 7 }),
      ).rejects.toMatchObject({ kind: "payload_too_large" });
    } finally {
      state.logOversized = false;
      await h.close();
      await api.dispose();
    }
  });
  it("durable execute deduplicates concurrent requests and traces queue to actual build number", async () => {
    state.buildPosts = 0;
    state.dropBuild = false;
    state.queueBuilt = false;
    state.buildDone = false;
    const s = service(path.join(temporary, "execute"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      await s.invoke("ops.connection.probe", { connectionId: c.id });
      const p = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        operationId: "same-operation",
        input: {
          jobId: "Build",
          parameters: { message: "hello", fast: true, mode: "one" },
        },
      });
      const [a, b] = await Promise.all([
        s.invoke("ops.execute", { projectId: "p1", preparedActionId: p.id }),
        s.invoke("ops.execute", { projectId: "p1", preparedActionId: p.id }),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("accepted");
      expect(state.buildPosts).toBe(1);
      const snapshot = s.snapshot();
      expect(snapshot.prepared[0].preview).toMatchObject({ omitted: true });
      expect(snapshot.prepared[0].input).not.toHaveProperty("parameters");
      expect(snapshot.receipts[0].input).not.toHaveProperty("parameters");
      state.queueBuilt = true;
      state.buildDone = true;
      const r = await s.invoke("ops.reconcile", {
        projectId: "p1",
        receiptId: a.id,
      });
      expect(r.status).toBe("confirmed");
      expect(r.data.number).toBe(7);
      await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: p.id,
      });
      expect(state.buildPosts).toBe(1);
    } finally {
      await s.dispose();
    }
  });
  it("journal EIO after the actual POST becomes reconcilable unknown without replay or restart", async () => {
    state.buildPosts = 0;
    state.dropBuild = false;
    state.queueBuilt = false;
    state.buildDone = false;
    const s = service(path.join(temporary, "journal-post-eio"));
    await s.init();
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const c = await s.invoke("ops.connection.save", {
          connection: { ...conn(), id: undefined },
          secret: token,
        }),
        target = {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
        };
      const action = await s.invoke("ops.prepare", {
          ...target,
          operation: "ci.trigger",
          input: { jobId: "Build" },
        }),
        store = (s as any).store,
        atomic = store.atomic.bind(store);
      fault = vi
        .spyOn(store, "atomic")
        .mockImplementation(async (...args: any[]) => {
          if (state.buildPosts > 0)
            throw Object.assign(new Error("injected journal EIO after POST"), {
              code: "EIO",
            });
          return atomic(...args);
        });
      await expect(
        s.invoke("ops.execute", {
          projectId: "p1",
          preparedActionId: action.id,
        }),
      ).rejects.toMatchObject({ code: "EIO" });
      expect(state.buildPosts).toBe(1);
      const receipt = s.snapshot("p1").receipts[0];
      expect(receipt.status).toBe("dispatching");
      fault.mockRestore();
      fault = undefined;
      const reconciled = await s.invoke("ops.reconcile", {
        projectId: "p1",
        receiptId: receipt.id,
      });
      expect(reconciled.status).toBe("unknown");
      expect(state.buildPosts).toBe(1);
      expect(
        JSON.parse(
          await fs.readFile(
            path.join(temporary, "journal-post-eio/operations/state.json"),
            "utf8",
          ),
        ).receipts[0].status,
      ).toBe("unknown");
      await expect(
        s.invoke("ops.prepare", {
          ...target,
          operation: "ci.trigger",
          operationId: "new-id-after-io-fault",
          input: { jobId: "Build" },
        }),
      ).rejects.toMatchObject({ kind: "conflict", outcome: "unknown" });
      expect(state.buildPosts).toBe(1);
    } finally {
      fault?.mockRestore();
      await s.dispose();
    }
  });
  it("lost response after accepted trigger is unknown, survives restart and never repeats POST", async () => {
    state.buildPosts = 0;
    state.dropBuild = true;
    const directory = path.join(temporary, "lost");
    let s = service(directory);
    await s.init();
    let c: any, p: any, receipt: any;
    try {
      c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      p = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        operationId: "lost-operation",
        input: { jobId: "Build" },
      });
      receipt = await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: p.id,
      });
      expect(receipt.status).toBe("unknown");
      expect(state.buildPosts).toBe(1);
      c.name = "Renamed";
      const renamed = await s.invoke("ops.connection.save", { connection: c });
      expect(renamed.name).toBe("Renamed");
      await expect(
        s.invoke("ops.connection.save", {
          connection: { ...renamed, url: base + "/other" },
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        s.invoke("ops.connection.delete", { connectionId: c.id }),
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        s.invoke("ops.prepare", {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
          operation: "ci.trigger",
          operationId: "fresh-id-same-target",
          input: { jobId: "Build" },
        }),
      ).rejects.toMatchObject({ kind: "conflict", outcome: "unknown" });
      expect(state.buildPosts).toBe(1);
      state.dropBuild = false;
      const other = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        input: { jobId: "Other" },
      });
      await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: other.id,
      });
      expect(state.buildPosts).toBe(2);
    } finally {
      await s.dispose();
      state.dropBuild = false;
    }
    s = service(directory);
    await s.init();
    try {
      const duplicate = await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: p.id,
      });
      expect(duplicate.status).toBe("unknown");
      expect(state.buildPosts).toBe(2);
      const r = await s.invoke("ops.reconcile", {
        projectId: "p1",
        receiptId: receipt.id,
      });
      expect(r.status).toBe("unknown");
      expect(state.buildPosts).toBe(2);
    } finally {
      await s.dispose();
    }
  });
  it("foreign project cannot attach to an in-flight mutation even on a shared connection", async () => {
    state.dropBuild = false;
    triggerGate = { started: deferred(), release: deferred() };
    const s = service(path.join(temporary, "inflight-scope"));
    await s.init();
    let execution: Promise<any> | undefined;
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined, projectIds: ["p1", "p2"] },
        secret: token,
      });
      const p = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        input: { jobId: "Build" },
      });
      execution = s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: p.id,
      });
      await triggerGate.started.promise;
      await expect(
        s.invoke("ops.execute", { projectId: "p2", preparedActionId: p.id }),
      ).rejects.toMatchObject({ kind: "not_found" });
      triggerGate.release.resolve();
      await execution;
    } finally {
      triggerGate?.release.resolve();
      triggerGate = undefined;
      await execution;
      await s.dispose();
    }
  });
  it("a held read does not block another read or a prepared mutation on the same connection", async () => {
    queueGate = { started: deferred(), release: deferred() };
    const s = service(path.join(temporary, "parallel-reads"));
    await s.init();
    let slow: Promise<any> | undefined;
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      slow = s.invoke("ops.query", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.queue",
        input: {},
      });
      await queueGate.started.promise;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const fast = await Promise.race([
          s.invoke("ops.query", {
            projectId: "p1",
            connectionId: c.id,
            expectedTargetHash: c.targetHash,
            expectedAuthGeneration: c.authGeneration,
            operation: "ci.jobs",
            input: {},
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Fast read blocked behind held queue")),
              2000,
            );
          }),
        ]);
        expect((fast as any).data.jobs.length).toBeGreaterThan(0);
      } finally {
        clearTimeout(timeout);
      }
      const p = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        input: { jobId: "Build" },
      });
      expect(
        (
          await s.invoke("ops.execute", {
            projectId: "p1",
            preparedActionId: p.id,
          })
        ).status,
      ).toBe("accepted");
      queueGate.release.resolve();
      await slow;
    } finally {
      queueGate?.release.resolve();
      queueGate = undefined;
      await slow;
      await s.dispose();
    }
  });
  it("host monitor advances known remote runs without a UI and resumes read-only after restart", async () => {
    state.queueBuilt = true;
    state.buildDone = false;
    state.buildPosts = 0;
    const directory = path.join(temporary, "monitor");
    let s = service(directory);
    await s.init();
    let receipt: any;
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      const p = await s.invoke("ops.prepare", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.trigger",
        input: { jobId: "Build" },
      });
      receipt = await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: p.id,
      });
    } finally {
      await s.dispose();
    }
    state.buildDone = true;
    s = service(directory);
    await s.init();
    try {
      const until = Date.now() + 6000;
      while (
        s.snapshot().receipts.find((r) => r.id === receipt.id)?.status !==
        "confirmed"
      ) {
        if (Date.now() > until)
          throw new Error("Host monitor did not observe terminal result");
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(state.buildPosts).toBe(1);
    } finally {
      await s.dispose();
    }
  }, 10000);
  it("unknown receipts remain visible after more than200 newer terminal operations", async () => {
    const directory = path.join(temporary, "history");
    let s = service(directory);
    await s.init();
    const c = await s.invoke("ops.connection.save", {
      connection: { ...conn(), id: undefined },
    });
    await s.dispose();
    const file = path.join(directory, "operations/state.json"),
      stored = JSON.parse(await fs.readFile(file, "utf8"));
    const old = {
      id: "old-unknown",
      preparedActionId: "p",
      operationId: "o",
      projectId: "p1",
      connectionId: c.id,
      expectedTargetHash: c.targetHash,
      expectedAuthGeneration: c.authGeneration,
      operation: "ci.trigger",
      input: { jobId: "Build" },
      targetHash: c.targetHash,
      authGeneration: c.authGeneration,
      requestHash: "h",
      status: "unknown",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stored.receipts = [
      old,
      ...Array.from({ length: 230 }, (_, i) => ({
        ...old,
        id: "done-" + i,
        operationId: "o-" + i,
        status: "confirmed",
      })),
    ];
    await fs.writeFile(file, JSON.stringify(stored));
    s = service(directory);
    await s.init();
    try {
      const snapshot = s.snapshot("p1");
      expect(snapshot.receipts[0].id).toBe("old-unknown");
      expect(snapshot.receiptCounts).toEqual({
        unresolved: 1,
        terminal: 230,
        shown: 101,
        hasMoreTerminal: true,
      });
    } finally {
      await s.dispose();
    }
  });
  it("public query strings redact raw, URL-encoded and base64 credential echoes", async () => {
    const s = service(path.join(temporary, "redaction"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      const r = await s.invoke("ops.query", {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
        operation: "ci.logs",
        input: { jobId: "Build", number: 7 },
      });
      const body = JSON.stringify(r);
      expect(body).not.toContain(token);
      expect(body).not.toContain(encodeURIComponent(token));
      expect(body).not.toContain(Buffer.from(token).toString("base64"));
    } finally {
      await s.dispose();
    }
  });
  it("stale target/auth selection rejects query and prepare before any outbound target request", async () => {
    const s = service(path.join(temporary, "stale-target"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      const next = await s.invoke("ops.connection.save", {
        connection: { ...c, url: base + "/new-target" },
        secret: token + "-rotated",
      });
      expect(next.targetHash).not.toBe(c.targetHash);
      expect(next.authGeneration).not.toBe(c.authGeneration);
      const before = requests;
      await expect(
        s.invoke("ops.query", {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
          operation: "ci.jobs",
          input: {},
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        s.invoke("ops.prepare", {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
          operation: "ci.trigger",
          input: { jobId: "Build" },
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        s.invoke("ops.query", {
          projectId: "p1",
          connectionId: c.id,
          operation: "ci.jobs",
          input: {},
        }),
      ).rejects.toMatchObject({ kind: "validation" });
      expect(requests).toBe(before);
    } finally {
      await s.dispose();
    }
  });
  it("external corporate MCP uses exact bindings/schema validation and refuses inventory drift before mutation", async () => {
    const fixture = path.join(path.dirname(provider), "corporate.cjs"),
      file = path.join(temporary, "corp-state.json");
    await fs.writeFile(file, JSON.stringify({ version: 1, calls: [] }));
    await fs.writeFile(
      fixture,
      `
      const fs=require('node:fs');
      const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
      const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
      const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
      const read=()=>JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
      const server=new Server({name:'corporate-fixture',version:'1'},{capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
        {name:'exact_corp_read',inputSchema:{type:'object',properties:{marker:{type:'string',default:process.env.WORKBENCH_MCP_TOKEN},newFlag:{type:'boolean'}},required:read().version===1?['marker']:['marker','newFlag'],additionalProperties:false}},
        {name:'exact_corp_prepare',inputSchema:{type:'object',properties:{operation:{type:'string'},input:{type:'object'}},required:['operation','input'],additionalProperties:false}},
        {name:'exact_corp_trigger',inputSchema:{type:'object',properties:{jobId:{type:'string'}},required:['jobId'],additionalProperties:false}},
        {name:'exact_corp_reconcile',inputSchema:{type:'object',additionalProperties:true}}
      ]}));
      server.setRequestHandler(CallToolRequestSchema,async request=>{
        const state=read();state.calls.push(request.params.name);fs.writeFileSync(process.argv[2],JSON.stringify(state));
        const input=request.params.arguments;let value;
        if(request.params.name==='exact_corp_read')value={data:{jobs:state.malformed?'invalid':[{id:'Build',fullName:'Build',name:'Build',url:'',kind:'test',folder:false,runnable:true,disabled:false}],complete:true,diagnostic:process.env.WORKBENCH_MCP_TOKEN},observedAt:new Date().toISOString(),warnings:[]};
        if(request.params.name==='exact_corp_prepare')value={summary:'Run Build',input:state.injectSecret?{...input.input,defaultValue:process.env.WORKBENCH_MCP_TOKEN}:input.input,preview:{jobId:input.input.jobId}};
        if(request.params.name==='exact_corp_trigger')value={status:'accepted',remoteId:'99',data:{jobId:input.jobId,queueId:99}};
        if(request.params.name==='exact_corp_reconcile')value={status:'confirmed',remoteId:'99',data:{jobId:'Build',number:7,result:'SUCCESS'}};
        return {content:[{type:'text',text:JSON.stringify({value})}]};
      });
      server.connect(new StdioServerTransport());
    `,
    );
    const s = service(path.join(temporary, "corporate"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: {
          ...conn(),
          id: undefined,
          transport: "stdio",
          command: process.execPath,
          args: [fixture, file],
          bindings: {
            "ci.jobs": "exact_corp_read",
            prepare: "exact_corp_prepare",
            "ci.trigger": "exact_corp_trigger",
            reconcile: "exact_corp_reconcile",
          },
        },
        secret: token,
      });
      const target = {
        projectId: "p1",
        connectionId: c.id,
        expectedTargetHash: c.targetHash,
        expectedAuthGeneration: c.authGeneration,
      };
      const discovered = await s.invoke("ops.connection.probe", {
        connectionId: c.id,
      });
      expect(discovered.capabilities).toEqual(["ci.jobs", "ci.trigger"]);
      expect(discovered.adapterStatus).toBe("inventory_only");
      expect(discovered.capabilities).not.toContain("ci.queue");
      await expect(
        s.invoke("ops.query", { ...target, operation: "ci.jobs", input: {} }),
      ).rejects.toMatchObject({ kind: "validation" });
      const result = await s.invoke("ops.query", {
        ...target,
        operation: "ci.jobs",
        input: { marker: "read" },
      });
      expect(result.data.jobs[0].fullName).toBe("Build");
      expect(JSON.stringify(result)).not.toContain(token);
      const inv = await s.invoke("ops.connection.inventory", {
        connectionId: c.id,
      });
      expect(inv.tools.map((t: any) => t.name)).toContain("exact_corp_read");
      expect(JSON.stringify(inv)).not.toContain(token);
      expect(inv.capabilities).toEqual(["ci.jobs", "ci.trigger"]);
      const action = await s.invoke("ops.prepare", {
        ...target,
        operation: "ci.trigger",
        input: { jobId: "Build" },
      });
      const receipt = await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: action.id,
      });
      expect(receipt.status).toBe("accepted");
      expect(
        (
          await s.invoke("ops.reconcile", {
            projectId: "p1",
            receiptId: receipt.id,
          })
        ).status,
      ).toBe("confirmed");
      const secretState = JSON.parse(await fs.readFile(file, "utf8"));
      secretState.injectSecret = true;
      await fs.writeFile(file, JSON.stringify(secretState));
      await expect(
        s.invoke("ops.prepare", {
          ...target,
          operation: "ci.trigger",
          input: { jobId: "Build" },
        }),
      ).rejects.toMatchObject({ kind: "unsupported" });
      const afterSecret = JSON.parse(await fs.readFile(file, "utf8"));
      expect(
        afterSecret.calls.filter((v: string) => v === "exact_corp_trigger"),
      ).toHaveLength(1);
      afterSecret.injectSecret = false;
      await fs.writeFile(file, JSON.stringify(afterSecret));
      const state = JSON.parse(await fs.readFile(file, "utf8"));
      const before = state.calls.length;
      state.version = 2;
      await fs.writeFile(file, JSON.stringify(state));
      await expect(
        s.invoke("ops.prepare", {
          ...target,
          operation: "ci.trigger",
          input: { jobId: "Build" },
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      expect(JSON.parse(await fs.readFile(file, "utf8")).calls).toHaveLength(
        before,
      );
      await s.invoke("ops.connection.inventory", { connectionId: c.id });
      state.malformed = true;
      await fs.writeFile(file, JSON.stringify(state));
      await expect(
        s.invoke("ops.query", {
          ...target,
          operation: "ci.jobs",
          input: { marker: "read", newFlag: true },
        }),
      ).rejects.toMatchObject({ kind: "protocol" });
    } finally {
      await s.dispose();
    }
  });
  it("external MCP errors scrub raw/encoded/Basic credentials and expose only bounded validated error fields", async () => {
    const fixture = path.join(path.dirname(provider), "error-fixture.cjs"),
      file = path.join(temporary, "error-fixture-state.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        kind: "rate_limited",
        status: 429,
        retryAfterMs: 7200000,
        outcome: "notApplied",
      }),
    );
    await fs.writeFile(
      fixture,
      `
      const fs=require('node:fs');
      const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
      const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
      const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
      const server=new Server({name:'error-fixture',version:'1'},{capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'exact_error',inputSchema:{type:'object',additionalProperties:true}}]}));
      server.setRequestHandler(CallToolRequestSchema,async()=>{
        const settings=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),secret=process.env.WORKBENCH_MCP_TOKEN,basic='tester:'+secret;
        const message=[secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64'),basic,encodeURIComponent(basic),Buffer.from(basic).toString('base64')].join(' ')+' '+('x'.repeat(6000));
        return {isError:true,content:[{type:'text',text:JSON.stringify({error:{...settings,message,privateCredential:secret,arbitraryBody:{credentials:basic}}})}]};
      });
      server.connect(new StdioServerTransport());
    `,
    );
    const client = new OpsMcpClient(
      {
        ...conn(),
        transport: "stdio",
        command: process.execPath,
        args: [fixture, file],
        bindings: { "ci.jobs": "exact_error", execute: "exact_error" },
      },
      { node: process.execPath, provider },
      token,
    );
    await client.connect();
    try {
      const error = await client.call("ci.jobs", {}).then(
        () => {
          throw new Error("expected tool failure");
        },
        (e) => e,
      );
      expect(error.toJSON()).toMatchObject({
        kind: "rate_limited",
        status: 429,
        retryAfterMs: 3600000,
        outcome: "notApplied",
      });
      expect(error.message).toHaveLength(2000);
      expect(Object.keys(error.toJSON()).sort()).toEqual([
        "kind",
        "message",
        "outcome",
        "retryAfterMs",
        "status",
      ]);
      for (const value of [
        token,
        encodeURIComponent(token),
        Buffer.from(token).toString("base64"),
        "tester:" + token,
        encodeURIComponent("tester:" + token),
        Buffer.from("tester:" + token).toString("base64"),
      ])
        expect(JSON.stringify(error.toJSON())).not.toContain(value);
      expect(error).not.toHaveProperty("privateCredential");
      expect(error).not.toHaveProperty("arbitraryBody");
      await fs.writeFile(
        file,
        JSON.stringify({
          kind: "invented",
          status: "403",
          retryAfterMs: -1,
          outcome: "applied",
        }),
      );
      const invalid = await client
        .call(
          "execute",
          { input: {} },
          { actionOperation: "ci.trigger", dispatched: true },
        )
        .then(
          () => {
            throw new Error("expected tool failure");
          },
          (e) => e,
        );
      expect(invalid.toJSON()).toMatchObject({
        kind: "protocol",
        outcome: "unknown",
      });
      expect(invalid.toJSON()).not.toHaveProperty("status");
      expect(invalid.toJSON()).not.toHaveProperty("retryAfterMs");
      expect(invalid.message).toHaveLength(2000);
    } finally {
      await client.close();
    }
  });
  it("parameterized jobs use the defaults endpoint even when no values are overridden", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.dropBuild = false;
    try {
      const action = await api.prepare("ci.trigger", {
        jobId: "Build",
        parameters: {},
      });
      expect(action.input.parameterized).toBe(true);
      await api.execute("ci.trigger", action.input);
      expect(state.buildEndpoint).toBe("/job/Build/buildWithParameters");
    } finally {
      await h.close();
      await api.dispose();
    }
  });
  it("secret-bearing mutation strings fail before any outbound preflight rather than executing altered data", async () => {
    const s = service(path.join(temporary, "secret-action"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
        connection: { ...conn(), id: undefined },
        secret: token,
      });
      const before = requests,
        posts = state.buildPosts;
      await expect(
        s.invoke("ops.prepare", {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
          operation: "ci.trigger",
          input: {
            jobId: "Build",
            parameters: {
              message: "preserve-this-" + encodeURIComponent(token),
            },
          },
        }),
      ).rejects.toMatchObject({ kind: "unsupported" });
      expect(requests).toBe(before);
      expect(state.buildPosts).toBe(posts);
      expect(s.snapshot().prepared).toHaveLength(0);
      expect(
        await fs.readFile(
          path.join(temporary, "secret-action/operations/state.json"),
          "utf8",
        ),
      ).not.toContain(token);
    } finally {
      await s.dispose();
    }
  });
  it("queue cancellation reconciliation follows the actual canonical queue job when it became a build", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.queueBuilt = true;
    state.buildDone = true;
    try {
      const result = await api.reconcile(
        "ci.queueCancel",
        { queueId: state.queueId },
        String(state.queueId),
      );
      expect(result.status).toBe("failed");
      expect(result.data.number).toBe(7);
    } finally {
      await h.close();
      await api.dispose();
    }
  });
  it("service discovery preserves the Secret type descriptor while actual Secret data remains metadata-only", async () => {
    const s = service(path.join(temporary, "secret-descriptor"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
          connection: { ...conn("kubernetes"), id: undefined },
          secret: token,
        }),
        target = {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
        };
      const r = await s.invoke("ops.query", {
        ...target,
        operation: "cluster.discovery",
        input: {},
      });
      expect(
        r.data.resources.find((v: any) => v.resource === "secrets"),
      ).toEqual({
        group: "",
        version: "v1",
        resource: "secrets",
        kind: "Secret",
        namespaced: true,
        verbs: ["get", "list", "watch"],
      });
      const actual = await s.invoke("ops.query", {
        ...target,
        operation: "cluster.list",
        input: { resource: "secrets", namespace: "demo" },
      });
      expect(actual.data.items[0]).toMatchObject({
        kind: "Secret",
        workbenchMetadataOnly: true,
        metadata: { name: "private" },
      });
      expect(actual.data.items[0]).not.toHaveProperty("data");
    } finally {
      await s.dispose();
    }
  });
  it("createOnly uses atomic collection POST and rejects an external name race without any PATCH", async () => {
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h),
      input = {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        createOnly: true,
        manifest: {
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: "fixture", namespace: "demo" },
          data: { value: "ours" },
        },
      };
    state.deleted = false;
    current = cm();
    try {
      await expect(api.prepare("cluster.apply", input)).rejects.toMatchObject({
        kind: "conflict",
      });
      state.deleted = true;
      const action = await api.prepare("cluster.apply", input);
      const before = state.patchPosts;
      state.createRaceOnPost = true;
      await expect(
        api.execute("cluster.apply", action.input),
      ).rejects.toMatchObject({ kind: "conflict", status: 409 });
      expect(state.patchPosts).toBe(before);
      expect(current.data.value).toBe("external-owner");
      state.createRaceOnPost = false;
      state.deleted = true;
      const safe = await api.prepare("cluster.apply", input),
        created = await api.execute("cluster.apply", safe.input);
      expect(created.data.metadata.uid).toBe("new-uid");
      expect(created.data.data.value).toBe("ours");
      expect(state.patchPosts).toBe(before);
    } finally {
      state.createRaceOnPost = false;
      state.deleted = false;
      state.rv = 1;
      current = cm();
      await h.close();
    }
  });
  it("SSA from a real GET editor object removes only server-owned managedFields before dry-run", async () => {
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h);
    state.deleted = false;
    current = cm();
    try {
      const manifest = {
        ...current,
        metadata: {
          ...current.metadata,
          managedFields: [
            {
              manager: "controller",
              fieldsType: "FieldsV1",
              fieldsV1: { "f:data": {} },
            },
          ],
        },
      };
      const action: any = await api.prepare("cluster.apply", {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        uid: current.metadata.uid,
        resourceVersion: current.metadata.resourceVersion,
        manifest,
      });
      expect(action.input.manifest.metadata).not.toHaveProperty(
        "managedFields",
      );
      expect(action.input.manifest.metadata.uid).toBe(current.metadata.uid);
      expect(manifest.metadata).toHaveProperty("managedFields");
    } finally {
      await h.close();
    }
  });
  it.each([
    ["ci.jobs", { jobs: [{ name: "would-crash-renderer" }], complete: true }],
    ["ci.queue", { items: [{ id: "wrong-type" }] }],
    ["ci.logs", { text: 123, cursor: "1", hasMore: false, truncated: false }],
    [
      "cluster.list",
      { items: [{ data: { password: "hidden" } }], metadata: {} },
    ],
    [
      "cluster.discovery",
      { version: {}, resources: [{ resource: "pods", verbs: null }] },
    ],
    ["cluster.watch", { events: [{ type: "MODIFIED", object: null }] }],
  ])(
    "rejects malformed %s adapter bodies instead of renderer crashes or fake empty lists",
    (operation, data) => {
      expect(() =>
        validateEnvelope(
          { data, observedAt: new Date().toISOString(), warnings: [] },
          operation as string,
        ),
      ).toThrow(/output schema/);
    },
  );
  it("Kubernetes discovers CRDs, projects secret metadata only and resumes watch with resourceVersion", async () => {
    state.denyGroup = false;
    state.expireWatch = false;
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h);
    try {
      const d: any = (await api.query("cluster.discovery", {})).data;
      expect(d.resources.map((r: any) => r.kind)).toContain("EnvoyFilter");
      expect(d.resources.map((r: any) => r.kind)).toContain("DestinationRule");
      const secrets = await api.query("cluster.list", {
        resource: "secrets",
        namespace: "demo",
      });
      expect(JSON.stringify(secrets)).not.toContain(token);
      expect(JSON.stringify(secrets)).not.toContain(
        Buffer.from(token).toString("base64"),
      );
      expect((secrets.data as any).items[0]).not.toHaveProperty("data");
      const w = await api.query("cluster.watch", {
        resource: "configmaps",
        namespace: "demo",
        resourceVersion: "1",
      });
      expect(w.sourceRevision).toBe("8");
      expect((w.data as any).events).toHaveLength(2);
      state.expireWatch = true;
      await expect(
        api.query("cluster.watch", {
          resource: "configmaps",
          namespace: "demo",
          resourceVersion: "1",
        }),
      ).rejects.toMatchObject({ kind: "conflict", status: 410 });
    } finally {
      state.expireWatch = false;
      await h.close();
    }
  });
  it("discovery RBAC denial remains explicitly unavailable rather than an absent API", async () => {
    state.denyGroup = true;
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h);
    try {
      const r = await api.query("cluster.discovery", {});
      expect((r.data as any).unavailable).toEqual([
        { groupVersion: "networking.istio.io/v1alpha3", kind: "forbidden" },
      ]);
      expect(r.warnings[0]).toContain("forbidden");
    } finally {
      state.denyGroup = false;
      await h.close();
    }
  });
  it("Kubernetes dry-run does not mutate and stale resourceVersion cannot execute", async () => {
    state.rv = 1;
    state.deleted = false;
    state.mutationPosts = 0;
    current = cm();
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h);
    try {
      const input = {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        manifest: { ...cm(), data: { value: "after" } },
      };
      const p = await api.prepare("cluster.apply", input);
      expect(state.mutationPosts).toBe(0);
      expect(current.data.value).toBe("before");
      state.rv = 2;
      current = cm();
      await expect(api.execute("cluster.apply", p.input)).rejects.toMatchObject(
        { kind: "conflict" },
      );
      expect(state.mutationPosts).toBe(0);
      const fresh = await api.prepare("cluster.apply", {
        ...input,
        manifest: { ...cm(), data: { value: "after" } },
      });
      const accepted = await api.execute("cluster.apply", fresh.input);
      expect(state.mutationPosts).toBe(1);
      const r = await api.reconcile(
        "cluster.apply",
        fresh.input,
        accepted.remoteId,
        accepted.data,
      );
      expect(r.status).toBe("confirmed");
      expect((r.data as any).data.value).toBe("after");
      current = {
        ...current,
        data: { value: "external" },
        metadata: { ...current.metadata, resourceVersion: String(++state.rv) },
      };
      expect(
        (
          await api.reconcile(
            "cluster.apply",
            fresh.input,
            accepted.remoteId,
            accepted.data,
          )
        ).status,
      ).toBe("unknown");
    } finally {
      await h.close();
    }
  });
  it("expired bearer credentials rotate on the same target and reconcile unknown effects without replay or reviving old prepared actions", async () => {
    state.rv = 1;
    state.deleted = false;
    state.deny = false;
    state.mutationPosts = 0;
    current = cm();
    state.requiredBearer = token;
    const rotatedToken = "ROTATED_BEARER_CANARY_893217",
      s = service(path.join(temporary, "rotate-unknown"));
    await s.init();
    try {
      const c = await s.invoke("ops.connection.save", {
          connection: { ...conn("kubernetes"), id: undefined },
          secret: token,
        }),
        target = {
          projectId: "p1",
          connectionId: c.id,
          expectedTargetHash: c.targetHash,
          expectedAuthGeneration: c.authGeneration,
        };
      const input = {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        manifest: { ...cm(), data: { value: "after-rotation" } },
      };
      const oldPrepared = await s.invoke("ops.prepare", {
        ...target,
        operation: "cluster.apply",
        input,
      });
      const action = await s.invoke("ops.prepare", {
        ...target,
        operation: "cluster.apply",
        input,
      });
      state.dropClusterWrite = true;
      const unknown = await s.invoke("ops.execute", {
        projectId: "p1",
        preparedActionId: action.id,
      });
      state.dropClusterWrite = false;
      expect(unknown.status).toBe("unknown");
      expect(state.mutationPosts).toBe(1);
      expect(current.data.value).toBe("after-rotation");
      state.requiredBearer = rotatedToken;
      await expect(
        s.invoke("ops.reconcile", { projectId: "p1", receiptId: unknown.id }),
      ).rejects.toMatchObject({ kind: "unauthenticated", status: 401 });
      const rotated = await s.invoke("ops.connection.save", {
        connection: c,
        secret: rotatedToken,
      });
      expect(rotated.targetHash).toBe(c.targetHash);
      expect(rotated.authGeneration).toBe(c.authGeneration + 1);
      for (const patch of [
        { url: base + "/other" },
        { enabled: false },
        { bindings: { "cluster.get": "changed-tool" } },
      ])
        await expect(
          s.invoke("ops.connection.save", {
            connection: { ...rotated, ...patch },
          }),
        ).rejects.toMatchObject({ kind: "conflict" });
      const beforeBlocked = requests;
      await expect(
        s.invoke("ops.prepare", {
          projectId: "p1",
          connectionId: rotated.id,
          expectedTargetHash: rotated.targetHash,
          expectedAuthGeneration: rotated.authGeneration,
          operation: "cluster.apply",
          operationId: "new-id-after-auth-rotation",
          input,
        }),
      ).rejects.toMatchObject({ kind: "conflict", outcome: "unknown" });
      expect(requests).toBe(beforeBlocked);
      const observed = await s.invoke("ops.reconcile", {
        projectId: "p1",
        receiptId: unknown.id,
      });
      expect(observed.status).toBe("confirmed");
      expect(observed.authGeneration).toBe(c.authGeneration);
      expect(observed.lastObservedAuthGeneration).toBe(rotated.authGeneration);
      expect(state.mutationPosts).toBe(1);
      const beforeStale = requests;
      await expect(
        s.invoke("ops.execute", {
          projectId: "p1",
          preparedActionId: oldPrepared.id,
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
      expect(requests).toBe(beforeStale);
      expect(state.mutationPosts).toBe(1);
      const persisted = JSON.parse(
        await fs.readFile(
          path.join(temporary, "rotate-unknown/operations/state.json"),
          "utf8",
        ),
      ).receipts.find((r: any) => r.id === unknown.id);
      expect(persisted).toMatchObject({
        authGeneration: c.authGeneration,
        lastObservedAuthGeneration: rotated.authGeneration,
        status: "confirmed",
      });
      expect(JSON.stringify(s.snapshot())).not.toContain(rotatedToken);
    } finally {
      state.requiredBearer = undefined;
      state.dropClusterWrite = false;
      state.deleted = false;
      state.rv = 1;
      current = cm();
      await s.dispose();
    }
  });
  it("malformed Kubernetes target components reject before any outbound request for reads, prepare and execute", async () => {
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h),
      baseInput = {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        uid: "uid-cm",
        resourceVersion: "1",
      },
      before = requests;
    try {
      for (const key of ["group", "version", "resource", "namespace", "name"])
        for (const invalid of [
          ".",
          "..",
          "%2e%2e",
          "%2f",
          "a/b",
          "a\\b",
          "x?y=1",
          "x#y",
        ]) {
          const input = { ...baseInput, [key]: invalid };
          await expect(api.query("cluster.get", input)).rejects.toMatchObject({
            kind: "validation",
          });
          await expect(
            api.prepare("cluster.delete", input),
          ).rejects.toMatchObject({ kind: "validation" });
          await expect(
            api.execute("cluster.delete", input),
          ).rejects.toMatchObject({ kind: "validation" });
        }
      for (const key of ["uid", "resourceVersion"])
        for (const invalid of ["", false, 1, "x\nwrong"]) {
          await expect(
            api.prepare("cluster.delete", { ...baseInput, [key]: invalid }),
          ).rejects.toMatchObject({ kind: "validation" });
        }
      expect(requests).toBe(before);
      await api.query("cluster.discovery", {});
      const observed = requests;
      await expect(
        api.prepare("cluster.delete", {
          resource: "namespaces",
          namespace: "demo",
          name: "demo",
        }),
      ).rejects.toMatchObject({ kind: "validation" });
      expect(requests).toBe(observed);
    } finally {
      await h.close();
    }
  });
  it("wrong API kind/name/namespace or missing remote identity never becomes a prepared or executed DELETE", async () => {
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h),
      input = {
        resource: "configmaps",
        namespace: "demo",
        name: "fixture",
        uid: "uid-cm",
        resourceVersion: "1",
      };
    state.rv = 1;
    state.deleted = false;
    deleteRequests = [];
    try {
      for (const patch of [
        { apiVersion: "apps/v1" },
        { kind: "Namespace" },
        { metadata: { ...cm().metadata, name: "other" } },
        { metadata: { ...cm().metadata, namespace: "other" } },
        { metadata: { ...cm().metadata, uid: undefined } },
        { metadata: { ...cm().metadata, resourceVersion: undefined } },
      ]) {
        current = { ...cm(), ...patch };
        await expect(api.query("cluster.get", input)).rejects.toMatchObject({
          kind: "protocol",
        });
        await expect(
          api.prepare("cluster.delete", input),
        ).rejects.toMatchObject({ kind: "protocol" });
        await expect(
          api.execute("cluster.delete", input),
        ).rejects.toMatchObject({ kind: "protocol" });
      }
      current = cm();
      await expect(
        api.prepare("cluster.delete", { ...input, uid: "other-uid" }),
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        api.execute("cluster.delete", { ...input, uid: "other-uid" }),
      ).rejects.toMatchObject({ kind: "conflict" });
      expect(deleteRequests).toHaveLength(0);
    } finally {
      current = cm();
      await h.close();
    }
  });
  it("Operations transport rejects URL-normalized traversal and foreign hrefs before HTTP", async () => {
    const h = new OpsHttp(conn(), token),
      before = requests;
    try {
      for (const route of [
        "../outside",
        "%2e%2e/outside",
        "api/%2E%2E/%2e%2e/outside",
        "api\\..\\outside",
        "https://foreign.example/api",
        "//foreign.example/api",
        "api//other",
        "api/json#fragment",
      ]) {
        await expect(h.request(route)).rejects.toMatchObject({
          kind: "validation",
        });
      }
      expect(requests).toBe(before);
    } finally {
      await h.close();
    }
  });
  it("Jenkins rejects ambiguous IDs before outbound calls while preserving spaces, Unicode, internal dots and encoded branch names", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h),
      before = requests;
    try {
      for (const jobId of [
        ".",
        "..",
        "Folder/..",
        "Folder//Build",
        "/Build",
        "Build/",
        "Folder/ . ",
        "Folder/%2e%2e",
        "Folder/%252e%252e",
        "Folder\\Build",
        "Build?x=1",
        "Build#fragment",
        "https://foreign.example/job/Build",
      ]) {
        await expect(
          api.query("ci.run", { jobId, number: 7 }),
        ).rejects.toMatchObject({ kind: "validation" });
        await expect(
          api.prepare("ci.trigger", { jobId }),
        ).rejects.toMatchObject({ kind: "validation" });
        await expect(
          api.execute("ci.trigger", { jobId, parameters: {} }),
        ).rejects.toMatchObject({ kind: "validation" });
      }
      expect(requests).toBe(before);
      for (const jobId of ["Team A/Сборка.v2", "Folder/feature%2Fbranch"]) {
        await expect(
          api.query("ci.run", { jobId, number: 7 }),
        ).rejects.toMatchObject({ kind: "not_found" });
      }
      expect(requests).toBe(before + 2);
    } finally {
      await h.close();
      await api.dispose();
    }
  });
  it("built-in Jenkins exposes optional report adapters and distinguishes absent APIs from actual report data", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.optionalReports = false;
    try {
      const probe = await api.probe();
      expect(probe.capabilities).toEqual(
        expect.arrayContaining(["ci.tests", "ci.stages"]),
      );
      for (const operation of ["ci.tests", "ci.stages"])
        await expect(
          api.query(operation, { jobId: "Build", number: 7 }),
        ).rejects.toMatchObject({ kind: "unsupported" });
      state.optionalReports = true;
      for (const operation of ["ci.tests", "ci.stages"])
        expect(
          (await api.query(operation, { jobId: "Build", number: 7 })).data,
        ).toMatchObject({
          stages: [{ name: "Build", status: "SUCCESS" }],
          suites: [{ name: "tests", failCount: 0 }],
        });
    } finally {
      state.optionalReports = false;
      await h.close();
      await api.dispose();
    }
  });
  it("an oversized Jenkins queue reports its bound instead of silently dropping entries", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.oversizedQueue = true;
    try {
      await expect(api.query("ci.queue", {})).rejects.toMatchObject({
        kind: "payload_too_large",
      });
    } finally {
      state.oversizedQueue = false;
      await h.close();
      await api.dispose();
    }
  });
  it("same-origin foreign Jenkins contexts and mismatched queue/build identities never confirm or replay a trigger", async () => {
    const h = new OpsHttp(conn(), token),
      api = new JenkinsApi(h);
    state.dropBuild = false;
    state.buildPosts = 0;
    state.queueBuilt = true;
    state.buildDone = true;
    try {
      for (const suffix of [
        "/other-controller/queue/item/91/",
        "/queue/item/91/?different=context",
        "/queue/item/91/#fragment",
      ]) {
        state.triggerLocation = base + suffix;
        await expect(
          api.execute("ci.trigger", { jobId: "Build", parameters: {} }),
        ).rejects.toMatchObject({ kind: "protocol", outcome: "unknown" });
      }
      const posts = state.buildPosts;
      state.triggerLocation = undefined;
      state.queueReportedId = state.queueId + 1;
      expect(
        (
          await api.reconcile(
            "ci.trigger",
            { jobId: "Build" },
            String(state.queueId),
          )
        ).status,
      ).toBe("unknown");
      state.queueReportedId = undefined;
      state.queueTaskName = "Other";
      expect(
        (
          await api.reconcile(
            "ci.trigger",
            { jobId: "Build" },
            String(state.queueId),
          )
        ).status,
      ).toBe("unknown");
      state.queueTaskName = undefined;
      state.runQueueId = state.queueId + 1;
      expect(
        (
          await api.reconcile(
            "ci.trigger",
            { jobId: "Build" },
            String(state.queueId),
          )
        ).status,
      ).toBe("unknown");
      state.runQueueId = undefined;
      expect(
        (
          await api.reconcile(
            "ci.trigger",
            { jobId: "Build" },
            String(state.queueId),
          )
        ).status,
      ).toBe("confirmed");
      expect(state.buildPosts).toBe(posts);
    } finally {
      state.triggerLocation = undefined;
      state.queueReportedId = undefined;
      state.queueTaskName = undefined;
      state.runQueueId = undefined;
      await h.close();
      await api.dispose();
    }
  });
  it("DELETE preflight sends body dryRun and preserves the actual object until explicit execute", async () => {
    state.rv = 1;
    state.deleted = false;
    state.mutationPosts = 0;
    state.deny = false;
    current = cm();
    deleteRequests = [];
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h),
      input = { resource: "configmaps", namespace: "demo", name: "fixture" };
    try {
      const prepared = await api.prepare("cluster.delete", input);
      expect(state.mutationPosts).toBe(0);
      expect((await api.query("cluster.get", input)).data).toMatchObject({
        metadata: { uid: "uid-cm", resourceVersion: "1" },
        data: { value: "before" },
      });
      expect(deleteRequests).toEqual([
        {
          apiVersion: "v1",
          kind: "DeleteOptions",
          dryRun: ["All"],
          preconditions: { uid: "uid-cm", resourceVersion: "1" },
        },
      ]);
      await api.execute("cluster.delete", prepared.input);
      expect(state.mutationPosts).toBe(1);
      expect(deleteRequests[1]).toEqual({
        apiVersion: "v1",
        kind: "DeleteOptions",
        preconditions: { uid: "uid-cm", resourceVersion: "1" },
      });
      await expect(api.query("cluster.get", input)).rejects.toMatchObject({
        kind: "not_found",
        status: 404,
      });
    } finally {
      state.deleted = false;
      state.rv = 1;
      current = cm();
      await h.close();
    }
  });
  it("RBAC preflight blocks mutation on the backend", async () => {
    state.deny = true;
    state.mutationPosts = 0;
    const h = new OpsHttp(conn("kubernetes"), token),
      api = new KubernetesApi(h);
    try {
      await expect(
        api.prepare("cluster.delete", {
          resource: "configmaps",
          namespace: "demo",
          name: "fixture",
        }),
      ).rejects.toMatchObject({ kind: "forbidden" });
      expect(state.mutationPosts).toBe(0);
    } finally {
      state.deny = false;
      await h.close();
    }
  });
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "payload_too_large"],
    [429, "rate_limited"],
  ])(
    "normalizes HTTP%s HTML errors without leaking raw response",
    async (status, kind) => {
      const h = new OpsHttp(conn(), token);
      try {
        await expect(h.request("fault/" + status)).rejects.toMatchObject({
          kind,
          status,
          outcome: "notApplied",
        });
        try {
          await h.request("fault/" + status);
        } catch (e: any) {
          expect(e.message).not.toContain(token);
          if (status === 429) expect(e.retryAfterMs).toBe(2000);
        }
      } finally {
        await h.close();
      }
    },
  );
  it.each([
    [429, "header", "rate_limited", "notApplied"],
    [429, "chunked", "rate_limited", "notApplied"],
    [403, "header", "forbidden", "notApplied"],
    [500, "chunked", "protocol", "unknown"],
    [200, "header", "payload_too_large", "unknown"],
  ])(
    "oversized HTML HTTP%s/%s keeps status/retry and a conservative write outcome",
    async (status, mode, kind, outcome) => {
      const h = new OpsHttp(conn(), token);
      try {
        const error = await h
          .request(`fault/large-${status}-${mode}`, {
            method: "POST",
            body: { action: "isolated fixture" },
          })
          .then(
            () => {
              throw new Error("Expected HTTP failure");
            },
            (e) => e,
          );
        expect(error.toJSON()).toMatchObject({ kind, status, outcome });
        if (status !== 200) {
          expect(error.retryAfterMs).toBe(2000);
          expect(error.message).toContain("HTML");
        } else expect(error.retryAfterMs).toBeUndefined();
        expect(error.message.length).toBeLessThan(2000);
        expect(JSON.stringify(error.toJSON())).not.toContain(token);
        expect(JSON.stringify(error.toJSON())).not.toContain("<html>");
      } finally {
        await h.close();
      }
    },
  );
  it("a successful HTML login page is protocol failure rather than an empty success", async () => {
    const h = new OpsHttp(conn(), token);
    try {
      await expect(h.request("fault/invalid")).rejects.toMatchObject({
        kind: "protocol",
      });
    } finally {
      await h.close();
    }
  });
});
