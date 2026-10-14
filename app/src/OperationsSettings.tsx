import { useEffect, useRef, useState } from "react";
import {
  opsActionOperations,
  opsReadOperations,
  type OpsConnection,
  type OpsInventory,
} from "../shared/operations";
import type { Project } from "../shared/types";
import { IconButton, useAsk } from "./ui";
import { registerWindowClose } from "./window-close";
import {
  observedAt,
  opsCall,
  opsErrorText,
  OpsCode,
  OpsEmpty,
  OpsErrorBox,
  useOpsSnapshot,
} from "./ops-ui";

const kindNames = {
  jenkins: "Jenkins",
  kubernetes: "Kubernetes",
  openshift: "OpenShift",
};
export function OperationsSettings({
  projects,
  projectId,
  onDirtyChange,
}: {
  projects: Project[];
  projectId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { snapshot, refresh, error: snapshotError } = useOpsSnapshot();
  const [draft, setDraft] = useState<Partial<OpsConnection>>(),
    [saved, setSaved] = useState(""),
    [args, setArgs] = useState("[]"),
    [bindings, setBindings] = useState<NonNullable<OpsConnection["bindings"]>>(
      {},
    ),
    [secret, setSecret] = useState(""),
    [clearSecret, setClearSecret] = useState(false),
    [inventory, setInventory] = useState<OpsInventory>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const ask = useAsk(),
    epoch = useRef(0),
    selected = useRef<string | undefined>(undefined);
  selected.current = draft?.id;
  const original = JSON.stringify({ draft, args, bindings }),
    dirty = !!draft && original !== saved;
  const unsaved = dirty || !!secret || clearSecret;
  const closingState = useRef({ unsaved, busy });
  closingState.current = { unsaved, busy };
  useEffect(() => {
    onDirtyChange?.(unsaved);
  }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(
    () =>
      registerWindowClose("ops:connection-settings", async () => {
        if (closingState.current.busy)
          throw new Error(
            "Дождитесь завершения сохранения или проверки Operations.",
          );
        if (closingState.current.unsaved)
          throw new Error(
            "Сохраните настройки Operations или закройте их с явным отказом от черновика. Введённые токены не записываются в черновики.",
          );
      }),
    [],
  );
  const load = (connection: Partial<OpsConnection>) => {
    ++epoch.current;
    const nextArgs = JSON.stringify(connection.args || []),
      nextBindings = { ...(connection.bindings || {}) };
    setDraft({ ...connection });
    setArgs(nextArgs);
    setBindings(nextBindings);
    setSaved(
      JSON.stringify({
        draft: { ...connection },
        args: nextArgs,
        bindings: nextBindings,
      }),
    );
    setSecret("");
    setClearSecret(false);
    setInventory(undefined);
    setError("");
    setNotice("");
  };
  const choose = async (connection: Partial<OpsConnection>) => {
    if (busy) return;
    if (
      (dirty || secret || clearSecret) &&
      !(await ask("Перейти без сохранения настроек?", {
        confirm: true,
        message:
          "Неизменённое подключение продолжает работать. Введённые настройки ещё не применены.",
      }))
    )
      return;
    load(connection);
  };
  const update = <K extends keyof OpsConnection>(
    key: K,
    value: OpsConnection[K],
  ) => setDraft((old) => ({ ...old, [key]: value }));
  const create = () =>
    void choose({
      kind: "jenkins",
      name: "",
      environment: "",
      enabled: true,
      projectIds: projectId ? [projectId] : [],
      transport: "builtin",
      url: "",
    });
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const generation = epoch.current;
    try {
      const parsedArgs = JSON.parse(args);
      if (
        !Array.isArray(parsedArgs) ||
        parsedArgs.some((value) => typeof value !== "string")
      )
        throw new Error("Аргументы должны быть JSON-массивом строк.");
      if (!draft.name?.trim() || !draft.kind || !draft.transport)
        throw new Error("Укажите название, тип системы и транспорт.");
      if (!draft.projectIds?.length)
        throw new Error("Назначьте подключение хотя бы одному проекту.");
      if (draft.transport === "stdio" && !draft.command?.trim())
        throw new Error("Укажите исполняемый файл MCP-сервера.");
      if (draft.transport !== "stdio") {
        const url = new URL(draft.url || "");
        if (url.username || url.password)
          throw new Error("Учётные данные нельзя помещать в URL.");
        if (
          url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          )
        )
          throw new Error(
            "Требуется HTTPS. HTTP разрешён только для локального тестового сервера.",
          );
      }
      const cleanBindings = Object.fromEntries(
        Object.entries(bindings)
          .filter(([, value]) => value?.trim())
          .map(([key, value]) => [key, value!.trim()]),
      );
      const result: OpsConnection = await opsCall("ops.connection.save", {
        connection: {
          ...draft,
          name: draft.name.trim(),
          args: parsedArgs,
          bindings: cleanBindings,
        },
        secret: secret || undefined,
        clearSecret,
      });
      if (generation === epoch.current) {
        load(result);
        setNotice(
          "Настройки сохранены. Проверьте подключение и реальные возможности.",
        );
        await refresh();
      }
    } catch (e) {
      if (generation === epoch.current) setError(opsErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (probe: boolean) => {
    if (!draft?.id || busy) return;
    const captured = draft.id,
      generation = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result: OpsInventory = await opsCall(
        probe ? "ops.connection.probe" : "ops.connection.inventory",
        {
          connectionId: captured,
          expectedTargetHash: draft.targetHash,
          expectedAuthGeneration: draft.authGeneration,
        },
      );
      if (generation === epoch.current && selected.current === captured) {
        setInventory(result);
        setNotice(
          probe
            ? "MCP discovery завершён. Это не подтверждает выполнение всех внешних операций."
            : "Прочитан текущий inventory инструментов.",
        );
        await refresh();
      }
    } catch (e) {
      if (generation === epoch.current) setError(opsErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!draft?.id || busy) return;
    if (
      !(await ask(`Удалить подключение «${draft.name}»?`, {
        confirm: true,
        message:
          "Подключение общее для назначенных проектов. Незавершённые операции защищены серверной частью; ресурсы Jenkins/кластера не удаляются.",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await opsCall("ops.connection.delete", { connectionId: draft.id });
      ++epoch.current;
      setDraft(undefined);
      setSecret("");
      setClearSecret(false);
      await refresh();
    } catch (e) {
      setError(opsErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(
    () => () => {
      ++epoch.current;
    },
    [],
  );
  const operations: (keyof NonNullable<OpsConnection["bindings"]>)[] = [
    ...[...opsReadOperations, ...opsActionOperations].filter((op) =>
      draft?.kind === "jenkins"
        ? op.startsWith("ci.")
        : op.startsWith("cluster."),
    ),
    "probe",
    "prepare",
    "execute",
    "reconcile",
  ];
  const lifecycleHelp: Record<string, string> = {
    probe:
      "Необязательно: фактические capabilities адаптера после tools/list. Без probe доступны только явно сопоставленные чтения.",
    prepare:
      "Обязательно для изменений: проверка цели и preview без внешнего изменения.",
    execute:
      "Обязательно для изменений: однократное выполнение подготовленного действия с operationId.",
    reconcile:
      "Обязательно для изменений: read-only сверка неизвестного исхода и мониторинг, без повтора POST.",
  };
  return (
    <div className="ops-settings">
      <aside
        className="ops-settings-list"
        aria-label="Подключения Jenkins и кластеров"
      >
        <div className="ops-settings-list-head">
          <strong>Подключения</strong>
          <IconButton
            icon="plus"
            label="Добавить подключение Operations"
            disabled={busy}
            onClick={create}
          />
        </div>
        {snapshot.connections.map((connection) => (
          <button
            type="button"
            key={connection.id}
            aria-pressed={draft?.id === connection.id}
            disabled={busy}
            onClick={() => void choose(connection)}
          >
            <span>{connection.name}</span>
            <small>
              {kindNames[connection.kind]}
              {connection.environment ? " · " + connection.environment : ""}
              {!connection.enabled ? " · выключено" : ""}
            </small>
            <small>
              {connection.projectIds.length} проектов ·{" "}
              {connection.discovered ? "discovery получен" : "не проверено"}
            </small>
          </button>
        ))}
      </aside>
      {!draft ? (
        <OpsEmpty
          title="Общие подключения Operations"
          action={create}
          label="Добавить подключение"
        >
          Jenkins, Kubernetes и OpenShift настраиваются один раз. Назначьте
          подключения нескольким проектам без копирования credentials.
        </OpsEmpty>
      ) : (
        <div className="ops-settings-form">
          <div className="ops-settings-head">
            <h3>{draft.id ? draft.name : "Новое подключение"}</h3>
            {dirty && <span className="ops-muted">Не сохранено</span>}
            {draft.id && (
              <IconButton
                icon="copy"
                label="Создать копию без credentials"
                disabled={busy}
                onClick={() =>
                  void choose({
                    ...draft,
                    id: undefined,
                    revision: undefined,
                    name: `${draft.name} — копия`,
                    credentialConfigured: false,
                    authGeneration: undefined,
                    targetHash: undefined,
                    discovered: undefined,
                  })
                }
              />
            )}
          </div>
          <OpsErrorBox
            message={error || snapshotError}
            dismiss={() => setError("")}
          />
          {notice && (
            <p className="ops-notice" role="status">
              {notice}
            </p>
          )}
          <div className="ops-form">
            <div className="ops-form-pair">
              <label className="ops-field">
                Название
                <input
                  aria-label="Название подключения Operations"
                  value={draft.name || ""}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
              <label className="ops-field">
                Название стенда
                <input
                  aria-label="Название стенда Operations"
                  value={draft.environment || ""}
                  maxLength={80}
                  disabled={busy}
                  placeholder="Любое: ДЕВ, ИФТ, Песочница…"
                  onChange={(e) => update("environment", e.target.value)}
                />
                <small>
                  Это подпись. Переименование не меняет сервер или API context.
                </small>
              </label>
            </div>
            <div className="ops-form-pair">
              <label className="ops-field">
                Система
                <select
                  aria-label="Тип системы Operations"
                  value={draft.kind}
                  disabled={busy || !!draft.id}
                  onChange={(e) => {
                    update("kind", e.target.value as OpsConnection["kind"]);
                    setBindings({});
                  }}
                >
                  <option value="jenkins">Jenkins</option>
                  <option value="kubernetes">Kubernetes</option>
                  <option value="openshift">OpenShift</option>
                </select>
              </label>
              <label className="ops-field">
                Подключение
                <select
                  aria-label="Транспорт Operations"
                  value={draft.transport}
                  disabled={busy}
                  onChange={(e) =>
                    update(
                      "transport",
                      e.target.value as OpsConnection["transport"],
                    )
                  }
                >
                  <option value="builtin">Встроенный MCP bridge</option>
                  <option value="http">Внешний MCP · HTTPS</option>
                  <option value="stdio">Внешний MCP · stdio</option>
                </select>
              </label>
            </div>
            {draft.transport === "stdio" ? (
              <>
                <label className="ops-field">
                  Исполняемый файл MCP
                  <input
                    aria-label="Команда MCP Operations"
                    value={draft.command || ""}
                    disabled={busy}
                    placeholder="Полный путь к исполняемому файлу"
                    onChange={(e) => update("command", e.target.value)}
                  />
                  <small>Запуск напрямую, без shell interpolation.</small>
                </label>
                <label className="ops-field">
                  Аргументы JSON
                  <input
                    aria-label="Аргументы MCP Operations"
                    value={args}
                    disabled={busy}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                  <small>
                    Массив строк, например ["server.js"]. Не вставляйте токен в
                    аргументы.
                  </small>
                </label>
                <label className="ops-field">
                  Переменная окружения для токена
                  <input
                    aria-label="Переменная токена MCP Operations"
                    value={draft.secretEnv || ""}
                    disabled={busy}
                    placeholder="WORKBENCH_MCP_TOKEN"
                    onChange={(e) => update("secretEnv", e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="ops-field">
                  {draft.transport === "http"
                    ? "URL MCP"
                    : draft.kind === "jenkins"
                      ? "Базовый URL Jenkins"
                      : "URL Kubernetes API"}
                  <input
                    aria-label="URL Operations"
                    type="url"
                    value={draft.url || ""}
                    disabled={busy}
                    placeholder={
                      draft.transport === "http"
                        ? "https://host/mcp"
                        : draft.kind === "jenkins"
                          ? "https://jenkins.company.example/"
                          : "https://cluster-api.company.example:6443"
                    }
                    onChange={(e) => update("url", e.target.value)}
                  />
                  <small>
                    {draft.transport === "builtin"
                      ? "Bridge вызывает настоящий API через локальный MCP-процесс; чужой CLI не меняется."
                      : "Используйте фактический Streamable HTTP endpoint MCP, а не URL страницы Jenkins/консоли."}
                  </small>
                </label>
                {draft.kind === "jenkins" && draft.transport === "builtin" && (
                  <label className="ops-field">
                    Имя пользователя Jenkins
                    <input
                      aria-label="Пользователь Jenkins"
                      value={draft.username || ""}
                      autoComplete="off"
                      disabled={busy}
                      onChange={(e) => update("username", e.target.value)}
                    />
                  </label>
                )}
                {draft.transport === "http" && (
                  <div className="ops-form-pair">
                    <label className="ops-field">
                      Имя credential header
                      <input
                        value={draft.secretHeader || ""}
                        placeholder="Authorization"
                        disabled={busy}
                        onChange={(e) => update("secretHeader", e.target.value)}
                      />
                    </label>
                    <label className="ops-field">
                      Префикс
                      <input
                        value={draft.secretPrefix ?? ""}
                        placeholder="Bearer "
                        disabled={busy}
                        onChange={(e) => update("secretPrefix", e.target.value)}
                      />
                      <small>Учитывайте пробел после Bearer.</small>
                    </label>
                  </div>
                )}
              </>
            )}
            <label className="ops-field">
              {draft.kind === "jenkins" && draft.transport === "builtin"
                ? "API token Jenkins"
                : "Токен подключения"}
              <input
                aria-label="Токен Operations"
                type="password"
                autoComplete="new-password"
                value={secret}
                disabled={busy}
                onChange={(e) => {
                  setSecret(e.target.value);
                  if (e.target.value) setClearSecret(false);
                }}
              />
              <small>
                {draft.credentialConfigured
                  ? "Токен сохранён. Пустое поле оставляет его без изменения."
                  : "Введите только при необходимости. Сохранённое значение не возвращается в интерфейс."}
              </small>
            </label>
            {draft.credentialConfigured && (
              <label className="ops-checkbox">
                <input
                  type="checkbox"
                  checked={clearSecret}
                  disabled={busy}
                  onChange={(e) => {
                    setClearSecret(e.target.checked);
                    if (e.target.checked) setSecret("");
                  }}
                />
                Удалить сохранённый токен
              </label>
            )}
            {draft.transport !== "stdio" && (
              <details>
                <summary>Корпоративные сертификаты</summary>
                <label className="ops-field">
                  Дополнительный корневой CA · PEM
                  <textarea
                    aria-label="CA сертификат Operations"
                    rows={5}
                    value={draft.ca || ""}
                    disabled={busy}
                    onChange={(e) => update("ca", e.target.value)}
                  />
                  <small>
                    Системные roots сохраняются. TLS verification не
                    отключается; private key сюда не вставляется.
                  </small>
                </label>
              </details>
            )}
            <fieldset>
              <legend>Проекты</legend>
              <div className="ops-projects">
                {projects
                  .filter((p) => !p.archived)
                  .map((project) => (
                    <label className="ops-checkbox" key={project.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={!!draft.projectIds?.includes(project.id)}
                        onChange={(e) =>
                          update(
                            "projectIds",
                            e.target.checked
                              ? [...(draft.projectIds || []), project.id]
                              : (draft.projectIds || []).filter(
                                  (id) => id !== project.id,
                                ),
                          )
                        }
                      />
                      {project.name}
                    </label>
                  ))}
              </div>
              <p className="ops-muted">
                Один connection ID и credentials для всех назначенных проектов.
                Операции всё равно закреплены за конкретной целью.
              </p>
            </fieldset>
            <label className="ops-checkbox">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                disabled={busy}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              Подключение включено
            </label>
            {draft.transport !== "builtin" && (
              <details open={!!inventory}>
                <summary>Mapping операций → реальные MCP tools</summary>
                <p className="ops-muted">
                  Сначала сохраните адрес и выполните discovery. Затем укажите
                  exact tool name из inventory. Tool должен принимать и
                  возвращать DTO Operations; несовместимая схема требует
                  адаптера. Для действий обязательны lifecycle bindings prepare,
                  execute и reconcile; один mapping имени операции не разрешает
                  отправку изменений.
                </p>
                <datalist id="ops-tool-inventory">
                  {inventory?.tools.map((tool) => (
                    <option value={tool.name} key={tool.name} />
                  ))}
                </datalist>
                <div className="ops-bindings">
                  {operations.map((operation) => (
                    <label className="ops-binding" key={operation}>
                      <code title={lifecycleHelp[operation]}>
                        {operation}
                        {lifecycleHelp[operation] && (
                          <small>{lifecycleHelp[operation]}</small>
                        )}
                      </code>
                      <input
                        aria-label={`MCP tool для ${operation}`}
                        list="ops-tool-inventory"
                        value={bindings[operation] || ""}
                        disabled={busy}
                        placeholder="Не подключено"
                        onChange={(e) =>
                          setBindings((old) => ({
                            ...old,
                            [operation]: e.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="ops-settings-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !draft.name?.trim()}
              onClick={() => void save()}
            >
              {busy ? "Выполняется…" : "Сохранить"}
            </button>
            <button
              type="button"
              disabled={busy || !draft.id || dirty || !!secret || clearSecret}
              title={
                dirty
                  ? "Сначала сохраните изменения"
                  : "initialize, tools/list и проверка API"
              }
              onClick={() => void inspect(true)}
            >
              Проверить и обнаружить
            </button>
            <button
              type="button"
              disabled={busy || !draft.id || dirty}
              onClick={() => void inspect(false)}
            >
              Inventory
            </button>
            <span />
            {draft.id && (
              <button
                type="button"
                className="ops-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Удалить
              </button>
            )}
          </div>
          {(inventory || draft.discovered) && (
            <section className="ops-settings-inventory">
              <strong>
                {(inventory || draft.discovered)?.server.name}{" "}
                {(inventory || draft.discovered)?.server.version || ""}
              </strong>
              <p className="ops-muted">
                Discovery:{" "}
                {observedAt((inventory || draft.discovered)?.observedAt)} ·{" "}
                {(inventory || draft.discovered)?.capabilities.length} доступных
                операций. Авторизация внешнего API проверяется отдельно от
                наличия инструмента.
              </p>
              <p className="ops-muted">
                {(inventory || draft.discovered)?.capabilities.join(" · ") ||
                  "Операции не сопоставлены"}
              </p>
              {inventory?.tools.map((tool) => (
                <details className="ops-tool" key={tool.name}>
                  <summary>{tool.name}</summary>
                  <p className="ops-muted">{tool.description}</p>
                  <OpsCode
                    text={JSON.stringify(tool.inputSchema, null, 2)}
                    label={`Схема ${tool.name}`}
                  />
                </details>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
