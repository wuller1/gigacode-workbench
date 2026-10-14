import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./Button.js";
import { Icon } from "./Icon.js";
import type { IconName } from "./Icon.js";
export interface TabItem { id: string; label: string; icon?: IconName; content: ReactNode; dirty?: boolean; disabled?: boolean; onClose?: () => void }
export interface TabsProps { label: string; items: readonly TabItem[]; activeId: string; onChange: (id: string) => void; keepMounted?: boolean; actions?: ReactNode }
export function Tabs({ label, items, activeId, onChange, keepMounted = false, actions }: TabsProps) {
  const prefix = useId(); const refs = useRef(new Map<string, HTMLButtonElement>());
  const keyFor = (id: string) => `${prefix}-${encodeURIComponent(id)}`;
  return <div className="gc-tabs"><div className="gc-tabs__header"><div className="gc-tabs__list" role="tablist" aria-label={label}>
    {items.map(item => <div className="gc-tabs__item" key={item.id} data-active={activeId === item.id || undefined}>
      <button type="button" role="tab" id={`${keyFor(item.id)}-tab`} aria-selected={item.id === activeId} aria-controls={`${keyFor(item.id)}-panel`} disabled={item.disabled} tabIndex={item.id === activeId ? 0 : -1} ref={element => { if (element) refs.current.set(item.id, element); else refs.current.delete(item.id); }} onClick={() => onChange(item.id)}
        onKeyDown={event => {
          const available = items.filter(value => !value.disabled); const index = available.findIndex(value => value.id === item.id);
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && available.length) { event.preventDefault(); const next = available[event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + available.length) % available.length]!; onChange(next.id); refs.current.get(next.id)?.focus(); }
          if (event.key === "Delete" && item.onClose) { event.preventDefault(); item.onClose(); }
        }}>
        {item.icon ? <Icon name={item.icon} /> : null}<span className="gc-truncate">{item.label}</span>{item.dirty ? <span className="gc-dirty" aria-label="Unsaved changes" /> : null}
      </button>{item.onClose ? <IconButton label={`Close ${item.label}${item.dirty ? ", unsaved changes" : ""}`} icon="close" variant="quiet" onClick={item.onClose} /> : null}
    </div>)}
  </div>{actions ? <div className="gc-tabs__actions">{actions}</div> : null}</div>
    {items.filter(item => keepMounted || item.id === activeId).map(item => <section key={item.id} role="tabpanel" id={`${keyFor(item.id)}-panel`} aria-labelledby={`${keyFor(item.id)}-tab`} hidden={item.id !== activeId} tabIndex={0} className="gc-tabs__panel">{item.content}</section>)}
  </div>;
}
export interface ActivityItem { id: string; label: string; icon: IconName; badge?: string; active?: boolean; disabled?: boolean }
export function ActivityRail({ items, onToggle, footer }: { items: readonly ActivityItem[]; onToggle: (id: string) => void; footer?: ReactNode }) {
  return <nav className="gc-activity" aria-label="Tool windows"><div>{items.map(item => <div className="gc-activity__item" key={item.id} data-active={item.active || undefined}><IconButton variant="quiet" icon={item.icon} label={item.label} title={item.label} aria-pressed={Boolean(item.active)} disabled={item.disabled} onClick={() => onToggle(item.id)} />{item.badge ? <span className="gc-activity__badge" aria-hidden="true">{item.badge}</span> : null}</div>)}</div>{footer ? <div className="gc-activity__footer">{footer}</div> : null}</nav>;
}
export interface TreeItem { id: string; label: string; icon?: IconName; children?: readonly TreeItem[]; gitState?: "modified" | "added" | "deleted" | "conflict" | "ignored"; disabled?: boolean }
export interface ResourceTreeProps { label: string; items: readonly TreeItem[]; expanded: ReadonlySet<string>; selectedId?: string; onExpand: (id: string, expanded: boolean) => void; onSelect: (id: string) => void; onOpen?: (id: string) => void }
/** Tree focus follows visible nodes. DOM windowing belongs to the file service, not this bounded tree. */
export function ResourceTree({ label, items, expanded, selectedId, onExpand, onSelect, onOpen }: ResourceTreeProps) {
  const root = useRef<HTMLUListElement>(null); const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);
  const visible: { item: TreeItem; parent?: string }[] = [];
  const flatten = (nodes: readonly TreeItem[], parent?: string) => { for (const item of nodes) { visible.push({ item, parent }); if (item.children && expanded.has(item.id)) flatten(item.children, item.id); } }; flatten(items);
  const focus = (id: string) => { setFocusedId(id); Array.from(root.current?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? []).find(element => element.dataset.nodeId === id)?.focus(); };
  const render = (nodes: readonly TreeItem[], depth = 1): ReactNode => nodes.map((item, i) => <li role="none" key={item.id}><div role="treeitem" aria-level={depth} aria-posinset={i + 1} aria-setsize={nodes.length} aria-selected={selectedId === item.id} aria-expanded={item.children ? expanded.has(item.id) : undefined} aria-disabled={item.disabled || undefined}
    tabIndex={item.id === (focusedId ?? visible[0]?.item.id) ? 0 : -1} data-node-id={item.id} data-git-state={item.gitState} className="gc-tree__item" style={{ paddingInlineStart: 8 + (depth - 1) * 14 }}
    onFocus={() => setFocusedId(item.id)} onClick={() => { if (!item.disabled) { onSelect(item.id); focus(item.id); } }} onDoubleClick={() => { if (!item.disabled) { if (item.children) onExpand(item.id, !expanded.has(item.id)); else onOpen?.(item.id); } }}
    onKeyDown={event => {
      const index = visible.findIndex(entry => entry.item.id === item.id); if (["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter", " "].includes(event.key)) event.preventDefault();
      if (event.key === "ArrowDown") focus(visible[Math.min(visible.length - 1, index + 1)]!.item.id);
      if (event.key === "ArrowUp") focus(visible[Math.max(0, index - 1)]!.item.id);
      if (event.key === "Home") focus(visible[0]!.item.id); if (event.key === "End") focus(visible[visible.length - 1]!.item.id);
      if (item.disabled) return;
      if (event.key === "ArrowRight" && item.children) { if (!expanded.has(item.id)) onExpand(item.id, true); else if (item.children[0]) focus(item.children[0].id); }
      if (event.key === "ArrowLeft") { if (item.children && expanded.has(item.id)) onExpand(item.id, false); else if (visible[index]?.parent) focus(visible[index]!.parent!); }
      if (event.key === " ") onSelect(item.id);
      if (event.key === "Enter") { onSelect(item.id); if (item.children) onExpand(item.id, !expanded.has(item.id)); else onOpen?.(item.id); }
    }}>
      <span className="gc-tree__expander" aria-hidden="true">{item.children ? <Icon name="chevron-down" className={expanded.has(item.id) ? "" : "gc-rotate-left"} /> : null}</span>{item.icon ? <Icon name={item.icon} /> : null}<span className="gc-truncate">{item.label}</span>{item.gitState ? <span className="gc-tree__state" aria-label={`Git ${item.gitState}`}>{({ modified: "M", added: "A", deleted: "D", conflict: "!", ignored: "·" })[item.gitState]}</span> : null}
    </div>{item.children && expanded.has(item.id) ? <ul role="group">{render(item.children, depth + 1)}</ul> : null}</li>);
  return <ul ref={root} role="tree" aria-label={label} className="gc-tree">{render(items)}</ul>;
}
export interface BreadcrumbItem { id: string; label: string; onClick?: () => void }
export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return <nav aria-label="Breadcrumb" className="gc-breadcrumbs"><ol>{items.map((item, i) => <li key={item.id}>{item.onClick ? <button type="button" onClick={item.onClick}>{item.label}</button> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>}</li>)}</ol></nav>;
}
