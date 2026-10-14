import { useEffect, useRef, useState } from "react";
import type { Invoke } from "./api";
import { errorText } from "./api";

/** Measured telemetry, working-set policy and optional paid probes are distinct. */
export function ContextControls({
  sessionId,
  run,
}: {
  sessionId: string;
  run: Invoke;
}) {
  const [info, setInfo] = useState<any>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [draft, setDraft] = useState({ high: "", low: "", route: "" });
  const [budget, setBudget] = useState("0.25");
  const [probeBytes, setProbeBytes] = useState(262144);
  const [calibration, setCalibration] = useState<any>();
  const serial = useRef(0),
    alive = useRef(true),
    busy = useRef(false),
    dirty = useRef(false);
  const accept = (value: any) => {
    if (!value?.policy || !value?.envelope)
      throw new Error("Показания контекста не подтверждены.");
    setInfo(value);
    if (!dirty.current && value?.policy)
      setDraft({
        high: String(value.policy.highWaterTokens),
        low: String(value.policy.lowWaterTokens),
        route: value.policy.routeKey,
      });
  };
  useEffect(() => {
    alive.current = true;
    const token = ++serial.current;
    void run("context.inspect", { id: sessionId })
      .then((value) => {
        if (alive.current && serial.current === token) accept(value);
      })
      .catch((e) => {
        if (alive.current && serial.current === token) setError(errorText(e));
      });
    return () => {
      alive.current = false;
      serial.current++;
    };
  }, [sessionId, run]);
  const perform = async (kind: string, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    const token = ++serial.current;
    setPending(kind);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current && serial.current === token) setError(errorText(e));
    } finally {
      if (alive.current && serial.current === token) setPending("");
      busy.current = false;
    }
  };
  const refresh = async () => {
    const token = serial.current;
    const value = await run("context.inspect", {
      id: sessionId,
      refresh: true,
    });
    if (alive.current && serial.current === token) accept(value);
  };
  const patchPolicy = async (patch: Record<string, unknown>) => {
    const token = serial.current;
    const policy = await run("context.policy", {
      patch,
      expectedPolicy: info?.policy,
    });
    if (!policy || typeof policy.enabled !== "boolean")
      throw new Error("Сохранение политики не подтверждено; ввод сохранён.");
    if (alive.current && serial.current === token) {
      dirty.current = false;
      accept({ ...info, policy });
      await refresh();
    }
  };
  const edit = (field: keyof typeof draft, value: string) => {
    dirty.current = true;
    setDraft((old) => ({ ...old, [field]: value }));
  };
  return (
    <section className="context-control-details">
      <h4>Короткий контекст для flash</h4>
      <dl className="context-stats">
        <div>
          <dt>Порог обновления</dt>
          <dd>{info?.envelope?.highWaterTokens?.toLocaleString() || "—"}</dd>
        </div>
        <div>
          <dt>Целевой объём</dt>
          <dd>{info?.envelope?.lowWaterTokens?.toLocaleString() || "—"}</dd>
        </div>
        <div>
          <dt>Наблюдённый recall</dt>
          <dd>
            {info?.envelope?.observedRecallTokens?.toLocaleString() ||
              "Не измерен"}
          </dd>
        </div>
        <div>
          <dt>Обновлений контекста</dt>
          <dd>{info?.rotations ?? "—"}</dd>
        </div>
      </dl>
      {info?.hostEstimate && (
        <p className="fine-print">
          Учтённый рабочий контекст (оценка): ≈
          {info.hostEstimate.usedTokens.toLocaleString()} токенов. Скрытые
          native instructions, reasoning и усечённые outputs могут быть не
          учтены; это не счётчик провайдера.
        </p>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          disabled={!!pending || !info}
          checked={info?.policy?.enabled !== false}
          onChange={(e) => {
            const enabled = e.target.checked;
            void perform("policy", () => patchPolicy({ enabled }));
          }}
        />
        Автоматически готовить короткий контекст на безопасной границе
      </label>
      {info?.decision?.reason === "ineffective_compaction_loop" && (
        <p role="status">
          Повторное сжатие почти не освобождает место. Обновление контекста
          ожидает безопасной границы; неизвестные результаты сначала требуют
          сверки.
        </p>
      )}
      {info?.decision?.action === "hold_input" && (
        <p role="status">
          Один запрос превышает рабочий бюджет. Разбейте его или приложите
          документ для адресного чтения.
        </p>
      )}
      {info?.decision?.action === "hold_unknown" && (
        <p role="status">
          Сначала нужно сверить результат предыдущих действий; контекст не будет
          пересоздан автоматически.
        </p>
      )}
      {info?.decision?.action === "hold_configuration" && (
        <p role="status">
          Свежие сессии дважды почти не уменьшили контекст. Проверьте постоянные
          инструкции, набор tools и лимит маршрута. Очередь сохранена; цикл
          пересоздания остановлен.
        </p>
      )}
      <p className="fine-print">
        Порог — политика рабочего объёма, а не доказанный максимум модели.
        История остаётся на диске. Безопасное обновление не переписывает историю
        CLI и не повторяет прошлые команды.
      </p>
      <details className="context-policy-editor">
        <summary>Настроить рабочий объём</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform("policy", () =>
              patchPolicy({
                highWaterTokens: Number(draft.high),
                lowWaterTokens: Number(draft.low),
                routeKey: draft.route,
              }),
            );
          }}
        >
          <div className="context-policy-fields">
            <label className="field">
              Порог, токенов
              <input
                aria-label="Порог обновления контекста"
                inputMode="numeric"
                value={draft.high}
                disabled={!!pending || !info}
                onChange={(e) => edit("high", e.target.value)}
              />
            </label>
            <label className="field">
              Цель, токенов
              <input
                aria-label="Целевой объём контекста"
                inputMode="numeric"
                value={draft.low}
                disabled={!!pending || !info}
                onChange={(e) => edit("low", e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Метка маршрута
            <input
              aria-label="Метка маршрута контекста"
              value={draft.route}
              disabled={!!pending || !info}
              onChange={(e) => edit("route", e.target.value)}
            />
          </label>
          <p className="fine-print">
            Общая политика приложения. Короткая метка без адресов и секретов
            отделяет измерения разных шлюзов. Для исполнителей действует меньший
            рабочий бюджет.
          </p>
          <button type="submit" disabled={!!pending || !info || !dirty.current}>
            Применить
          </button>
        </form>
      </details>
      <button
        disabled={!!pending}
        onClick={() => void perform("refresh", refresh)}
      >
        Обновить показания CLI
      </button>
      {info?.measurementNote && (
        <p className="fine-print">{info.measurementNote}</p>
      )}
      {info?.calibrationAvailable ? (
        <details className="context-policy-editor">
          <summary>Проверить удержание контекста</summary>
          <p className="fine-print">
            Изолированные платные запросы без tools: до трёх размеров, пять
            проверяемых значений в каждом. Это выборочная проверка удержания, не
            доказательство полного окна. При неизвестном результате повторов
            нет.
          </p>
          <label className="field">
            Максимальный бюджет, USD
            <input
              aria-label="Бюджет проверки контекста"
              inputMode="decimal"
              value={budget}
              disabled={!!pending}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label className="field">
            Максимальный размер входа
            <select
              aria-label="Размер проверки контекста"
              value={probeBytes}
              disabled={!!pending}
              onChange={(e) => setProbeBytes(Number(e.target.value))}
            >
              <option value={262144}>256 КиБ</option>
              <option value={524288}>512 КиБ</option>
              <option value={1048576}>1 МиБ</option>
            </select>
          </label>
          <p className="fine-print">
            Это размер текста в байтах, не число токенов. Точное число берётся
            из ответа выбранного маршрута.
          </p>
          <div className="context-policy-actions">
            <button
              disabled={!!pending}
              onClick={() =>
                void perform("calibration", async () => {
                  const token = serial.current;
                  const result = await run("context.calibrate", {
                    id: sessionId,
                    explicitlyEnabled: true,
                    maxBudgetUsd: Number(budget),
                    inputBytes: [probeBytes / 16, probeBytes / 4, probeBytes],
                  });
                  if (alive.current && serial.current === token) {
                    setCalibration(result);
                    await refresh();
                  }
                })
              }
            >
              Запустить в пределах бюджета
            </button>
            {pending === "calibration" && (
              <button
                onClick={() => {
                  void run("context.calibration.cancel", {
                    id: sessionId,
                  }).catch((e) => {
                    if (alive.current) setError(errorText(e));
                  });
                }}
              >
                Остановить проверку
              </button>
            )}
          </div>
          {calibration && (
            <p role="status">
              Проверок: {calibration.receipts.length}. Удержание подтверждено в{" "}
              {
                calibration.receipts.filter(
                  (v: any) => v.status === "recall_passed",
                ).length
              }
              . Зарезервировано: ${calibration.reservedBudgetUsd}. Полное окно
              не подтверждено.
            </p>
          )}
        </details>
      ) : (
        info && (
          <p className="fine-print">
            Проверка ёмкости станет доступна после подключения проверенного
            изолированного адаптера вашей модели с расчётом стоимости.
          </p>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
