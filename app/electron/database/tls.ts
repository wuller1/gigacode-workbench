import { getCACertificates } from "node:tls";
/** Node 22.19+ exposes Windows/macOS system trust without disabling certificate checks. */
export function trustedCAs(extra?: string): string[] {
  return [
    ...new Set([
      ...getCACertificates("default"),
      ...getCACertificates("system"),
      ...(extra ? [extra] : []),
    ]),
  ];
}
