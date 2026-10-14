import { useEffect, useState } from "react";
import type { DatabaseJob } from "../shared/database";
import { Modal } from "./ui";
type Chunk = {
  text: string;
  offset: number;
  total: number;
  truncated: boolean;
  hash: string;
};
export function DatabaseHistory({
  jobs,
  read,
  listOperations,
  readOperation,
  onClose,
}: {
  jobs: DatabaseJob[];
  read: (p: Record<string, unknown>) => Promise<Chunk>;
  listOperations: (p: Record<string, unknown>) => Promise<{
    operations: {
      operationId: string;
      kind: string;
      at: string;
      receiptStatus: string;
      jobStatus?: string;
    }[];
    hasMore: boolean;
  }>;
  readOperation: (p: Record<string, unknown>) => Promise<Chunk>;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState(jobs.at(-1)?.id || ""),
    [part, setPart] = useState("sql"),
    [offset, setOffset] = useState(0),
    [chunk, setChunk] = useState<Chunk>(),
    [error, setError] = useState(""),
    [mode, setMode] = useState("queries"),
    [operationId, setOperationId] = useState(""),
    [operationOffset, setOperationOffset] = useState(0),
    [operations, setOperations] = useState<
      {
        operationId: string;
        kind: string;
        at: string;
        receiptStatus: string;
        jobStatus?: string;
      }[]
    >([]),
    [more, setMore] = useState(false);
  const selected = jobs.find((j) => j.id === jobId),
    size = 8192;
  useEffect(() => {
    setChunk(undefined);
    if (!(mode === "queries" ? jobId : operationId)) return;
    let cancelled = false;
    setError("");
    void (
      mode === "queries"
        ? read({ jobId, part, offset, limit: size })
        : readOperation({ operationId, offset, limit: size })
    )
      .then((r) => {
        if (!cancelled) setChunk(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, jobId, operationId, part, offset]);
  useEffect(() => {
    if (mode !== "operations") return;
    let cancelled = false;
    void listOperations({ offset: operationOffset, limit: 20 })
      .then((r) => {
        if (!cancelled) {
          setOperations(r.operations);
          setMore(r.hasMore);
          setOperationId(r.operations[0]?.operationId || "");
          setOffset(0);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, operationOffset]);
  const status = {
    running: "Выполняется",
    completed: "Завершено",
    failed: "Ошибка",
    cancelled: "Отменено",
    unknown: "Исход неизвестен",
  };
  return (
    <Modal title="История операций консоли" onClose={onClose} wide>
      <div className="db-inline" role="tablist" aria-label="Режим истории">
        <button
          role="tab"
          aria-selected={mode === "queries"}
          onClick={() => {
            setMode("queries");
            setOffset(0);
          }}
        >
          SQL и результаты
        </button>
        <button
          role="tab"
          aria-selected={mode === "operations"}
          onClick={() => {
            setMode("operations");
            setOffset(0);
          }}
        >
          Журнал операций
        </button>
      </div>
      <div className="db-history">
        <nav aria-label="Операции консоли">
          {mode === "queries"
            ? [...jobs].reverse().map((j) => (
                <button
                  key={j.id}
                  className={j.id === jobId ? "active" : ""}
                  onClick={() => {
                    setJobId(j.id);
                    setOffset(0);
                  }}
                >
                  <strong>
                    {j.kind} · {status[j.status]}
                  </strong>
                  <small>
                    {new Date(j.startedAt).toLocaleString("ru-RU")} · {j.rows}{" "}
                    строк
                  </small>
                  <span>
                    {j.sql?.slice(0, 100) ||
                      j.file?.path?.split(/[\\/]/).at(-1)}
                  </span>
                </button>
              ))
            : operations.map((o) => (
                <button
                  key={o.operationId}
                  className={operationId === o.operationId ? "active" : ""}
                  onClick={() => {
                    setOperationId(o.operationId);
                    setOffset(0);
                  }}
                >
                  <strong>
                    {o.kind} ·{" "}
                    {o.jobStatus
                      ? status[o.jobStatus as keyof typeof status]
                      : o.receiptStatus === "done"
                        ? "Ответ получен"
                        : o.receiptStatus === "failed"
                          ? "Ошибка"
                          : "Подтверждение не получено"}
                  </strong>
                  <small>{new Date(o.at).toLocaleString("ru-RU")}</small>
                  <span title={o.operationId}>{o.operationId}</span>
                </button>
              ))}
          {mode === "operations" && (
            <div className="db-inline">
              <button
                disabled={!operationOffset}
                onClick={() =>
                  setOperationOffset(Math.max(0, operationOffset - 20))
                }
              >
                Ранее
              </button>
              <button
                disabled={!more}
                onClick={() => setOperationOffset(operationOffset + 20)}
              >
                Далее
              </button>
            </div>
          )}
        </nav>
        <section>
          <div className="db-inline">
            {mode === "queries" ? (
              <select
                aria-label="Детали сохранённой операции"
                value={part}
                onChange={(e) => {
                  setPart(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="sql">SQL</option>
                <option value="request">Параметры и сервер</option>
              </select>
            ) : (
              <strong>Исходная операция · только чтение</strong>
            )}
            <span className="db-spacer" />
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - size))}
            >
              Предыдущий фрагмент
            </button>
            <button
              disabled={!chunk?.truncated}
              onClick={() => setOffset(offset + size)}
            >
              Следующий фрагмент
            </button>
          </div>
          {mode === "queries" && selected?.error && (
            <p role="alert">
              {selected.error.code} · {selected.error.message}
            </p>
          )}
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <>
              <pre className="db-output">
                {chunk
                  ? chunk.text || "Сохранённый текст пуст"
                  : (mode === "queries" ? !jobId : !operationId)
                    ? "Нет сохранённых операций"
                    : "Читаю сохранённый текст…"}
              </pre>
              {chunk && (
                <small className="muted">
                  {chunk.offset + 1}–
                  {Math.min(chunk.offset + size, chunk.total)} из {chunk.total}{" "}
                  символов · SHA-256 {chunk.hash}
                </small>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
