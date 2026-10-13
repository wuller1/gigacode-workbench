/** Exercise the actual Theia archive path and patched dependency, without model/network access. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const decompress = require('decompress');
const braces = require('braces');

function tar(name, { data = '', type = '0', link = '' } = {}) {
    const content = Buffer.from(data);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156); header.write(link, 157, 100);
    header.write('ustar\0', 257); header.write('00', 263);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)]);
}
async function fixture(run) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-dependencies-'));
    try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('Theia resolves maintained extraction through the callable CommonJS adapter', () => {
    const caller = createRequire(require.resolve('@theia/plugin-ext-vscode/lib/node/plugin-vscode-utils'));
    assert.equal(caller.resolve('decompress'), require.resolve('decompress'));
    assert.equal(require('decompress/package.json').name, '@gigacode-workbench/decompress-compat');
    assert.equal(typeof decompress, 'function');
});
test('Theia VSIX identity and deploy use the real extractor', async () => fixture(async root => {
    const input = fileURLToPath(new URL('../fixtures/archive/extension.vsix', import.meta.url));
    const api = require('@theia/plugin-ext-vscode/lib/node/plugin-vscode-utils');
    assert.deepEqual(await api.extractExtensionIdentityFromVsix(input), { publisher: 'workbench', name: 'extraction-fixture', version: '1.0.0' });
    const output = path.join(root, 'extension');
    assert.equal(await api.decompressExtension(input, output), true);
    assert.equal(await fs.readFile(path.join(output, 'extension', 'README.txt'), 'utf8'), 'Owned extraction fixture.\n');
}));
for (const type of ['1', '2']) test('archive rejects escaping ' + (type === '1' ? 'hardlink' : 'symlink'), async () => fixture(async root => {
    await fs.writeFile(path.join(root, 'outside.txt'), 'unchanged');
    await assert.rejects(decompress(tar('link', { type, link: '../outside.txt' }), path.join(root, 'out')), /outside|escap|link|unsafe/i);
    assert.equal(await fs.readFile(path.join(root, 'outside.txt'), 'utf8'), 'unchanged');
    await assert.rejects(fs.lstat(path.join(root, 'out', 'link')), { code: 'ENOENT' });
}));
test('archive traversal cannot write to a sibling directory sharing the output prefix', async () => fixture(async root => {
    const sibling = path.join(root, 'out-other'); await fs.mkdir(sibling);
    await assert.rejects(decompress(tar('../out-other/injected.txt', { data: 'bad' }), path.join(root, 'out')), /outside|escap|unsafe/i);
    await assert.rejects(fs.stat(path.join(sibling, 'injected.txt')), { code: 'ENOENT' });
}));
test('braces normal nested globs and expansion remain functional', () => {
    assert.deepEqual(braces.expand('src/{java,{python,web}}/test'), ['src/java/test', 'src/python/test', 'src/web/test']);
    assert.equal(braces.compile('src/{a,b}/*.ts'), 'src/(a|b)/*.ts');
});
for (const operation of ['compile', 'expand', 'stringify']) test('braces ' + operation + ' rejects deep input with a controlled SyntaxError', () => {
    const input = '{'.repeat(3500) + 'a,b' + '}'.repeat(3500);
    assert.throws(() => operation === 'stringify' ? braces.stringify(braces.parse(input)) : braces[operation](input), error => error instanceof SyntaxError && /nesting/.test(error.message));
});
