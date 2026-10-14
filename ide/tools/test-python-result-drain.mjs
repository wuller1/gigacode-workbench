// SPDX-License-Identifier: Apache-2.0
// Execute the actual, hash-pinned upstream adapter with independently controlled
// process and pipe event queues. No Python stdout is treated as a test result.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { patchPythonResults, preparePatchedPythonBundle, preparePatchedPythonSender, PYTHON_VERSION,
    PYTHON_VSIX_SHA256, PYTHON_BUNDLE_SHA256, PYTHON_SENDER_SHA256 } from './patch-python-results.mjs';

const require = createRequire(import.meta.url);
const { createResultDrain } = require('./python-result-drain.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'plugins/ms-python.python/extension/out/client/extension.js'), 'utf8');
const { upstream, patched } = preparePatchedPythonBundle(source);
const senderPath = path.join(root, 'plugins/ms-python.python/extension/python_files/unittestadapter/execution.py');
const sender = preparePatchedPythonSender(await fs.readFile(senderPath, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
class CancellationTokenSource {
    constructor() {
        this.listeners = new Set();
        this.token = { isCancellationRequested: false,
            onCancellationRequested: listener => {
                this.listeners.add(listener);
                return { dispose: () => this.listeners.delete(listener) };
            } };
    }
    cancel() {
        if (this.token.isCancellationRequested) return;
        this.token.isCancellationRequested = true;
        for (const listener of [...this.listeners]) listener();
    }
    dispose() { this.listeners.clear(); }
}
function actualModule(bundle, id, nextId, modules, helper) {
    const start = bundle.indexOf(`${id}(e,t,n){`);
    const end = bundle.indexOf(`},${nextId}(e,t,n){`, start) + 1;
    assert.ok(start > 0 && end > start, 'actual pinned webpack module exists');
    const adapter = bundle.slice(start, end);
    const body = adapter.slice(adapter.indexOf('{') + 1, -1);
    const exported = {};
    new Function('e', 't', 'n', 'require', body)({}, exported, id => {
        assert.ok(Object.hasOwn(modules, id), `unexpected dependency ${id}`);
        return modules[id];
    }, id => {
        assert.equal(id, './workbench-result-drain.cjs');
        return helper;
    });
    return exported;
}
function fixture({ original = false, background = false, ids = ['suite.Case.test_fails'] } = {}) {
    const listenerReady = deferred(), timerReady = deferred();
    const parent = new CancellationTokenSource();
    const results = [], output = [], traces = [];
    let pipe, pipeCancellationCount = 0, ended = false, timer, timerClears = 0;
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
    const on = proc.on;
    proc.on = function(event, listener) {
        on.call(this, event, listener);
        if (event === 'exit') listenerReady.resolve();
        return this;
    };
    proc.kill = () => proc.emit('exit', null, 'SIGTERM');
    const run = { token: parent.token, appendOutput: text => output.push(text) };
    const helpers = {
        createTestingDeferred: deferred,
        async startRunResultNamedPipe(callback, closed, token, draining) {
            pipe = { active: true, callback, closed, draining };
            token.onCancellationRequested(() => {
                pipeCancellationCount++; pipe.active = false; closed.resolve();
            });
            return 'fixture-result-pipe';
        },
        writeTestIdsFile: async () => 'fixture-test-ids',
        fixLogLinesNoTrailing: text => text,
        createExecutionErrorPayload: (code, signal, requested, cwd) => ({ cwd, status: 'error',
            error: `${code}/${signal}`, result: Object.fromEntries(requested.map(id => [id,
                { test: id, outcome: 'error', message: 'upstream process-exit error' }])) }),
    };
    const modules = {
        16928: require('node:path'),
        54980: { CancellationTokenSource, TestRunProfileKind: { Debug: 2, Coverage: 3 } },
        7855: { createDeferred: deferred },
        84090: { EXTENSION_ROOT_DIR: '/fixture/extension' },
        61905: Object.fromEntries(['traceError', 'traceInfo', 'traceLog', 'traceVerbose'].map(name =>
            [name, (...args) => traces.push({ name, args })])),
        50442: helpers,
        77329: { UNITTEST_PROVIDER: 'unittest' },
        36380: { useEnvExtension: () => background,
            getEnvironment: async () => ({ name: 'fixture-python' }),
            runInBackground: async () => ({ stdout: proc.stdout, stderr: proc.stderr,
                onExit: listener => proc.on('exit', listener), kill: () => proc.kill() }) },
    };
    const helper = { createResultDrain: config => createResultDrain({ ...config,
        setTimer: (callback, ms) => { timer = { callback, ms }; timerReady.resolve(); return timer; },
        clearTimer: value => { if (value) { timerClears++; if (timer === value) timer = undefined; } } }) };
    const Adapter = actualModule(original ? upstream : patched, 20179, 88376, modules, helper).UnittestTestExecutionAdapter;
    const adapter = new Adapter({ getSettings: () => ({ testing: { unittestArgs: [], cwd: '' } }) },
        { resolveExecution: payload => {
            assert.equal(ended, false, 'structured result must be delivered before TestRun ends');
            results.push(payload);
        } }, { getEnvironmentVariables: async () => ({}) });
    const activator = { createActivatedEnvironment: async () => ({
        getExecutablePath: async () => 'python', execObservable: () => ({ proc }) }) };
    // Attach a rejection observer immediately; an expected incomplete-result
    // rejection cannot become an unhandled rejection while a test inspects it.
    const completion = adapter.runTests({ fsPath: '/fixture/project' }, ids, undefined, run, activator)
        .then(value => { ended = true; return { value }; }, error => { ended = true; return { error }; });
    return {
        results, output, traces, completion, ready: listenerReady.promise, timerReady: timerReady.promise,
        get ended() { return ended; }, get cancellations() { return pipeCancellationCount; },
        get timerClears() { return timerClears; },
        exit(code = 0) { proc.emit('exit', code, null); },
        stdout(text) { proc.stdout.emit('data', Buffer.from(text)); },
        deliver(payload) { if (pipe.active) pipe.callback(payload); },
        barrier() { if (pipe.active) pipe.callback({ workbench_run_complete: 1 }); },
        eof() { if (!pipe.draining) pipe.active = false; pipe.closed.resolve(); },
        cancel() { parent.cancel(); },
        deadline() { assert.equal(timer?.ms, 6000); timer.callback(); },
    };
}
function result(id, outcome = 'failure') {
    return { cwd: '/fixture/project', status: outcome,
        result: { [id]: { test: id, outcome, message: outcome === 'failure' ? '1 != 2' : '' } } };
}

test('negative control: actual upstream adapter cancels the pipe on process exit and loses the late result', async () => {
    const f = fixture({ original: true });
    await f.ready; f.exit(); await f.completion;
    assert.equal(f.cancellations, 1);
    f.deliver(result('suite.Case.test_fails')); f.barrier(); f.eof();
    assert.equal(f.results.length, 0);
});
for (const background of [false, true]) test(`actual ${background ? 'environment' : 'legacy'} adapter drains late FAIL after process exit`, async () => {
    const f = fixture({ background });
    await f.ready; f.exit(1); await f.timerReady;
    assert.equal(f.ended, false);
    assert.equal(f.cancellations, 0, 'exit must not dispose an active structured result pipe');
    f.deliver(result('suite.Case.test_fails')); f.barrier();
    assert.equal((await f.completion).error, undefined);
    assert.equal(f.results.length, 1);
    assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'failure');
    assert.equal(f.cancellations, 1, 'dispose only after the result stream drained');
    assert.equal(f.timerClears, 1);
});
test('protocol completion before exit preserves results but does not finish a running process', async () => {
    const f = fixture(); await f.ready;
    f.deliver(result('suite.Case.test_fails', 'success')); f.barrier();
    assert.equal(f.ended, false); f.exit();
    assert.equal((await f.completion).error, undefined);
    assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'success');
});
test('protocol completion with partial results fails explicitly and preserves completed test outcomes', async () => {
    const f = fixture({ ids: ['suite.Case.test_ok', 'suite.Case.test_missing'] }); await f.ready;
    f.deliver(result('suite.Case.test_ok', 'success')); f.exit(); f.barrier();
    const { error } = await f.completion;
    assert.match(error?.message, /^WORKBENCH_RESULT_PIPE_INCOMPLETE: 1 requested/);
    assert.equal(f.results[0].result['suite.Case.test_ok'].outcome, 'success');
    assert.deepEqual(Object.keys(f.results[1].result), ['suite.Case.test_missing']);
    assert.equal(f.results[1].result['suite.Case.test_missing'].outcome, 'error');
});
test('pipe that never closes has a bounded explicit error rather than a guessed result', async () => {
    const f = fixture(); await f.ready; f.exit(); await f.timerReady;
    assert.equal(f.ended, false); f.deadline();
    const { error } = await f.completion;
    assert.match(error?.message, /^WORKBENCH_RESULT_PIPE_INCOMPLETE:.*6000 ms/);
    assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'error');
    assert.equal(f.cancellations, 1); assert.equal(f.timerClears, 1);
});
test('user cancellation still closes the pipe immediately without incomplete-result errors', async () => {
    const f = fixture(); await f.ready; f.cancel();
    assert.equal((await f.completion).error, undefined);
    assert.equal(f.cancellations, 1); assert.equal(f.results.length, 0);
});
test('stdout FAIL text cannot substitute for missing structured results', async () => {
    const f = fixture(); await f.ready;
    f.stdout('FAIL: test_fails (suite.Case)\nAssertionError: 1 != 2\n');
    f.exit(1); await f.timerReady;
    assert.equal(f.results.length, 0, 'process exit must not fabricate all-test failures');
    f.barrier(); const { error } = await f.completion;
    assert.match(error?.message, /^WORKBENCH_RESULT_PIPE_INCOMPLETE:/);
    assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'error');
    assert.ok(f.output[0].includes('FAIL:'));
});
test('subtest structured result fulfills its requested parent ID', async () => {
    const f = fixture(); await f.ready;
    f.exit(); await f.timerReady;
    f.deliver({ result: { 'suite.Case.test_fails (value=1)': {
        test: 'suite.Case.test_fails', outcome: 'subtest-failure', message: '1 != 2' } } });
    f.barrier(); assert.equal((await f.completion).error, undefined);
});
test('normal close without the final protocol barrier waits until the bounded deadline', async () => {
    const f = fixture(); await f.ready;
    f.deliver(result('suite.Case.test_fails', 'success')); f.exit(); f.eof();
    await f.timerReady; assert.equal(f.ended, false); f.deadline();
    assert.match((await f.completion).error?.message, /completion barrier did not arrive within 6000 ms/);
});
test('normal close before queued decoder callbacks does not reject valid late results', async () => {
    const f = fixture(); await f.ready; f.exit(); await f.timerReady;
    f.eof(); await Promise.resolve(); assert.equal(f.ended, false);
    f.deliver(result('suite.Case.test_fails')); f.barrier();
    assert.equal((await f.completion).error, undefined);
    assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'failure');
});
test('coverage before the final marker is delivered, and marker itself is never given to result resolver', async () => {
    const f = fixture(); await f.ready; f.exit(); await f.timerReady;
    f.deliver(result('suite.Case.test_fails', 'success'));
    f.deliver({ coverage: true, result: { 'test.py': { lines_covered: [1] } } });
    f.barrier(); assert.equal((await f.completion).error, undefined);
    assert.equal(f.results.length, 2); assert.equal(f.results[1].coverage, true);
    assert.ok(f.results.every(payload => !('workbench_run_complete' in payload)));
});
test('pinned full bundle patch is reversible, idempotent and rejects drift', () => {
    assert.equal(digest(upstream), PYTHON_BUNDLE_SHA256);
    assert.equal(preparePatchedPythonBundle(patched).patched, patched);
    assert.equal(preparePatchedPythonBundle(patched).upstream, upstream);
    const previousPatch = patched.replace('},l,p.token,!0);r.token.onCancellationRequested', '},l,p.token);r.token.onCancellationRequested')
        .replace('t.startRunResultNamedPipe=async function(e,t,n,wbDrain){/* WORKBENCH_PYTHON_PIPE_DRAIN */', 't.startRunResultNamedPipe=async function(e,t,n){')
        .replace('wbDrain?t.resolve():s.dispose()', 's.dispose()');
    assert.equal(preparePatchedPythonBundle(previousPatch).patched, patched, 'migrate the exact cached previous patch');
    assert.throws(() => preparePatchedPythonBundle(upstream + '\n'), /SHA256/);
    assert.throws(() => preparePatchedPythonBundle(patched.replace('expectedIds:t', 'expectedIds:[]')), /source|SHA256/);
    assert.equal(digest(sender.upstream), PYTHON_SENDER_SHA256);
    assert.equal(preparePatchedPythonSender(sender.patched).patched, sender.patched);
    assert.throws(() => preparePatchedPythonSender(sender.patched + '\n'), /SHA256/);
});

function queuedReaderFixture(bundle) {
    const cancellation = new CancellationTokenSource(), closed = deferred(), timerReady = deferred();
    const queue = [], results = [];
    let timer, finished = false, disposed = false, callback = () => {}, closeListener = () => {};
    class Disposable {
        constructor(action) { this.action = action; }
        dispose() { const action = this.action; this.action = undefined; action?.(); }
    }
    const reader = { listen(listener) { callback = listener; return new Disposable(() => { callback = () => {}; }); },
        onClose(listener) { closeListener = listener; return new Disposable(() => { closeListener = () => {}; }); },
        onError() { return new Disposable(() => {}); }, dispose() { disposed = true; } };
    const modules = {
        16928: require('node:path'), 79896: require('node:fs'), 70857: require('node:os'),
        76982: require('node:crypto'), 54980: { Disposable }, 64230: {}, 7855: { createDeferred: deferred },
        73673: { generateRandomPipeName: () => 'fixture-pipe', createReaderPipe: async () => reader },
        84090: {}, 67217: {},
        61905: Object.fromEntries(['traceError', 'traceLog', 'traceVerbose'].map(name => [name, () => {}])),
    };
    const helper = actualModule(bundle, 50442, 97245, modules);
    const drain = createResultDrain({ closed: closed.promise, expectedIds: ['suite.Case.test_fails'],
        isCancelled: () => cancellation.token.isCancellationRequested, cancelPipe: () => cancellation.cancel(),
        reportIncomplete: error => results.push({ error: error.message }),
        setTimer: (fn, ms) => { assert.equal(ms, 6000); timer = fn; timerReady.resolve(); return fn; },
        clearTimer: () => {} });
    return { helper, cancellation, closed, results, drain, timerReady: timerReady.promise,
        async start(draining) {
            await helper.startRunResultNamedPipe(payload => {
                if (!drain.observe(payload)) results.push(payload);
            }, closed, cancellation.token, draining);
        },
        async discovery() { await helper.startDiscoveryNamedPipe(payload => results.push(payload), cancellation.token); },
        queue(payload) { queue.push(() => callback({ params: payload })); },
        close() { closeListener(); },
        flushDecoder() { for (const action of queue.splice(0)) action(); },
        finish() { return drain.finish().then(value => { finished = true; return { value }; }, error => { finished = true; return { error }; }); },
        deadline() { timer(); }, get finished() { return finished; }, get disposed() { return disposed; },
    };
}
test('negative control: actual upstream pipe disposes queued decoder callbacks on close', async () => {
    const f = queuedReaderFixture(upstream); await f.start(true);
    f.queue(result('suite.Case.test_fails')); f.queue({ workbench_run_complete: 1 });
    const completion = f.finish(); await f.timerReady;
    f.close(); f.flushDecoder(); assert.equal(f.disposed, true);
    f.deadline(); assert.match((await completion).error?.message, /WORKBENCH_RESULT_PIPE_INCOMPLETE/);
    assert.ok(!f.results.some(payload => payload.result));
});
test('actual patched pipe preserves queued decoder callbacks across close until marker drain', async () => {
    const f = queuedReaderFixture(patched); await f.start(true);
    f.queue(result('suite.Case.test_fails')); f.queue({ workbench_run_complete: 1 });
    const completion = f.finish(); await f.timerReady;
    f.close(); await Promise.resolve(); assert.equal(f.disposed, false); assert.equal(f.finished, false);
    f.flushDecoder(); assert.equal((await completion).error, undefined);
    assert.equal(f.results.length, 1); assert.equal(f.results[0].result['suite.Case.test_fails'].outcome, 'failure');
    assert.equal(f.disposed, true);
});
test('default run pipe and discovery still dispose immediately on close', async () => {
    for (const discovery of [false, true]) {
        const f = queuedReaderFixture(patched);
        if (discovery) await f.discovery(); else await f.start(undefined);
        f.queue(result('suite.Case.test_fails')); f.close(); f.flushDecoder();
        assert.equal(f.disposed, true); assert.equal(f.results.length, 0);
    }
});
test('portable installation copies the helper and verifies cached patched installs', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-python-drain-'));
    try {
        const plugin = path.join(temporary, 'plugins/ms-python.python');
        const client = path.join(plugin, 'extension/out/client');
        await fs.mkdir(client, { recursive: true });
        await fs.writeFile(path.join(plugin, 'extension/package.json'), JSON.stringify({
            publisher: 'ms-python', name: 'python', version: PYTHON_VERSION }));
        await fs.writeFile(path.join(plugin, '.workbench-source-sha256'), PYTHON_VSIX_SHA256);
        await fs.writeFile(path.join(client, 'extension.js'), upstream);
        await fs.mkdir(path.join(plugin, 'extension/python_files/unittestadapter'), { recursive: true });
        await fs.writeFile(path.join(plugin, 'extension/python_files/unittestadapter/execution.py'), sender.upstream);
        const record = await patchPythonResults(temporary);
        assert.equal(await fs.readFile(path.join(client, 'extension.js'), 'utf8'), patched);
        assert.equal(digest(await fs.readFile(path.join(client, 'workbench-result-drain.cjs'))), record.helperSha256);
        assert.equal(record.upstreamBundleSha256, PYTHON_BUNDLE_SHA256);
        assert.equal(record.patchedBundleSha256, digest(patched));
        assert.equal(record.upstreamSenderSha256, PYTHON_SENDER_SHA256);
        assert.equal(record.patchedSenderSha256, digest(sender.patched));
        assert.deepEqual(await patchPythonResults(temporary), record);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(plugin, '.workbench-python-result-drain.json'), 'utf8')), record);
        await fs.writeFile(path.join(plugin, 'extension/package.json'), JSON.stringify({
            publisher: 'ms-python', name: 'python', version: '2026.5.0' }));
        await assert.rejects(patchPythonResults(temporary), /Reassess/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
test('actual pinned Python sender emits its completion barrier after real PASS and FAIL results', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-python-sender-'));
    try {
        const idsPath = path.join(temporary, 'test-ids.txt'), pipePath = path.join(temporary, 'results.rpc');
        await fs.writeFile(path.join(temporary, 'test_ordered.py'),
            'import unittest\nclass Cases(unittest.TestCase):\n    def test_ok(self): self.assertEqual(1, 1)\n    def test_bad(self): self.assertEqual(1, 2)\n');
        await fs.writeFile(idsPath, 'test_ordered.Cases.test_ok\ntest_ordered.Cases.test_bad');
        const python = process.env.WORKBENCH_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
        const environment = { ...process.env, RUN_TEST_IDS_PIPE: idsPath, TEST_RUN_PIPE: pipePath,
            PYTHONPATH: path.dirname(path.dirname(senderPath)) };
        delete environment.COVERAGE_ENABLED; delete environment.MANAGE_PY_PATH;
        const execution = spawnSync(python, [senderPath, '--udiscovery', '-s', temporary, '-p', 'test_ordered.py'], {
            cwd: temporary, env: environment,
            encoding: 'utf8', timeout: 15_000 });
        assert.equal(execution.error, undefined, execution.error?.message);
        assert.equal(execution.status, 0, execution.stderr);
        const data = await fs.readFile(pipePath);
        const payloads = []; let offset = 0;
        while (offset < data.length) {
            const boundary = data.indexOf('\r\n\r\n', offset);
            assert.ok(boundary >= 0, 'structured frame header is complete');
            const length = /content-length: (\d+)/i.exec(data.toString('utf8', offset, boundary));
            assert.ok(length, 'structured frame has its length');
            const start = boundary + 4, end = start + Number(length[1]);
            assert.ok(end <= data.length, 'structured frame body is complete');
            payloads.push(JSON.parse(data.toString('utf8', start, end)).params); offset = end;
        }
        assert.deepEqual(payloads.at(-1), { workbench_run_complete: 1 });
        assert.equal(payloads.filter(payload => payload.workbench_run_complete).length, 1);
        const outcomes = payloads.slice(0, -1).flatMap(payload => Object.values(payload.result || {}).map(value => value.outcome));
        assert.ok(outcomes.includes('success')); assert.ok(outcomes.includes('failure'));
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
