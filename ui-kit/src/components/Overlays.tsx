import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cloneElement } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./Button.js";
import { Icon } from "./Icon.js";
import type { IconName } from "./Icon.js";

export interface DialogProps { open: boolean; title: string; description?: string; children: ReactNode; actions?: ReactNode; onClose: () => void; closeLabel?: string; wide?: boolean; closeOnBackdrop?: boolean }
/** Native modal supplies top-layer focus containment. Host still owns durable confirmation and dismissal. */
export function Dialog({ open, title, description, children, actions, onClose, closeLabel = "Close dialog", wide, closeOnBackdrop = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId(); const descriptionId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return createPortal(<dialog ref={ref} className={`gc-dialog ${wide ? "gc-dialog--wide" : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onClick={event => { if (closeOnBackdrop && event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header className="gc-dialog__header"><h2 id={titleId}>{title}</h2><IconButton variant="quiet" icon="close" label={closeLabel} onClick={onClose} /></header>
    {description ? <p id={descriptionId} className="gc-dialog__description">{description}</p> : null}<div className="gc-dialog__body">{children}</div>{actions ? <footer className="gc-dialog__actions">{actions}</footer> : null}
  </dialog>, document.body);
}
export interface MenuItem { id: string; label: string; icon?: IconName; shortcut?: string; disabled?: boolean; danger?: boolean; onSelect: () => void }
export interface MenuProps { label: string; items: readonly MenuItem[]; icon?: IconName; align?: "start" | "end" }
export function Menu({ label, items, icon = "more", align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); const id = useId();
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const listener = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", listener);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => document.removeEventListener("pointerdown", listener);
  }, [open]);
  return <div className="gc-menu-root" ref={root}>
    <IconButton ref={trigger} icon={icon} variant="quiet" label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }} />
    {open ? <div id={id} ref={menu} className={`gc-menu gc-menu--${align}`} role="menu" aria-label={label}
      onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={event => {
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []); const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && buttons.length) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
        if (event.key === "Tab") setOpen(false);
        if (event.key.length === 1 && /\S/.test(event.key)) buttons.find((button, i) => i > index && button.textContent?.toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
      }}>
      {items.map(item => <button type="button" key={item.id} role="menuitem" disabled={item.disabled} data-danger={item.danger || undefined} onClick={() => { close(); item.onSelect(); }}>
        {item.icon ? <Icon name={item.icon} /> : <span className="gc-menu__placeholder" />}<span>{item.label}</span>{item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
      </button>)}
    </div> : null}
  </div>;
}
export interface TooltipProps { content: string; children: ReactElement<{ "aria-describedby"?: string }>; side?: "top" | "bottom" }
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const id = useId(); const [visible, setVisible] = useState(false);
  return <span className={`gc-tooltip-root gc-tooltip-root--${side}`} onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)} onFocus={() => setVisible(true)} onBlur={() => setVisible(false)} onKeyDown={event => { if (event.key === "Escape") setVisible(false); }}>
    {cloneElement(children, { "aria-describedby": visible ? [children.props["aria-describedby"], id].filter(Boolean).join(" ") : children.props["aria-describedby"] })}
    {visible ? <span className="gc-tooltip" id={id} role="tooltip">{content}</span> : null}
  </span>;
}
export interface QuestionChoice { id: string; label: string; description?: string }
export interface QuestionItem { id: string; title: string; description?: string; choices: readonly QuestionChoice[]; allowCustom?: boolean }
export interface QuestionAnswer { questionId: string; choiceId?: string; custom?: string }
export interface QuestionFlowProps { open: boolean; questions: readonly QuestionItem[]; answers: readonly QuestionAnswer[]; index: number; onIndexChange: (index: number) => void; onAnswer: (answer: QuestionAnswer) => void; onSubmit: () => void; onClose: () => void; busy?: boolean; error?: string }
/** One question per view; callers retain answers and persist submission before dismissing. */
export function QuestionFlow({ open, questions, answers, index, onIndexChange, onAnswer, onSubmit, onClose, busy, error }: QuestionFlowProps) {
  const question = questions[index]; const answer = answers.find(value => value.questionId === question?.id); const fieldId = useId();
  const answered = (item: QuestionItem) => answers.some(value => value.questionId === item.id && (item.choices.some(choice => choice.id === value.choiceId) || (item.allowCustom !== false && Boolean(value.custom?.trim()))));
  if (!question) return null;
  return <Dialog open={open} title={question.title} description={question.description} onClose={onClose} closeOnBackdrop={false} actions={<>
    <span className="gc-muted">{index + 1} / {questions.length}</span><Button variant="quiet" disabled={busy || index === 0} onClick={() => onIndexChange(index - 1)}>Back</Button>
    <Button variant="primary" loading={busy} disabled={!answered(question) || (index === questions.length - 1 && !questions.every(answered))} onClick={() => index < questions.length - 1 ? onIndexChange(index + 1) : onSubmit()}>{index < questions.length - 1 ? "Next" : "Confirm answers"}</Button>
  </>}>
    <fieldset className="gc-choices" disabled={busy}><legend className="gc-visually-hidden">Answer</legend>{question.choices.map(choice => <label key={choice.id} className="gc-choice"><input type="radio" name={question.id} checked={answer?.choiceId === choice.id} onChange={() => onAnswer({ questionId: question.id, choiceId: choice.id })} /><span><strong>{choice.label}</strong>{choice.description ? <small>{choice.description}</small> : null}</span></label>)}
      {question.allowCustom !== false ? <><label htmlFor={fieldId} className="gc-field__label">Your answer</label><textarea id={fieldId} className="gc-input gc-textarea" rows={3} value={answer?.custom ?? ""} onChange={event => onAnswer({ questionId: question.id, custom: event.target.value })} /></> : null}
    </fieldset>{error ? <p role="alert" className="gc-field__error">{error}</p> : null}
  </Dialog>;
}
