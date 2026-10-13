/** Reproducible local IDE setup. No global npm/JDK/default shell changes. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { installNodeRuntime } from '../../ide/tools/node-runtime.mjs';
const ide = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ide');
const offline = process.argv.includes('--offline');
const node = await installNodeRuntime(process.platform, process.arch, { offline });
const npm = path.resolve(path.dirname(node), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
const env = { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH, NODE_OPTIONS: '--max-old-space-size=6144' };
delete env.ELECTRON_RUN_AS_NODE;
if (offline) env.WORKBENCH_IDE_OFFLINE = '1';
async function run(args) {
  await new Promise((resolve, reject) => { const child=spawn(node,args,{cwd:ide,env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('IDE setup failed with code '+code))); });
}
if (process.argv.includes('--offline')) {
  await run([npm,'ci','--include=optional','--offline']);
} else await run([npm,'ci','--include=optional']);
await run([npm, 'run', 'test:dependencies']);
await run(['tools/install-plugins.mjs']);
await run(['tools/toolchains.mjs']);
await run([npm,'run','build']);
await fs.stat(path.join(ide,'lib/frontend/index.html'));
console.log('IDE installed: pinned Node + Theia + extensions + Java language-server JDK + Maven. Configure project JDK/Python in the IDE.');
