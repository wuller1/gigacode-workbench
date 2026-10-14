import { useEffect, useRef, useState } from "react";
import type { Invoke } from "./api";
import type { VisionBridgeConfig } from "../shared/vision";
import { errorText } from "./api";

export function VisionSettings({
  run,
  onDirty,
}: {
  run: Invoke;
  onDirty(dirty: boolean): void;
}) {
  const [draft, setDraft] = useState<VisionBridgeConfig>(),
    [baseline, setBaseline] = useState<VisionBridgeConfig>();
  const [revision, setRevision] = useState<number>(),
    [template, setTemplate] = useState("{}"),
    [argsText, setArgsText] = useState("[]"),
    [secret, setSecret] = useState("");
  const editSerial = useRef(0);
  const [clearSecret, setClearSecret] = useState(false),
    [hasSecret, setHasSecret] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [inventory, setInventory] = useState<any>(),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    void run("vision.snapshot")
      .then((s) => {
        if (!s?.config) throw new Error("Чтение настроек моста не подтверждено.");
        if (current) {
          setDraft(s.config);
          setBaseline(s.config);
          setTemplate(JSON.stringify(s.config.argumentsTemplate, null, 2));
          setArgsText(JSON.stringify(s.config.args));
          setRevision(s.revision);
          setHasSecret(s.hasSecret);
        }
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      });
    return () => {
      current = false;
      onDirty(false);
    };
  }, [run]);
  const dirty =
    !!draft &&
    (JSON.stringify(draft) !== JSON.stringify(baseline) ||
      template !== JSON.stringify(baseline?.argumentsTemplate, null, 2) ||
      argsText !== JSON.stringify(baseline?.args) ||
      !!secret ||
      clearSecret);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  if (!draft)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Загрузка визуального моста…"}
      </p>
    );
  const update = <K extends keyof VisionBridgeConfig>(
    key: K,
    value: VisionBridgeConfig[K],
  ) => {
    editSerial.current++;
    setDraft((old) => ({ ...old!, [key]: value }));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const submittedSerial = editSerial.current;
      const config = {
        ...draft,
        args: JSON.parse(argsText),
        argumentsTemplate: JSON.parse(template),
      };
      const s = await run("vision.configure", {
        config,
        expectedRevision: revision,
        ...(secret ? { secret } : {}),
        clearSecret,
      });
      if (!s?.config) throw new Error("Сохранение моста не подтверждено.");
      setBaseline(s.config);
      setRevision(s.revision);
      setHasSecret(s.hasSecret);
      if (editSerial.current === submittedSerial) {
        setDraft(s.config);
        setTemplate(JSON.stringify(s.config.argumentsTemplate, null, 2));
        setArgsText(JSON.stringify(s.config.args));
        setSecret("");
        setClearSecret(false);
      }
      setNotice(
        "Настройки сохранены. Изображения отправляются только выбранному мосту; агент получает текст.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vision-settings">
      <h3>Зрение через текстовый мост</h3>
      <p className="muted">
        В этой среде исполнитель не получает изображения. GigaCode сохраняет
        настоящий снимок, измеряет DOM и передаёт снимок вашему MCP-мосту. Его
        описание считается наблюдением с возможными ошибками.
      </p>
      <label className="field">
        Визуальные проверки
        <select
          value={draft.mode}
          onChange={(e) =>
            update("mode", e.target.value as VisionBridgeConfig["mode"])
          }
        >
          <option value="text_bridge">Текстовый мост</option>
          <option value="disabled">Отключены</option>
        </select>
      </label>
      <div className="settings-desktop-grid">
        <label className="field">
          Подключение
          <select
            value={draft.transport}
            onChange={(e) =>
              update("transport", e.target.value as "http" | "stdio")
            }
          >
            <option value="http">HTTP MCP</option>
            <option value="stdio">Локальный MCP (stdio)</option>
          </select>
        </label>
        <label className="field">
          Название моста
          <input
            value={draft.modelLabel}
            onChange={(e) => update("modelLabel", e.target.value)}
          />
        </label>
      </div>
      {draft.transport === "http" ? (
        <label className="field">
          Адрес MCP
          <input
            value={draft.url}
            placeholder="https://ваш-сервер/mcp"
            onChange={(e) => update("url", e.target.value)}
          />
        </label>
      ) : (
        <>
          <label className="field">
            Команда MCP
            <input
              value={draft.command}
              onChange={(e) => update("command", e.target.value)}
            />
          </label>
          <label className="field">
            Аргументы · JSON
            <input
              value={argsText}
              onChange={(e) => {
                editSerial.current++;
                setArgsText(e.target.value);
              }}
            />
          </label>
        </>
      )}
      <details>
        <summary>Авторизация и корпоративный сертификат</summary>
        <div className="settings-desktop-grid">
          <label className="field">
            {draft.transport === "http"
              ? "Заголовок секрета"
              : "Переменная окружения секрета"}
            <input
              value={draft.secretName}
              onChange={(e) => update("secretName", e.target.value)}
            />
          </label>
          {draft.transport === "http" && (
            <label className="field">
              Префикс
              <input
                value={draft.secretPrefix}
                onChange={(e) => update("secretPrefix", e.target.value)}
              />
            </label>
          )}
        </div>
        <label className="field">
          Секрет
          <input
            type="password"
            autoComplete="new-password"
            value={secret}
            placeholder={
              hasSecret
                ? "Сохранён в защищённом хранилище"
                : "При необходимости"
            }
            onChange={(e) => {
              editSerial.current++;
              setSecret(e.target.value);
            }}
          />
        </label>
        {hasSecret && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={clearSecret}
              onChange={(e) => {
                editSerial.current++;
                setClearSecret(e.target.checked);
              }}
            />
            Удалить сохранённый секрет
          </label>
        )}
        {draft.transport === "http" && (
          <label className="field">
            Дополнительный CA · PEM
            <textarea
              rows={3}
              value={draft.ca}
              onChange={(e) => update("ca", e.target.value)}
            />
          </label>
        )}
      </details>
      <div className="settings-actions">
        <button disabled={busy || !dirty} onClick={() => void save()}>
          Сохранить мост
        </button>
        <button
          disabled={busy || dirty}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const discovered = await run("vision.probe");
              if (!Array.isArray(discovered?.tools)) throw new Error("Чтение каталога не подтверждено.");
              setInventory(discovered);
              setNotice("Каталог прочитан. Запросов к модели не было.");
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Обнаружить инструменты
        </button>
      </div>
      <label className="field">
        Инструмент описания изображения
        {inventory?.tools?.length ? (
          <select
            value={draft.toolName}
            onChange={(e) => update("toolName", e.target.value)}
          >
            <option value="">Выберите обнаруженный инструмент</option>
            {inventory.tools.map((t: any) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={draft.toolName}
            onChange={(e) => update("toolName", e.target.value)}
          />
        )}
      </label>
      <label className="field">
        Аргументы инструмента · JSON
        <textarea
          rows={6}
          spellCheck={false}
          value={template}
          onChange={(e) => {
            editSerial.current++;
            setTemplate(e.target.value);
          }}
        />
      </label>
      <p className="fine-print">
        Используйте точные поля обнаруженной схемы. Подстановки целиком в
        строке: <code>$imageDataUrl</code>, <code>$imageBase64</code>,{" "}
        <code>$imagePath</code>, <code>$prompt</code>, <code>$mimeType</code>,{" "}
        <code>$model</code>. Перед вызовом GigaCode проверяет аргументы по
        фактической схеме. $model — название моста; если сервер требует другой
        wire ID, укажите его явно в JSON согласно конфигурации сервера. Для
        удалённого сервера локальный путь обычно недоступен.
      </p>
      {inventory && (
        <details>
          <summary>Фактическая схема MCP</summary>
          <pre>
            {JSON.stringify(
              inventory.tools?.find((t: any) => t.name === draft.toolName) ||
                inventory,
              null,
              2,
            )}
          </pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="settings-actions">
        <button disabled={busy || !dirty} onClick={() => void save()}>
          Сохранить
        </button>
      </div>
    </section>
  );
}
