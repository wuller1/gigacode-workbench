import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import type {
  OpsActionOperation,
  OpsConnection,
  OpsError,
  OpsPreparedAction,
  OpsQueryResult,
  OpsReceipt,
  OpsSnapshot,
  OpsValue,
} from "../shared/operations";
import { Icon, IconButton } from "./ui";
import "./operations.css";

/** Desktop tool windows adapt to their actual dock width without changing saved sizes. */
export function useOpsPanelWidth() {
  const ref = useRef<HTMLElement | null>(null),
    [width, setWidth] = useState(1000);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export type JenkinsConsoleTextState = { pending: string; hidden: boolean };
/** ConsoleNote envelopes are hidden metadata, even across progressive-log chunks. */
export function stripJenkinsConsoleText(
  chunk: string,
  state: JenkinsConsoleTextState,
): string {
  const start = "\u001b[8mha:",
    end = "\u001b[0m";
  let source = state.pending + chunk,
    position = 0,
    output = "";
  state.pending = "";
  const overlap = (value: string, marker: string) => {
    for (let size = Math.min(marker.length - 1, value.length); size > 0; size--)
      if (value.endsWith(marker.slice(0, size))) return size;
    return 0;
  };
  while (position < source.length) {
    const marker = state.hidden ? end : start,
      index = source.indexOf(marker, position);
    if (index < 0) {
      const tail = source.slice(position),
        held = overlap(tail, marker);
      if (!state.hidden) output += tail.slice(0, tail.length - held);
      state.pending = held ? tail.slice(-held) : "";
      return output;
    }
    if (!state.hidden) output += source.slice(position, index);
    state.hidden = !state.hidden;
    position = index + marker.length;
  }
  return output;
}
export interface OpsRevealRequest {
  nonce: number;
  payload: {
    projectId: string;
    connectionId?: string;
    kind?: "jenkins" | "cluster";
    jobId?: string;
    number?: number;
    creation?: boolean;
    target?: {
      group?: string;
      version?: string;
      resource?: string;
      namespace?: string;
      name?: string;
      number?: number;
      creation?: boolean;
    };
  };
}
export interface OpsPanelProps {
  projectId?: string;
  sessionId?: string;
  visible?: boolean;
  onSettings?: () => void;
  onAssist?: (text: string) => void;
  reveal?: OpsRevealRequest;
}
const empty: OpsSnapshot = {
  connections: [],
  prepared: [],
  receipts: [],
  favorites: [],
};
export const opsCall = async (
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> => {
  if (!window.workbench)
    throw new Error("Связь с локальным приложением недоступна.");
  return window.workbench.invoke(method, params);
};
export function opsFailure(error: unknown): OpsError {
  const message = error instanceof Error ? error.message : String(error),
    offset = message.indexOf("OPS_ERROR:");
  if (offset >= 0)
    try {
      const detail = JSON.parse(message.slice(offset + "OPS_ERROR:".length));
      if (
        typeof detail.kind === "string" &&
        typeof detail.message === "string" &&
        ["notApplied", "unknown"].includes(detail.outcome)
      )
        return detail;
    } catch {}
  return { kind: "unknown", message, outcome: "unknown" };
}
const errorLabels: Record<string, string> = {
  unauthenticated: "Нужна авторизация",
  forbidden: "Нет доступа",
  not_found: "Не найдено",
  validation: "Проверьте параметры",
  conflict: "Версия изменилась",
  payload_too_large: "Ответ слишком большой",
  rate_limited: "Лимит запросов",
  offline: "Нет связи",
  timeout: "Истекло время ожидания",
  unsupported: "Возможность недоступна",
  protocol: "Несовместимый ответ",
  unknown: "Ошибка операции",
};
export function opsErrorText(error: unknown) {
  const detail = opsFailure(error);
  return `${errorLabels[detail.kind] || detail.kind}: ${detail.message}`;
}
export function useOpsSnapshot(projectId?: string, visible = true) {
  const [snapshot, setSnapshot] = useState<OpsSnapshot>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [resolvedScope, setResolvedScope] = useState("");
  const scope = JSON.stringify([projectId]);
  const sequence = useRef(0);
  const activeProject = useRef(projectId),
    alive = useRef(true);
  activeProject.current = projectId;
  const refresh = useCallback(async () => {
    if (!alive.current || activeProject.current !== projectId) return;
    const id = ++sequence.current;
    setLoading(true);
    try {
      const value: OpsSnapshot = await opsCall("ops.snapshot", { projectId });
      if (sequence.current === id) {
        setSnapshot(value);
        setResolvedScope(JSON.stringify([projectId]));
        setError("");
      }
    } catch (e) {
      if (sequence.current === id) setError(opsErrorText(e));
    } finally {
      if (sequence.current === id) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    alive.current = true;
    setSnapshot(empty);
    void refresh();
    const off = window.workbench?.subscribe((e) => {
      if (
        e.type === "ops.changed" &&
        (!(e.payload as any)?.projectId ||
          !projectId ||
          (e.payload as any).projectId === projectId)
      )
        void refresh();
    });
    const timer = visible ? setInterval(() => void refresh(), 5000) : undefined;
    return () => {
      alive.current = false;
      ++sequence.current;
      off?.();
      if (timer) clearInterval(timer);
    };
  }, [refresh, visible, projectId]);
  return { snapshot, refresh, error, loading, ready: resolvedScope === scope };
}
export function hasCapability(
  connection: OpsConnection | undefined,
  operation: string,
) {
  return (
    !!connection?.enabled &&
    !!connection.discovered?.capabilities.includes(operation)
  );
}
export function useOpsQuery<T>(
  projectId: string | undefined,
  connection: OpsConnection | undefined,
  operation: string,
  input: Record<string, unknown>,
  enabled = true,
  pollMs = 0,
) {
  const key = JSON.stringify([
    projectId,
    connection?.id,
    connection?.targetHash,
    connection?.authGeneration,
    operation,
    input,
  ]);
  const [value, setValue] = useState<OpsQueryResult<T>>(),
    [error, setError] = useState<OpsError>(),
    [loading, setLoading] = useState(false),
    [resolvedKey, setResolvedKey] = useState("");
  const sequence = useRef(0),
    active = useRef(key),
    running = useRef(false);
  const retry = useRef({ until: 0, blocked: false, failures: 0 });
  active.current = key;
  const refresh = useCallback(
    async (manual = true) => {
      if (
        active.current !== key ||
        !enabled ||
        !projectId ||
        !connection ||
        running.current
      )
        return;
      if (
        Date.now() < retry.current.until ||
        (!manual && retry.current.blocked)
      )
        return;
      if (manual) retry.current.blocked = false;
      const id = ++sequence.current,
        captured = key;
      running.current = true;
      setLoading(true);
      try {
        const result: OpsQueryResult<T> = await opsCall("ops.query", {
          projectId,
          connectionId: connection.id,
          expectedTargetHash: connection.targetHash,
          expectedAuthGeneration: connection.authGeneration,
          operation,
          input: JSON.parse(key)[5],
        });
        if (sequence.current === id && active.current === captured) {
          setValue(result);
          setError(undefined);
          setResolvedKey(captured);
          retry.current = { until: 0, blocked: false, failures: 0 };
        }
      } catch (e) {
        if (sequence.current === id && active.current === captured) {
          const detail = opsFailure(e),
            failures = retry.current.failures + 1;
          retry.current = {
            failures,
            blocked: [
              "forbidden",
              "unauthenticated",
              "unsupported",
              "not_found",
              "protocol",
              "validation",
            ].includes(detail.kind),
            until:
              detail.kind === "rate_limited"
                ? Date.now() + (detail.retryAfterMs || 30_000)
                : ["offline", "timeout"].includes(detail.kind)
                  ? Date.now() +
                    Math.min(30_000, 1500 * 2 ** Math.min(failures, 4))
                  : 0,
          };
          setError(detail);
          setResolvedKey(captured);
        }
      } finally {
        if (sequence.current === id) {
          running.current = false;
          setLoading(false);
        }
      }
    },
    [key, enabled],
  );
  useEffect(() => {
    ++sequence.current;
    running.current = false;
    retry.current = { until: 0, blocked: false, failures: 0 };
    setValue(undefined);
    setError(undefined);
    setLoading(false);
    void refresh(false);
    const timer =
      enabled && pollMs
        ? setInterval(() => void refresh(false), pollMs)
        : undefined;
    return () => {
      ++sequence.current;
      running.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh, pollMs]);
  return {
    value: resolvedKey === key ? value : undefined,
    loading,
    error: resolvedKey === key ? error : undefined,
    refresh,
  };
}
export function OpsErrorBox({
  message,
  retry,
  dismiss,
}: {
  message?: string | OpsError;
  retry?: () => void;
  dismiss?: () => void;
}) {
  if (!message) return null;
  const detail = typeof message === "string" ? undefined : message;
  return (
    <div className="ops-error" role="alert" data-error-kind={detail?.kind}>
      <Icon name="warning" size={16} />
      <span>
        {detail ? (
          <>
            <strong>
              {errorLabels[detail.kind] || detail.kind}
              {detail.status ? ` · ${detail.status}` : ""}
            </strong>
            <br />
            {detail.message}
            {detail.retryAfterMs ? (
              <small>
                {" "}
                · повтор не раньше чем через{" "}
                {Math.ceil(detail.retryAfterMs / 1000)} с
              </small>
            ) : null}
          </>
        ) : typeof message === "string" ? (
          message
        ) : (
          ""
        )}
      </span>
      {retry && (
        <button type="button" onClick={retry}>
          Повторить чтение
        </button>
      )}
      {dismiss && (
        <IconButton icon="close" label="Скрыть сообщение" onClick={dismiss} />
      )}
    </div>
  );
}
export function OpsEmpty({
  title,
  children,
  action,
  label = "Настроить подключения",
}: {
  title: string;
  children?: ReactNode;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="ops-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action && (
        <button type="button" onClick={action}>
          {label}
        </button>
      )}
    </div>
  );
}
export function OpsBadge({ status }: { status?: string | null }) {
  const raw = status || "Не запускалась",
    text: Record<string, string> = {
      SUCCESS: "Успешно",
      FAILURE: "Ошибка",
      UNSTABLE: "Нестабильно",
      ABORTED: "Остановлено",
      NOT_BUILT: "Не выполнялась",
      running: "Выполняется",
      accepted: "В очереди",
      dispatching: "Отправляется",
      confirmed: "Подтверждено",
      failed: "Ошибка",
      cancelled: "Отменено",
      unknown: "Исход неизвестен",
      Pending: "Ожидает",
      Running: "Работает",
      Succeeded: "Завершено",
      Failed: "Ошибка",
    };
  const tone = /SUCCESS|confirmed|Succeeded|Ready|Available/.test(raw)
    ? "good"
    : /FAILURE|failed|Failed|Error/.test(raw)
      ? "bad"
      : /UNSTABLE|unknown|Pending/.test(raw)
        ? "warn"
        : /running|Running|accepted|dispatching/.test(raw)
          ? "live"
          : "neutral";
  return (
    <span className={`ops-badge ${tone}`}>
      {tone === "live" && <span className="working-arc" />}
      {text[raw] || raw}
    </span>
  );
}
export function elapsed(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds} с`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
      : `${Math.floor(seconds / 3600)} ч ${Math.floor(seconds / 60) % 60} мин`;
}
export function observedAt(value?: string) {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";
}
export function OpsCode({
  text,
  language = "json",
  label,
}: {
  text: string;
  language?: "json" | "yaml" | "log";
  label?: string;
}) {
  const source = text.slice(0, 256 * 1024);
  const token =
    /("(?:\\.|[^"\\])*"|'[^'\n]*'|\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b|\b(?:ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b|#[^\n]*$|^[\w.\/-]+(?=:))/gm;
  const pieces: ReactNode[] = [];
  let start = 0,
    match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match.index > start) pieces.push(source.slice(start, match.index));
    const value = match[0],
      after = source.slice(match.index + value.length).trimStart();
    const type = /^ERROR|^FATAL/.test(value)
      ? "error"
      : /^WARN/.test(value)
        ? "warning"
        : /^(INFO|DEBUG|TRACE)$/.test(value)
          ? "severity"
          : value.startsWith("#")
            ? "comment"
            : /^\d|^(true|false|null)$/.test(value)
              ? "number"
              : after.startsWith(":")
                ? "key"
                : "string";
    pieces.push(
      <span key={match.index} className={`ops-syntax-${type}`}>
        {value}
      </span>,
    );
    start = match.index + value.length;
  }
  pieces.push(source.slice(start));
  return (
    <>
      <pre
        className={`ops-code ops-code-${language}`}
        aria-label={label}
        tabIndex={0}
      >
        {pieces}
      </pre>
      {text.length > source.length && (
        <p className="ops-notice">
          Показаны первые 262 144 символа. Полный текст нужно читать порциями.
        </p>
      )}
    </>
  );
}
export function OpsYamlEditor({
  value,
  readOnly,
  onChange,
  onSave,
  onApply,
  onLimit,
}: {
  value: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onApply?: () => void;
  onLimit?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | undefined>(undefined),
    access = useRef(new Compartment()),
    callbacks = useRef({ onChange, onSave, onApply, onLimit });
  callbacks.current = { onChange, onSave, onApply, onLimit };
  useEffect(() => {
    if (!host.current) return;
    const language = StreamLanguage.define({
      token(stream) {
        if (stream.eatSpace()) return null;
        if (stream.peek() === "#") {
          stream.skipToEnd();
          return "comment";
        }
        if (stream.match(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/)) return "string";
        if (stream.match(/[\w.\/-]+(?=\s*:)/)) return "propertyName";
        if (stream.match(/\b(?:true|false|null|~)\b/)) return "bool";
        if (stream.match(/-?\d+(?:\.\d+)?\b/)) return "number";
        if (stream.match(/[&*!][\w.-]+/)) return "variableName";
        stream.next();
        return null;
      },
    });
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          EditorState.transactionFilter.of((transaction) => {
            if (
              transaction.docChanged &&
              new TextEncoder().encode(transaction.newDoc.toString()).length >
                1024 * 1024
            ) {
              queueMicrotask(() => callbacks.current.onLimit?.());
              return [];
            }
            return transaction;
          }),
          bracketMatching(),
          language,
          access.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.propertyName, color: "var(--ops-key)" },
              { tag: tags.string, color: "var(--ops-string)" },
              {
                tag: [tags.number, tags.bool, tags.null],
                color: "var(--ops-number)",
              },
              { tag: tags.comment, color: "var(--ops-comment)" },
            ]),
          ),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onApply?.();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "YAML ресурса Kubernetes",
            spellcheck: "false",
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "var(--ops-code)",
              color: "var(--text)",
              fontSize: "11px",
            },
            ".cm-scroller": {
              fontFamily: "Consolas, Menlo, monospace",
              overflow: "auto",
            },
            ".cm-content": { padding: "9px 0" },
            ".cm-gutters": {
              backgroundColor: "var(--ops-code)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine,.cm-activeLineGutter": {
              backgroundColor: "var(--selected)",
            },
            ".cm-selectionBackground,&.cm-focused .cm-selectionBackground": {
              backgroundColor: "var(--selected)",
            },
            ".cm-tooltip": {
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line)",
            },
            "&.cm-focused": { outline: "none" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
  }, [value]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: access.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);
  return <div className="ops-yaml-editor" ref={host} />;
}
export function OpsDivider({
  onResize,
  label = "Изменить ширину панели",
  vertical = false,
}: {
  onResize: (delta: number) => void;
  label?: string;
  vertical?: boolean;
}) {
  const previous = useRef<number | undefined>(undefined);
  return (
    <div
      className={`ops-divider ${vertical ? "vertical" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      tabIndex={0}
      onPointerDown={(e) => {
        previous.current = vertical ? e.clientY : e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (previous.current === undefined) return;
        const current = vertical ? e.clientY : e.clientX;
        onResize(current - previous.current);
        previous.current = current;
      }}
      onPointerUp={(e) => {
        previous.current = undefined;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        previous.current = undefined;
      }}
      onKeyDown={(e) => {
        const negative = vertical ? "ArrowUp" : "ArrowLeft",
          positive = vertical ? "ArrowDown" : "ArrowRight";
        if (e.key === negative || e.key === positive) {
          e.preventDefault();
          onResize(e.key === negative ? -12 : 12);
        }
      }}
    />
  );
}
export function OpsStar({
  enabled,
  label,
  onClick,
  disabled = false,
}: {
  enabled: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ops-star"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={onClick}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
      </svg>
    </button>
  );
}
export interface OpsActionRequest {
  id: string;
  projectId: string;
  connectionId: string;
  expectedTargetHash: string;
  expectedAuthGeneration: number;
  operation: OpsActionOperation;
  input: Record<string, OpsValue>;
  title: string;
  target: string;
}
export function OpsActionReview({
  request,
  onClose,
  onExecuted,
}: {
  request: OpsActionRequest;
  onClose: () => void;
  onExecuted: (receipt: OpsReceipt) => void;
}) {
  const [prepared, setPrepared] = useState<OpsPreparedAction>(),
    [receipt, setReceipt] = useState<OpsReceipt>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    generation = useRef(0),
    operationId = useRef(crypto.randomUUID()),
    executed = useRef(false),
    delivered = useRef(""),
    mounted = useRef(false);
  const { snapshot: live } = useOpsSnapshot(request.projectId);
  const deliver = (value: OpsReceipt) => {
    if (!mounted.current) return;
    const signature = JSON.stringify([value.id, value.status, value.updatedAt]);
    if (delivered.current === signature) return;
    delivered.current = signature;
    setReceipt(value);
    onExecuted(value);
  };
  useEffect(() => {
    const current = live.receipts.find((value) =>
      receipt
        ? value.id === receipt.id
        : executed.current &&
          prepared &&
          value.preparedActionId === prepared.id,
    );
    if (current) deliver(current);
  }, [live.receipts, receipt?.id, prepared?.id]);
  const prepare = async () => {
    if (lock.current || executed.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const epoch = ++generation.current;
    try {
      const result = await opsCall("ops.prepare", {
        projectId: request.projectId,
        connectionId: request.connectionId,
        expectedTargetHash: request.expectedTargetHash,
        expectedAuthGeneration: request.expectedAuthGeneration,
        operation: request.operation,
        input: request.input,
        operationId: operationId.current,
      });
      if (mounted.current && epoch === generation.current) setPrepared(result);
    } catch (e) {
      if (mounted.current && epoch === generation.current)
        setError(opsErrorText(e));
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    // StrictMode may replay setup while the same read-only prepare is pending.
    // Keep its promise/lock; only delivery is disabled during a real unmount.
    void prepare();
    return () => {
      mounted.current = false;
    };
  }, []);
  const execute = async () => {
    if (!prepared || lock.current || executed.current) return;
    lock.current = true;
    executed.current = true;
    setBusy(true);
    setError("");
    const epoch = generation.current;
    try {
      const result: OpsReceipt = await opsCall("ops.execute", {
        projectId: request.projectId,
        preparedActionId: prepared.id,
      });
      if (mounted.current && epoch === generation.current) {
        deliver(result);
      }
    } catch (e) {
      if (mounted.current && epoch === generation.current)
        setError(opsErrorText(e));
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  return (
    <section className="ops-review" aria-label={request.title}>
      <div className="ops-review-head">
        <strong>{request.title}</strong>
        <span className="ops-spacer" />
        <IconButton
          icon="close"
          label="Закрыть просмотр операции"
          disabled={busy}
          onClick={onClose}
        />
      </div>
      <p className="ops-target">{request.target}</p>
      <OpsErrorBox
        message={error}
        retry={!executed.current ? () => void prepare() : undefined}
      />
      {prepared && !receipt && (
        <>
          <OpsCode
            text={JSON.stringify(prepared.preview, null, 2)}
            label="Проверенный план операции"
          />
          <div className="ops-action-row">
            <span className="ops-muted">{prepared.summary}</span>
            <button
              type="button"
              className="primary"
              onClick={() => void execute()}
              disabled={busy || executed.current}
            >
              {busy ? "Отправляется…" : "Выполнить"}
            </button>
          </div>
        </>
      )}
      {!prepared && !error && (
        <p className="ops-muted">Проверяется точная цель операции…</p>
      )}
      {receipt && (
        <div className="ops-action-row">
          <OpsBadge status={receipt.status} />
          <span className="ops-muted">
            {receipt.remoteId || receipt.operationId}
          </span>
        </div>
      )}
      {executed.current && error && (
        <p className="ops-notice">
          Запрос не повторяется автоматически. Проверьте журнал операций и
          сверьте внешний результат.
        </p>
      )}
    </section>
  );
}
export function OpsReceipts({
  receipts,
  projectId,
  refresh,
}: {
  receipts: OpsReceipt[];
  projectId?: string;
  refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  if (!receipts.length) return null;
  return (
    <details className="ops-receipts">
      <summary>
        Операции · {receipts.length}
        {receipts.some((r) => r.status === "unknown")
          ? " · требуется сверка"
          : ""}
      </summary>
      <OpsErrorBox message={error} />
      {[
        ...receipts.filter(
          (r) => !["confirmed", "failed", "cancelled"].includes(r.status),
        ),
        ...receipts
          .filter((r) =>
            ["confirmed", "failed", "cancelled"].includes(r.status),
          )
          .slice(0, 12),
      ].map((r) => (
        <div className="ops-receipt" key={r.id}>
          <OpsBadge status={r.status} />
          <span>
            <b>{r.operation}</b>
            <small>{r.remoteId || r.operationId}</small>
          </span>
          {["unknown", "accepted", "running", "dispatching"].includes(
            r.status,
          ) && (
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                setBusy(r.id);
                setError("");
                try {
                  await opsCall("ops.reconcile", {
                    projectId: r.projectId || projectId,
                    receiptId: r.id,
                  });
                  await refresh();
                } catch (e) {
                  setError(opsErrorText(e));
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy === r.id ? "Проверяется…" : "Сверить"}
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
