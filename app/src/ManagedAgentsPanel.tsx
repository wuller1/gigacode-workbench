import { useRef, useState } from "react";
import type { PanelProps } from "./Panels";
import { Empty, Icon, Status } from "./ui";
import { busy, errorText } from "./api";
import { profileName } from "./labels";

const workerPhase = (phase?: string) =>
  ({
    queued: "В очереди",
    leased: "Подготовка",
    dispatched: "Выполняется",
    retry_wait: "Ожидает повтора",
    paused: "Пауза",
    completed: "Готово",
    failed: "Ошибка",
    cancelled: "Остановлен",
    unknown: "Нужна сверка",
  })[phase || ""] || "Исполнитель";

export function ManagedAgentsPanel({
  state,
  task,
  session,
  run,
  selectSession,
}: PanelProps) {
  const [scope, setScope] = useState("task"),
    [creating, setCreating] = useState(false),
    [prompt, setPrompt] = useState("");
  const [targetProject, setTargetProject] = useState(""),
    [writeScopes, setWriteScopes] = useState(""),
    [dependencies, setDependencies] = useState<string[]>([]);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [followup, setFollowup] = useState<string>(),
    [followupText, setFollowupText] = useState("");
  const delegationId = useRef(crypto.randomUUID());
  const reconciliationId = useRef(crypto.randomUUID());
  const actionPending = useRef(false);
  const [reconciling, setReconciling] = useState<string>(),
    [outcome, setOutcome] = useState(""),
    [verification, setVerification] = useState("");
  const projectId = state.tasks.find((t) => t.id === task?.id)?.projectId;
  const fromCurrentTask = (id: string) => {
    let s = state.sessions.find((v) => v.id === id);
    for (let i = 0; s && i < 6; i++) {
      if (s.taskId === task?.id) return true;
      const parentId = s.parentId;
      s = state.sessions.find((v) => v.id === parentId);
    }
    return false;
  };
  const priority = (s: (typeof state.sessions)[number]) =>
    s.status === "unknown" || s.status === "waiting" || s.managed?.effectFence
      ? 0
      : busy(s.status)
        ? 1
        : s.status === "failed" || s.managed?.phase === "retry_wait"
          ? 2
          : s.queue.length || s.managed?.phase === "paused"
            ? 3
            : 4;
  const workers = state.sessions
    .filter(
      (s) =>
        s.parentId &&
        !s.archived &&
        (scope === "all" ||
          (scope === "task"
            ? fromCurrentTask(s.id)
            : state.tasks.find((t) => t.id === s.taskId)?.projectId ===
              projectId)),
    )
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const act = async (method: string, params: Record<string, unknown>) => {
    if (actionPending.current) return false;
    actionPending.current = true;
    setPending(true);
    setError("");
    try {
      const result = await run(method, params);
      return result !== undefined;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  };
  const owned = (id: string) => {
    let s = state.sessions.find((v) => v.id === id);
    for (let i = 0; s && i < 6; i++) {
      if (s.id === session?.id || s.parentId === session?.id) return true;
      s = state.sessions.find((v) => v.id === s?.parentId);
    }
    return false;
  };
  return (
    <div className="panel-content padded managed-agents-panel">
      <div className="panel-toolbar">
        <select
          aria-label="Область исполнителей"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="task">Эта задача</option>
          <option value="project">Этот проект</option>
          <option value="all">Все проекты</option>
        </select>
        <span className="composer-spacer" />
        <button
          disabled={!session || pending}
          onClick={() => setCreating(!creating)}
        >
          <Icon name="plus" size={14} />
          Поручение
        </button>
      </div>
      {creating && (
        <form
          className="managed-agent-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!session || !prompt.trim()) return;
            if (
              await act("agent.delegate", {
                parentId: session.id,
                title: prompt.trim().split("\n")[0].slice(0, 100),
                prompt,
                operationId: delegationId.current,
                ...(targetProject ? { targetProjectId: targetProject } : {}),
                ...((!targetProject || targetProject === projectId) && task
                  ? { targetTaskId: task.id }
                  : {}),
                dependencies,
                writeScopes: writeScopes
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
                contextBudget: 16000,
              })
            ) {
              delegationId.current = crypto.randomUUID();
              setCreating(false);
              setPrompt("");
              setDependencies([]);
              setWriteScopes("");
            }
          }}
        >
          <label className="field">
            Независимый результат
            <textarea
              autoFocus
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Что сделать, что проверить и какой результат вернуть"
            />
          </label>
          <label className="field">
            Проект
            <select
              value={targetProject || projectId || ""}
              onChange={(e) => setTargetProject(e.target.value)}
            >
              {state.projects
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <details>
            <summary>Зависимости и область изменения</summary>
            <label className="field">
              Файлы/каталоги для записи · относительно проекта
              <textarea
                rows={2}
                value={writeScopes}
                onChange={(e) => setWriteScopes(e.target.value)}
                placeholder="src/backend/ — оставьте пустым для исследования"
              />
            </label>
            {workers
              .filter((w) => owned(w.id))
              .map((w) => (
                <label className="check-field" key={w.id}>
                  <input
                    type="checkbox"
                    checked={dependencies.includes(w.id)}
                    onChange={(e) =>
                      setDependencies((d) =>
                        e.target.checked
                          ? [...d, w.id]
                          : d.filter((id) => id !== w.id),
                      )
                    }
                  />
                  После: {w.title}
                </label>
              ))}
          </details>
          <p className="fine-print">
            Роль подберёт ИИ. Каждый исполнитель получает собственную сессию,
            инструкции и ограниченный пакет контекста. Области записи
            предотвращают пересечение управляемых задач, но не заменяют изоляцию
            файловой системы.
          </p>
          <div className="settings-actions">
            <button type="submit" disabled={pending || !prompt.trim()}>
              Назначить
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {workers.map((s) => {
        const m = s.managed,
          control = true,
          waiting = m?.phase === "paused";
        return (
          <article className="worker-card" key={s.id}>
            <button
              className="worker-heading"
              onClick={() => selectSession(s.id)}
            >
              <Status status={s.status} />
              <strong>{s.title}</strong>
            </button>
            <p className="worker-meta">
              {
                state.projects.find(
                  (p) =>
                    p.id ===
                    state.tasks.find((t) => t.id === s.taskId)?.projectId,
                )?.name
              }{" "}
              ·{" "}
              {profileName(
                state.profiles.find((p) => p.id === s.profileId),
                s.profileId,
              )}{" "}
              · {s.model || "Модель CLI"}
              {m && (
                <>
                  {" "}
                  · {workerPhase(m.phase)} · попытка {m.attempts} ·{" "}
                  {Math.round(m.contextBudget / 1000)}k пакет
                </>
              )}
            </p>
            <p>
              {s.todos.find((t) => t.status === "in_progress")?.text ||
                m?.failure?.summary ||
                s.error ||
                m?.checkpoint?.summary ||
                s.messages
                  .filter((x) => x.role === "assistant")
                  .at(-1)
                  ?.content.slice(-240) ||
                (busy(s.status)
                  ? "Выполняет поручение"
                  : m?.dependencies.some(
                        (id) =>
                          state.sessions.find((v) => v.id === id)?.managed
                            ?.phase !== "completed",
                      )
                    ? "Ожидает зависимостей"
                    : workerPhase(m?.phase))}
            </p>
            {!!m?.dependencies.length && (
              <p className="fine-print">
                После:{" "}
                {m.dependencies
                  .map(
                    (id) =>
                      state.sessions.find((v) => v.id === id)?.title || id,
                  )
                  .join(", ")}
              </p>
            )}
            {m?.effectFence && (
              <div>
                <p className="fine-print">
                  Результат предыдущего действия требует сверки. Автоматический
                  повтор остановлен.
                </p>
                <button
                  disabled={pending}
                  onClick={() => {
                    reconciliationId.current = crypto.randomUUID();
                    setReconciling(s.id);
                    setOutcome("");
                    setVerification("");
                  }}
                >
                  Подтвердить сверку результата
                </button>
              </div>
            )}
            {reconciling === s.id && (
              <form
                className="managed-agent-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await act("agent.reconcile", {
                      id: s.id,
                      operationId: reconciliationId.current,
                      outcome,
                      evidenceRefs: verification
                        .split("\n")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  )
                    setReconciling(undefined);
                }}
              >
                <label className="field">
                  Наблюдаемый результат
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                  >
                    <option value="">Выберите после реальной проверки</option>
                    <option value="applied">
                      Предыдущие действия применены — не повторять
                    </option>
                    <option value="not_applied">
                      Подтверждено, что действия не применены
                    </option>
                  </select>
                </label>
                <label className="field">
                  Ссылки на проверку
                  <textarea
                    rows={2}
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    placeholder="Receipt, artifact, проверенный remote ID — по одному на строку"
                  />
                </label>
                <p className="fine-print">
                  Это ваше подтверждение фактической сверки. Текст агента сам по
                  себе не подтверждает внешний результат.
                </p>
                <div className="settings-actions">
                  <button
                    disabled={pending || !outcome || !verification.trim()}
                  >
                    Сохранить сверку
                  </button>
                  <button
                    type="button"
                    onClick={() => setReconciling(undefined)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}
            <div className="worker-actions">
              <button onClick={() => selectSession(s.id)}>Открыть</button>
              {m && (
                <>
                  <button
                    disabled={
                      pending ||
                      !control ||
                      ["completed", "cancelled", "unknown", "failed"].includes(
                        m.phase,
                      ) ||
                      m.effectFence
                    }
                    onClick={() =>
                      void act("agent.control", {
                        id: s.id,
                        action: waiting ? "resume" : "pause",
                      })
                    }
                  >
                    {waiting ? "Продолжить" : "Пауза"}
                  </button>
                  <button
                    disabled={
                      pending ||
                      !control ||
                      s.status === "cancelling" ||
                      (m
                        ? ["completed", "cancelled"].includes(m.phase)
                        : !busy(s.status) && !s.queue.length)
                    }
                    onClick={() =>
                      void act("agent.control", { id: s.id, action: "cancel" })
                    }
                  >
                    Остановить
                  </button>
                  {["failed", "cancelled", "retry_wait"].includes(m.phase) &&
                    m.canRetry !== false && (
                      <button
                        disabled={pending || !control || m.effectFence}
                        onClick={() =>
                          void act("agent.control", {
                            id: s.id,
                            action: "retry",
                          })
                        }
                      >
                        Повторить
                      </button>
                    )}
                </>
              )}
              <button
                disabled={
                  pending ||
                  !control ||
                  busy(s.status) ||
                  s.status === "unknown" ||
                  m?.effectFence
                }
                onClick={() => {
                  setFollowup(s.id);
                  setFollowupText("");
                }}
              >
                Новое поручение
              </button>
            </div>
            {followup === s.id && (
              <form
                className="managed-agent-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await act("agent.followup", {
                      id: s.id,
                      text: followupText,
                    })
                  ) {
                    setFollowup(undefined);
                    setFollowupText("");
                  }
                }}
              >
                <label className="field">
                  Поручение исполнителю
                  <textarea
                    autoFocus
                    rows={2}
                    value={followupText}
                    onChange={(e) => setFollowupText(e.target.value)}
                  />
                </label>
                <div className="settings-actions">
                  <button disabled={pending || !followupText.trim()}>
                    Отправить
                  </button>
                  <button type="button" onClick={() => setFollowup(undefined)}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </article>
        );
      })}
      {!workers.length && (
        <Empty icon="agents" title="Исполнителей пока нет">
          <p>
            Небольшую задачу быстрее выполнить в одном разговоре. Делегируйте
            независимые части, когда это сокращает работу.
          </p>
        </Empty>
      )}
      {!!state.coordinationLinks?.length && (
        <details className="managed-project-links">
          <summary>
            Связи проектов ·{" "}
            {state.coordinationLinks.filter((l) => l.enabled).length}
          </summary>
          {state.coordinationLinks.map((l) => (
            <div key={l.id}>
              <span>
                {state.projects.find((p) => p.id === l.sourceProjectId)?.name} →{" "}
                {state.projects.find((p) => p.id === l.targetProjectId)?.name}
              </span>
              <button
                disabled={pending || !l.enabled}
                onClick={() => void act("coordination.revoke", { id: l.id })}
              >
                {l.enabled ? "Отключить" : "Отключена"}
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
