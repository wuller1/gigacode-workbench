import { useId, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import { Button, IconButton } from "./Button.js";
import { Icon } from "./Icon.js";
import { Dialog } from "./Overlays.js";
import { SelectField } from "./Fields.js";
export type PlanState = "pending" | "current" | "complete" | "blocked" | "failed" | "skipped";
export interface PlanItem { id: string; label: string; state: PlanState; detail?: string; onOpen?: () => void }
export function TaskPlan({ items, label = "Agent plan", revision }: { items: readonly PlanItem[]; label?: string; revision?: number }) {
  return <section aria-label={label} className="gc-plan">{revision !== undefined ? <small className="gc-muted">Plan · revision {revision}</small> : null}<ol>{items.map((item, i) => <li key={item.id} data-state={item.state} aria-current={item.state === "current" ? "step" : undefined}>
    <span className="gc-plan__mark" aria-hidden="true">{item.state === "complete" ? <Icon name="check" /> : item.state === "current" ? <span className="gc-running-mark" /> : item.state === "blocked" || item.state === "failed" ? <Icon name="warning" /> : i + 1}</span>
    <div>{item.onOpen ? <button className="gc-link gc-plan__label" onClick={item.onOpen}>{item.label}</button> : <span className="gc-plan__label">{item.label}</span>}{item.detail ? <small>{item.detail}</small> : null}</div><span className="gc-visually-hidden">{item.state}</span>
  </li>)}</ol></section>;
}
export type AgentState = "idle" | "running" | "queued" | "waiting" | "retrying" | "completed" | "cancelled" | "failed" | "unknown";
export function AgentStatus({ state, label, detail }: { state: AgentState; label: string; detail?: string }) {
  return <span className="gc-agent-status" data-state={state}><span className={state === "running" || state === "retrying" ? "gc-running-mark" : "gc-agent-status__dot"} aria-hidden="true" /><span>{label}</span>{detail ? <small>{detail}</small> : null}</span>;
}
export interface AgentSession { id: string; title: string; state: AgentState; role?: string }
export function SessionList({ sessions, activeId, onSelect, actions }: { sessions: readonly AgentSession[]; activeId?: string; onSelect: (id: string) => void; actions?: (session: AgentSession) => ReactNode }) {
  return <nav className="gc-session-list" aria-label="Conversations">{sessions.map(session => <div key={session.id} data-active={session.id === activeId || undefined}><button type="button" onClick={() => onSelect(session.id)} aria-current={session.id === activeId ? "page" : undefined}><AgentStatus state={session.state} label={session.title} detail={session.role} /></button>{actions?.(session)}</div>)}</nav>;
}
export interface QueueItem { id: string; text: string; state?: "queued" | "dispatching" | "held"; error?: string }
export interface MessageQueueProps { items: readonly QueueItem[]; onSendNow: (id: string) => Promise<void>; onEdit: (id: string, text: string, expectedText: string) => Promise<void>; onRemove: (id: string) => Promise<void>; disabled?: boolean }
/** Send now is an explicit, always-visible command. Host decides interrupt vs safe boundary; component never replays a turn. */
export function MessageQueue({ items, onSendNow, onEdit, onRemove, disabled }: MessageQueueProps) {
  const editId = useId(); const [editing, setEditing] = useState<{ id: string; text: string; base: string }>(); const [pending, setPending] = useState<string>(); const pendingRef = useRef<string | undefined>(undefined); const [error, setError] = useState<string>();
  const action = async (id: string, task: () => Promise<void>) => { if (pendingRef.current || disabled) return; pendingRef.current = id; setPending(id); setError(undefined); try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Queue action failed; message retained."); } finally { pendingRef.current = undefined; setPending(undefined); } };
  if (!items.length) return null;
  return <section className="gc-message-queue" aria-label="Queued messages"><div className="gc-message-queue__title">Next messages <span>{items.length}</span></div><ol>{items.map(item => <li key={item.id} data-state={item.state ?? "queued"}>
    <div className="gc-message-queue__text">{item.text}</div><div className="gc-inline-actions"><Button variant="secondary" icon="send-now" disabled={disabled || Boolean(pending) || item.state === "dispatching"} loading={pending === item.id} onClick={() => void action(item.id, () => onSendNow(item.id))}>Send now</Button><IconButton icon="edit" label="Edit queued message" variant="quiet" disabled={disabled || Boolean(pending) || item.state === "dispatching"} onClick={() => { setError(undefined); setEditing({ id: item.id, text: item.text, base: item.text }); }} /><IconButton icon="close" label="Remove queued message" variant="quiet" disabled={disabled || Boolean(pending) || item.state === "dispatching"} onClick={() => void action(item.id, () => onRemove(item.id))} /></div>{item.error ? <small className="gc-field__error">{item.error}</small> : null}
  </li>)}</ol>{error ? <p role="alert" className="gc-field__error">{error}</p> : null}
    <Dialog open={Boolean(editing)} title="Edit queued message" onClose={() => { if (!pending) setEditing(undefined); }} actions={<><Button variant="quiet" disabled={Boolean(pending)} onClick={() => setEditing(undefined)}>Cancel</Button><Button variant="primary" disabled={Boolean(pending) || !editing?.text.trim()} onClick={() => { const current = editing; if (!current) return; void action(current.id, async () => { await onEdit(current.id, current.text, current.base); setEditing(undefined); }); }}>Save message</Button></>}>
      <label className="gc-field__label" htmlFor={editId}>Message</label><textarea id={editId} className="gc-input gc-textarea" rows={5} value={editing?.text ?? ""} disabled={Boolean(pending)} onChange={event => setEditing(current => current ? { ...current, text: event.target.value } : current)} />{error ? <p className="gc-field__error" role="alert">{error}</p> : null}
    </Dialog>
  </section>;
}
export interface ModelOption { id: string; label: string; reasoning: readonly string[]; detail?: string; disabled?: boolean }
export interface ModelPickerProps { models: readonly ModelOption[]; modelId: string; reasoning?: string; onChange: (modelId: string, reasoning?: string) => void; disabled?: boolean }
export function ModelPicker({ models, modelId, reasoning, onChange, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false); const [draftModel, setDraftModel] = useState(modelId); const [draftReason, setDraftReason] = useState(reasoning ?? "");
  const model = models.find(item => item.id === modelId); const draft = models.find(item => item.id === draftModel);
  return <><button type="button" className="gc-model-picker" disabled={disabled} aria-haspopup="dialog" onClick={() => { setDraftModel(modelId); setDraftReason(reasoning ?? model?.reasoning[0] ?? ""); setOpen(true); }} title="Model and reasoning"><span className="gc-truncate">{model?.label ?? modelId}</span>{reasoning ? <span className="gc-model-picker__reason">{reasoning}</span> : null}<Icon name="chevron-down" /></button>
    <Dialog open={open} title="Model and reasoning" onClose={() => setOpen(false)} actions={<><Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!draft || draft.disabled || Boolean(draft.reasoning.length && !draft.reasoning.includes(draftReason))} onClick={() => { onChange(draftModel, draft?.reasoning.length ? draftReason : undefined); setOpen(false); }}>Apply</Button></>}>
      <SelectField label="Model" value={draftModel} options={models.map(item => ({ value: item.id, label: item.label, disabled: item.disabled }))} hint={draft?.detail} onChange={event => { const next = models.find(item => item.id === event.target.value); setDraftModel(event.target.value); setDraftReason(next?.reasoning.includes(draftReason) ? draftReason : next?.reasoning[0] ?? ""); }} />
      {draft?.reasoning.length ? <div className="gc-model-picker__settings"><SelectField label="Reasoning depth" value={draftReason} options={draft.reasoning.map(value => ({ label: value, value }))} onChange={event => setDraftReason(event.target.value)} /></div> : <p className="gc-muted">This adapter does not advertise configurable reasoning.</p>}
    </Dialog>
  </>;
}
export function ContextRing({ used, limit, children }: { used?: number; limit?: number; children: ReactNode }) {
  const known = used !== undefined && limit !== undefined && Number.isFinite(used) && Number.isFinite(limit) && used >= 0 && limit > 0; const ratio = known ? Math.min(1, used / limit) : 0;
  const description = known ? `${Math.round(used).toLocaleString()} / ${Math.round(limit).toLocaleString()} context tokens; ${ratio >= .9 ? "high" : ratio >= .7 ? "elevated" : "normal"} usage` : "Context usage unavailable";
  return <span className="gc-context-ring" data-level={!known ? "unknown" : ratio >= .9 ? "danger" : ratio >= .7 ? "warning" : "normal"} style={{ "--gc-context": `${ratio * 360}deg` } as CSSProperties} title={description}>{children}<span className="gc-visually-hidden">{description}</span></span>;
}
export interface AgentComposerProps { value: string; onChange: (value: string) => void; onSend: () => void; onStop?: () => void; running?: boolean; disabled?: boolean; roleLabel: string; roleReason?: string; branch?: string; models: readonly ModelOption[]; modelId: string; reasoning?: string; onModelChange: (id: string, reasoning?: string) => void; contextUsed?: number; contextLimit?: number; attachments?: ReactNode; onAttach?: () => void; queue?: ReactNode; error?: string; placeholder?: string }
export function AgentComposer({ value, onChange, onSend, onStop, running, disabled, roleLabel, roleReason, branch, models, modelId, reasoning, onModelChange, contextUsed, contextLimit, attachments, onAttach, queue, error, placeholder = "Ask, build, or investigate…" }: AgentComposerProps) {
  const id = useId(); return <div className="gc-composer-region">{queue}<div className="gc-composer" data-running={running || undefined}>{attachments ? <div className="gc-composer__attachments">{attachments}</div> : null}<label htmlFor={id} className="gc-visually-hidden">Message to agent</label><textarea id={id} className="gc-composer__input" value={value} disabled={disabled} placeholder={placeholder} rows={3} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !disabled && value.trim()) { event.preventDefault(); onSend(); } }} />
    <div className="gc-composer__footer"><div className="gc-composer__left">{onAttach ? <IconButton icon="attach" label="Attach file" variant="quiet" disabled={disabled} onClick={onAttach} /> : null}{branch ? <span className="gc-composer__branch" title={branch}><Icon name="branch" /><span>{branch}</span></span> : null}</div><div className="gc-composer__right"><span className="gc-composer__role" title={roleReason ?? `Automatically selected role: ${roleLabel}`}>{roleLabel}</span><ModelPicker models={models} modelId={modelId} reasoning={reasoning} onChange={onModelChange} disabled={disabled} />{running && onStop ? <IconButton icon="stop" label="Stop agent" variant="quiet" disabled={disabled} onClick={onStop} /> : null}<ContextRing used={contextUsed} limit={contextLimit}><IconButton icon="send" label={running ? "Queue message" : "Send message"} variant="primary" disabled={disabled || !value.trim()} onClick={onSend} /></ContextRing></div></div>
  </div>{error ? <p role="alert" className="gc-field__error">{error}</p> : null}</div>;
}
export interface ToolActivityItem { id: string; label: string; state: "running" | "complete" | "failed" | "unknown"; detail?: string; output?: ReactNode }
export function ToolActivity({ items, label = "Tools and commands" }: { items: readonly ToolActivityItem[]; label?: string }) {
  return <details className="gc-tool-activity"><summary>{label}<span className="gc-muted">{items.length}</span></summary><ol>{items.map(item => <li key={item.id}><AgentStatus state={item.state === "complete" ? "completed" : item.state} label={item.label} detail={item.detail} />{item.output ? <div className="gc-tool-activity__output">{item.output}</div> : null}</li>)}</ol></details>;
}
