import type { OpsPanelProps } from "./ops-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  AppState,
  Artifact,
  Project,
  Session,
  Task,
} from "../shared/types";
import { profileName } from "./labels";
import { busy, useStored, type Invoke } from "./api";
import {
  Empty,
  Icon,
  IconButton,
  Markdown,
  Menu,
  Status,
  useAsk,
  useCovered,
} from "./ui";
export interface PanelProps {
  state: AppState;
  project?: Project;
  task?: Task;
  session?: Session;
  run: Invoke;
  visible: boolean;
  selectSession: (id: string) => void;
  openBrowser?: () => void;
  onSettings?: () => void;
  onAssist?: (text: string) => void;
  requestedArtifact?: { id: string; nonce: number };
  requestedOps?: OpsPanelProps["reveal"];
}
interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading?: boolean;
  error?: string;
  projectId?: string;
  sessionId?: string;
  active?: boolean;
  lastActiveAt?: number;
}
export function BrowserPanel({
  project,
  task,
  session,
  run,
  visible,
}: PanelProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]),
    [selected, setSelected] = useState(""),
    [address, setAddress] = useState(""),
    [editing, setEditing] = useState(false),
    [w, setW] = useState("390"),
    [h, setH] = useState("844"),
    [preset, setPreset] = useState("adaptive"),
    [zoom, setZoom] = useState("1"),
    [actual, setActual] = useState<any>(),
    [creating, setCreating] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project?.id);
  projectRef.current = project?.id;
  const tabRef = useRef("");
  const refreshGeneration = useRef(0),
    selectionIntent = useRef<string | undefined>(undefined);
  const covered = useCovered();
  const ask = useAsk();
  const tab = tabs.find((t) => t.id === selected) || tabs[0];
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current,
      expectedProject = project?.id;
    const data = await run("browser.list");
    if (
      generation === refreshGeneration.current &&
      projectRef.current === expectedProject &&
      Array.isArray(data)
    ) {
      const own = data.filter(
        (candidate: BrowserTab) => candidate.projectId === expectedProject,
      );
      setTabs(own);
      setSelected((current) => {
        const intended = selectionIntent.current;
        if (
          intended &&
          own.some((candidate: BrowserTab) => candidate.id === intended)
        )
          return intended;
        // Explicit backend activation (create, reuse or another UI surface)
        // is authoritative. The array itself remains in backend tab-strip
        // order; never sort it merely to choose a fallback.
        const backendActive = own.find(
          (candidate: BrowserTab) => candidate.active,
        );
        if (backendActive) return backendActive.id;
        if (own.some((candidate: BrowserTab) => candidate.id === current))
          return current;
        return own[0]?.id || "";
      });
    }
  }, [project?.id, run]);
  useEffect(() => {
    ++refreshGeneration.current;
    selectionIntent.current = undefined;
    setTabs([]);
    setSelected("");
    void refresh();
  }, [refresh]);
  useEffect(
    () =>
      window.workbench?.subscribe((e) => {
        if (e.type === "browser.changed") {
          // Re-read the owner-scoped list. A request generation below prevents
          // a slower, older full-list response from replacing newer state.
          void refresh();
        }
        if (e.type === "browser.closed") void refresh();
      }),
    [refresh],
  );
  const activateTab = async (id: string) => {
    selectionIntent.current = id;
    ++refreshGeneration.current;
    setSelected(id);
    try {
      await run("browser.activate", { id });
    } finally {
      if (selectionIntent.current === id) selectionIntent.current = undefined;
    }
    await refresh();
  };
  useEffect(() => {
    if (!editing) setAddress(tab?.url || "");
  }, [tab?.id, tab?.url, editing]);
  tabRef.current = tab?.id || "";
  const inspect = useCallback(async () => {
    if (!tab) return;
    const value = await run("browser.inspect", { id: tab.id });
    if (value && tabRef.current === tab.id) {
      setActual(value.viewport);
      if (value.viewport?.zoom) setZoom(String(value.viewport.zoom));
    }
  }, [tab?.id, run]);
  useEffect(() => {
    setActual(undefined);
    void inspect();
  }, [inspect]);
  useEffect(() => {
    if (!tab || !area.current) return;
    const id = tab.id;
    let frame = 0,
      timer: ReturnType<typeof setTimeout>;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = area.current?.getBoundingClientRect();
        if (!rect) return;
        void run("browser.bounds", {
          id,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
          visible: visible && !covered && rect.width > 0 && rect.height > 0,
        });
        clearTimeout(timer);
        if (visible && !covered) timer = setTimeout(() => void inspect(), 300);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(area.current);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      void run("browser.bounds", {
        id,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        visible: false,
      });
    };
  }, [tab?.id, visible, covered, run, inspect]);
  const create = async () => {
    if (!project || creating) return;
    setCreating(true);
    try {
      const t = await run("browser.create", {
        projectId: project.id,
        sessionId: session?.id,
        url: "about:blank",
        requestId: crypto.randomUUID(),
      });
      if (t) {
        await refresh();
        setSelected(t.id);
      }
    } finally {
      setCreating(false);
    }
  };
  const action = async (
    method: string,
    params: Record<string, unknown> = {},
  ) => {
    if (!tab) return;
    await run(method, { id: tab.id, ...params });
    await refresh();
    await inspect();
  };
  const dimensions = async (width = w, height = h) => {
    const wi = Number(width),
      he = Number(height);
    if (
      !Number.isInteger(wi) ||
      !Number.isInteger(he) ||
      wi < 240 ||
      he < 240 ||
      wi > 3840 ||
      he > 3840
    ) {
      await ask("Некорректный размер", {
        message: "Введите целые размеры страницы от 240 до 3840 CSS px.",
        confirm: true,
      });
      return;
    }
    setPreset("custom");
    await action("browser.emulate", { width: wi, height: he });
  };
  return (
    <div className="browser-panel panel-content">
      <div className="resource-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`resource-tab ${tab?.id === t.id ? "active" : ""}`}
          >
            <button
              onClick={() => void activateTab(t.id)}
              onDoubleClick={async () => {
                const name = await ask("Название вкладки", { value: t.title });
                if (name)
                  await run("browser.rename", { id: t.id, title: name });
                void refresh();
              }}
              onKeyDown={async (e) => {
                if (e.key === "F2") {
                  const name = await ask("Название вкладки", {
                    value: t.title,
                  });
                  if (name)
                    await run("browser.rename", { id: t.id, title: name });
                  void refresh();
                }
              }}
            >
              {t.loading ? (
                <span className="working-arc" />
              ) : (
                <Icon name="browser" size={14} />
              )}
              <span>{t.title || "Новая вкладка"}</span>
            </button>
            <IconButton
              icon="close"
              label={`Закрыть ${t.title}`}
              onClick={() =>
                void run("browser.close", { id: t.id }).then(refresh)
              }
            />
          </div>
        ))}
        <IconButton
          icon="plus"
          label="Новая вкладка браузера"
          disabled={!project || creating}
          onClick={() => void create()}
        />
      </div>
      {tab ? (
        <>
          <form
            className="browser-address"
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              void action("browser.navigate", { url: address });
            }}
          >
            <IconButton
              icon="chevron-right"
              className="rotate-180"
              label="Назад"
              onClick={() => void action("browser.back")}
            />
            <IconButton
              icon="chevron-right"
              label="Вперёд"
              onClick={() => void action("browser.forward")}
            />
            <IconButton
              icon={tab.loading ? "stop" : "reload"}
              label={tab.loading ? "Остановить загрузку" : "Обновить"}
              onClick={() =>
                void action(tab.loading ? "browser.stop" : "browser.reload")
              }
            />
            <input
              aria-label="Адрес страницы"
              value={address}
              placeholder="Введите адрес и нажмите Enter"
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAddress(tab.url);
                  setEditing(false);
                  e.currentTarget.blur();
                }
              }}
            />
            <IconButton
              icon="external-browser"
              label="Открыть текущую страницу во внешнем браузере"
              onClick={() => void action("browser.external")}
            />
          </form>
          <div className="viewport-toolbar">
            <select
              aria-label="Размер страницы"
              value={preset}
              onChange={(e) => {
                const v = e.target.value;
                setPreset(v);
                if (v === "adaptive") void action("browser.resetEmulation");
                else if (v !== "custom") {
                  const [ww, hh] = v.split("x");
                  setW(ww);
                  setH(hh);
                  void dimensions(ww, hh).then(() => setPreset(v));
                }
              }}
            >
              <option value="adaptive">По размеру панели</option>
              <option value="390x844">390 × 844</option>
              <option value="768x1024">768 × 1024</option>
              <option value="1280x800">1280 × 800</option>
              <option value="custom">Свой размер</option>
            </select>
            <label>
              W{" "}
              <input
                aria-label="Ширина CSS px"
                inputMode="numeric"
                value={w}
                onChange={(e) => setW(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void dimensions();
                }}
              />
            </label>
            <label>
              H{" "}
              <input
                aria-label="Высота CSS px"
                inputMode="numeric"
                value={h}
                onChange={(e) => setH(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void dimensions();
                }}
              />
            </label>
            <button onClick={() => void dimensions()}>Применить</button>
            <button
              title="Поменять ширину и высоту"
              onClick={() => {
                setW(h);
                setH(w);
                void dimensions(h, w);
              }}
            >
              ↔
            </button>
            <select
              aria-label="Масштаб страницы"
              value={zoom}
              onChange={(e) => {
                setZoom(e.target.value);
                void action("browser.zoom", { factor: Number(e.target.value) });
              }}
            >
              {[0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v * 100}%
                </option>
              ))}
            </select>
            <IconButton
              icon="file"
              label="Сохранить снимок страницы"
              onClick={async () => {
                const r = await run("browser.capture", {
                  id: tab.id,
                  taskId: task?.id,
                });
                if (r?.path && !task)
                  await ask("Снимок сохранён", {
                    message: r.path,
                    confirm: true,
                  });
              }}
            />
          </div>
          <div className="browser-measurement">
            {actual
              ? `${actual.width} × ${actual.height} CSS px · DPR ${actual.dpr ?? "—"} · масштаб ${actual.zoom === undefined ? "—" : Math.round(actual.zoom * 100) + "%"}`
              : "Измерения страницы пока не получены"}
          </div>
          {tab.error && (
            <div className="error-inline browser-error" role="alert">
              {tab.error}
            </div>
          )}
          <div
            ref={area}
            className="native-browser-area"
            aria-label="Встроенная веб-страница"
          >
            {covered && (
              <div className="native-cover">
                Страница временно скрыта поверх открытого диалога
              </div>
            )}
          </div>
        </>
      ) : (
        <Empty icon="browser" title="Браузер проекта">
          <p>Вкладки сохраняют своё состояние при скрытии панели.</p>
          <button disabled={!project || creating} onClick={() => void create()}>
            {creating ? "Открывается…" : "Открыть вкладку"}
          </button>
        </Empty>
      )}
    </div>
  );
}
interface TerminalTab {
  id: string;
  title: string;
  projectId: string;
  history?: string;
}
function TerminalScreen({
  id,
  visible,
  run,
  history,
}: {
  id: string;
  visible: boolean;
  run: Invoke;
  history?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    fitRef = useRef<FitAddon | undefined>(undefined),
    termRef = useRef<Terminal | undefined>(undefined);
  const [exit, setExit] = useState<number>();
  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      convertEol: false,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: "#181b19", foreground: "#eff3ec" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    if (history) term.write(history);
    termRef.current = term;
    fitRef.current = fit;
    const data = term.onData((value) => {
      void run("terminal.write", { id, data: value });
    });
    const off = window.workbench?.subscribe((e) => {
      const p = e.payload as { id: string; data: string; exitCode: number };
      if (p.id !== id) return;
      if (e.type === "terminal.data") term.write(p.data);
      if (e.type === "terminal.exit") {
        setExit(p.exitCode);
        term.writeln(`\r\n[Процесс завершён: ${p.exitCode}]`);
      }
    });
    return () => {
      off?.();
      data.dispose();
      term.dispose();
      termRef.current = undefined;
      fitRef.current = undefined;
    };
  }, [id, run]);
  useEffect(() => {
    if (!ref.current || !visible) return;
    const resize = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term && term.cols > 0 && term.rows > 0)
          void run("terminal.resize", { id, cols: term.cols, rows: term.rows });
      } catch {
        /* Element may be hidden during docking. */
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    requestAnimationFrame(resize);
    return () => observer.disconnect();
  }, [id, visible, run]);
  return (
    <div
      className="terminal-screen"
      style={{ display: visible ? "flex" : "none" }}
    >
      {exit !== undefined && (
        <div className="terminal-exit">Завершён · код {exit}</div>
      )}
      <div className="xterm-host" ref={ref} />
    </div>
  );
}
export function TerminalPanel({ project, visible, run }: PanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]),
    [selected, setSelected] = useState(""),
    [shells, setShells] = useState<{ id: string; name: string }[]>([]),
    [shell, setShell] = useState("");
  const ask = useAsk();
  const refresh = useCallback(async () => {
    const rows = await run("terminal.list");
    if (Array.isArray(rows)) setTabs(rows);
  }, [run]);
  useEffect(() => {
    void refresh();
    void run("terminal.shells").then((r) => {
      if (Array.isArray(r)) setShells(r);
    });
  }, [refresh, run]);
  const own = tabs.filter((t) => t.projectId === project?.id),
    active = own.find((t) => t.id === selected) || own[0];
  const create = async () => {
    if (!project) return;
    const t = await run("terminal.create", {
      projectId: project.id,
      shellId: shell || undefined,
    });
    if (t) {
      await refresh();
      setSelected(t.id);
    }
  };
  return (
    <div className="panel-content terminal-panel">
      <div className="resource-tabs">
        {own.map((t) => (
          <div
            className={`resource-tab ${active?.id === t.id ? "active" : ""}`}
            key={t.id}
          >
            <button
              onClick={() => setSelected(t.id)}
              onDoubleClick={async () => {
                const title = await ask("Название терминала", {
                  value: t.title,
                });
                if (title) {
                  await run("terminal.rename", { id: t.id, title });
                  void refresh();
                }
              }}
            >
              <Icon name="terminal" size={14} />
              <span>{t.title}</span>
            </button>
            <IconButton
              icon="close"
              label={`Завершить ${t.title}`}
              onClick={async () => {
                if (
                  await ask("Завершить процесс терминала?", {
                    message:
                      "Это остановит процесс этой вкладки. Скрытие всей панели оставляет его работающим.",
                    confirm: true,
                  })
                ) {
                  await run("terminal.close", { id: t.id });
                  void refresh();
                }
              }}
            />
          </div>
        ))}
        <select
          aria-label="Оболочка терминала"
          value={shell}
          onChange={(e) => setShell(e.target.value)}
        >
          <option value="">По умолчанию</option>
          {shells.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <IconButton
          icon="plus"
          label="Новый терминал"
          disabled={!project}
          onClick={() => void create()}
        />
      </div>
      {tabs.map((t) => (
        <TerminalScreen
          key={t.id}
          id={t.id}
          history={t.history}
          visible={visible && active?.id === t.id}
          run={run}
        />
      ))}
      {!active && (
        <Empty icon="terminal" title="Терминал проекта">
          <button disabled={!project} onClick={() => void create()}>
            Создать терминал
          </button>
        </Empty>
      )}
    </div>
  );
}
interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}
export function FilesPanel({ project, run }: PanelProps) {
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({}),
    [expanded, setExpanded] = useState<Set<string>>(() => new Set()),
    [filter, setFilter] = useState(""),
    [loading, setLoading] = useState(false);
  const ask = useAsk();
  const request = useRef(0),
    projectRef = useRef(project?.id);
  projectRef.current = project?.id;
  const [drafts, setDrafts] = useStored<
    Record<
      string,
      {
        file: {
          path: string;
          text: string;
          mtime: number;
          hash?: string;
        } | null;
        text: string;
      }
    >
  >("workbench.file-drafts.v1", {});
  const file = project ? drafts[project.id]?.file : null,
    text = project ? drafts[project.id]?.text || "" : "";
  const dirty = !!file && text !== file.text;
  const setFile = (
    value: { path: string; text: string; mtime: number; hash?: string } | null,
  ) => {
    if (project)
      setDrafts((old) => ({
        ...old,
        [project.id]: { file: value, text: old[project.id]?.text || "" },
      }));
  };
  const setText = (value: string) => {
    if (project)
      setDrafts((old) => ({
        ...old,
        [project.id]: { file: old[project.id]?.file || null, text: value },
      }));
  };
  const load = useCallback(
    async (path = "") => {
      if (!project) return;
      const result = await run("fs.list", {
        projectId: project.id,
        path: path || undefined,
      });
      if (projectRef.current === project.id && Array.isArray(result))
        setEntries((old) => ({ ...old, [path]: result }));
    },
    [project?.id, run],
  );
  useEffect(() => {
    request.current++;
    setEntries({});
    setExpanded(new Set());
    setLoading(false);
    void load();
  }, [load]);
  const open = async (path: string) => {
    if (!project) return;
    if (
      dirty &&
      !(await ask("Сохранить несохранённый текст?", {
        message:
          "Отмена оставит текущий файл. Подтверждение сохранит изменения перед переходом.",
        confirm: true,
      }))
    )
      return;
    if (dirty) {
      const saved = await run("fs.write", {
        projectId: project.id,
        path: file!.path,
        text,
        expectedMtime: file!.mtime,
        expectedHash: file!.hash,
      });
      if (!saved) return;
      setFile({ ...file!, text, mtime: saved.mtime, hash: saved.hash });
    }
    const generation = ++request.current;
    setLoading(true);
    const result = await run("fs.read", { projectId: project.id, path });
    if (generation === request.current) {
      setLoading(false);
      if (result) {
        setFile(result);
        setText(result.text);
      }
    }
  };
  const containsDraft = (path: string) =>
    !!file &&
    (file.path === path ||
      file.path.startsWith(path + "/") ||
      file.path.startsWith(path + "\\"));
  const tree = (path: string, depth = 0): React.ReactNode =>
    (entries[path] || [])
      .filter(
        (e) =>
          !filter ||
          e.directory ||
          e.name.toLowerCase().includes(filter.toLowerCase()),
      )
      .map((entry) => (
        <div key={entry.path}>
          <div
            className={`file-row ${file?.path === entry.path ? "selected" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 }}
          >
            <button
              onClick={() => {
                if (entry.directory) {
                  setExpanded((old) => {
                    const n = new Set(old);
                    if (n.has(entry.path)) n.delete(entry.path);
                    else n.add(entry.path);
                    return n;
                  });
                  if (!entries[entry.path]) void load(entry.path);
                } else void open(entry.path);
              }}
            >
              <Icon
                name={
                  entry.directory
                    ? expanded.has(entry.path)
                      ? "chevron-down"
                      : "chevron-right"
                    : "file"
                }
                size={14}
              />
              <span>{entry.name}</span>
            </button>
            <Menu
              label={`Действия ${entry.name}`}
              items={[
                {
                  label: "Скопировать путь",
                  action: () =>
                    void run("clipboard.write", { text: entry.path }),
                },
                {
                  label: "Переименовать / переместить",
                  disabled:
                    entry.directory || (dirty && containsDraft(entry.path)),
                  action: async () => {
                    const newPath = await ask("Новый путь", {
                      value: entry.path,
                    });
                    if (newPath) {
                      const result = await run("fs.rename", {
                        projectId: project?.id,
                        path: entry.path,
                        newPath,
                      });
                      if (result && file?.path === entry.path)
                        setFile({ ...file, path: result.path });
                      void load(path);
                    }
                  },
                },
                {
                  label: "В корзину системы",
                  danger: true,
                  disabled: dirty && containsDraft(entry.path),
                  action: async () => {
                    if (
                      await ask("Переместить в корзину?", {
                        message: entry.path,
                        confirm: true,
                      })
                    ) {
                      const result = await run("fs.trash", {
                        projectId: project?.id,
                        path: entry.path,
                      });
                      if (result && containsDraft(entry.path)) setFile(null);
                      void load(path);
                    }
                  },
                },
              ]}
            />
          </div>
          {entry.directory &&
            expanded.has(entry.path) &&
            tree(entry.path, depth + 1)}
        </div>
      ));
  return (
    <div className="panel-content files-panel">
      <div className="panel-toolbar">
        <input
          aria-label="Фильтр загруженных файлов"
          placeholder="Фильтр загруженного дерева…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <IconButton
          icon="reload"
          label="Обновить файлы"
          onClick={() => void load()}
        />
        <Menu
          label="Создать файл или папку"
          icon="plus"
          items={[
            {
              label: "Новый файл",
              action: async () => {
                const path = await ask(
                  "Путь нового файла относительно проекта",
                );
                if (path) {
                  await run("fs.create", { projectId: project?.id, path });
                  void load();
                }
              },
            },
            {
              label: "Новая папка",
              action: async () => {
                const path = await ask("Путь новой папки");
                if (path) {
                  await run("fs.create", {
                    projectId: project?.id,
                    path,
                    directory: true,
                  });
                  void load();
                }
              },
            },
          ]}
        />
      </div>
      <div className="file-tree">
        {project ? tree("") : <p className="muted inset">Выберите проект.</p>}
      </div>
      {loading && <p className="muted inset">Чтение файла…</p>}
      {file && (
        <div className="file-editor">
          <div className="panel-toolbar">
            <span className="truncate" title={file.path}>
              {file.path}
              {dirty ? " •" : ""}
            </span>
            <IconButton
              icon="reload"
              label="Перечитать файл с диска"
              onClick={async () => {
                if (
                  dirty &&
                  !(await ask("Отбросить черновик и перечитать файл?", {
                    confirm: true,
                  }))
                )
                  return;
                const result = await run("fs.read", {
                  projectId: project?.id,
                  path: file.path,
                });
                if (result) {
                  setFile(result);
                  setText(result.text);
                }
              }}
            />
            <button
              disabled={!dirty}
              onClick={async () => {
                const r = await run("fs.write", {
                  projectId: project?.id,
                  path: file.path,
                  text,
                  expectedMtime: file.mtime,
                  expectedHash: file.hash,
                });
                if (r) setFile({ ...file, text, mtime: r.mtime, hash: r.hash });
              }}
            >
              Сохранить
            </button>
          </div>
          <textarea
            spellCheck={false}
            aria-label={`Редактор ${file.path}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
export function PlanPanel({ session }: PanelProps) {
  return (
    <div className="panel-content padded">
      {session?.todos.length ? (
        <>
          <div className="section-label">
            План агента ·{" "}
            {session.todos.filter((t) => t.status === "completed").length} из{" "}
            {session.todos.length}
          </div>
          <ol className="todo-list">
            {session.todos.map((t) => (
              <li
                key={t.id}
                className={`todo-${t.status === "in_progress" && !busy(session.status) ? "pending" : t.status}`}
              >
                {t.status === "in_progress" && busy(session.status) ? (
                  <span className="working-arc" />
                ) : (
                  <Icon
                    name={t.status === "completed" ? "check" : "clock"}
                    size={16}
                  />
                )}
                <span>{t.text}</span>
                {t.status === "in_progress" && (
                  <small>{busy(session.status) ? "Сейчас" : "Осталось"}</small>
                )}
              </li>
            ))}
          </ol>
          <p className="fine-print">
            План обновляет агент. Завершённый шаг не означает прохождение всех
            проверок.
          </p>
        </>
      ) : (
        <Empty icon="todo" title="План появится во время работы">
          <p>Для короткого запроса отдельный план может не понадобиться.</p>
        </Empty>
      )}
    </div>
  );
}
export function ChangesPanel({ project, run }: PanelProps) {
  const [status, setStatus] = useState<any>(),
    [diff, setDiff] = useState("");
  const projectRef = useRef(project?.id),
    diffRequest = useRef(0);
  projectRef.current = project?.id;
  const refresh = useCallback(async () => {
    if (!project) return;
    const s = await run("git.status", { projectId: project.id });
    if (s && projectRef.current === project.id) {
      setStatus(s);
      setDiff(s.diff || "");
    }
  }, [project?.id, run]);
  useEffect(() => {
    diffRequest.current++;
    setStatus(undefined);
    setDiff("");
    void refresh();
  }, [refresh]);
  return (
    <div className="panel-content changes-panel">
      <div className="panel-toolbar">
        <span>{status?.branch || "Изменения проекта"}</span>
        <IconButton
          icon="reload"
          label="Обновить Git diff"
          onClick={() => void refresh()}
        />
      </div>
      {status?.changes?.length ? (
        <div className="changed-files">
          {status.changes.map((f: any) => (
            <button
              key={f.path}
              onClick={async () => {
                const version = ++diffRequest.current;
                const r = await run("git.diff", {
                  projectId: project?.id,
                  path: f.path,
                });
                if (r && version === diffRequest.current) setDiff(r.text);
              }}
            >
              <code>{f.status}</code>
              {f.path}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted inset">
          {status?.repository === false
            ? "В этой папке Git ещё не настроен."
            : status
              ? "Изменений не обнаружено."
              : "Git-состояние не получено."}
        </p>
      )}
      <pre className="diff-content">
        {diff.split("\n").map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-remove"
                  : ""
            }
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
export function ArtifactsPanel({
  state,
  task,
  session,
  run,
  openBrowser,
  requestedArtifact,
}: PanelProps) {
  const list = state.artifacts.filter((a) => a.taskId === task?.id);
  const [selected, setSelected] = useState<Artifact>(),
    [opened, setOpened] = useState<any>();
  const [preview, setPreview] = useState(false);
  const ask = useAsk();
  const artifactRequest = useRef(0);
  useEffect(() => {
    artifactRequest.current++;
    setSelected(undefined);
    setOpened(undefined);
    setPreview(false);
  }, [task?.id]);
  const open = async (a: Artifact) => {
    const request = ++artifactRequest.current;
    setSelected(a);
    setPreview(false);
    setOpened(undefined);
    const result = await run("artifact.open", { id: a.id });
    if (result && request === artifactRequest.current) setOpened(result);
  };
  useEffect(() => {
    const a = list.find((a) => a.id === requestedArtifact?.id);
    if (a) void open(a);
  }, [requestedArtifact?.nonce, task?.id]);
  return (
    <div className="panel-content artifacts-panel">
      <div className="panel-toolbar">
        <span>Материалы задачи</span>
        <IconButton
          icon="plus"
          label="Добавить существующий файл"
          disabled={!task}
          onClick={async () => {
            const path = await ask("Путь к существующему материалу");
            if (path)
              await run("artifact.register", { taskId: task?.id, path });
          }}
        />
      </div>
      <div className="artifact-list">
        {list.map((a) => (
          <button
            key={a.id}
            className={selected?.id === a.id ? "selected" : ""}
            onClick={() => void open(a)}
          >
            <Icon name="file" />
            <span>
              {a.name}
              <small>{a.kind}</small>
            </span>
            <Icon name="chevron-right" size={14} />
          </button>
        ))}
      </div>
      {!list.length && (
        <Empty icon="file" title="Материалов пока нет">
          <p>
            Попросите агента создать документ или добавьте существующий файл.
          </p>
        </Empty>
      )}
      {selected && opened && (
        <section className="artifact-view">
          <div className="panel-toolbar">
            <strong className="truncate">{selected.name}</strong>
            <button
              onClick={() => void run("artifact.export", { id: selected.id })}
            >
              Экспорт
            </button>
            {(opened.kind === "html" || selected.path.endsWith(".html")) && (
              <button onClick={() => setPreview((x) => !x)}>
                {preview ? "Исходник" : "Статичное превью"}
              </button>
            )}
            {opened.kind === "html" && opened.url && (
              <button
                title="Открыть изолированный интерактивный просмотр в браузере"
                onClick={async () => {
                  const tab = await run("browser.create", {
                    url: opened.url,
                    title: selected.name,
                    projectId: task?.projectId,
                    sessionId: session?.id,
                    reuseKey: `artifact:${selected.id}`,
                  });
                  if (tab) openBrowser?.();
                }}
              >
                <Icon name="browser" size={14} />В браузере
              </button>
            )}
          </div>
          {preview && (opened.text || opened.url) ? (
            <iframe
              title={selected.name}
              sandbox=""
              referrerPolicy="no-referrer"
              src={opened.text ? undefined : opened.url}
              srcDoc={opened.text || undefined}
            />
          ) : opened.text !== undefined ? (
            selected.kind === "markdown" || selected.path.endsWith(".md") ? (
              <Markdown text={opened.text} />
            ) : (
              <pre>{opened.text}</pre>
            )
          ) : opened.url &&
            /\.(png|jpe?g|gif|webp|svg)$/i.test(selected.path) ? (
            <img alt={selected.name} src={opened.url} />
          ) : (
            <p className="inset">
              Просмотр этого формата недоступен. Можно экспортировать исходный
              файл.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
export { ManagedAgentsPanel as WorkersPanel } from "./ManagedAgentsPanel";
