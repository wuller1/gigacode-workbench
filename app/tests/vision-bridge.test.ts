import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  VisionBridgeService,
  defaultVisionConfig,
  mapVisionArguments,
  scrubVisionText,
  validateVisionConfig,
} from "../electron/vision-bridge";

const require = createRequire(import.meta.url);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4V8AAAAASUVORK5CYII=",
  "base64",
);
const owned: { service: VisionBridgeService; directory: string }[] = [];
afterEach(async () => {
  for (const v of owned.splice(0)) {
    await v.service.dispose();
    await fs.rm(v.directory, { recursive: true, force: true });
  }
});

async function bridge(
  options: {
    paginated?: boolean;
    cursorCycle?: boolean;
    hang?: boolean;
    looseSchema?: boolean;
    delayedMarker?: boolean;
  } = {},
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "gigacode-vision-test-"),
  );
  const server = pathToFileURL(
    require.resolve("@modelcontextprotocol/sdk/server/index.js"),
  ).href;
  const transport = pathToFileURL(
    require.resolve("@modelcontextprotocol/sdk/server/stdio.js"),
  ).href;
  const types = pathToFileURL(
    require.resolve("@modelcontextprotocol/sdk/types.js"),
  ).href;
  const script = path.join(directory, "bridge.mjs"),
    calls = path.join(directory, "calls.txt");
  const schema = {
    type: "object",
    properties: { image: { type: "string" }, prompt: { type: "string" } },
    required: options.looseSchema ? ["prompt"] : ["image", "prompt"],
    additionalProperties: options.looseSchema === true,
  };
  await fs.writeFile(
    script,
    `import{Server}from${JSON.stringify(server)};import{StdioServerTransport}from${JSON.stringify(transport)};import{ListToolsRequestSchema,CallToolRequestSchema}from${JSON.stringify(types)};import{appendFile}from'node:fs/promises';const s=new Server({name:'owned-text-vision-fixture',version:'1'},{capabilities:{tools:{}}});const leaves=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(leaves):v&&typeof v==='object'?Object.values(v).flatMap(leaves):[];s.setRequestHandler(ListToolsRequestSchema,async r=>{if(${Boolean(options.cursorCycle)})return{tools:[],nextCursor:r.params?.cursor==='a'?'b':'a'};if(${Boolean(options.paginated)}&&!r.params?.cursor)return{tools:[],nextCursor:'second'};return{tools:[{name:'describe_image',description:'echo '+process.env.VISION_TEST_TOKEN+' encoded '+encodeURIComponent(process.env.VISION_TEST_TOKEN||'')+' base64 '+Buffer.from(process.env.VISION_TEST_TOKEN||'').toString('base64'),inputSchema:${JSON.stringify(schema)}}]}});s.setRequestHandler(CallToolRequestSchema,async r=>{if(${Boolean(options.delayedMarker)}){await appendFile(${JSON.stringify(calls)},'');await new Promise(resolve=>setTimeout(resolve,100));}await appendFile(${JSON.stringify(calls)},'call\\n');if(${Boolean(options.hang)})return new Promise(()=>{});return{content:[{type:'text',text:'Observed PNG:'+leaves(r.params.arguments).includes(${JSON.stringify("data:image/png;base64," + png.toString("base64"))})+'; labels aligned. Secret echo:'+process.env.VISION_TEST_TOKEN}]}});await s.connect(new StdioServerTransport());`,
  );
  const service = new VisionBridgeService({
    dataDir: directory,
    vault: {
      available: () => true,
      encrypt: (s) => Buffer.from("encrypted:" + s),
      decrypt: (b) => b.toString().slice(10),
    },
  });
  await service.init();
  owned.push({ service, directory });
  const config = {
    ...defaultVisionConfig,
    transport: "stdio" as const,
    command: process.execPath,
    args: [script],
    toolName: "describe_image",
    secretName: "VISION_TEST_TOKEN",
    argumentsTemplate: { image: "$imageDataUrl", prompt: "$prompt" },
  };
  return { service, directory, config, calls };
}

describe("text-only vision bridge", () => {
  it("maps exact placeholders without evaluating strings, with recursion/key bounds", () => {
    expect(
      mapVisionArguments(
        { image: "$imagePath", prompt: "prefix $prompt" },
        { $imagePath: "actual.png" },
      ),
    ).toEqual({ image: "actual.png", prompt: "prefix $prompt" });
    expect(() => mapVisionArguments({ x: "$invented" }, {})).toThrow(
      "Unknown vision placeholder",
    );
    expect(() =>
      mapVisionArguments(JSON.parse('{"__proto__":{}}'), {}),
    ).toThrow("Unsafe");
    let deep: any = null;
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(() => mapVisionArguments(deep, {})).toThrow("too deep");
  });
  it("keeps TLS and rejects credential URLs, invalid commands/env names", () => {
    expect(() =>
      validateVisionConfig({
        ...defaultVisionConfig,
        url: "http://remote.example.test/mcp",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      validateVisionConfig({
        ...defaultVisionConfig,
        url: "https://u:p@example.test/mcp",
      }),
    ).toThrow("credentials");
    expect(() =>
      validateVisionConfig({
        ...defaultVisionConfig,
        secretName: "Invalid Header",
      }),
    ).toThrow("name");
    expect(() =>
      validateVisionConfig({ ...defaultVisionConfig, args: ["bad\0"] }),
    ).toThrow("arguments");
  });
  it("redacts literal bridge credentials even without a keyword", () => {
    expect(
      scrubVisionText(
        "echo: fixture-credential-value",
        "fixture-credential-value",
      ),
    ).not.toContain("fixture-credential-value");
    const secret = 'credential+/?="value';
    for (const variant of [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
    ])
      expect(scrubVisionText("echo " + variant, secret)).not.toContain(variant);
  });
  it("discovers the real schema without a model call and receives only text", async () => {
    const x = await bridge();
    await x.service.configure(x.config, "fixture-credential-value");
    const inventory = await x.service.probe();
    expect(inventory.paidRequest).toBe(false);
    expect(inventory.tools[0].name).toBe("describe_image");
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
    const input = {
      image: png,
      imagePath: path.join(x.directory, "screen.png"),
      prompt: "Check alignment",
    };
    const results = await Promise.all([
      x.service.review(input),
      x.service.review(input),
    ]);
    expect(results[0].description).toContain("Observed PNG:true");
    expect(results[0].description).not.toContain("fixture-credential-value");
    expect(results[0].trust).toContain("not native executor vision");
    expect(results[1].imageSha256).toBe(results[0].imageSha256);
    expect(await fs.readFile(x.calls, "utf8")).toBe("call\n");
    expect((await x.service.review(input)).cached).toBe(true);
    expect(await fs.readFile(x.calls, "utf8")).toBe("call\n");
    const raw = await fs.readFile(
      path.join(x.directory, "vision-bridge/state.json"),
      "utf8",
    );
    expect(raw).not.toContain("fixture-credential-value");
  }, 15000);
  it("does not call the bridge model for missing image mapping or mismatched schema", async () => {
    const x = await bridge();
    await x.service.configure({
      ...x.config,
      argumentsTemplate: { prompt: "$prompt" },
    });
    await expect(
      x.service.review({
        image: png,
        imagePath: "screen.png",
        prompt: "Check",
      }),
    ).rejects.toThrow("actual captured image");
    await x.service.configure({
      ...x.config,
      argumentsTemplate: { image: "$imageDataUrl", invalid: true },
    });
    await expect(
      x.service.review({
        image: png,
        imagePath: "screen.png",
        prompt: "Check",
      }),
    ).rejects.toThrow("schema");
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15000);
  it("rejects image placeholders used only as object keys even when the discovered schema allows them", async () => {
    const x = await bridge({ looseSchema: true });
    for (const placeholder of ["$imageDataUrl", "$imageBase64", "$imagePath"]) {
      await x.service.configure({
        ...x.config,
        argumentsTemplate: {
          image: "dummy image description",
          [placeholder]: "not an image argument value",
          prompt: "$prompt",
        },
      });
      await expect(
        x.service.review({
          image: png,
          imagePath: "screen.png",
          prompt: "Check",
        }),
      ).rejects.toThrow("actual captured image");
    }
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
    await x.service.configure({
      ...x.config,
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      argumentsTemplate: {
        image: "$imagePath",
        $imageDataUrl: "not image bytes",
        prompt: "$prompt",
      },
    });
    await expect(
      x.service.review({
        image: png,
        imagePath: "screen.png",
        prompt: "Check",
      }),
    ).rejects.toThrow("actual image bytes");
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("passes exact actual PNG bytes through nested object and array value mappings", async () => {
    const x = await bridge({ looseSchema: true });
    await x.service.configure({
      ...x.config,
      argumentsTemplate: {
        frames: [{ content: [{ image: "$imageDataUrl" }] }],
        prompt: "$prompt",
      },
    });
    const result = await x.service.review({
      image: png,
      imagePath: "screen.png",
      prompt: "Check nested mapping",
    });
    expect(result.description).toContain("Observed PNG:true");
    expect(await fs.readFile(x.calls, "utf8")).toBe("call\n");
  }, 15000);
  it("rejects oversized/non-image inputs and starts no client after disposal", async () => {
    const x = await bridge();
    await x.service.configure(x.config);
    await expect(
      x.service.review({
        image: Buffer.from("not PNG"),
        imagePath: "x",
        prompt: "check",
      }),
    ).rejects.toThrow("PNG");
    await x.service.dispose();
    await expect(x.service.probe()).rejects.toThrow("closing");
  });
  it("persists revision CAS, preserves a newer window's settings and clears old credentials on destination change", async () => {
    const x = await bridge();
    expect(x.service.snapshot().revision).toBe(0);
    await x.service.configure(x.config, "old-fixture-secret", false, 0);
    expect(x.service.snapshot()).toMatchObject({
      revision: 1,
      hasSecret: true,
    });
    await expect(
      x.service.configure(
        { ...x.config, modelLabel: "stale draft" },
        undefined,
        false,
        0,
      ),
    ).rejects.toThrow("another window");
    expect(x.service.snapshot().config.modelLabel).toBe("Qwen 3.6 Flash");
    await x.service.configure(
      { ...x.config, args: [...x.config.args, "other-destination"] },
      undefined,
      false,
      1,
    );
    expect(x.service.snapshot()).toMatchObject({
      revision: 2,
      hasSecret: false,
    });
    await x.service.configure(x.config, "fresh-fixture-secret", false, 2);
    expect(x.service.snapshot()).toMatchObject({
      revision: 3,
      hasSecret: true,
    });
  });
  it("finds the selected schema on later inventory pages and scrubs credentials from all inventory strings", async () => {
    const x = await bridge({ paginated: true }),
      secret = 'fixture+/?="credential';
    await x.service.configure(x.config, secret);
    const inventory = await x.service.probe();
    expect(inventory.tools).toHaveLength(1);
    for (const variant of [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString("base64"),
    ])
      expect(JSON.stringify(inventory)).not.toContain(variant);
    const observed = await x.service.review({
      image: png,
      imagePath: "screen.png",
      prompt: "Check",
    });
    expect(observed.description).toContain("Observed PNG:true");
    expect(await fs.readFile(x.calls, "utf8")).toBe("call\n");
  }, 15000);
  it("rejects non-adjacent cursor cycles without any image/model call", async () => {
    const x = await bridge({ cursorCycle: true });
    await x.service.configure(x.config);
    await expect(x.service.probe()).rejects.toThrow("cursor");
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15000);
  it("does not pretend that a remote MCP can read a local screenshot filename", async () => {
    const x = await bridge();
    await x.service.configure({
      ...x.config,
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      argumentsTemplate: { image: "$imagePath", prompt: "$prompt" },
    });
    await expect(
      x.service.review({
        image: png,
        imagePath: "screen.png",
        prompt: "Check",
      }),
    ).rejects.toThrow("actual image bytes");
    await expect(fs.stat(x.calls)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("aborts an in-flight owned MCP call during disposal without caching or replaying its late outcome", async () => {
    const x = await bridge({ hang: true, delayedMarker: true });
    await x.service.configure(x.config);
    const pending = x.service.review({
      image: png,
      imagePath: "screen.png",
      prompt: "Check",
    });
    // Observe rejection immediately, including an earlier assertion failure.
    // File creation alone precedes appendFile's completed marker write.
    const settled = pending.then(
      (value) => ({ resolved: true as const, value }),
      (error) => ({ resolved: false as const, error }),
    );
    try {
      await expect
        .poll(
          () =>
            fs.readFile(x.calls, "utf8").catch((error) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            }),
          { timeout: 5000, interval: 10 },
        )
        .toBe("call\n");
      await x.service.dispose();
      const outcome = await settled;
      expect(outcome.resolved).toBe(false);
      if (outcome.resolved)
        throw new Error("Disposed visual call unexpectedly resolved.");
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toMatch(/closing|interrupted|closed/);
      expect(await fs.readFile(x.calls, "utf8")).toBe("call\n");
      await expect(
        x.service.review({
          image: png,
          imagePath: "screen.png",
          prompt: "Check",
        }),
      ).rejects.toThrow("closing");
    } finally {
      try {
        await x.service.dispose();
      } finally {
        await settled;
      }
    }
  }, 15000);
});
