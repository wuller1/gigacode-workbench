/** Narrow, reversible compatibility patch for the pinned MIT Python extension. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PYTHON_VERSION = '2026.4.0';
export const PYTHON_VSIX_SHA256 = '232aeafb01f069824fdd92d3e628c1c442bbcfa1d3cc945ff97076340bb2b4a6';
export const PYTHON_BUNDLE_SHA256 = '9fa56140dc194262dadc0e55ffc5b974eb5e10a1cbd11d36f33c52ac164aa8ce';
export const PYTHON_SENDER_SHA256 = '33622f619cce6916e43d15285be06b17b32b3a21203212399f0a292b140cb16a';
const digest = text => createHash('sha256').update(text).digest('hex');
const marker = 'WORKBENCH_PYTHON_RESULT_DRAIN';
const pipeMarker = 'WORKBENCH_PYTHON_PIPE_DRAIN';
const replacements = [
    ['t.UnittestTestExecutionAdapter=class{',
        `const __workbenchPythonDrain=require("./workbench-result-drain.cjs");/* ${marker} */t.UnittestTestExecutionAdapter=class{`],
    ['const l=h.createTestingDeferred(),p=new a.CancellationTokenSource;r.token.onCancellationRequested(()=>p.cancel());',
        'const l=h.createTestingDeferred(),p=new a.CancellationTokenSource;const wbResultDrain=__workbenchPythonDrain.createResultDrain({closed:l.promise,expectedIds:t,isCancelled:()=>r.token.isCancellationRequested,cancelPipe:()=>p.cancel(),reportIncomplete:(error,ids)=>{const result={};for(const id of ids)result[id]={test:id,outcome:"error",message:error.message};this.resultResolver.resolveExecution({cwd:e.fsPath,status:"error",error:error.message,result},r)}});r.token.onCancellationRequested(()=>p.cancel());'],
    ['const d=await h.startRunResultNamedPipe(t=>{var n;',
        'const d=await h.startRunResultNamedPipe(t=>{if(wbResultDrain.observe(t))return;var n;'],
    ['finally{await l.promise}}async runTestsNew',
        'finally{await wbResultDrain.finish()}}async runTestsNew'],
    ['await m.launchDebugger(e,()=>{r.cancel()},t)',
        'await m.launchDebugger(e,()=>{},t)'],
    ['o.onExit((t,i)=>{0!==t&&(0,u.traceError)(`Subprocess exited unsuccessfully with exit code ${t} and signal ${i} on workspace ${e.fsPath}`),n.resolve(),r.cancel()})',
        'o.onExit((t,i)=>{0!==t&&(0,u.traceError)(`Subprocess exited unsuccessfully with exit code ${t} and signal ${i} on workspace ${e.fsPath}`),n.resolve()})'],
    ['C.on("exit",(n,o)=>{var s;0!==n&&t&&((0,u.traceError)(`Subprocess exited unsuccessfully with exit code ${n} and signal ${o} for workspace ${N.cwd}. Creating and sending error execution payload \\n`),i&&(null===(s=this.resultResolver)||void 0===s||s.resolveExecution(h.createExecutionErrorPayload(n,o,t,O),i))),e.resolve(),r.cancel()})',
        'C.on("exit",(n,o)=>{0!==n&&(0,u.traceError)(`Subprocess exited unsuccessfully with exit code ${n} and signal ${o} for workspace ${N.cwd}. Waiting for structured result pipe.`),e.resolve()})'],
];
const drainCall = ['},l,p.token);r.token.onCancellationRequested', '},l,p.token,!0);r.token.onCancellationRequested'];
const pipeReplacements = [
    ['t.startRunResultNamedPipe=async function(e,t,n){',
        `t.startRunResultNamedPipe=async function(e,t,n,wbDrain){/* ${pipeMarker} */`],
    ['i.onClose(()=>{(0,p.traceVerbose)(`Test Result named pipe ${r} closed. Disposing of listener/s.`),s.dispose()})',
        'i.onClose(()=>{(0,p.traceVerbose)(`Test Result named pipe ${r} closed. Disposing of listener/s.`),wbDrain?t.resolve():s.dispose()})'],
];
const senderBarrier = '\n    # WORKBENCH_PYTHON_RESULT_DRAIN: modified by Workbench. Same-stream final barrier\n'
    + '    # follows every test result and coverage payload; process exit is not EOF.\n'
    + '    send_post_request({"workbench_run_complete": 1}, test_run_pipe)\n';

export function preparePatchedPythonSender(source) {
    const upstream = source.endsWith(senderBarrier) ? source.slice(0, -senderBarrier.length) : source;
    if (digest(upstream) !== PYTHON_SENDER_SHA256)
        throw new Error('Unexpected Python test sender SHA256; reassess before patching');
    return { upstream, patched: upstream + senderBarrier };
}

function replaceOnce(text, from, to) {
    const at = text.indexOf(from);
    if (at < 0 || text.indexOf(from, at + from.length) >= 0)
        throw new Error('Unexpected pinned Python adapter source; reassess result-drain patch');
    return text.slice(0, at) + to + text.slice(at + from.length);
}
export function preparePatchedPythonBundle(source) {
    let upstream = source;
    const hadPipePatch = source.includes(pipeMarker);
    if (hadPipePatch) {
        for (const [original, patched] of [...pipeReplacements].reverse())
            upstream = replaceOnce(upstream, patched, original);
        upstream = replaceOnce(upstream, drainCall[1], drainCall[0]);
    }
    if (source.includes(marker)) {
        for (const [original, patched] of [...replacements].reverse())
            upstream = replaceOnce(upstream, patched, original);
    }
    if (digest(upstream) !== PYTHON_BUNDLE_SHA256)
        throw new Error('Unexpected Python extension bundle SHA256; reassess before patching');
    const start = upstream.indexOf('20179(e,t,n){');
    const end = upstream.indexOf('},88376(e,t,n){', start) + 1;
    if (start < 0 || end <= start) throw new Error('Pinned unittest adapter module not found');
    let adapter = upstream.slice(start, end);
    for (const [original, patched] of replacements) adapter = replaceOnce(adapter, original, patched);
    // Migrate only our earlier exact patch, never arbitrary modified bundles.
    const previousPatched = upstream.slice(0, start) + adapter + upstream.slice(end);
    adapter = replaceOnce(adapter, drainCall[0], drainCall[1]);
    let patched = upstream.slice(0, start) + adapter + upstream.slice(end);
    const pipeStart = patched.indexOf('50442(e,t,n){');
    const pipeEnd = patched.indexOf('},97245(e,t,n){', pipeStart) + 1;
    if (pipeStart < 0 || pipeEnd <= pipeStart) throw new Error('Pinned result pipe helper module not found');
    let pipeHelper = patched.slice(pipeStart, pipeEnd);
    for (const [original, changed] of pipeReplacements) pipeHelper = replaceOnce(pipeHelper, original, changed);
    patched = patched.slice(0, pipeStart) + pipeHelper + patched.slice(pipeEnd);
    if (source !== upstream && source !== patched && (!hadPipePatch && source !== previousPatched))
        throw new Error('Python adapter patch differs from its exact reversible form');
    if (hadPipePatch && source !== patched)
        throw new Error('Python result pipe patch differs from its exact reversible form');
    return { upstream, patched };
}

export async function patchPythonResults(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
    const directory = path.join(root, 'plugins/ms-python.python');
    const extension = path.join(directory, 'extension');
    const manifest = JSON.parse(await fs.readFile(path.join(extension, 'package.json'), 'utf8'));
    const sourceHash = (await fs.readFile(path.join(directory, '.workbench-source-sha256'), 'utf8')).trim();
    if (manifest.publisher !== 'ms-python' || manifest.name !== 'python' || manifest.version !== PYTHON_VERSION || sourceHash !== PYTHON_VSIX_SHA256)
        throw new Error('Reassess Python result-drain patch for this extension version/VSIX');
    const bundle = path.join(extension, 'out/client/extension.js');
    const source = await fs.readFile(bundle, 'utf8');
    const { patched } = preparePatchedPythonBundle(source);
    const senderPath = path.join(extension, 'python_files/unittestadapter/execution.py');
    const senderSource = await fs.readFile(senderPath, 'utf8');
    const sender = preparePatchedPythonSender(senderSource);
    const helper = await fs.readFile(new URL('./python-result-drain.cjs', import.meta.url));
    await fs.writeFile(path.join(extension, 'out/client/workbench-result-drain.cjs'), helper);
    if (source !== patched) {
        await fs.writeFile(bundle + '.workbench-partial', patched);
        await fs.rename(bundle + '.workbench-partial', bundle);
    }
    if (senderSource !== sender.patched) {
        await fs.writeFile(senderPath + '.workbench-partial', sender.patched);
        await fs.rename(senderPath + '.workbench-partial', senderPath);
    }
    const record = { patch: marker, extension: 'ms-python.python', version: PYTHON_VERSION,
        vsixSha256: PYTHON_VSIX_SHA256, upstreamBundleSha256: PYTHON_BUNDLE_SHA256,
        patchedBundleSha256: digest(patched), upstreamSenderSha256: PYTHON_SENDER_SHA256,
        patchedSenderSha256: digest(sender.patched), helperSha256: digest(helper),
        behavior: 'Unittest keeps queued JSONRPC callbacks alive after reader close, waits for final same-stream result barrier after process exit; 6s incomplete-result deadline; user cancellation remains immediate. Default pytest/discovery pipe behavior is unchanged.' };
    await fs.writeFile(path.join(directory, '.workbench-python-result-drain.json'), JSON.stringify(record, null, 2) + '\n');
    console.log('Pinned Python structured result drain verified: ' + PYTHON_VERSION);
    return record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await patchPythonResults();
