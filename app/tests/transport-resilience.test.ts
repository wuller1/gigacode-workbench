import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AcpConnection } from "../electron/acp";

const directories: string[] = [];
const connections: AcpConnection[] = [];
const descendantPids: number[] = [];
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.dispose();
  for (const pid of descendantPids.splice(0))
    if (alive(pid)) process.kill(pid, "SIGKILL");
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "acp-fault-"));
  directories.push(directory);
  const executable = path.join(directory, "fault-cli.mjs");
  await fs.writeFile(
    executable,
    `
    import readline from 'node:readline';
    import {spawn} from 'node:child_process';
    import {writeFileSync} from 'node:fs';
    const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
    readline.createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);
      if(m.method==='initialize')reply(m.id,{protocolVersion:1});
      if(m.method==='session/new')reply(m.id,{sessionId:'owned'});
      if(m.method==='session/prompt'){
        const command=m.params.prompt[0].text;
        if(command==='bad-utf8') process.stdout.write(Buffer.concat([
          Buffer.from('{"jsonrpc":"2.0","id":'+m.id+',"result":{"stopReason":"end_turn","note":"'),
          Buffer.from([0xc3,0x28]),Buffer.from('"}}\\n')]));
        if(command==='split-unicode'){
          const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn',note:'猫🙂'}})+'\\n');
          const cut=b.indexOf(Buffer.from('猫'))+1;
          process.stdout.write(b.subarray(0,cut));setTimeout(()=>process.stdout.write(b.subarray(cut)),15);
        }
        if(command==='truncated') process.stdout.end('{"jsonrpc":"2.0","id":'+m.id+',"result":',()=>process.exit(0));
        if(command==='truncated-utf8') process.stdout.end(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":'+m.id+',"result":"'),Buffer.from([0xe2])]),()=>process.exit(0));
        if(command==='oversized') process.stdout.write('x'.repeat(8*1024*1024+1));
        if(command==='exit-after-response') process.stdout.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn',note:'FINAL_RESPONSE'}})+'\\n',()=>process.exit(0));
        if(command==='stderr-split'){
          process.stderr.write('api_ke');
          setTimeout(()=>{process.stderr.write('y=TOP_SECRET_SENTINEL\\n');reply(m.id,{stopReason:'end_turn'});},15);
        }
        if(command==='owned-descendant'){
          const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
          writeFileSync('descendant.pid',String(descendant.pid));
        }
      }
    });
  `,
  );
  const diagnostics: string[] = [];
  const connection = new AcpConnection({
    executable,
    args: [],
    cwd: directory,
    onDiagnostic: (text) => diagnostics.push(text),
  });
  connections.push(connection);
  await connection.start();
  const session = await connection.newSession({
    cwd: directory,
    mcpServers: [],
  });
  return { directory, connection, session, diagnostics };
}

describe("ACP failure boundaries with real subprocesses", () => {
  it("rejects invalid UTF-8 inside otherwise valid JSON instead of silently changing content", async () => {
    const x = await fixture();
    await expect(
      x.connection.prompt(x.session.sessionId, "bad-utf8"),
    ).rejects.toMatchObject({
      ambiguous: true,
      message: expect.stringMatching(/UTF-8/i),
    });
    expect(x.connection.alive).toBe(false);
  });
  it("retains valid multibyte content split across pipe chunks", async () => {
    const x = await fixture();
    expect(
      await x.connection.prompt(x.session.sessionId, "split-unicode"),
    ).toEqual({ stopReason: "end_turn", note: "猫🙂" });
  });
  it("classifies incomplete EOF as a truncated frame with unknown prompt outcome", async () => {
    const x = await fixture();
    await expect(
      x.connection.prompt(x.session.sessionId, "truncated"),
    ).rejects.toMatchObject({
      ambiguous: true,
      message: expect.stringMatching(/incomplete|truncated/i),
    });
  });
  it("rejects an incomplete UTF-8 sequence at EOF as an unknown prompt outcome", async () => {
    const x = await fixture();
    await expect(
      x.connection.prompt(x.session.sessionId, "truncated-utf8"),
    ).rejects.toMatchObject({
      ambiguous: true,
      message: expect.stringMatching(/incomplete.*UTF-8/i),
    });
  });
  it("bounds an unterminated incoming frame and does not accept it as a result", async () => {
    const x = await fixture();
    await expect(
      x.connection.prompt(x.session.sessionId, "oversized"),
    ).rejects.toMatchObject({
      ambiguous: true,
      message: expect.stringContaining("8 MiB"),
    });
  });
  it("accepts the final complete response before normal process close", async () => {
    const x = await fixture();
    expect(
      await x.connection.prompt(x.session.sessionId, "exit-after-response"),
    ).toEqual({ stopReason: "end_turn", note: "FINAL_RESPONSE" });
  });
  it("redacts a credential whose key and value arrive in separate stderr chunks before publishing diagnostics", async () => {
    const x = await fixture();
    await x.connection.prompt(x.session.sessionId, "stderr-split");
    expect(x.diagnostics.join("\n")).not.toContain("TOP_SECRET_SENTINEL");
    expect(x.diagnostics.join("\n")).toContain("[redacted]");
  });
  it.skipIf(process.platform === "win32")(
    "terminates an owned POSIX descendant that ignores graceful cancellation",
    async () => {
      const x = await fixture();
      const pending = x.connection
        .prompt(x.session.sessionId, "owned-descendant")
        .catch((error) => error);
      const started = Date.now();
      let pid: number | undefined;
      while (!pid) {
        try {
          pid = Number(
            await fs.readFile(path.join(x.directory, "descendant.pid"), "utf8"),
          );
        } catch {
          if (Date.now() - started > 3000)
            throw new Error("No actual descendant PID");
        }
        if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      descendantPids.push(pid);
      expect(alive(pid)).toBe(true);
      // Let the child's signal handler become active before shutdown.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await x.connection.dispose();
      await pending;
      const deadline = Date.now() + 2000;
      while (alive(pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(alive(pid)).toBe(false);
    },
  );
});
