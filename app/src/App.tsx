import { prepareWindowClose } from "./window-close";
import { QueueMessages } from "./QueueMessages";
import { ModelPicker, ContextSend } from "./ModelPicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  Question,
  Session,
  Task,
  ToolCall,
} from "../shared/types";
import {
  busy,
  call,
  errorText,
  statusLabel,
  useSnapshot,
  useStored,
  type Invoke,
} from "./api";
import {
  DialogProvider,
  Empty,
  Icon,
  IconButton,
  LayerProvider,
  Markdown,
  Menu,
  Modal,
  Status,
  useAsk,
  useLayer,
} from "./ui";
import type { OpsPanelProps } from "./ops-ui";
import { Workspace, type PanelId } from "./Workspace";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  elapsedLabel,
  profileName,
  shortToolTitle,
  toolComplete,
  toolFailed,
  toolRunning,
  toolStatus,
} from "./labels";
import { SettingsView } from "./SettingsView";

type Attachment = { path: string; name: string };
type Draft = { text: string; attachments: Attachment[] };
const emptyDraft: Draft = { text: "", attachments: [] };
export default function App() {
  return (
    <ErrorBoundary>
      <LayerProvider>
        <DialogProvider>
          <Application />
        </DialogProvider>
      </LayerProvider>
    </ErrorBoundary>
  );
}
function Application() {
  const { state, error, refresh } = useSnapshot();
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false),
    [settingsSection, setSettingsSection] = useState("general"),
    [search, setSearch] = useState(false),
    [archive, setArchive] = useState(false),
    [sidebar, setSidebar] = useStored("workbench.sidebar", true),
    [selection, setSelection] = useStored<{
      projectId?: string;
      taskId?: string;
      sessionId?: string;
    }>("workbench.selection", {}),
    [drafts, setDrafts] = useStored<Record<string, Draft>>(
      "workbench.drafts.v1",
      {},
    ),
    [requested, setRequested] = useState<{
      id: PanelId | "chat";
      nonce: number;
    }>(),
    [requestedOps, setRequestedOps] = useState<OpsPanelProps["reveal"]>(),
    [requestedArtifact, setRequestedArtifact] = useState<{
      id: string;
      nonce: number;
    }>();
  const panelRequestNonce = useRef(0);
  const ask = useAsk();
  const run: Invoke = useCallback(async (method, params = {}) => {
    try {
      const result = await call(method, params);
      return result === undefined ? null : result;
    } catch (e) {
      setNotice(errorText(e));
      return undefined;
    }
  }, []);
  useEffect(() => {
    const f = (e: Event) => setNotice((e as CustomEvent<string>).detail);
    window.addEventListener("workbench-error", f);
    return () => window.removeEventListener("workbench-error", f);
  }, []);
  useEffect(
    () =>
      window.workbench?.subscribe((event) => {
        if (event.type === "window.closeSettled") document.body.inert = false;
        if (
          event.type === "window.closeSettled" &&
          (event.payload as any)?.error
        )
          setNotice("Окно осталось открытым: " + (event.payload as any).error);
        if (event.type !== "window.prepareClose") return;
        document.body.inert = true;
        const requestId = (event.payload as { requestId: string }).requestId;
        void prepareWindowClose()
          .then(
            () =>
              window.workbench!.invoke("window.readyToClose", { requestId }),
            (error) => {
              setNotice("Окно осталось открытым: " + errorText(error));
              return window.workbench!.invoke("window.readyToClose", {
                requestId,
                error: errorText(error),
              });
            },
          )
          .catch((error) => setNotice(errorText(error)));
      }),
    [],
  );
  const activeTask = state?.tasks.find(
    (t) => t.id === selection.taskId && !t.archived,
  );
  const project = state?.projects.find(
    (p) =>
      p.id === (activeTask?.projectId || selection.projectId) && !p.archived,
  );
  const sessions =
    state?.sessions.filter((s) => s.taskId === activeTask?.id && !s.archived) ||
    [];
  const session =
    sessions.find((s) => s.id === selection.sessionId) ||
    sessions.find((s) => !s.parentId) ||
    sessions[0];
  useEffect(() => {
    if (session?.id) void run("session.attach", { id: session.id });
  }, [session?.id, run]);
  useEffect(
    () =>
      window.workbench?.subscribe((event) => {
        if (
          ["ide.reveal", "database.reveal", "ops.reveal"].includes(
            event.type,
          ) &&
          (event.payload as any).projectId === project?.id
        ) {
          if (event.type === "ops.reveal")
            setRequestedOps({
              nonce: ++panelRequestNonce.current,
              payload: event.payload as any,
            });
          setRequested({
            id:
              event.type === "ops.reveal"
                ? (event.payload as any).kind === "jenkins"
                  ? "jenkins"
                  : "cluster"
                : event.type === "database.reveal"
                  ? "data"
                  : "files",
            nonce: ++panelRequestNonce.current,
          });
        }
      }),
    [project?.id],
  );
  const selectedSessionId = session?.id;
  const draftKey = selectedSessionId || `project:${project?.id || "none"}`;
  const draft = drafts[draftKey] || emptyDraft;
  const setDraft = (next: Draft | ((old: Draft) => Draft)) =>
    setDrafts((old) => ({
      ...old,
      [draftKey]:
        typeof next === "function" ? next(old[draftKey] || emptyDraft) : next,
    }));
  useEffect(() => {
    if (!state) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const set = () => {
      document.documentElement.dataset.theme =
        state.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : state.settings.theme;
      document.documentElement.dataset.motion = state.settings.reducedMotion
        ? "reduced"
        : "full";
    };
    set();
    media.addEventListener("change", set);
    return () => media.removeEventListener("change", set);
  }, [state?.settings.theme, state?.settings.reducedMotion]);
  useEffect(() => {
    const seen = () => {
      if (session?.unread && document.visibilityState === "visible")
        void run("session.update", { id: session.id, unread: false });
    };
    seen();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [session?.id, session?.unread, run]);
  const selectTask = (task: Task) => {
    const s =
      state?.sessions.find(
        (s) => s.taskId === task.id && !s.parentId && !s.archived,
      ) || state?.sessions.find((s) => s.taskId === task.id && !s.archived);
    setSelection({
      projectId: task.projectId,
      taskId: task.id,
      sessionId: s?.id,
    });
  };
  const selectSession = (id: string) => {
    const s = state?.sessions.find((s) => s.id === id),
      t = state?.tasks.find((t) => t.id === s?.taskId);
    if (t)
      setSelection({ projectId: t.projectId, taskId: t.id, sessionId: id });
  };
  const chooseProject = async () => {
    const p = await run("app.chooseProject");
    if (p?.id) {
      setSelection({ projectId: p.id });
      void refresh();
    }
  };
  const chooseProjectPath = async () => {
    const input = await ask("Указать путь к проекту", {
      message: "Вставьте полный путь к существующей папке проекта.",
    });
    if (!input) return;
    let path = input.trim();
    if (path.startsWith('\"') && path.endsWith('\"')) path = path.slice(1, -1);
    const name =
      path
        .replace(/[\\\/]+$/, "")
        .split(/[\\\/]/)
        .filter(Boolean)
        .at(-1) || "Проект";
    const p = await run("project.create", { name, path });
    if (p?.id) {
      setSelection({ projectId: p.id });
      void refresh();
    }
  };
  const newTask = useCallback(
    async (projectId?: string, text?: string) => {
      if (!projectId) {
        setNotice("Сначала откройте папку проекта.");
        return;
      }
      const t = await run("task.create", { projectId, title: "Новая задача" });
      if (!t?.id) return;
      const s = await run("session.create", {
        taskId: t.id,
        title: "Новый разговор",
      });
      setSelection({ projectId, taskId: t.id, sessionId: s?.id });
      if (text && s?.id)
        setDrafts((old) => ({ ...old, [s.id]: { text, attachments: [] } }));
      void refresh();
    },
    [run, refresh, setSelection, setDrafts],
  );
  const createSession = async () => {
    if (!activeTask) return;
    const s = await run("session.create", {
      taskId: activeTask.id,
      title: "Новый разговор",
    });
    if (s?.id) {
      selectSession(s.id);
      setSelection({
        projectId: activeTask.projectId,
        taskId: activeTask.id,
        sessionId: s.id,
      });
      void refresh();
    }
  };
  const openPanel = (id: PanelId) =>
    setRequested({ id, nonce: ++panelRequestNonce.current });
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".xterm-host,.file-editor"))
        return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void newTask(project?.id);
      }
      if (e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [newTask, project?.id]);
  const rename = async (kind: string, id: string, title: string) => {
    const name = await ask("Новое название", { value: title });
    if (name?.trim())
      await run(`${kind}.update`, {
        id,
        [kind === "project" ? "name" : "title"]: name.trim(),
      });
  };
  const remove = async (kind: string, id: string, label: string) => {
    if (
      await ask(`Удалить «${label}»?`, {
        message:
          "Удалится запись и связанная история в приложении. Исходные файлы проекта останутся на диске.",
        confirm: true,
      })
    )
      await run(`${kind}.delete`, { id });
  };
  const taskStatus = (taskId: string) => {
    const all =
      state?.sessions.filter((s) => s.taskId === taskId && !s.archived) || [];
    return (
      all.find((s) => busy(s.status))?.status ||
      all.find((s) => s.status === "unknown")?.status ||
      all.find((s) => s.status === "failed")?.status ||
      (all.length &&
      all.every((s) => s.status === "completed" && !s.queue.length)
        ? "completed"
        : "idle")
    );
  };
  const assist = async (text: string) => {
    if (session)
      setDraft((old) => ({
        ...old,
        text: old.text.trim() ? old.text + "\n\n" + text : text,
      }));
    else await newTask(project?.id, text);
    setRequested({ id: "chat", nonce: ++panelRequestNonce.current });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(".composer textarea")
        ?.focus(),
    );
  };
  if (!state)
    return (
      <div className="startup">
        <span className="brand-mark brand-mark-large" aria-hidden="true" />
        <h1>GigaCode Workbench</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void refresh()}>Попробовать снова</button>
          </>
        ) : (
          <p>Открываем рабочее пространство…</p>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <header className="window-chrome">
        <div className="chrome-left">
          <IconButton
            icon="panel-left"
            label={sidebar ? "Скрыть проекты" : "Показать проекты"}
            onClick={() => setSidebar(!sidebar)}
          />
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">
            GigaCode <span>Workbench</span>
          </span>
        </div>
        <div className="chrome-context">
          {project?.name || "Локальное рабочее пространство"}
        </div>
        <div className="window-controls">
          <IconButton
            icon="window-restore"
            label="Новое окно"
            onClick={() => void run("window.new")}
          />
          <IconButton
            icon="window-minimize"
            label="Свернуть окно"
            onClick={() => void run("window.minimize")}
          />
          <IconButton
            icon="window-maximize"
            label="Развернуть окно"
            onClick={() => void run("window.maximize")}
          />
          <IconButton
            icon="close"
            label="Закрыть окно"
            className="window-close"
            onClick={() => void run("window.close")}
          />
        </div>
      </header>
      <div className="app-body">
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-actions">
              <button
                className="sidebar-action"
                onClick={() => void newTask(project?.id)}
              >
                <Icon name="plus" />
                Новая задача<kbd>⌘/Ctrl N</kbd>
              </button>
              <button
                className="sidebar-action"
                onClick={() => setSearch(true)}
              >
                <Icon name="search" />
                Поиск<kbd>⌘/Ctrl K</kbd>
              </button>
            </div>
            <div className="sidebar-heading">
              <span>Проекты</span>
              <IconButton
                icon="plus"
                label="Открыть проект"
                onClick={() => void chooseProject()}
              />
            </div>
            <div className="project-list">
              {state.projects
                .filter((p) => !p.archived)
                .map((p) => (
                  <div className="project-section" key={p.id}>
                    <div
                      className={`project-row ${project?.id === p.id ? "active-project" : ""}`}
                    >
                      <button
                        className="project-name"
                        onClick={() => setSelection({ projectId: p.id })}
                        title={p.path}
                      >
                        <Icon name="folder" size={16} />
                        <span>{p.name}</span>
                      </button>
                      <Menu
                        label={`Действия проекта ${p.name}`}
                        items={[
                          {
                            label: "Новая задача",
                            action: () => void newTask(p.id),
                          },
                          {
                            label: "Переименовать",
                            action: () => void rename("project", p.id, p.name),
                          },
                          {
                            label: "Архивировать",
                            action: () =>
                              void run("project.update", {
                                id: p.id,
                                archived: true,
                              }),
                          },
                          {
                            label: "Удалить запись проекта…",
                            danger: true,
                            action: () => void remove("project", p.id, p.name),
                          },
                        ]}
                      />
                    </div>
                    <div className="task-list">
                      {state.tasks
                        .filter((t) => t.projectId === p.id && !t.archived)
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                        .map((t) => (
                          <div
                            key={t.id}
                            className={`task-row ${activeTask?.id === t.id ? "selected" : ""}`}
                          >
                            <button
                              className="task-select"
                              onClick={() => selectTask(t)}
                            >
                              <Status status={taskStatus(t.id)} />
                              <span>{t.title}</span>
                              {state.sessions.some(
                                (s) => s.taskId === t.id && s.unread,
                              ) && (
                                <i
                                  className="unread-dot"
                                  aria-label="Новый ответ"
                                />
                              )}
                            </button>
                            <Menu
                              label={`Действия задачи ${t.title}`}
                              items={[
                                {
                                  label: "Переименовать",
                                  action: () =>
                                    void rename("task", t.id, t.title),
                                },
                                {
                                  label: "Архивировать",
                                  action: () =>
                                    void run("task.update", {
                                      id: t.id,
                                      archived: true,
                                    }),
                                },
                                {
                                  label: "Удалить…",
                                  danger: true,
                                  action: () =>
                                    void remove("task", t.id, t.title),
                                },
                              ]}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              {!state.projects.some((p) => !p.archived) && (
                <div className="sidebar-empty">
                  Откройте папку, чтобы начать работу с проектом.
                </div>
              )}
            </div>
            <footer className="sidebar-footer">
              <button onClick={() => void chooseProject()}>
                <Icon name="folder" />
                Открыть проект
              </button>
              <button
                className="path-project-button"
                onClick={() => void chooseProjectPath()}
              >
                <Icon name="code" />
                Указать путь
              </button>
              <button onClick={() => setArchive(true)}>
                <Icon name="clock" />
                Архив
              </button>
              <button onClick={() => setSettings(true)}>
                <Icon name="settings" />
                Настройки
              </button>
            </footer>
          </aside>
        )}
        <section className="main-area">
          <header className="task-header">
            <div className="task-heading">
              <span className="breadcrumb">
                {project?.name || "Начало работы"}
              </span>
              <h1>{activeTask?.title || "Что будем делать?"}</h1>
            </div>
            {activeTask && (
              <>
                <button
                  className="subtle-button"
                  onClick={() => openPanel("plan")}
                >
                  <Icon name="todo" size={16} />
                  <span className="hide-small">План</span>
                  {!!session?.todos.length && (
                    <span className="count">
                      {
                        session.todos.filter((t) => t.status === "completed")
                          .length
                      }
                      /{session.todos.length}
                    </span>
                  )}
                </button>
                <button
                  className="subtle-button"
                  onClick={() => openPanel("workers")}
                >
                  <Icon name="agents" size={16} />
                  {state.sessions.filter(
                    (s) =>
                      s.taskId === activeTask.id &&
                      s.parentId &&
                      busy(s.status),
                  ).length || <span className="hide-small">Исполнители</span>}
                </button>
                <Menu
                  label="Действия задачи"
                  items={[
                    {
                      label: "Переименовать",
                      action: () =>
                        void rename("task", activeTask.id, activeTask.title),
                    },
                    {
                      label: "Архивировать",
                      action: () =>
                        void run("task.update", {
                          id: activeTask.id,
                          archived: true,
                        }),
                    },
                  ]}
                />
              </>
            )}
          </header>
          <Workspace
            panelProps={{
              state,
              project,
              task: activeTask,
              session,
              run,
              selectSession,
              requestedArtifact,
              requestedOps:
                requestedOps?.payload.projectId === project?.id
                  ? requestedOps
                  : undefined,
              openBrowser: () => openPanel("browser"),
              onSettings: () => {
                setSettingsSection("operations");
                setSettings(true);
              },
              onAssist: assist,
            }}
            requested={requested}
            onRequested={() => {}}
          >
            <div className="chat-layout">
              {activeTask && (
                <div className="session-strip">
                  <div className="session-tabs">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`session-tab ${session?.id === s.id ? "selected" : ""}`}
                      >
                        <button onClick={() => selectSession(s.id)}>
                          <Status status={s.status} />
                          <span>{s.title}</span>
                          {s.parentId && <Icon name="branch" size={12} />}
                        </button>
                        <Menu
                          label={`Разговор ${s.title}`}
                          items={[
                            {
                              label: "Переименовать",
                              action: () =>
                                void rename("session", s.id, s.title),
                            },
                            {
                              label: "Архивировать разговор",
                              action: () =>
                                void run("session.update", {
                                  id: s.id,
                                  archived: true,
                                }),
                            },
                            {
                              label: "Удалить разговор…",
                              danger: true,
                              action: () =>
                                void remove("session", s.id, s.title),
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                  <IconButton
                    icon="plus"
                    label="Новый разговор этой задачи"
                    onClick={() => void createSession()}
                  />
                </div>
              )}
              {!project ? (
                <Empty icon="folder" title="Рабочее место для ваших проектов">
                  <p>
                    Откройте существующую папку. Настройки репозитория останутся
                    прежними.
                  </p>
                  <button
                    className="primary"
                    onClick={() => void chooseProject()}
                  >
                    Открыть проект
                  </button>
                  <button onClick={() => void chooseProjectPath()}>
                    Указать путь
                  </button>
                  <button onClick={() => setSettings(true)}>
                    Настроить CLI
                  </button>
                </Empty>
              ) : !activeTask ? (
                <Empty icon="chat" title={`Работаем в ${project.name}`}>
                  <p className="project-path">{project.path}</p>
                  <p>
                    Одна задача — один контекст. Чат, файлы и инструменты рядом,
                    когда нужны.
                  </p>
                  <button
                    className="primary"
                    onClick={() => void newTask(project.id)}
                  >
                    Начать задачу
                  </button>
                </Empty>
              ) : session ? (
                <Chat
                  key={session.id}
                  state={state}
                  session={session}
                  task={activeTask}
                  draft={draft}
                  setDraft={setDraft}
                  run={run}
                  onError={setNotice}
                  onSettings={() => setSettings(true)}
                  onPanel={openPanel}
                  onArtifact={(id) => {
                    setRequestedArtifact({
                      id,
                      nonce: ++panelRequestNonce.current,
                    });
                    openPanel("artifacts");
                  }}
                  refresh={refresh}
                />
              ) : (
                <Empty title="Создайте разговор">
                  <button
                    className="primary"
                    onClick={() => void createSession()}
                  >
                    Новый разговор
                  </button>
                </Empty>
              )}
            </div>
          </Workspace>
        </section>
      </div>
      {(notice || error) && (
        <div className="error-toast" role="alert">
          <Icon name="warning" />
          <span>{notice || error}</span>
          <IconButton
            icon="close"
            label="Закрыть сообщение"
            onClick={() => setNotice("")}
          />
        </div>
      )}
      {settings && (
        <SettingsView
          state={state}
          run={run}
          initialSection={settingsSection}
          projectId={project?.id}
          onClose={() => {
            setSettings(false);
            setSettingsSection("general");
          }}
          onAssist={assist}
        />
      )}{" "}
      {search && (
        <Search
          state={state}
          onClose={() => setSearch(false)}
          onSelect={(id) => {
            selectSession(id);
            setSearch(false);
          }}
          onTask={(t) => {
            selectTask(t);
            setSearch(false);
          }}
        />
      )}
      {archive && (
        <Archive
          state={state}
          run={run}
          onClose={() => setArchive(false)}
          remove={remove}
        />
      )}
    </div>
  );
}
function ToolRows({ tools }: { tools: ToolCall[] }) {
  const running = tools.find((t) => toolRunning(t.status)),
    failed = tools.filter((t) => toolFailed(t.status)).length,
    completed = tools.every((t) => toolComplete(t.status));
  const current = running || (completed ? undefined : tools.at(-1));
  return (
    <details className="tool-group">
      <summary className="tool-group-summary">
        {running ? (
          <span className="working-arc" />
        ) : (
          <Icon
            name={failed ? "warning" : completed ? "check" : "terminal"}
            size={14}
          />
        )}
        <strong>Инструменты · {tools.length}</strong>
        {current && (
          <span className="tool-current">{shortToolTitle(current.title)}</span>
        )}
        {failed > 0 && (
          <small className="tool-fail-count">Ошибок: {failed}</small>
        )}
        <Icon name="chevron-right" size={13} />
      </summary>
      <div className="tool-rows">
        {tools.map((t) => (
          <details
            key={t.id}
            className={`tool-row ${toolFailed(t.status) ? "tool-failed" : ""}`}
          >
            <summary>
              {toolRunning(t.status) ? (
                <span className="working-arc" />
              ) : (
                <Icon
                  name={
                    toolFailed(t.status)
                      ? "warning"
                      : toolComplete(t.status)
                        ? "check"
                        : "clock"
                  }
                  size={14}
                />
              )}
              <span>{shortToolTitle(t.title)}</span>
              <small>{toolStatus(t.status)}</small>
              <Icon name="chevron-right" size={13} />
            </summary>
            <div className="tool-details">
              <p className="tool-full-title">{t.title}</p>
              {t.input !== undefined && (
                <pre>
                  {typeof t.input === "string"
                    ? t.input
                    : JSON.stringify(t.input, null, 2)}
                </pre>
              )}
              {t.output && <pre>{t.output}</pre>}
              {t.input === undefined && !t.output && (
                <p className="muted">Подробности пока не получены.</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
function Chat({
  state,
  session,
  task,
  draft,
  setDraft,
  run,
  onError,
  onSettings,
  onPanel,
  onArtifact,
  refresh,
}: {
  state: AppState;
  session: Session;
  task: Task;
  draft: Draft;
  setDraft: (d: Draft | ((old: Draft) => Draft)) => void;
  run: Invoke;
  onError: (s: string) => void;
  onSettings: () => void;
  onPanel: (id: PanelId) => void;
  onArtifact: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const [sending, setSending] = useState(false),
    [contextOpen, setContextOpen] = useState(false),
    [nearBottom, setNearBottom] = useState(true),
    [questionId, setQuestionId] = useState<string>(),
    [dismissed, setDismissed] = useState<Set<string>>(() => new Set()),
    [branch, setBranch] = useState("");
  const branchRequest = useRef(0);
  const scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    ask = useAsk();
  const bottomRef = useRef(true);
  const pending = state.questions.filter(
    (q) => q.sessionId === session.id && q.status === "pending",
  );
  const question = pending.find((q) => q.id === questionId);
  useEffect(() => {
    const next = pending.find((q) => !dismissed.has(q.id));
    if (next && !questionId) setQuestionId(next.id);
    if (questionId && !pending.some((q) => q.id === questionId))
      setQuestionId(undefined);
  }, [pending.map((q) => q.id).join(","), questionId, dismissed]);
  useEffect(() => {
    const el = scroll.current;
    if (el && bottomRef.current) el.scrollTop = el.scrollHeight;
  }, [session.messages, session.status]);
  useEffect(() => {
    const el = composer.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [draft.text]);
  const jump = () => {
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: "auto",
    });
    bottomRef.current = true;
    setNearBottom(true);
  };
  const send = async () => {
    if (sending || (!draft.text.trim() && !draft.attachments.length)) return;
    const captured = { ...draft },
      text = [
        draft.text.trim(),
        draft.attachments.length
          ? `Файлы в рабочем проекте (прочитай доступными инструментами; это ссылки, а не содержимое):\n${draft.attachments.map((f) => `- ${f.path}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    setSending(true);
    try {
      await call("session.send", { id: session.id, text });
      setDraft((old) =>
        old.text === captured.text &&
        JSON.stringify(old.attachments) === JSON.stringify(captured.attachments)
          ? emptyDraft
          : old,
      );
      if (task.title === "Новая задача")
        await run("task.update", {
          id: task.id,
          title: (
            draft.text.trim().split("\n")[0] ||
            draft.attachments[0]?.name ||
            "Работа с файлами"
          ).slice(0, 90),
        });
      void refresh();
      jump();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSending(false);
    }
  };
  const attach = async () => {
    const files = await run("app.chooseFiles", { projectId: task.projectId });
    if (Array.isArray(files))
      setDraft((old) => ({
        ...old,
        attachments: [
          ...old.attachments,
          ...files.filter(
            (f) => !old.attachments.some((a) => a.path === f.path),
          ),
        ],
      }));
  };
  const activeTodo = session.todos.find((t) => t.status === "in_progress");
  const workers = state.sessions.filter(
    (s) => s.parentId === session.id && !s.archived,
  );
  const configs = session.configOptions || [];
  const materials = state.artifacts.filter((a) => a.taskId === task.id);
  const project = state.projects.find((p) => p.id === task.projectId);
  useEffect(() => {
    const request = ++branchRequest.current;
    setBranch("");
    if (!project) return;
    void call("git.status", { projectId: project.id })
      .then((result) => {
        if (request === branchRequest.current)
          setBranch(
            result?.repository === false
              ? "Не Git"
              : result?.branch || "Без ветки",
          );
      })
      .catch(() => {
        if (request === branchRequest.current) setBranch("Не Git");
      });
  }, [project?.id, session.status === "completed"]);
  const contextLimit =
    session.context.limitTokens || state.settings.contextLimit || undefined;
  return (
    <>
      <div
        className="message-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el) {
            const close =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            bottomRef.current = close;
            setNearBottom(close);
          }
        }}
      >
        {!session.messages.length ? (
          <div className="chat-welcome">
            <span className="welcome-mark">
              <Icon name="chat" size={30} />
            </span>
            <h2>Начните с того, что нужно получить</h2>
            <p>
              Опишите задачу своими словами. Агент уточнит только то, что
              действительно мешает работе.
            </p>
            {!state.settings.cliPath && (
              <button onClick={onSettings}>Выбрать установленный CLI</button>
            )}
          </div>
        ) : (
          <div className="message-list">
            {session.messages.map((m) => (
              <article
                key={m.id}
                aria-label={
                  m.role === "user"
                    ? "Сообщение пользователя"
                    : m.role === "assistant"
                      ? "Ответ агента"
                      : "Системное сообщение"
                }
                className={`message message-${m.role}`}
              >
                <header>
                  <time title={new Date(m.at).toLocaleString()}>
                    {new Date(m.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <IconButton
                    icon="copy"
                    label="Скопировать сообщение"
                    onClick={() =>
                      void run("clipboard.write", { text: m.content })
                    }
                  />
                </header>
                {m.content && <Markdown text={m.content} />}{" "}
                {!!m.tools?.length && <ToolRows tools={m.tools} />}
                {m.outcome && (
                  <footer className="turn-outcome">
                    {m.outcome === "completed" && m.elapsedMs !== undefined
                      ? `Выполнено за ${elapsedLabel(m.elapsedMs)}`
                      : m.outcome === "cancelled"
                        ? "Остановлено"
                        : "Результат требует проверки"}
                  </footer>
                )}
              </article>
            ))}
          </div>
        )}
        {session.error && (
          <div className="session-error">
            <Icon name="warning" />
            <div>
              <strong>
                {session.status === "unknown"
                  ? "Исход запроса не подтверждён"
                  : "Не удалось продолжить"}
              </strong>
              <p>{session.error}</p>
              <button
                onClick={async () => {
                  if (
                    await ask("Восстановить подключение?", {
                      message:
                        "Будет создана новая ACP-сессия с кратким контекстом. Предыдущий запрос не отправится повторно автоматически. Проверьте возможные внешние действия перед продолжением.",
                      confirm: true,
                    })
                  )
                    await run("session.recover", { id: session.id });
                }}
              >
                Восстановить сессию
              </button>
              <button onClick={onSettings}>Настройки</button>
            </div>
          </div>
        )}
      </div>
      <div className="composer-region">
        {materials.length > 0 && (
          <div className="chat-materials">
            <Icon name="file" size={14} />
            {materials.slice(-3).map((a) => (
              <button
                key={a.id}
                onClick={() => onArtifact(a.id)}
                title={a.path}
              >
                {a.name}
              </button>
            ))}
            {materials.length > 3 && (
              <button onClick={() => onPanel("artifacts")}>
                Ещё {materials.length - 3}
              </button>
            )}
          </div>
        )}
        {!nearBottom && (
          <button className="jump-latest" onClick={jump}>
            <Icon name="chevron-down" size={14} />К последнему сообщению
          </button>
        )}
        {pending.length > 0 && (
          <button
            className={`question-anchor ${pending.some((q) => q.kind === "permission") ? "permission-anchor" : ""}`}
            onClick={() => setQuestionId(pending[0].id)}
          >
            <Icon name="question" size={16} />
            {pending.some((q) => q.kind === "permission")
              ? "Нужно ваше разрешение"
              : "Агент ждёт уточнения"}
            <span>{pending.length}</span>
            <Icon name="chevron-right" size={14} />
          </button>
        )}
        {(busy(session.status) ||
          activeTodo ||
          workers.some((w) => busy(w.status))) && (
          <div className="activity-line">
            <Status
              status={
                activeTodo && !busy(session.status) ? "waiting" : session.status
              }
            />
            <span>
              {activeTodo && !busy(session.status)
                ? `Осталось: ${activeTodo.text}`
                : activeTodo?.text || statusLabel[session.status]}
            </span>
            {workers.length > 0 && (
              <button onClick={() => onPanel("workers")}>
                <Icon name="agents" size={14} />
                {workers.filter((w) => busy(w.status)).length} работают
              </button>
            )}
          </div>
        )}
        <QueueMessages
          items={session.queue}
          sessionId={session.id}
          running={busy(session.status)}
          unknown={session.status === "unknown"}
          invoke={async (method, params) => {
            const result = await call(method, params);
            await refresh();
            return result;
          }}
          onRestore={(text) => {
            setDraft((old) => ({
              ...old,
              text: [old.text, text].filter(Boolean).join("\n\n"),
            }));
            composer.current?.focus();
          }}
        />
        <div className="composer">
          {draft.attachments.length > 0 && (
            <div className="attachment-list">
              {draft.attachments.map((f) => (
                <span key={f.path} title={f.path}>
                  <Icon name="file" size={14} />
                  {f.name}
                  <IconButton
                    icon="close"
                    label={`Убрать ${f.name}`}
                    onClick={() =>
                      setDraft((old) => ({
                        ...old,
                        attachments: old.attachments.filter(
                          (a) => a.path !== f.path,
                        ),
                      }))
                    }
                  />
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            aria-label="Сообщение агенту"
            value={draft.text}
            placeholder={
              busy(session.status)
                ? "Следующее поручение — отправится после текущего ответа…"
                : "Опишите задачу, задайте вопрос или приложите файлы…"
            }
            onChange={(e) =>
              setDraft((old) => ({ ...old, text: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-toolbar">
            <IconButton
              icon="attach"
              label="Приложить файлы проекта"
              onClick={() => void attach()}
            />
            <button
              className="composer-branch"
              title={`Git-ветка: ${branch || "определяется"}`}
              onClick={() => onPanel("changes")}
            >
              <Icon name="branch" size={13} />
              <span>{branch || "Ветка…"}</span>
            </button>
            <span className="composer-spacer" />
            <span
              className="composer-auto-profile"
              title={`${profileName(
                state.profiles.find((p) => p.id === session.profileId),
                session.profileId,
              )} · ${session.profileReason || "Выбор роли ожидается"}${session.instructionBinding ? ` · ${session.instructionBinding.delivery === "append_system" ? "Системное дополнение" : "Контекст"} · ${session.instructionBinding.state} · ${session.instructionBinding.fingerprint.slice(0, 12)} · ${session.instructionBinding.reason}` : ""}`}
            >
              <Icon name="profile" size={14} />
              <span>
                {session.profileConfidence === 0 && !session.roleRouting
                  ? "Авто"
                  : profileName(
                      state.profiles.find((p) => p.id === session.profileId),
                      session.profileId,
                    )}
              </span>
            </span>
            <ModelPicker
              configs={configs}
              model={session.model || state.settings.model || "Модель CLI"}
              reasoning={session.reasoning}
              disabled={busy(session.status)}
              onSettings={onSettings}
              onPrepare={async () => {
                await call("session.prepare", { id: session.id });
                await refresh();
              }}
              onContext={() => setContextOpen(true)}
              onSelect={(configId, value) =>
                run("session.config", { id: session.id, configId, value })
              }
            />
            {busy(session.status) && (
              <IconButton
                icon="stop"
                label="Остановить текущий запрос"
                disabled={session.status === "cancelling"}
                onClick={() => void run("session.cancel", { id: session.id })}
              />
            )}
            <ContextSend
              used={session.context.usedTokens}
              limit={contextLimit}
              estimated={
                session.context.estimated ||
                session.context.limitTokens === undefined
              }
              busy={busy(session.status)}
              sending={sending}
              disabled={!draft.text.trim() && !draft.attachments.length}
              onContext={() => setContextOpen(true)}
              onSend={() => void send()}
            />
          </div>
        </div>
        <div className="composer-footnote">
          <span>
            {busy(session.status)
              ? "Новое сообщение встанет в очередь. Текущий запрос не подменяется."
              : "Ctrl / ⌘ + Enter — отправить"}
          </span>
        </div>
      </div>
      {question && (
        <QuestionOverlay
          key={question.id}
          question={question}
          taskTitle={task.title}
          run={run}
          onClose={() => {
            setDismissed((old) => new Set(old).add(question.id));
            setQuestionId(undefined);
            composer.current?.focus();
          }}
        />
      )}
      {contextOpen && (
        <Modal title="Контекст сессии" onClose={() => setContextOpen(false)}>
          <div className="dialog-form">
            <dl className="info-list">
              <div>
                <dt>Использовано</dt>
                <dd>
                  {session.context.usedTokens == null
                    ? "CLI не сообщил"
                    : `${session.context.estimated ? "Оценка: " : ""}${session.context.usedTokens.toLocaleString()} токенов`}
                </dd>
              </div>
              <div>
                <dt>Лимит CLI</dt>
                <dd>
                  {session.context.limitTokens?.toLocaleString() ||
                    "Не сообщён"}
                </dd>
              </div>
              <div>
                <dt>Настроенный ориентир</dt>
                <dd>{state.settings.contextLimit.toLocaleString()}</dd>
              </div>
            </dl>
            <p className="muted">
              Передача контекста создаёт новую ACP-сессию с кратким содержанием.
              Исходный разговор сохраняется. Это не редактирование скрытого
              контекста CLI.
            </p>
            <footer>
              <button onClick={() => setContextOpen(false)}>Закрыть</button>
              <button
                disabled={busy(session.status)}
                onClick={async () => {
                  if (
                    await ask("Передать краткий контекст в новую сессию?", {
                      confirm: true,
                      message:
                        "Сохранённая история останется доступна. Следующий запрос продолжится через новое подключение.",
                    })
                  ) {
                    await run("session.compact", { id: session.id });
                    setContextOpen(false);
                  }
                }}
              >
                Передать краткий контекст
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}
function QuestionOverlay({
  question,
  taskTitle,
  run,
  onClose,
}: {
  question: Question;
  taskTitle: string;
  run: Invoke;
  onClose: () => void;
}) {
  const [draft, setDraft] = useStored<{ text: string; optionId: string }>(
      `workbench.answer.${question.id}`,
      { text: "", optionId: "" },
    ),
    [sending, setSending] = useState(false);
  const titleId = `question-${question.id}`;
  useLayer(true);
  const submit = async () => {
    setSending(true);
    const result = await run("question.answer", {
      id: question.id,
      optionId: draft.optionId || undefined,
      text: draft.text || undefined,
    });
    setSending(false);
    if (result !== undefined) onClose();
  };
  return (
    <section
      className={`question-overlay ${question.kind === "permission" ? "permission-overlay" : ""}`}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <div>
          <small>
            {question.kind === "permission"
              ? "Разрешение на действие"
              : "Уточнение"}{" "}
            · {taskTitle}
          </small>
          <h2 id={titleId}>{question.title}</h2>
        </div>
        <IconButton
          icon="close"
          label="Свернуть, сохранив ответ"
          onClick={onClose}
        />
      </header>
      <div className="question-options">
        {question.options.map((o) => (
          <label
            key={o.id}
            className={draft.optionId === o.id ? "selected" : ""}
          >
            <input
              type="radio"
              name={question.id}
              checked={draft.optionId === o.id}
              onChange={() => setDraft((old) => ({ ...old, optionId: o.id }))}
            />
            {o.label}
          </label>
        ))}
      </div>
      {question.kind === "question" && (
        <label className="field">
          Свой ответ или дополнение
          <textarea
            rows={3}
            value={draft.text}
            onChange={(e) =>
              setDraft((old) => ({ ...old, text: e.target.value }))
            }
            placeholder="Можно ответить своими словами…"
          />
        </label>
      )}
      {question.kind === "permission" && (
        <p className="fine-print">
          Закрытие окна не выдаёт разрешение. Выберите явный вариант, полученный
          от CLI.
        </p>
      )}
      <footer>
        <button onClick={onClose}>Ответить позже</button>
        <button
          className="primary"
          disabled={
            sending ||
            (question.kind === "permission"
              ? !draft.optionId
              : !draft.optionId && !draft.text.trim())
          }
          onClick={() => void submit()}
        >
          {question.kind === "permission"
            ? "Подтвердить выбранное"
            : "Отправить ответ"}
        </button>
      </footer>
    </section>
  );
}
function Search({
  state,
  onClose,
  onSelect,
  onTask,
}: {
  state: AppState;
  onClose: () => void;
  onSelect: (id: string) => void;
  onTask: (t: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase().trim();
  const tasks = state.tasks
    .filter(
      (t) =>
        !t.archived &&
        state.projects.some((p) => p.id === t.projectId && !p.archived) &&
        (!q || t.title.toLowerCase().includes(q)),
    )
    .slice(0, 20);
  const messages = q
    ? state.sessions
        .filter((s) => !s.archived)
        .flatMap((s) =>
          s.messages
            .filter((m) => m.content.toLowerCase().includes(q))
            .slice(-3)
            .map((m) => ({ s, m })),
        )
        .slice(0, 30)
    : [];
  return (
    <Modal title="Поиск по задачам и разговорам" onClose={onClose}>
      <div className="search-body">
        <input
          autoFocus
          aria-label="Поиск"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название задачи или текст разговора…"
        />
        <div className="search-results">
          {tasks.map((t) => (
            <button key={t.id} onClick={() => onTask(t)}>
              <Icon name="chat" />
              <span>
                <strong>{t.title}</strong>
                <small>
                  {state.projects.find((p) => p.id === t.projectId)?.name}
                </small>
              </span>
            </button>
          ))}
          {messages.map(({ s, m }) => (
            <button key={m.id} onClick={() => onSelect(s.id)}>
              <Icon name="search" />
              <span>
                <strong>{s.title}</strong>
                <small>
                  {m.content.slice(
                    Math.max(0, m.content.toLowerCase().indexOf(q) - 50),
                    Math.max(0, m.content.toLowerCase().indexOf(q) - 50) + 200,
                  )}
                </small>
              </span>
            </button>
          ))}
          {!tasks.length && !messages.length && (
            <p className="muted">Совпадений нет.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
function Archive({
  state,
  run,
  onClose,
  remove,
}: {
  state: AppState;
  run: Invoke;
  onClose: () => void;
  remove: (kind: string, id: string, title: string) => Promise<void>;
}) {
  const rows = [
    ...state.projects
      .filter((p) => p.archived)
      .map((p) => ({ kind: "project", id: p.id, title: p.name })),
    ...state.tasks
      .filter((t) => t.archived)
      .map((t) => ({ kind: "task", id: t.id, title: t.title })),
    ...state.sessions
      .filter((s) => s.archived)
      .map((s) => ({ kind: "session", id: s.id, title: s.title })),
  ];
  return (
    <Modal title="Архив" onClose={onClose}>
      <div className="archive-body">
        <p className="muted">
          Архив скрывает записи из навигации. Работающие процессы не
          останавливаются только от скрытия.
        </p>
        {rows.length ? (
          rows.map((r) => (
            <div className="archive-row" key={r.id}>
              <Icon name={r.kind === "project" ? "folder" : "chat"} />
              <span>
                {r.title}
                <small>
                  {r.kind === "project"
                    ? "Проект"
                    : r.kind === "task"
                      ? "Задача"
                      : "Разговор"}
                </small>
              </span>
              <button
                onClick={() =>
                  void run(`${r.kind}.update`, { id: r.id, archived: false })
                }
              >
                Восстановить
              </button>
              <Menu
                items={[
                  {
                    label: "Удалить окончательно…",
                    danger: true,
                    action: () => void remove(r.kind, r.id, r.title),
                  },
                ]}
              />
            </div>
          ))
        ) : (
          <Empty icon="clock" title="Архив пуст">
            <p>Архивированные проекты и разговоры появятся здесь.</p>
          </Empty>
        )}
      </div>
    </Modal>
  );
}
