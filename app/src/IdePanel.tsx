import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelProps } from "./Panels";
import { Empty, Icon, IconButton, Menu, useCovered } from "./ui";

export function IdePanel({ project, run, visible, state }: PanelProps) {
  const area = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState<any>();
  const [transferred, setTransferred] = useState(false);
  const covered = useCovered();
  const generation = useRef(0),
    windowId = useRef<number | undefined>(undefined);
  const ownProject = useRef(project?.id);
  ownProject.current = project?.id;
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const theme =
    state.settings.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : state.settings.theme;
  const refresh = useCallback(async () => {
    if (!project) return;
    const id = project.id,
      epoch = generation.current;
    const result = await run("ide.status", { projectId: id });
    if (ownProject.current === id && generation.current === epoch && result)
      setStatus(result);
  }, [project?.id, run]);
  const start = useCallback(async () => {
    if (!project) return;
    const id = project.id,
      epoch = ++generation.current;
    setLoading(true);
    setFailure("");
    try {
      const info = await run("app.info");
      windowId.current = info?.windowId;
      const result = await run("ide.start", { projectId: id });
      if (!result)
        throw new Error(
          "IDE не запустилась. Подробности доступны в журнале приложения.",
        );
      const actual = await run("ide.status", { projectId: id });
      if (!actual)
        throw new Error(
          "Не удалось подключиться к редактору. Повторите запуск IDE.",
        );
      if (ownProject.current === id && generation.current === epoch)
        setStatus(actual);
      await run("ide.theme", { projectId: id, theme });
    } catch (error) {
      if (ownProject.current === id && generation.current === epoch)
        setFailure(String(error));
    } finally {
      if (ownProject.current === id && generation.current === epoch)
        setLoading(false);
    }
  }, [project?.id, run]);
  useEffect(() => {
    setStatus(undefined);
    setFailure("");
    setTransferred(false);
    generation.current++;
  }, [project?.id]);
  useEffect(() => {
    if (visible && project) void start();
  }, [project?.id, visible]);
  useEffect(
    () =>
      window.workbench?.subscribe((event) => {
        if (
          event.type === "ide.owner" &&
          (event.payload as any)?.projectIds?.includes(project?.id)
        ) {
          setTransferred((event.payload as any).windowId !== windowId.current);
        }
        if (event.type === "ide.changed") {
          const engine = (event.payload as any[])?.find((value) =>
            value.projectIds.includes(project?.id),
          );
          if (engine?.error) setFailure(engine.error);
          if (engine?.status === "ready" && !status) void refresh();
        }
      }),
    [project?.id, status, refresh],
  );
  useEffect(() => {
    if (project && status)
      void run("ide.theme", { projectId: project.id, theme });
  }, [project?.id, status?.engine, theme, state.settings.theme, run]);
  const bounds = useCallback(
    async (claim = false) => {
      if (!project || !area.current) return;
      const rect = area.current.getBoundingClientRect();
      const result = await run("ide.bounds", {
        projectId: project.id,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible:
          visible &&
          !covered &&
          !transferred &&
          rect.width > 0 &&
          rect.height > 0,
        claim,
      });
      if (result?.needsTransfer) setTransferred(true);
    },
    [project?.id, visible, covered, transferred, run],
  );
  useEffect(() => {
    if (!project || !area.current || failure) return;
    const id = project.id;
    const observer = new ResizeObserver(() => void bounds());
    observer.observe(area.current);
    window.addEventListener("resize", resize);
    document.addEventListener("scroll", resize, true);
    function resize() {
      void bounds();
    }
    void bounds();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("scroll", resize, true);
      void run("ide.bounds", { projectId: id, visible: false });
    };
  }, [bounds, failure, run]);
  const command = async (id: string) => {
    if (!project) return;
    await run("ide.command", {
      projectId: project.id,
      id,
      args: [],
      focus: true,
    });
    void refresh();
  };
  if (!project)
    return (
      <Empty icon="code" title="Откройте проект">
        IDE использует файлы, настройки и окружение выбранного проекта.
      </Empty>
    );
  return (
    <div className="ide-panel">
      <div className="ide-actions" aria-label="Инструменты IDE">
        <IconButton
          icon="folder"
          label="Файлы проекта · Ctrl+Shift+E"
          onClick={() => void command("fileNavigator:toggle")}
          disabled={!status}
        />
        <IconButton
          icon="search"
          label="Поиск по проекту · Ctrl+Shift+F"
          onClick={() => void command("search-in-workspace.toggle")}
          disabled={!status}
        />
        <IconButton
          icon="branch"
          label="Git: изменения, ветки, история"
          onClick={() => void command("scmView:toggle")}
          disabled={!status}
        />
        <IconButton
          icon="debug"
          label="Запуск и отладка · Ctrl+Shift+D"
          onClick={() => void command("debug:toggle")}
          disabled={!status}
        />
        <IconButton
          icon="extensions"
          label="Расширения IDE"
          onClick={() => void command("vsxExtensions.toggle")}
          disabled={!status}
        />
        <span className="ide-actions-spacer" />
        {status?.problems &&
          (status.problems.errors > 0 || status.problems.warnings > 0) && (
            <button
              className="ide-problems"
              title="Проблемы проекта"
              onClick={() => void command("problemsView:toggle")}
            >
              <Icon name="warning" size={14} />
              {status.problems.errors || status.problems.warnings}
            </button>
          )}
        <IconButton
          icon="command"
          label="Все команды IDE · Ctrl+Shift+P"
          onClick={() => void command("workbench.action.showCommands")}
          disabled={!status}
        />
        <Menu
          items={[
            {
              label: "Быстро открыть файл · Ctrl+P",
              action: () => command("file-search.openFile"),
            },
            { label: "Обновить состояние", action: refresh },
            {
              label: "Перезапустить IDE",
              action: async () => {
                await run("ide.restart", { projectId: project.id });
                setStatus(undefined);
                await start();
              },
            },
          ]}
        />
      </div>
      <div className="ide-native-area" ref={area} aria-label="Редактор проекта">
        {transferred ? (
          <Empty icon="code" title="IDE открыта в другом окне">
            <p>Редактор и несохранённые файлы сохраняются при переносе.</p>
            <button
              className="primary"
              onClick={async () => {
                setTransferred(false);
                await run("ide.bounds", {
                  projectId: project.id,
                  visible: true,
                  claim: true,
                  ...(() => {
                    const r = area.current!.getBoundingClientRect();
                    return {
                      x: Math.round(r.x),
                      y: Math.round(r.y),
                      width: Math.round(r.width),
                      height: Math.round(r.height),
                    };
                  })(),
                });
              }}
            >
              Перенести сюда
            </button>
          </Empty>
        ) : failure ? (
          <Empty icon="warning" title="Не удалось открыть IDE">
            <p>{failure}</p>
            <button
              onClick={async () => {
                await run("ide.restart", { projectId: project.id });
                setStatus(undefined);
                await start();
              }}
            >
              Перезапустить IDE
            </button>
          </Empty>
        ) : (
          !status && (
            <div className="ide-loading">
              <span className="working-arc" />
              <span>Подготавливаем IDE</span>
              <small>Файлы, языковые инструменты и расширения проекта</small>
            </div>
          )
        )}
      </div>
    </div>
  );
}
