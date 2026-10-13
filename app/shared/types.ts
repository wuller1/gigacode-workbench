export type Status =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "cancelling"
  | "completed"
  | "failed"
  | "unknown";
export interface Project {
  id: string;
  name: string;
  path: string;
  archived?: boolean;
  createdAt: string;
}
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ToolCall {
  id: string;
  title: string;
  status: string;
  input?: unknown;
  output?: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  tools?: ToolCall[];
  elapsedMs?: number;
  outcome?: "completed" | "cancelled" | "unknown";
}
export interface QueueItem {
  id: string;
  text: string;
  createdAt: string;
}
export interface Todo {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}
export interface ConfigOption {
  id: string;
  name: string;
  category?: string;
  currentValue: string;
  options: { value: string; name: string }[];
}
export interface Session {
  id: string;
  taskId: string;
  title: string;
  profileId: string;
  profileReason?: string;
  profileConfidence?: number;
  model: string;
  reasoning: string;
  status: Status;
  messages: Message[];
  queue: QueueItem[];
  todos: Todo[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  unread?: boolean;
  parentId?: string;
  error?: string;
  context: { usedTokens?: number; limitTokens?: number; estimated?: boolean };
  configOptions?: ConfigOption[];
}
export interface Profile {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: boolean;
}
export interface Artifact {
  id: string;
  taskId: string;
  name: string;
  path: string;
  kind: string;
  createdAt: string;
}
export interface Question {
  id: string;
  sessionId: string;
  title: string;
  options: { id: string; label: string }[];
  kind: "permission" | "question";
  status: "pending" | "answered";
  answer?: string;
}
export interface Settings {
  cliPath: string;
  cliArgs: string[];
  model: string;
  reasoning: string;
  contextLimit: number;
  maxConcurrent: number;
  theme: "system" | "light" | "dark";
  reducedMotion: boolean;
  startupRetries: number;
  permissionMode: "auto_allow_bound" | "ask_each";
}
export interface AppState {
  schemaVersion: 1;
  revision: number;
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  profiles: Profile[];
  artifacts: Artifact[];
  questions: Question[];
  settings: Settings;
}
export interface HostEvent {
  type: string;
  payload: unknown;
  /** Main-process routing only; renderers never choose this value. */
  targetWindowId?: number;
}
export interface Bridge {
  invoke(method: string, params?: Record<string, unknown>): Promise<any>;
  subscribe(callback: (event: HostEvent) => void): () => void;
}
declare global {
  interface Window {
    workbench?: Bridge;
  }
}
