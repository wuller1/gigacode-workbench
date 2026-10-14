import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { TestService, TestItem, TestRunProfileKind } from '@theia/test/lib/browser/test-service';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { ResourceProvider } from '@theia/core/lib/common/resource';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TaskService } from '@theia/task/lib/browser/task-service';
import { TaskConfiguration } from '@theia/task/lib/common';
import { DebugConfigurationManager } from '@theia/debug/lib/browser/debug-configuration-manager';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';

/** Structured views of the very same test/task/debug services used by the native IDE. */
@injectable()
export class ExecutionService {
    @inject(EditorManager) private readonly editors!: EditorManager;
    @inject(OutputChannelManager) private readonly output!: OutputChannelManager;
    @inject(ResourceProvider) private readonly resources!: ResourceProvider;
    @inject(TerminalService) private readonly terminals!: TerminalService;
    @inject(TestService) private readonly tests!: TestService;
    @inject(TaskService) private readonly tasks!: TaskService;
    @inject(DebugConfigurationManager) private readonly debugConfigurations!: DebugConfigurationManager;
    @inject(DebugSessionManager) private readonly debug!: DebugSessionManager;
    private taskChoices = new Map<string, { task: TaskConfiguration; token: number }>();
    private taskRuns = new Map<number, { taskId: number; label?: string; state: string; exitCode?: number; error?: string }>();
    private pendingTestStarts = new Set<string>();
    private pageLimit(p: Record<string, any>) { return Math.min(1000,Math.max(1,Math.floor(Number(p.limit)||200))); }
    private allTests(items: readonly TestItem[]): TestItem[] { return items.flatMap(item => [item, ...this.allTests(item.tests)]); }
    async invoke(method: string, p: Record<string, any>): Promise<unknown> {
        if (method === 'output') {
            const channels = this.output.getChannels();
            if (!p.channel) return channels.map(channel => ({ name: channel.name, uri: channel.uri.toString() }));
            const channel = channels.find(channel => channel.name === p.channel); if (!channel) throw new Error('OUTPUT_CHANNEL_NOT_FOUND');
            const resource = await this.resources(channel.uri); const text = await resource.readContents();
            return { channel: channel.name, text: text.slice(-Math.min(100_000, Number(p.limit) || 20_000)), totalCharacters: text.length };
        }
        if (method === 'terminal.output') {
            if (!p.terminalId) return this.terminals.all.map(terminal => ({ id: terminal.id, label: terminal.title.label, lines: terminal.buffer.length }));
            const terminal = this.terminals.getById(p.terminalId); if (!terminal) throw new Error('TERMINAL_NOT_FOUND');
            return { id: terminal.id, label: terminal.title.label, output: terminal.buffer.getLines(Math.max(0, terminal.buffer.length - 200), 200, true).join('\n').slice(-Math.min(100_000,Number(p.limit)||20_000)) };
        }
        if (['tests.run','tasks.run','debug.start'].includes(method)) { const dirty = this.editors.all.filter(widget => widget.editor.document.dirty); if (dirty.length) throw new Error('UNSAVED_DOCUMENTS: save only task-relevant files at their current revisions before running; never save unrelated edits to bypass this check. ' + JSON.stringify(dirty.slice(0,20).map(widget => widget.editor.document.uri))); }
        if (method === 'tests.list') return { refreshing: this.tests.isRefreshing, controllers: this.tests.getControllers().filter(controller => !p.controllerId || controller.id === p.controllerId).map(controller => ({
            id: controller.id, label: controller.label, startPending: this.pendingTestStarts.has(controller.id), profiles: controller.testRunProfiles.map(profile => ({ label: profile.label, kind: profile.kind, isDefault: profile.isDefault })),
            totalTests: this.allTests(controller.tests).length, offset: Math.max(0,Number(p.offset)||0), tests: this.allTests(controller.tests).slice(Math.max(0,Number(p.offset)||0),Math.max(0,Number(p.offset)||0)+this.pageLimit(p)).map(item => ({ id: item.id, label: item.label, uri: item.uri?.toString(), range: item.range, parentId: item.parent?.id, busy: item.busy, error: item.error })),
            runs: controller.testRuns.filter(run=>!p.runId || run.id===p.runId).slice(-3).map(run => ({ id: run.id, name: run.name, running: run.isRunning,
                totalResults: run.items.length, items: run.items.slice(Math.max(0,Number(p.offset)||0),Math.max(0,Number(p.offset)||0)+this.pageLimit(p)).map(item => ({ id: item.id, label: item.label, result: run.getTestState(item) })),
                output: run.getOutput().map(item => item.output).join('').slice(-20_000) })) })) };
        if (method === 'tests.refresh') { this.tests.refresh(); return { requested: true, requiresReadback: true }; }
        if (method === 'tests.run') {
            const controller = this.tests.getControllers().find(value => value.id === p.controllerId); if (!controller) throw new Error('TEST_CONTROLLER_UNAVAILABLE');
            if (this.tests.isRefreshing) throw new Error('TESTS_REFRESHING: wait for test discovery before starting a run');
            if (this.pendingTestStarts.has(controller.id) || controller.testRuns.some(run => run.isRunning)) throw new Error('TEST_RUN_IN_PROGRESS: inspect the current run instead of starting another');
            const candidates = controller.testRunProfiles.filter(profile => profile.kind === (p.debug ? TestRunProfileKind.Debug : TestRunProfileKind.Run) && (!p.profile || profile.label === p.profile));
            const profile = candidates.find(value => value.isDefault) || (candidates.length === 1 ? candidates[0] : undefined);
            if (!profile) throw new Error('SELECT_AVAILABLE_TEST_PROFILE');
            const available = this.allTests(controller.tests);
            if (available.some(item => item.busy)) throw new Error('TESTS_DISCOVERY_BUSY: wait for the test tree to finish updating');
            const included = Array.isArray(p.testIds) && p.testIds.length ? p.testIds.map((id: string) => { const test = available.find(value => value.id === id); if (!test) throw new Error('TEST_NOT_FOUND'); return test; }) : available.filter(item => !item.tests.length);
            if (!included.length) throw new Error('NO_DISCOVERED_TESTS');
            // profile.run is fire-and-forget in the native Theia API. A dispatch
            // alone is not evidence that a run exists (stale item paths can be
            // ignored by the extension host). Subscribe before dispatch and
            // return the actual newly created run ID, never an older result.
            const previous = new Set(controller.testRuns.map(run => run.id));
            this.pendingTestStarts.add(controller.id);
            const runId = await new Promise<string>((resolve, reject) => {
                const subscription = controller.onRunsChanged(() => {
                    const created = controller.testRuns.filter(run => !previous.has(run.id));
                    if (!created.length) return;
                    clearTimeout(timer); subscription.dispose(); this.pendingTestStarts.delete(controller.id);
                    if (created.length !== 1) reject(new Error('TEST_RUN_START_AMBIGUOUS: inspect native runs before retrying'));
                    else resolve(created[0].id);
                });
                const timer = setTimeout(() => {
                    // Keep the pending fence and listener after an unknown
                    // outcome: a delayed native run must not cause a duplicate
                    // execution. Its eventual creation releases the fence.
                    reject(new Error('TEST_RUN_START_UNCONFIRMED: no native run receipt; inspect tests.list before retrying'));
                }, 30_000);
                try { profile.run('Workbench agent', included, [], true); }
                catch (error) { clearTimeout(timer); subscription.dispose(); this.pendingTestStarts.delete(controller.id); reject(error); }
            });
            // Native extensions choose their own TestRun name; Theia does not
            // propagate our request name/ID into TestRunRequest. This receipt
            // identifies a new controller run, not proven ownership if a
            // person concurrently starts the same controller in native UI.
            return { requested: true, runId, attribution: 'new-controller-run', requestIdSupported: false, controllerId: controller.id, profile: profile.label, includedCount: included.length, paths: included.slice(0,20).map((item: TestItem) => item.path), requiresReadback: true };
        }
        if (method === 'tests.cancel') {
            const run = this.tests.getControllers().find(controller => controller.id === p.controllerId)?.testRuns.find(value => value.id === p.runId);
            if (!run) throw new Error('TEST_RUN_NOT_FOUND'); run.cancel(); return { cancellationRequested: true };
        }
        if (method === 'tasks.list') {
            const token = this.tasks.startUserAction(), tasks = await this.tasks.getTasks(token);
            while(this.taskChoices.size>2000) this.taskChoices.delete(this.taskChoices.keys().next().value!);
            return { totalTasks: tasks.length, configured: tasks.slice(Math.max(0,Number(p.offset)||0),Math.max(0,Number(p.offset)||0)+this.pageLimit(p)).map(task => { const id = crypto.randomUUID(); this.taskChoices.set(id, { task, token }); return { id, label: task.label, type: task.type, source: task._source, scope: task._scope, group: task.group }; }),
                running: (await this.tasks.getRunningTasks()).map(task => ({ taskId: task.taskId, label: task.config.label, terminalId: task.terminalId })), results: [...this.taskRuns.values()] };
        }
        if (method === 'tasks.run') {
            const choice = this.taskChoices.get(p.id); if (!choice) throw new Error('TASK_CHOICE_EXPIRED');
            const info = await this.tasks.run(choice.token, choice.task._source!, choice.task.label!, choice.task._scope!);
            if (!info) throw new Error('TASK_NOT_STARTED');
            const record = { taskId: info.taskId, label: info.config.label, state: 'running' } as { taskId: number; label?: string; state: string; exitCode?: number; error?: string };
            this.taskRuns.set(info.taskId, record);
            void this.tasks.getExitCode(info.taskId).then(code => { record.state = code === undefined ? 'unknown' : code === 0 ? 'passed' : 'failed'; record.exitCode = code; }, error => { record.state = 'unknown'; record.error = String(error); });
            return record;
        }
        if (method === 'tasks.cancel') { const running = await this.tasks.getRunningTasks(); if (!running.some(task => task.taskId === p.taskId)) throw new Error('TASK_NOT_RUNNING'); await this.tasks.kill(p.taskId); return { cancellationRequested: true }; }
        if (method === 'debug.configurations') return [...await this.debugConfigurations.supported].map(option => ({ name: option.name, workspaceFolderUri: option.workspaceFolderUri, type: option.configuration?.type }));
        if (method === 'debug.start') {
            const choices = [...await this.debugConfigurations.supported].filter(option => option.name === p.name);
            if (choices.length !== 1) throw new Error('DEBUG_CONFIGURATION_UNAVAILABLE: ' + JSON.stringify([...this.debugConfigurations.all].map(option => option.name)));
            const selected = choices[0];
            const session = await this.debug.start(selected.configuration ? { ...selected, configuration: { ...selected.configuration, suppressSaveBeforeStart: true } } : selected); return { started: Boolean(session), requiresReadback: true }; }
        const session = this.debug.getSession(p.sessionId) || (!p.sessionId ? this.debug.currentSession : undefined);
        if (!session) throw new Error('DEBUG_SESSION_NOT_FOUND');
        if (method === 'debug.stop') { await this.debug.terminateSession(session); return { stopped: true }; }
        if (method === 'debug.evaluate') return session.evaluate(String(p.expression), 'watch');
        if (method === 'debug.request') {
            if (!['threads', 'stackTrace', 'scopes', 'variables', 'continue', 'pause', 'next', 'stepIn', 'stepOut', 'exceptionInfo', 'loadedSources'].includes(p.command)) throw new Error('DEBUG_REQUEST_UNSUPPORTED');
            return session.sendRequest(p.command, p.args || {});
        }
        throw new Error('UNKNOWN_EXECUTION_METHOD');
    }
}
