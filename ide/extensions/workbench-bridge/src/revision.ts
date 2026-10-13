// A version counter can restart when a model is closed/reopened or its renderer is replaced.
const lifetimes = new WeakMap<object, string>();
export const revision = (document: { version: number }): string => {
    let lifetime = lifetimes.get(document);
    if (!lifetime) { lifetime = crypto.randomUUID(); lifetimes.set(document, lifetime); }
    return `${lifetime}:${document.version}`;
};
