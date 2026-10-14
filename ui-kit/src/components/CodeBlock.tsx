import type { ReactNode } from "react";
import { IconButton } from "./Button.js";
export type SyntaxToken = "plain" | "keyword" | "string" | "number" | "comment" | "function" | "type" | "operator" | "error";
export interface CodeSegment { text: string; token?: SyntaxToken }
/** Render tokens from the consumer's real parser. React text nodes never execute markup or log HTML. */
export function CodeBlock({ label, lines, onCopy, actions, wrap = false }: { label: string; lines: readonly (readonly CodeSegment[])[]; onCopy?: () => void; actions?: ReactNode; wrap?: boolean }) {
  return <section className="gc-code-block" aria-label={label}><header><span>{label}</span>{actions}{onCopy ? <IconButton icon="copy" label={`Copy ${label}`} variant="quiet" onClick={onCopy} /> : null}</header><pre className={wrap ? "gc-code-block__wrap" : undefined} tabIndex={0}><code>{lines.map((line, i) => <span className="gc-code-line" key={i}><span className="gc-code-line__number" aria-hidden="true">{i + 1}</span><span>{line.map((segment, j) => <span key={j} data-token={segment.token ?? "plain"}>{segment.text}</span>)}{"\n"}</span></span>)}</code></pre></section>;
}
