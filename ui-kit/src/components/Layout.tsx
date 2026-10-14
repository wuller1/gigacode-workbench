import { useId, useRef } from "react";
import type { ReactNode, CSSProperties } from "react";
import { IconButton } from "./Button.js";
import { Menu } from "./Overlays.js";
import type { MenuItem } from "./Overlays.js";
import { Icon } from "./Icon.js";
export interface ToolbarProps { label: string; children?: ReactNode; trailing?: ReactNode; compact?: boolean }
export function Toolbar({ label, children, trailing, compact }: ToolbarProps) {
  return <div className={`gc-toolbar ${compact ? "gc-toolbar--compact" : ""}`} role="group" aria-label={label}><div className="gc-toolbar__leading">{children}</div>{trailing ? <div className="gc-toolbar__trailing">{trailing}</div> : null}</div>;
}
export interface SearchFieldProps { label?: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }
export function SearchField({ label = "Search", value, onChange, placeholder = "Search…", disabled }: SearchFieldProps) {
  const id = useId(); return <div className="gc-search"><Icon name="search" /><label htmlFor={id} className="gc-visually-hidden">{label}</label><input type="search" id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} />{value ? <IconButton icon="close" label={`Clear ${label.toLowerCase()}`} variant="quiet" onClick={() => onChange("")} disabled={disabled} /> : null}</div>;
}
export interface FilterChip { id: string; label: string; onRemove?: () => void }
export function FilterBar({ filters, onClear, children }: { filters: readonly FilterChip[]; onClear?: () => void; children?: ReactNode }) {
  return <div className="gc-filter-bar" aria-label="Active filters">{children}{filters.map(filter => <span key={filter.id} className="gc-filter-chip"><span>{filter.label}</span>{filter.onRemove ? <IconButton icon="close" variant="quiet" label={`Remove filter ${filter.label}`} onClick={filter.onRemove} /> : null}</span>)}{filters.length && onClear ? <button type="button" className="gc-link" onClick={onClear}>Clear filters</button> : null}</div>;
}
export interface ToolPanelProps { title: string; children: ReactNode; actions?: ReactNode; onClose?: () => void; menu?: readonly MenuItem[]; hideHeader?: boolean; className?: string }
export function ToolPanel({ title, children, actions, onClose, menu, hideHeader = false, className = "" }: ToolPanelProps) {
  const id = useId(); return <section className={`gc-tool-panel ${className}`} aria-labelledby={hideHeader ? undefined : id} aria-label={hideHeader ? title : undefined}>{!hideHeader ? <header className="gc-tool-panel__header"><strong id={id} className="gc-truncate">{title}</strong><div className="gc-inline-actions">{actions}{menu ? <Menu label={`${title} actions`} items={menu} /> : null}{onClose ? <IconButton icon="close" label={`Close ${title}`} variant="quiet" onClick={onClose} /> : null}</div></header> : null}<div className="gc-tool-panel__body">{children}</div></section>;
}
export interface SplitPaneProps { first: ReactNode; second: ReactNode; value: number; onChange: (percent: number) => void; orientation?: "horizontal" | "vertical"; min?: number; max?: number; label: string; firstLabel?: string; secondLabel?: string }
export function SplitPane({ first, second, value, onChange, orientation = "horizontal", min = 20, max = 80, label, firstLabel, secondLabel }: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null); const drag = useRef<{ pointerId: number; position: number } | null>(null); const firstId = useId();
  const safeMin = Math.min(95, Math.max(5, min)); const safeMax = Math.max(safeMin, Math.min(95, max)); const safeValue = Math.max(safeMin, Math.min(safeMax, Number.isFinite(value) ? value : 50));
  const clamp = (number: number) => Math.max(safeMin, Math.min(safeMax, number));
  return <div ref={root} className={`gc-split gc-split--${orientation}`} style={{ "--gc-split": `${safeValue}%` } as CSSProperties}>
    <div id={firstId} className="gc-split__pane" aria-label={firstLabel}>{first}</div>
    <div className="gc-split__handle" role="separator" tabIndex={0} aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"} aria-label={label} aria-controls={firstId} aria-valuemin={safeMin} aria-valuemax={safeMax} aria-valuenow={Math.round(safeValue)}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, position: safeValue }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current?.pointerId !== event.pointerId || !root.current) return; const rect = root.current.getBoundingClientRect(); const size = orientation === "horizontal" ? rect.width : rect.height; if (size > 0) onChange(clamp(((orientation === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top) / size) * 100)); }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => { const decreases = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp"; const increases = orientation === "horizontal" ? "ArrowRight" : "ArrowDown"; if ([decreases, increases, "Home", "End"].includes(event.key)) { event.preventDefault(); onChange(event.key === "Home" ? safeMin : event.key === "End" ? safeMax : clamp(safeValue + (event.key === decreases ? -1 : 1) * (event.shiftKey ? 10 : 2))); } if (event.key === "Escape" && drag.current) { onChange(drag.current.position); drag.current = null; } }} />
    <div className="gc-split__pane" aria-label={secondLabel}>{second}</div>
  </div>;
}
export function WorkspaceShell({ rail, header, children }: { rail?: ReactNode; header?: ReactNode; children: ReactNode }) {
  return <div className="gc-workspace">{header ? <header className="gc-workspace__header">{header}</header> : null}<div className="gc-workspace__body">{rail}<main className="gc-workspace__main">{children}</main></div></div>;
}
