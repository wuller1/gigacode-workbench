/** Terminal IDs belong to one backend; restoring them against a different process is invalid. */
export function recoverLayout(data: unknown) {
    let freshTerminals = 0, discardedTaskTerminals = 0;
    function walk(value: any, depth = 0): any {
        if (depth > 80 || value === null) return value;
        if (typeof value === 'string' && /^[\[{]/.test(value)) {
            try { return JSON.stringify(walk(JSON.parse(value), depth + 1)); } catch { return value; }
        }
        if (!value || typeof value !== 'object') return value;
        if (value.constructionOptions?.factoryId === 'terminal') {
            const options = value.constructionOptions.options || {};
            if (options.kind === 'task') { discardedTaskTerminals++; return undefined; }
            let state: any = {};
            try { state = JSON.parse(value.innerWidgetState || '{}'); } catch { /* Fresh interactive terminal. */ }
            delete state.terminalId;
            freshTerminals++;
            // Restore an interactive shell, never replay a command from a previous execution.
            return { ...value, constructionOptions: { ...value.constructionOptions, options: {
                created: options.created, cwd: options.cwd, shellPath: options.shellPath, shellArgs: [], kind: 'user'
            } }, innerWidgetState: JSON.stringify(state) };
        }
        if (Array.isArray(value)) return value.map(item => walk(item, depth + 1)).filter(item => item !== undefined);
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, depth + 1)]));
    }
    const value = walk(data);
    return { value, freshTerminals, discardedTaskTerminals };
}
