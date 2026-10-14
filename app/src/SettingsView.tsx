import { DatabaseSettings } from "./DatabaseSettings";
const OperationsSettings = lazy(() =>
  import("./OperationsSettings").then((module) => ({
    default: module.OperationsSettings,
  })),
);
import { IdeSettings } from "./IdeSettings";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AppState, Profile, Settings } from "../shared/types";
import { profileName } from "./labels";
import type { Invoke } from "./api";
import { Empty, Icon, IconButton, Modal, useAsk } from "./ui";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function SettingsView({
  state,
  run,
  onClose,
  onAssist,
  initialSection = "general",
  projectId,
}: {
  state: AppState;
  initialSection?: string;
  projectId?: string;
  run: Invoke;
  onClose: () => void;
  onAssist: (text: string) => void;
}) {
  const [section, setSection] = useState(initialSection),
    [edit, setEdit] = useState(() => ({
      draft: state.settings,
      baseline: state.settings,
      args: JSON.stringify(state.settings.cliArgs),
      protected: {} as Partial<Record<keyof Settings, boolean>>,
    })),
    [opsDirty, setOpsDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [memory, setMemory] = useState(""),
    [savedMemory, setSavedMemory] = useState(""),
    [memoryHash, setMemoryHash] = useState<string>(),
    [memoryBusy, setMemoryBusy] = useState(false),
    [memoryError, setMemoryError] = useState(""),
    [info, setInfo] = useState<any>(),
    [profile, setProfile] = useState<Partial<Profile>>(),
    [query, setQuery] = useState("");
  const ask = useAsk();
  const { draft, baseline, args } = edit;
  const memoryRequest = useRef(0);
  const memoryLoaded = useRef(false);
  const dirty =
    !same(draft, baseline) || args !== JSON.stringify(baseline.cliArgs);
  useEffect(() => {
    setEdit((old) => {
      if (same(old.baseline, state.settings)) return old;
      const rebased = { ...old.draft };
      const protectedFields = { ...old.protected };
      for (const key of Object.keys(state.settings) as (keyof Settings)[]) {
        if (key === "cliArgs") {
          rebased.cliArgs = state.settings.cliArgs;
          continue; // The editable JSON text has its own intent below.
        }
        if (same(old.draft[key], state.settings[key]))
          delete protectedFields[key];
        if (!old.protected[key] && same(old.draft[key], old.baseline[key]))
          Object.assign(rebased, { [key]: state.settings[key] });
      }
      const currentArgs = JSON.stringify(state.settings.cliArgs);
      if (old.args === currentArgs) delete protectedFields.cliArgs;
      return {
        baseline: state.settings,
        draft: rebased,
        protected: protectedFields,
        args:
          !old.protected.cliArgs &&
          old.args === JSON.stringify(old.baseline.cliArgs)
            ? currentArgs
            : old.args,
      };
    });
  }, [state.settings]);
  const close = async () => {
    if (
      (dirty || memory !== savedMemory || opsDirty) &&
      !(await ask("Закрыть без сохранения?", {
        message: "Изменения настроек ещё не применены.",
        confirm: true,
      }))
    )
      return;
    onClose();
  };
  const readMemory = async () => {
    const request = ++memoryRequest.current;
    setMemoryBusy(true);
    setMemoryError("");
    try {
      const result = await run("memory.read");
      if (request !== memoryRequest.current) return;
      if (result && typeof result.hash === "string") {
        setMemory(result.text);
        setSavedMemory(result.text);
        setMemoryHash(result.hash);
        memoryLoaded.current = true;
      } else setMemoryError("Не удалось прочитать память. Повторите загрузку.");
    } catch (e) {
      if (request === memoryRequest.current)
        setMemoryError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === memoryRequest.current) setMemoryBusy(false);
    }
  };
  useEffect(() => {
    if (section === "memory" && !memoryLoaded.current) void readMemory();
    if (section === "about" || section === "runtime")
      void run("app.info").then(setInfo);
  }, [section, run]);
  useEffect(
    () => () => {
      ++memoryRequest.current;
    },
    [],
  );
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setEdit((old) => ({
      ...old,
      draft: { ...old.draft, [key]: value },
      // A user can intentionally revert to the old baseline while a save is
      // pending. Preserve that newer intent when its delayed snapshot arrives.
      protected: { ...old.protected, [key]: saving || old.protected[key] },
    }));
    setSaved(false);
  };
  const save = async () => {
    if (saving) return;
    try {
      const cliArgs = JSON.parse(args);
      if (
        !Array.isArray(cliArgs) ||
        !cliArgs.every((a) => typeof a === "string")
      )
        throw new Error("Аргументы должны быть JSON-массивом строк.");
      if (
        !Number.isInteger(draft.maxConcurrent) ||
        draft.maxConcurrent < 1 ||
        draft.maxConcurrent > 8
      )
        throw new Error("Параллельность: целое число от 1 до 8.");
      const patch: Partial<Settings> = {};
      for (const key of Object.keys(draft) as (keyof Settings)[])
        if (key !== "cliArgs" && !same(draft[key], baseline[key]))
          Object.assign(patch, { [key]: draft[key] });
      if (!same(cliArgs, baseline.cliArgs)) patch.cliArgs = cliArgs;
      setSaving(true);
      const result = await run("settings.update", { patch });
      if (result !== undefined) {
        setError("");
        setSaved(true);
        // Live snapshots rebase untouched fields. Never replace an editor with
        // a stale submission acknowledgement while the user is still typing.
        setEdit((old) => ({
          ...old,
          args: old.args === args ? JSON.stringify(cliArgs) : old.args,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const closeProfile = async () => {
    if (!profile) return;
    const original = state.profiles.find((p) => p.id === profile.id);
    const changed =
      !profile.builtin &&
      (original
        ? ["name", "description", "prompt"].some(
            (k) => profile[k as keyof Profile] !== original[k as keyof Profile],
          )
        : !!(profile.name || profile.description || profile.prompt));
    if (
      changed &&
      !(await ask("Отбросить изменения профиля?", { confirm: true }))
    )
      return;
    setProfile(undefined);
  };
  const sections = [
    ["general", "Внешний вид", "settings"],
    ["runtime", "CLI и модели", "terminal"],
    ["ide", "IDE", "code"],
    ["database", "Подключения БД", "database"],
    ["operations", "Jenkins и кластеры", "cluster"],
    ["execution", "Выполнение", "agents"],
    ["profiles", "Роли", "branch"],
    ["memory", "Память", "memory"],
    ["about", "Диагностика", "unknown"],
  ];
  return (
    <Modal title="Настройки" onClose={() => void close()} wide>
      <div className="settings-layout">
        <nav className="settings-nav">
          {sections.map(([id, label, icon]) => (
            <button
              key={id}
              className={section === id ? "selected" : ""}
              onClick={async () => {
                if (section === id) return;
                if (
                  opsDirty &&
                  !(await ask("Перейти без сохранения подключения?", {
                    message:
                      "Введённые настройки подключения ещё не применены.",
                    confirm: true,
                  }))
                )
                  return;
                setSection(id);
              }}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === "general" && (
            <>
              <h3>Внешний вид</h3>
              <p className="muted">
                Настройки приложения. Изменения применяются после сохранения.
              </p>
              <label className="field">
                Тема
                <select
                  value={draft.theme}
                  onChange={(e) =>
                    update("theme", e.target.value as Settings["theme"])
                  }
                >
                  <option value="system">Как в системе</option>
                  <option value="light">Светлая</option>
                  <option value="dark">Тёмная</option>
                </select>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.reducedMotion}
                  onChange={(e) => update("reducedMotion", e.target.checked)}
                />
                Уменьшить движение
              </label>
              <button
                onClick={async () => {
                  if (
                    await ask("Сбросить расположение панелей?", {
                      message:
                        "Сохранятся проекты, разговоры и работающие процессы. Новая раскладка появится после открытия нового окна.",
                      confirm: true,
                    })
                  ) {
                    localStorage.removeItem("workbench.layout.v1");
                    localStorage.removeItem("workbench.layout.v2");
                  }
                }}
              >
                Сбросить сохранённую раскладку
              </button>
            </>
          )}
          {section === "operations" && (
            <Suspense
              fallback={
                <div className="empty-state">Открываю подключения…</div>
              }
            >
              <OperationsSettings
                projects={state.projects.filter((p) => !p.archived)}
                projectId={projectId}
                onDirtyChange={setOpsDirty}
              />
            </Suspense>
          )}
          {section === "ide" && <IdeSettings state={state} run={run} />}
          {section === "database" && (
            <DatabaseSettings state={state} run={run} />
          )}
          {section === "runtime" && (
            <>
              <h3>CLI и модели</h3>
              <p className="muted">
                Укажите установленный Qwen/GigaCode CLI. Авторизация остаётся в
                его существующих настройках, секреты в эту форму не вводятся.
              </p>
              <label className="field">
                Исполняемый файл
                <div className="inline-field">
                  <input
                    value={draft.cliPath}
                    onChange={(e) => update("cliPath", e.target.value)}
                  />
                  <button
                    onClick={async () => {
                      const result = await run("app.chooseCli");
                      if (result?.path) update("cliPath", result.path);
                    }}
                  >
                    Выбрать…
                  </button>
                </div>
              </label>
              {info?.bundledCli && (
                <button onClick={() => update("cliPath", "@bundled")}>
                  Использовать встроенный {info.bundledCli.label}
                </button>
              )}
              {draft.cliPath === "@bundled" && (
                <p className="fine-print">
                  CLI поставляется вместе с приложением. Путь определяется
                  заново при каждом запуске.
                </p>
              )}
              {info?.bundledCliError && (
                <p role="alert">{info.bundledCliError}</p>
              )}
              <label className="field">
                Аргументы запуска · JSON-массив строк
                <textarea
                  rows={3}
                  spellCheck={false}
                  value={args}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEdit((old) => ({
                      ...old,
                      args: value,
                      protected: {
                        ...old.protected,
                        cliArgs: saving || old.protected.cliArgs,
                      },
                    }));
                    setSaved(false);
                  }}
                />
              </label>
              <p className="fine-print">
                Используйте аргументы именно вашей версии CLI. Настройка не
                меняет уже выполняющийся запрос.
              </p>
              <label className="field">
                Модель по умолчанию
                <input
                  value={draft.model}
                  onChange={(e) => update("model", e.target.value)}
                  placeholder="Выбор CLI"
                />
              </label>
              <p className="fine-print">
                Доступные model/reasoning options показываются у composer после
                получения реальной конфигурации сессии. Значения разных
                провайдеров могут различаться.
              </p>
            </>
          )}
          {section === "execution" && (
            <>
              <h3>Выполнение</h3>
              <label className="field">
                Доступ к инструментам CLI и MCP
                <select
                  value={draft.permissionMode}
                  onChange={(e) =>
                    update(
                      "permissionMode",
                      e.target.value as Settings["permissionMode"],
                    )
                  }
                >
                  <option value="auto_allow_bound">
                    Разрешать всё подключённое к проекту
                  </option>
                  <option value="ask_each">
                    Спрашивать для каждого вызова
                  </option>
                </select>
              </label>
              <p className="fine-print">
                По умолчанию подключение CLI или MCP к проекту уже считается
                разрешением. Сессии и субагенты наследуют этот доступ, поэтому
                отдельные окна подтверждения не появляются. Вызовы и результаты
                остаются видимыми в истории и диагностике.
              </p>
              <label className="field">
                Одновременно активных сессий
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={draft.maxConcurrent}
                  onChange={(e) =>
                    update("maxConcurrent", Number(e.target.value))
                  }
                />
              </label>
              <label className="field">
                Попыток запуска CLI
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={draft.startupRetries}
                  onChange={(e) =>
                    update("startupRetries", Number(e.target.value))
                  }
                />
              </label>
              <label className="field">
                Настроенный предел контекста
                <input
                  type="number"
                  min={0}
                  step={1024}
                  value={draft.contextLimit}
                  onChange={(e) =>
                    update("contextLimit", Number(e.target.value))
                  }
                />
              </label>
              <p className="fine-print">
                Настроенное значение не доказывает лимит модели. Потерянный
                ответ после отправки не повторяется автоматически; авторизацию и
                правила внешних эффектов изменение лимитов не расширяет.
              </p>
            </>
          )}
          {section === "profiles" && (
            <>
              <div className="section-heading">
                <h3>Роли</h3>
                <button
                  onClick={() =>
                    setProfile({
                      name: "",
                      description: "",
                      prompt: "",
                      builtin: false,
                    })
                  }
                >
                  <Icon name="plus" size={15} />
                  Создать
                </button>
              </div>
              <div className="inline-field">
                <input
                  aria-label="Найти профиль"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск роли…"
                />
                <button
                  onClick={async () => {
                    const purpose = await ask(
                      "Какую работу должен выполнять профиль?",
                      { multiline: true },
                    );
                    if (purpose) {
                      onClose();
                      onAssist(
                        `Помоги подобрать или составить профиль для следующей работы: ${purpose}. Сначала сравни с существующими профилями, затем подготовь короткий черновик инструкций, входы/результат и ограничения. Не меняй настройки или права без отдельного поручения. Не запускай исходную работу вместо создания профиля.`,
                      );
                    }
                  }}
                >
                  Помощь агента
                </button>
              </div>
              <p className="fine-print">
                LLM выбирает роль по запросу, беседе и задаче. Общая база и
                инструкции одной роли собираются в отдельную версию для
                исполнителя. Способ передачи зависит от проверенных возможностей
                CLI.
              </p>
              {state.sessions.some((s) => s.instructionBinding) && (
                <details className="fine-print">
                  <summary>Применённые инструкции</summary>
                  {state.sessions
                    .filter((s) => s.instructionBinding)
                    .slice(-12)
                    .map((s) => (
                      <div className="instruction-receipt" key={s.id}>
                        <strong>{s.title}</strong> ·{" "}
                        {profileName(
                          state.profiles.find(
                            (p) => p.id === s.instructionBinding!.profileId,
                          ),
                          s.instructionBinding!.profileId,
                        )}
                        {" · "}
                        {s.instructionBinding!.delivery === "append_system"
                          ? "Системное дополнение"
                          : "Контекст"}
                        {" · "}
                        {s.instructionBinding!.fingerprint.slice(0, 12)}
                        {" · "}
                        {s.instructionBinding!.state === "prepared"
                          ? "Подготовлено"
                          : s.instructionBinding!.state === "closed"
                            ? "Соединение закрыто"
                            : "Применено к исполнителю"}
                        <br />
                        {s.instructionBinding!.delivery === "append_system"
                          ? "Общие правила и одна роль добавлены к встроенным инструкциям CLI."
                          : "Системное дополнение для этого CLI не подтверждено; инструкции передаются через контекст."}
                        <details>
                          <summary>Основание проверки</summary>
                          {s.instructionBinding!.reason}
                        </details>
                        {s.roleRouting?.source === "retained" && (
                          <>
                            <br />
                            {s.roleRouting.reason}
                          </>
                        )}
                        {(s.roleTransitionHistory?.length ||
                          s.roleTransition) && (
                          <details className="role-transition-history">
                            <summary>Этапы в разговоре</summary>
                            <ol>
                              {[
                                ...(s.roleTransitionHistory || []).filter(
                                  (entry) => entry.id !== s.roleTransition?.id,
                                ),
                                ...(s.roleTransition ? [s.roleTransition] : []),
                              ]
                                .slice(-6)
                                .map((entry) => (
                                  <li
                                    key={entry.id}
                                    data-role-transition-status={entry.status}
                                  >
                                    <span>
                                      {profileName(
                                        state.profiles.find(
                                          (p) => p.id === entry.fromProfileId,
                                        ),
                                        entry.fromProfileId,
                                      )}
                                      {" → "}
                                      {entry.toProfileId
                                        ? profileName(
                                            state.profiles.find(
                                              (p) => p.id === entry.toProfileId,
                                            ),
                                            entry.toProfileId,
                                          )
                                        : "роль уточняется"}
                                    </span>
                                    <span className="role-transition-outcome">
                                      {
                                        {
                                          pending: "Готовится передача",
                                          held: "Приостановлен",
                                          ready: "Подготовлен",
                                          running: "Выполняется",
                                          completed: "Завершён",
                                          rejected: "Отклонён",
                                          unknown: "Исход неизвестен",
                                        }[entry.status]
                                      }
                                    </span>
                                    <div>
                                      {entry.holdReason || entry.reason}
                                    </div>
                                  </li>
                                ))}
                            </ol>
                          </details>
                        )}
                      </div>
                    ))}
                </details>
              )}
              <div className="profile-list">
                {state.profiles
                  .filter((p) =>
                    `${profileName(p)} ${p.name} ${p.description}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <button key={p.id} onClick={() => setProfile({ ...p })}>
                      <Icon name="branch" />
                      <span>
                        <strong>{profileName(p)}</strong>
                        <small>{p.description}</small>
                      </span>
                      <small>{p.builtin ? "Встроенная" : "Своя"}</small>
                    </button>
                  ))}
              </div>
            </>
          )}
          {section === "memory" && (
            <>
              <h3>Общая память</h3>
              <p className="muted">
                Сохраняйте полезные факты со ссылкой на источник и область
                проекта. Не добавляйте пароли, токены и полные журналы.
              </p>
              <textarea
                className="memory-editor"
                aria-label="Память"
                value={memory}
                disabled={memoryBusy}
                onChange={(e) => setMemory(e.target.value)}
              />
              <button
                className="primary"
                disabled={memoryBusy || !memoryHash || memory === savedMemory}
                onClick={async () => {
                  const submitted = memory;
                  setMemoryBusy(true);
                  setMemoryError("");
                  try {
                    const result = await run("memory.write", {
                      text: submitted,
                      expectedHash: memoryHash,
                    });
                    if (result?.saved && result.hash) {
                      setSavedMemory(submitted);
                      setMemoryHash(result.hash);
                    } else
                      setMemoryError(
                        "Память не сохранена. Черновик оставлен; перечитайте текущую версию перед объединением изменений.",
                      );
                  } catch (e) {
                    setMemoryError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setMemoryBusy(false);
                  }
                }}
              >
                Сохранить память
              </button>
              <button
                disabled={memoryBusy}
                onClick={async () => {
                  if (
                    memory !== savedMemory &&
                    !(await ask("Перечитать память?", {
                      message:
                        "Скопируйте свой черновик перед загрузкой: редактор будет заменён текущей сохранённой версией.",
                      confirm: true,
                    }))
                  )
                    return;
                  await readMemory();
                }}
              >
                Перечитать память
              </button>
              {memoryError && (
                <p role="alert" className="error-inline">
                  {memoryError}
                </p>
              )}
            </>
          )}
          {section === "about" && (
            <>
              <h3>Диагностика</h3>
              {info ? (
                <dl className="info-list">
                  {Object.entries(info).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted">Информация приложения загружается…</p>
              )}
              <button
                onClick={async () => {
                  const result = await run("diagnostics.export");
                  if (result?.path)
                    await ask("Диагностика сохранена", {
                      message: result.path,
                      confirm: true,
                    });
                }}
              >
                Собрать локальную диагностику
              </button>
              <p className="fine-print">
                Экспорт не отправляется во внешние сервисы.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error-inline">
              {error}
            </p>
          )}
          {saved && !dirty && (
            <p role="status" className="saved-status">
              Настройки сохранены. Параметры запуска действуют для следующего
              подходящего запуска.
            </p>
          )}
        </div>
      </div>
      <footer className="settings-footer">
        <span>
          {dirty ? "Есть несохранённые изменения" : "Настройки приложения"}
        </span>
        <button onClick={() => void close()}>Закрыть</button>
        <button
          className="primary"
          disabled={!dirty || saving}
          aria-busy={saving}
          onClick={() => void save()}
        >
          Сохранить
        </button>
      </footer>
      {profile && (
        <Modal
          title={profile.builtin ? "Встроенный профиль" : "Редактор профиля"}
          onClose={() => void closeProfile()}
        >
          <div className="profile-editor">
            <label className="field">
              Название
              <input
                readOnly={profile.builtin}
                value={
                  profile.builtin ? profileName(profile) : profile.name || ""
                }
                onChange={(e) =>
                  setProfile({ ...profile, name: e.target.value })
                }
              />
            </label>
            <label className="field">
              Назначение
              <input
                readOnly={profile.builtin}
                value={profile.description || ""}
                onChange={(e) =>
                  setProfile({ ...profile, description: e.target.value })
                }
              />
            </label>
            <label className="field">
              Инструкции
              <textarea
                readOnly={profile.builtin}
                rows={13}
                aria-label="Инструкции"
                value={profile.prompt || ""}
                onChange={(e) =>
                  setProfile({ ...profile, prompt: e.target.value })
                }
              />
            </label>
            <p className="fine-print">
              Текст профиля не выдаёт новых прав инструментам. Изменение не
              переписывает уже выполняющийся запрос.
            </p>
            <footer>
              {!profile.builtin && profile.id && (
                <button
                  className="danger"
                  onClick={async () => {
                    if (
                      await ask("Удалить пользовательский профиль?", {
                        confirm: true,
                        message:
                          "Активные сессии не должны подменяться другой ролью.",
                      })
                    ) {
                      await run("profile.delete", { id: profile.id });
                      setProfile(undefined);
                    }
                  }}
                >
                  Удалить
                </button>
              )}
              <span />
              <button
                onClick={() =>
                  setProfile({
                    ...profile,
                    id: undefined,
                    name: `${profileName(profile)} — копия`,
                    builtin: false,
                  })
                }
              >
                Копировать
              </button>
              <button onClick={() => void closeProfile()}>Отмена</button>
              {!profile.builtin && (
                <button
                  className="primary"
                  disabled={!profile.name?.trim() || !profile.prompt?.trim()}
                  onClick={async () => {
                    const result = await run("profile.save", {
                      id: profile.id,
                      name: profile.name,
                      description: profile.description || "",
                      prompt: profile.prompt,
                    });
                    if (result !== undefined) setProfile(undefined);
                  }}
                >
                  Сохранить профиль
                </button>
              )}
            </footer>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
