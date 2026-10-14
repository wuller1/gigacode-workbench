import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  qwenRouterEnvironment,
  routeWithQwen,
  type RoleRoutingInput,
} from "../electron/role-router";

afterEach(() => vi.unstubAllEnvs());
const input: RoleRoutingInput = {
  currentProfileId: "backend",
  project: { id: "p", name: "Test", directory: "project" },
  task: { id: "t", title: "Task", description: "Accepted goal" },
  request: "Implement the accepted server behavior",
  history: [],
  profiles: [{ id: "backend", name: "Backend", description: "Server work" }],
};

describe("Qwen classifier environment isolation", () => {
  it("blocks durable cron and inherited team-memory overrides without replacing auth, HOME or native settings", () => {
    const parent = {
      HOME: "/native-home",
      USERPROFILE: "C:\\native-home",
      OPENAI_API_KEY: "test-only-auth",
      QWEN_CODE_DISABLE_CRON: "0",
      QWEN_CODE_MEMORY_TEAM: "1",
      QWEN_CODE_MEMORY_TEAM_SYNC: "1",
      QWEN_SYSTEM_MD: "/external-system.md",
      GIGACODE_WRITE_SYSTEM_MD: "/external-write.md",
    };
    const before = structuredClone(parent);
    const child = qwenRouterEnvironment(parent);
    expect(child).toMatchObject({
      HOME: parent.HOME,
      USERPROFILE: parent.USERPROFILE,
      OPENAI_API_KEY: parent.OPENAI_API_KEY,
      QWEN_CODE_DISABLE_CRON: "1",
      QWEN_CODE_MEMORY_TEAM: "0",
      QWEN_CODE_MEMORY_TEAM_SYNC: "0",
    });
    expect(child.QWEN_SYSTEM_MD).toBeUndefined();
    expect(child.GIGACODE_WRITE_SYSTEM_MD).toBeUndefined();
    expect(parent).toEqual(before);
  });

  it("passes the gates to the actual spawned classifier and leaves inherited parent values intact", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "router-env-"));
    try {
      const executable = path.join(directory, "classifier.mjs");
      await fs.writeFile(
        executable,
        `
        let data = '';
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => {
          const facts = {
            cron: process.env.QWEN_CODE_DISABLE_CRON,
            team: process.env.QWEN_CODE_MEMORY_TEAM,
            sync: process.env.QWEN_CODE_MEMORY_TEAM_SYNC,
            customSystemAbsent: process.env.QWEN_SYSTEM_MD === undefined,
            safeMode: process.argv.includes('--safe-mode'),
            zeroToolBudget: process.argv[process.argv.indexOf('--max-tool-calls') + 1] === '0',
            receivedTask: JSON.parse(data).task.id === 't',
          };
          console.log(JSON.stringify({profileId:'backend',reason:JSON.stringify(facts),confidence:1}));
        });
      `,
      );
      vi.stubEnv("QWEN_CODE_DISABLE_CRON", "0");
      vi.stubEnv("QWEN_CODE_MEMORY_TEAM", "1");
      vi.stubEnv("QWEN_CODE_MEMORY_TEAM_SYNC", "1");
      vi.stubEnv("QWEN_SYSTEM_MD", "/must-not-forward.md");
      const result = await routeWithQwen(input, {
        executable,
        signal: AbortSignal.timeout(5000),
      });
      expect(JSON.parse(result.reason)).toEqual({
        cron: "1",
        team: "0",
        sync: "0",
        customSystemAbsent: true,
        safeMode: true,
        zeroToolBudget: true,
        receivedTask: true,
      });
      expect(process.env.QWEN_CODE_DISABLE_CRON).toBe("0");
      expect(process.env.QWEN_CODE_MEMORY_TEAM).toBe("1");
      expect(process.env.QWEN_CODE_MEMORY_TEAM_SYNC).toBe("1");
      expect(process.env.QWEN_SYSTEM_MD).toBe("/must-not-forward.md");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed UTF-8 role decisions rather than accepting substituted text", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "router-utf8-"));
    try {
      const executable = path.join(directory, "classifier.mjs");
      await fs.writeFile(
        executable,
        `
        process.stdin.resume();
        process.stdin.on('end',()=>process.stdout.end(Buffer.concat([
          Buffer.from('{"profileId":"backend","confidence":1,"reason":"'),
          Buffer.from([0xc3,0x28]),Buffer.from('"}')
        ])));
      `,
      );
      await expect(
        routeWithQwen(input, { executable, signal: AbortSignal.timeout(5000) }),
      ).rejects.toThrow(/UTF-8/i);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
