import { useEffect, useRef, useState } from "react";
import type {
  OpsActionOperation,
  OpsConnection,
  OpsJenkinsJob,
  OpsJenkinsParameter,
  OpsLogPage,
  OpsReceipt,
  OpsValue,
} from "../shared/operations";
import { useStored } from "./api";
import { Icon, IconButton } from "./ui";
import {
  elapsed,
  hasCapability,
  observedAt,
  opsCall,
  opsErrorText,
  OpsBadge,
  OpsCode,
  OpsDivider,
  OpsEmpty,
  OpsErrorBox,
  OpsReceipts,
  OpsStar,
  useOpsQuery,
  useOpsSnapshot,
  useOpsPanelWidth,
  stripJenkinsConsoleText,
  type OpsPanelProps,
} from "./ops-ui";

type Build = {
  number: number;
  result: string | null;
  building: boolean;
  timestamp?: number;
  duration?: number;
  url?: string;
  queueId?: string;
};
type JobDetail = OpsJenkinsJob & { builds?: Build[]; description?: string };
type QueueItem = {
  id: number | string;
  why?: string;
  blocked?: boolean;
  buildable?: boolean;
  cancelled?: boolean;
  task: { name: string; fullName: string; url?: string };
  executable?: { number: number; url?: string };
};
export function JenkinsPanel({
  projectId,
  sessionId,
  visible = true,
  onSettings,
  onAssist,
  reveal,
}: OpsPanelProps) {
  const {
    snapshot,
    refresh,
    error: snapshotError,
    ready: snapshotReady,
    loading: snapshotLoading,
  } = useOpsSnapshot(projectId, visible);
  const [choices, setChoices] = useStored<Record<string, string>>(
    "workbench.ops.jenkins.connections.v1",
    {},
  );
  const connections = snapshot.connections.filter(
    (c) =>
      c.kind === "jenkins" &&
      c.enabled &&
      (!projectId || c.projectIds.includes(projectId)),
  );
  const connection =
    connections.find((c) => c.id === choices[projectId || ""]) ||
    connections[0];
  const [folder, setFolder] = useState(""),
    [search, setSearch] = useState(""),
    [querySearch, setQuerySearch] = useState(""),
    [tab, setTab] = useState("jobs"),
    [cursor, setCursor] = useState<string>();
  const [onlyFavorites, setOnlyFavorites] = useStored<Record<string, boolean>>(
    "workbench.ops.jenkins.favoriteFilters.v1",
    {},
  );
  const [catalog, setCatalog] = useState<{
    key: string;
    jobs: OpsJenkinsJob[];
  }>({ key: "", jobs: [] });
  const [selected, setSelected] = useState<{
      connectionId: string;
      targetHash: string;
      job: OpsJenkinsJob;
    }>(),
    [build, setBuild] = useState<number>();
  const { ref: panelRef, width: panelWidth } = useOpsPanelWidth();
  const [detailWidth, setDetailWidth] = useState(560),
    [actionBusy, setActionBusy] = useState(false),
    [error, setError] = useState("");
  const targetKey = JSON.stringify([
      projectId,
      connection?.id,
      connection?.targetHash,
      connection?.authGeneration,
    ]),
    catalogKey = JSON.stringify([
      targetKey,
      folder,
      querySearch,
      !!onlyFavorites[connection?.id || ""],
    ]);
  const targetRef = useRef(targetKey),
    actionLock = useRef(false);
  targetRef.current = targetKey;
  const revealEpoch = useRef(0),
    latestReveal = useRef(reveal?.nonce),
    lastRevealTarget = useRef(targetKey);
  latestReveal.current = reveal?.nonce;
  if (lastRevealTarget.current !== targetKey) {
    lastRevealTarget.current = targetKey;
    ++revealEpoch.current;
  }
  const cancelReveal = () => {
    ++revealEpoch.current;
  };
  useEffect(() => {
    setFolder("");
    setSearch("");
    setCursor(undefined);
    setSelected(undefined);
    setBuild(undefined);
    setError("");
  }, [targetKey]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuerySearch(search.trim());
      setCursor(undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const recursive = !!querySearch || !!onlyFavorites[connection?.id || ""];
  const jobsQuery = useOpsQuery<{ jobs: OpsJenkinsJob[]; complete: boolean }>(
    projectId,
    connection,
    "ci.jobs",
    {
      folder: recursive ? "" : folder,
      cursor,
      limit: 100,
      recursive,
      search: querySearch || undefined,
    },
    hasCapability(connection, "ci.jobs"),
  );
  const refreshJobs = () => {
    if (cursor) setCursor(undefined);
    else void jobsQuery.refresh();
  };
  const queue = useOpsQuery<{ items: QueueItem[] }>(
    projectId,
    connection,
    "ci.queue",
    {},
    hasCapability(connection, "ci.queue"),
    visible ? 3000 : 0,
  );
  useEffect(() => {
    if (!jobsQuery.value) return;
    setCatalog((old) => {
      const previous = old.key === catalogKey && cursor ? old.jobs : [];
      const jobs = new Map(previous.map((j) => [j.id, j]));
      for (const job of jobsQuery.value!.data.jobs) jobs.set(job.id, job);
      return { key: catalogKey, jobs: [...jobs.values()] };
    });
  }, [jobsQuery.value, catalogKey, cursor]);
  const jobs = catalog.key === catalogKey ? catalog.jobs : [],
    favorites = new Set(
      snapshot.favorites
        .filter((f) => f.connectionId === connection?.id)
        .map((f) => f.jobId),
    );
  const filtered = jobs.filter(
    (j) =>
      (!onlyFavorites[connection?.id || ""] || favorites.has(j.id)) &&
      `${j.fullName} ${j.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedJob =
    selected &&
    connection &&
    selected.connectionId === connection.id &&
    selected.targetHash === connection.targetHash
      ? selected.job
      : undefined;
  const receipts = snapshot.receipts.filter(
    (r) => r.connectionId === connection?.id && r.operation.startsWith("ci."),
  );
  const focusedDetail = !!selectedJob && panelWidth < 650;
  const effectiveDetailWidth = focusedDetail
    ? panelWidth
    : Math.min(detailWidth, Math.max(270, panelWidth - 236));
  const jobReadVersions = useRef(new Map<string, number>()),
    receiptVersions = useRef(new Map<string, string>()),
    queueJobs = useRef(new Map<string, string>()),
    jobScope = useRef(targetKey),
    jobScopeEpoch = useRef(0),
    receiptScope = useRef("");
  if (jobScope.current !== targetKey) {
    jobScope.current = targetKey;
    ++jobScopeEpoch.current;
    jobReadVersions.current.clear();
    receiptVersions.current.clear();
    queueJobs.current.clear();
    receiptScope.current = "";
  }
  const patchJob = (job: OpsJenkinsJob) => {
    jobReadVersions.current.set(
      job.id,
      (jobReadVersions.current.get(job.id) || 0) + 1,
    );
    setCatalog((old) => {
      if (old.key !== catalogKey) return old;
      const index = old.jobs.findIndex((value) => value.id === job.id);
      if (index < 0 || JSON.stringify(old.jobs[index]) === JSON.stringify(job))
        return old;
      const next = [...old.jobs];
      next[index] = job;
      return { ...old, jobs: next };
    });
  };
  useEffect(() => {
    for (const item of queue.value?.data.items || [])
      queueJobs.current.set(
        String(item.id),
        item.task.fullName || item.task.name,
      );
    while (queueJobs.current.size > 1000)
      queueJobs.current.delete(queueJobs.current.keys().next().value!);
  }, [queue.value]);
  useEffect(() => {
    if (!snapshotReady || !connection) return;
    const signature = (receipt: OpsReceipt) =>
      JSON.stringify([
        receipt.status,
        receipt.remoteId,
        receipt.data &&
        typeof receipt.data === "object" &&
        !Array.isArray(receipt.data)
          ? [receipt.data.number, receipt.data.result, receipt.data.building]
          : undefined,
      ]);
    if (receiptScope.current !== targetKey) {
      receiptScope.current = targetKey;
      for (const receipt of receipts)
        receiptVersions.current.set(receipt.id, signature(receipt));
      return;
    }
    const changed = new Set<string>();
    for (const receipt of receipts) {
      const version = signature(receipt);
      if (receiptVersions.current.get(receipt.id) === version) continue;
      receiptVersions.current.set(receipt.id, version);
      const id =
        typeof receipt.input.jobId === "string"
          ? receipt.input.jobId
          : queueJobs.current.get(String(receipt.input.queueId || ""));
      if (id) changed.add(id);
    }
    if (!hasCapability(connection, "ci.job")) return;
    const captured = targetKey,
      scope = jobScopeEpoch.current;
    for (const jobId of changed) {
      if (selectedJob?.id === jobId) continue; // Selected details already read only this job every five seconds.
      const version = (jobReadVersions.current.get(jobId) || 0) + 1;
      jobReadVersions.current.set(jobId, version);
      void opsCall("ops.query", {
        projectId,
        connectionId: connection.id,
        expectedTargetHash: connection.targetHash,
        expectedAuthGeneration: connection.authGeneration,
        operation: "ci.job",
        input: { jobId },
      })
        .then((result) => {
          if (
            targetRef.current !== captured ||
            jobScopeEpoch.current !== scope ||
            jobReadVersions.current.get(jobId) !== version
          )
            return;
          const { builds, description, ...job } = result.data;
          patchJob(job);
        })
        .catch((e) => {
          if (targetRef.current === captured && jobScopeEpoch.current === scope)
            setError("Не удалось обновить джобу: " + opsErrorText(e));
        });
    }
  }, [snapshot.receipts, targetKey, snapshotReady]);
  const action = async (
    operation: OpsActionOperation,
    input: Record<string, OpsValue>,
  ): Promise<OpsReceipt | undefined> => {
    if (!projectId || !connection || actionLock.current) return;
    const captured = targetKey;
    actionLock.current = true;
    setActionBusy(true);
    setError("");
    try {
      const prepared = await opsCall("ops.prepare", {
        projectId,
        connectionId: connection.id,
        expectedTargetHash: connection.targetHash,
        expectedAuthGeneration: connection.authGeneration,
        operation,
        input,
        operationId: crypto.randomUUID(),
      });
      const receipt: OpsReceipt = await opsCall("ops.execute", {
        projectId,
        preparedActionId: prepared.id,
      });
      if (targetRef.current === captured) {
        await refresh();
        void queue.refresh();
        refreshJobs();
      }
      return receipt;
    } catch (e) {
      if (targetRef.current === captured) setError(opsErrorText(e));
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  };
  const favorite = async (job: OpsJenkinsJob) => {
    if (!connection || !projectId) return;
    const captured = targetKey;
    try {
      await opsCall("ops.favorite", {
        projectId,
        connectionId: connection.id,
        jobId: job.id,
        enabled: !favorites.has(job.id),
      });
      if (targetRef.current === captured) await refresh();
    } catch (e) {
      if (targetRef.current === captured) setError(opsErrorText(e));
    }
  };
  const selectJob = (
    job: OpsJenkinsJob,
    number?: number,
    fromReveal = false,
  ) => {
    if (!connection) return;
    if (!fromReveal) cancelReveal();
    if (job.folder) {
      setFolder(job.fullName);
      setCursor(undefined);
      setSearch("");
      return;
    }
    setSelected({
      connectionId: connection.id,
      targetHash: connection.targetHash,
      job,
    });
    setBuild(number);
  };
  const handledReveal = useRef<number | undefined>(undefined);
  useEffect(() => {
    const request = reveal?.payload;
    if (
      !reveal ||
      !request ||
      handledReveal.current === reveal.nonce ||
      request?.projectId !== projectId ||
      request.kind === "cluster" ||
      !snapshotReady ||
      snapshotLoading
    )
      return;
    const capturedConnection = request.connectionId
      ? connections.find((value) => value.id === request.connectionId)
      : connection;
    if (!capturedConnection) {
      handledReveal.current = reveal.nonce;
      setError(
        "Запрошенное подключение Jenkins недоступно в выбранном проекте.",
      );
      return;
    }
    if (connection?.id !== capturedConnection.id) {
      setChoices((old) => ({
        ...old,
        [projectId || ""]: capturedConnection.id,
      }));
      return;
    }
    handledReveal.current = reveal.nonce;
    if (!request.jobId) return;
    const captured = targetKey,
      epoch = ++revealEpoch.current,
      nonce = reveal.nonce;
    const isCurrent = () =>
      targetRef.current === captured &&
      revealEpoch.current === epoch &&
      latestReveal.current === nonce;
    setError("");
    void opsCall("ops.query", {
      projectId,
      connectionId: capturedConnection.id,
      expectedTargetHash: capturedConnection.targetHash,
      expectedAuthGeneration: capturedConnection.authGeneration,
      operation: "ci.job",
      input: { jobId: request.jobId },
    })
      .then((result) => {
        if (!isCurrent()) return;
        selectJob(result.data, request.number ?? request.target?.number, true);
        setTab("jobs");
      })
      .catch((e) => {
        if (isCurrent()) setError("Джоба не открыта: " + opsErrorText(e));
      });
  }, [
    reveal,
    projectId,
    snapshotReady,
    snapshotLoading,
    connection?.id,
    targetKey,
  ]);
  return (
    <section ref={panelRef} className="ops-panel" aria-label="Jenkins">
      <div className="ops-toolbar">
        <select
          className="ops-connection"
          aria-label="Подключение Jenkins"
          value={connection?.id || ""}
          onChange={(e) => {
            cancelReveal();
            setChoices((old) => ({
              ...old,
              [projectId || ""]: e.target.value,
            }));
            setSelected(undefined);
            setBuild(undefined);
          }}
        >
          <option value="" disabled>
            Выберите подключение
          </option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {connection?.environment && (
          <span
            className="ops-environment"
            data-production={/prod|прод/i.test(connection.environment)}
            title={connection.url}
          >
            {connection.environment}
          </span>
        )}
        <span className="ops-spacer" />
        <span className="ops-freshness" title="Время последнего ответа Jenkins">
          {observedAt(jobsQuery.value?.observedAt)}
        </span>
        <IconButton
          icon="reload"
          label="Обновить Jenkins"
          disabled={!connection || jobsQuery.loading}
          onClick={() => {
            refreshJobs();
            void queue.refresh();
            void refresh();
          }}
        />
        <IconButton
          icon="settings"
          label="Настроить Jenkins"
          onClick={onSettings}
        />
      </div>
      <OpsErrorBox
        message={error || snapshotError}
        dismiss={() => setError("")}
      />
      {!projectId ? (
        <OpsEmpty title="Выберите проект">
          Подключения и действия привязаны к проекту.
        </OpsEmpty>
      ) : !connection ? (
        <OpsEmpty title="Подключите Jenkins" action={onSettings}>
          Добавьте контроллер один раз и назначьте его нужным проектам.
        </OpsEmpty>
      ) : !connection.discovered ? (
        <OpsEmpty
          title="Проверьте подключение"
          action={() => {
            void opsCall("ops.connection.probe", {
              connectionId: connection.id,
              expectedTargetHash: connection.targetHash,
              expectedAuthGeneration: connection.authGeneration,
            })
              .then(refresh)
              .catch((e) => setError(opsErrorText(e)));
          }}
          label="Проверить и получить возможности"
        >
          Список джоб появится после настоящего discovery MCP.
        </OpsEmpty>
      ) : (
        <>
          <div className="ops-tabs" role="tablist" aria-label="Раздел Jenkins">
            {[
              ["jobs", "Джобы"],
              [
                "queue",
                `Очередь${queue.value?.data.items.length ? " · " + queue.value.data.items.length : ""}`,
              ],
              ["history", "История запусков"],
            ].map(([id, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === id}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ops-content">
            <div
              className="ops-master"
              style={focusedDetail ? { display: "none" } : undefined}
            >
              {tab === "jobs" && (
                <>
                  <div className="ops-filters">
                    <input
                      type="search"
                      aria-label="Поиск джоб во всём контроллере"
                      placeholder="Имя или полный путь"
                      value={search}
                      onChange={(e) => {
                        cancelReveal();
                        setSearch(e.target.value);
                      }}
                    />
                    <button
                      type="button"
                      className="ops-only-favorites"
                      aria-pressed={!!onlyFavorites[connection.id]}
                      onClick={() => {
                        cancelReveal();
                        setCursor(undefined);
                        setOnlyFavorites((old) => ({
                          ...old,
                          [connection.id]: !old[connection.id],
                        }));
                      }}
                    >
                      Избранные · {favorites.size}
                    </button>
                  </div>
                  <div className="ops-breadcrumb" aria-label="Папка Jenkins">
                    <button
                      type="button"
                      onClick={() => {
                        cancelReveal();
                        setFolder("");
                        setCursor(undefined);
                      }}
                    >
                      Корень
                    </button>
                    {folder
                      .split("/")
                      .filter(Boolean)
                      .map((part, i, parts) => (
                        <button
                          type="button"
                          key={parts.slice(0, i + 1).join("/")}
                          onClick={() => {
                            cancelReveal();
                            setFolder(parts.slice(0, i + 1).join("/"));
                            setCursor(undefined);
                          }}
                        >
                          {" "}
                          / {part}
                        </button>
                      ))}
                  </div>
                  <OpsErrorBox message={jobsQuery.error} retry={refreshJobs} />
                  <div className="ops-count">
                    {filtered.length} из {jobs.length} загруженных
                    {jobsQuery.loading ? " · загрузка…" : ""}
                    {jobsQuery.value?.hasMore
                      ? " · каталог неполный; доступны следующие страницы"
                      : jobsQuery.value?.data.complete === false
                        ? " · каталог ограничен; уточните поиск или папку"
                        : recursive
                          ? " · весь контроллер"
                          : " · текущая папка"}
                  </div>
                  {!!jobsQuery.value?.warnings.length && (
                    <div className="ops-notice warn" role="status">
                      {jobsQuery.value.warnings.join(" ")}
                    </div>
                  )}
                  {!hasCapability(connection, "ci.jobs") ? (
                    <OpsEmpty title="Каталог джоб недоступен">
                      MCP не предоставляет ci.jobs. Настройте mapping по
                      реальным инструментам.
                    </OpsEmpty>
                  ) : !filtered.length &&
                    !jobsQuery.loading &&
                    !jobsQuery.error ? (
                    <OpsEmpty
                      title={
                        onlyFavorites[connection.id]
                          ? "Избранные джобы не найдены"
                          : search
                            ? "Джобы не найдены"
                            : "В папке нет джоб"
                      }
                      action={
                        search || onlyFavorites[connection.id]
                          ? () => {
                              setSearch("");
                              setOnlyFavorites((old) => ({
                                ...old,
                                [connection.id]: false,
                              }));
                            }
                          : undefined
                      }
                      label="Показать все"
                    >
                      {onlyFavorites[connection.id]
                        ? "Избранное общее для всех проектов этого подключения. Отметьте нужные джобы звёздочкой."
                        : "Откройте другую папку или обновите список."}
                    </OpsEmpty>
                  ) : (
                    <div className="ops-table-wrap">
                      <table className="ops-table" aria-label="Джобы Jenkins">
                        <thead>
                          <tr>
                            <th aria-label="Избранное" />
                            <th>Джоба / папка</th>
                            <th>Последняя</th>
                            <th className="ops-optional">Время</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((job) => (
                            <tr
                              key={job.id}
                              aria-selected={selectedJob?.id === job.id}
                            >
                              <td className="ops-star-cell">
                                {!job.folder && (
                                  <OpsStar
                                    enabled={favorites.has(job.id)}
                                    label={`${favorites.has(job.id) ? "Убрать из избранного" : "В избранное"}: ${job.fullName}`}
                                    onClick={() => void favorite(job)}
                                  />
                                )}
                              </td>
                              <td className="ops-name">
                                <button
                                  type="button"
                                  onClick={() => selectJob(job)}
                                  title={job.fullName}
                                >
                                  {job.folder && (
                                    <Icon name="folder" size={13} />
                                  )}{" "}
                                  {job.name || job.fullName}
                                </button>
                                <small>
                                  {job.fullName}
                                  {job.disabled
                                    ? " · отключена"
                                    : job.inQueue
                                      ? " · в очереди"
                                      : ""}
                                </small>
                              </td>
                              <td>
                                {job.lastBuild ? (
                                  <button
                                    type="button"
                                    className="ops-build-link"
                                    onClick={() =>
                                      selectJob(job, job.lastBuild!.number)
                                    }
                                  >
                                    #{job.lastBuild.number}{" "}
                                    <OpsBadge
                                      status={
                                        job.lastBuild.building
                                          ? "running"
                                          : job.lastBuild.result
                                      }
                                    />
                                  </button>
                                ) : (
                                  <span className="ops-muted">
                                    {job.folder ? "Папка" : "Не запускалась"}
                                  </span>
                                )}
                              </td>
                              <td className="ops-optional ops-muted">
                                {elapsed(job.lastBuild?.duration)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {jobsQuery.value?.hasMore && jobsQuery.value.cursor && (
                        <button
                          type="button"
                          className="ops-load-more"
                          disabled={jobsQuery.loading}
                          onClick={() => setCursor(jobsQuery.value!.cursor)}
                        >
                          Загрузить ещё
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {tab === "queue" && (
                <>
                  <OpsErrorBox
                    message={queue.error}
                    retry={() => void queue.refresh()}
                  />
                  {!hasCapability(connection, "ci.queue") ? (
                    <OpsEmpty title="Очередь недоступна">
                      MCP не предоставляет чтение очереди.
                    </OpsEmpty>
                  ) : !queue.value?.data.items.length ? (
                    <OpsEmpty
                      title={
                        queue.loading
                          ? "Загружается очередь…"
                          : queue.error
                            ? "Очередь не получена"
                            : "Очередь пуста"
                      }
                    >
                      Фильтр избранного не скрывает активные запуски.
                    </OpsEmpty>
                  ) : (
                    <div className="ops-table-wrap">
                      <table className="ops-table" aria-label="Очередь Jenkins">
                        <thead>
                          <tr>
                            <th>Джоба</th>
                            <th>Очередь</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {queue.value.data.items.map((item) => (
                            <tr key={item.id}>
                              <td className="ops-name">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const job = jobs.find(
                                      (j) => j.fullName === item.task.fullName,
                                    );
                                    selectJob(
                                      job ||
                                        identityJob(
                                          item.task.fullName || item.task.name,
                                        ),
                                      item.executable?.number,
                                    );
                                  }}
                                >
                                  {item.task.fullName || item.task.name}
                                </button>
                                <small>
                                  {item.why ||
                                    (item.executable
                                      ? "Executor назначен"
                                      : "Ожидает executor")}
                                </small>
                              </td>
                              <td>
                                #{item.id}
                                {item.executable && (
                                  <small> → #{item.executable.number}</small>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  disabled={
                                    actionBusy ||
                                    !!item.executable ||
                                    !hasCapability(connection, "ci.queueCancel")
                                  }
                                  onClick={() =>
                                    void action("ci.queueCancel", {
                                      queueId: item.id,
                                    })
                                  }
                                >
                                  Отменить очередь
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {tab === "history" && (
                <>
                  <div className="ops-notice">
                    Запуски из GigaCode. Полная история Jenkins доступна в
                    карточке каждой джобы. Избранное не ограничивает этот
                    список.
                  </div>
                  {!receipts.length ? (
                    <OpsEmpty title="Пока нет запусков из GigaCode" />
                  ) : (
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Джоба / действие</th>
                            <th>Результат</th>
                            <th>Время</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...receipts].reverse().map((r) => (
                            <tr key={r.id}>
                              <td className="ops-name">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const id = String(r.input.jobId || "");
                                    const job = jobs.find(
                                      (j) => j.id === id || j.fullName === id,
                                    );
                                    if (id)
                                      selectJob(
                                        job || identityJob(id),
                                        r.data &&
                                          typeof r.data === "object" &&
                                          !Array.isArray(r.data) &&
                                          typeof r.data.number === "number"
                                          ? r.data.number
                                          : undefined,
                                      );
                                  }}
                                >
                                  {String(
                                    r.input.jobId ||
                                      r.input.queueId ||
                                      r.operation,
                                  )}
                                </button>
                                <small>{r.remoteId || r.operationId}</small>
                              </td>
                              <td>
                                <OpsBadge status={r.status} />
                              </td>
                              <td>{observedAt(r.startedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
            {selectedJob && (
              <>
                {!focusedDetail && (
                  <OpsDivider
                    label="Изменить ширину сведений Jenkins"
                    onResize={(delta) =>
                      setDetailWidth((w) =>
                        Math.max(290, Math.min(680, w - delta)),
                      )
                    }
                  />
                )}
                <div
                  className="ops-detail"
                  style={{
                    width: effectiveDetailWidth,
                    minWidth: focusedDetail ? 0 : undefined,
                  }}
                >
                  <JobView
                    key={targetKey + ":" + selectedJob.id}
                    projectId={projectId}
                    connection={connection}
                    job={selectedJob}
                    onJobUpdate={patchJob}
                    initialBuild={build}
                    visible={visible}
                    action={action}
                    busy={actionBusy}
                    onClose={() => {
                      cancelReveal();
                      setSelected(undefined);
                      setBuild(undefined);
                    }}
                    onAssist={
                      sessionId && onAssist
                        ? () =>
                            onAssist(
                              `Проанализируй Jenkins ${connection.name}, джобу ${selectedJob.fullName}${build !== undefined ? ", сборку #" + build : ""}. Connection ID: ${connection.id}. Используй реальные логи и readback; не повторяй неизвестный trigger.`,
                            )
                        : undefined
                    }
                  />
                </div>
              </>
            )}
          </div>
          <OpsReceipts
            receipts={receipts}
            projectId={projectId}
            refresh={refresh}
          />
        </>
      )}
    </section>
  );
}

function JobView({
  projectId,
  connection,
  job,
  initialBuild,
  visible,
  action,
  busy,
  onClose,
  onAssist,
  onJobUpdate,
}: {
  projectId: string;
  connection: OpsConnection;
  onJobUpdate: (job: OpsJenkinsJob) => void;
  job: OpsJenkinsJob;
  initialBuild?: number;
  visible: boolean;
  action: (
    op: OpsActionOperation,
    input: Record<string, OpsValue>,
  ) => Promise<OpsReceipt | undefined>;
  busy: boolean;
  onClose: () => void;
  onAssist?: () => void;
}) {
  const detail = useOpsQuery<JobDetail>(
    projectId,
    connection,
    "ci.job",
    { jobId: job.id },
    hasCapability(connection, "ci.job"),
    visible ? 5000 : 0,
  );
  const current = detail.value?.data || job;
  const updateJob = useRef(onJobUpdate);
  updateJob.current = onJobUpdate;
  useEffect(() => {
    if (detail.value) {
      const { builds, description, ...actual } = detail.value.data;
      updateJob.current(actual);
    }
  }, [detail.value]);
  const [tab, setTab] = useState(initialBuild !== undefined ? "build" : "job"),
    [number, setNumber] = useState<number | undefined>(initialBuild),
    [values, setValues] = useState<Record<string, OpsValue>>({}),
    [loadedParameters, setLoadedParameters] = useState(false);
  useEffect(() => {
    if (initialBuild !== undefined) {
      setNumber(initialBuild);
      setTab("build");
    }
  }, [initialBuild]);
  useEffect(() => {
    if (!detail.value || loadedParameters) return;
    setValues(
      Object.fromEntries(
        (current.parameters || [])
          .filter((p) =>
            Object.prototype.hasOwnProperty.call(p, "defaultValue"),
          )
          .map((p) => [p.name, p.defaultValue!]),
      ),
    );
    setLoadedParameters(true);
  }, [detail.value, loadedParameters]);
  const parameters = current.parameters || [];
  const unsupported = parameters.filter((p) => !p.supported);
  return (
    <>
      <div className="ops-detail-head">
        <div>
          <strong title={current.fullName}>{current.name}</strong>
          <small>
            {connection.name} / {current.fullName}
          </small>
        </div>
        {onAssist && (
          <IconButton
            icon="chat"
            label="Обсудить джобу с агентом"
            onClick={onAssist}
          />
        )}
        <IconButton
          icon="close"
          label="Закрыть сведения о джобе"
          onClick={onClose}
        />
      </div>
      <div className="ops-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "job"}
          onClick={() => setTab("job")}
        >
          Джоба
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "build"}
          onClick={() => setTab("build")}
        >
          Сборка{number !== undefined ? " #" + number : ""}
        </button>
      </div>
      <OpsErrorBox message={detail.error} retry={() => void detail.refresh()} />
      {tab === "job" ? (
        <div className="ops-detail-body">
          <dl className="ops-facts">
            <dt>Тип</dt>
            <dd>{current.kind}</dd>
            <dt>Последняя</dt>
            <dd>
              {current.lastBuild ? (
                <>
                  #{current.lastBuild.number} ·{" "}
                  <OpsBadge
                    status={
                      current.lastBuild.building
                        ? "running"
                        : current.lastBuild.result
                    }
                  />
                </>
              ) : (
                "Нет сборок"
              )}
            </dd>
          </dl>
          {detail.value?.data.description && (
            <p className="ops-muted">
              {detail.value.data.description.replace(/<[^>]*>/g, " ")}
            </p>
          )}
          {current.disabled && (
            <p className="ops-notice">Джоба отключена на контроллере.</p>
          )}
          <form
            className="ops-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action("ci.trigger", {
                jobId: current.id,
                parameters: values,
              });
            }}
          >
            <h3 className="ops-section-label">Запуск</h3>
            {parameters.map((parameter) => (
              <ParameterField
                key={parameter.name}
                parameter={parameter}
                value={values[parameter.name]}
                onChange={(value) =>
                  setValues((old) => ({ ...old, [parameter.name]: value }))
                }
              />
            ))}
            {unsupported.length > 0 && (
              <p className="ops-notice warn">
                Запуск недоступен: адаптер не поддерживает параметры{" "}
                {unsupported.map((p) => `${p.name} (${p.type})`).join(", ")}.
                Значения не будут выдуманы или пропущены.
              </p>
            )}
            {!parameters.length && (
              <p className="ops-muted">
                {detail.value
                  ? "Параметры не требуются."
                  : "Проверяется схема параметров…"}
              </p>
            )}
            <button
              type="submit"
              className="primary"
              disabled={
                busy ||
                current.disabled ||
                !current.runnable ||
                !detail.value ||
                unsupported.length > 0 ||
                !hasCapability(connection, "ci.trigger")
              }
            >
              {busy ? "Отправляется…" : "Запустить"}
            </button>
            {!hasCapability(connection, "ci.trigger") && (
              <small className="ops-muted">
                Запуск не предоставлен текущим MCP binding.
              </small>
            )}
          </form>
          <h3 className="ops-section-label" style={{ marginTop: 20 }}>
            Последние сборки
          </h3>
          {detail.value?.data.builds?.length ? (
            <ul className="ops-history-list">
              {detail.value.data.builds.map((run) => (
                <li key={run.number}>
                  <button
                    type="button"
                    onClick={() => {
                      setNumber(run.number);
                      setTab("build");
                    }}
                  >
                    <span>
                      #{run.number} · {elapsed(run.duration)}
                    </span>
                    <OpsBadge status={run.building ? "running" : run.result} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-muted">История сборок ещё не получена.</p>
          )}
        </div>
      ) : (
        <RunView
          key={String(number)}
          projectId={projectId}
          connection={connection}
          jobId={current.id}
          number={number}
          visible={visible}
          action={action}
          busy={busy}
        />
      )}
    </>
  );
}
function ParameterField({
  parameter: p,
  value,
  onChange,
}: {
  parameter: OpsJenkinsParameter;
  value?: OpsValue;
  onChange: (v: OpsValue) => void;
}) {
  const boolean = /bool/i.test(p.type);
  if (boolean)
    return (
      <label className="ops-checkbox">
        <input
          type="checkbox"
          checked={value === true}
          disabled={!p.supported}
          onChange={(e) => onChange(e.target.checked)}
        />
        {p.name}
        {p.description && (
          <small title={p.description}> · {p.description}</small>
        )}
      </label>
    );
  return (
    <label className="ops-field">
      <span>{p.name}</span>
      {p.choices ? (
        <select
          value={typeof value === "string" ? value : ""}
          disabled={!p.supported}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Выберите значение
          </option>
          {p.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : /text/i.test(p.type) ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          disabled={!p.supported}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={/password/i.test(p.type) ? "password" : "text"}
          autoComplete="off"
          value={value == null ? "" : String(value)}
          disabled={!p.supported}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <small>{p.description || p.type}</small>
    </label>
  );
}
function RunView({
  projectId,
  connection,
  jobId,
  number,
  visible,
  action,
  busy,
}: {
  projectId: string;
  connection: OpsConnection;
  jobId: string;
  number?: number;
  visible: boolean;
  action: (
    op: OpsActionOperation,
    input: Record<string, OpsValue>,
  ) => Promise<OpsReceipt | undefined>;
  busy: boolean;
}) {
  const run = useOpsQuery<Build>(
    projectId,
    connection,
    "ci.run",
    { jobId, number },
    hasCapability(connection, "ci.run"),
    visible ? 3000 : 0,
  );
  const [tab, setTab] = useState("logs");
  const extra = useOpsQuery<any>(
    projectId,
    connection,
    `ci.${tab}`,
    { jobId, number: run.value?.data.number },
    tab !== "logs" && !!run.value && hasCapability(connection, `ci.${tab}`),
    0,
  );
  return (
    <>
      <OpsErrorBox message={run.error} retry={() => void run.refresh()} />
      {run.value && (
        <div className="ops-code-tools">
          <strong>#{run.value.data.number}</strong>
          <OpsBadge
            status={run.value.data.building ? "running" : run.value.data.result}
          />
          <span className="ops-spacer" />
          <span className="ops-muted">{elapsed(run.value.data.duration)}</span>
          {run.value.data.building && (
            <button
              type="button"
              disabled={busy || !hasCapability(connection, "ci.stop")}
              onClick={() =>
                void action("ci.stop", {
                  jobId,
                  number: run.value!.data.number,
                })
              }
            >
              Остановить сборку
            </button>
          )}
        </div>
      )}
      <div className="ops-tabs" role="tablist" aria-label="Данные сборки">
        {[
          ["logs", "Лог"],
          ["stages", "Этапы"],
          ["tests", "Тесты"],
          ["artifacts", "Артефакты"],
        ].map(([id, label]) => (
          <button
            type="button"
            role="tab"
            key={id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!run.value ? (
        <OpsEmpty
          title={run.loading ? "Загружается сборка…" : "Сборка не получена"}
        />
      ) : !hasCapability(connection, `ci.${tab}`) ? (
        <OpsEmpty title="Возможность недоступна">
          {tab === "stages"
            ? "MCP не обнаружил API этапов pipeline. Отсутствие этапов не означает успешную сборку."
            : `Текущий binding не предоставляет ci.${tab}.`}
        </OpsEmpty>
      ) : tab === "logs" ? (
        <JenkinsLog
          projectId={projectId}
          connection={connection}
          jobId={jobId}
          number={run.value.data.number}
          running={run.value.data.building}
          visible={visible}
        />
      ) : (
        <div className="ops-detail-body">
          <OpsErrorBox
            message={extra.error}
            retry={() => void extra.refresh()}
          />
          {extra.value ? (
            tab === "stages" && Array.isArray(extra.value.data?.stages) ? (
              <div className="ops-stage-list">
                {extra.value.data.stages.map((stage: any, i: number) => (
                  <div className="ops-stage" key={stage.id || i}>
                    <strong>{String(stage.name || stage.id || "Этап")}</strong>
                    <OpsBadge status={String(stage.status || "unknown")} />
                    <small>{elapsed(stage.durationMillis)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <OpsCode
                text={JSON.stringify(extra.value.data, null, 2)}
                label={
                  tab === "tests" ? "Реальный отчёт тестов" : "Данные Jenkins"
                }
              />
            )
          ) : (
            <OpsEmpty
              title={extra.loading ? "Загружается…" : "Данные не получены"}
            />
          )}
        </div>
      )}
    </>
  );
}
function JenkinsLog({
  projectId,
  connection,
  jobId,
  number,
  running,
  visible,
}: {
  projectId: string;
  connection: OpsConnection;
  jobId: string;
  number: number;
  running: boolean;
  visible: boolean;
}) {
  const [cursor, setCursor] = useState<string>(),
    [text, setText] = useState(""),
    [follow, setFollow] = useState(true),
    [search, setSearch] = useState(""),
    [trimmed, setTrimmed] = useState(false);
  const query = useOpsQuery<OpsLogPage>(
    projectId,
    connection,
    "ci.logs",
    { jobId, number, cursor },
    true,
    follow && running && visible ? 2000 : 0,
  );
  const consumed = useRef<OpsLogPage | undefined>(undefined),
    nextCursor = useRef<string | undefined>(undefined),
    buffer = useRef(""),
    consoleNotes = useRef({ pending: "", hidden: false }),
    viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = query.value?.data;
    if (!page || consumed.current === page) return;
    consumed.current = page;
    const next =
      buffer.current + stripJenkinsConsoleText(page.text, consoleNotes.current);
    let retained = next.slice(-256 * 1024);
    if (retained.length && /[\uDC00-\uDFFF]/.test(retained[0]))
      retained = retained.slice(1);
    buffer.current = retained;
    setText(retained);
    if (next.length > retained.length) setTrimmed(true);
    nextCursor.current = page.cursor;
    if (
      follow &&
      visible &&
      page.cursor &&
      page.cursor !== cursor &&
      (page.text.length > 0 || page.hasMore)
    )
      setCursor(page.cursor);
  }, [query.value]);
  useEffect(() => {
    if (
      follow &&
      visible &&
      nextCursor.current &&
      nextCursor.current !== cursor
    )
      setCursor(nextCursor.current);
  }, [follow, visible]);
  const readNext = () => {
    if (nextCursor.current && nextCursor.current !== cursor)
      setCursor(nextCursor.current);
    else void query.refresh();
  };
  useEffect(() => {
    if (follow && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [text, follow]);
  const plain = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""),
    filtered = search
      ? plain
          .split("\n")
          .filter((line) => line.toLowerCase().includes(search.toLowerCase()))
          .join("\n")
      : plain;
  return (
    <div className="ops-log">
      <div className="ops-code-tools">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Поиск в загруженном логе"
          placeholder="Найти в логе"
        />
        <button
          type="button"
          aria-pressed={follow}
          onClick={() => setFollow((v) => !v)}
        >
          {follow ? "Пауза" : "Следить"}
        </button>
        <IconButton
          icon="reload"
          label="Прочитать следующую порцию лога"
          disabled={query.loading}
          onClick={readNext}
        />
      </div>
      <OpsErrorBox message={query.error} retry={readNext} />
      {trimmed && (
        <p className="ops-notice">
          Ранние строки скрыты: буфер просмотра ограничен 262 144 символами.
        </p>
      )}
      <div className="ops-scroll" ref={viewport}>
        <OpsCode
          text={
            filtered ||
            (search && text
              ? "Нет совпадений"
              : query.loading
                ? "Читается лог…"
                : query.error
                  ? "Лог не получен"
                  : "Лог пуст")
          }
          language="log"
          label={`Лог Jenkins ${jobId} #${number}`}
        />
      </div>
      {query.value?.data.truncated && (
        <p className="ops-notice">
          Ответ сервера ограничен. Продолжите чтение следующей порции.
        </p>
      )}
    </div>
  );
}

/** Identity comes from a real queue/receipt; details are always fetched before launch. */
function identityJob(fullName: string): OpsJenkinsJob {
  return {
    id: fullName,
    fullName,
    name: fullName.split("/").at(-1) || fullName,
    kind: "Загрузка…",
    url: "",
    disabled: false,
    folder: false,
    runnable: false,
    parameters: [],
  };
}
