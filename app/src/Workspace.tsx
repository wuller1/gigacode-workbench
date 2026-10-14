import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStored } from "./api";
import { IdePanel } from "./IdePanel";
import { ToolBoundary } from "./ToolBoundary";
import { plainRecord } from "./local-state";
const DatabasePanel = lazy(() =>
  import("./DatabasePanel").then((module) => ({
    default: module.DatabasePanel,
  })),
);
const JenkinsPanel = lazy(() =>
  import("./JenkinsPanel").then((module) => ({ default: module.JenkinsPanel })),
);
const ClusterPanel = lazy(() =>
  import("./ClusterPanel").then((module) => ({ default: module.ClusterPanel })),
);
import { Icon, IconButton, Menu, useLayer } from "./ui";
import {
  ArtifactsPanel,
  BrowserPanel,
  ChangesPanel,
  PlanPanel,
  TerminalPanel,
  WorkersPanel,
  type PanelProps,
} from "./Panels";
import {
  dock,
  geometry,
  group,
  groups,
  ids,
  location,
  minimum,
  normalize,
  ratio,
  remove,
  updateGroup,
  type DockId,
  type DockTree,
  type Edge,
  type Rect,
} from "./docking";
export type PanelId = Exclude<DockId, "chat">;
const panels: Record<DockId, { title: string; icon: string }> = {
  chat: { title: "Чат", icon: "chat" },
  files: { title: "IDE", icon: "code" },
  plan: { title: "План задачи", icon: "todo" },
  browser: { title: "Браузер", icon: "browser" },
  terminal: { title: "Терминал", icon: "terminal" },
  artifacts: { title: "Материалы", icon: "file" },
  changes: { title: "Изменения", icon: "diff" },
  workers: { title: "Исполнители", icon: "agents" },
  data: { title: "Базы данных", icon: "database" },
  jenkins: { title: "Jenkins", icon: "pipeline" },
  cluster: { title: "Kubernetes / OpenShift", icon: "cluster" },
};
type Layout = {
  version: 2;
  tree: DockTree | null;
  locations: Partial<
    Record<DockId, { target: DockId; edge: Edge; ratio?: number }>
  >;
};
function decodeLayout(value: unknown, fallback: Layout): Layout {
  if (!plainRecord(value) || value.version !== 2) return fallback;
  const locations: Layout["locations"] = {};
  if (plainRecord(value.locations))
    for (const [id, position] of Object.entries(value.locations))
      if (
        id in panels &&
        plainRecord(position) &&
        position.target in panels &&
        ["left", "right", "top", "bottom", "center"].includes(position.edge)
      )
        locations[id as DockId] = {
          target: position.target,
          edge: position.edge,
          ...(typeof position.ratio === "number" &&
          Number.isFinite(position.ratio)
            ? { ratio: Math.max(0.1, Math.min(0.9, position.ratio)) }
            : {}),
        };
  return {
    version: 2,
    tree:
      value.tree === null
        ? null
        : normalize(value.tree) || fallback.tree || group(["chat"]),
    locations,
  };
}
function initial(): Layout {
  try {
    const value = JSON.parse(
      localStorage.getItem("workbench.layout.v2") || "null",
    );
    if (value?.version === 2)
      return decodeLayout(value, {
        version: 2,
        tree: group(["chat"]),
        locations: {},
      });
    const old = JSON.parse(
      localStorage.getItem("workbench.layout.v1") || "null",
    );
    let tree: DockTree = group(["chat"]);
    for (const side of ["right", "bottom"])
      for (const id of Array.isArray(old?.[side]) ? old[side] : [])
        if (id in panels && id !== "chat")
          tree = dock(
            tree,
            id,
            groups(tree)[0].id,
            side === "right" ? "right" : "bottom",
          );
    return { version: 2, tree, locations: {} };
  } catch {
    return { version: 2, tree: group(["chat"]), locations: {} };
  }
}
export function Workspace({
  children,
  panelProps,
  requested,
  onRequested,
}: {
  children: ReactNode;
  panelProps: Omit<PanelProps, "visible">;
  requested?: { id: DockId; nonce: number };
  onRequested: (id: DockId) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useStored<Layout>(
    "workbench.layout.v2",
    initial(),
    { windowScoped: true, decode: decodeLayout },
  );
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [mounted, setMounted] = useState(() => new Set(ids(layout.tree)));
  const [maximized, setMaximized] = useState<DockId>();
  const [drag, setDrag] = useState<DockId>(),
    [drop, setDrop] = useState<{ target: string; edge: Edge }>();
  const [resizing, setResizing] = useState(false);
  const cleanup = useRef<(() => void) | undefined>(undefined),
    suppressClick = useRef(false);
  const min = minimum(layout.tree);
  const bounds = {
    x: 0,
    y: 0,
    width: Math.max(size.width, min.width),
    height: Math.max(size.height, min.height),
  };
  const positions = useMemo(
    () => geometry(layout.tree, bounds),
    [layout.tree, bounds.width, bounds.height],
  );
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useLayer(Boolean(drag || resizing));
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reset = () => {
      suppressClick.current = false;
    };
    const click = (e: MouseEvent) => {
      if (suppressClick.current && e.detail > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      suppressClick.current = false;
    };
    window.addEventListener("pointerdown", reset, true);
    window.addEventListener("click", click, true);
    return () => {
      cleanup.current?.();
      window.removeEventListener("pointerdown", reset, true);
      window.removeEventListener("click", click, true);
    };
  }, []);
  const place = (id: DockId, target?: string, edge: Edge = "center") => {
    setMounted((old) => new Set(old).add(id));
    setMaximized(undefined);
    setLayout((old) => ({ ...old, tree: dock(old.tree, id, target, edge) }));
  };
  const open = (id: DockId) => {
    setMounted((old) => new Set(old).add(id));
    setLayout((old) => {
      const existing = groups(old.tree).find((value) =>
        value.tabs.includes(id),
      );
      if (existing && old.tree)
        return {
          ...old,
          tree: updateGroup(old.tree, existing.id, (value) => ({
            ...value,
            active: id,
          })),
        };
      const remembered = old.locations[id],
        target =
          groups(old.tree).find((value) =>
            value.tabs.includes(remembered?.target || "chat"),
          ) || groups(old.tree)[0];
      return {
        ...old,
        tree: dock(
          old.tree,
          id,
          target?.id,
          remembered?.edge || (id === "terminal" ? "bottom" : "right"),
          remembered?.ratio ??
            (id === "files" &&
            ids(old.tree).length === 1 &&
            ids(old.tree)[0] === "chat"
              ? 0.34
              : 0.5),
        ),
      };
    });
  };
  const close = (id: DockId) => {
    setLayout((old) => {
      const remembered = location(old.tree, id);
      return {
        ...old,
        tree: remove(old.tree, id),
        locations: remembered
          ? { ...old.locations, [id]: remembered }
          : old.locations,
      };
    });
    if (maximized === id) setMaximized(undefined);
  };
  useEffect(() => {
    if (requested) open(requested.id);
  }, [requested?.nonce]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(undefined);
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        ids(layout.tree).includes("chat") ? close("chat") : open("chat");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [layout.tree]);
  function beginDrag(id: DockId, event: React.PointerEvent) {
    if (event.button !== 0 || !event.isPrimary) return;
    cleanup.current?.();
    const sx = event.clientX,
      sy = event.clientY,
      pointer = event.pointerId;
    let active = false;
    const hit = (x: number, y: number) => {
      const rect = canvas.current!.getBoundingClientRect();
      x -= rect.x;
      y -= rect.y;
      const target = positionsRef.current.groups.find(
        ({ rect: r }) =>
          x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
      );
      if (!target) return undefined;
      const r = target.rect,
        nx = (x - r.x) / r.width,
        ny = (y - r.y) / r.height;
      const edges: [Edge, number][] = [
        ["left", nx],
        ["right", 1 - nx],
        ["top", ny],
        ["bottom", 1 - ny],
      ];
      edges.sort((a, b) => a[1] - b[1]);
      return {
        target: target.group.id,
        edge: edges[0][1] < 0.24 ? edges[0][0] : ("center" as Edge),
      };
    };
    const finish = (target?: ReturnType<typeof hit>) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      cleanup.current = undefined;
      if (active) suppressClick.current = true;
      setDrag(undefined);
      setDrop(undefined);
      if (active && target) place(id, target.target, target.edge);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!active && Math.hypot(e.clientX - sx, e.clientY - sy) >= 6) {
        active = true;
        setDrag(id);
      }
      if (active) {
        e.preventDefault();
        setDrop(hit(e.clientX, e.clientY));
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === pointer)
        finish(active ? hit(e.clientX, e.clientY) : undefined);
    };
    const cancel = () => finish();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    cleanup.current = cancel;
  }
  function resize(
    split: (typeof positions.splits)[number],
    event: React.PointerEvent,
  ) {
    event.preventDefault();
    cleanup.current?.();
    setResizing(true);
    const rect = canvas.current!.getBoundingClientRect();
    const move = (e: PointerEvent) =>
      setLayout((old) => ({
        ...old,
        tree:
          old.tree &&
          ratio(
            old.tree,
            split.id,
            split.axis === "x"
              ? (e.clientX - rect.x - split.parent.x) / split.parent.width
              : (e.clientY - rect.y - split.parent.y) / split.parent.height,
          ),
      }));
    const done = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      window.removeEventListener("blur", done);
      cleanup.current = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
    window.addEventListener("blur", done);
    cleanup.current = done;
  }
  function render(id: PanelId, visible: boolean) {
    const p = { ...panelProps, visible };
    switch (id) {
      case "files":
        return <IdePanel {...p} />;
      case "data":
        return (
          <Suspense
            fallback={
              <div className="empty-state">Открываю инструменты БД…</div>
            }
          >
            <DatabasePanel {...p} />
          </Suspense>
        );
      case "jenkins":
      case "cluster": {
        const Component = id === "jenkins" ? JenkinsPanel : ClusterPanel;
        return (
          <Suspense
            fallback={<div className="empty-state">Открываю подключение…</div>}
          >
            <Component
              projectId={p.project?.id}
              sessionId={p.session?.id}
              visible={visible}
              reveal={p.requestedOps}
              onSettings={p.onSettings}
              onAssist={p.onAssist}
            />
          </Suspense>
        );
      }
      case "browser":
        return <BrowserPanel {...p} />;
      case "terminal":
        return <TerminalPanel {...p} />;
      case "plan":
        return <PlanPanel {...p} />;
      case "artifacts":
        return <ArtifactsPanel {...p} />;
      case "changes":
        return <ChangesPanel {...p} />;
      case "workers":
        return <WorkersPanel {...p} />;
    }
  }
  const style = (r: Rect) => ({
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
  });
  const shown = ids(layout.tree);
  return (
    <div className="workspace-shell desktop-workspace">
      <aside className="tool-rail" aria-label="Рабочие панели">
        {(Object.keys(panels) as DockId[]).map((id) => (
          <div key={id} onPointerDown={(e) => beginDrag(id, e)}>
            <IconButton
              icon={panels[id].icon}
              label={panels[id].title}
              className={shown.includes(id) ? "selected" : ""}
              onClick={() => {
                shown.includes(id) &&
                groups(layout.tree).some((g) => g.active === id)
                  ? close(id)
                  : open(id);
                if (id !== "chat") onRequested(id);
              }}
            />
          </div>
        ))}
        <div className="dock-rail-spacer" />
        <Menu
          label="Расположение панелей"
          items={[
            {
              label: "Чат и IDE рядом",
              action: () => {
                const chat = group(["chat"]);
                setLayout({
                  version: 2,
                  tree: dock(chat, "files", chat.id, "right"),
                  locations: {},
                });
                setMounted((old) => new Set(old).add("files"));
                setMaximized(undefined);
              },
            },
            {
              label: "Сбросить расположение",
              action: () => {
                setLayout({ version: 2, tree: group(["chat"]), locations: {} });
                setMaximized(undefined);
              },
            },
          ]}
        />
      </aside>
      <div className="dock-viewport" ref={viewport}>
        <div
          className="dock-canvas"
          ref={canvas}
          style={{ width: bounds.width, height: bounds.height }}
        >
          {!shown.length && (
            <div className="dock-empty">
              <Icon name="code" size={30} />
              <p>Выберите инструмент слева</p>
              <button onClick={() => open("chat")}>Открыть чат</button>
              <button onClick={() => open("files")}>Открыть IDE</button>
            </div>
          )}
          {positions.groups.map(({ group: g, rect }) => (
            <div
              key={g.id}
              data-dock-group={g.id}
              className="desktop-dock-header"
              style={{
                ...style(
                  maximized
                    ? { x: 0, y: 0, width: size.width, height: 34 }
                    : rect,
                ),
                height: 34,
                display:
                  maximized && !g.tabs.includes(maximized) ? "none" : undefined,
              }}
            >
              <div className="desktop-dock-tabs" role="tablist">
                {g.tabs.map((id) => (
                  <div
                    className={`desktop-dock-tab ${g.active === id ? "active" : ""}`}
                    key={id}
                  >
                    <button
                      role="tab"
                      aria-selected={g.active === id}
                      title={
                        panels[id].title +
                        " · перетащите для разделения или объединения"
                      }
                      onPointerDown={(e) => beginDrag(id, e)}
                      onClick={() =>
                        setLayout((old) => ({
                          ...old,
                          tree:
                            old.tree &&
                            updateGroup(old.tree, g.id, (v) => ({
                              ...v,
                              active: id,
                            })),
                        }))
                      }
                    >
                      <Icon name={panels[id].icon} size={14} />
                      <span>{panels[id].title}</span>
                    </button>
                    <IconButton
                      icon="close"
                      label={`Скрыть ${panels[id].title}`}
                      onClick={() => close(id)}
                    />
                  </div>
                ))}
              </div>
              <IconButton
                icon={maximized ? "window-restore" : "window-maximize"}
                label={maximized ? "Вернуть расположение" : "Развернуть панель"}
                onClick={() => setMaximized(maximized ? undefined : g.active)}
              />
              <Menu
                label="Разместить панель"
                items={[
                  ...(
                    ["left", "right", "top", "bottom", "center"] as Edge[]
                  ).flatMap((edge) =>
                    positions.groups
                      .filter(
                        (target) =>
                          target.group.id !== g.id || g.tabs.length > 1,
                      )
                      .map((target) => ({
                        label: `${{ left: "Слева", right: "Справа", top: "Сверху", bottom: "Снизу", center: "Во вкладку" }[edge]} · ${panels[target.group.active].title}`,
                        action: () => place(g.active, target.group.id, edge),
                      })),
                  ),
                  { label: "Скрыть панель", action: () => close(g.active) },
                ]}
              />
            </div>
          ))}
          {!maximized &&
            positions.splits.map((split) => (
              <div
                key={split.id}
                className={`desktop-dock-divider ${split.axis}`}
                style={style(split.rect)}
                role="separator"
                tabIndex={0}
                aria-label="Размер панелей"
                aria-orientation={
                  split.axis === "x" ? "vertical" : "horizontal"
                }
                onPointerDown={(e) => resize(split, e)}
                onKeyDown={(e) => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    setLayout((old) => ({
                      ...old,
                      tree:
                        old.tree &&
                        ratio(
                          old.tree,
                          split.id,
                          (findRatio(old.tree, split.id) || 0.5) +
                            (["ArrowRight", "ArrowDown"].includes(e.key)
                              ? 0.03
                              : -0.03),
                        ),
                    }));
                  }
                }}
              />
            ))}
          {(
            [
              "chat",
              ...Array.from(mounted).filter((id) => id !== "chat"),
            ] as DockId[]
          ).map((id) => {
            const location = positions.groups.find((value) =>
                value.group.tabs.includes(id),
              ),
              visible = Boolean(
                location &&
                (maximized ? maximized === id : location.group.active === id),
              );
            const r = maximized
              ? { x: 0, y: 34, width: size.width, height: size.height - 34 }
              : location
                ? {
                    ...location.rect,
                    y: location.rect.y + 34,
                    height: location.rect.height - 34,
                  }
                : { x: 0, y: 0, width: 0, height: 0 };
            return (
              <section
                key={id}
                className={`dock-content ${id === "chat" ? "conversation-area" : ""}`}
                aria-label={panels[id].title}
                style={{ ...style(r), display: visible ? "flex" : "none" }}
              >
                <ToolBoundary title={panels[id].title}>
                  {id === "chat" ? children : render(id, visible)}
                </ToolBoundary>
              </section>
            );
          })}
          {drag &&
            drop &&
            (() => {
              const target = positions.groups.find(
                (g) => g.group.id === drop.target,
              );
              if (!target) return null;
              const r = { ...target.rect };
              if (drop.edge === "left" || drop.edge === "right") {
                r.width /= 2;
                if (drop.edge === "right") r.x += r.width;
              }
              if (drop.edge === "top" || drop.edge === "bottom") {
                r.height /= 2;
                if (drop.edge === "bottom") r.y += r.height;
              }
              return (
                <div className="desktop-dock-drop" style={style(r)}>
                  <Icon name={panels[drag].icon} />
                  <span>
                    {drop.edge === "center"
                      ? "Объединить во вкладки"
                      : "Разделить область"}
                  </span>
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
function findRatio(tree: DockTree, id: string): number | undefined {
  return tree.kind === "group"
    ? undefined
    : tree.id === id
      ? tree.ratio
      : (findRatio(tree.a, id) ?? findRatio(tree.b, id));
}
