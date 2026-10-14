import { ContainerModule, injectable, inject } from '@theia/core/shared/inversify';
import { BackendApplicationContribution, EarlyExpressMiddleware } from '@theia/core/lib/node/backend-application';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { json } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { EnvVariablesServerImpl } from '@theia/core/lib/node/env-variables/env-variables-server';

const MAX_RECOVERY_BYTES = 18_000_000;
function validRecovery(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const state = value as Record<string, unknown>;
    // An empty file is the legacy initial state, not a malformed draft.
    if (!Object.keys(state).length) return true;
    if (Object.keys(state).some(key => !['drafts', 'receipts'].includes(key))) return false;
    const drafts = state.drafts, receipts = state.receipts;
    if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)
        || !receipts || typeof receipts !== 'object' || Array.isArray(receipts)
        || Object.keys(drafts).length > 500 || Object.keys(receipts).length > 500) return false;
    for (const [key, entry] of Object.entries(drafts)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const draft = entry as Record<string, unknown>;
        if (typeof draft.uri !== 'string' || draft.uri.length > 8192 || draft.uri !== key
            || typeof draft.text !== 'string' || draft.text.length > 2_000_000
            || typeof draft.base !== 'string' || draft.base.length > 2_000_000
            || typeof draft.updated !== 'string' || draft.updated.length > 80
            || (draft.conflict !== undefined && typeof draft.conflict !== 'boolean')) return false;
        try { if (new URL(draft.uri).protocol !== 'file:') return false; } catch { return false; }
    }
    for (const [key, entry] of Object.entries(receipts)) {
        if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const receipt = entry as Record<string, unknown>;
        if (typeof receipt.request !== 'string' || receipt.request.length > 4096 || !('result' in receipt)) return false;
    }
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_RECOVERY_BYTES;
}
async function persistRecovery(file: string, contents: string): Promise<void> {
    const directory = path.dirname(file), temporary = file + '.partial-' + randomUUID();
    await fs.mkdir(directory, { recursive: true });
    let handle: import('node:fs/promises').FileHandle | undefined;
    try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
        await handle.close(); handle = undefined;
        await fs.rename(temporary, file);
        // Windows does not provide the POSIX directory-fsync contract. The file
        // is synced before its atomic rename; unsupported directory sync alone
        // is not reported as a failed file write.
        if (process.platform !== 'win32') {
            const parent = await fs.open(directory, 'r');
            try { await parent.sync(); }
            catch (error) { if (!['EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
            finally { await parent.close(); }
        }
    } finally {
        await handle?.close();
        await fs.rm(temporary, { force: true });
    }
}

@injectable()
class ProtectedEnvironment extends EnvVariablesServerImpl {
    async getVariables() {
        return (await super.getVariables()).filter(value => value.name.toUpperCase() !== 'WORKBENCH_IDE_TOKEN');
    }
    async getValue(key: string) {
        return key.toUpperCase() === 'WORKBENCH_IDE_TOKEN' ? undefined : super.getValue(key);
    }
}

/** The IDE is a privileged local service, never an unauthenticated localhost IDE. */
@injectable()
class WorkbenchBackend implements BackendApplicationContribution {
    @inject(EarlyExpressMiddleware) protected readonly middleware!: EarlyExpressMiddleware;
    private token = process.env.WORKBENCH_IDE_TOKEN || '';
    private epoch = randomUUID();
    private authorized(req: IncomingMessage): boolean {
        const received = String(req.headers['x-workbench-ide-token'] || '');
        const origin = req.headers.origin;
        const host = String(req.headers.host || '');
        const mainHost = `localhost:${req.socket.localPort}`;
        const mainOrigin = `http://${mainHost}`;
        const preview = host.endsWith(`.webview.${mainHost}`);
        // Remote/plugin preview documents cannot use authenticated cross-origin fetch or WebSocket
        // to turn their untrusted content into local filesystem/terminal commands.
        if (preview) {
            if (!['GET', 'HEAD'].includes(req.method || '') || !req.url?.startsWith('/webview/')) return false;
            if (origin && origin !== 'null' && origin !== mainOrigin && origin !== `http://${host}`) return false;
        } else if (![mainHost, `127.0.0.1:${req.socket.localPort}`].includes(host) || (origin && origin !== mainOrigin)) return false;
        return this.token.length >= 32 && received.length === this.token.length
            && timingSafeEqual(Buffer.from(received), Buffer.from(this.token));
    }
    initialize(): void {
        if (this.token.length < 32) throw new Error('WORKBENCH_IDE_TOKEN is required');
        this.middleware.handlers.push((req, res, next) => {
            if (!this.authorized(req)) {
                res.status(401).set('Cache-Control', 'no-store').send('Unauthorized');
                return;
            }
            res.set('Cache-Control', 'no-store');
            next();
        });
    }
    configure(app: import('express').Application): void {
        const file = path.join(process.env.THEIA_CONFIG_DIR!, 'workbench-recovery.json');
        let writing: Promise<unknown> = Promise.resolve();
        app.get('/workbench/recovery', async (_req, res) => {
            try { await writing; const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
                if (stat && (!stat.isFile() || stat.size > MAX_RECOVERY_BYTES)) throw new Error('RECOVERY_LIMIT');
                const data = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
                if (!validRecovery(JSON.parse(data))) throw new Error('INVALID_RECOVERY');
                res.type('application/json').send(data);
            } catch { res.status(500).send('Recovery read failed'); }
        });
        app.post('/workbench/recovery', json({ limit: '20mb' }), async (req, res) => {
            if (!validRecovery(req.body)) { res.status(400).send('Invalid recovery'); return; }
            const contents = JSON.stringify(req.body);
            const next = writing.catch(() => {}).then(async () => {
                await persistRecovery(file, contents);
            });
            writing = next;
            try { await next; res.json({ persisted: true }); } catch { res.status(500).send('Recovery write failed'); }
        });
        const storageDirectory = path.join(process.env.THEIA_CONFIG_DIR!, 'workbench-storage');
        const keyFile = (key: unknown) => { if (typeof key !== 'string' || key.length > 2000) throw new Error('INVALID_STORAGE_KEY'); return path.join(storageDirectory, createHash('sha256').update(key).digest('hex') + '.json'); };
        let storageWrites: Promise<unknown> = Promise.resolve();
        app.get('/workbench/storage', async (req, res) => {
            try { const target = keyFile(req.query.key); await storageWrites; const data = await fs.readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; }); const stored = JSON.parse(data); res.json({ ...stored, backendChanged: stored.backendEpoch !== this.epoch }); }
            catch { res.status(500).send('Storage read failed'); }
        });
        app.post('/workbench/storage', json({ limit: '20mb' }), async (req,res) => {
            let target: string; try { target = keyFile(req.body?.key); } catch { res.status(400).send('Invalid storage key'); return; }
            const contents = JSON.stringify('data' in req.body ? { data: req.body.data, backendEpoch: this.epoch } : { backendEpoch: this.epoch });
            const next = storageWrites.catch(() => {}).then(async () => { await fs.mkdir(storageDirectory,{recursive:true}); await fs.writeFile(target + '.partial', contents, {mode:0o600}); await fs.rename(target + '.partial',target); });
            storageWrites=next;
            try { await next; res.json({persisted:true}); } catch { res.status(500).send('Storage write failed'); }
        });
        app.get('/workbench/health', (_req, res) => res.json({ engine: 'theia', version: '1.76.0', bridge: 1 }));
    }
    onStart(server: Server): void {
        server.prependListener('upgrade', (req, socket) => {
            if (!this.authorized(req)) socket.destroy();
        });
        const address = server.address();
        if (address && typeof address !== 'string') {
            process.stdout.write(`WORKBENCH_IDE_READY ${JSON.stringify({ port: address.port, version: '1.76.0' })}\n`);
        }
    }
}
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(WorkbenchBackend).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(WorkbenchBackend);
    rebind(EnvVariablesServer).to(ProtectedEnvironment).inSingletonScope();
});
