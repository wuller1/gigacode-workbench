import { useState } from "react";
import type { QueueItem } from "../shared/types";
import type { Invoke } from "./api";
import { errorText } from "./api";
import { Icon, IconButton } from "./ui";

export function QueueMessages({
  items,
  sessionId,
  running,
  unknown,
  invoke,
  onRestore,
}: {
  items: QueueItem[];
  sessionId: string;
  running: boolean;
  unknown: boolean;
  invoke: Invoke;
  onRestore(text: string): void;
}) {
  const [open, setOpen] = useState(true),
    [editing, setEditing] = useState<{ id: string; text: string }>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const exists = editing && items.some((item) => item.id === editing.id);
  async function act(method: string, params: Record<string, unknown>) {
    if (pending) return false;
    setPending(true);
    setError("");
    try {
      await invoke(method, { sessionId, ...params });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  if (!items.length && !editing) return null;
  return (
    <div className="queue-area">
      <button
        className="queue-heading"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="clock" size={14} />
        {items.length} в очереди
        <span>{running ? "после текущего ответа" : "ожидают отправки"}</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
      </button>
      {open && (
        <div className="queue-list">
          {items.map((item, index) => (
            <div className="queue-row" key={item.id}>
              <span title={item.text}>{item.text}</span>
              <div className="queue-actions">
                <IconButton
                  icon="send"
                  label="Отправить сейчас"
                  disabled={pending || unknown}
                  onClick={() => void act("queue.sendNow", { id: item.id })}
                />
                <IconButton
                  icon="edit"
                  label="Редактировать сообщение"
                  disabled={pending}
                  onClick={() => setEditing({ id: item.id, text: item.text })}
                />
                {index > 0 && (
                  <IconButton
                    icon="chevron-up"
                    label="Поднять в очереди"
                    disabled={pending}
                    onClick={() =>
                      void act("queue.move", { id: item.id, index: index - 1 })
                    }
                  />
                )}
                <IconButton
                  icon="close"
                  label="Удалить из очереди"
                  disabled={pending}
                  onClick={() => void act("queue.delete", { id: item.id })}
                />
              </div>
            </div>
          ))}
          {editing && (
            <div className="queue-editor">
              <textarea
                aria-label="Редактирование сообщения в очереди"
                autoFocus
                value={editing.text}
                onChange={(e) =>
                  setEditing({ ...editing, text: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(undefined);
                  }
                }}
              />
              {!exists && (
                <p>
                  Сообщение уже отправлено или удалено. Изменённый текст
                  сохранён здесь.
                </p>
              )}
              <div>
                <button
                  disabled={pending || !editing.text.trim()}
                  onClick={async () => {
                    if (!exists) {
                      onRestore(editing.text);
                      setEditing(undefined);
                    } else if (
                      await act("queue.update", {
                        id: editing.id,
                        text: editing.text,
                      })
                    )
                      setEditing(undefined);
                  }}
                >
                  {exists ? "Сохранить" : "Вставить в поле ввода"}
                </button>
                <button
                  disabled={pending}
                  onClick={() => setEditing(undefined)}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
          {!running && !unknown && items.length > 0 && (
            <button
              disabled={pending}
              onClick={() => void act("queue.resume", {})}
            >
              Продолжить очередь
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="queue-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
