import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchService, type WorkbenchOptions } from "../electron/service";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-adapter-"));
  const bundle = path.join(root, "bundle"),
    project = path.join(root, "project");
  await fs.mkdir(path.join(bundle, "profiles"), { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(path.join(bundle, "CORE.md"), "Use actual route facts.");
  await fs.writeFile(
    path.join(bundle, "profiles/analyst.md"),
    "# Analyst\nInspect facts.",
  );
  const options: WorkbenchOptions = {
    dataDir: path.join(root, "data"),
    bundleDir: bundle,
    emit: () => {},
    routeProfile: async () => ({
      profileId: "analyst",
      confidence: 1,
      reason: "Owned protocol fixture.",
    }),
  };
  const service = new WorkbenchService(options);
  await service.init();
  cleanups.push(async () => {
    await service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });
  const fixture = fileURLToPath(
    new URL("./fixtures/acp-fixture.mjs", import.meta.url),
  );
  await service.invoke("settings.update", {
    patch: { cliPath: fixture, cliArgs: ["--acp"], startupRetries: 0 },
  });
  const p = await service.invoke("project.create", {
    name: "Context",
    path: project,
  });
  const task = await service.invoke("task.create", {
    projectId: p.id,
    title: "Context adapter",
  });
  const session = await service.invoke("session.create", { taskId: task.id });
  await service.invoke("session.prepare", { id: session.id });
  return { options, service, session, project };
}
async function until(test: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!test()) {
    if (Date.now() > deadline)
      throw new Error("Owned adapter condition timed out.");
    await new Promise((r) => setTimeout(r, 10));
  }
}
it("uses a verified workplace reader on an unknown CLI without sending a model prompt and retains the actual session-bound counters", async () => {
  const x = await setup();
  let calls = 0;
  x.options.contextUsage = async (request) => {
    calls++;
    expect(request.signal.aborted).toBe(false);
    return {
      remoteSessionId: request.remoteSessionId,
      generation: request.generation,
      usedTokens: 203202,
      limitTokens: 256000,
      estimated: false,
      sourceRef: "owned:reader-v1",
    };
  };
  const info = await x.service.invoke("context.inspect", {
    id: x.session.id,
    refresh: true,
  });
  expect(calls).toBe(1);
  expect(info.observedUsage).toMatchObject({
    usedTokens: 203202,
    estimated: false,
  });
  const events = await fs.readFile(
    path.join(x.project, "fixture-events.jsonl"),
    "utf8",
  );
  expect(events).not.toContain('"type":"prompt"');
});
it("rejects stale remote/generation receipts and does not overwrite prior measured counters", async () => {
  const x = await setup();
  x.options.contextUsage = async (request) => ({
    remoteSessionId: request.remoteSessionId,
    generation: request.generation,
    usedTokens: 12345,
    limitTokens: 256000,
    estimated: false,
    sourceRef: "owned:valid",
  });
  await x.service.invoke("context.inspect", {
    id: x.session.id,
    refresh: true,
  });
  x.options.contextUsage = async (request) => ({
    remoteSessionId: "different-session",
    generation: request.generation + 1,
    usedTokens: 99999,
    limitTokens: 256000,
    estimated: false,
    sourceRef: "owned:stale",
  });
  const info = await x.service.invoke("context.inspect", {
    id: x.session.id,
    refresh: true,
  });
  expect(info.observedUsage.usedTokens).toBe(12345);
  expect(info.measurementNote).toContain("Invalid or stale");
});
it("aborts a hung reader on runtime shutdown and ignores its late result", async () => {
  const x = await setup();
  let entered = false,
    signal!: AbortSignal,
    resolve!: (value: any) => void;
  x.options.contextUsage = async (request) => {
    entered = true;
    signal = request.signal;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const pending = x.service.invoke("context.inspect", {
    id: x.session.id,
    refresh: true,
  });
  await until(() => entered);
  await x.service.quiesce("owned adapter shutdown");
  expect(signal.aborted).toBe(true);
  const info = await pending;
  resolve({
    remoteSessionId: "late",
    generation: 1,
    usedTokens: 90000,
    limitTokens: 256000,
    estimated: false,
    sourceRef: "owned:late",
  });
  expect(info.observedUsage?.usedTokens).not.toBe(90000);
});
it("automatically refreshes the configured free reader before the next clean dispatch", async () => {
  const x = await setup();
  let calls = 0;
  const current = () =>
    x.service.snapshot().sessions.find((s) => s.id === x.session.id)!;
  await x.service.invoke("session.send", {
    id: x.session.id,
    text: "first-context-turn",
  });
  await until(
    () =>
      current().status === "completed" &&
      !(x.service as any).launches.has(x.session.id),
  );
  x.options.contextUsage = async (request) => {
    calls++;
    return {
      remoteSessionId: request.remoteSessionId,
      generation: request.generation,
      usedTokens: 5000,
      limitTokens: 256000,
      estimated: false,
      sourceRef: "owned:auto-reader",
    };
  };
  await x.service.invoke("session.send", {
    id: x.session.id,
    text: "second-context-turn",
  });
  await until(
    () =>
      current().status === "completed" &&
      current().messages.filter((m) => m.role === "user").length === 2,
  );
  expect(calls).toBe(1);
});
