import { revision } from './revision';
import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoBulkEditService } from '@theia/monaco/lib/browser/monaco-bulk-edit-service';
import { StandaloneServices } from '@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices';
import { ILanguageFeaturesService } from '@theia/monaco-editor-core/esm/vs/editor/common/services/languageFeatures';
import { rename, prepareRename } from '@theia/monaco-editor-core/esm/vs/editor/contrib/rename/browser/rename';
import { CancellationToken } from '@theia/monaco-editor-core/esm/vs/base/common/cancellation';
import { CodeActionTriggerType, type WorkspaceEdit, type CodeAction, type CodeActionProvider } from '@theia/monaco-editor-core/esm/vs/editor/common/languages';
import type { ITextModel } from '@theia/monaco-editor-core/esm/vs/editor/common/model';
import { Position } from '@theia/monaco-editor-core/esm/vs/editor/common/core/position';
import { Range } from '@theia/monaco-editor-core/esm/vs/editor/common/core/range';

type FileSnapshot = { uri: string; exists: boolean; hash?: string; version?: number; dirty?: boolean };
type Proposal = { id: string; label: string; edit: WorkspaceEdit; files: FileSnapshot[];
    createdAt: number; applied?: unknown; applying?: Promise<unknown> };
type Action = { id: string; action: CodeAction; provider: CodeActionProvider; uri: string; version: number; revision: string; createdAt: number };
async function sha(bytes: Uint8Array): Promise<string> {
    const data = new Uint8Array(bytes);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
}
@injectable()
export class SemanticService {
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    @inject(MonacoBulkEditService) protected readonly bulk!: MonacoBulkEditService;
    private proposals = new Map<string, Proposal>();
    private actions = new Map<string, Action>();
    private actionLists: { dispose(): void }[] = [];
    private services() { return StandaloneServices.get(ILanguageFeaturesService); }
    private async target(p: Record<string, any>) {
        const widget = p.uri ? await this.editors.getOrCreateByUri(new URI(p.uri)) : this.editors.currentEditor;
        if (!widget || !(widget.editor instanceof MonacoEditor)) throw new Error('NO_LANGUAGE_DOCUMENT');
        // The public editor API narrows the type; its pinned implementation is the same internal TextModel.
        const model = widget.editor.getControl().getModel() as ITextModel | null;
        if (!model) throw new Error('MODEL_UNAVAILABLE');
        if (p.expectedVersion !== undefined && (p.expectedVersion !== widget.editor.document.version || p.expectedRevision !== revision(widget.editor.document))) throw new Error('STALE_REVISION');
        const position = new Position(Number(p.line ?? (widget.editor.cursor.line + 1)), Number(p.column ?? (widget.editor.cursor.character + 1)));
        if (!Number.isInteger(position.lineNumber) || !Number.isInteger(position.column)
            || position.lineNumber < 1 || position.lineNumber > model.getLineCount()
            || position.column < 1 || position.column > model.getLineMaxColumn(position.lineNumber)) throw new Error('INVALID_POSITION');
        return { widget, model, position, version: widget.editor.document.version };
    }
    private async fingerprint(uri: string): Promise<FileSnapshot> {
        const resource = new URI(uri);
        if (resource.scheme !== 'file' || !this.workspace.tryGetRoots().some(root => root.resource.isEqualOrParent(resource))) throw new Error('OUTSIDE_WORKSPACE');
        const widget = this.editors.all.find(value => value.editor.document.uri === uri);
        const open = widget ? { version: widget.editor.document.version, dirty: widget.editor.document.dirty } : {};
        if (!await this.files.exists(resource)) return { uri, exists: false, ...open };
        const stat = await this.files.resolve(resource);
        if (stat.isDirectory) return { uri, exists: true, hash: `directory:${stat.mtime}`, ...open };
        if (typeof stat.size !== "number" || stat.size > 10 * 1024 * 1024) throw new Error('REFACTOR_FILE_TOO_LARGE');
        const content = await this.files.readFile(resource);
        return { uri, exists: true, hash: await sha(content.value.buffer), ...open };
    }
    private trim(): void {
        const now = Date.now();
        for (const [id, value] of this.proposals) if (now - value.createdAt > 15 * 60_000 && !value.applying) this.proposals.delete(id);
        for (const [id, value] of this.actions) if (now - value.createdAt > 15 * 60_000) this.actions.delete(id);
        while (this.proposals.size > 30) this.proposals.delete(this.proposals.keys().next().value!);
        while (this.actions.size > 500) this.actions.delete(this.actions.keys().next().value!);
    }
    private async proposal(edit: WorkspaceEdit, label: string): Promise<unknown> {
        if (!edit.edits.length) throw new Error('NO_REFACTOR_EDITS');
        if (edit.edits.length > 5000) throw new Error('REFACTOR_PREVIEW_TOO_LARGE');
        const uris = new Set<string>();
        for (const item of edit.edits) {
            const value = item as any;
            for (const uri of [value.resource, value.oldResource, value.newResource]) if (uri) uris.add(uri.toString());
        }
        const files: FileSnapshot[] = [];
        for (const uri of uris) files.push(await this.fingerprint(uri));
        const id = crypto.randomUUID();
        this.proposals.set(id, { id, label, edit, files, createdAt: Date.now() }); this.trim();
        return this.describe(this.proposals.get(id)!);
    }
    private describe(proposal: Proposal) {
        return { proposalId: proposal.id, label: proposal.label, files: proposal.files.slice(0,100), totalFiles: proposal.files.length, filesTruncated: proposal.files.length>100, editCount: proposal.edit.edits.length,
            applied: Boolean(proposal.applied), expiresAt: new Date(proposal.createdAt + 15 * 60_000).toISOString(),
            preview: proposal.edit.edits.slice(0, 80).map(item => { const edit = item as any;
                return { uri: edit.resource?.toString(), oldUri: edit.oldResource?.toString(), newUri: edit.newResource?.toString(),
                    range: edit.textEdit?.range, text: edit.textEdit?.text?.slice(0, 300), textTruncated: edit.textEdit?.text?.length > 300 }; }),
            previewTruncated: proposal.edit.edits.length > 80 };
    }
    async invoke(method: string, p: Record<string, any>): Promise<unknown> {
        this.trim();
        if (method === 'files') { const proposal = this.proposals.get(p.proposalId); if (!proposal) throw new Error('PROPOSAL_EXPIRED'); return proposal.files; }
        if (method === 'proposal') {
            const proposal = this.proposals.get(p.proposalId); if (!proposal) throw new Error('PROPOSAL_EXPIRED');
            return this.describe(proposal);
        }
        if (method === 'apply') {
            const proposal = this.proposals.get(p.proposalId); if (!proposal) throw new Error('PROPOSAL_EXPIRED');
            if (proposal.applied) return { ...proposal.applied as any, alreadyApplied: true };
            if (proposal.applying) return proposal.applying;
            proposal.applying = (async () => {
                for (const before of proposal.files) {
                    const current = await this.fingerprint(before.uri);
                    if (before.exists !== current.exists || before.hash !== current.hash || before.version !== current.version) throw new Error('STALE_REFACTOR_PREVIEW: ' + before.uri);
                }
                const result = await this.bulk.apply(proposal.edit, { label: proposal.label, code: 'workbench.semantic',
                    showPreview: p.review === true, respectAutoSaveConfig: false, confirmBeforeUndo: true });
                if (!result.isApplied) throw new Error('REFACTOR_NOT_APPLIED');
                if (p.review === true || proposal.edit.edits.some(item => item.metadata?.needsConfirmation)) return { proposalId: proposal.id, previewOpened: true, applied: false, requiresReadback: true, requiresUserAction: true };
                let changed = false;
                for (const before of proposal.files) { const after = await this.fingerprint(before.uri); if (before.exists !== after.exists || before.hash !== after.hash || before.version !== after.version) changed = true; }
                if (!changed) throw new Error('REFACTOR_NO_OBSERVED_CHANGES');
                const receipt = { proposalId: proposal.id, label: proposal.label, applied: true,
                    summary: result.ariaSummary, files: proposal.files.map(file => file.uri), requiresBuildAndTests: true };
                proposal.applied = receipt; return receipt;
            })();
            try { return await proposal.applying; } finally { proposal.applying = undefined; }
        }
        if (method === 'action.preview' || method === 'action.run') {
            const record = this.actions.get(p.actionId); if (!record) throw new Error('CODE_ACTION_EXPIRED');
            const { widget } = await this.target({ uri: record.uri, expectedVersion: record.version, expectedRevision: record.revision });
            if (record.provider.resolveCodeAction) record.action = await record.provider.resolveCodeAction(record.action, CancellationToken.None) || record.action;
            if (widget.editor.document.version !== record.version) throw new Error('STALE_REVISION');
            if (record.action.edit) return this.proposal(record.action.edit, record.action.title);
            if (method === 'action.preview') return { actionId: record.id, title: record.action.title,
                commandOnly: true, commandId: record.action.command?.id, requiresReadback: true };
            if (!record.action.command) throw new Error('CODE_ACTION_HAS_NO_EFFECT');
            const command = record.action.command;
            await this.commands.executeCommand(command.id, ...(command.arguments || []));
            return { actionId: record.id, commandExecuted: command.id, requiresReadback: true };
        }
        const { widget, model, position, version } = await this.target(p);
        const features = this.services();
        if (method === 'capabilities') return { uri: model.uri.toString(), version,
            rename: features.renameProvider.ordered(model).length > 0,
            definition: features.definitionProvider.ordered(model).length > 0,
            references: features.referenceProvider.ordered(model).length > 0,
            codeActions: features.codeActionProvider.ordered(model).length > 0,
            completion: features.completionProvider.ordered(model).length > 0,
        };
        if (method === 'rename') {
            if (!Number.isInteger(p.expectedVersion)) throw new Error('EXPECTED_VERSION_REQUIRED');
            if (typeof p.newName !== 'string' || !p.newName.trim() || p.newName.length > 300) throw new Error('INVALID_NEW_NAME');
            if (!features.renameProvider.ordered(model).length) throw new Error('RENAME_PROVIDER_UNAVAILABLE');
            const location = await prepareRename(features.renameProvider, model, position);
            if (location?.rejectReason) throw new Error(location.rejectReason);
            const result = await rename(features.renameProvider, model, position, p.newName);
            if (result.rejectReason) throw new Error(result.rejectReason);
            if (widget.editor.document.version !== version) throw new Error('STALE_REVISION');
            return this.proposal(result, `Rename ${location?.text || 'symbol'} → ${p.newName}`);
        }
        if (method === 'navigate') {
            const kind = String(p.kind || 'definition');
            const registry = kind === 'references' ? features.referenceProvider : kind === 'implementation'
                ? features.implementationProvider : kind === 'type' ? features.typeDefinitionProvider : features.definitionProvider;
            const providers = registry.ordered(model); const locations: any[] = [];
            for (const provider of providers as any[]) {
                const result = kind === 'references' ? await provider.provideReferences(model, position, { includeDeclaration: true }, CancellationToken.None)
                    : kind === 'implementation' ? await provider.provideImplementation(model, position, CancellationToken.None)
                    : kind === 'type' ? await provider.provideTypeDefinition(model, position, CancellationToken.None)
                    : await provider.provideDefinition(model, position, CancellationToken.None);
                for (const value of Array.isArray(result) ? result : result ? [result] : []) locations.push({ uri: value.uri.toString(), range: value.range,
                    originSelectionRange: value.originSelectionRange });
            }
            return { uri: model.uri.toString(), version, kind, providerCount: providers.length,
                locations: locations.slice(0, Math.min(1000, Number(p.limit) || 100)), total: locations.length };
        }
        if (method === 'actions') {
            const range = new Range(position.lineNumber, position.column, Number(p.endLine || position.lineNumber), Number(p.endColumn || position.column));
            if (!Range.equalsRange(range, model.validateRange(range))) throw new Error('INVALID_RANGE');
            const output: unknown[] = [];
            for (const provider of features.codeActionProvider.ordered(model)) {
                const list = await provider.provideCodeActions(model, range, { trigger: CodeActionTriggerType.Invoke,
                    ...(p.kind ? { only: p.kind } : {}) }, CancellationToken.None);
                if (!list) continue;
                this.actionLists.push(list);
                for (const action of list.actions) {
                    const id = crypto.randomUUID(); this.actions.set(id, { id, action, provider, uri: model.uri.toString(), version, revision: revision(widget.editor.document), createdAt: Date.now() });
                    output.push({ actionId: id, title: action.title, kind: action.kind, preferred: action.isPreferred,
                        disabled: action.disabled, hasEdit: Boolean(action.edit), commandId: action.command?.id });
                }
            }
            while (this.actionLists.length > 20) this.actionLists.shift()!.dispose();
            return { uri: model.uri.toString(), version, actions: output.slice(0, 100), total: output.length };
        }
        throw new Error('UNKNOWN_SEMANTIC_METHOD');
    }
}
