import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type {
  DatabaseRelationEdge,
  DatabaseRelationNode,
  DatabaseRelations as RelationGraph,
} from "../shared/database";
import { Icon, IconButton } from "./ui";
import "./database-relations.css";

type Point = { x: number; y: number };
type Positions = Record<string, Point>;
const CARD_WIDTH = 238,
  HEADER_HEIGHT = 48,
  ROW_HEIGHT = 21,
  MARGIN = 36,
  GAP = 126,
  MIN_ZOOM = 0.3,
  MAX_ZOOM = 1.6;
const height = (node: DatabaseRelationNode) =>
  HEADER_HEIGHT + Math.max(1, node.columns.length) * ROW_HEIGHT + 25;
const clampZoom = (value: number) =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
const label = (node: DatabaseRelationNode | undefined) =>
  node ? `${node.schema}.${node.name}` : "Таблица недоступна";

function arrange(graph: RelationGraph): Positions {
  const incoming = new Set(
      graph.edges
        .filter((edge) => edge.targetOid === graph.rootOid)
        .map((edge) => edge.sourceOid),
    ),
    left = graph.nodes.filter(
      (node) => node.oid !== graph.rootOid && incoming.has(node.oid),
    ),
    right = graph.nodes.filter(
      (node) => node.oid !== graph.rootOid && !incoming.has(node.oid),
    ),
    root = graph.nodes.find((node) => node.oid === graph.rootOid),
    stackHeight = (nodes: DatabaseRelationNode[]) =>
      nodes.reduce((sum, node) => sum + height(node) + 28, -28),
    contentHeight = Math.max(
      root ? height(root) : 0,
      stackHeight(left),
      stackHeight(right),
    ),
    positions: Positions = {},
    rootX = MARGIN + (left.length ? CARD_WIDTH + GAP : 0);
  for (const [nodes, x] of [
    [left, MARGIN],
    [right, rootX + CARD_WIDTH + GAP],
  ] as const) {
    let y = MARGIN + (contentHeight - Math.max(0, stackHeight(nodes))) / 2;
    for (const node of nodes) {
      positions[node.oid] = { x, y };
      y += height(node) + 28;
    }
  }
  if (root)
    positions[root.oid] = {
      x: rootX,
      y: MARGIN + (contentHeight - height(root)) / 2,
    };
  return positions;
}

function bounds(nodes: DatabaseRelationNode[], positions: Positions) {
  return {
    width: Math.max(
      340,
      ...nodes.map((node) => (positions[node.oid]?.x || 0) + CARD_WIDTH + 110),
    ),
    height: Math.max(
      240,
      ...nodes.map(
        (node) => (positions[node.oid]?.y || 0) + height(node) + MARGIN,
      ),
    ),
  };
}

function edgePath(
  edge: DatabaseRelationEdge,
  nodes: Map<string, DatabaseRelationNode>,
  positions: Positions,
  lane: number,
) {
  const source = nodes.get(edge.sourceOid),
    target = nodes.get(edge.targetOid),
    start = positions[edge.sourceOid],
    end = positions[edge.targetOid];
  if (!source || !target || !start || !end) return "";
  const columnY = (node: DatabaseRelationNode, name: string | undefined) => {
    const index = node.columns.findIndex((column) => column.name === name);
    return index < 0
      ? HEADER_HEIGHT / 2
      : HEADER_HEIGHT + (index + 0.5) * ROW_HEIGHT;
  };
  const sourceY = start.y + columnY(source, edge.columns[0]?.source),
    targetY = end.y + columnY(target, edge.columns[0]?.target);
  if (source.oid === target.oid) {
    const x = start.x + CARD_WIDTH,
      reach = 58 + (lane % 5) * 9,
      y = targetY === sourceY ? targetY + 12 : targetY;
    return `M ${x} ${sourceY} C ${x + reach} ${sourceY - 25}, ${x + reach} ${y + 25}, ${x} ${y}`;
  }
  const direction = end.x + CARD_WIDTH / 2 >= start.x + CARD_WIDTH / 2 ? 1 : -1,
    x1 = start.x + (direction === 1 ? CARD_WIDTH : 0),
    x2 = end.x + (direction === 1 ? 0 : CARD_WIDTH),
    reach = Math.max(45, Math.abs(x2 - x1) / 2),
    separation = ((lane % 5) - 2) * 5;
  return `M ${x1} ${sourceY} C ${x1 + direction * reach} ${sourceY + separation}, ${x2 - direction * reach} ${targetY + separation}, ${x2} ${targetY}`;
}

/** Actual catalog data only. This is a bounded direct FK graph, not a full ERD. */
export function DatabaseRelations({
  graph,
  open,
  refresh,
  busy,
}: {
  graph: RelationGraph;
  open: (node: DatabaseRelationNode) => void;
  refresh: () => void;
  busy: boolean;
}) {
  const initial = useMemo(() => arrange(graph), [graph]),
    nodeMap = useMemo(
      () => new Map(graph.nodes.map((node) => [node.oid, node])),
      [graph.nodes],
    ),
    shapeKey = `${graph.rootOid}:${graph.nodes.map((node) => `${node.oid}/${node.columns.length}`).join(",")}:${graph.edges.map((edge) => edge.oid).join(",")}`,
    [positions, setPositions] = useState<Positions>(initial),
    [centerExtent, setCenterExtent] = useState(() =>
      bounds(graph.nodes, initial),
    ),
    [zoom, setZoom] = useState(1),
    [selectedId, setSelectedId] = useState(""),
    [draggingId, setDraggingId] = useState<string>(),
    [viewportSize, setViewportSize] = useState({ width: 600, height: 400 }),
    viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{
      oid: string;
      pointerId: number;
      start: Point;
      position: Point;
    } | null>(null),
    svgId = useId().replace(/[^a-zA-Z0-9_-]/g, ""),
    instructionsId = `${svgId}-instructions`,
    world = bounds(graph.nodes, positions),
    padding = {
      x: Math.max(0, (viewportSize.width - centerExtent.width * zoom) / 2),
      y: Math.max(0, (viewportSize.height - centerExtent.height * zoom) / 2),
    },
    selected = graph.edges.find((edge) => edge.oid === selectedId);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const centerRoot = (
    atZoom: number,
    atPositions = positions,
    atExtent = centerExtent,
  ) => {
    const element = viewport.current,
      root = nodeMap.get(graph.rootOid),
      position = atPositions[graph.rootOid];
    if (!element || !root || !position) return;
    element.scrollTo({
      left: Math.max(
        0,
        Math.max(0, (element.clientWidth - atExtent.width * atZoom) / 2) +
          (position.x + CARD_WIDTH / 2) * atZoom -
          element.clientWidth / 2,
      ),
      top: Math.max(
        0,
        Math.max(0, (element.clientHeight - atExtent.height * atZoom) / 2) +
          (position.y + height(root) / 2) * atZoom -
          element.clientHeight / 2,
      ),
      behavior: "instant",
    });
  };

  // Refreshing the same graph retains the user's positions and zoom. A changed
  // topology starts from a deterministic layout, centered on the selected table.
  useEffect(() => {
    const layout = arrange(graph),
      size = bounds(graph.nodes, layout),
      atZoom = clampZoom(
        Math.min(
          1,
          Math.max(0.65, (viewport.current?.clientWidth || 600) / size.width),
        ),
      );
    setPositions(layout);
    setCenterExtent(size);
    setZoom(atZoom);
    setSelectedId("");
    setDraggingId(undefined);
    drag.current = null;
    const frame = requestAnimationFrame(() => centerRoot(atZoom, layout, size));
    return () => cancelAnimationFrame(frame);
  }, [shapeKey]);

  useEffect(() => {
    if (selectedId && !graph.edges.some((edge) => edge.oid === selectedId))
      setSelectedId("");
  }, [graph.edges, selectedId]);

  const changeZoom = (value: number) => {
    const element = viewport.current,
      next = clampZoom(value);
    if (!element) return;
    const center = {
      x: (element.scrollLeft + element.clientWidth / 2 - padding.x) / zoom,
      y: (element.scrollTop + element.clientHeight / 2 - padding.y) / zoom,
    };
    setZoom(next);
    requestAnimationFrame(() => {
      element.scrollLeft =
        center.x * next +
        Math.max(0, (element.clientWidth - centerExtent.width * next) / 2) -
        element.clientWidth / 2;
      element.scrollTop =
        center.y * next +
        Math.max(0, (element.clientHeight - centerExtent.height * next) / 2) -
        element.clientHeight / 2;
    });
  };
  const fit = () => {
    const next = clampZoom(
      Math.min(
        1,
        (viewportSize.width - 16) / world.width,
        (viewportSize.height - 16) / world.height,
      ),
    );
    setCenterExtent(world);
    setZoom(next);
    requestAnimationFrame(() => centerRoot(next, positions, world));
  };
  const reset = () => {
    const size = bounds(graph.nodes, initial);
    setPositions(initial);
    setCenterExtent(size);
    setZoom(1);
    requestAnimationFrame(() => centerRoot(1, initial, size));
  };
  const moveNode = (oid: string, position: Point) => {
    setPositions((old) => ({
      ...old,
      [oid]: {
        x: Math.max(16, Math.min(12000, position.x)),
        y: Math.max(16, Math.min(16000, position.y)),
      },
    }));
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, oid: string) => {
    if (event.button !== 0 || !positions[oid]) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
    drag.current = {
      oid,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      position: positions[oid],
    };
    setDraggingId(oid);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    moveNode(active.oid, {
      x: active.position.x + (event.clientX - active.start.x) / zoom,
      y: active.position.y + (event.clientY - active.start.y) / zoom,
    });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraggingId(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveByKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: DatabaseRelationNode,
  ) => {
    const point = positions[node.oid];
    if (!point) return;
    const delta = event.shiftKey ? 40 : 10,
      direction = {
        ArrowLeft: { x: -delta, y: 0 },
        ArrowRight: { x: delta, y: 0 },
        ArrowUp: { x: 0, y: -delta },
        ArrowDown: { x: 0, y: delta },
      }[event.key];
    if (direction) {
      event.preventDefault();
      moveNode(node.oid, {
        x: point.x + direction.x,
        y: point.y + direction.y,
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(node);
    } else if (event.key === "Home" && initial[node.oid]) {
      event.preventDefault();
      moveNode(node.oid, initial[node.oid]);
    }
  };
  const edgeName = (edge: DatabaseRelationEdge) =>
    `${label(nodeMap.get(edge.sourceOid))} → ${label(nodeMap.get(edge.targetOid))} · ${edge.name}`;

  return (
    <section
      className={`db-relations ${draggingId ? "dragging" : ""}`}
      data-dragging={draggingId}
      aria-label="Диаграмма внешних ключей"
    >
      <p id={instructionsId} className="db-relations-sr-only">
        Заголовок таблицы можно перетаскивать мышью или перемещать стрелками.
        Shift ускоряет перемещение. Home возвращает таблицу на место. Enter или
        двойной щелчок открывает таблицу. Выберите связь, чтобы увидеть все пары
        колонок и свойства внешнего ключа.
      </p>
      <div
        className="db-relations-toolbar"
        role="toolbar"
        aria-label="Диаграмма связей"
      >
        {!!graph.edges.length && (
          <select
            aria-label="Выбрать внешний ключ"
            value={selectedId}
            title={selected ? edgeName(selected) : "Выбрать внешний ключ"}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Выбрать связь…</option>
            {graph.edges.map((edge) => (
              <option key={edge.oid} value={edge.oid}>
                {edge.name} · {nodeMap.get(edge.sourceOid)?.name} →{" "}
                {nodeMap.get(edge.targetOid)?.name}
              </option>
            ))}
          </select>
        )}
        <span className="db-relations-toolbar-spacer" />
        <IconButton
          icon="window-minimize"
          label="Уменьшить масштаб диаграммы"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => changeZoom(zoom - 0.1)}
        />
        <button
          className="db-relations-zoom"
          title="Масштаб 100% и центр на выбранной таблице"
          onClick={() => {
            setZoom(1);
            requestAnimationFrame(() => centerRoot(1));
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          icon="plus"
          label="Увеличить масштаб диаграммы"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => changeZoom(zoom + 0.1)}
        />
        <button
          title="Вписать диаграмму в видимую область; большие схемы сохраняют прокрутку"
          onClick={fit}
        >
          Вписать
        </button>
        <IconButton
          icon="branch"
          label="Восстановить расположение таблиц"
          onClick={reset}
        />
        <IconButton
          icon="reload"
          label="Обновить связи из PostgreSQL"
          disabled={busy}
          onClick={refresh}
        />
      </div>
      <div
        ref={viewport}
        className="db-relations-viewport"
        tabIndex={0}
        role="region"
        aria-label="Полотно диаграммы; доступна прокрутка"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            changeZoom(zoom + 0.1);
          } else if (event.key === "-") {
            event.preventDefault();
            changeZoom(zoom - 0.1);
          } else if (event.key === "0") {
            event.preventDefault();
            fit();
          } else if (event.key === "Escape") setSelectedId("");
        }}
      >
        <div
          className="db-relations-stage"
          style={{
            width: world.width * zoom + padding.x,
            height: world.height * zoom + padding.y,
          }}
        >
          <div
            className="db-relations-world"
            style={{
              width: world.width,
              height: world.height,
              left: padding.x,
              top: padding.y,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              className="db-relations-lines"
              width={world.width}
              height={world.height}
              aria-label="Внешние ключи"
              role="group"
            >
              <defs>
                <marker
                  id={`${svgId}-arrow`}
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="8"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1 L 9 4 L 1 7 Z" fill="var(--control)" />
                </marker>
                <marker
                  id={`${svgId}-selected-arrow`}
                  viewBox="0 0 10 8"
                  refX="9"
                  refY="4"
                  markerWidth="8"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1 L 9 4 L 1 7 Z" fill="var(--focus)" />
                </marker>
              </defs>
              {[...graph.edges]
                .sort(
                  (a, b) =>
                    Number(a.oid === selectedId) - Number(b.oid === selectedId),
                )
                .map((edge) => {
                  const path = edgePath(
                      edge,
                      nodeMap,
                      positions,
                      graph.edges.indexOf(edge),
                    ),
                    active = edge.oid === selectedId;
                  return (
                    <g
                      key={edge.oid}
                      className={`db-relations-edge ${active ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={edgeName(edge)}
                      aria-pressed={active}
                      onClick={() => setSelectedId(edge.oid)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(edge.oid);
                        } else if (event.key === "Escape") setSelectedId("");
                      }}
                    >
                      <title>{edgeName(edge)}</title>
                      <path className="db-relations-edge-hit" d={path} />
                      <path
                        className="db-relations-edge-line"
                        d={path}
                        markerEnd={`url(#${svgId}-${active ? "selected-arrow" : "arrow"})`}
                      />
                    </g>
                  );
                })}
            </svg>
            {graph.nodes.map((node) => {
              const position = positions[node.oid] ||
                  initial[node.oid] || { x: MARGIN, y: MARGIN },
                root = node.oid === graph.rootOid,
                related =
                  selected &&
                  [selected.sourceOid, selected.targetOid].includes(node.oid);
              return (
                <article
                  key={node.oid}
                  data-oid={node.oid}
                  className={`db-relations-node ${root ? "root" : ""} ${related ? "related" : ""}`}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: CARD_WIDTH,
                    height: height(node),
                  }}
                  aria-label={label(node)}
                >
                  <div className="db-relations-node-head">
                    <button
                      className="db-relations-node-drag"
                      aria-label={`Таблица ${label(node)}${root ? ", выбранная" : ""}`}
                      aria-describedby={instructionsId}
                      title={`${label(node)} · переместить или открыть двойным щелчком`}
                      onPointerDown={(event) => startDrag(event, node.oid)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onLostPointerCapture={() => {
                        drag.current = null;
                        setDraggingId(undefined);
                      }}
                      onKeyDown={(event) => moveByKeyboard(event, node)}
                      onDoubleClick={() => open(node)}
                    >
                      <Icon name="database" size={16} />
                      <span>
                        <small>
                          {node.schema}
                          {root && (
                            <b className="db-relations-root-tag">выбрана</b>
                          )}
                        </small>
                        <strong>{node.name}</strong>
                      </span>
                    </button>
                    <IconButton
                      icon="chevron-right"
                      label={`Открыть таблицу ${label(node)}`}
                      onClick={() => open(node)}
                    />
                  </div>
                  <div className="db-relations-columns">
                    {node.columns.length ? (
                      node.columns.map((column) => (
                        <div
                          key={column.ordinal}
                          title={`${column.name}: ${column.type}${column.primaryKey ? " · PRIMARY KEY" : ""}`}
                        >
                          <span
                            className={`db-relations-key ${column.primaryKey ? "primary" : ""}`}
                            aria-label={
                              column.primaryKey ? "Первичный ключ" : undefined
                            }
                          >
                            {column.primaryKey ? "PK" : ""}
                          </span>
                          <code>{column.name}</code>
                          <span className="db-relations-column-type">
                            {column.type}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="db-relations-no-columns">
                        Нет видимых колонок
                      </div>
                    )}
                  </div>
                  <div className="db-relations-node-foot">
                    <span>
                      {node.kind === "p"
                        ? "Partitioned table"
                        : node.kind === "f"
                          ? "Foreign table"
                          : "Table"}
                    </span>
                    <span>
                      {node.columnsTruncated
                        ? `${node.columns.length} из ${node.columnCount} колонок`
                        : `${node.columnCount} колонок`}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
      {selected && (
        <div
          className="db-relations-inspector"
          role="region"
          aria-label={`Свойства внешнего ключа ${selected.name}`}
        >
          <div className="db-relations-inspector-head">
            <strong title={selected.name}>{selected.name}</strong>
            {!selected.validated && (
              <span className="db-relations-warning">NOT VALID</span>
            )}
            <span className="db-relations-toolbar-spacer" />
            <IconButton
              icon="close"
              label="Закрыть свойства внешнего ключа"
              onClick={() => setSelectedId("")}
            />
          </div>
          <div className="db-relations-targets">
            <button
              onClick={() => {
                const node = nodeMap.get(selected.sourceOid);
                if (node) open(node);
              }}
            >
              {label(nodeMap.get(selected.sourceOid))}
            </button>
            <span aria-hidden="true">→</span>
            <button
              onClick={() => {
                const node = nodeMap.get(selected.targetOid);
                if (node) open(node);
              }}
            >
              {label(nodeMap.get(selected.targetOid))}
            </button>
          </div>
          <div
            className="db-relations-column-pairs"
            aria-label="Пары колонок в порядке внешнего ключа"
          >
            {selected.columns.map((column) => (
              <code key={column.ordinal}>
                <span>{column.source}</span>
                <span aria-label="ссылается на">→</span>
                <span>{column.target}</span>
              </code>
            ))}
          </div>
          <div className="db-relations-attributes">
            <span>
              ON UPDATE <b>{selected.onUpdate}</b>
            </span>
            <span>
              ON DELETE <b>{selected.onDelete}</b>
            </span>
            <span>
              MATCH <b>{selected.match}</b>
            </span>
            <span>
              {selected.deferrable
                ? selected.initiallyDeferred
                  ? "DEFERRABLE · INITIALLY DEFERRED"
                  : "DEFERRABLE · INITIALLY IMMEDIATE"
                : "NOT DEFERRABLE"}
            </span>
            <span>
              {selected.validated
                ? "Проверен PostgreSQL"
                : "Существующие строки не проверены"}
            </span>
          </div>
        </div>
      )}
      <div className="db-relations-caption">
        <span
          className="db-relations-count"
          title="Показано / всего в прямом окружении выбранной таблицы"
        >
          {graph.nodes.length}/{graph.totals.nodes} таблиц ·{" "}
          {graph.edges.length}/{graph.totals.edges} FK
        </span>
        <span title={`Метаданные PostgreSQL: ${graph.capturedAt}`}>
          {graph.edges.length
            ? "Прямые входящие и исходящие FK выбранной таблицы"
            : "У выбранной таблицы нет внешних ключей и входящих ссылок"}
        </span>
        {graph.truncated && (
          <span
            className="db-relations-limited"
            title={`Ограничения: ${graph.limits.nodes} таблиц, ${graph.limits.edges} связей, ${graph.limits.columnsPerNode} колонок в карточке. Все пары колонок выбранного FK показаны в свойствах.`}
          >
            Показана часть метаданных
          </span>
        )}
      </div>
    </section>
  );
}
