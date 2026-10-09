import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStored } from "./api";
import { Icon, IconButton, Menu, useLayer } from "./ui";
import {
  ArtifactsPanel,
  BrowserPanel,
  ChangesPanel,
  FilesPanel,
  PlanPanel,
  TerminalPanel,
  WorkersPanel,
  type PanelProps,
} from "./Panels";
export type PanelId =
  | "files"
  | "plan"
  | "browser"
  | "terminal"
  | "artifacts"
  | "changes"
  | "workers";
type Side = "right" | "bottom";
const panels: Record<PanelId, { title: string; icon: string }> = {
  files: { title: "Файлы", icon: "folder" },
  plan: { title: "План задачи", icon: "todo" },
  browser: { title: "Браузер", icon: "browser" },
  terminal: { title: "Терминал", icon: "terminal" },
  artifacts: { title: "Материалы", icon: "file" },
  changes: { title: "Изменения", icon: "diff" },
  workers: { title: "Исполнители", icon: "agents" },
};
interface Layout {
  right: PanelId[];
  bottom: PanelId[];
  rightActive?: PanelId;
  bottomActive?: PanelId;
  rightWidth: number;
  bottomHeight: number;
}
const initial: Layout = {
  right: [],
  bottom: [],
  rightWidth: 450,
  bottomHeight: 260,
};
export function Workspace({
  children,
  panelProps,
  requested,
  onRequested,
}: {
  children: ReactNode;
  panelProps: Omit<PanelProps, "visible">;
  requested?: { id: PanelId; nonce: number };
  onRequested: (id: PanelId) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const [layout, setLayout] = useStored<Layout>("workbench.layout.v1", initial);
  const [mounted, setMounted] = useState<Set<PanelId>>(
    () => new Set([...layout.right, ...layout.bottom]),
  );
  const [drag, setDrag] = useState<PanelId>();
  const [resizing, setResizing] = useState(false);
  const [maximized, setMaximized] = useState<PanelId>();
  useLayer(!!drag || resizing);
  const move = (id: PanelId, side: Side) => {
    setMounted((old) => new Set(old).add(id));
    setLayout((old) => ({
      ...old,
      right: old.right.filter((x) => x !== id),
      bottom: old.bottom.filter((x) => x !== id),
      [side]: [...old[side].filter((x) => x !== id), id],
      [`${side}Active`]: id,
    }));
    setDrag(undefined);
  };
  const close = (id: PanelId) => {
    setLayout((old) => ({
      ...old,
      right: old.right.filter((x) => x !== id),
      bottom: old.bottom.filter((x) => x !== id),
    }));
    if (maximized === id) setMaximized(undefined);
  };
  const toggle = (id: PanelId) => {
    const side = layout.right.includes(id)
      ? "right"
      : layout.bottom.includes(id)
        ? "bottom"
        : undefined;
    if (
      side &&
      ((side === "right" ? layout.rightActive : layout.bottomActive) ||
        layout[side][0]) === id
    )
      close(id);
    else if (side) setLayout((old) => ({ ...old, [`${side}Active`]: id }));
    else move(id, id === "terminal" ? "bottom" : "right");
  };
  useEffect(() => {
    if (!requested) return;
    const id = requested.id;
    const side = layout.right.includes(id)
      ? "right"
      : layout.bottom.includes(id)
        ? "bottom"
        : undefined;
    if (side) setLayout((old) => ({ ...old, [`${side}Active`]: id }));
    else move(id, id === "terminal" ? "bottom" : "right");
  }, [requested?.nonce]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && maximized) {
        setMaximized(undefined);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [maximized]);
  const rightActive = layout.right.includes(layout.rightActive!)
    ? layout.rightActive
    : layout.right[0];
  const bottomActive = layout.bottom.includes(layout.bottomActive!)
    ? layout.bottomActive
    : layout.bottom[0];
  const rightWidth = layout.right.length
      ? Math.min(layout.rightWidth, Math.max(240, size.width - 245))
      : 0,
    bottomHeight = layout.bottom.length
      ? Math.min(layout.bottomHeight, Math.max(130, size.height - 220))
      : 0;
  const resize = (side: Side, e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const sx = e.clientX,
      sy = e.clientY,
      rw = layout.rightWidth,
      bh = layout.bottomHeight;
    const onMove = (event: PointerEvent) =>
      setLayout((old) => ({
        ...old,
        rightWidth:
          side === "right"
            ? Math.max(
                300,
                Math.min(window.innerWidth - 340, rw + sx - event.clientX),
              )
            : old.rightWidth,
        bottomHeight:
          side === "bottom"
            ? Math.max(
                150,
                Math.min(window.innerHeight - 230, bh + sy - event.clientY),
              )
            : old.bottomHeight,
      }));
    const stop = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  };
  const header = (side: Side) => {
    const ids = layout[side],
      active = side === "right" ? rightActive : bottomActive;
    if (!ids.length) return null;
    return (
      <div
        className={`dock-header dock-${side}`}
        style={
          side === "right"
            ? { width: rightWidth, right: 0, top: 0 }
            : {
                left: 0,
                right: rightWidth ? rightWidth + 5 : 0,
                bottom: bottomHeight - 36,
              }
        }
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (drag) move(drag, side);
        }}
      >
        {ids.map((id) => (
          <div
            className={`dock-tab ${active === id ? "active" : ""}`}
            key={id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", id);
              setDrag(id);
            }}
            onDragEnd={() => setDrag(undefined)}
          >
            <button
              onClick={() =>
                setLayout((old) => ({ ...old, [`${side}Active`]: id }))
              }
            >
              <Icon name={panels[id].icon} size={15} />
              <span>{panels[id].title}</span>
            </button>
            <IconButton
              icon="close"
              label={`Скрыть ${panels[id].title}`}
              onClick={() => close(id)}
            />
          </div>
        ))}
        <div className="dock-spacer" />
        {active && (
          <>
            <IconButton
              icon="window-maximize"
              label="Развернуть панель"
              onClick={() => setMaximized(active)}
            />
            <Menu
              label="Переместить панель"
              items={[
                {
                  label:
                    side === "right"
                      ? "Переместить вниз"
                      : "Переместить вправо",
                  action: () =>
                    move(active, side === "right" ? "bottom" : "right"),
                },
                { label: "Скрыть панель", action: () => close(active) },
                {
                  label: "Сбросить расположение",
                  action: () => setLayout(initial),
                },
              ]}
            />
          </>
        )}
      </div>
    );
  };
  const render = (id: PanelId, visible: boolean) => {
    const props = { ...panelProps, visible };
    switch (id) {
      case "browser":
        return <BrowserPanel {...props} />;
      case "terminal":
        return <TerminalPanel {...props} />;
      case "files":
        return <FilesPanel {...props} />;
      case "plan":
        return <PlanPanel {...props} />;
      case "artifacts":
        return <ArtifactsPanel {...props} />;
      case "changes":
        return <ChangesPanel {...props} />;
      case "workers":
        return <WorkersPanel {...props} />;
    }
  };
  return (
    <div className="workspace-shell">
      <div
        className="workspace"
        ref={area}
        style={
          {
            "--dock-right": `${rightWidth}px`,
            "--dock-bottom": `${bottomHeight}px`,
          } as React.CSSProperties
        }
      >
        <main
          className="conversation-area"
          style={{
            right: rightWidth ? rightWidth + 5 : 0,
            bottom: bottomHeight ? bottomHeight + 5 : 0,
            visibility: maximized ? "hidden" : "visible",
          }}
        >
          {children}
        </main>
        {!maximized && (
          <>
            {header("right")}
            {header("bottom")}
            {rightWidth > 0 && (
              <div
                role="separator"
                aria-label="Ширина панели"
                aria-orientation="vertical"
                tabIndex={0}
                className="resize-handle resize-right"
                style={{ right: rightWidth }}
                onPointerDown={(e) => resize("right", e)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    setLayout((old) => ({
                      ...old,
                      rightWidth: Math.max(
                        300,
                        old.rightWidth + (e.key === "ArrowLeft" ? 20 : -20),
                      ),
                    }));
                  }
                }}
              />
            )}{" "}
            {bottomHeight > 0 && (
              <div
                role="separator"
                aria-label="Высота панели"
                aria-orientation="horizontal"
                tabIndex={0}
                className="resize-handle resize-bottom"
                style={{
                  bottom: bottomHeight,
                  right: rightWidth ? rightWidth + 5 : 0,
                }}
                onPointerDown={(e) => resize("bottom", e)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setLayout((old) => ({
                      ...old,
                      bottomHeight: Math.max(
                        150,
                        old.bottomHeight + (e.key === "ArrowUp" ? 20 : -20),
                      ),
                    }));
                  }
                }}
              />
            )}
          </>
        )}
        {maximized && (
          <div className="maximized-header">
            <Icon name={panels[maximized].icon} />
            <strong>{panels[maximized].title}</strong>
            <span />
            <IconButton
              icon="window-restore"
              label="Вернуть расположение · Escape"
              onClick={() => setMaximized(undefined)}
            />
            <IconButton
              icon="close"
              label="Скрыть панель"
              onClick={() => close(maximized)}
            />
          </div>
        )}
        {Array.from(mounted).map((id) => {
          const side = layout.right.includes(id)
            ? "right"
            : layout.bottom.includes(id)
              ? "bottom"
              : undefined;
          const visible = maximized
            ? maximized === id
            : side === "right"
              ? rightActive === id
              : side === "bottom"
                ? bottomActive === id
                : false;
          const style: React.CSSProperties =
            maximized === id
              ? { left: 0, right: 0, top: 36, bottom: 0 }
              : side === "right"
                ? { right: 0, width: rightWidth, top: 36, bottom: 0 }
                : {
                    left: 0,
                    right: rightWidth ? rightWidth + 5 : 0,
                    bottom: 0,
                    height: bottomHeight - 36,
                  };
          return (
            <section
              key={id}
              className="dock-content"
              aria-label={panels[id].title}
              style={{ ...style, display: visible ? "flex" : "none" }}
            >
              {render(id, visible)}
            </section>
          );
        })}
        {drag && (
          <div className="dock-drop-overlay">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                move(drag, "right");
              }}
            >
              Поместить справа
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                move(drag, "bottom");
              }}
            >
              Поместить снизу
            </div>
          </div>
        )}
      </div>
      <aside className="tool-rail" aria-label="Рабочие панели">
        {(Object.keys(panels) as PanelId[]).map((id) => (
          <IconButton
            key={id}
            icon={panels[id].icon}
            label={panels[id].title}
            className={
              layout.right.includes(id) || layout.bottom.includes(id)
                ? "selected"
                : ""
            }
            onClick={() => {
              toggle(id);
              onRequested(id);
            }}
          />
        ))}
      </aside>
    </div>
  );
}
