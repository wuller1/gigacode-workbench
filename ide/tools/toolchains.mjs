import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(root, '../app/runtime/ide-tools');
const platform = process.argv.find(value => value.startsWith('--platform='))?.slice(11) || `${process.platform}-${process.arch}`;
const update = process.argv.includes('--update-lock');
const metadataOnly = process.argv.includes('--metadata-only');
const lockPath = path.join(root, 'toolchains-lock.json');
const lock = JSON.parse(await fs.readFile(lockPath, 'utf8').catch(() => '{"schemaVersion":1,"java":{},"maven":null}'));
if (!lock.java[platform] && !update) throw new Error('No pinned Java toolchain for ' + platform);
if (update && !lock.java[platform]) {
    const [system, arch] = platform.split('-');
    const operatingSystem = { darwin: 'mac', win32: 'windows', linux: 'linux' }[system];
    const architecture = { arm64: 'aarch64', x64: 'x64' }[arch];
    if (!operatingSystem || !architecture) throw new Error('Unsupported toolchain platform ' + platform);
    const source = `https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${architecture}&image_type=jdk&os=${operatingSystem}&vendor=eclipse`;
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Java metadata HTTP ' + response.status);
    const assets = await response.json(), asset = assets[0];
    if (!asset?.binary?.package?.checksum) throw new Error('No Java runtime available for ' + platform);
    lock.java[platform] = { version: asset.version.openjdk_version, url: asset.binary.package.link,
        name: asset.binary.package.name, sha256: asset.binary.package.checksum, source,
        license: 'GPL-2.0 WITH Classpath-exception-2.0; retain the distribution license files and third-party notices' };
}
if (update && !lock.maven) {
    const response = await fetch('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml');
    if (!response.ok) throw new Error('Maven metadata HTTP ' + response.status);
    const metadata = await response.text();
    const versions = [...metadata.matchAll(/<version>(3\.\d+\.\d+)<\/version>/g)].map(match => match[1]);
    const version = versions.at(-1); if (!version) throw new Error('Missing stable Maven 3 release');
    const name = `apache-maven-${version}-bin.tar.gz`;
    const url = `https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/${version}/${name}`;
    const checksumResponse = await fetch(url + '.sha512');
    if (!checksumResponse.ok) throw new Error('Maven checksum unavailable');
    const checksum = (await checksumResponse.text()).trim().split(/\s/)[0];
    if (!/^[a-f\d]{128}$/i.test(checksum)) throw new Error('Invalid Maven SHA-512');
    lock.maven = { version, url, name, sha512: checksum,
        source: 'https://maven.apache.org/', license: 'Apache-2.0; retain LICENSE and NOTICE from the archive' };
}
await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
if (metadataOnly) { console.log('Pinned Java/Maven metadata for ' + platform); process.exit(0); }
await fs.mkdir(path.join(directory, 'cache'), { recursive: true });
async function checksum(file, algorithm) {
    const hash = createHash(algorithm);
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
async function download(spec, algorithm, expected) {
    const file = path.join(directory, 'cache', spec.name);
    if (await checksum(file, algorithm).catch(() => '') === expected) return file;
    if (process.env.WORKBENCH_IDE_OFFLINE === '1') throw new Error('SDK missing from offline cache: ' + spec.name);
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error('Toolchain download HTTP ' + response.status);
    const hash = createHash(algorithm); let received = 0, last = 0;
    const progress = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length; hash.update(chunk);
        if (received > 600 * 1024 * 1024) { callback(new Error('Toolchain download limit exceeded')); return; }
        if (received - last > 25 * 1024 * 1024) { console.log(spec.name + ': ' + Math.round(received / 1024 / 1024) + ' MiB'); last = received; }
        callback(null, chunk);
    }});
    try {
        await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(file + '.partial'));
        if (hash.digest('hex') !== expected) throw new Error('Toolchain checksum mismatch: ' + spec.name);
        await fs.rename(file + '.partial', file); return file;
    } catch (error) { await fs.rm(file + '.partial', { force: true }); throw error; }
}
async function extract(archive, destination) {
    await fs.mkdir(destination, { recursive: true });
    await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xf', archive, '-C', destination], { stdio: 'inherit', windowsHide: true });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Toolchain extraction failed: ' + code)));
    });
}
const java = lock.java[platform], maven = lock.maven;
const javaDirectory = path.join(directory, 'java', platform);
const javaArchive = await download(java, 'sha256', java.sha256);
await extract(javaArchive, javaDirectory);
const candidates = (await fs.readdir(javaDirectory)).filter(name => name.startsWith('jdk'));
if (candidates.length !== 1) throw new Error('Ambiguous managed JDK directory');
const javaHome = path.join(javaDirectory, candidates[0], platform.startsWith('darwin-') ? 'Contents/Home' : '');
const mavenDirectory = path.join(directory, 'maven');
const mavenArchive = await download(maven, 'sha512', maven.sha512);
await extract(mavenArchive, mavenDirectory);
const mavenHome = path.join(mavenDirectory, `apache-maven-${maven.version}`);
const bindingsFile = path.join(directory, 'bindings.json');
const bindings = JSON.parse(await fs.readFile(bindingsFile, 'utf8').catch(() => '{}'));
bindings[platform] = { javaHome: path.relative(directory, javaHome), mavenHome: path.relative(directory, mavenHome),
    javaVersion: java.version, mavenVersion: maven.version };
await fs.writeFile(bindingsFile, JSON.stringify(bindings, null, 2) + '\n');
console.log(`Managed Java ${java.version} and Maven ${maven.version} verified for ${platform}; system defaults unchanged.`);
