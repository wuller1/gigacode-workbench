import type { ReactNode } from "react";
import { Button, IconButton } from "../components/Button.js";
import { Toolbar, SplitPane } from "../components/Layout.js";
import { Tabs } from "../components/Navigation.js";
import type { TabItem } from "../components/Navigation.js";
import { DataTable, ResultsFrame } from "../components/DataTable.js";
import type { DataTableProps } from "../components/DataTable.js";
export interface DesktopDataWorkspaceProps<Row> { targetLabel: string; editor: ReactNode; running: boolean; onExecute: () => void; onCancel: () => void; onFormat: () => void; disabled?: boolean; result: DataTableProps<Row>; resultTabs?: readonly TabItem[]; activeResultTab: string; onResultTab: (id: string) => void; pagination?: ReactNode; split: number; onSplit: (value: number) => void; stale?: boolean; editorActions?: ReactNode; resultActions?: ReactNode }
/** Real state and editor supplied by host. No hidden demo DB or implicit query execution. */
export function DesktopDataWorkspace<Row>({ targetLabel, editor, running, onExecute, onCancel, onFormat, disabled, result, resultTabs = [], activeResultTab, onResultTab, pagination, split, onSplit, stale, editorActions, resultActions }: DesktopDataWorkspaceProps<Row>) {
  return <div className="gc-data-workspace"><Toolbar label="Query commands" trailing={editorActions}>
    {running ? <Button icon="stop" onClick={onCancel} disabled={disabled}>Cancel query</Button> : <Button variant="primary" icon="send-now" onClick={onExecute} disabled={disabled}>Execute</Button>}
    <IconButton variant="quiet" icon="format" label="Format SQL" title="Format SQL without executing" onClick={onFormat} disabled={disabled || running} /><span className="gc-data-workspace__target" title={targetLabel}>{targetLabel}</span>
  </Toolbar><div className="gc-data-workspace__body"><SplitPane label="Resize query editor and results" orientation="vertical" value={split} min={20} max={75} onChange={onSplit} first={editor} second={<Tabs label="Query output" activeId={activeResultTab} onChange={onResultTab} actions={resultActions} items={[{ id: "data", label: "Data", content: <ResultsFrame stale={stale} pagination={pagination}><DataTable {...result} /></ResultsFrame> }, ...resultTabs]} />} /></div></div>;
}
