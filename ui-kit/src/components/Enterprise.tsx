import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./Button.js";
import { Dialog } from "./Overlays.js";
import { SearchField } from "./Layout.js";
import { StatusBadge } from "./StatusBadge.js";
import { KeyValueList } from "./Feedback.js";
import { SelectField } from "./Fields.js";
import type { IconName } from "./Icon.js";
import { Icon } from "./Icon.js";
export interface TargetOption { id: string; label: string; space?: string; environment?: string; connectionId: string; disabled?: boolean }
/** Identifiers are stable; DEV/IFT are user labels, not hard-coded environments. */
export function TargetPicker({ label, targets, value, onChange, disabled }: { label: string; targets: readonly TargetOption[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <SelectField label={label} value={value} disabled={disabled} options={targets.map(target => ({ value: target.id, label: [target.label, target.space, target.environment].filter(Boolean).join(" · "), disabled: target.disabled }))} onChange={event => onChange(event.target.value)} />;
}
export interface ConnectorCardProps { name: string; kind: string; endpoint: string; state: "connected" | "offline" | "checking" | "error" | "disabled"; projectLabels?: readonly string[]; credentialLabel?: string; detail?: string; onConfigure: () => void; onTest: () => void; onToggle?: () => void; busy?: boolean }
export function ConnectorCard({ name, kind, endpoint, state, projectLabels, credentialLabel, detail, onConfigure, onTest, onToggle, busy }: ConnectorCardProps) {
  const tone = state === "connected" ? "success" : state === "error" ? "danger" : state === "checking" ? "info" : "neutral";
  return <section className="gc-connector" aria-label={name}><div className="gc-connector__header"><div><strong>{name}</strong><small>{kind}</small></div><StatusBadge tone={tone}>{state}</StatusBadge></div><KeyValueList items={[{ label: "Address", value: endpoint, mono: true }, ...(credentialLabel ? [{ label: "Credential", value: credentialLabel }] : []), { label: "Projects", value: projectLabels?.length ? projectLabels.join(", ") : "Available to bind" }]} />{detail ? <p className="gc-muted">{detail}</p> : null}<div className="gc-inline-actions"><Button onClick={onConfigure}>Configure</Button><Button variant="quiet" onClick={onTest} loading={state === "checking" || busy} disabled={state === "disabled"}>Test connection</Button>{onToggle ? <Button variant="quiet" disabled={busy} onClick={onToggle}>{state === "disabled" ? "Enable" : "Disable"}</Button> : null}</div></section>;
}
export interface SettingsCategory { id: string; title: string; icon?: IconName; content: ReactNode }
export function SettingsLayout({ categories, selectedId, onSelect, search, onSearch, actions }: { categories: readonly SettingsCategory[]; selectedId: string; onSelect: (id: string) => void; search: string; onSearch: (value: string) => void; actions?: ReactNode }) {
  const selected = categories.find(category => category.id === selectedId);
  return <div className="gc-settings"><aside className="gc-settings__nav"><SearchField label="Search settings" value={search} onChange={onSearch} /><nav aria-label="Settings sections">{categories.map(category => <button type="button" key={category.id} aria-current={category.id === selectedId ? "page" : undefined} onClick={() => onSelect(category.id)}>{category.icon ? <Icon name={category.icon} /> : null}{category.title}</button>)}</nav></aside><section className="gc-settings__content" aria-label={selected?.title ?? "Settings"}>{selected?.content}</section>{actions ? <footer className="gc-settings__actions">{actions}</footer> : null}</div>;
}
export interface AuditEntry { id: string; time: string; actor: string; action: string; target: string; outcome: string; onOpen?: () => void }
export function AuditTrail({ entries }: { entries: readonly AuditEntry[] }) {
  return <ol className="gc-audit">{entries.map(entry => <li key={entry.id}><time dateTime={entry.time}>{entry.time}</time><div><strong>{entry.action}</strong><span>{entry.target}</span><small>{entry.actor} · {entry.outcome}</small></div>{entry.onOpen ? <IconButton variant="quiet" icon="chevron-right" label={`Open evidence for ${entry.action}`} onClick={entry.onOpen} /> : null}</li>)}</ol>;
}
export interface CommandItem { id: string; title: string; detail?: string; keywords?: readonly string[]; icon?: IconName; disabled?: boolean; onSelect: () => void }
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: readonly CommandItem[] }) {
  const [query, setQuery] = useState(""); const [index, setIndex] = useState(0); const root = useRef<HTMLDivElement>(null);
  const available = useMemo(() => commands.filter(command => [command.title, command.detail, ...(command.keywords ?? [])].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 40), [commands, query]);
  useEffect(() => { if (open) { setQuery(""); setIndex(0); } }, [open]);
  const execute = (item: CommandItem | undefined) => { if (item && !item.disabled) { onClose(); item.onSelect(); } };
  return <Dialog open={open} title="Find an action" onClose={onClose}><div className="gc-command-palette" ref={root} onKeyDown={event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = Math.max(0, Math.min(available.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))); setIndex(next); root.current?.querySelectorAll<HTMLElement>("[data-command]")[next]?.scrollIntoView({ block: "nearest" }); }
    if (event.key === "Enter") { event.preventDefault(); execute(available[index]); }
  }}><SearchField label="Find an action" value={query} onChange={value => { setQuery(value); setIndex(0); }} /><ul aria-label="Matching actions">{available.map((item, i) => <li key={item.id}><button type="button" data-command data-active={i === index || undefined} disabled={item.disabled} onFocus={() => setIndex(i)} onClick={() => execute(item)}>{item.icon ? <Icon name={item.icon} /> : null}<span><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span></button></li>)}</ul>{!available.length ? <p className="gc-muted">No matching actions</p> : null}</div></Dialog>;
}
export function ChangeReview({ open, title, target, summary, diff, evidence, busy, onApply, onClose, error }: { open: boolean; title: string; target: string; summary: string; diff: ReactNode; evidence?: ReactNode; busy?: boolean; onApply: () => void; onClose: () => void; error?: string }) {
  return <Dialog open={open} wide title={title} description={target} onClose={onClose} closeOnBackdrop={false} actions={<><Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={onApply}>Apply reviewed change</Button></>}><p>{summary}</p><div className="gc-change-review__diff">{diff}</div>{evidence}{error ? <p className="gc-field__error" role="alert">{error}</p> : null}</Dialog>;
}
