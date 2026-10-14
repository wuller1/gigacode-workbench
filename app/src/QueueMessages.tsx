import { useRef, useState } from "react";
import type { QueueItem } from "../shared/types";
import type { Invoke } from "./api";
import { errorText } from "./api";
import { Icon, IconButton } from "./ui";
import { QueueEditJournal, type QueueEditDraft } from "./queue-edit-journal";

export function QueueMessages({
  items,
  sessionId,
  running,
  unknown,
  stopped = false,
  invoke,
  onRestore,
}: {
  items: QueueItem[];
  sessionId: string;
  running: boolean;
  unknown: boolean;
  stopped?: boolean;
  invoke: Invoke;
  onRestore(text: string): void;
}) {
  return (
    <SessionQueueMessages
      key={sessionId}
      {...{ items, sessionId, running, unknown, stopped, invoke, onRestore }}
    />
  );
}
function SessionQueueMessages({
  items,
  sessionId,
  running,
  unknown,
  stopped,
  invoke,
  onRestore,
}: Parameters<typeof QueueMessages>[0]) {
  const journal = useRef<QueueEditJournal | undefined>(undefined);
  if (!journal.current)
    journal.current = new QueueEditJournal(
      localStorage,
      window.workbench?.windowKey || "primary",
      sessionId,
    );
  const [retained, setRetained] = useState(() => journal.current!.active());
  const [open, setOpen] = useState(true),
    [editing, setEditing] = useState<QueueEditDraft | undefined>(retained),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const editingRef = useRef(editing);
  const edit = (next: QueueEditDraft) => {
    try {
      journal.current!.write(next);
    } catch {
      setError(
        "Не удалось сохранить правку локально. Текст остаётся в этом окне; восстановление после сбоя не подтверждено.",
      );
    }
    editingRef.current = next;
    setRetained(next);
    setEditing(next);
  };
  const discard = (captured = editingRef.current) => {
    if (!captured) return;
    try {
      if (
        !journal.current!.clear(captured.id, captured.text, captured.baseText)
      )
        return;
      if (
        editingRef.current?.id === captured.id &&
        editingRef.current.text === captured.text &&
        editingRef.current.baseText === captured.baseText
      ) {
        editingRef.current = undefined;
        setEditing(undefined);
        setRetained(undefined);
      }
    } catch {
      setError(
        "Не удалось удалить сохранённую правку. Она оставлена для восстановления.",
      );
    }
  };
  const exists = editing && items.some((item) => item.id === editing.id);
  async function act(method: string, params: Record<string, unknown>) {
    if (pending || stopped) return false;
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
  if (!items.length && !editing && !retained) return null;
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
                <button
                  className="queue-send-now"
                  aria-label="Отправить сейчас"
                  title="Остановить текущий запрос и отправить это сообщение после подтверждения остановки"
                  disabled={pending || unknown || stopped}
                  onClick={() => void act("queue.sendNow", { id: item.id })}
                >
                  <Icon name="send" size={13} />
                  <span>Отправить сейчас</span>
                </button>
                <IconButton
                  icon="edit"
                  label="Редактировать сообщение"
                  disabled={pending || (!!retained && retained.id !== item.id)}
                  onClick={() =>
                    edit(
                      journal.current!.read(item.id) || {
                        id: item.id,
                        text: item.text,
                        baseText: item.text,
                      },
                    )
                  }
                />
                {index > 0 && (
                  <IconButton
                    icon="chevron-up"
                    label="Поднять в очереди"
                    disabled={pending || stopped}
                    onClick={() =>
                      void act("queue.move", { id: item.id, index: index - 1 })
                    }
                  />
                )}
                <IconButton
                  icon="close"
                  label="Удалить из очереди"
                  disabled={pending || stopped}
                  onClick={() => void act("queue.delete", { id: item.id })}
                />
              </div>
            </div>
          ))}
          {!editing && retained && (
            <button
              onClick={() => {
                editingRef.current = retained;
                setEditing(retained);
              }}
            >
              Продолжить редактирование сообщения
            </button>
          )}
          {editing && (
            <div className="queue-editor">
              <textarea
                aria-label="Редактирование сообщения в очереди"
                autoFocus
                value={editing.text}
                disabled={pending}
                onChange={(e) => edit({ ...editing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    editingRef.current = undefined;
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
              {exists && editing.baseText === undefined && (
                <p>
                  Исходная версия старой правки неизвестна. Вставьте текст в
                  поле ввода для проверки; сообщение в очереди не будет
                  перезаписано.
                </p>
              )}
              <div>
                <button
                  disabled={
                    pending || !editing.text.trim() || (!!exists && stopped)
                  }
                  onClick={async () => {
                    if (!exists || editing.baseText === undefined) {
                      onRestore(editing.text);
                      discard(editing);
                    } else if (
                      await act("queue.update", {
                        id: editing.id,
                        text: editing.text,
                        expectedText: editing.baseText,
                      })
                    )
                      discard(editing);
                  }}
                >
                  {exists && editing.baseText !== undefined
                    ? "Сохранить"
                    : "Вставить в поле ввода"}
                </button>
                <button disabled={pending} onClick={() => discard(editing)}>
                  Отменить правки
                </button>
              </div>
            </div>
          )}
          {!running && !unknown && items.length > 0 && (
            <button
              disabled={pending || stopped}
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
