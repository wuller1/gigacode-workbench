import { readFile, writeFile, mkdir, cp, rename, rm, readdir, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { patchPythonResults } from './patch-python-results.mjs';
const require = createRequire(import.meta.url);
const yauzl = require('yauzl');
const semver = require('semver');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'plugins');
const cache = path.join(root, 'plugin-cache');
const platform = process.argv.find(value => value.startsWith('--platform='))?.slice(11) || `${process.platform}-${process.arch}`;
const update = process.argv.includes('--update-lock');
const cacheOnly = process.argv.includes('--cache-only');
const lockPath = path.join(root, 'plugins-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{"schemaVersion":1,"engine":"1.76.0","vscodeApi":"1.108.1","entries":[]}'));
const actualApi = require('@theia/application-package/lib/api').DEFAULT_SUPPORTED_API_VERSION;
if (update) lock.vscodeApi = actualApi;
else if (lock.vscodeApi !== actualApi) throw new Error('Pinned extension API does not match installed engine');
await mkdir(directory, { recursive: true });
await mkdir(cache, { recursive: true });
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function unpack(file, id, hash) {
    const destination = path.join(directory, id);
    const marker = await readFile(path.join(destination, '.workbench-source-sha256'), 'utf8').catch(() => '');
    if (marker.trim() === hash) return;
    const temporary = path.join(cache, `${id}.unpacked-${process.pid}`);
    await rm(temporary, { recursive: true, force: true }); await mkdir(temporary, { recursive: true });
    await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
        if (error) return reject(error);
        let expanded = 0, count = 0;
        zip.on('error', reject); zip.on('end', resolve);
        zip.on('entry', entry => { void (async () => {
            const name = entry.fileName.replaceAll('\\', '/');
            const parts = name.split('/');
            if (name.startsWith('/') || parts.includes('..') || name.includes(':') || name.length > 1024) throw new Error('Unsafe VSIX path');
            const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
            if ((mode & 0o170000) === 0o120000) throw new Error('VSIX symlinks are not accepted');
            expanded += entry.uncompressedSize; count++;
            if (count > 100_000 || expanded > 2_000_000_000 || entry.uncompressedSize > 500_000_000) throw new Error('VSIX extraction limit');
            const target = path.resolve(temporary, ...parts);
            const relative = path.relative(temporary, target);
            if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('VSIX path escapes target');
            if (name.endsWith('/')) { await mkdir(target, { recursive: true }); zip.readEntry(); return; }
            await mkdir(path.dirname(target), { recursive: true });
            const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (e, value) => e ? rejectStream(e) : resolveStream(value)));
            await pipeline(stream, createWriteStream(target, { flags: 'wx' }));
            if (process.platform !== 'win32' && mode) await chmod(target, mode & 0o777);
            zip.readEntry();
        })().catch(error => { zip.close(); reject(error); }); });
        zip.readEntry();
    }));
    await writeFile(path.join(temporary, '.workbench-source-sha256'), hash + '\n');
    await rm(destination, { recursive: true, force: true }); await rename(temporary, destination);
}
async function archiveMetadata(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            let manifest, licenseCount = 0;
            zip.on('error', reject);
            zip.on('entry', entry => {
                if (/(^|\/)licen[cs]e[^/]*$/i.test(entry.fileName)) licenseCount++;
                if (entry.fileName !== 'extension/package.json') { zip.readEntry(); return; }
                if (entry.uncompressedSize > 2_000_000) { zip.close(); reject(new Error('Oversized extension manifest')); return; }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) { reject(streamError); return; }
                    const chunks = []; let count = 0;
                    stream.on('data', chunk => { count += chunk.length; if (count > 2_000_000) stream.destroy(new Error('Oversized manifest')); else chunks.push(chunk); });
                    stream.on('error', reject);
                    stream.on('end', () => { try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')); zip.readEntry(); } catch (e) { reject(e); } });
                });
            });
            zip.on('end', () => manifest ? resolve({ manifest, licenseFiles: licenseCount }) : reject(new Error('Missing VSIX manifest')));
            zip.readEntry();
        });
    });
}
async function install(spec) {
    const key = `${spec.id}@${spec.version}:${spec.platform || 'universal'}`;
    let pinned = lock.entries.find(entry => entry.key === key);
    if (!pinned && !update) throw new Error(`Unpinned extension ${key}; run explicit --update-lock first`);
    const file = path.join(cache, `${spec.id}-${spec.version}${spec.platform && spec.platform !== 'universal' ? '@' + spec.platform : ''}.vsix`);
    let bytes = await readFile(file).catch(() => undefined);
    if (!bytes || (pinned && digest(bytes) !== pinned.sha256)) {
        if (process.env.WORKBENCH_IDE_OFFLINE === '1') throw new Error('VSIX missing from offline cache: ' + key);
        const response = await fetch(pinned?.url || spec.url, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok) throw new Error(`VSIX download ${key}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 200 * 1024 * 1024) throw new Error(`Oversized VSIX ${key}`);
        if (pinned && digest(bytes) !== pinned.sha256) throw new Error(`VSIX SHA mismatch ${key}`);
        await writeFile(file + '.partial', bytes); await rename(file + '.partial', file);
    }
    const { manifest, licenseFiles } = await archiveMetadata(file);
    const staticResourcesOnly = !manifest.main && !manifest.browser;
    const publishedBuiltin = String(spec.source || pinned?.source || "").startsWith("eclipse-theia/vscode-builtin-extensions/1.108.2")
        && semver.valid(manifest.engines?.vscode) && semver.lt(manifest.engines.vscode, "1.0.0");
    if (!staticResourcesOnly && !publishedBuiltin && manifest.engines?.vscode && !semver.satisfies(lock.vscodeApi, manifest.engines.vscode, { includePrerelease: true })) {
        throw new Error(`Extension ${key} requires VS Code ${manifest.engines.vscode}, host API ${lock.vscodeApi}`);
    }
    if (!pinned) {
        pinned = { key, id: spec.id, version: spec.version, platform: spec.platform || 'universal', url: spec.url,
            source: spec.source, sha256: digest(bytes), bytes: bytes.length, license: manifest.license || spec.license || null,
            licenseFiles, engines: manifest.engines, dependencies: manifest.extensionDependencies || [],
            manifestVersion: manifest.version, staticResourcesOnly, compatibilityBasis: publishedBuiltin ? "Theia-published pinned built-in with legacy minimum engine field; live verification still required" : "declared API range; live verification still required",
            extensionPackNotAutomaticallyInstalled: manifest.extensionPack || [] };
        lock.entries.push(pinned);
        await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    }
    console.log(`Verified ${key}`);
    if (!cacheOnly) {
        await unpack(file, spec.id, pinned.sha256);
        // unpack's source marker can skip an already cached directory. Verify
        // the exact reversible runtime patch on every install, including that case.
        if (spec.id === 'ms-python.python') await patchPythonResults(root);
    }
}
// Clear deployment artifacts for a different target, preserving the content-addressed download cache.
if (!cacheOnly) for (const file of await readdir(directory)) if (file.endsWith('.vsix')) await rm(path.join(directory, file));
if (!update) {
    const selected = lock.entries.filter(entry => entry.platform === 'universal' || entry.platform === platform);
    if (!selected.length) throw new Error('No pinned plugins for target ' + platform);
    for (let offset = 0; offset < selected.length; offset += 4) await Promise.all(selected.slice(offset, offset + 4).map(install));
    if (!cacheOnly) {
        await rm(path.join(directory, 'workbench-theme'), { recursive: true, force: true });
        await cp(path.join(root, 'theme'), path.join(directory, 'workbench-theme'), { recursive: true });
    }
    console.log(`Frozen IDE plugins prepared for ${platform}`);
    process.exit(0);
}
const builtinNames = ['bat', 'clojure', 'coffeescript', 'configuration-editing', 'cpp', 'csharp', 'css', 'css-language-features',
    'debug-auto-launch', 'debug-server-ready', 'docker', 'emmet', 'git', 'git-base', 'groovy', 'html', 'html-language-features',
    'ini', 'ipynb', 'java', 'javascript', 'json', 'json-language-features', 'log', 'lua', 'make', 'markdown',
    'markdown-language-features', 'merge-conflict', 'npm', 'perl', 'php', 'powershell', 'python', 'r', 'references-view',
    'ruby', 'rust', 'search-result', 'shellscript', 'sql', 'typescript', 'typescript-language-features', 'xml', 'yaml', 'builtin-notebook-renderers',
    'markdown-math', 'diff', 'less', 'scss', 'media-preview', 'theme-monokai'];
const builtinRelease = '1.108.2';
const release = await (await fetch(`https://api.github.com/repos/eclipse-theia/vscode-builtin-extensions/releases/tags/${builtinRelease}`)).json();
if (!release.assets) throw new Error('Missing pinned built-in release');
const builtinSpecs = builtinNames.map(name => {
    const id = 'vscode.' + name, asset = release.assets.find(asset => asset.name === id + '.vsix');
    if (!asset) throw new Error('Missing pinned built-in asset: ' + id);
    return { id, version: builtinRelease, url: asset.browser_download_url, source: `eclipse-theia/vscode-builtin-extensions/${builtinRelease}`, license: 'MIT' };
});
for (const id of ['ms-vscode.js-debug', 'ms-vscode.js-debug-companion', 'ms-vscode.vscode-js-profile-table']) {
    const asset = release.assets.find(value => value.name === id + '.vsix');
    if (!asset) throw new Error('Missing built-in debugger: ' + id);
    builtinSpecs.push({ id, version: builtinRelease, url: asset.browser_download_url,
        source: `eclipse-theia/vscode-builtin-extensions/${builtinRelease}`, license: 'MIT' });
}
const desired = [
    ['redhat', 'java', '1.56.0'], ['VMware', 'vscode-spring-boot', '2.4.0'],
    ['vscjava', 'vscode-maven', '0.45.3'], ['vscjava', 'vscode-gradle', '3.18.0'],
    ['vscjava', 'vscode-java-debug', '0.59.0'], ['vscjava', 'vscode-java-test', '0.46.0'],
    ['ms-python', 'python', '2026.4.0'], ['ms-pyright', 'pyright', '1.1.402'],
    ['ms-python', 'debugpy', '2026.6.0', true], ['charliermarsh', 'ruff', '2026.86.0', true],
    ['dbaeumer', 'vscode-eslint', '3.0.34'], ['esbenp', 'prettier-vscode', '12.4.0'],
    ['vitest', 'explorer', '1.52.2'], ['ms-toolsai', 'jupyter', '2025.9.1'],
];
const specs = [...builtinSpecs];
for (const [namespace, name, version, native] of desired) {
    const target = native ? platform : undefined;
    const endpoint = `https://open-vsx.org/api/${namespace}/${name}/${target ? target + '/' : ''}${version}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Extension metadata HTTP ${response.status}: ${endpoint}`);
    const metadata = await response.json();
    if (target && metadata.targetPlatform !== target) throw new Error(`Wrong target platform for ${namespace}.${name}`);
    specs.push({ id: namespace + '.' + name, version, platform: target, url: metadata.files.download,
        source: endpoint, license: metadata.license });
}
// Small bounded concurrency; never recursively install extension packs with different licenses.
for (let offset = 0; offset < specs.length; offset += 4) {
    await Promise.all(specs.slice(offset, offset + 4).map(install));
}
if (!cacheOnly) {
    await rm(path.join(directory, 'workbench-theme'), { recursive: true, force: true });
    await cp(path.join(root, 'theme'), path.join(directory, 'workbench-theme'), { recursive: true });
}
lock.entries.sort((a, b) => a.key.localeCompare(b.key));
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(`IDE extensions verified for ${platform}; extension packs are explicit, never implicit.`);
