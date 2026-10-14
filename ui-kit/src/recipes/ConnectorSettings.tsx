import { useMemo } from "react";
import { Button } from "../components/Button.js";
import { ConnectorCard } from "../components/Enterprise.js";
import type { ConnectorCardProps } from "../components/Enterprise.js";
import { SearchField, Toolbar } from "../components/Layout.js";
import { EmptyState } from "../components/Feedback.js";
export interface ConnectorSettingsProps { connections: readonly (ConnectorCardProps & { id: string })[]; search: string; onSearch: (value: string) => void; onAdd: () => void }
export function ConnectorSettings({ connections, search, onSearch, onAdd }: ConnectorSettingsProps) {
  const filtered = useMemo(() => connections.filter(item => [item.name, item.kind, item.endpoint, ...(item.projectLabels ?? [])].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [connections, search]);
  return <section className="gc-connector-settings" aria-label="Connections"><Toolbar label="Connection commands" trailing={<Button icon="add" onClick={onAdd}>Add connection</Button>}><SearchField label="Search connections" value={search} onChange={onSearch} /></Toolbar><div className="gc-connector-settings__list">{filtered.length ? filtered.map(({ id, ...connection }) => <ConnectorCard {...connection} key={id} />) : <EmptyState title={search ? "No matching connections" : "No connections yet"} description={search ? "Try a name, address, type, or bound project." : "Add an MCP endpoint, then bind it to one or more projects."} action={!search ? <Button onClick={onAdd}>Add connection</Button> : undefined} />}</div></section>;
}
