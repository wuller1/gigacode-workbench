import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { UntitledResourceResolver } from '@theia/core/lib/common/resource';
import { DiffService } from '@theia/workspace/lib/browser/diff-service';
import { QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import { CommandRegistry } from '@theia/core/lib/common/command';

type Draft = { uri: string; base: string; text: string; updated: string; conflict?: boolean };
/** Recovery is disk-backed, independent of the backend's changing local HTTP port. */
@injectable()
export class RecoveryService {
    @inject(EditorManager) private readonly editors!: EditorManager;
    @inject(FileService) private readonly files!: FileService;
    @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
    @inject(MessageService) private readonly messages!: MessageService;
    @inject(UntitledResourceResolver) private readonly untitled!: UntitledResourceResolver;
    @inject(DiffService) private readonly diff!: DiffService;
    @inject(QuickPickService) private readonly quickpick!: QuickPickService;
    @inject(CommandRegistry) private readonly commands!: CommandRegistry;
    private drafts: Record<string, Draft> = {};
    private receipts: Record<string, { request: string; result: unknown }> = {};
    private base = new Map<string, string>();
    private attached = new WeakSet<EditorWidget>();
    private restoring = true;
    private loaded?: Promise<void>;
    private writes: Promise<unknown> = Promise.resolve();
    private timer?: ReturnType<typeof setTimeout>;
    error?: string;
    start(): Promise<void> { return this.loaded ||= this.initialize(); }
    private async initialize(): Promise<void> {
        const response = await fetch('/workbench/recovery');
        if (!response.ok) throw new Error('RECOVERY_READ_FAILED');
        const stored = await response.json();
        this.drafts = stored.drafts || {}; this.receipts = stored.receipts || {};
        this.commands.registerCommand({ id: 'workbench.recovery', label: 'Workbench: восстановление несохранённых файлов' }, { execute: () => this.show() });
        this.editors.onCreated(widget => { void this.attach(widget); });
        for (const widget of this.editors.all) await this.attach(widget);
        for (const draft of Object.values(this.drafts)) {
            const resource = new URI(draft.uri);
            if (resource.scheme !== 'file' || !this.workspace.tryGetRoots().some(root => root.resource.isEqualOrParent(resource))) continue;
            try {
                const disk = (await this.files.readFile(resource)).value.toString();
                if (disk === draft.text) { delete this.drafts[draft.uri]; continue; }
                if (disk !== draft.base) { draft.conflict = true; continue; }
                const widget = await this.editors.open(resource, { preview: false });
                await this.attach(widget);
                if (widget.editor.document.getText() === draft.base) {
                    const document = widget.editor.document;
                    widget.editor.executeEdits([{ range: { start: { line: 0, character: 0 }, end: document.positionAt(document.getText().length) }, newText: draft.text }]);
                    draft.conflict = false;
                } else draft.conflict = true;
            } catch { draft.conflict = true; }
        }
        this.restoring = false;
        await this.flush();
        const conflicts = Object.values(this.drafts).filter(draft => draft.conflict).length;
        if (conflicts) void this.messages.warn(`${conflicts} несохранённых файлов требуют сравнения с диском. Черновики сохранены: IDE → Восстановление.`);
    }
    private async attach(widget: EditorWidget): Promise<void> {
        if (this.attached.has(widget)) return;
        this.attached.add(widget);
        const uri = widget.editor.document.uri;
        const resource = new URI(uri);
        if (resource.scheme !== 'file' || !this.workspace.tryGetRoots().some(root => root.resource.isEqualOrParent(resource))) return;
        this.base.set(uri, this.drafts[uri]?.base ?? widget.editor.document.getText());
        widget.editor.onDocumentContentChanged(() => this.capture(widget));
        widget.saveable.onDirtyChanged(() => this.capture(widget));
    }
    private capture(widget: EditorWidget): void {
        if (this.restoring) return;
        const doc = widget.editor.document, text = doc.getText();
        if (!doc.dirty) {
            this.base.set(doc.uri, text);
            if (!this.drafts[doc.uri]?.conflict) delete this.drafts[doc.uri];
        } else if (!this.drafts[doc.uri]?.conflict) {
            if (text.length > 2_000_000) { this.fail('Файл больше лимита автоматического черновика (2 млн символов). Сохраните его перед перезапуском.'); return; }
            this.drafts[doc.uri] = { uri: doc.uri, base: this.base.get(doc.uri) ?? text, text, updated: new Date().toISOString() };
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 100);
    }
    private fail(message: string): void { if (this.error !== message) void this.messages.error(message); this.error = message; }
    async flush(): Promise<void> {
        clearTimeout(this.timer);
        const payload = JSON.stringify({ drafts: this.drafts, receipts: this.receipts });
        if (payload.length > 18_000_000) { this.fail('Лимит восстановления исчерпан. Сохраните несохранённые файлы.'); throw new Error('RECOVERY_LIMIT'); }
        const next = this.writes.catch(() => {}).then(async () => {
            const response = await fetch('/workbench/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
            if (!response.ok) throw new Error('RECOVERY_WRITE_FAILED');
        });
        this.writes = next;
        try { await next; this.error = undefined; } catch (error) { this.fail('Не удалось сохранить восстановление IDE. Не закрывайте несохранённые файлы.'); throw error; }
    }
    async show(): Promise<void> {
        const drafts = Object.values(this.drafts);
        if (!drafts.length) { void this.messages.info('Все файлы сохранены. Черновиков для восстановления нет.'); return; }
        const choice = await this.quickpick.show(drafts.map(draft => ({ label: new URI(draft.uri).path.base,
            description: draft.conflict ? 'Файл на диске изменился · сравнить' : 'Несохранённый черновик', detail: draft.uri, value: draft.uri })),
            { placeholder: 'Восстановление · выбрать черновик для сравнения с диском' });
        if (!choice) return;
        const draft = this.drafts[choice.value];
        const resource = await this.untitled.createUntitledResource(draft.text, new URI(draft.uri).path.ext);
        await this.editors.open(resource.uri, { preview: false });
        await this.diff.openDiffEditor(new URI(draft.uri), resource.uri, 'Диск ↔ сохранённый черновик', { mode: 'split-right' });
    }
    export() { if (this.restoring) throw new Error('RECOVERY_NOT_READY'); return { drafts: this.drafts, receipts: this.receipts }; }
    status() { return { error: this.error, drafts: Object.values(this.drafts).map(({ text, base, ...draft }) => ({ ...draft, characters: text.length })) }; }
    read(uri: string) { const draft = this.drafts[uri]; if (!draft) throw new Error('DRAFT_NOT_FOUND'); return draft; }
    async discard(uri: string) { delete this.drafts[uri]; await this.flush(); return this.status(); }
    receipt(id: string, request: string): unknown {
        const receipt = this.receipts[id]; if (!receipt) return undefined;
        if (receipt.request !== request) throw new Error('OPERATION_ID_REUSED');
        return receipt.result;
    }
    async record(id: string, request: string, result: unknown): Promise<void> {
        this.receipts[id] = { request, result };
        const ids = Object.keys(this.receipts); for (const old of ids.slice(0, Math.max(0, ids.length - 500))) delete this.receipts[old];
        await this.flush();
    }
}
