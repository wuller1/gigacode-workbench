import { useState } from "react";
import type { DatabaseConsole } from "../shared/database";
import { Icon, Modal } from "./ui";
export function DatabaseEffect({
  effect,
  read,
  resolve,
}: {
  effect: NonNullable<DatabaseConsole["pendingEffect"]>;
  read: () => Promise<any>;
  resolve: (outcome: "applied" | "notApplied", note: string) => Promise<any>;
}) {
  const [open, setOpen] = useState(false),
    [intent, setIntent] = useState<any>(),
    [outcome, setOutcome] = useState<"applied" | "notApplied">("applied"),
    [note, setNote] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  if (effect.phase === "submitting")
    return (
      <div className="db-effect">
        <span className="working-arc" />
        {effect.kind === "transaction"
          ? "Подтверждаю транзакцию…"
          : effect.kind === "routine"
            ? "Применяю определение процедуры…"
            : "Применяю changeset…"}
      </div>
    );
  return (
    <>
      <div className="db-effect db-effect-unknown" role="alert">
        <Icon name="warning" />
        <span>Исход записи неизвестен. Повтор изменений заблокирован.</span>
        <button onClick={() => setOpen(true)}>Сверка результата</button>
      </div>
      {open && (
        <Modal
          title="Сверка неизвестного результата"
          onClose={() => {
            if (!saving) setOpen(false);
          }}
        >
          <div className="db-file-form">
            <p>
              Проверьте записи на сервере через отдельную консоль. Подтверждение
              закрывает неопределённость и не выполняет запись повторно.
            </p>
            <small className="muted">Операция {effect.operationId}</small>
            {effect.reason && <p>{effect.reason}</p>}
            <button
              onClick={() =>
                void read()
                  .then(setIntent)
                  .catch((e) => setError(e.message))
              }
            >
              Показать исходную операцию
            </button>
            {intent && (
              <pre className="db-output">
                {intent.intent}
                {intent.truncated ? "\n… продолжение сохранено в журнале" : ""}
              </pre>
            )}
            <label>
              Наблюдаемый результат
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option value="applied">
                  Изменения присутствуют · не повторять
                </option>
                <option value="notApplied">
                  Изменения отсутствуют · можно подготовить новую попытку
                </option>
              </select>
            </label>
            <label>
              Что проверено
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Запрос, ключи записей, фактический результат"
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button disabled={saving} onClick={() => setOpen(false)}>
                Закрыть
              </button>
              <button
                className="primary"
                disabled={saving || note.trim().length < 10}
                onClick={() => {
                  setSaving(true);
                  void resolve(outcome, note)
                    .then(() => setOpen(false))
                    .catch((e) => setError(e.message))
                    .finally(() => setSaving(false));
                }}
              >
                Записать результат сверки
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}
