import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  planUpgrade,
  applyUpgrade,
  normalizeMappings,
  safeRelative,
} from "./upgrade-workbench.mjs";

const folders = [];
const execute = promisify(execFile);
afterEach(async () => {
  for (const folder of folders.splice(0))
    await fs.rm(folder, { recursive: true, force: true });
});
async function setup() {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "gigacode-upgrade-")),
  );
  folders.push(directory);
  const source = path.join(directory, "source"),
    target = path.join(directory, "target");
  await fs.mkdir(path.join(source, "app/src"), { recursive: true });
  await fs.mkdir(target);
  const options = { source, target, mappings: [{ source: "app", target: "" }] };
  await fs.writeFile(
    path.join(source, "app/src/main.ts"),
    "export const version = 1;\n",
  );
  const plan = () => planUpgrade(options);
  const apply = async (extra = {}) =>
    applyUpgrade({
      ...options,
      expectedPlanHash: (await plan()).planHash,
      ...extra,
    });
  return {
    directory,
    source,
    target,
    options,
    plan,
    apply,
    file: path.join(target, "src/main.ts"),
    upstream: path.join(source, "app/src/main.ts"),
  };
}
test("plan-only is read-only, stable and explicitly targets desktop source, never a CLI installation", async () => {
  const x = await setup(),
    a = await x.plan(),
    b = await x.plan();
  assert.equal(a.planHash, b.planHash);
  assert.equal(a.product, "GigaCode Desktop source migration");
  assert.equal(a.entries[0].decision, "create");
  assert.deepEqual(await fs.readdir(x.target), []);
});
test("actual standalone CLI defaults to plan-only and requires the reviewed hash for apply", async () => {
  const x = await setup(),
    tool = fileURLToPath(new URL("./upgrade-workbench.mjs", import.meta.url));
  const mappings = path.join(x.directory, "mappings.json");
  await fs.writeFile(mappings, JSON.stringify(x.options.mappings));
  const argumentsList = [
    tool,
    "--source",
    x.source,
    "--target",
    x.target,
    "--mappings",
    mappings,
  ];
  const output = JSON.parse(
    (await execute(process.execPath, argumentsList)).stdout,
  );
  assert.equal(output.entries[0].decision, "create");
  assert.deepEqual(await fs.readdir(x.target), []);
  await assert.rejects(
    execute(process.execPath, [...argumentsList, "--apply"]),
  );
  const result = JSON.parse(
    (
      await execute(process.execPath, [
        ...argumentsList,
        "--apply",
        "--expected-plan-hash",
        output.planHash,
      ])
    ).stdout,
  );
  assert.equal(result.status, "complete");
  assert.equal(result.copied, 1);
});
test("standalone CLI accepts UTF-8 BOM mappings emitted by Windows PowerShell 5.1", async () => {
  const x = await setup(),
    tool = fileURLToPath(new URL("./upgrade-workbench.mjs", import.meta.url)),
    mappings = path.join(x.directory, "mappings.json");
  await fs.writeFile(mappings, "\ufeff" + JSON.stringify(x.options.mappings));
  const plan = JSON.parse(
    (
      await execute(process.execPath, [
        tool,
        "--source",
        x.source,
        "--target",
        x.target,
        "--mappings",
        mappings,
      ])
    ).stdout,
  );
  assert.equal(plan.entries[0].target, "src/main.ts");
  assert.equal(plan.entries[0].decision, "create");
  assert.deepEqual(await fs.readdir(x.target), []);
});
test("standalone CLI rejects invalid UTF-8 and UTF-16 mappings without echoing their content", async () => {
  const x = await setup(),
    tool = fileURLToPath(new URL("./upgrade-workbench.mjs", import.meta.url)),
    mappings = path.join(x.directory, "mappings.json"),
    canary = "PRIVATE_MAPPING_CANARY";
  for (const bytes of [
    Buffer.concat([Buffer.from([0xff]), Buffer.from(canary)]),
    Buffer.from("\ufeff" + JSON.stringify(x.options.mappings), "utf16le"),
    Buffer.from("{" + canary),
  ]) {
    await fs.writeFile(mappings, bytes);
    await assert.rejects(
      execute(process.execPath, [
        tool,
        "--source",
        x.source,
        "--target",
        x.target,
        "--mappings",
        mappings,
      ]),
      (error) => {
        assert.match(error.stderr, /must be UTF-8 JSON/);
        assert.ok(!error.stderr.includes(canary));
        assert.equal(error.stdout, "");
        return true;
      },
    );
  }
  assert.deepEqual(await fs.readdir(x.target), []);
});
test("create and incremental update use prior identical source baselines and preserve a recovery backup", async () => {
  const x = await setup();
  const first = await x.apply();
  assert.equal(first.copied, 1);
  assert.equal(first.noCliChanges, true);
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "export const version = 1;\n",
  );
  await fs.writeFile(x.upstream, "export const version = 2;\n");
  assert.equal((await x.plan()).entries[0].decision, "update");
  const second = await x.apply();
  assert.equal(second.copied, 1);
  const journal = JSON.parse(
    await fs.readFile(path.join(x.target, second.journal), "utf8"),
  );
  assert.equal(journal.status, "complete");
  assert.equal(
    await fs.readFile(
      path.join(
        x.target,
        journal.actions.find((action) => !action.metadata).backup,
      ),
      "utf8",
    ),
    "export const version = 1;\n",
  );
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "export const version = 2;\n",
  );
});
test("restricted SMB-style filesystems use exclusive copy without an overwrite fallback", async () => {
  const x = await setup(),
    originalLink = fs.link;
  fs.link = async () => {
    throw Object.assign(new Error("hard links forbidden"), { code: "EPERM" });
  };
  try {
    await x.apply();
    assert.equal(
      await fs.readFile(x.file, "utf8"),
      "export const version = 1;\n",
    );
    await fs.writeFile(x.upstream, "next source\n");
    await x.apply();
    assert.equal(await fs.readFile(x.file, "utf8"), "next source\n");
  } finally {
    fs.link = originalLink;
  }
});
test("existing better target without a baseline is held and never copied over", async () => {
  const x = await setup();
  await fs.mkdir(path.dirname(x.file));
  await fs.writeFile(x.file, "better workplace implementation\n");
  const plan = await x.plan();
  assert.equal(plan.entries[0].decision, "merge_required");
  const result = await x.apply();
  assert.equal(result.copied, 0);
  assert.equal(result.heldMerges, 1);
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "better workplace implementation\n",
  );
});
test("local changes and both-changed files require a merge rather than a force-copy", async () => {
  const x = await setup();
  await x.apply();
  await fs.writeFile(x.file, "local changes\n");
  assert.equal((await x.plan()).entries[0].decision, "merge_required");
  await fs.writeFile(x.upstream, "upstream changes\n");
  const result = await x.apply();
  assert.equal(result.heldMerges, 1);
  assert.equal(await fs.readFile(x.file, "utf8"), "local changes\n");
});
test("an explicitly adapted target remains a merge boundary on the next source release", async () => {
  const x = await setup();
  await x.apply();
  await fs.writeFile(x.file, "adapted workplace implementation\n");
  const marked = await x.apply({
    recordAdapted: ["app/src/main.ts"],
    verificationRef: "tests:workplace-ui-14",
  });
  assert.equal(marked.copied, 0);
  assert.equal(marked.heldMerges, 0);
  await fs.writeFile(x.upstream, "new upstream implementation\n");
  const entry = (await x.plan()).entries[0];
  assert.equal(entry.previousMode, "adapted");
  assert.equal(entry.decision, "merge_required");
  assert.equal(
    await fs.readFile(path.join(x.target, entry.previousSourceBase), "utf8"),
    "export const version = 1;\n",
  );
  await x.apply();
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "adapted workplace implementation\n",
  );
});
test("source/target/receipt/AGENTS changes invalidate ExpectedPlanHash before code writes", async () => {
  for (const changed of ["source", "target", "receipt", "agents"]) {
    const x = await setup();
    await x.apply();
    const plan = await x.plan();
    if (changed === "source")
      await fs.writeFile(x.upstream, "changed source\n");
    if (changed === "target") await fs.writeFile(x.file, "changed target\n");
    if (changed === "receipt")
      await fs.appendFile(
        path.join(x.target, ".gigacode-upgrade/receipt.json"),
        " ",
      );
    if (changed === "agents")
      await fs.appendFile(path.join(x.target, "AGENTS.md"), "\nHuman rules\n");
    await assert.rejects(
      applyUpgrade({ ...x.options, expectedPlanHash: plan.planHash }),
      /plan changed/,
    );
    assert.equal(
      await fs.readFile(x.file, "utf8"),
      changed === "target" ? "changed target\n" : "export const version = 1;\n",
    );
  }
});
test("a target appearing at exclusive commit is retained, not overwritten or falsely acknowledged", async () => {
  const x = await setup(),
    originalLink = fs.link;
  fs.link = async (from, to) => {
    if (to === x.file)
      await fs.writeFile(to, "concurrent target writer\n", { flag: "wx" });
    return originalLink(from, to);
  };
  try {
    await assert.rejects(x.apply(), /exclusive file installation failed/);
  } finally {
    fs.link = originalLink;
  }
  assert.equal(await fs.readFile(x.file, "utf8"), "concurrent target writer\n");
  await assert.rejects(
    fs.stat(path.join(x.target, ".gigacode-upgrade/receipt.json")),
    { code: "ENOENT" },
  );
});
test("a source edit during commit is detected and never acknowledged as a completed migration", async () => {
  const x = await setup(),
    originalLink = fs.link;
  fs.link = async (from, to) => {
    if (to === x.file)
      await fs.writeFile(x.upstream, "concurrent source writer\n");
    return originalLink(from, to);
  };
  try {
    await assert.rejects(x.apply(), /Source changed during file commit/);
  } finally {
    fs.link = originalLink;
  }
  assert.equal(
    await fs.readFile(x.upstream, "utf8"),
    "concurrent source writer\n",
  );
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "export const version = 1;\n",
  );
  await assert.rejects(
    fs.stat(path.join(x.target, ".gigacode-upgrade/receipt.json")),
    { code: "ENOENT" },
  );
});
test("new files do not delete removed upstream or unrelated local files", async () => {
  const x = await setup();
  await x.apply();
  await fs.writeFile(path.join(x.target, "local-only.txt"), "keep");
  await fs.unlink(x.upstream);
  await fs.writeFile(path.join(x.source, "app/src/new.ts"), "new");
  await x.apply();
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "export const version = 1;\n",
  );
  assert.equal(
    await fs.readFile(path.join(x.target, "local-only.txt"), "utf8"),
    "keep",
  );
});
test("credentials, runtime, CLI, memory and installed plugins are excluded from the source inventory", async () => {
  const x = await setup();
  for (const name of [
    "app/.env",
    "app/.env.local",
    "app/runtime/cli.js",
    "app/node_modules/cli.js",
    "app/bundled-cli/cli.js",
    "app/local-data/state.json",
    "app/mcp.json",
    "app/secret.key",
    "app/plugins/tool.js",
    "app/workbench-memory/context.md",
  ]) {
    await fs.mkdir(path.dirname(path.join(x.source, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(x.source, name), "PRIVATE_CANARY");
  }
  const plan = await x.plan();
  assert.equal(plan.entries.length, 1);
  await x.apply();
  assert.deepEqual((await fs.readdir(x.target)).sort(), [
    ".gigacode-upgrade",
    "AGENTS.md",
    "src",
  ]);
});
test("protected source directory exclusions also hold for mixed-case Windows aliases", async () => {
  const x = await setup();
  for (const name of [
    "app/Runtime/session.txt",
    "app/.GIGACODE/config.json",
    "app/Plugins/config.json",
    "app/NoDe_MoDuLeS/tool.js",
    "app/.GiGaCoDe-UpGrAdE/receipt.json",
    "app/WorkBench-Memory/context.md",
  ]) {
    await fs.mkdir(path.dirname(path.join(x.source, name)), { recursive: true });
    await fs.writeFile(path.join(x.source, name), "PRIVATE_AUDIT_CANARY");
  }
  assert.deepEqual((await x.plan()).entries.map((entry) => entry.source), [
    "app/src/main.ts",
  ]);
  await x.apply();
  assert.deepEqual((await fs.readdir(x.target)).sort(), [
    ".gigacode-upgrade",
    "AGENTS.md",
    "src",
  ]);
});
test("obvious embedded credentials in otherwise allowed source files stop planning without echoing their value", async () => {
  const x = await setup(),
    canary = "sk-proj-" + "MigrationCredentialCanary".repeat(3);
  await fs.writeFile(x.upstream, `export const apiKey = '${canary}';`);
  await assert.rejects(x.plan(), (error) => {
    assert.match(error.message, /token marker/);
    assert.ok(!error.message.includes(canary));
    return true;
  });
  assert.deepEqual(await fs.readdir(x.target), []);
});
test("keeps local quick-migration notes, appends the AGENTS pointer once and is idempotent", async () => {
  const x = await setup();
  await fs.writeFile(
    path.join(x.target, "AGENTS.md"),
    "# Existing rules\nKeep these.\n",
  );
  await x.apply();
  const note = path.join(x.target, ".gigacode-upgrade/QUICK-UPGRADE.md");
  await fs.appendFile(note, "\nLocal adapter instructions.\n");
  const before = await fs.readFile(
    path.join(x.target, ".gigacode-upgrade/receipt.json"),
    "utf8",
  );
  const firstPlan = await x.plan(),
    secondPlan = await x.plan();
  assert.equal(firstPlan.planHash, secondPlan.planHash);
  const result = await x.apply();
  assert.equal(result.copied, 0);
  assert.equal(
    await fs.readFile(
      path.join(x.target, ".gigacode-upgrade/receipt.json"),
      "utf8",
    ),
    before,
  );
  const agents = await fs.readFile(path.join(x.target, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("# Existing rules\nKeep these.\n"));
  assert.equal(agents.match(/<!-- gigacode-desktop-upgrade:v1 -->/g).length, 1);
  assert.ok(
    (await fs.readFile(note, "utf8")).includes("Local adapter instructions."),
  );
  assert.equal(
    await fs.readFile(
      path.join(x.target, ".gigacode-upgrade/.gitignore"),
      "utf8",
    ),
    "*\n",
  );
});
test("rejects traversal, Windows drive/ADS/reserved names and protected/colliding prefix mappings", async () => {
  for (const value of [
    "../out",
    "C:/out",
    "src/../../out",
    "/out",
    "src\\out",
    "src/file:stream",
    "src/NUL.txt",
    "src/end.",
    "src/end ",
  ])
    assert.throws(() => safeRelative(value), /Unsafe/);
  assert.throws(
    () => normalizeMappings([{ source: "app", target: ".gigacode-upgrade" }]),
    /Protected/,
  );
  assert.throws(
    () =>
      normalizeMappings([
        { source: "app", target: "a" },
        { source: "app", target: "b" },
      ]),
    /Duplicate/,
  );
  const x = await setup();
  await fs.mkdir(path.join(x.source, "ui-kit/src"), { recursive: true });
  await fs.writeFile(path.join(x.source, "ui-kit/src/main.ts"), "other");
  await assert.rejects(
    planUpgrade({
      ...x.options,
      mappings: [
        { source: "app", target: "" },
        { source: "ui-kit", target: "" },
      ],
    }),
    /collision/,
  );
});
test("mixed-case destinations cannot alias protected runtime, receipts or AGENTS on Windows", async () => {
  for (const target of [
    "Runtime",
    ".GIGACODE",
    ".GiGaCoDe-UpGrAdE",
    "src/Plugins",
    "src/.GIGACODE-UPGRADE",
  ])
    assert.throws(
      () => normalizeMappings([{ source: "app", target }]),
      /Protected/,
    );
  const x = await setup();
  for (const target of ["agents.md", "Agents.MD", "AGENTS.md"])
    await assert.rejects(
      planUpgrade({
        ...x.options,
        mappings: [{ source: "app/src/main.ts", target }],
      }),
      /reserved|protected/,
    );
  assert.deepEqual(await fs.readdir(x.target), []);
});
test("rejects source/target symlinks including a target ancestor before writes", async (t) => {
  const x = await setup(),
    external = path.join(x.directory, "external");
  await fs.mkdir(external);
  try {
    await fs.symlink(
      external,
      path.join(x.target, "src"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip("Host cannot create a symlink fixture.");
      return;
    }
    throw error;
  }
  await assert.rejects(x.plan(), /symlink|linked/);
  assert.deepEqual(await fs.readdir(external), []);
  await fs.unlink(path.join(x.target, "src"));
  await fs.symlink(
    external,
    path.join(x.source, "app/src/link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(x.plan(), /symlink/);
});
test("a foreign owner lock is not removed or bypassed", async () => {
  const x = await setup();
  await fs.mkdir(path.join(x.target, ".gigacode-upgrade"));
  const lock = path.join(x.target, ".gigacode-upgrade/owner.lock");
  await fs.writeFile(lock, '{"pid":1,"token":"foreign"}');
  await assert.rejects(x.apply(), /owns this target/);
  assert.equal(await fs.readFile(lock, "utf8"), '{"pid":1,"token":"foreign"}');
  await assert.rejects(fs.stat(x.file), { code: "ENOENT" });
});
test("does not append UTF-8 instructions into an existing UTF-16/binary AGENTS document", async () => {
  const x = await setup(),
    original = Buffer.from("Local rules", "utf16le");
  await fs.writeFile(path.join(x.target, "AGENTS.md"), original);
  await assert.rejects(x.plan(), /encoding/);
  assert.deepEqual(
    await fs.readFile(path.join(x.target, "AGENTS.md")),
    original,
  );
  await assert.rejects(fs.stat(x.file), { code: "ENOENT" });
});
test("an interrupted file commit leaves a journal and preserves the corrupt source base for recovery", async () => {
  const x = await setup();
  await x.apply();
  const plan = await x.plan(),
    base = path.join(x.target, plan.entries[0].previousSourceBase);
  await fs.writeFile(base, "corrupt retained base");
  await assert.rejects(x.apply(), /baseline is corrupt/);
  const journals = (
    await fs.readdir(path.join(x.target, ".gigacode-upgrade"))
  ).filter((name) => name.startsWith("journal-"));
  const states = await Promise.all(
    journals.map(async (name) =>
      JSON.parse(
        await fs.readFile(
          path.join(x.target, ".gigacode-upgrade", name),
          "utf8",
        ),
      ),
    ),
  );
  assert.ok(states.some((journal) => journal.status === "interrupted"));
  assert.equal(
    await fs.readFile(x.file, "utf8"),
    "export const version = 1;\n",
  );
  assert.equal(await fs.readFile(base, "utf8"), "corrupt retained base");
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, text, mode = 0x81a4, method = 0] of entries) {
    const filename = Buffer.from(name),
      content = Buffer.from(text),
      payload = method === 8 ? deflateRawSync(content) : content,
      header = Buffer.alloc(30),
      central = Buffer.alloc(46),
      checksum = crc(content);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    const local = Buffer.concat([header, filename, payload]);
    locals.push(local);
    centrals.push(Buffer.concat([central, filename]));
    offset += local.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test("reads a source ZIP directly with a release root prefix and never extracts unselected private entries", async () => {
  const x = await setup(),
    archive = path.join(x.directory, "source.zip");
  await fs.writeFile(
    archive,
    zip([
      ["gigacode-workbench/app/src/main.ts", "archive source\n", 0x81a4, 8],
      ["gigacode-workbench/app/.env", "PRIVATE_CANARY"],
    ]),
  );
  const options = { ...x.options, source: archive },
    plan = await planUpgrade(options);
  assert.equal(plan.source.kind, "zip");
  assert.equal(plan.entries.length, 1);
  await applyUpgrade({ ...options, expectedPlanHash: plan.planHash });
  assert.equal(await fs.readFile(x.file, "utf8"), "archive source\n");
  await assert.rejects(fs.stat(path.join(x.target, ".env")), {
    code: "ENOENT",
  });
});
test("ZIP source inventory excludes mixed-case protected directories before import", async () => {
  const x = await setup(),
    archive = path.join(x.directory, "source.zip");
  await fs.writeFile(
    archive,
    zip([
      ["gigacode/app/src/main.ts", "archive source\n"],
      ["gigacode/app/Runtime/session.txt", "PRIVATE_AUDIT_CANARY"],
      ["gigacode/app/.GIGACODE/config.json", "PRIVATE_AUDIT_CANARY"],
      ["gigacode/app/Plugins/config.json", "PRIVATE_AUDIT_CANARY"],
      ["gigacode/app/.GIGACODE-UPGRADE/receipt.json", "PRIVATE_AUDIT_CANARY"],
    ]),
  );
  const options = { ...x.options, source: archive },
    plan = await planUpgrade(options);
  assert.deepEqual(plan.entries.map((entry) => entry.source), [
    "app/src/main.ts",
  ]);
  await applyUpgrade({ ...options, expectedPlanHash: plan.planHash });
  assert.deepEqual((await fs.readdir(x.target)).sort(), [
    ".gigacode-upgrade",
    "AGENTS.md",
    "src",
  ]);
});
test("rejects ZIP traversal, symlink entries, duplicate/case-colliding names and corrupt content", async () => {
  const x = await setup(),
    archive = path.join(x.directory, "bad.zip");
  for (const entries of [
    [["../outside", "bad"]],
    [["app/src/link", "outside", 0xa1ff]],
    [
      ["app/src/a.ts", "a"],
      ["app/src/A.ts", "b"],
    ],
  ]) {
    await fs.writeFile(archive, zip(entries));
    await assert.rejects(planUpgrade({ ...x.options, source: archive }));
  }
  const corrupt = zip([["app/src/main.ts", "payload"]]);
  corrupt[30 + "app/src/main.ts".length] ^= 1;
  await fs.writeFile(archive, corrupt);
  await assert.rejects(
    planUpgrade({ ...x.options, source: archive }),
    /checksum/,
  );
  assert.deepEqual(await fs.readdir(x.target), []);
});
