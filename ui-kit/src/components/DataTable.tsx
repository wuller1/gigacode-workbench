import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./Button.js";
import { EmptyState, ErrorState, Skeleton } from "./Feedback.js";

export interface EditableCellProps { value: string | null; label: string; onCommit: (value: string | null, previous: string | null) => Promise<void>; nullable?: boolean; disabled?: boolean }
/** No optimistic success: durable host commit/CAS must resolve before the editor closes. */
export function EditableCell({ value, label, onCommit, nullable = false, disabled }: EditableCellProps) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(value ?? ""); const [isNull, setNull] = useState(value === null); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const previous = useRef(value); const trigger = useRef<HTMLButtonElement>(null); const alive = useRef(true); const generation = useRef(0); const id = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const start = () => { if (disabled) return; previous.current = value; setDraft(value ?? ""); setNull(value === null); setError(undefined); setEditing(true); };
  const finish = () => { setEditing(false); queueMicrotask(() => trigger.current?.focus()); };
  const commit = async () => {
    if (busy) return; if (value !== previous.current) { setError("Value changed externally. Copy your edit, then cancel and reopen."); return; }
    const next = nullable && isNull ? null : draft; if (next === previous.current) { finish(); return; }
    setBusy(true); setError(undefined); const current = ++generation.current;
    try { await onCommit(next, previous.current); if (alive.current && generation.current === current) finish(); }
    catch (reason) { if (alive.current && generation.current === current) setError(reason instanceof Error ? reason.message : "Save failed. Your edit is retained."); }
    finally { if (alive.current && generation.current === current) setBusy(false); }
  };
  if (!editing) return <button type="button" className="gc-cell-value" ref={trigger} disabled={disabled} aria-label={`${label}: ${value === null ? "NULL" : value === "" ? "empty string" : value}. Edit`} onClick={start}><DataValue value={value} /></button>;
  return <div className="gc-cell-editor" aria-busy={busy}>
    <input className="gc-input" autoFocus aria-label={label} value={draft} disabled={busy || isNull} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void commit(); } if (event.key === "Escape" && !busy) { event.preventDefault(); finish(); } }} />
    {nullable ? <label className="gc-cell-editor__null"><input type="checkbox" checked={isNull} disabled={busy} onChange={event => setNull(event.target.checked)} />NULL</label> : null}
    <IconButton icon="check" label={`Save ${label}`} loading={busy} disabled={busy} onClick={() => void commit()} /><IconButton icon="close" label={`Cancel editing ${label}`} variant="quiet" disabled={busy} onClick={finish} />
    {error ? <small id={`${id}-error`} role="alert" className="gc-field__error">{error}</small> : null}
  </div>;
}
export function DataValue({ value }: { value: unknown }) {
  if (value === null) return <span className="gc-null">NULL</span>;
  if (value === undefined) return <span className="gc-null" title="Not returned by the source">Unavailable</span>;
  if (value === "") return <span className="gc-null" title="Empty string">''</span>;
  if (typeof value === "boolean") return <span>{String(value)}</span>;
  return <span>{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>;
}
export interface TableColumn<Row> { id: string; label: string; width?: number; align?: "start" | "end"; mono?: boolean; sortable?: boolean; render: (row: Row) => ReactNode }
export interface DataTableProps<Row> { label: string; rows: readonly Row[]; columns: readonly TableColumn<Row>[]; rowId: (row: Row) => string; selectedIds?: ReadonlySet<string>; onSelect?: (id: string, selected: boolean) => void; sort?: { columnId: string; direction: "ascending" | "descending" }; onSort?: (columnId: string) => void; loading?: boolean; error?: string; onRetry?: () => void; emptyTitle?: string; emptyDescription?: string; caption?: string; maxRenderedRows?: number }
/** Native table, bounded DOM. Parent owns server-side sort/page; never silently imports a whole dataset. */
export function DataTable<Row>({ label, rows, columns, rowId, selectedIds, onSelect, sort, onSort, loading, error, onRetry, emptyTitle = "No results", emptyDescription, caption, maxRenderedRows = 200 }: DataTableProps<Row>) {
  const limit = Math.max(1, Math.min(1000, Number.isFinite(maxRenderedRows) ? Math.floor(maxRenderedRows) : 200));
  if (error) return <ErrorState title="Unable to load data" message={error} onRetry={onRetry} />;
  if (loading && !rows.length) return <Skeleton label={`Loading ${label}`} lines={6} />;
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  return <div className="gc-table-wrap" tabIndex={0} role="region" aria-label={label} aria-busy={loading || undefined}>
    <table className="gc-table"><caption className={caption ? undefined : "gc-visually-hidden"}>{caption ?? label}</caption><colgroup>{onSelect ? <col style={{ width: 36 }} /> : null}{columns.map(column => <col key={column.id} style={column.width ? { width: column.width } : undefined} />)}</colgroup><thead><tr>
      {onSelect ? <th scope="col"><span className="gc-visually-hidden">Select row</span></th> : null}{columns.map(column => <th key={column.id} scope="col" aria-sort={sort?.columnId === column.id ? sort.direction : undefined} style={{ textAlign: column.align ?? "start" }}>
        {column.sortable && onSort ? <button type="button" onClick={() => onSort(column.id)}>{column.label}<span aria-hidden="true">{sort?.columnId === column.id ? sort.direction === "ascending" ? " ↑" : " ↓" : " ↕"}</span></button> : column.label}
      </th>)}
    </tr></thead><tbody>{rows.slice(0, limit).map(row => { const id = rowId(row); return <tr key={id} data-selected={selectedIds?.has(id) || undefined}>
      {onSelect ? <td><input className="gc-checkbox" type="checkbox" checked={selectedIds?.has(id) ?? false} aria-label={`Select row ${id}`} onChange={event => onSelect(id, event.target.checked)} /></td> : null}
      {columns.map(column => <td key={column.id} className={column.mono ? "gc-mono" : undefined} style={{ textAlign: column.align ?? "start" }}>{column.render(row)}</td>)}
    </tr>; })}</tbody></table>
    {rows.length > limit ? <p className="gc-table__bounded" role="status">Showing {limit} of {rows.length} supplied rows. Use server paging or a virtualized provider for the rest.</p> : null}
  </div>;
}
export interface PaginationProps { page: number; pageCount?: number; pageSize: number; pageSizes?: readonly number[]; total?: number; hasNext?: boolean; busy?: boolean; onPage: (page: number) => void; onPageSize: (size: number) => void }
export function Pagination({ page, pageCount, pageSize, pageSizes = [25, 50, 100, 200], total, hasNext, busy, onPage, onPageSize }: PaginationProps) {
  const first = total === 0 ? 0 : page * pageSize + 1; const last = total === undefined ? (page + 1) * pageSize : Math.min(total, (page + 1) * pageSize);
  return <nav className="gc-pagination" aria-label="Results pages"><span className="gc-muted">{total === undefined ? `Page ${page + 1}` : `${first}–${last} of ${total}`}</span>
    <label><span className="gc-visually-hidden">Rows per page</span><select className="gc-input" value={pageSize} disabled={busy} onChange={event => onPageSize(Number(event.target.value))}>{pageSizes.map(size => <option value={size} key={size}>{size} / page</option>)}</select></label>
    <IconButton icon="chevron-left" label="Previous page" variant="quiet" disabled={busy || page <= 0} onClick={() => onPage(Math.max(0, page - 1))} /><span>{page + 1}{pageCount !== undefined ? ` / ${Math.max(1, pageCount)}` : ""}</span><IconButton icon="chevron-right" label="Next page" variant="quiet" disabled={busy || (pageCount !== undefined ? page + 1 >= pageCount : !hasNext)} onClick={() => onPage(page + 1)} />
  </nav>;
}
export interface ResultsFrameProps { toolbar?: ReactNode; children: ReactNode; pagination?: ReactNode; stale?: boolean; unsavedCount?: number; onSubmit?: () => void; onRevert?: () => void; busy?: boolean }
export function ResultsFrame({ toolbar, children, pagination, stale, unsavedCount = 0, onSubmit, onRevert, busy }: ResultsFrameProps) {
  return <section className="gc-results" aria-label="Query results">{toolbar}{stale ? <div className="gc-inline-warning" role="status">Previous result retained; latest request has not succeeded.</div> : null}{children}{unsavedCount > 0 ? <div className="gc-results__changes"><span>{unsavedCount} pending changes</span><Button variant="quiet" disabled={busy || !onRevert} onClick={onRevert}>Revert</Button><Button variant="primary" loading={busy} disabled={!onSubmit} onClick={onSubmit}>Submit changes</Button></div> : null}{pagination}</section>;
}
