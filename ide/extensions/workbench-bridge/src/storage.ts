import { injectable } from '@theia/core/shared/inversify';
import { LocalStorageService } from '@theia/core/lib/browser/storage-service';
/** Keep Theia's existing workspace-prefix semantics without tying state to an ephemeral HTTP port. */
@injectable()
export class DiskStorageService extends LocalStorageService {
    private writes: Promise<unknown> = Promise.resolve();
    protected override init(): void { /* Backend owns persistence; never initialize browser localStorage. */ }
    override async getData<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        await this.writes;
        const response = await fetch('/workbench/storage?key=' + encodeURIComponent(key));
        if (!response.ok) throw new Error('IDE_STORAGE_READ_FAILED');
        const envelope = await response.json(); return 'data' in envelope ? envelope.data : defaultValue;
    }
    override setData<T>(key: string, data?: T): Promise<void> {
        const body = JSON.stringify({ key, data });
        const next = this.writes.catch(() => {}).then(async () => {
            const response = await fetch('/workbench/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            if (!response.ok) throw new Error('IDE_STORAGE_WRITE_FAILED');
        });
        this.writes = next; return next;
    }
    async flush(): Promise<void> { await this.writes; }
}
