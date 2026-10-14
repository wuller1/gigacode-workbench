import { registerWindowClose } from "./window-close";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DatabaseSnapshot,
  DatabaseConsole,
  DatabaseObject,
  DatabaseChange,
  DatabaseJob,
  DatabaseResult,
} from "../shared/database";
import { useStored } from "./api";
import type { PanelProps } from "./Panels";
import { Empty, Icon, IconButton, Menu, Modal, useAsk } from "./ui";
import { DatabaseEffect } from "./DatabaseEffect";
import { DatabaseHistory } from "./DatabaseHistory";
import { DatabaseConsoleEditor } from "./DatabaseConsoleEditor";
import { DatabaseRelations } from "./DatabaseRelations";
import { DatabaseStructure } from "./DatabaseStructure";
import { DatabaseExplorer, type DatabaseCatalog } from "./DatabaseExplorer";
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
    [catalogSearch, setCatalogSearch] = useState(""),
    [catalogOffset, setCatalogOffset] = useState(0),
    [systemSchemas, setSystemSchemas] = useState(false),
    [loadingCatalog, setLoadingCatalog] = useState(false),
    [schemaSelections, setSchemaSelections] = useStored<
      Record<string, string[]>
    >("database.schemas.v1", {}),
    [catalog, setCatalog] = useState<DatabaseCatalog>({
      schemas: [],
      objects: [],
    }),
    [error, setError] = useState(""),
    [dismissedJob, setDismissedJob] = useState<string>(),
    [table, setTable] = useState<Record<string, any>>({}),
    [detail, setDetail] = useState<Record<string, any>>({}),
    [relations, setRelations] = useState<Record<string, any>>({}),
    [relationsLoading, setRelationsLoading] = useState(false),
    [view, setView] = useState("data"),
    [page, setPage] = useState<any>(),
    [offset, setOffset] = useState(0),
    [pageSize, setPageSize] = useStored("database.pageSize", 200),
    [resultId, setResultId] = useState(""),
    [changes, setChanges] = useState<Record<string, DatabaseChange[]>>({}),
    [edit, setEdit] = useState<{
      consoleId: string;
      resultId: string;
      offset: number;
      key?: DatabaseChange["key"];
      inserted?: DatabaseChange;
      row: number;
      column: string;
      text: string;
      null: boolean;
      default?: boolean;
    }>(),
    [closing, setClosing] = useState<string>(),
    [windowClosing, setWindowClosing] = useState(false),
    [gridFocus, setGridFocus] = useState({ row: 0, column: 0 }),
    [tableSql, setTableSql] = useState<Record<string, boolean>>({}),
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
  const gridRef = useRef<HTMLTableElement>(null);
  const closingConsole = useRef<string | undefined>(undefined);
  const flushers = useRef(new Map<string, () => Promise<number>>());
  const registerFlush = useCallback(
    (id: string, flush?: () => Promise<number>) => {
      if (flush) flushers.current.set(id, flush);
      else {
        const pending = flushers.current.get(id);
        if (pending)
          void pending()
            .then(() => {
              if (flushers.current.get(id) === pending)
                flushers.current.delete(id);
            })
            .catch((error) => setError("SQL не сохранён: " + error.message));
      }
    },
    [],
  );
  const unsavedGrid = useRef(false);
  unsavedGrid.current =
    !!edit || Object.values(changes).some((rows) => rows.length);
  useEffect(() => {
    const off = registerWindowClose("database", async () => {
      if (unsavedGrid.current)
        throw new Error(
          "Есть несохранённые изменения таблицы. Примените или отмените их перед закрытием.",
        );
      setWindowClosing(true);
      await Promise.all([...flushers.current.values()].map((flush) => flush()));
      if (unsavedGrid.current)
        throw new Error(
          "Изменения таблицы появились во время сохранения. Завершите их перед закрытием.",
        );
    });
    const unsubscribe = window.workbench?.subscribe((event) => {
      if (event.type === "window.closeSettled") setWindowClosing(false);
    });
    return () => {
      off();
      unsubscribe?.();
    };
  }, []);
  const catalogKey = useRef("");
  const pendingCatalogKey = useRef("");
  const wantedCatalogKey = useRef("");
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
    staleTarget = !!active && active.targetHash !== connection?.targetHash,
    lostConnection = lease?.transaction === "unknown",
    isTableDocument =
      !!active?.object &&
      !["function", "procedure"].includes(active.object.kind),
    ask = useAsk();
  const schemaScope = project?.id + ":" + connection?.id;
  const visibleSchemas = schemaSelections[schemaScope] || ["public"];
  const requestCatalogKey = JSON.stringify([
    active?.id,
    visibleSchemas,
    catalogSearch,
    catalogOffset,
    systemSchemas,
  ]);
  wantedCatalogKey.current = requestCatalogKey;
  useEffect(() => {
    const timer = setTimeout(() => {
      setCatalogSearch(search);
      setCatalogOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setCatalogOffset(0);
    setCatalog({ schemas: [], objects: [] });
    catalogKey.current = "";
  }, [schemaScope]);
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
      if (currentProject.current === pid)
        setError((previous) => previous || e.message);
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
    setError("");
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
  const attempt = async (fn: () => Promise<any>, clearError = true) => {
    const pid = currentProject.current,
      consoleId = activeId.current;
    // Background reads must not erase a refusal from the user's last action.
    if (clearError) setError("");
    try {
      return await fn();
    } catch (e: any) {
      if (
        currentProject.current === pid &&
        (clearError || activeId.current === consoleId)
      )
        setError((previous) =>
          clearError ? e.message : previous || e.message,
        );
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
    if (edit && c.id !== edit.consoleId) {
      setError("Сначала сохраните или отмените редактирование ячейки.");
      return;
    }
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
    if (edit)
      throw new Error("Сначала сохраните или отмените редактирование ячейки.");
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
      key = requestCatalogKey;
    if (pendingCatalogKey.current === key) return;
    pendingCatalogKey.current = key;
    setLoadingCatalog(true);
    try {
      const r = await invoke("catalog", {
        schemas: visibleSchemas,
        search: catalogSearch,
        offset: catalogOffset,
        limit: 200,
        includeSystem: systemSchemas,
      });
      if (activeId.current === id && wantedCatalogKey.current === key) {
        setCatalog(r);
        catalogKey.current = key;
      }
    } catch (error) {
      if (wantedCatalogKey.current === key) throw error;
    } finally {
      if (pendingCatalogKey.current === key) {
        pendingCatalogKey.current = "";
        setLoadingCatalog(false);
      }
    }
  };
  useEffect(() => {
    if (
      active?.leaseId &&
      lease?.transaction !== "unknown" &&
      !busy &&
      catalogKey.current !== requestCatalogKey
    )
      void attempt(loadCatalog, false);
  }, [snapshot, active?.id, active?.leaseId, requestCatalogKey, !!busy]);
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
      !edit &&
      !staged.length &&
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
  }, [active?.id, job?.id, job?.status, resultId, !!edit, staged.length]);
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
    }, false);
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
    if (consoleId === active?.id && (edit || staged.length))
      throw new Error(
        "Сначала примените или отмените изменения таблицы и завершите редактирование ячейки.",
      );
    const c = snapshot.consoles.find((x) => x.id === consoleId);
    await connect(c);
    const r = await invoke(
      "execute",
      { sql, operationId: crypto.randomUUID() },
      consoleId,
    );
    awaitingQuery.current[consoleId] = r.id;
    if (activeId.current === consoleId) {
      setResultId("");
      setOffset(0);
    }
    await refresh();
    return r;
  };
  useEffect(() => {
    const c = active;
    if (
      !c?.object ||
      !c.leaseId ||
      ["function", "procedure"].includes(c.object.kind) ||
      busy ||
      staleTarget ||
      table[c.id] ||
      detail[c.id]
    )
      return;
    void attempt(async () => {
      const definition = await invoke(
        "describe",
        { oid: c.object!.oid, kind: c.object!.kind },
        c.id,
      );
      if (["function", "procedure"].includes(c.object!.kind))
        setDetail((v) => ({ ...v, [c.id]: definition }));
      else setTable((v) => ({ ...v, [c.id]: definition }));
    }, false);
  }, [active?.id, active?.leaseId, !!busy]);
  useEffect(() => {
    const c = active;
    if (
      !c?.object ||
      !["function", "procedure"].includes(c.object.kind) ||
      !c.leaseId ||
      busy ||
      staleTarget ||
      lostConnection
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
        [c.id]: {
          ...definition,
          externalChange:
            definition.hash !==
            (c.routineBaseline?.session?.leaseId === lease?.id
              ? c.routineBaseline?.session?.hash
              : c.routineBaseline?.committedHash),
        },
      }));
    }, false);
  }, [
    active?.id,
    job?.id,
    job?.status,
    active?.routineBaseline?.committedHash,
    active?.routineBaseline?.session?.hash,
    active?.routineBaseline?.blocked,
    lease?.transaction,
    active?.sql,
    !!busy,
    staleTarget,
    lostConnection,
    active?.leaseId,
  ]);
  const loadRelations = async () => {
    if (!active || !t || !lease || staleTarget || lostConnection) return;
    const id = active.id;
    setRelationsLoading(true);
    try {
      const graph = await invoke("relations", { oid: t.oid }, id);
      setRelations((v) => ({ ...v, [id]: graph }));
    } finally {
      setRelationsLoading(false);
    }
  };
  useEffect(() => {
    if (
      view === "dependencies" &&
      t &&
      ["r", "p", "f"].includes(t.kind) &&
      lease &&
      !busy &&
      !relations[active!.id] &&
      !staleTarget &&
      !lostConnection
    )
      void attempt(loadRelations, false);
  }, [active?.id, view, !!t, !!lease, !!busy, staleTarget, lostConnection]);
  const openObject = async (o: DatabaseObject) => {
    if (!active) return;
    if (edit)
      throw new Error("Сначала сохраните или отмените редактирование ячейки.");
    const connectionId = active.connectionId;
    const existing = snapshot.consoles.find(
      (c) =>
        !c.closed &&
        c.connectionId === connectionId &&
        c.targetHash === connection?.targetHash &&
        c.object?.oid === o.oid,
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
    afterApply = false,
  ) => {
    if (!t) return;
    if (edit || (staged.length && !afterApply))
      throw new Error(
        "Сначала примените или отмените изменения таблицы и завершите редактирование ячейки.",
      );
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
    await reloadTable(undefined, undefined, true);
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
  const focusCell = (row: number, column: number) => {
    const count =
      (page?.values?.length || 0) +
      staged.filter((c) => c.kind === "insert").length;
    const next = {
      row: Math.max(0, Math.min(count - 1, row)),
      column: Math.max(0, Math.min(visibleFields.length - 1, column)),
    };
    setGridFocus(next);
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLElement>(
          `[data-row="${next.row}"][data-column="${next.column}"]`,
        )
        ?.focus(),
    );
  };
  const commitEdit = (move?: "next" | "previous" | "down") => {
    if (!edit || !active || !page) return;
    const inserted = edit.inserted;
    const currentKey =
      !inserted && page.values[edit.row]
        ? keyFor(page.values[edit.row])
        : undefined;
    if (
      edit.consoleId !== active.id ||
      edit.resultId !== resultId ||
      edit.offset !== offset ||
      (inserted
        ? !staged.includes(inserted)
        : JSON.stringify(currentKey) !== JSON.stringify(edit.key))
    ) {
      setError(
        "Строка или результат изменились. Текст ячейки сохранён в редакторе; отмените редактирование и повторите на актуальной строке.",
      );
      return;
    }
    const key = edit.key,
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
    const col = visibleFields.findIndex((f: any) => f.name === edit.column);
    if (move === "down") focusCell(edit.row + 1, col);
    else if (move === "next")
      focusCell(
        col + 1 < visibleFields.length ? edit.row : edit.row + 1,
        (col + 1) % visibleFields.length,
      );
    else if (move === "previous")
      focusCell(
        col ? edit.row : edit.row - 1,
        col ? col - 1 : visibleFields.length - 1,
      );
    else focusCell(edit.row, col);
  };
  const tableEditable =
    !!result?.source &&
    !!t &&
    ["r", "p"].includes(t.kind) &&
    !lease?.readOnly &&
    page?.fields?.some((f: any) => f.name === "__wb_xmin");
  const canEdit =
    tableEditable &&
    page?.id === resultId &&
    page?.offset === offset &&
    !!lease &&
    !lostConnection &&
    !staleTarget &&
    !active?.pendingEffect &&
    !windowClosing &&
    !closing &&
    !busy;
  const gridLocked =
    !!edit || !!staged.length || !!busy || windowClosing || !!closing;
  const close = async (c: DatabaseConsole) => {
    if (closingConsole.current)
      throw new Error("Дождитесь завершения закрытия SQL-вкладки.");
    if (edit?.consoleId === c.id)
      throw new Error("Сначала сохраните или отмените редактирование ячейки.");
    closingConsole.current = c.id;
    setClosing(c.id);
    try {
      const currentState = async () => {
        const state: DatabaseSnapshot = await dataCall("database.snapshot", {
          projectId: c.projectId,
        });
        const document = state.consoles.find((d) => d.id === c.id);
        const ownLease = state.leases.find((l) => l.id === document?.leaseId);
        if (
          !document ||
          document.pendingEffect?.phase === "submitting" ||
          ownLease?.busy ||
          state.jobs.some((j) => j.consoleId === c.id && j.status === "running")
        )
          throw new Error(
            "Операция выполняется или документ изменился. Дождитесь завершения перед закрытием вкладки.",
          );
        return {
          ownLease,
          operation: JSON.stringify([
            document.leaseId,
            document.activityRevision || 0,
            state.jobs.filter((j) => j.consoleId === c.id).at(-1)?.id,
            document.pendingEffect?.operationId,
            document.lastResolution?.operationId,
            ownLease?.transaction,
          ]),
        };
      };
      const before = await currentState();
      if (
        before.ownLease &&
        ["active", "failed"].includes(before.ownLease.transaction)
      ) {
        if (
          !(await ask("Откатить транзакцию и закрыть вкладку?", {
            confirm: true,
            message:
              "Закрытая вкладка не должна оставлять незаметные блокировки. Отмена сохранит её открытой.",
          }))
        )
          return;
        // Another window/agent can work while the question is open. Approval
        // of the earlier transaction must not roll back newly submitted work.
        const after = await currentState();
        if (after.operation !== before.operation)
          throw new Error(
            "В другой сессии появилась новая операция. Проверьте её и повторите закрытие вкладки.",
          );
        await invoke(
          "transaction",
          { action: "rollback", expectedCloseActivity: after.operation },
          c.id,
        );
      }
      if (
        (changes[c.id] || []).length &&
        !(await ask("Скрыть вкладку с несохранёнными строками?", {
          confirm: true,
          message:
            "Изменения останутся в этой вкладке до применения или отмены.",
        }))
      )
        return;
      await flushers.current.get(c.id)?.();
      const latest = await invoke("console.read", {}, c.id);
      await invoke(
        "console.update",
        { revision: latest.revision, closed: true },
        c.id,
      );
      await refresh();
    } finally {
      closingConsole.current = undefined;
      setClosing(undefined);
    }
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
          className={
            "db-link-state " +
            (lease && !lostConnection && !staleTarget ? "connected" : "")
          }
          title={
            staleTarget
              ? "Документ прежнего подключения · сохранённые результаты"
              : lostConnection
                ? "Сессия потеряна · Disconnect перед повторным подключением"
                : lease?.server || "Нет соединения"
          }
        >
          {staleTarget
            ? "Прежний сервер"
            : lostConnection
              ? "Связь потеряна"
              : lease?.database || connection?.database || "MCP"}
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
              disabled: !active || !!lease || staleTarget,
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
                <DatabaseExplorer
                  catalog={catalog}
                  selected={visibleSchemas}
                  onSelected={(schemas) => {
                    setSchemaSelections((s) => ({
                      ...s,
                      [schemaScope]: schemas,
                    }));
                    setCatalogOffset(0);
                  }}
                  search={search}
                  onSearch={setSearch}
                  system={systemSchemas}
                  onSystem={(v) => {
                    setSystemSchemas(v);
                    setCatalogOffset(0);
                  }}
                  connected={!!lease && !lostConnection && !staleTarget}
                  busy={!!busy}
                  loading={loadingCatalog}
                  refresh={() => void attempt(loadCatalog)}
                  open={(o) => void attempt(() => openObject(o))}
                  offset={catalogOffset}
                  onOffset={setCatalogOffset}
                />
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
                      disabled={
                        windowClosing ||
                        !!closing ||
                        c.pendingEffect?.phase === "submitting" ||
                        snapshot.leases.some(
                          (l) => l.id === c.leaseId && l.busy,
                        ) ||
                        snapshot.jobs.some(
                          (j) => j.consoleId === c.id && j.status === "running",
                        )
                      }
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
                {staleTarget && (
                  <div className="db-effect" role="status">
                    Параметры подключения изменились. Этот документ и
                    сохранённые результаты относятся к прежнему серверу;
                    доступно только чтение. Откройте новую SQL-консоль для
                    текущего подключения.
                  </div>
                )}
                <DatabaseConsoleEditor
                  key={"sql:" + active.id}
                  console={active}
                  table={t}
                  detail={d}
                  job={job}
                  names={catalog.objects.map((o) => o.name)}
                  height={editorHeight}
                  busy={!!busy}
                  staleTarget={staleTarget}
                  preparingClose={windowClosing || closing === active.id}
                  registerFlush={registerFlush}
                  collapsed={
                    isTableDocument && (!tableSql[active.id] || view !== "data")
                  }
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
                {(!isTableDocument ||
                  (tableSql[active.id] && view === "data")) && (
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
                            Math.min(
                              650,
                              v + (e.key === "ArrowDown" ? 20 : -20),
                            ),
                          ),
                        );
                      }
                    }}
                  />
                )}
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
                            dependencies:
                              t && ["r", "p", "f"].includes(t.kind)
                                ? "Связи"
                                : "Зависимости",
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
                  {isTableDocument && (
                    <IconButton
                      icon="code"
                      label={
                        tableSql[active.id] && view === "data"
                          ? "Скрыть SQL редактор таблицы"
                          : "Показать SQL редактор таблицы"
                      }
                      onClick={() => {
                        const showing =
                          !!tableSql[active.id] && view === "data";
                        setTableSql((v) => ({ ...v, [active.id]: !showing }));
                        if (!showing) setView("data");
                      }}
                    />
                  )}
                  {jobs
                    .filter((j) => j.kind === "query")
                    .flatMap((j) => j.results).length > 1 && (
                    <select
                      aria-label="Результат запроса"
                      disabled={gridLocked}
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
                            disabled={gridLocked}
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
                      {tableEditable && (
                        <>
                          <IconButton
                            icon="plus"
                            label="Добавить строку DEFAULT"
                            disabled={!canEdit || !!edit}
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
                            disabled={!staged.length || !canEdit || !!edit}
                            onClick={() => void attempt(apply)}
                          >
                            Применить
                            {staged.length ? " · " + staged.length : ""}
                          </button>
                          <IconButton
                            icon="stop"
                            label="Отменить локальные изменения"
                            disabled={!staged.length || !canEdit}
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
                            disabled={gridLocked}
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
                      <table
                        className="db-grid"
                        ref={gridRef}
                        data-editable={canEdit ? "true" : "false"}
                        data-result-id={page?.id || ""}
                        aria-busy={
                          !!busy || (!!resultId && page?.id !== resultId)
                        }
                      >
                        <thead>
                          <tr>
                            <th className="db-row-number">#</th>
                            {visibleFields.map((f: any) => (
                              <th key={f.index} title={f.name}>
                                {f.name}
                              </th>
                            ))}
                            {tableEditable && (
                              <th aria-label="Действия строки" />
                            )}
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
                                tableEditable && !inserted
                                  ? keyFor(row)
                                  : undefined,
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
                                {visibleFields.map((f: any, ci: number) => {
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
                                      data-row={ri}
                                      data-column={ci}
                                      tabIndex={
                                        gridFocus.row === ri &&
                                        gridFocus.column === ci
                                          ? 0
                                          : -1
                                      }
                                      onFocus={() =>
                                        setGridFocus({ row: ri, column: ci })
                                      }
                                      className={changed ? "db-changed" : ""}
                                      onDoubleClick={() => {
                                        if (editable && !edit)
                                          setEdit({
                                            consoleId: active.id,
                                            resultId,
                                            offset,
                                            key,
                                            inserted,
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
                                          [
                                            "ArrowLeft",
                                            "ArrowRight",
                                            "ArrowUp",
                                            "ArrowDown",
                                            "Tab",
                                          ].includes(e.key)
                                        ) {
                                          e.preventDefault();
                                          if (e.key === "Tab")
                                            focusCell(
                                              e.shiftKey
                                                ? ci
                                                  ? ri
                                                  : ri - 1
                                                : ci + 1 < visibleFields.length
                                                  ? ri
                                                  : ri + 1,
                                              e.shiftKey
                                                ? ci
                                                  ? ci - 1
                                                  : visibleFields.length - 1
                                                : (ci + 1) %
                                                    visibleFields.length,
                                            );
                                          else
                                            focusCell(
                                              ri +
                                                (e.key === "ArrowDown"
                                                  ? 1
                                                  : e.key === "ArrowUp"
                                                    ? -1
                                                    : 0),
                                              ci +
                                                (e.key === "ArrowRight"
                                                  ? 1
                                                  : e.key === "ArrowLeft"
                                                    ? -1
                                                    : 0),
                                            );
                                        }
                                        if (
                                          (e.key === "F2" ||
                                            e.key === "Enter") &&
                                          editable &&
                                          !edit
                                        ) {
                                          e.preventDefault();
                                          setEdit({
                                            consoleId: active.id,
                                            resultId,
                                            offset,
                                            key,
                                            inserted,
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
                                                commitEdit(
                                                  e.key === "Tab"
                                                    ? e.shiftKey
                                                      ? "previous"
                                                      : "next"
                                                    : "down",
                                                );
                                              }
                                              if (e.key === "Escape") {
                                                e.preventDefault();
                                                setEdit(undefined);
                                                focusCell(ri, ci);
                                              }
                                            }}
                                          />
                                          <label>
                                            <input
                                              type="checkbox"
                                              autoFocus={edit.null}
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
                                              autoFocus={!!edit.default}
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
                                            onClick={() => commitEdit()}
                                          />
                                          <IconButton
                                            icon="close"
                                            label="Отменить редактирование ячейки"
                                            onClick={() => {
                                              setEdit(undefined);
                                              focusCell(ri, ci);
                                            }}
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
                                {tableEditable && (
                                  <td>
                                    <IconButton
                                      icon="close"
                                      disabled={!canEdit || !!edit}
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
                        disabled={gridLocked}
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
                          gridLocked ||
                          (result?.source
                            ? result.source.offset === 0
                            : offset === 0)
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
                          gridLocked ||
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
                  <DatabaseStructure
                    key={"structure:" + active.id}
                    definition={t}
                  />
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
                  t && ["r", "p", "f"].includes(t.kind) ? (
                    relations[active.id] ? (
                      <DatabaseRelations
                        key={"relations:" + active.id}
                        graph={relations[active.id]}
                        busy={
                          !!busy ||
                          relationsLoading ||
                          staleTarget ||
                          !!lostConnection
                        }
                        refresh={() => void attempt(loadRelations)}
                        open={(node) =>
                          void attempt(() =>
                            openObject({
                              oid: node.oid,
                              schema: node.schema,
                              name: node.name,
                              kind:
                                node.kind === "f" ? "foreign table" : "table",
                            }),
                          )
                        }
                      />
                    ) : (
                      <div className="db-grid-empty">
                        {relationsLoading ? (
                          "Читаю внешние ключи…"
                        ) : (
                          <button
                            disabled={!lease || staleTarget || !!lostConnection}
                            onClick={() => void attempt(loadRelations)}
                          >
                            Загрузить связи таблицы
                          </button>
                        )}
                      </div>
                    )
                  ) : (
                    <pre className="db-output">
                      {JSON.stringify((d || t)?.dependencies || [], null, 2)}
                    </pre>
                  )
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
          listOperations={(p) => invoke("operation.list", p)}
          readOperation={(p) => invoke("operation.read", p)}
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
