import { useEffect, useState } from "react";
import type { AppState } from "../shared/types";
import type { DatabaseConnection } from "../shared/database";
import type { Invoke } from "./api";
import { IconButton, Empty, useAsk } from "./ui";
export function DatabaseSettings({
  state,
  run,
}: {
  state: AppState;
  run: Invoke;
}) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]),
    [draft, setDraft] = useState<Partial<DatabaseConnection>>(),
    [secret, setSecret] = useState(""),
    [clearSecret, setClearSecret] = useState(false),
    [inventory, setInventory] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [bindings, setBindings] = useState("{}"),
    [args, setArgs] = useState("[]");
  const ask = useAsk();
  const refresh = () =>
    run("database.connections").then((r) => {
      if (r) setConnections(r.connections);
    });
  useEffect(() => {
    void refresh();
  }, []);
  const select = (c: Partial<DatabaseConnection>) => {
    setDraft({ ...c });
    setSecret("");
    setClearSecret(false);
    setInventory(undefined);
    setError("");
    setArgs(JSON.stringify(c.args || []));
    setBindings(JSON.stringify(c.bindings || {}, null, 2));
  };
  const update = (key: keyof DatabaseConnection, value: any) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const a = JSON.parse(args),
        b = JSON.parse(bindings);
      if (
        !Array.isArray(a) ||
        a.some((x) => typeof x !== "string") ||
        !b ||
        typeof b !== "object" ||
        Array.isArray(b) ||
        Object.values(b).some((x) => typeof x !== "string")
      )
        throw new Error(
          "Аргументы: массив строк; bindings: объект operation → tool name",
        );
      const r = await run("database.connection.save", {
        connection: { ...draft, args: a, bindings: b },
        secret: secret || undefined,
        clearSecret,
      });
      if (r) {
        setSecret("");
        select(r);
        await refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="db-settings">
      <div className="db-settings-list">
        <div className="db-inline">
          <strong>Подключения</strong>
          <IconButton
            icon="plus"
            label="Добавить подключение"
            onClick={() =>
              select({
                name: "",
                environment: "",
                transport: "postgres-mcp",
                host: "localhost",
                port: 5432,
                database: "postgres",
                user: "postgres",
                projectIds: [],
                readOnly: false,
              })
            }
          />
        </div>
        {connections.map((c) => (
          <button
            key={c.id}
            className={draft?.id === c.id ? "selected" : ""}
            onClick={() => select(c)}
          >
            <span>{c.name}</span>
            <small>{c.environment || c.transport}</small>
          </button>
        ))}
      </div>
      {!draft ? (
        <Empty title="Общие подключения для проектов">
          Создайте один MCP-профиль и привяжите его к нескольким проектам.
          Пароли защищены системным хранилищем, в Git они не попадают.
        </Empty>
      ) : (
        <div className="db-settings-form">
          <label>
            Название
            <input
              value={draft.name || ""}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Стенд / окружение
            <input
              value={draft.environment || ""}
              placeholder="Любое название"
              onChange={(e) => update("environment", e.target.value)}
            />
          </label>
          <label>
            Провайдер
            <select
              value={draft.transport}
              onChange={(e) => update("transport", e.target.value)}
            >
              <option value="postgres-mcp">PostgreSQL · встроенный MCP</option>
              <option value="stdio">Корпоративный MCP · stdio</option>
              <option value="http">Корпоративный MCP · HTTPS</option>
            </select>
          </label>
          {draft.transport === "postgres-mcp" ? (
            <>
              <div className="db-form-pair">
                <label>
                  Сервер
                  <input
                    value={draft.host || ""}
                    onChange={(e) => update("host", e.target.value)}
                  />
                </label>
                <label>
                  Порт
                  <input
                    type="number"
                    value={draft.port || 5432}
                    onChange={(e) => update("port", Number(e.target.value))}
                  />
                </label>
              </div>
              <label>
                База данных
                <input
                  value={draft.database || ""}
                  onChange={(e) => update("database", e.target.value)}
                />
              </label>
              <label>
                Пользователь
                <input
                  autoComplete="off"
                  value={draft.user || ""}
                  onChange={(e) => update("user", e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.ssl}
                  onChange={(e) => update("ssl", e.target.checked)}
                />{" "}
                TLS с проверкой сертификата
              </label>
              {draft.ssl && (
                <label>
                  Корневой сертификат PEM
                  <textarea
                    value={draft.ca || ""}
                    onChange={(e) => update("ca", e.target.value)}
                  />
                </label>
              )}
            </>
          ) : draft.transport === "http" ? (
            <label>
              URL MCP
              <input
                value={draft.url || ""}
                placeholder="https://server/mcp"
                onChange={(e) => update("url", e.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                Исполняемый файл MCP
                <input
                  value={draft.command || ""}
                  onChange={(e) => update("command", e.target.value)}
                />
              </label>
              <label>
                Аргументы JSON
                <input value={args} onChange={(e) => setArgs(e.target.value)} />
              </label>
            </>
          )}
          {draft.transport === "stdio" && (
            <label>
              Переменная для токена
              <input
                value={draft.secretEnv || "WORKBENCH_MCP_TOKEN"}
                onChange={(e) => update("secretEnv", e.target.value)}
              />
            </label>
          )}
          {draft.transport === "http" && (
            <>
              <label>
                Заголовок токена
                <input
                  value={draft.secretHeader || "Authorization"}
                  onChange={(e) => update("secretHeader", e.target.value)}
                />
              </label>
              <label>
                Префикс токена
                <input
                  value={draft.secretPrefix ?? "Bearer "}
                  onChange={(e) => update("secretPrefix", e.target.value)}
                />
              </label>
              <label>
                Дополнительный корневой сертификат PEM
                <textarea
                  value={draft.ca || ""}
                  placeholder="Системные доверенные сертификаты используются автоматически"
                  onChange={(e) => update("ca", e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            {draft.transport === "postgres-mcp" ? "Пароль" : "Токен"}
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              placeholder={
                draft.hasSecret
                  ? "Сохранён · оставить пустым, чтобы не менять"
                  : "Не задан"
              }
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          {draft.hasSecret && !secret && (
            <label>
              <input
                type="checkbox"
                checked={clearSecret}
                onChange={(e) => setClearSecret(e.target.checked)}
              />
              Удалить сохранённый секрет
            </label>
          )}
          {draft.transport !== "postgres-mcp" && (
            <>
              <p className="muted">
                Сначала сохраните и проверьте MCP. Bindings используют
                фактические имена tools; сервер должен возвращать Data protocol
                v1. Для stdio выберите имя переменной токена, которое ожидает
                ваш сервер; оно передаётся только дочернему процессу.
              </p>
              <label>
                Bindings JSON
                <textarea
                  value={bindings}
                  onChange={(e) => setBindings(e.target.value)}
                  spellCheck={false}
                />
              </label>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={!!draft.readOnly}
              onChange={(e) => update("readOnly", e.target.checked)}
            />{" "}
            Начинать с read-only транзакций
          </label>
          <small className="muted">
            Права доступа определяет серверная роль БД. Этот режим — настройка
            консоли, не замена серверным правам.
          </small>
          <fieldset>
            <legend>Доступно в проектах</legend>
            {state.projects
              .filter((p) => !p.archived)
              .map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={draft.projectIds?.includes(p.id) || false}
                    onChange={(e) =>
                      update(
                        "projectIds",
                        e.target.checked
                          ? [...(draft.projectIds || []), p.id]
                          : (draft.projectIds || []).filter(
                              (id) => id !== p.id,
                            ),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <div className="db-inline">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Сохранить
            </button>
            <button
              disabled={!draft.id || busy}
              onClick={() => {
                setBusy(true);
                void run("database.connection.probe", {
                  connectionId: draft.id,
                })
                  .then(setInventory)
                  .finally(() => setBusy(false));
              }}
            >
              Проверить MCP и подключение
            </button>
            {draft.id && (
              <IconButton
                icon="close"
                label="Удалить подключение"
                disabled={busy}
                onClick={() =>
                  void ask("Удалить подключение?", { confirm: true }).then(
                    async (yes) => {
                      if (yes) {
                        const r = await run("database.connection.remove", {
                          connectionId: draft.id,
                        });
                        if (r) {
                          setDraft(undefined);
                          await refresh();
                        }
                      }
                    },
                  )
                }
              />
            )}
          </div>
          {inventory && (
            <details open>
              <summary>Проверенный ответ сервера</summary>
              <pre>{JSON.stringify(inventory, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
