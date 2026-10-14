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
  onClose,
}: {
  jobs: DatabaseJob[];
  read: (p: Record<string, unknown>) => Promise<Chunk>;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState(jobs.at(-1)?.id || ""),
    [part, setPart] = useState("sql"),
    [offset, setOffset] = useState(0),
    [chunk, setChunk] = useState<Chunk>(),
    [error, setError] = useState("");
  const selected = jobs.find((j) => j.id === jobId),
    size = 8192;
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setChunk(undefined);
    setError("");
    void read({ jobId, part, offset, limit: size })
      .then((r) => {
        if (!cancelled) setChunk(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, part, offset]);
  const status = {
    running: "Выполняется",
    completed: "Завершено",
    failed: "Ошибка",
    cancelled: "Отменено",
    unknown: "Исход неизвестен",
  };
  return (
    <Modal title="История операций консоли" onClose={onClose} wide>
      <div className="db-history">
        <nav aria-label="Операции консоли">
          {[...jobs].reverse().map((j) => (
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
                {new Date(j.startedAt).toLocaleString("ru-RU")} · {j.rows} строк
              </small>
              <span>
                {j.sql?.slice(0, 100) || j.file?.path?.split(/[\\/]/).at(-1)}
              </span>
            </button>
          ))}
        </nav>
        <section>
          <div className="db-inline">
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
          {selected?.error && (
            <p role="alert">
              {selected.error.code} · {selected.error.message}
            </p>
          )}
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <>
              <pre className="db-output">
                {chunk?.text || "Читаю сохранённый текст…"}
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
