import { readFile, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function installNodeRuntime(platform = process.platform, arch = process.arch, { offline = false } = {}) {
    const lock = JSON.parse(await readFile(path.join(root, 'node-runtime-lock.json'), 'utf8'));
    const tag = platform === 'win32' ? `win-${arch}` : `${platform}-${arch}`;
    const archiveName = `node-${lock.version}-${tag}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
    const expected = lock.sha256[archiveName];
    if (!expected) throw new Error(`Unsupported IDE runtime: ${tag}`);
    const directory = path.resolve(root, '../app/runtime/ide-node');
    const expanded = path.join(directory, archiveName.replace(/\.(zip|tar\.gz)$/, ''));
    const executable = path.join(expanded, platform === 'win32' ? 'node.exe' : 'bin/node');
    await mkdir(directory, { recursive: true });
    const archive = path.join(directory, archiveName);
    let bytes;
    try { bytes = await readFile(archive); } catch { /* Download the pinned official artifact. */ }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
        if (offline) throw new Error('Pinned Node archive is missing from the offline cache');
        const response = await fetch(lock.source + archiveName, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node SHA-256 mismatch');
        await writeFile(archive + '.partial', bytes);
        const { rename } = await import('node:fs/promises');
        await rename(archive + '.partial', archive);
    }
    if (!(await stat(executable).catch(() => undefined))?.isFile()) {
        await rm(expanded, { recursive: true, force: true });
        await new Promise((resolve, reject) => {
            const child = spawn('tar', ['-xf', archive, '-C', directory], { stdio: 'inherit', windowsHide: true });
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Node extraction failed (${code})`)));
        });
    }
    return executable;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(await installNodeRuntime());
}
