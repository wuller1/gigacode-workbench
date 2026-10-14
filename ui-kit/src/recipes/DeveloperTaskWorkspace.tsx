import type { ReactNode } from "react";
import { AgentComposer, TaskPlan, ToolActivity } from "../components/AgentWorkspace.js";
import type { AgentComposerProps, PlanItem, ToolActivityItem } from "../components/AgentWorkspace.js";
import { SplitPane, ToolPanel } from "../components/Layout.js";
import { Tabs } from "../components/Navigation.js";
import type { TabItem } from "../components/Navigation.js";
export interface DeveloperTaskWorkspaceProps { chat: ReactNode; composer: AgentComposerProps; tools: readonly TabItem[]; activeTool: string; onToolChange: (id: string) => void; split: number; onSplit: (percent: number) => void; plan?: readonly PlanItem[]; activity?: readonly ToolActivityItem[]; chatVisible?: boolean }
/** Thin composition over the existing project/task/session owner; never creates a second controller. */
export function DeveloperTaskWorkspace({ chat, composer, tools, activeTool, onToolChange, split, onSplit, plan, activity, chatVisible = true }: DeveloperTaskWorkspaceProps) {
  const toolSurface = <Tabs label="Task tools" items={tools} activeId={activeTool} onChange={onToolChange} keepMounted />;
  if (!chatVisible) return toolSurface;
  const chatSurface = <ToolPanel title="Agent conversation" hideHeader><div className="gc-task-workspace__chat"><div className="gc-task-workspace__history">{chat}{plan ? <TaskPlan items={plan} /> : null}{activity?.length ? <ToolActivity items={activity} /> : null}</div><AgentComposer {...composer} /></div></ToolPanel>;
  return <SplitPane label="Resize chat and tools" value={split} onChange={onSplit} min={25} max={70} first={chatSurface} second={toolSurface} />;
}
