import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "sql-formatter";
import type {
  DatabaseSnapshot,
  DatabaseConsole,
  DatabaseObject,
  DatabaseChange,
  DatabaseJob,
  DatabaseResult,
} from "../shared/database";
import { statementAt } from "../shared/sql";
import { useStored } from "./api";
import type { PanelProps } from "./Panels";
import { Empty, Icon, IconButton, Menu, Modal, useAsk } from "./ui";
import { DatabaseEffect } from "./DatabaseEffect";
import { DatabaseHistory } from "./DatabaseHistory";
import { SqlPlan } from "./SqlPlan";
import { SqlEditor } from "./SqlEditor";
import "./database.css";
const dataCall = (method: string, params: Record<string, unknown>) => {
  if (!window.workbench) throw new Error("Связь с desktop host недоступна");
  return window.workbench.invoke(method, params);
};
const empty: DatabaseSnapshot = {
  connections: [],
  consoles: [],
  leases: [],
  jobs: [],
};
export function DatabasePanel({ project, session, visible }: PanelProps) {
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot>(empty),
    [selected, setSelected] = useStored<Record<string, string>>(
      "database.selected.v1",
      {},
    ),
    [tree, setTree] = useStored("database.tree", true),
    [search, setSearch] = useState(""),
    [schema, setSchema] = useState("public"),
    [catalog, setCatalog] = useState<{
      schemas: { name: string }[];
      objects: DatabaseObject[];
    }>({ schemas: [], objects: [] }),
    [error, setError] = useState(""),
    [dismissedJob, setDismissedJob] = useState<string>(),
    [table, setTable] = useState<Record<string, any>>({}),
    [detail, setDetail] = useState<Record<string, any>>({}),
    [view, setView] = useState("data"),
    [page, setPage] = useState<any>(),
    [offset, setOffset] = useState(0),
    [pageSize, setPageSize] = useStored("database.pageSize", 200),
    [resultId, setResultId] = useState(""),
    [changes, setChanges] = useState<Record<string, DatabaseChange[]>>({}),
    [edit, setEdit] = useState<{
      row: number;
      column: string;
      text: string;
      null: boolean;
      default?: boolean;
    }>(),
    [fileDialog, setFileDialog] = useState<"import" | "export">(),
    [fileFormat, setFileFormat] = useState("csv"),
    [fileHeader, setFileHeader] = useState(true),
    [mapping, setMapping] = useState(""),
    [delimiter, setDelimiter] = useState(","),
    [encoding, setEncoding] = useState("utf8"),
    [filter, setFilter] = useState<
      { column: string; operator: string; value?: string }[]
    >([]),
    [filterOpen, setFilterOpen] = useState(false),
    [filterColumn, setFilterColumn] = useState(""),
    [filterOperator, setFilterOperator] = useState("="),
    [filterValue, setFilterValue] = useState(""),
    [exportAll, setExportAll] = useState(false),
    [exportTableName, setExportTableName] = useState("exported_result"),
    [sort, setSort] = useState(""),
    [descending, setDescending] = useState(false),
    [navWidth, setNavWidth] = useStored("database.navigator.width", 224),
    [editorHeight, setEditorHeight] = useStored("database.editor.height", 260),
    [history, setHistory] = useState(false),
    [metrics, setMetrics] = useState<any>();
  const catalogKey = useRef("");
  const lastSelectedQuery = useRef<Record<string, string>>({});
  const awaitingQuery = useRef<Record<string, string>>({});
  const submittedChanges = useRef<
    Record<string, { operationId: string; body: string }>
  >({});
  const currentProject = useRef(project?.id),
    refreshing = useRef(false),
    revision = useRef(0);
  currentProject.current = project?.id;
  const active =
      snapshot.consoles.find(
        (c) => c.id === selected[project?.id || ""] && !c.closed,
      ) || snapshot.consoles.find((c) => !c.closed),
    activeId = useRef(active?.id);
  activeId.current = active?.id;
  const lease = snapshot.leases.find((l) => l.id === active?.leaseId),
    connection = snapshot.connections.find(
      (c) => c.id === active?.connectionId,
    ),
    jobs = snapshot.jobs.filter((j) => j.consoleId === active?.id),
    job = jobs.at(-1),
    busy =
      lease?.busy ||
      job?.status === "running" ||
      active?.pendingEffect?.phase === "submitting",
    t = active ? table[active.id] : undefined,
    d = active ? detail[active.id] : undefined,
    staged = changes[active?.id || ""] || [],
    ask = useAsk();
  const refresh = useCallback(async () => {
    if (!project || refreshing.current) return;
    const pid = project.id;
    refreshing.current = true;
    try {
      const next = await dataCall("database.snapshot", { projectId: pid });
      if (currentProject.current === pid) {
        setSnapshot(next);
        revision.current++;
      }
    } catch (e: any) {
      if (currentProject.current === pid) setError(e.message);
    } finally {
      refreshing.current = false;
    }
  }, [project?.id]);
  useEffect(() => {
    for (const c of snapshot.consoles) {
      const submitted = submittedChanges.current[c.id];
      if (
        submitted &&
        c.lastResolution?.operationId === submitted.operationId
      ) {
        delete submittedChanges.current[c.id];
        if (c.lastResolution.outcome === "applied")
          setChanges((s) => ({ ...s, [c.id]: [] }));
      }
    }
  }, [snapshot.consoles]);
  useEffect(() => {
    setSnapshot(empty);
    setCatalog({ schemas: [], objects: [] });
    setPage(undefined);
    setResultId("");
    void refresh();
  }, [project?.id]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (visible) void refresh();
    }, 1200);
    const unsub = window.workbench?.subscribe((e) => {
      if (
        e.type === "database.changed" &&
        (!(e.payload as any)?.projectId ||
          (e.payload as any).projectId === currentProject.current)
      )
        void refresh();
    });
    return () => {
      clearInterval(timer);
      unsub?.();
    };
  }, [refresh, visible]);
  const attempt = async (fn: () => Promise<any>) => {
    setError("");
    try {
      return await fn();
    } catch (e: any) {
      setError(e.message);
      return undefined;
    }
  };
  const invoke = async (
    op: string,
    p: Record<string, unknown> = {},
    consoleId = active?.id,
  ) => {
    if (!project) throw new Error("Выберите проект");
    return dataCall("database." + op, {
      projectId: project.id,
      consoleId,
      ...p,
    });
  };
  useEffect(() => {
    if (!active || lease) return;
    let cancelled = false;
    void invoke("history.load", {}, active.id)
      .then(() => {
        if (!cancelled) void refresh();
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, !!lease]);
  const activate = (c: DatabaseConsole) => {
    setSelected((s) => ({ ...s, [project!.id]: c.id }));
    setOffset(0);
    setEdit(undefined);
    setResultId("");
    setView("data");
    setFilter([]);
    setSort("");
  };
  const create = async (
    connectionId: string,
    sql = "",
    title?: string,
    object?: { oid: string; kind: string },
  ) => {
    const c = await invoke("console.create", {
      connectionId,
      sql,
      title,
      object,
    });
    activate(c);
    await refresh();
    return c;
  };
  const connect = async (c = active) => {
    if (!c) return;
    if (!c.leaseId) await invoke("console.open", {}, c.id);
    await refresh();
  };
  const loadCatalog = async () => {
    if (!active?.leaseId) return;
    const id = active.id,
      r = await invoke("catalog", { schema });
    if (activeId.current === id) {
      setCatalog(r);
      catalogKey.current = id + ":" + schema;
    }
  };
  useEffect(() => {
    if (
      active?.leaseId &&
      !busy &&
      catalogKey.current !== active.id + ":" + schema
    )
      void attempt(loadCatalog);
  }, [snapshot, active?.id, active?.leaseId, schema, !!busy]);
  useEffect(() => {
    const id = active?.id;
    if (!id) return;
    const own = snapshot.jobs
        .filter((j) => j.consoleId === id && j.kind === "query")
        .at(-1),
      r = own?.results.at(-1);
    if (awaitingQuery.current[id] && awaitingQuery.current[id] !== own?.id)
      return;
    if (
      r &&
      own?.status !== "running" &&
      (lastSelectedQuery.current[id] !== own?.id ||
        !resultId ||
        !snapshot.jobs.some(
          (j) => j.consoleId === id && j.results.some((v) => v.id === resultId),
        ))
    ) {
      lastSelectedQuery.current[id] = own!.id;
      delete awaitingQuery.current[id];
      setResultId(r.id);
      setOffset(0);
    }
  }, [active?.id, job?.id, job?.status, resultId]);
  const jobError =
    job?.error &&
    ["failed", "unknown"].includes(job.status) &&
    dismissedJob !== job.id
      ? (job.error.code ? job.error.code + " · " : "") + job.error.message
      : undefined;
  const result = jobs.flatMap((j) => j.results).find((r) => r.id === resultId);
  const resultJob = jobs.find((j) => j.results.some((r) => r.id === resultId));
  useEffect(() => {
    setPage(undefined);
    if (!resultId || !result || !active) return;
    let cancelled = false;
    void attempt(async () => {
      const r = await invoke("page", {
        resultId,
        offset,
        limit: Math.min(pageSize, result?.source?.pageSize || pageSize),
      });
      if (!cancelled) setPage(r);
    });
    return () => {
      cancelled = true;
    };
  }, [
    resultId,
    offset,
    active?.id,
    result?.rows,
    result?.fields.length,
    resultJob?.status,
    pageSize,
  ]);
  const runSql = async (sql: string, consoleId = active?.id) => {
    setError("");
    setDismissedJob(job?.id);
    if (!consoleId) return;
    const c = snapshot.consoles.find((x) => x.id === consoleId);
    await connect(c);
    const r = await invoke(
      "execute",
      { sql, operationId: crypto.randomUUID() },
      consoleId,
    );
    awaitingQuery.current[consoleId] = r.id;
    setResultId("");
    setOffset(0);
    await refresh();
    return r;
  };
  useEffect(() => {
    const c = active;
    if (!c?.object || !c.leaseId || busy || table[c.id] || detail[c.id]) return;
    void attempt(async () => {
      const definition = await invoke(
        "describe",
        { oid: c.object!.oid, kind: c.object!.kind },
        c.id,
      );
      if (["function", "procedure"].includes(c.object!.kind))
        setDetail((v) => ({ ...v, [c.id]: definition }));
      else setTable((v) => ({ ...v, [c.id]: definition }));
    });
  }, [active?.id, active?.leaseId, !!busy]);
  useEffect(() => {
    const c = active;
    if (
      !c?.object ||
      !["function", "procedure"].includes(c.object.kind) ||
      job?.status !== "completed"
    )
      return;
    void attempt(async () => {
      const definition = await invoke(
        "describe",
        { oid: c.object!.oid, kind: c.object!.kind },
        c.id,
      );
      setDetail((v) => ({
        ...v,
        [c.id]: job.routine
          ? {
              ...definition,
              hash: job.routine.appliedHash,
              externalChange: definition.hash !== job.routine.appliedHash,
            }
          : definition,
      }));
    });
  }, [active?.id, job?.id, job?.status]);
  const openObject = async (o: DatabaseObject) => {
    if (!active) return;
    const connectionId = active.connectionId;
    const existing = snapshot.consoles.find(
      (c) =>
        !c.closed && c.connectionId === connectionId && c.object?.oid === o.oid,
    );
    if (existing) {
      activate(existing);
      return;
    }
    const definition = await invoke("describe", { oid: o.oid, kind: o.kind });
    const isTable = [
        "table",
        "view",
        "materialized view",
        "foreign table",
      ].includes(o.kind),
      routine = ["function", "procedure"].includes(o.kind);
    const c = await create(
      connectionId,
      routine ? definition.ddl : "",
      o.name,
      { oid: o.oid, kind: o.kind },
    );
    await connect(c);
    if (isTable) {
      setTable((v) => ({ ...v, [c.id]: definition }));
      await invoke(
        "table",
        { oid: o.oid, operationId: crypto.randomUUID() },
        c.id,
      );
      await refresh();
    } else {
      setDetail((v) => ({ ...v, [c.id]: definition }));
      setView("ddl");
    }
  };
  const reloadTable = async (
    serverOffset = result?.source?.offset || 0,
    source?: DatabaseResult["source"],
  ) => {
    if (!t) return;
    const filters = source ? source.filter || [] : filter;
    const r = await invoke("table", {
      oid: t.oid,
      filter: filters,
      sort: source ? source.sort : sort || undefined,
      descending: source ? source.descending : descending,
      limit: source?.pageSize || pageSize,
      offset: serverOffset,
      operationId: crypto.randomUUID(),
    });
    setResultId("");
    setOffset(0);
    await refresh();
    return r;
  };
  const apply = async () => {
    const id = active!.id,
      body = JSON.stringify(staged),
      old = submittedChanges.current[id];
    const operationId =
      old?.body === body ? old.operationId : crypto.randomUUID();
    submittedChanges.current[id] = { operationId, body };
    try {
      await invoke("changes", { oid: t.oid, changes: staged, operationId });
    } catch (error) {
      const current = await invoke("console.read").catch(() => undefined);
      if (current?.pendingEffect) {
        await refresh();
        return;
      }
      if (current) delete submittedChanges.current[id];
      throw error;
    }
    delete submittedChanges.current[id];
    setChanges((s) => ({ ...s, [id]: [] }));
    await reloadTable();
  };
  const rowKeyCount =
    result?.source &&
    page?.fields
      ?.slice(0, 3)
      .map((f: any) => f.name)
      .join(",") === "__wb_tableoid,__wb_ctid,__wb_xmin"
      ? 3
      : 0;
  const visibleFields = (page?.fields || [])
    .slice(rowKeyCount)
    .map((f: any, index: number) => ({ ...f, index: index + rowKeyCount }));
  const keyFor = (row: any[]) => ({
    tableoid:
      row[page.fields.findIndex((f: any) => f.name === "__wb_tableoid")],
    ctid: row[page.fields.findIndex((f: any) => f.name === "__wb_ctid")],
    xmin: row[page.fields.findIndex((f: any) => f.name === "__wb_xmin")],
  });
  const commitEdit = () => {
    if (!edit || !active || !page) return;
    const inserted =
      edit.row >= page.values.length
        ? staged.filter((c) => c.kind === "insert")[
            edit.row - page.values.length
          ]
        : undefined;
    const key = inserted ? undefined : keyFor(page.values[edit.row]),
      value = edit.default
        ? { default: true as const }
        : edit.null
          ? null
          : edit.text;
    setChanges((s) => {
      const own = [...(s[active.id] || [])],
        index = inserted
          ? own.indexOf(inserted)
          : own.findIndex(
              (c) =>
                c.kind === "update" &&
                c.key?.ctid === key?.ctid &&
                c.key?.tableoid === key?.tableoid,
            );
      if (index >= 0)
        own[index] = {
          ...own[index],
          values: { ...own[index].values, [edit.column]: value },
        };
      else own.push({ kind: "update", key, values: { [edit.column]: value } });
      return { ...s, [active.id]: own };
    });
    setEdit(undefined);
  };
  const canEdit =
    !active?.pendingEffect &&
    !!result?.source &&
    !!t &&
    ["r", "p"].includes(t.kind) &&
    !lease?.readOnly &&
    page?.fields?.some((f: any) => f.name === "__wb_xmin");
  const close = async (c: DatabaseConsole) => {
    if (
      (changes[c.id] || []).length &&
      !(await ask("Скрыть вкладку с несохранёнными строками?", {
        confirm: true,
        message: "Изменения останутся в этой вкладке до применения или отмены.",
      }))
    )
      return;
    await invoke(
      "console.update",
      { revision: c.revision, closed: true },
      c.id,
    );
    await refresh();
  };
  const resize = (event: React.PointerEvent, axis: "x" | "y") => {
    event.preventDefault();
    const origin = axis === "x" ? event.clientX : event.clientY,
      start = axis === "x" ? navWidth : editorHeight;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const value = Math.max(
        axis === "x" ? 160 : 120,
        Math.min(
          axis === "x" ? 460 : 650,
          start + (axis === "x" ? e.clientX : e.clientY) - origin,
        ),
      );
      axis === "x" ? setNavWidth(value) : setEditorHeight(value);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };
  if (!project)
    return (
      <Empty icon="database" title="Выберите проект">
        Подключения и консоли БД привязаны к проекту.
      </Empty>
    );
  return (
    <div className="database-workspace" data-testid="database-workspace">
      {active?.pendingEffect && (
        <DatabaseEffect
          key={active.id + active.pendingEffect.operationId}
          effect={active.pendingEffect}
          read={() => invoke("effect.read")}
          resolve={async (outcome, note) => {
            const r = await invoke("effect.resolve", {
              operationId: active.pendingEffect!.operationId,
              outcome,
              note,
            });
            delete submittedChanges.current[active.id];
            if (outcome === "applied")
              setChanges((s) => ({ ...s, [active.id]: [] }));
            await refresh();
            return r;
          }}
        />
      )}
      <div className="db-target">
        <IconButton
          icon="panel-left"
          label={tree ? "Скрыть дерево БД" : "Показать дерево БД"}
          onClick={() => setTree(!tree)}
        />
        <select
          aria-label="Подключение БД"
          value={connection?.id || ""}
          onChange={(e) => void attempt(() => create(e.target.value))}
        >
          <option value="" disabled>
            Подключение
          </option>
          {snapshot.connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.environment ? " · " + c.environment : ""}
            </option>
          ))}
        </select>
        <span
          className={"db-link-state " + (lease ? "connected" : "")}
          title={lease?.server || "Нет соединения"}
        >
          {lease?.database || connection?.database || "MCP"}
        </span>
        <div className="db-spacer" />
        <span
          className="muted"
          title="Агент использует те же консоли и результаты"
        >
          {session?.title || "Без активного разговора"}
        </span>
        <Menu
          label="Инструменты базы данных"
          items={[
            {
              label: "Новая SQL-консоль",
              disabled: !connection,
              action: () => void attempt(() => create(connection!.id)),
            },
            {
              label: "Подключиться",
              disabled: !active || !!lease,
              action: () => void attempt(() => connect()),
            },
            {
              label: "Disconnect · откатить транзакцию",
              disabled: !active?.leaseId || !!busy,
              action: () =>
                void attempt(async () => {
                  await invoke("console.disconnect");
                  await refresh();
                }),
            },
            { label: "История SQL", action: () => setHistory(true) },
            {
              label: "Диагностика движка БД",
              disabled: !lease,
              action: () =>
                void attempt(async () => setMetrics(await invoke("metrics"))),
            },
            {
              label: "Восстановить конфликтный SQL",
              action: () =>
                void attempt(async () => {
                  const recoveries = await invoke("recovery.list");
                  const last = recoveries.at(-1);
                  if (!last) {
                    setError("Сохранённых конфликтных черновиков нет");
                    return;
                  }
                  const restored = await invoke("recovery.restore", {
                    id: last.id,
                  });
                  activate(restored);
                  await refresh();
                }),
            },
            {
              label: "Закрытые вкладки",
              action: () =>
                void attempt(async () => {
                  const c = snapshot.consoles.filter((c) => c.closed).at(-1);
                  if (c) {
                    await invoke(
                      "console.update",
                      { closed: false, revision: c.revision },
                      c.id,
                    );
                    activate(c);
                    await refresh();
                  }
                }),
            },
          ]}
        />
      </div>
      {snapshot.connections.length === 0 ? (
        <Empty icon="database" title="Добавьте подключение в настройках">
          Настройки → Подключения БД. Можно использовать один профиль в
          нескольких проектах. Здесь появятся только настоящие данные сервера.
        </Empty>
      ) : (
        <div className="db-body">
          {tree && (
            <>
              <aside className="db-navigator" style={{ width: navWidth }}>
                <div className="db-tree-tools">
                  <input
                    aria-label="Поиск объекта БД"
                    placeholder="Найти объект…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <IconButton
                    icon="reload"
                    label="Обновить схему"
                    disabled={!lease || !!busy}
                    onClick={() => void attempt(loadCatalog)}
                  />
                </div>
                <select
                  aria-label="Видимая схема"
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                >
                  {[
                    ...new Set([schema, ...catalog.schemas.map((s) => s.name)]),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <div className="db-object-tree">
                  {catalog.objects
                    .filter((o) =>
                      o.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((o) => (
                      <button
                        key={o.kind + o.oid}
                        title={o.schema + "." + o.name}
                        onDoubleClick={() => void attempt(() => openObject(o))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            void attempt(() => openObject(o));
                        }}
                      >
                        <Icon
                          name={
                            ["function", "procedure"].includes(o.kind)
                              ? "code"
                              : "database"
                          }
                          size={15}
                        />
                        <span>{o.name}</span>
                        <small>{o.kind}</small>
                      </button>
                    ))}
                  {!lease && (
                    <p className="muted">
                      Подключите консоль, чтобы загрузить объекты.
                    </p>
                  )}
                </div>
              </aside>
              <div
                className="db-resize-x"
                role="separator"
                aria-label="Ширина дерева БД"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={(e) => resize(e, "x")}
                onKeyDown={(e) => {
                  if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                    e.preventDefault();
                    setNavWidth((v) =>
                      Math.max(
                        160,
                        Math.min(460, v + (e.key === "ArrowRight" ? 16 : -16)),
                      ),
                    );
                  }
                }}
              />
            </>
          )}
          <main className="db-main">
            <div className="db-document-tabs" role="tablist">
              {snapshot.consoles
                .filter((c) => !c.closed)
                .map((c) => (
                  <div
                    className={c.id === active?.id ? "active" : ""}
                    key={c.id}
                  >
                    <button
                      role="tab"
                      aria-selected={c.id === active?.id}
                      onClick={() => activate(c)}
                      onDoubleClick={() =>
                        void attempt(async () => {
                          const name = await ask("Название SQL-консоли", {
                            value: c.title,
                          });
                          if (name)
                            await invoke(
                              "console.update",
                              { title: name, revision: c.revision },
                              c.id,
                            );
                          await refresh();
                        })
                      }
                    >
                      {snapshot.jobs.some(
                        (j) => j.consoleId === c.id && j.status === "running",
                      ) && <span className="working-arc" />}
                      {c.title}
                    </button>
                    <IconButton
                      icon="close"
                      label={"Закрыть " + c.title}
                      onClick={() => void attempt(() => close(c))}
                    />
                  </div>
                ))}
              <IconButton
                icon="plus"
                label="Новая SQL-консоль"
                onClick={() =>
                  void attempt(() =>
                    create(connection?.id || snapshot.connections[0].id),
                  )
                }
              />
            </div>
            {!active ? (
              <Empty icon="code" title="Откройте SQL-консоль">
                Нажмите плюс или откройте объект дерева двойным щелчком.
              </Empty>
            ) : (
              <>
                <ConsoleEditor
                  key={active.id}
                  console={active}
                  table={t}
                  detail={d}
                  job={job}
                  names={catalog.objects.map((o) => o.name)}
                  height={editorHeight}
                  busy={!!busy}
                  lease={lease}
                  onError={setError}
                  refresh={refresh}
                  invoke={(op: string, p: Record<string, unknown>) =>
                    invoke(op, p, active.id)
                  }
                  runSql={(sql: string) => runSql(sql, active.id)}
                  saveCopy={(sql: string) =>
                    attempt(() =>
                      create(
                        active.connectionId,
                        sql,
                        active.title + " · копия",
                      ),
                    )
                  }
                />
                <div
                  className="db-resize-y"
                  role="separator"
                  aria-label="Высота SQL редактора"
                  aria-orientation="horizontal"
                  tabIndex={0}
                  onPointerDown={(e) => resize(e, "y")}
                  onKeyDown={(e) => {
                    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
                      e.preventDefault();
                      setEditorHeight((v) =>
                        Math.max(
                          120,
                          Math.min(650, v + (e.key === "ArrowDown" ? 20 : -20)),
                        ),
                      );
                    }
                  }}
                />
                <div className="db-result-tabs" role="tablist">
                  <button
                    className={view === "data" ? "active" : ""}
                    onClick={() => setView("data")}
                  >
                    Данные
                  </button>
                  {(t || d) &&
                    ["structure", "ddl", "dependencies"].map((v) => (
                      <button
                        key={v}
                        className={view === v ? "active" : ""}
                        onClick={() => setView(v)}
                      >
                        {
                          {
                            structure: "Структура",
                            ddl: "DDL",
                            dependencies: "Связи",
                          }[v]
                        }
                      </button>
                    ))}
                  {result?.fields[0]?.name === "QUERY PLAN" && (
                    <button
                      className={view === "plan" ? "active" : ""}
                      onClick={() => setView("plan")}
                    >
                      План выполнения
                    </button>
                  )}
                  <button
                    className={view === "output" ? "active" : ""}
                    onClick={() => setView("output")}
                  >
                    Вывод{job?.status === "running" ? " · выполняется" : ""}
                  </button>
                  <div className="db-spacer" />
                  {jobs
                    .filter((j) => j.kind === "query")
                    .flatMap((j) => j.results).length > 1 && (
                    <select
                      aria-label="Результат запроса"
                      value={resultId}
                      onChange={(e) => {
                        setResultId(e.target.value);
                        setOffset(0);
                      }}
                    >
                      {jobs
                        .filter((j) => j.kind === "query")
                        .flatMap((j) =>
                          j.results.map((r, i) => (
                            <option key={r.id} value={r.id}>
                              {new Date(j.startedAt).toLocaleTimeString(
                                "ru-RU",
                                { hour12: false },
                              )}{" "}
                              · {r.command || "Результат"} {i + 1} · {r.rows}
                            </option>
                          )),
                        )}
                    </select>
                  )}
                </div>
                {resultJob &&
                  ["failed", "cancelled", "unknown"].includes(
                    resultJob.status,
                  ) && (
                    <div className="db-effect" role="status">
                      Частичный результат · {status(resultJob)}. Показаны только
                      полученные строки.
                    </div>
                  )}
                {view === "data" ? (
                  <>
                    <div className="db-grid-toolbar">
                      {t && (
                        <>
                          <IconButton
                            icon="reload"
                            label="Обновить данные таблицы"
                            disabled={!!busy || !!staged.length}
                            onClick={() => void attempt(reloadTable)}
                          />
                          <button
                            aria-expanded={filterOpen}
                            title="Фильтровать таблицу на сервере"
                            onClick={() => setFilterOpen((v) => !v)}
                          >
                            Фильтр{filter.length ? " · " + filter.length : ""}
                          </button>
                          <select
                            aria-label="Сортировка таблицы"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="">Без сортировки</option>
                            {t.columns?.map((c: any) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                          </select>
                          <IconButton
                            icon={descending ? "chevron-down" : "chevron-up"}
                            label={
                              descending ? "По убыванию" : "По возрастанию"
                            }
                            onClick={() => setDescending(!descending)}
                          />
                        </>
                      )}
                      {canEdit && (
                        <>
                          <IconButton
                            icon="plus"
                            label="Добавить строку DEFAULT"
                            onClick={() =>
                              setChanges((s) => ({
                                ...s,
                                [active.id]: [
                                  ...(s[active.id] || []),
                                  { kind: "insert", values: {} },
                                ],
                              }))
                            }
                          />
                          <button
                            disabled={!staged.length || !!busy}
                            onClick={() => void attempt(apply)}
                          >
                            Применить
                            {staged.length ? " · " + staged.length : ""}
                          </button>
                          <IconButton
                            icon="stop"
                            label="Отменить локальные изменения"
                            disabled={!staged.length}
                            onClick={() =>
                              setChanges((s) => ({ ...s, [active.id]: [] }))
                            }
                          />
                        </>
                      )}
                      <div className="db-spacer" />
                      <button
                        disabled={!t || !!busy}
                        onClick={() => {
                          setMapping(
                            t?.columns
                              ?.filter((c: any) => !c.generated)
                              .map((c: any) => c.name)
                              .join(", ") || "",
                          );
                          setFileDialog("import");
                        }}
                      >
                        Импорт
                      </button>
                      <button
                        disabled={!result || !!busy}
                        onClick={() => {
                          setExportTableName(t?.name || "exported_result");
                          setFileDialog("export");
                        }}
                      >
                        Экспорт
                      </button>
                    </div>
                    {t && filterOpen && (
                      <div className="db-filter-builder">
                        <div className="db-inline">
                          <select
                            aria-label="Столбец фильтра"
                            value={filterColumn}
                            onChange={(e) => setFilterColumn(e.target.value)}
                          >
                            <option value="" disabled>
                              Столбец
                            </option>
                            {t.columns.map((c: any) => (
                              <option key={c.name}>{c.name}</option>
                            ))}
                          </select>
                          <select
                            aria-label="Оператор фильтра"
                            value={filterOperator}
                            onChange={(e) => setFilterOperator(e.target.value)}
                          >
                            {[
                              "=",
                              "<>",
                              ">",
                              ">=",
                              "<",
                              "<=",
                              "LIKE",
                              "ILIKE",
                              "IS NULL",
                              "IS NOT NULL",
                            ].map((op) => (
                              <option key={op}>{op}</option>
                            ))}
                          </select>
                          <input
                            aria-label="Значение фильтра"
                            value={filterValue}
                            disabled={filterOperator.includes("NULL")}
                            onChange={(e) => setFilterValue(e.target.value)}
                          />
                          <IconButton
                            icon="plus"
                            label="Добавить условие фильтра"
                            disabled={!filterColumn}
                            onClick={() =>
                              setFilter((v) => [
                                ...v,
                                {
                                  column: filterColumn,
                                  operator: filterOperator,
                                  value: filterValue,
                                },
                              ])
                            }
                          />
                          <button
                            disabled={!!busy || !!staged.length}
                            onClick={() => void attempt(() => reloadTable(0))}
                          >
                            Применить фильтр
                          </button>
                          <IconButton
                            icon="close"
                            label="Скрыть настройки фильтра"
                            onClick={() => setFilterOpen(false)}
                          />
                        </div>
                        {filter.length > 0 && (
                          <div className="db-filter-chips">
                            {filter.map((f, i) => (
                              <span key={i}>
                                {f.column} {f.operator} {f.value}
                                <IconButton
                                  icon="close"
                                  label={"Удалить условие " + (i + 1)}
                                  onClick={() =>
                                    setFilter((v) =>
                                      v.filter((_, index) => index !== i),
                                    )
                                  }
                                />
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="db-grid-scroll">
                      <table className="db-grid">
                        <thead>
                          <tr>
                            <th className="db-row-number">#</th>
                            {visibleFields.map((f: any) => (
                              <th key={f.index} title={f.name}>
                                {f.name}
                              </th>
                            ))}
                            {canEdit && <th aria-label="Действия строки" />}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...(page?.values || []),
                            ...staged
                              .filter((c) => c.kind === "insert")
                              .map((c) =>
                                (page?.fields || []).map((f: any) =>
                                  Object.prototype.hasOwnProperty.call(
                                    c.values || {},
                                    f.name,
                                  )
                                    ? c.values![f.name]
                                    : { default: true },
                                ),
                              ),
                          ].map((row: any[], ri: number) => {
                            const inserted =
                              ri >= (page?.values?.length || 0)
                                ? staged.filter((c) => c.kind === "insert")[
                                    ri - (page?.values?.length || 0)
                                  ]
                                : undefined;
                            const key =
                                canEdit && !inserted ? keyFor(row) : undefined,
                              change =
                                inserted ||
                                (key
                                  ? staged.find(
                                      (c) =>
                                        c.key?.ctid === key.ctid &&
                                        c.key?.tableoid === key.tableoid,
                                    )
                                  : undefined);
                            return (
                              <tr
                                key={offset + ri}
                                className={
                                  change?.kind === "delete" ? "db-deleted" : ""
                                }
                              >
                                <td className="db-row-number">
                                  {(result?.source?.offset || 0) +
                                    offset +
                                    ri +
                                    1}
                                </td>
                                {visibleFields.map((f: any) => {
                                  const index = f.index,
                                    changed =
                                      change?.values &&
                                      Object.prototype.hasOwnProperty.call(
                                        change.values,
                                        f.name,
                                      ),
                                    value = changed
                                      ? change!.values![f.name]
                                      : row[index],
                                    editing =
                                      edit?.row === ri &&
                                      edit.column === f.name,
                                    col = t?.columns?.find(
                                      (c: any) => c.name === f.name,
                                    ),
                                    editable =
                                      canEdit &&
                                      !col?.generated &&
                                      col?.identity !== "a";
                                  return (
                                    <td
                                      key={f.index}
                                      tabIndex={0}
                                      className={changed ? "db-changed" : ""}
                                      onDoubleClick={() => {
                                        if (editable)
                                          setEdit({
                                            row: ri,
                                            column: f.name,
                                            text:
                                              value === null ||
                                              typeof value === "object"
                                                ? ""
                                                : String(value),
                                            null: value === null,
                                            default:
                                              !!value &&
                                              typeof value === "object",
                                          });
                                      }}
                                      onKeyDown={(e) => {
                                        if (
                                          (e.key === "F2" ||
                                            e.key === "Enter") &&
                                          editable
                                        ) {
                                          e.preventDefault();
                                          setEdit({
                                            row: ri,
                                            column: f.name,
                                            text:
                                              value === null ||
                                              typeof value === "object"
                                                ? ""
                                                : String(value),
                                            null: value === null,
                                            default:
                                              !!value &&
                                              typeof value === "object",
                                          });
                                        }
                                      }}
                                    >
                                      {editing ? (
                                        <div className="db-cell-edit">
                                          <textarea
                                            rows={Math.min(
                                              5,
                                              Math.max(
                                                1,
                                                edit.text.split("\n").length,
                                              ),
                                            )}
                                            autoFocus
                                            aria-label={"Значение " + f.name}
                                            value={edit.text}
                                            disabled={edit.null || edit.default}
                                            onChange={(e) =>
                                              setEdit({
                                                ...edit,
                                                text: e.target.value,
                                              })
                                            }
                                            onKeyDown={(e) => {
                                              e.stopPropagation();
                                              if (
                                                (e.key === "Enter" &&
                                                  !e.shiftKey) ||
                                                e.key === "Tab"
                                              ) {
                                                e.preventDefault();
                                                commitEdit();
                                              }
                                              if (e.key === "Escape") {
                                                e.preventDefault();
                                                setEdit(undefined);
                                              }
                                            }}
                                          />
                                          <label>
                                            <input
                                              type="checkbox"
                                              checked={edit.null}
                                              onChange={(e) =>
                                                setEdit({
                                                  ...edit,
                                                  null: e.target.checked,
                                                  default: false,
                                                })
                                              }
                                            />
                                            NULL
                                          </label>
                                          <label>
                                            <input
                                              type="checkbox"
                                              checked={!!edit.default}
                                              onChange={(e) =>
                                                setEdit({
                                                  ...edit,
                                                  default: e.target.checked,
                                                  null: false,
                                                })
                                              }
                                            />
                                            DEFAULT
                                          </label>
                                          <IconButton
                                            icon="check"
                                            label="Сохранить ячейку в changeset"
                                            onClick={commitEdit}
                                          />
                                          <IconButton
                                            icon="close"
                                            label="Отменить редактирование ячейки"
                                            onClick={() => setEdit(undefined)}
                                          />
                                        </div>
                                      ) : value && typeof value === "object" ? (
                                        <span className="db-null">DEFAULT</span>
                                      ) : value === null ? (
                                        <span className="db-null">NULL</span>
                                      ) : (
                                        <span title={String(value)}>
                                          {String(value)}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                                {canEdit && (
                                  <td>
                                    <IconButton
                                      icon="close"
                                      label={
                                        "Удалить строку " + (offset + ri + 1)
                                      }
                                      onClick={() =>
                                        setChanges((s) => ({
                                          ...s,
                                          [active.id]: inserted
                                            ? (s[active.id] || []).filter(
                                                (c) => c !== inserted,
                                              )
                                            : [
                                                ...(s[active.id] || []).filter(
                                                  (c) =>
                                                    c.key?.ctid !== key?.ctid ||
                                                    c.key?.tableoid !==
                                                      key?.tableoid,
                                                ),
                                                { kind: "delete", key },
                                              ],
                                        }))
                                      }
                                    />
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!page?.values?.length && (
                        <div className="db-grid-empty">
                          {job?.status === "running"
                            ? "Запрос выполняется…"
                            : job?.status === "failed"
                              ? "Запрос завершился ошибкой"
                              : job?.status === "unknown"
                                ? "Исход запроса неизвестен"
                                : result
                                  ? "Пустой результат"
                                  : "Выполните запрос или откройте таблицу"}
                        </div>
                      )}
                    </div>
                    <div className="db-pagination">
                      <span>
                        {page?.values?.length
                          ? result?.source
                            ? `${result.source.offset + 1}–${result.source.offset + page.values.length}`
                            : `${offset + 1}–${offset + page.values.length} из ${result?.rows || 0}`
                          : "0 строк"}
                        {result?.truncated
                          ? " · достигнут лимит результата"
                          : ""}
                      </span>
                      {result && (
                        <span className="muted">{result.elapsedMs} мс</span>
                      )}
                      <div className="db-spacer" />
                      <select
                        aria-label="Строк на странице"
                        value={pageSize}
                        onChange={(e) => {
                          const size = Number(e.target.value);
                          setPageSize(size);
                          setOffset(0);
                          if (result?.source)
                            void attempt(() =>
                              reloadTable(0, {
                                ...result.source!,
                                pageSize: size,
                              }),
                            );
                        }}
                      >
                        {[1, 10, 50, 100, 200, 500].map((n) => (
                          <option key={n} value={n}>
                            {n} / стр.
                          </option>
                        ))}
                      </select>
                      <IconButton
                        icon="chevron-left"
                        label="Предыдущая страница"
                        disabled={
                          result?.source
                            ? result.source.offset === 0
                            : offset === 0
                        }
                        onClick={() =>
                          result?.source
                            ? void attempt(() =>
                                reloadTable(
                                  Math.max(
                                    0,
                                    result.source!.offset -
                                      result.source!.pageSize,
                                  ),
                                  result.source,
                                ),
                              )
                            : setOffset((v) => Math.max(0, v - pageSize))
                        }
                      />
                      <IconButton
                        icon="chevron-right"
                        label="Следующая страница"
                        disabled={
                          !result ||
                          (result.source
                            ? result.rows <= result.source.pageSize
                            : offset + pageSize >= result.rows)
                        }
                        onClick={() =>
                          result?.source
                            ? void attempt(() =>
                                reloadTable(
                                  result.source!.offset +
                                    result.source!.pageSize,
                                  result.source,
                                ),
                              )
                            : setOffset((v) => v + pageSize)
                        }
                      />
                    </div>
                  </>
                ) : view === "plan" ? (
                  <SqlPlan value={page?.values?.[0]?.[0]} />
                ) : view === "structure" ? (
                  <div className="db-grid-scroll">
                    <table className="db-grid">
                      <thead>
                        <tr>
                          <th>Столбец</th>
                          <th>Тип</th>
                          <th>NOT NULL</th>
                          <th>Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t?.columns?.map((c: any) => (
                          <tr key={c.name}>
                            <td>{c.name}</td>
                            <td>{c.type}</td>
                            <td>{c.required}</td>
                            <td>{c.default}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <pre>
                      {JSON.stringify(
                        {
                          constraints: t?.constraints,
                          indexes: t?.indexes,
                          triggers: t?.triggers,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                ) : view === "ddl" ? (
                  <div className="db-definition">
                    <SqlEditor
                      value={(d || t)?.ddl || ""}
                      onChange={() => {}}
                      onRun={() => {}}
                      readOnly
                    />
                    {t?.ddlScope && (
                      <small className="muted">{t.ddlScope}</small>
                    )}
                  </div>
                ) : view === "dependencies" ? (
                  <pre className="db-output">
                    {JSON.stringify(t?.dependencies || [], null, 2)}
                  </pre>
                ) : (
                  <div className="db-output">
                    {[...jobs].reverse().map((j) => (
                      <article key={j.id}>
                        <strong>
                          {j.kind} · {status(j)}
                        </strong>
                        <span>
                          {new Date(j.startedAt).toLocaleTimeString("ru-RU", {
                            hour12: false,
                          })}{" "}
                          · {j.rows} строк · {j.bytes} байт
                        </span>
                        {j.error && (
                          <pre role="alert">
                            {j.error.code ? j.error.code + " · " : ""}
                            {j.error.message}
                            {j.error.position
                              ? " · позиция " + j.error.position
                              : ""}
                          </pre>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
      {(error || jobError) && (
        <div className="db-error" role="alert">
          <Icon name="warning" />
          <span>{error || jobError}</span>
          <IconButton
            icon="close"
            label="Скрыть ошибку БД"
            onClick={() => {
              setError("");
              setDismissedJob(job?.id);
            }}
          />
        </div>
      )}
      {fileDialog && (
        <Modal
          title={
            fileDialog === "import"
              ? "Импорт данных · COPY"
              : "Экспорт результата"
          }
          onClose={() => setFileDialog(undefined)}
        >
          <div className="db-file-form">
            <p>
              {connection?.name} · {lease?.database}{" "}
              {t ? "· " + t.schema + "." + t.name : ""}
            </p>
            {fileDialog === "export" && result?.source && (
              <label>
                Объём
                <select
                  aria-label="Объём экспорта"
                  value={exportAll ? "table" : "result"}
                  onChange={(e) => setExportAll(e.target.value === "table")}
                >
                  <option value="result">Снимок текущей страницы</option>
                  <option value="table">Вся таблица · без фильтра</option>
                </select>
              </label>
            )}
            <label>
              Формат
              <select
                value={fileFormat}
                onChange={(e) => setFileFormat(e.target.value)}
              >
                <option value="csv">CSV</option>
                <option value="xlsx">Excel · XLSX</option>
                <option value="sql">SQL INSERT / script</option>
              </select>
            </label>
            {fileDialog === "export" && fileFormat === "sql" && (
              <label>
                Таблица для INSERT
                <input
                  aria-label="Таблица SQL экспорта"
                  value={exportTableName}
                  onChange={(e) => setExportTableName(e.target.value)}
                />
              </label>
            )}
            {fileDialog === "import" && (
              <>
                <label>
                  Столбцы в порядке файла
                  <input
                    value={mapping}
                    onChange={(e) => setMapping(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={fileHeader}
                    onChange={(e) => setFileHeader(e.target.checked)}
                  />
                  Первая строка — заголовок
                </label>
                {fileFormat === "csv" && (
                  <>
                    <label>
                      Разделитель
                      <input
                        maxLength={1}
                        value={delimiter}
                        onChange={(e) => setDelimiter(e.target.value)}
                      />
                    </label>
                    <label>
                      Кодировка
                      <select
                        value={encoding}
                        onChange={(e) => setEncoding(e.target.value)}
                      >
                        <option value="utf8">UTF-8</option>
                        <option value="windows-1251">Windows-1251</option>
                        <option value="utf16le">UTF-16 LE</option>
                      </select>
                    </label>
                  </>
                )}
                <p className="muted">
                  SQL: UTF-8, одна транзакция; без psql/COPY-команд. CSV: NULL —
                  \N, пустая строка — "". XLSX: первый лист, значения и
                  сохранённые результаты формул; даты-числа требуют явного
                  преобразования. Импорт атомарный; Manual оставляет транзакцию
                  открытой.
                </p>
              </>
            )}
            <footer>
              <button onClick={() => setFileDialog(undefined)}>Отмена</button>
              <button
                className="primary"
                onClick={() =>
                  void attempt(async () => {
                    const r = await invoke(fileDialog, {
                      chooseFile: true,
                      oid: t?.oid,
                      resultId,
                      format: fileFormat,
                      allRows: fileDialog === "export" && exportAll,
                      columns: mapping
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      header: fileHeader,
                      delimiter,
                      encoding,
                      table: exportTableName || t?.name,
                      tableSchema: t?.schema,
                      operationId: crypto.randomUUID(),
                    });
                    if (r) {
                      setFileDialog(undefined);
                      await refresh();
                    }
                  })
                }
              >
                Выбрать файл и{" "}
                {fileDialog === "import" ? "импортировать" : "сохранить"}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {metrics && (
        <Modal
          title="Диагностика движка БД"
          onClose={() => setMetrics(undefined)}
        >
          <pre className="db-output">{JSON.stringify(metrics, null, 2)}</pre>
        </Modal>
      )}
      {history && (
        <DatabaseHistory
          jobs={jobs}
          read={(p) => invoke("job.read", p)}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  );
}
function status(j: DatabaseJob) {
  return {
    running: "Выполняется",
    completed: "Завершено",
    failed: "Ошибка",
    cancelled: "Отменено",
    unknown: "Исход неизвестен",
  }[j.status];
}
function ConsoleEditor({
  console: c,
  table,
  detail,
  job,
  names,
  height,
  busy,
  lease,
  onError,
  refresh,
  invoke,
  runSql,
  saveCopy,
}: any) {
  const [text, setText] = useState(c.sql),
    [conflict, setConflict] = useState(false),
    [dirty, setDirty] = useState(false),
    [runMode, setRunMode] = useState("statement");
  const draft = useRef(text),
    saved = useRef({ revision: c.revision, text: c.sql }),
    tail = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    alive = useRef(true);
  const save = () => {
    const next = tail.current.then(async () => {
      const value = draft.current;
      if (value === saved.current.text) return;
      const r = await invoke("console.update", {
        revision: saved.current.revision,
        sql: value,
      });
      saved.current = { revision: r.revision, text: r.sql };
      if (alive.current) {
        setDirty(draft.current !== r.sql);
        setConflict(false);
      }
    });
    tail.current = next.catch(() => {});
    return next;
  };
  useEffect(() => {
    if (c.revision > saved.current.revision) {
      if (draft.current === saved.current.text) {
        saved.current = { revision: c.revision, text: c.sql };
        draft.current = c.sql;
        setText(c.sql);
      } else setConflict(true);
    }
  }, [c.revision, c.sql]);
  useEffect(
    () => () => {
      alive.current = false;
      clearTimeout(timer.current);
      void save().catch(() => {});
    },
    [],
  );
  const change = (value: string) => {
    setText(value);
    draft.current = value;
    setDirty(value !== saved.current.text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save().catch((e: any) => {
        if (alive.current) {
          setConflict(true);
          onError(e.message);
        }
      });
    }, 700);
  };
  const run = async (selection = "", from = 0, force?: string) => {
    try {
      await save();
      await refresh();
      if (detail?.hash) {
        await invoke("routineApply", {
          oid: detail.oid,
          originalHash: detail.hash,
          sql: draft.current,
          operationId: crypto.randomUUID(),
        });
        await refresh();
        return;
      }
      await runSql(
        force ||
          selection ||
          (runMode === "script"
            ? draft.current
            : statementAt(draft.current, from)),
      );
    } catch (e: any) {
      onError(e.message);
    }
  };
  return (
    <>
      <div className="db-sql-toolbar">
        <button
          className="primary"
          disabled={busy}
          title={
            detail?.hash
              ? "Применить DDL с проверкой версии · Ctrl+Enter"
              : "Выполнить SQL · Ctrl+Enter"
          }
          onClick={() => void run()}
        >
          <Icon name="play" size={15} />
          {detail?.hash ? "Применить DDL" : "Выполнить"}
        </button>
        {!detail?.hash && (
          <select
            aria-label="Область запуска SQL"
            value={runMode}
            onChange={(e) => setRunMode(e.target.value)}
          >
            <option value="statement">Statement</option>
            <option value="script">Script</option>
          </select>
        )}
        <IconButton
          icon="code"
          label="Форматировать SQL"
          onClick={() => {
            try {
              change(format(draft.current, { language: "postgresql" }));
            } catch (e: any) {
              onError(e.message);
            }
          }}
        />
        <IconButton
          icon="stop"
          label="Отменить операцию БД"
          disabled={!busy}
          onClick={() =>
            void invoke("cancel").catch((e: any) => onError(e.message))
          }
        />
        {!detail?.hash && (
          <Menu
            label="План выполнения SQL"
            items={[
              {
                label: "EXPLAIN · оценка",
                disabled: busy,
                action: () =>
                  void run(
                    "",
                    0,
                    "EXPLAIN (FORMAT JSON) " + statementAt(draft.current, 0),
                  ),
              },
              {
                label: "EXPLAIN ANALYZE · выполнить запрос",
                disabled: busy,
                action: () =>
                  void run(
                    "",
                    0,
                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " +
                      statementAt(draft.current, 0),
                  ),
              },
            ]}
          />
        )}
        {detail?.externalChange && (
          <span className="db-conflict">Серверная версия изменилась</span>
        )}
        {dirty && <span className="muted">●</span>}
        {conflict && (
          <span
            className="db-conflict"
            title="SQL в другом окне изменился. Ваш текст сохранён в этом окне; он не перезапишет чужую версию."
          >
            Конфликт версии
            <button onClick={() => void saveCopy(draft.current)}>
              Сохранить копию
            </button>
            <button
              onClick={() => {
                clearTimeout(timer.current);
                saved.current = { revision: c.revision, text: c.sql };
                draft.current = c.sql;
                setText(c.sql);
                setConflict(false);
                setDirty(false);
              }}
            >
              Загрузить с сервера
            </button>
          </span>
        )}
        <div className="db-spacer" />
        <select
          aria-label="Режим транзакции"
          disabled={busy || !lease}
          value={lease?.mode || c.mode}
          onChange={(e) =>
            void invoke("transaction", { action: "mode", mode: e.target.value })
              .then(refresh)
              .catch((e: any) => onError(e.message))
          }
        >
          <option value="auto">Auto-commit</option>
          <option value="manual">Manual</option>
        </select>
        {lease?.transaction !== "idle" && lease && (
          <>
            <span className={"db-tx " + lease.transaction}>
              {lease.transaction}
            </span>
            <button
              disabled={
                busy ||
                lease.transaction === "failed" ||
                lease.transaction === "unknown"
              }
              onClick={() =>
                void invoke("transaction", { action: "commit" })
                  .then(refresh)
                  .catch((e: any) => onError(e.message))
              }
            >
              Commit
            </button>
            <button
              disabled={busy || lease.transaction === "unknown"}
              onClick={() =>
                void invoke("transaction", { action: "rollback" })
                  .then(refresh)
                  .catch((e: any) => onError(e.message))
              }
            >
              Rollback
            </button>
          </>
        )}
      </div>
      <div style={{ height, flexShrink: 0 }}>
        <SqlEditor
          errorPosition={
            job?.error?.position &&
            job.sql &&
            text.indexOf(job.sql) >= 0 &&
            text.indexOf(job.sql) === text.lastIndexOf(job.sql)
              ? text.indexOf(job.sql) +
                (job.error.statementOffset || 0) +
                Array.from(
                  (job.sql as string).slice(job.error.statementOffset || 0),
                )
                  .slice(0, job.error.position - 1)
                  .join("").length
              : undefined
          }
          value={text}
          onChange={change}
          onRun={(selection, from) => void run(selection, from)}
          names={names}
        />
      </div>
    </>
  );
}
