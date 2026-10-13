/** Version/hash-checked backport for GHSA-vfj7-8cjw-p6xm; no upstream release fixes it yet. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = text => createHash('sha256').update(text).digest('hex');
const marker = 'WORKBENCH_BRACES_DEPTH_GUARD';
const originals = {
    compile: 'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f',
    expand: '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7',
    stringify: '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a'
};

export async function hardenIdeDependencies(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
    const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
    let checked = 0;
    for (const [relative, metadata] of Object.entries(lock.packages)) {
        if (!/(^|\/)node_modules\/braces$/.test(relative)) continue;
        if (metadata.version !== '3.0.3') throw new Error('Reassess braces hardening for ' + metadata.version);
        for (const name of Object.keys(originals)) {
            const file = path.join(root, relative, 'lib', name + '.js');
            const text = await fs.readFile(file, 'utf8');
            const signature = name === 'stringify' ? 'const stringify = (node, parent = {}) => {' : 'const walk = (node, parent = {}) => {';
            const guarded = signature.replace('parent = {}', 'parent = {}, depth = 0') +
                '\n    // ' + marker + ': reject deep ASTs before exhausting the process stack.\n' +
                '    if (depth > 128) throw new SyntaxError("Brace nesting exceeds the Workbench limit (128)");';
            const child = name === 'stringify' ? 'stringify(child)' : 'walk(child, node)';
            const guardedChild = name === 'stringify' ? 'stringify(child, undefined, depth + 1)' : 'walk(child, node, depth + 1)';
            // Validate either exact upstream bytes or the exact reversible patch, never a marker alone.
            const upstream = text.includes(marker) ? text.replace(guarded, signature).replace(guardedChild, child) : text;
            if (digest(upstream) !== originals[name]) throw new Error('Unexpected braces source; review before patching ' + file);
            const patched = upstream.replace(signature, guarded).replace(child, guardedChild);
            if (patched === upstream || !patched.includes(marker)) throw new Error('Braces guard did not apply: ' + file);
            if (text !== patched) await fs.writeFile(file, patched);
            checked++;
        }
    }
    if (!checked) throw new Error('No locked braces installation found; reassess the dependency guard');
    console.log('Braces recursion guards verified: ' + checked + ' files; npm audit still reports the upstream version.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await hardenIdeDependencies();
