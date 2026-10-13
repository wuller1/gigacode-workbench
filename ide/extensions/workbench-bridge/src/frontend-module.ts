import { ContainerModule, injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { PreferenceService, PreferenceScope } from '@theia/core/lib/common/preferences';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { TextEdit } from '@theia/core/shared/vscode-languageserver-protocol';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { revision } from './revision';
import { installFrameClock } from './frame-clock';
import { SemanticService } from './semantic';
import { RecoveryService } from './recovery';
import { ExecutionService } from './execution';
import { DiskStorageService } from './storage';
import { LocalStorageService } from '@theia/core/lib/browser/storage-service';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FileNavigatorContribution } from '@theia/navigator/lib/browser/navigator-contribution';

declare global {
    interface Window {
        workbenchIDE?: { version: number; invoke(method: string, params?: Record<string, any>): Promise<unknown> };
    }
}
@injectable()
class WorkbenchFrontend implements FrontendApplicationContribution {
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    @inject(ProblemManager) protected readonly problems!: ProblemManager;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(ThemeService) protected readonly themes!: ThemeService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(HostedPluginSupport) protected readonly plugins!: HostedPluginSupport;
    @inject(DebugSessionManager) protected readonly debug!: DebugSessionManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(FrontendApplicationStateService) protected readonly applicationState!: FrontendApplicationStateService;
    @inject(SemanticService) protected readonly semantic!: SemanticService;
    @inject(RecoveryService) protected readonly recovery!: RecoveryService;
    @inject(DiskStorageService) protected readonly storage!: DiskStorageService;
    @inject(ShellLayoutRestorer) protected readonly layout!: ShellLayoutRestorer;
    @inject(FrontendApplication) protected readonly app!: FrontendApplication;
    @inject(FileNavigatorContribution) protected readonly navigator!: FileNavigatorContribution;
    @inject(ExecutionService) protected readonly execution!: ExecutionService;

    onStart(): void {
        installFrameClock(window);
        window.workbenchIDE = { version: 1, invoke: (method, params = {}) => this.invoke(method, params) };
        const style = document.createElement('style');
        style.textContent = `
            body {font-family:"Segoe UI",Inter,-apple-system,sans-serif;font-size:13px}
            .theia-preload {background:#181b19}
            .theia-app-sides .lm-TabBar-tab {border-radius:5px}
            .lm-TabBar-tabCloseIcon {min-width:20px;min-height:20px}
            .theia-tree-node {min-height:23px;line-height:23px}
            .theia-tree-node-segment {font-size:12px}
            .theia-bottom-panel .lm-TabBar-tab {font-size:12px}
            .lm-TabBar-tab:focus-visible {outline:1px solid var(--theia-focusBorder);outline-offset:-2px}
        `;
        document.head.appendChild(style);
    }
    private snapshot(widget: EditorWidget, text = false): Record<string, unknown> {
        const doc = widget.editor.document;
        return { id: widget.id, uri: doc.uri, version: doc.version, revision: revision(doc), languageId: doc.languageId,
            dirty: doc.dirty, lineCount: doc.lineCount, selection: widget.editor.selection,
            ...(text ? { text: doc.getText() } : {}) };
    }
    private async editor(params: Record<string, any>): Promise<EditorWidget> {
        const widget = params.uri
            ? await this.editors.getOrCreateByUri(new URI(params.uri))
            : this.editors.currentEditor;
        if (!widget) throw new Error('NO_ACTIVE_DOCUMENT');
        return widget;
    }
    private validEdits(widget: EditorWidget, edits: unknown): TextEdit[] {
        if (!Array.isArray(edits) || !edits.length || edits.length > 500) throw new Error('INVALID_EDITS');
        const document = widget.editor.document;
        const result = edits.map(edit => {
            if (!edit || typeof edit.newText !== 'string' || edit.newText.length > 2_000_000) throw new Error('INVALID_EDIT');
            for (const pos of [edit.range?.start, edit.range?.end]) {
                if (!pos || !Number.isInteger(pos.line) || !Number.isInteger(pos.character)
                    || pos.line < 0 || pos.line >= document.lineCount || pos.character < 0
                    || pos.character > document.getLineMaxColumn(pos.line + 1) - 1) throw new Error('INVALID_RANGE');
            }
            const start = document.offsetAt(edit.range.start), end = document.offsetAt(edit.range.end);
            if (start > end) throw new Error('INVALID_RANGE');
            return { edit, start, end };
        }).sort((a, b) => a.start - b.start);
        for (let i = 1; i < result.length; i++) if (result[i].start < result[i - 1].end) throw new Error('OVERLAPPING_EDITS');
        return result.map(value => value.edit);
    }
    async invoke(method: string, p: Record<string, any>): Promise<unknown> {
        if (method === 'output' || method === 'terminal.output' || /^(tests|tasks|debug)\./.test(method)) return this.execution.invoke(method,p);
        if (method.startsWith('semantic.')) return this.semantic.invoke(method.slice('semantic.'.length), p);
        switch (method) {
            case 'ready':
                await this.applicationState.reachedState('ready');
                await this.plugins.didStart;
                await this.recovery.start();
                if (!this.preferences.get('workbench.ide.initialLayoutComplete', false)) {
                    await this.navigator.openView({ activate: false, reveal: true });
                    this.shell.expandPanel('left'); this.shell.resize(220, 'left');
                    await this.preferences.set('workbench.ide.initialLayoutComplete', true, PreferenceScope.User);
                }
                return this.invoke('status', p);
            case 'status':
                return { engine: 'theia', version: '1.76.0', bridge: 1,
                    frontendState: this.applicationState.state, theme: this.themes.getCurrentTheme().id, recovery: this.recovery.status(),
                    roots: this.workspace.tryGetRoots().map(root => root.resource.toString()),
                    documents: this.editors.all.map(widget => this.snapshot(widget)),
                    activeDocument: this.editors.currentEditor ? this.snapshot(this.editors.currentEditor) : undefined,
                    problems: this.problems.getProblemStat(),
                    plugins: this.plugins.plugins.map(plugin => ({ id: plugin.model.id, name: plugin.model.name, version: plugin.model.version })),
                    debugSessions: this.debug.sessions.map(session => ({ id: session.id, state: session.state, name: session.configuration.name, parentId: session.parentSession?.id, threadCount: [...session.threads].length, current: this.debug.currentSession?.id === session.id })) };
            case 'open': {
                const widget = await this.editors.open(new URI(p.uri), { preview: p.preview === true,
                    ...(p.line ? { selection: { start: { line: Math.max(0, p.line - 1), character: Math.max(0, (p.column || 1) - 1) } } } : {}),
                    ...(p.side ? { widgetOptions: { mode: p.side === 'bottom' ? 'split-bottom' : 'split-right' } } : {}) });
                return this.snapshot(widget);
            }
            case 'read': {
                const widget = await this.editor(p);
                const document = widget.editor.document, text = document.getText();
                const offset = Math.max(0, Number(p.offset) || 0), limit = Math.min(100_000, Math.max(1, Number(p.limit) || 30_000));
                return { ...this.snapshot(widget), text: text.slice(offset, offset + limit), offset,
                    totalCharacters: text.length, hasMore: offset + limit < text.length };
            }
            case 'recovery.flush': this.layout.storeLayout(this.app); await this.storage.flush(); await this.recovery.flush(); return { persisted: true };
            case 'recovery.export': return this.recovery.export();
            case 'recovery.read': return this.recovery.read(p.uri);
            case 'recovery.discard': return this.recovery.discard(p.uri);
            case 'edit': {
                if (typeof p.operationId !== 'string' || !/^[a-zA-Z0-9._:-]{8,200}$/.test(p.operationId)) throw new Error('OPERATION_ID_REQUIRED');
                const request = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ uri: p.uri, expectedVersion: p.expectedVersion, expectedRevision: p.expectedRevision, edits: p.edits, save: p.save }))))].map(v => v.toString(16).padStart(2, '0')).join('');
                const previous = this.recovery.receipt(p.operationId, request);
                if (previous) { if ((previous as any).pending) throw new Error('OPERATION_OUTCOME_UNKNOWN: inspect current buffer before proceeding'); return { ...previous as any, alreadyApplied: true }; }
                const widget = await this.editor(p);
                if (!Number.isInteger(p.expectedVersion) || widget.editor.document.version !== p.expectedVersion || p.expectedRevision !== revision(widget.editor.document)) throw new Error('STALE_REVISION');
                const edits = this.validEdits(widget, p.edits);
                await this.recovery.record(p.operationId, request, { pending: true });
                if (!widget.editor.executeEdits(edits)) throw new Error('EDIT_REJECTED');
                if (p.save === true) await widget.saveable.save();
                const result = this.snapshot(widget);
                await this.recovery.record(p.operationId, request, result);
                return result;
            }
            case 'save': {
                const widget = await this.editor(p);
                if (p.expectedVersion !== widget.editor.document.version || p.expectedRevision !== revision(widget.editor.document)) throw new Error('STALE_REVISION');
                await widget.saveable.save();
                return this.snapshot(widget);
            }
            case 'diagnostics':
                return this.problems.findMarkers(p.uri ? { uri: new URI(p.uri) } : {})
                    .slice(0, Math.min(1000, Number(p.limit) || 200))
                    .map(marker => ({ uri: marker.uri, source: marker.owner, ...marker.data }));
            case 'commands': {
                const query = String(p.query || '').toLowerCase();
                return this.commands.commands.filter(command => !query || `${command.id} ${command.label}`.toLowerCase().includes(query))
                    .slice(0, Math.min(500, Number(p.limit) || 100))
                    .map(command => ({ id: command.id, label: command.label, category: command.category, enabled: this.commands.isEnabled(command.id) }));
            }
            case 'command': {
                if (typeof p.id !== 'string' || !this.commands.getCommand(p.id)) throw new Error('COMMAND_UNAVAILABLE');
                if (!Array.isArray(p.args) || p.args.length > 30) throw new Error('INVALID_ARGUMENTS');
                const value = await this.commands.executeCommand(p.id, ...p.args);
                return value === undefined ? { executed: p.id } : value;
            }
            case 'theme':
                await this.preferences.set('workbench.colorTheme', p.theme === 'light' ? 'workbench-light' : 'workbench-dark', PreferenceScope.User);
                return { theme: this.themes.getCurrentTheme().id };
            case 'preferences': {
                if (typeof p.name !== 'string' || p.name.length > 200) throw new Error('INVALID_PREFERENCE');
                if ('value' in p) await this.preferences.set(p.name, p.value, PreferenceScope.User);
                return { name: p.name, value: this.preferences.get(p.name) };
            }
            case 'layout':
                if (p.explorer === true) { await this.navigator.openView({activate: false,reveal: true}); this.shell.expandPanel('left'); this.shell.resize(Math.min(500,Math.max(180,Number(p.explorerWidth)||220)),'left'); }
                if (p.explorer === false) await this.shell.collapsePanel('left');
                if (p.bottom === false) await this.shell.collapsePanel('bottom');
                return { applied: true };
            case 'focus':
                if (this.editors.currentEditor) await this.shell.activateWidget(this.editors.currentEditor.id);
                return { focused: Boolean(this.editors.currentEditor) };
            default: throw new Error('UNKNOWN_IDE_METHOD');
        }
    }
}
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(DiskStorageService).toSelf().inSingletonScope();
    rebind(LocalStorageService).toService(DiskStorageService);
    bind(SemanticService).toSelf().inSingletonScope();
    bind(RecoveryService).toSelf().inSingletonScope();
    bind(ExecutionService).toSelf().inSingletonScope();
    bind(WorkbenchFrontend).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(WorkbenchFrontend);
});
