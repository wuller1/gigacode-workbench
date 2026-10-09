#!/usr/bin/env node
/** Import an already distributable runtime. Never installs dependencies or executes input. */
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1024 ** 3;
const MAX_ENTRIES = 100_000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'runtime');
const usage = 'node tools/bundle-cli.mjs --source ABS_SELF_CONTAINED_RUNTIME_DIR --entry relative.js|exe [--replace]';
const inside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const exists = async p => fs.lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
const fail = message => { throw new Error(message); };
function options(args) {
  const result = { source: '', entry: '', replace: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (seen.has(flag)) fail(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--replace') { result.replace = true; continue; }
    if (!['--source', '--entry'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) fail(`Invalid arguments. ${usage}`);
    result[flag.slice(2)] = args[++i];
  }
  if (!result.source || !result.entry) fail(`Both --source and --entry are required. ${usage}`);
  return result;
}
function entryPath(value) {
  if (value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes(':')) fail('Entry must be a relative path inside the source directory.');
  const parts = value.split(/[\\/]/);
  if (parts.some(p => !p || p === '.' || p === '..')) fail('Entry contains an empty, dot or parent path component.');
  if (!/\.(?:[cm]?js|exe)$/i.test(parts.at(-1))) fail('Entry must be a .js, .mjs, .cjs or .exe file.');
  return { relative: path.join(...parts), portable: parts.join('/') };
}
function prohibited(relative, directory) {
  const name = path.basename(relative).toLowerCase();
  if (directory && ['.git', '.qwen', '.gigacode', '.ssh', '.aws', '.azure', '.gcloud', 'sessions', 'session-data', 'user-data', 'userdata'].includes(name)) return true;
  if (/^\.env(?:\..*)?$/.test(name) || ['.envrc', '.npmrc', '.netrc', '_netrc', '.pypirc'].includes(name)) return true;
  if (/^(?:auth|authentication|credentials?|oauth(?:_creds|[-_]tokens?)?|access[-_]?tokens?|refresh[-_]?tokens?|tokens?|secrets?|cookies|storagestate|session(?:s)?|chat[-_]?history|conversation[-_]?history)(?:\.(?:jsonl?|ya?ml|toml|ini|conf|cfg|db|sqlite3?|txt))?$/.test(name)) return true;
  if (['application_default_credentials.json', 'authorized_keys', 'known_hosts', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'].includes(name)) return true;
  return !directory && /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(name);
}
async function inventory(source) {
  const files = [], directories = [];
  let total = 0, count = 0;
  async function walk(relative = '') {
    const parent = path.join(source, relative);
    const parentStat = await fs.lstat(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || !inside(source, await fs.realpath(parent))) fail(`Unsafe source directory: ${relative || '.'}`);
    for (const name of (await fs.readdir(parent)).sort()) {
      const rel = path.join(relative, name), full = path.join(source, rel);
      if (++count > MAX_ENTRIES) fail(`Source exceeds ${MAX_ENTRIES} filesystem entries.`);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) fail(`Symbolic links and junctions are not allowed: ${rel}`);
      if (!stat.isFile() && !stat.isDirectory()) fail(`Special files are not allowed: ${rel}`);
      if (prohibited(rel, stat.isDirectory())) fail(`Credential/configuration/session file or directory is not allowed: ${rel}. Prepare a clean distributable directory; nothing was imported.`);
      if (!inside(source, await fs.realpath(full))) fail(`Path escapes source: ${rel}`);
      if (stat.isDirectory()) { directories.push(rel); await walk(rel); }
      else {
        total += stat.size;
        if (!Number.isSafeInteger(total) || total > MAX_BYTES) fail('Source exceeds the 1 GiB total regular-file limit.');
        files.push({ relative: rel, stat });
      }
    }
  }
  await walk();
  return { files, directories, total };
}
async function inspectTarget(replace) {
  if (!await exists(target)) return undefined;
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('The runtime destination must be a regular directory, not a link.');
  const names = await fs.readdir(target);
  for (const name of names) {
    if (!['README.md', 'package', 'runtime.json'].includes(name)) fail(`Unexpected destination content: runtime/${name}. Refusing to replace it.`);
    if ((await fs.lstat(path.join(target, name))).isSymbolicLink()) fail(`Linked destination content is not allowed: ${name}`);
  }
  if (names.some(name => name === 'runtime.json' || name === 'package') && !replace) fail('A runtime already exists. Use --replace explicitly to replace it.');
  if (names.includes('README.md')) {
    const readme = path.join(target, 'README.md');
    const readmeStat = await fs.stat(readme);
    if (!readmeStat.isFile() || readmeStat.size > 1024 * 1024) fail('Unexpected runtime README.');
    return fs.readFile(readme);
  }
  return undefined;
}
async function importRuntime(options) {
  if (!path.isAbsolute(options.source)) fail('--source must be an absolute directory path.');
  const sourceStat = await fs.lstat(options.source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) fail('Source must be a directory, not a symbolic link.');
  const source = await fs.realpath(options.source);
  const destination = path.join(await fs.realpath(root), 'runtime');
  if (inside(source, destination) || inside(destination, source)) fail('Source and runtime destination must not contain one another.');
  const entry = entryPath(options.entry);
  const lock = path.join(root, '.bundle-cli.lock');
  try { await fs.mkdir(lock); } catch (e) { if (e.code === 'EEXIST') fail('Another import holds .bundle-cli.lock. Do not run imports concurrently.'); throw e; }
  const stage = path.join(root, `.runtime-stage-${randomUUID()}`), backup = path.join(root, `.runtime-backup-${randomUUID()}`);
  let movedOld = false, installed = false;
  try {
    const readme = await inspectTarget(options.replace);
    const content = await inventory(source);
    if (!content.files.some(f => f.relative === entry.relative)) fail('Entry is not a regular file in the source directory.');
    await fs.mkdir(path.join(stage, 'package'), { recursive: true });
    if (readme) await fs.writeFile(path.join(stage, 'README.md'), readme, { flag: 'wx' });
    for (const directory of content.directories) await fs.mkdir(path.join(stage, 'package', directory), { recursive: true });
    let copiedBytes = 0, sha256;
    for (const file of content.files) {
      const from = path.join(source, file.relative), to = path.join(stage, 'package', file.relative);
      if (!inside(source, await fs.realpath(from))) fail(`Source changed outside its root: ${file.relative}`);
      const input = await fs.open(from, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let output;
      try {
        const before = await input.stat();
        if (!before.isFile() || before.ino !== file.stat.ino || before.dev !== file.stat.dev || before.size !== file.stat.size || before.mtimeMs !== file.stat.mtimeMs) fail(`Source changed during import: ${file.relative}`);
        output = await fs.open(to, 'wx', 0o600);
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
        let fileBytes = 0;
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          copiedBytes += bytesRead; fileBytes += bytesRead;
          if (copiedBytes > MAX_BYTES) fail('Source grew beyond the 1 GiB limit during import.');
          hash.update(buffer.subarray(0, bytesRead));
          let offset = 0;
          while (offset < bytesRead) { const result = await output.write(buffer, offset, bytesRead - offset, null); if (!result.bytesWritten) fail('Unable to finish writing runtime file.'); offset += result.bytesWritten; }
        }
        const after = await input.stat();
        if (fileBytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail(`Source changed while copying: ${file.relative}`);
        await output.sync();
        await output.chmod(before.mode & 0o777);
        if (file.relative === entry.relative) sha256 = hash.digest('hex');
      } finally { await input.close(); if (output) await output.close(); }
    }
    const manifest = { entry: `package/${entry.portable}`, label: 'GigaCode CLI', sha256 };
    await fs.writeFile(path.join(stage, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    // Do not silently replace a runtime created by another actor after validation.
    await inspectTarget(options.replace);
    if (await exists(target)) { await fs.rename(target, backup); movedOld = true; }
    try { await fs.rename(stage, target); installed = true; }
    catch (e) { if (movedOld) { await fs.rename(backup, target); movedOld = false; } throw e; }
    if (movedOld) { await fs.rm(backup, { recursive: true }); movedOld = false; }
    return { imported: true, entry: manifest.entry, sha256, files: content.files.length, bytes: copiedBytes, replaced: options.replace };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    // Keep a backup if an exceptional filesystem error prevented rollback; never erase it blindly.
    if (movedOld && !installed) process.stderr.write(`Previous runtime retained at ${backup}\n`);
    await fs.rm(lock, { recursive: true, force: true });
  }
}
try {
  const parsed = options(process.argv.slice(2));
  if (parsed.help) console.log(usage);
  else console.log(JSON.stringify(await importRuntime(parsed), null, 2));
} catch (error) {
  console.error(`CLI import failed: ${error.message}`);
  process.exitCode = 1;
}
