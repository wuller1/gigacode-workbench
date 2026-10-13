// Monaco version counters restart with the renderer; a revision must identify both lifetimes.
const lifetime = crypto.randomUUID();
export const revision = (version: number): string => `${lifetime}:${version}`;
