import { useId } from "react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./Button.js";
import { Icon } from "./Icon.js";
import type { IconName } from "./Icon.js";
export type NoticeTone = "info" | "success" | "warning" | "danger";
export interface NoticeProps { title: string; children?: ReactNode; tone?: NoticeTone; actions?: ReactNode; onDismiss?: () => void; announce?: boolean }
export function Notice({ title, children, tone = "info", actions, onDismiss, announce = false }: NoticeProps) {
  const icon: Record<NoticeTone, IconName> = { info: "information", success: "check", warning: "warning", danger: "error" };
  return <section className={`gc-notice gc-notice--${tone}`} role={announce ? (tone === "danger" ? "alert" : "status") : undefined} aria-label={title}>
    <Icon name={icon[tone]} /><div className="gc-notice__body"><strong>{title}</strong>{children ? <div>{children}</div> : null}{actions ? <div className="gc-inline-actions">{actions}</div> : null}</div>
    {onDismiss ? <IconButton variant="quiet" icon="close" label="Dismiss notification" onClick={onDismiss} /> : null}
  </section>;
}
export interface EmptyStateProps { title: string; description?: string; icon?: IconName; action?: ReactNode; compact?: boolean }
export function EmptyState({ title, description, icon, action, compact }: EmptyStateProps) {
  return <div className={`gc-empty ${compact ? "gc-empty--compact" : ""}`}>
    {icon ? <Icon name={icon} /> : null}<strong>{title}</strong>{description ? <p>{description}</p> : null}{action}
  </div>;
}
export interface ErrorStateProps { title: string; message: string; onRetry?: () => void; detail?: string; retrying?: boolean }
export function ErrorState({ title, message, onRetry, detail, retrying }: ErrorStateProps) {
  return <Notice title={title} tone="danger" actions={onRetry ? <Button onClick={onRetry} loading={retrying}>Retry</Button> : undefined}>
    <p>{message}</p>{detail ? <details><summary>Technical detail</summary><pre className="gc-code">{detail}</pre></details> : null}
  </Notice>;
}
export interface ProgressProps { label: string; value?: number; max?: number; detail?: string; onCancel?: () => void }
export function Progress({ label, value, max = 100, detail, onCancel }: ProgressProps) {
  const id = useId(); const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = value === undefined || !Number.isFinite(value) ? undefined : Math.min(safeMax, Math.max(0, value));
  return <div className="gc-progress"><div className="gc-progress__label"><label id={id}>{label}</label>{detail ? <small>{detail}</small> : null}{onCancel ? <Button variant="quiet" onClick={onCancel}>Cancel</Button> : null}</div>
    <progress aria-labelledby={id} max={safeMax} value={safeValue} />
  </div>;
}
export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return <div className="gc-skeleton" role="status" aria-label={label}>{Array.from({ length: Math.min(12, Math.max(1, lines)) }, (_, i) => <span key={i} />)}</div>;
}
export interface KeyValueListProps { items: readonly { label: string; value: ReactNode; mono?: boolean }[] }
export function KeyValueList({ items }: KeyValueListProps) {
  return <dl className="gc-key-values">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd className={item.mono ? "gc-mono" : undefined}>{item.value}</dd></div>)}</dl>;
}
export interface EvidenceItem { id: string; title: string; detail?: string; state: "passed" | "failed" | "unverified"; onOpen?: () => void }
export function EvidenceList({ items }: { items: readonly EvidenceItem[] }) {
  return <ul className="gc-evidence">{items.map(item => <li key={item.id} data-state={item.state}>
    <Icon name={item.state === "passed" ? "check" : item.state === "failed" ? "error" : "information"} />
    <div>{item.onOpen ? <button className="gc-link" onClick={item.onOpen}>{item.title}</button> : <strong>{item.title}</strong>}{item.detail ? <small>{item.detail}</small> : null}</div><span className="gc-muted">{item.state}</span>
  </li>)}</ul>;
}
