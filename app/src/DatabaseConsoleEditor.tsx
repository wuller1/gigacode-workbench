import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "sql-formatter";
import type {
  DatabaseConsole,
  DatabaseJob,
  DatabaseLease,
} from "../shared/database";
import { statementAt } from "../shared/sql";
import { Icon, IconButton, Menu, useAsk } from "./ui";
import { SqlEditor } from "./SqlEditor";

/** Closing a document must await this promise before removing its persisted state. */
export type DatabaseConsoleFlush = () => Promise<number>;

export type DatabaseConsoleEditorProps = {
  console: DatabaseConsole;
  table?: Record<string, any>;
  detail?: Record<string, any>;
  job?: DatabaseJob;
  names: string[];
  height: number;
  busy: boolean;
  lease?: DatabaseLease;
  staleTarget?: boolean;
  /** Table documents keep transaction controls without a redundant blank editor. */
  collapsed?: boolean;
  preparingClose?: boolean;
  onError: (message: string) => void;
  refresh: () => Promise<unknown>;
  invoke: (operation: string, params: Record<string, unknown>) => Promise<any>;
  runSql: (sql: string) => Promise<unknown>;
  saveCopy: (sql: string) => Promise<unknown>;
  registerFlush?: (
    consoleId: string,
    flush: DatabaseConsoleFlush | undefined,
  ) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function routineDocument(console: DatabaseConsole) {
  return ["function", "procedure"].includes(console.object?.kind || "");
}

function verifiedRoutine(
  console: DatabaseConsole,
  detail: DatabaseConsoleEditorProps["detail"],
  lease?: DatabaseLease,
) {
  const baseline = console.routineBaseline;
  const expected =
    baseline?.session?.leaseId === console.leaseId &&
    baseline?.session?.generation === lease?.generation
      ? baseline?.session?.hash
      : baseline?.committedHash;
  return (
    routineDocument(console) &&
    baseline?.verified &&
    !baseline.blocked &&
    !console.pendingEffect &&
    !!detail &&
    detail.oid === console.object?.oid &&
    typeof expected === "string" &&
    detail.hash === expected
  );
}

type DraftHandoff = {
  draft: { current: string };
  saved: { current: { revision: number; text: string } };
  tail: { current: Promise<number> };
  edits: { current: number };
  copy: { current: { text: string; result: Promise<unknown> } | undefined };
  error?: string;
  owners: Set<symbol>;
  listeners: Set<() => void>;
};
// This is a renderer-local handoff, not another persisted document store. Only
// detached unsaved/in-flight drafts remain here; durable SQL lives in the host.
const detachedDrafts = new Map<string, DraftHandoff>();
function draftHandoff(c: DatabaseConsole): DraftHandoff {
  const key = c.projectId + ":" + c.id;
  let value = detachedDrafts.get(key);
  if (!value) {
    value = {
      draft: { current: c.sql },
      saved: { current: { revision: c.revision, text: c.sql } },
      tail: { current: Promise.resolve(c.revision) },
      edits: { current: 0 },
      copy: { current: undefined },
      owners: new Set(),
      listeners: new Set(),
    };
    detachedDrafts.set(key, value);
  }
  return value;
}

export function DatabaseConsoleEditor(props: DatabaseConsoleEditorProps) {
  const {
    console: c,
    detail,
    job,
    names,
    height,
    busy,
    lease,
    staleTarget = false,
    collapsed = false,
    preparingClose = false,
    registerFlush,
  } = props;
  const ask = useAsk();
  const retained = useRef<DraftHandoff | undefined>(undefined);
  if (!retained.current) retained.current = draftHandoff(c);
  const handoff = retained.current;
  const draft = handoff.draft,
    saved = handoff.saved,
    tail = handoff.tail,
    edits = handoff.edits,
    copyHandoff = handoff.copy;
  const [text, setText] = useState(draft.current),
    [conflict, setConflict] = useState(
      !!handoff.error ||
        (c.revision > saved.current.revision &&
          draft.current !== saved.current.text),
    ),
    [dirty, setDirty] = useState(draft.current !== saved.current.text),
    [dispatching, setDispatching] = useState(false),
    [loadingServer, setLoadingServer] = useState(false),
    [runMode, setRunMode] = useState("statement");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    alive = useRef(true),
    running = useRef(false),
    loading = useRef(false),
    owner = useRef(Symbol(c.id)),
    binding = useRef({ consoleId: c.id, invoke: props.invoke }),
    latest = useRef(props);
  latest.current = props;
  const publish = () => {
    for (const listener of handoff.listeners) listener();
  };

  useEffect(() => {
    const token = owner.current;
    const sync = () => {
      setText(draft.current);
      setDirty(draft.current !== saved.current.text);
      setConflict(
        !!handoff.error ||
          (latest.current.console.revision > saved.current.revision &&
            draft.current !== saved.current.text),
      );
    };
    handoff.owners.add(token);
    handoff.listeners.add(sync);
    sync();
    return () => {
      handoff.owners.delete(token);
      handoff.listeners.delete(sync);
    };
  }, []);

  // The queue remains rejected after a failed save so close/flush cannot mistake
  // the swallowed error of an earlier debounce for a successfully saved draft.
  const save = useCallback(() => {
    const persist = async () => {
      const value = draft.current;
      if (value === saved.current.text) return saved.current.revision;
      const r = await binding.current.invoke("console.update", {
        revision: saved.current.revision,
        sql: value,
      });
      // An event may already have loaded a newer clean revision while this
      // acknowledgement was in flight. Never move the local baseline backwards.
      if (r.revision < saved.current.revision) return saved.current.revision;
      saved.current = { revision: r.revision, text: r.sql };
      handoff.error = undefined;
      publish();
      if (alive.current) {
        setDirty(draft.current !== r.sql);
        setConflict(false);
      }
      return r.revision as number;
    };
    // A new edit may retry a failed CAS; the server preserves conflicting SQL in
    // recovery. Existing callers still observe the rejected earlier promise.
    const next = tail.current.then(persist, persist);
    tail.current = next;
    return next;
  }, []);

  const reportSaveError = useCallback((error: unknown) => {
    handoff.error = errorMessage(error);
    publish();
    if (alive.current) setConflict(true);
    // Parent-owned errors must remain observable even when a tab has unmounted.
    latest.current.onError(errorMessage(error));
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const copy = copyHandoff.current;
    if (copy && copy.text === draft.current) {
      const copied = await copy.result;
      if (copied && copy.text === draft.current) return saved.current.revision;
    }
    await tail.current;
    return save();
  }, [save]);

  useEffect(() => {
    if (c.revision > saved.current.revision) {
      if (draft.current === saved.current.text) {
        saved.current = { revision: c.revision, text: c.sql };
        draft.current = c.sql;
        handoff.error = undefined;
        publish();
        setText(c.sql);
        setDirty(false);
        setConflict(false);
        tail.current = tail.current.then(
          () => saved.current.revision,
          () => saved.current.revision,
        );
      } else setConflict(true);
    }
  }, [c.revision, c.sql]);

  useEffect(() => {
    registerFlush?.(c.id, flush);
    return () => registerFlush?.(c.id, undefined);
  }, [c.id, flush, registerFlush]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void (async () => {
        await flush();
        const copy = copyHandoff.current;
        const copied = copy && (await copy.result);
        if (
          !handoff.owners.size &&
          ((copied && copy!.text === draft.current) ||
            (!handoff.error && draft.current === saved.current.text))
        ) {
          const key = c.projectId + ":" + c.id;
          if (detachedDrafts.get(key) === handoff) detachedDrafts.delete(key);
        }
      })().catch(reportSaveError);
    };
  }, [flush, reportSaveError]);

  const change = (value: string) => {
    // CodeMirror emits onChange for a programmatic value sync as well. Such a
    // sync must not look like user typing while an explicit load is in flight.
    if (value === draft.current) return;
    if (latest.current.preparingClose || loading.current) return;
    edits.current++;
    copyHandoff.current = undefined;
    setText(value);
    draft.current = value;
    publish();
    setDirty(value !== saved.current.text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save().catch(reportSaveError);
    }, 700);
  };

  const loadServer = () => {
    if (loading.current) return;
    clearTimeout(timer.current);
    const discardedAt = edits.current;
    loading.current = true;
    setLoadingServer(true);
    const load = async () => {
      try {
        // Desktop console.read returns the complete persisted SQL. Queue this
        // behind an in-flight save so its late response cannot restore the old
        // draft after the user explicitly loads the server version.
        const remote = await binding.current.invoke("console.read", {});
        if (edits.current !== discardedAt)
          throw new Error(
            "SQL изменился во время загрузки. Ваш новый текст сохранён в редакторе; повторите загрузку при необходимости.",
          );
        saved.current = { revision: remote.revision, text: remote.sql };
        draft.current = remote.sql;
        handoff.error = undefined;
        publish();
        if (alive.current) {
          setText(remote.sql);
          setConflict(false);
          setDirty(false);
        }
        return remote.revision as number;
      } finally {
        loading.current = false;
        if (alive.current) setLoadingServer(false);
      }
    };
    // Resolving the conflict is an explicit acknowledgement of a previous save
    // failure. A failed read still leaves flush rejected and blocks tab close.
    const next = tail.current.then(load, load);
    tail.current = next;
    void next.catch(reportSaveError);
  };

  const reloadRoutine = async () => {
    if (loading.current || latest.current.preparingClose) return;
    if (
      !(await ask("Загрузить DDL из БД?", {
        confirm: true,
        message:
          "Определение из базы данных заменит текущий текст. Ваш предыдущий SQL останется в восстановлении; новая серверная версия станет исходной для следующих изменений.",
      }))
    )
      return;
    if (!alive.current) return;
    loading.current = true;
    setLoadingServer(true);
    try {
      await flush();
      const next = tail.current.then(async () => {
        const remote = await binding.current.invoke("routine.reload", {
          revision: saved.current.revision,
        });
        saved.current = { revision: remote.revision, text: remote.sql };
        draft.current = remote.sql;
        handoff.error = undefined;
        publish();
        if (alive.current) {
          setText(remote.sql);
          setDirty(false);
          setConflict(false);
        }
        return remote.revision as number;
      });
      tail.current = next;
      await next;
      await latest.current.refresh();
    } catch (error) {
      reportSaveError(error);
    } finally {
      loading.current = false;
      if (alive.current) setLoadingServer(false);
    }
  };

  const run = async (selection = "", from = 0, force?: string) => {
    if (
      running.current ||
      loading.current ||
      latest.current.busy ||
      latest.current.preparingClose
    )
      return;
    const ensureTarget = () => {
      const p = latest.current;
      if (p.staleTarget)
        throw new Error(
          "Настройки подключения изменились. Откройте новую консоль для нового сервера; SQL этой вкладки сохранён.",
        );
      if (
        routineDocument(p.console) &&
        !verifiedRoutine(p.console, p.detail, p.lease)
      )
        throw new Error(
          "Исходная версия DDL не подтверждена или изменилась на сервере. Сравните версии или явно загрузите DDL из БД.",
        );
    };
    running.current = true;
    setDispatching(true);
    try {
      ensureTarget();
      const source = draft.current;
      await flush();
      if (saved.current.text !== source)
        throw new Error("SQL изменился во время сохранения. Повторите запуск.");
      await latest.current.refresh();
      ensureTarget();
      const p = latest.current;
      if (routineDocument(p.console)) {
        await binding.current.invoke("routineApply", {
          oid: p.console.object!.oid,
          sql: source,
          operationId: crypto.randomUUID(),
        });
        await p.refresh();
        return;
      }
      await p.runSql(
        force ||
          selection ||
          (runMode === "script" ? source : statementAt(source, from)),
      );
    } catch (error) {
      latest.current.onError(errorMessage(error));
    } finally {
      running.current = false;
      if (alive.current) setDispatching(false);
    }
  };

  const routine = routineDocument(c),
    unavailable =
      busy || dispatching || loadingServer || staleTarget || preparingClose,
    runUnavailable =
      unavailable || (routine && !verifiedRoutine(c, detail, lease));
  const runTitle = staleTarget
    ? "Подключение изменено: откройте новую консоль"
    : routine && !verifiedRoutine(c, detail, lease)
      ? c.routineBaseline?.blocked ||
        "Исходная версия DDL не подтверждена или изменилась"
      : routine
        ? "Применить DDL с проверкой версии · Ctrl+Enter"
        : "Выполнить SQL · Ctrl+Enter";

  return (
    <div className="db-console-editor" data-console-id={c.id}>
      <div className="db-sql-toolbar">
        {!collapsed && (
          <>
            <button
              className="primary"
              disabled={runUnavailable}
              title={runTitle}
              onClick={() => void run()}
            >
              <Icon name="play" size={15} />
              {routine ? "Применить DDL" : "Выполнить"}
            </button>
            {!routine && (
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
              disabled={loadingServer || preparingClose}
              onClick={() => {
                try {
                  change(format(draft.current, { language: "postgresql" }));
                } catch (error) {
                  latest.current.onError(errorMessage(error));
                }
              }}
            />
          </>
        )}
        {(!collapsed || busy) && (
          <IconButton
            icon="stop"
            label="Отменить операцию БД"
            disabled={!busy}
            onClick={() =>
              void binding.current
                .invoke("cancel", {})
                .catch((error) => latest.current.onError(errorMessage(error)))
            }
          />
        )}
        {!collapsed && !routine && (
          <Menu
            label="План выполнения SQL"
            items={[
              {
                label: "EXPLAIN · оценка",
                disabled: unavailable,
                action: () =>
                  void run(
                    "",
                    0,
                    "EXPLAIN (FORMAT JSON) " + statementAt(draft.current, 0),
                  ),
              },
              {
                label: "EXPLAIN ANALYZE · выполнить запрос",
                disabled: unavailable,
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
        {!collapsed && routine && (
          <button
            disabled={
              unavailable ||
              !!c.pendingEffect ||
              !lease ||
              lease.transaction !== "idle"
            }
            title="Принять актуальную серверную версию, сохранив текущий SQL в восстановлении"
            onClick={() => void reloadRoutine()}
          >
            Загрузить DDL из БД
          </button>
        )}
        {!collapsed && routine && c.routineBaseline?.blocked && (
          <span className="db-conflict" title={c.routineBaseline.blocked}>
            Требуется сверка DDL
          </span>
        )}
        {detail?.externalChange && (
          <span className="db-conflict">Серверная версия изменилась</span>
        )}
        {dirty && <span className="muted">●</span>}
        {conflict && (
          <span
            className="db-conflict"
            title="SQL не сохранён. Чужая версия не перезаписывается; сохраните свой текст отдельной копией или загрузите актуальную версию."
          >
            Конфликт версии
            <button
              disabled={preparingClose || loadingServer}
              onClick={() => {
                const value = draft.current;
                const result = latest.current.saveCopy(value);
                copyHandoff.current = { text: value, result };
                void result.catch((error) =>
                  latest.current.onError(errorMessage(error)),
                );
              }}
            >
              Сохранить копию
            </button>
            <button
              disabled={loadingServer || preparingClose}
              onClick={loadServer}
            >
              Загрузить сохранённый SQL
            </button>
          </span>
        )}
        <div className="db-spacer" />
        <select
          aria-label="Режим транзакции"
          disabled={unavailable || !lease}
          value={lease?.mode || c.mode}
          onChange={(e) =>
            void binding.current
              .invoke("transaction", { action: "mode", mode: e.target.value })
              .then(() => latest.current.refresh())
              .catch((error) => latest.current.onError(errorMessage(error)))
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
                unavailable ||
                lease.transaction === "failed" ||
                lease.transaction === "unknown"
              }
              onClick={() =>
                void binding.current
                  .invoke("transaction", { action: "commit" })
                  .then(() => latest.current.refresh())
                  .catch((error) => latest.current.onError(errorMessage(error)))
              }
            >
              Commit
            </button>
            <button
              disabled={unavailable || lease.transaction === "unknown"}
              onClick={() =>
                void binding.current
                  .invoke("transaction", { action: "rollback" })
                  .then(() => latest.current.refresh())
                  .catch((error) => latest.current.onError(errorMessage(error)))
              }
            >
              Rollback
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <div style={{ height, flexShrink: 0 }}>
          <SqlEditor
            errorPosition={
              job?.error?.position &&
              job.sql &&
              text.indexOf(job.sql) >= 0 &&
              text.indexOf(job.sql) === text.lastIndexOf(job.sql)
                ? text.indexOf(job.sql) +
                  (job.error.statementOffset || 0) +
                  Array.from(job.sql.slice(job.error.statementOffset || 0))
                    .slice(0, job.error.position - 1)
                    .join("").length
                : undefined
            }
            value={text}
            readOnly={preparingClose || loadingServer}
            onChange={change}
            onRun={(selection, from) => void run(selection, from)}
            names={names}
          />
        </div>
      )}
    </div>
  );
}
