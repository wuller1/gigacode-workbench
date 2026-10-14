import path from "node:path";

export const APPLICATION_NAME = "GigaCode";

/** Keep an existing Workbench store; renaming the product must not hide history. */
export function applicationDataDirectory(input: {
  appData: string;
  previousDefault: string;
  override?: string;
  hasState(directory: string): boolean;
}): string {
  if (input.override) return path.resolve(input.override);
  const preferred = path.join(input.appData, APPLICATION_NAME);
  const candidates = [
    ...new Set([
      preferred,
      input.previousDefault,
      path.join(input.appData, "GigaCode Workbench"),
      path.join(input.appData, "gigacode-workbench-ui"),
    ]),
  ];
  // Never merge independent histories automatically. The new store wins when present.
  return candidates.find((candidate) => input.hasState(candidate)) || preferred;
}
