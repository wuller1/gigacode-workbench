import { useEffect, useId, useRef, useState } from "react";
import { parseDocument, stringify } from "yaml";
import type {
  OpsClusterResourceType,
  OpsConnection,
  OpsLogPage,
  OpsValue,
} from "../shared/operations";
import { useStored } from "./api";
import { IconButton, Menu, useAsk } from "./ui";
import { registerWindowClose } from "./window-close";
import {
  hasCapability,
  observedAt,
  opsCall,
  opsErrorText,
  opsFailure,
  OpsActionReview,
  OpsBadge,
  OpsCode,
  OpsDivider,
  OpsEmpty,
  OpsErrorBox,
  OpsReceipts,
  OpsYamlEditor,
  useOpsQuery,
  useOpsSnapshot,
  useOpsPanelWidth,
  type OpsActionRequest,
  type OpsPanelProps,
} from "./ops-ui";

type KubeObject = {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    [key: string]: unknown;
  };
  spec?: any;
  status?: any;
  workbenchMetadataOnly?: boolean;
  [key: string]: any;
};
type KubeList = {
  items: KubeObject[];
  metadata?: { continue?: string; resourceVersion?: string };
};
const resourceKey = (type: OpsClusterResourceType) =>
  `${type.group}/${type.version}/${type.resource}`;
function category(type: OpsClusterResourceType) {
  if (
    [
      "envoyfilters",
      "destinationrules",
      "virtualservices",
      "gateways",
      "serviceentries",
      "peerauthentications",
      "authorizationpolicies",
    ].includes(type.resource) &&
    /istio/.test(type.group)
  )
    return "Service Mesh";
  if (
    [
      "deployments",
      "statefulsets",
      "daemonsets",
      "replicasets",
      "jobs",
      "cronjobs",
      "replicationcontrollers",
      "deploymentconfigs",
    ].includes(type.resource)
  )
    return "Workloads";
  if (type.resource === "pods") return "Pods";
  if (
    /^(services|endpoints|endpointslices|ingresses|routes|networkpolicies)$/.test(
      type.resource,
    )
  )
    return "Сеть";
  if (/persistentvolume|storageclass|volumesnapshot/.test(type.resource))
    return "Хранилища";
  if (/^(configmaps|secrets|resourcequotas|limitranges)$/.test(type.resource))
    return "Конфигурация";
  if (/role|serviceaccount|securitycontextconstraint/.test(type.resource))
    return "Доступы";
  if (
    /operator|subscription|installplan|customresourcedefinition/.test(
      type.resource,
    )
  )
    return "Операторы и CRD";
  if (/^(builds|buildconfigs|imagestreams)$/.test(type.resource))
    return "Сборки и образы";
  if (!type.namespaced) return "Кластер";
  return "Другие ресурсы";
}
const categoryOrder = [
  "Workloads",
  "Pods",
  "Сеть",
  "Service Mesh",
  "Хранилища",
  "Конфигурация",
  "Доступы",
  "Сборки и образы",
  "Операторы и CRD",
  "Кластер",
  "Другие ресурсы",
];
function resourceStatus(object: KubeObject) {
  const status = object.status;
  if (typeof status?.phase === "string") return status.phase;
  const condition = status?.conditions?.find((c: any) =>
    ["Available", "Ready"].includes(c.type),
  );
  if (condition)
    return condition.status === "True"
      ? condition.type
      : condition.reason || "Не готов";
  return "—";
}
function age(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return minutes < 60
    ? `${minutes} мин`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)} ч`
      : `${Math.floor(minutes / 1440)} д`;
}

export function ClusterPanel({
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
    "workbench.ops.cluster.connections.v1",
    {},
  );
  const connections = snapshot.connections.filter(
    (c) =>
      ["kubernetes", "openshift"].includes(c.kind) &&
      c.enabled &&
      (!projectId || c.projectIds.includes(projectId)),
  );
  const connection =
    connections.find((c) => c.id === choices[projectId || ""]) ||
    connections[0];
  const { ref: panelRef, width: panelWidth } = useOpsPanelWidth();
  const [navFlyout, setNavFlyout] = useState(false),
    [detailFocused, setDetailFocused] = useState(true);
  const navLayer = useRef<HTMLElement | null>(null);
  const [namespace, setNamespace] = useState(""),
    [namespaceInput, setNamespaceInput] = useState(""),
    [selectedType, setSelectedType] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [nav, setNav] = useState(true),
    [navWidth, setNavWidth] = useState(200),
    [detailWidth, setDetailWidth] = useState(560),
    [error, setError] = useState("");
  const [creation, setCreation] = useState<{
    target: string;
    typeKey: string;
    namespace: string;
    name?: string;
  }>();
  const [selection, setSelection] = useState<{
      target: string;
      type: OpsClusterResourceType;
      object: KubeObject;
    }>(),
    [rows, setRows] = useState<{ key: string; items: KubeObject[] }>({
      key: "",
      items: [],
    });
  const target = JSON.stringify([
      projectId,
      connection?.id,
      connection?.targetHash,
      connection?.authGeneration,
    ]),
    targetRef = useRef(target);
  const namespaceListId = useId();
  targetRef.current = target;
  const revealEpoch = useRef(0),
    latestReveal = useRef(reveal?.nonce),
    lastRevealTarget = useRef(target);
  latestReveal.current = reveal?.nonce;
  if (lastRevealTarget.current !== target) {
    lastRevealTarget.current = target;
    ++revealEpoch.current;
  }
  const cancelReveal = () => {
    ++revealEpoch.current;
  };
  useEffect(() => {
    setNamespace("");
    setNamespaceInput("");
    setSelectedType("");
    setSelection(undefined);
    setCreation(undefined);
    setCursor(undefined);
    setSearch("");
    setError("");
  }, [target]);
  const discovery = useOpsQuery<{
    resources: OpsClusterResourceType[];
    version?: string;
  }>(
    projectId,
    connection,
    "cluster.discovery",
    {},
    hasCapability(connection, "cluster.discovery"),
  );
  const namespaces = useOpsQuery<KubeList>(
    projectId,
    connection,
    "cluster.namespaces",
    {},
    hasCapability(connection, "cluster.namespaces"),
  );
  const availableTypes = (discovery.value?.data.resources || []).filter(
    (t) => !t.resource.includes("/"),
  );
  const type =
    availableTypes.find((t) => resourceKey(t) === selectedType) ||
    availableTypes.find((t) => t.resource === "deployments") ||
    availableTypes.find((t) => t.resource === "pods") ||
    availableTypes[0];
  const listInput = {
    group: type?.group,
    version: type?.version,
    resource: type?.resource,
    namespace: type?.namespaced ? namespace : undefined,
    cursor,
    limit: 100,
  };
  const listing = useOpsQuery<KubeList>(
    projectId,
    connection,
    "cluster.list",
    listInput,
    !!type &&
      !selectedType.startsWith("missing:") &&
      hasCapability(connection, "cluster.list") &&
      type.verbs.includes("list"),
    visible && !cursor ? 8000 : 0,
  );
  const listKey = JSON.stringify([
    target,
    type && resourceKey(type),
    namespace,
  ]);
  useEffect(() => {
    if (!listing.value) return;
    setRows((old) => {
      const items = new Map(
        (cursor && old.key === listKey ? old.items : []).map((o) => [
          o.metadata.uid || `${o.metadata.namespace}/${o.metadata.name}`,
          o,
        ]),
      );
      for (const object of listing.value!.data.items)
        items.set(
          object.metadata.uid ||
            `${object.metadata.namespace}/${object.metadata.name}`,
          object,
        );
      return { key: listKey, items: [...items.values()] };
    });
  }, [listing.value, cursor, listKey]);
  const items = (rows.key === listKey ? rows.items : []).filter((o) =>
    `${o.metadata.name} ${o.metadata.namespace || ""} ${o.kind || type?.kind || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = selection?.target === target ? selection : undefined;
  const creatableTypes = availableTypes.filter(
    (t) => t.kind !== "Secret" && t.verbs.includes("create"),
  );
  const creationType =
    creation?.target === target
      ? creatableTypes.find((t) => resourceKey(t) === creation.typeKey)
      : undefined;
  const constrainedDetail = !!selected && !creationType && panelWidth < 900;
  const focusedDetail = constrainedDetail && detailFocused;
  const navAutoCollapsed = panelWidth < (selected || creationType ? 1100 : 560);
  const showNav = (nav && !navAutoCollapsed) || navFlyout;
  const effectiveDetailWidth = constrainedDetail
    ? panelWidth
    : Math.min(
        detailWidth,
        Math.max(
          310,
          panelWidth - (showNav && !navFlyout ? navWidth + 6 : 0) - 236,
        ),
      );
  useEffect(() => {
    if (!navFlyout) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        navLayer.current?.contains(target) ||
        target.closest?.(".ops-nav-toggle")
      )
        return;
      setNavFlyout(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavFlyout(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [navFlyout]);
  const receipts = snapshot.receipts.filter(
    (r) =>
      r.connectionId === connection?.id && r.operation.startsWith("cluster."),
  );
  const chooseType = (next: OpsClusterResourceType) => {
    cancelReveal();
    setNavFlyout(false);
    setCreation(undefined);
    setSelectedType(resourceKey(next));
    setSelection(undefined);
    setCursor(undefined);
    setSearch("");
  };
  const handledReveal = useRef<number | undefined>(undefined);
  useEffect(() => {
    const request = reveal?.payload;
    if (
      !reveal ||
      !request ||
      handledReveal.current === reveal.nonce ||
      request?.projectId !== projectId ||
      request.kind === "jenkins" ||
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
        "Запрошенное подключение кластера недоступно в выбранном проекте.",
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
    const requested = request.target;
    if (!requested?.resource) {
      handledReveal.current = reveal.nonce;
      return;
    }
    if (!discovery.value) {
      if (discovery.error) {
        handledReveal.current = reveal.nonce;
        setError(
          "Ресурс не открыт: discovery недоступен. " +
            opsErrorText(discovery.error),
        );
      }
      return;
    }
    const actualType = availableTypes.find(
      (value) =>
        value.resource === requested.resource &&
        (requested.group === undefined || value.group === requested.group) &&
        (!requested.version || value.version === requested.version),
    );
    handledReveal.current = reveal.nonce;
    if (!actualType) {
      setError("Запрошенный resource API не обнаружен; цель не открыта.");
      return;
    }
    const captured = target,
      epoch = ++revealEpoch.current,
      nonce = reveal.nonce;
    const isCurrent = () =>
      targetRef.current === captured &&
      revealEpoch.current === epoch &&
      latestReveal.current === nonce;
    const create = request.creation === true || requested.creation === true;
    const openCreation = () => {
      if (!isCurrent()) return;
      if (
        !creatableTypes.some(
          (value) => resourceKey(value) === resourceKey(actualType),
        )
      ) {
        setError(
          "Discovery не разрешает создание этого типа; Secret поддерживает только метаданные.",
        );
        return;
      }
      setSelection(undefined);
      setSelectedType(resourceKey(actualType));
      setCreation({
        target: captured,
        typeKey: resourceKey(actualType),
        namespace: requested.namespace || "",
        name: requested.name,
      });
    };
    if (!requested.name) {
      if (create) openCreation();
      return;
    }
    setError("");
    void opsCall("ops.query", {
      projectId,
      connectionId: capturedConnection.id,
      expectedTargetHash: capturedConnection.targetHash,
      expectedAuthGeneration: capturedConnection.authGeneration,
      operation: "cluster.get",
      input: {
        group: actualType.group,
        version: actualType.version,
        resource: actualType.resource,
        namespace: requested.namespace,
        name: requested.name,
      },
    })
      .then((result) => {
        if (!isCurrent()) return;
        setCreation(undefined);
        setSelectedType(resourceKey(actualType));
        setNamespace(requested.namespace || "");
        setNamespaceInput(requested.namespace || "");
        setCursor(undefined);
        setDetailFocused(true);
        setSelection({
          target: captured,
          type: actualType,
          object: result.data,
        });
        if (create)
          setError(
            "Объект с этим именем уже существует. Открыт его фактический исходник; новый черновик не применён.",
          );
      })
      .catch((e) => {
        if (!isCurrent()) return;
        if (create && opsFailure(e).kind === "not_found") openCreation();
        else setError("Ресурс не открыт: " + opsErrorText(e));
      });
  }, [
    reveal,
    projectId,
    snapshotReady,
    snapshotLoading,
    connection?.id,
    target,
    discovery.value,
    discovery.error,
  ]);
  const viewInteraction = revealEpoch.current;
  const ownsView = () =>
    targetRef.current === target && revealEpoch.current === viewInteraction;
  return (
    <section
      ref={panelRef}
      className="ops-panel"
      aria-label="Kubernetes и OpenShift"
    >
      <div className="ops-toolbar">
        <IconButton
          icon="panel-left"
          className="ops-nav-toggle"
          label={showNav ? "Скрыть виды ресурсов" : "Показать виды ресурсов"}
          onClick={() => {
            if (navAutoCollapsed) setNavFlyout((value) => !value);
            else setNav((value) => !value);
          }}
        />
        <select
          className="ops-connection"
          aria-label="Подключение кластера"
          value={connection?.id || ""}
          onChange={(e) => {
            cancelReveal();
            setChoices((old) => ({
              ...old,
              [projectId || ""]: e.target.value,
            }));
            setSelection(undefined);
          }}
        >
          <option value="" disabled>
            Выберите кластер
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
        <input
          aria-label="Namespace"
          list={namespaceListId}
          value={namespaceInput}
          placeholder={
            type && !type.namespaced ? "Весь кластер" : "Все namespaces"
          }
          title="Выберите namespace или введите точное имя и нажмите Enter"
          disabled={!!type && !type.namespaced}
          onChange={(e) => {
            cancelReveal();
            const value = e.target.value;
            setNamespaceInput(value);
            if (
              !value ||
              namespaces.value?.data.items.some(
                (n) => n.metadata.name === value,
              )
            ) {
              setNamespace(value);
              setCursor(undefined);
              setSelection(undefined);
            }
          }}
          onBlur={() => {
            if (namespaceInput !== namespace) {
              setNamespace(namespaceInput.trim());
              setCursor(undefined);
              setSelection(undefined);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setNamespace(namespaceInput.trim());
              setCursor(undefined);
              setSelection(undefined);
            }
          }}
        />
        <datalist id={namespaceListId}>
          {namespaces.value?.data.items.map((n) => (
            <option
              value={n.metadata.name}
              key={n.metadata.uid || n.metadata.name}
            />
          ))}
        </datalist>
        <button
          type="button"
          title="Создать ресурс из YAML; проверка API перед отправкой"
          disabled={
            !projectId ||
            !connection ||
            !creatableTypes.length ||
            !hasCapability(connection, "cluster.apply") ||
            !!discovery.error
          }
          onClick={() => {
            cancelReveal();
            const next =
              creatableTypes.find(
                (t) => type && resourceKey(t) === resourceKey(type),
              ) || creatableTypes[0];
            if (!next) return;
            setSelection(undefined);
            setCreation({ target, typeKey: resourceKey(next), namespace });
          }}
        >
          Создать
        </button>
        <span className="ops-spacer" />
        <span
          className="ops-freshness"
          title="Время последнего ответа кластера"
        >
          {observedAt(listing.value?.observedAt)}
        </span>
        <IconButton
          icon="reload"
          label="Обновить ресурсы"
          disabled={listing.loading}
          onClick={() => {
            void listing.refresh();
            void discovery.refresh();
            void namespaces.refresh();
          }}
        />
        <IconButton
          icon="settings"
          label="Настроить подключения кластеров"
          onClick={onSettings}
        />
      </div>
      <OpsErrorBox
        message={error || snapshotError}
        dismiss={() => setError("")}
      />
      {!projectId ? (
        <OpsEmpty title="Выберите проект" />
      ) : !connection ? (
        <OpsEmpty
          title="Подключите Kubernetes или OpenShift"
          action={onSettings}
        >
          Каждое подключение — точный API context. Одни подключения можно
          использовать в нескольких проектах; названия стендов задаются в
          настройках.
        </OpsEmpty>
      ) : !connection.discovered ? (
        <OpsEmpty
          title="Проверьте подключение"
          action={() => {
            const captured = target;
            void opsCall("ops.connection.probe", {
              connectionId: connection.id,
              expectedTargetHash: connection.targetHash,
              expectedAuthGeneration: connection.authGeneration,
            })
              .then(() => {
                if (targetRef.current === captured) return refresh();
              })
              .catch((e) => {
                if (targetRef.current === captured) setError(opsErrorText(e));
              });
          }}
          label="Проверить и получить возможности"
        >
          Список API и ресурсов определяется по настоящему discovery.
        </OpsEmpty>
      ) : (
        <>
          <OpsErrorBox
            message={discovery.error}
            retry={() => void discovery.refresh()}
          />
          <OpsErrorBox
            message={namespaces.error}
            retry={() => void namespaces.refresh()}
          />
          <div className="ops-content">
            {showNav && (
              <>
                <nav
                  ref={navLayer}
                  className={`ops-nav${navFlyout ? " ops-nav-flyout" : ""}`}
                  style={{ width: Math.min(navWidth, panelWidth - 20) }}
                  aria-label="Виды ресурсов Kubernetes"
                >
                  {categoryOrder.map((group) => {
                    const types = availableTypes.filter(
                      (t) => category(t) === group,
                    );
                    if (!types.length && group !== "Service Mesh") return null;
                    return (
                      <details
                        key={group}
                        open={
                          group === "Service Mesh" ||
                          group === (type && category(type))
                        }
                      >
                        <summary>{group}</summary>
                        {types.map((t) => (
                          <button
                            type="button"
                            key={resourceKey(t)}
                            aria-pressed={
                              type && resourceKey(type) === resourceKey(t)
                            }
                            onClick={() => chooseType(t)}
                            title={`${t.group || "core"}/${t.version} · ${t.resource}`}
                          >
                            <span>{t.kind}</span>
                            {!t.verbs.includes("list") && (
                              <small>нет list</small>
                            )}
                          </button>
                        ))}
                        {group === "Service Mesh" &&
                          ["EnvoyFilter", "DestinationRule"]
                            .filter(
                              (kind) => !types.some((t) => t.kind === kind),
                            )
                            .map((kind) => (
                              <button
                                type="button"
                                className="ops-missing"
                                key={kind}
                                disabled={!discovery.value || !!discovery.error}
                                title={
                                  discovery.value && !discovery.error
                                    ? "Этот resource API отсутствует в полученном discovery"
                                    : "Discovery не получен: наличие API пока неизвестно"
                                }
                                onClick={() => {
                                  cancelReveal();
                                  setSelectedType("missing:" + kind);
                                  setSelection(undefined);
                                }}
                                aria-pressed={
                                  selectedType === "missing:" + kind
                                }
                              >
                                <span>{kind}</span>
                                <small>
                                  {discovery.value && !discovery.error
                                    ? "нет API"
                                    : "неизвестно"}
                                </small>
                              </button>
                            ))}
                      </details>
                    );
                  })}
                </nav>
                {!navFlyout && (
                  <OpsDivider
                    label="Изменить ширину видов ресурсов"
                    onResize={(delta) =>
                      setNavWidth((w) =>
                        Math.max(165, Math.min(280, w + delta)),
                      )
                    }
                  />
                )}
              </>
            )}
            <div
              className="ops-master"
              style={focusedDetail ? { display: "none" } : undefined}
            >
              {creationType && creation && projectId && connection ? (
                <CreateResourceView
                  key={JSON.stringify([
                    "create",
                    target,
                    resourceKey(creationType),
                    creationType.namespaced ? creation.namespace : "",
                    creation.name || "",
                  ])}
                  projectId={projectId}
                  connection={connection}
                  type={creationType}
                  types={creatableTypes}
                  initialNamespace={creation.namespace}
                  initialName={creation.name}
                  namespaces={
                    namespaces.value?.data.items.map(
                      (item) => item.metadata.name,
                    ) || []
                  }
                  onTypeChange={(next) => {
                    if (!ownsView()) return;
                    cancelReveal();
                    setCreation((old) =>
                      old ? { ...old, typeKey: resourceKey(next) } : old,
                    );
                  }}
                  onClose={() => {
                    if (!ownsView()) return;
                    cancelReveal();
                    setCreation(undefined);
                  }}
                  onCreated={(object) => {
                    if (!ownsView()) return;
                    cancelReveal();
                    setCreation(undefined);
                    setSelectedType(resourceKey(creationType));
                    setNamespace(object.metadata.namespace || "");
                    setNamespaceInput(object.metadata.namespace || "");
                    setCursor(undefined);
                    setDetailFocused(true);
                    setSelection({ target, type: creationType, object });
                    void listing.refresh();
                    void refresh();
                  }}
                  onAssist={sessionId && onAssist ? onAssist : undefined}
                />
              ) : selectedType.startsWith("missing:") &&
                discovery.value &&
                !discovery.error ? (
                <OpsEmpty title={`${selectedType.slice(8)} не обнаружен`}>
                  API этого типа не найден в последнем discovery. Это не пустой
                  список и не разрешение установить CRD. Обновите discovery или
                  проверьте доступ.
                </OpsEmpty>
              ) : !hasCapability(connection, "cluster.discovery") ? (
                <OpsEmpty title="Discovery недоступен">
                  Настройте cluster.discovery по реальной схеме MCP.
                </OpsEmpty>
              ) : !type ? (
                <OpsEmpty
                  title={
                    discovery.loading
                      ? "Обнаруживаются API…"
                      : "Ресурсные API не получены"
                  }
                />
              ) : (
                <>
                  <div className="ops-filters">
                    <strong title={`${type.group || "core"}/${type.version}`}>
                      {type.kind}
                    </strong>
                    {listing.loading && (
                      <span className="ops-muted">Обновляется…</span>
                    )}
                    <input
                      type="search"
                      aria-label="Поиск загруженных ресурсов"
                      placeholder="Имя или namespace"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span className="ops-muted">{items.length}</span>
                  </div>
                  <OpsErrorBox
                    message={listing.error}
                    retry={() => void listing.refresh()}
                  />
                  {listing.error &&
                    rows.key === listKey &&
                    rows.items.length > 0 && (
                      <p className="ops-notice warn">
                        Показан прежний снимок. Действия требуют свежей
                        проверки.
                      </p>
                    )}
                  {!type.verbs.includes("list") ? (
                    <OpsEmpty title="Чтение списка недоступно">
                      Discovery не объявил list для {type.kind}.
                    </OpsEmpty>
                  ) : !items.length && !listing.loading && !listing.error ? (
                    <OpsEmpty
                      title={search ? "Совпадений нет" : "Ресурсов нет"}
                    >
                      {search
                        ? "Поиск работает по загруженным строкам."
                        : "Выберите другой namespace или обновите список."}
                    </OpsEmpty>
                  ) : (
                    <div className="ops-table-wrap">
                      <table
                        className="ops-table"
                        aria-label={`Ресурсы ${type.kind}`}
                      >
                        <thead>
                          <tr>
                            <th>Имя</th>
                            {type.namespaced && <th>Namespace</th>}
                            <th>Состояние</th>
                            <th className="ops-optional">Возраст</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((object) => (
                            <tr
                              key={
                                object.metadata.uid ||
                                `${object.metadata.namespace}/${object.metadata.name}`
                              }
                              aria-selected={
                                selected?.object.metadata.uid ===
                                  object.metadata.uid &&
                                selected?.object.metadata.name ===
                                  object.metadata.name
                              }
                            >
                              <td className="ops-name">
                                <button
                                  type="button"
                                  onClick={() => {
                                    cancelReveal();
                                    setDetailFocused(true);
                                    setSelection({ target, type, object });
                                  }}
                                >
                                  {object.metadata.name}
                                </button>
                                <small>
                                  {object.metadata.resourceVersion
                                    ? "rv " + object.metadata.resourceVersion
                                    : ""}
                                </small>
                              </td>
                              {type.namespaced && (
                                <td>{object.metadata.namespace}</td>
                              )}
                              <td>
                                <OpsBadge status={resourceStatus(object)} />
                                {typeof object.status?.readyReplicas ===
                                  "number" && (
                                  <small>
                                    {" "}
                                    · {object.status.readyReplicas}/
                                    {object.spec?.replicas ?? "—"}
                                  </small>
                                )}
                              </td>
                              <td className="ops-optional ops-muted">
                                {age(object.metadata.creationTimestamp)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(listing.value?.data.metadata?.continue ||
                        listing.value?.cursor) && (
                        <button
                          type="button"
                          className="ops-load-more"
                          disabled={listing.loading}
                          onClick={() =>
                            setCursor(
                              listing.value!.cursor ||
                                listing.value!.data.metadata?.continue,
                            )
                          }
                        >
                          Загрузить ещё
                        </button>
                      )}
                    </div>
                  )}
                  {(cursor || listing.value?.data.metadata?.continue) && (
                    <p className="ops-count">
                      Неполный снимок · поиск по загруженным строкам
                    </p>
                  )}
                </>
              )}
            </div>
            {selected && !creationType && (
              <>
                {!constrainedDetail && (
                  <OpsDivider
                    label="Изменить ширину сведений ресурса"
                    onResize={(delta) =>
                      setDetailWidth((w) =>
                        Math.max(310, Math.min(760, w - delta)),
                      )
                    }
                  />
                )}
                <div
                  className="ops-detail"
                  style={{
                    width: effectiveDetailWidth,
                    minWidth: constrainedDetail ? 0 : undefined,
                    display:
                      constrainedDetail && !detailFocused ? "none" : undefined,
                  }}
                >
                  <ResourceView
                    key={`${target}:${resourceKey(selected.type)}:${selected.object.metadata.namespace}:${selected.object.metadata.name}:${selected.object.metadata.uid}`}
                    projectId={projectId}
                    connection={connection}
                    type={selected.type}
                    selected={selected.object}
                    visible={visible && (!constrainedDetail || detailFocused)}
                    onBack={
                      constrainedDetail
                        ? () => {
                            cancelReveal();
                            setDetailFocused(false);
                          }
                        : undefined
                    }
                    onClose={() => {
                      if (!ownsView()) return;
                      cancelReveal();
                      setSelection(undefined);
                    }}
                    onAssist={
                      sessionId && onAssist
                        ? (text) => onAssist(text)
                        : undefined
                    }
                    refresh={refresh}
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

type ManifestDraft = {
  text: string;
  baseText: string;
  resourceVersion?: string;
  uid?: string;
  storageVersion: number;
  dirtyStorage: boolean;
  label: string;
};
const manifestBuffers = new Map<string, ManifestDraft>();
const mountedManifestBuffers = new Map<string, number>();
/** Only unused, durably clean source snapshots are evicted; edited drafts remain. */
function trimCleanManifestBuffers() {
  const unused = [...manifestBuffers].filter(
    ([key, draft]) =>
      !mountedManifestBuffers.get(key) &&
      !draft.dirtyStorage &&
      draft.text === draft.baseText,
  );
  for (const [key] of unused.slice(0, Math.max(0, unused.length - 16)))
    manifestBuffers.delete(key);
}
const draftStorageKey = (key: string) =>
  "workbench.ops.manifest-draft.v1:" + key;
let manifestFlushTail: Promise<void> = Promise.resolve();
function flushManifestDrafts(): Promise<void> {
  const pending = [...manifestBuffers]
    .filter(([, draft]) => draft.dirtyStorage)
    .map(([key, draft]) => ({ key, draft, captured: { ...draft } }));
  const work = manifestFlushTail
    .catch(() => {})
    .then(async () => {
      if (pending.length && !navigator.locks?.request)
        throw new Error(
          "Сохранение YAML требует Web Locks для защиты между окнами. Черновик удерживается; закрытие заблокировано.",
        );
      for (const { key, draft, captured } of pending) {
        await navigator.locks.request(
          "workbench:ops:manifest:" + key,
          { mode: "exclusive" },
          () => {
            // A newer explicit reload/baseline supersedes this queued source snapshot.
            if (
              draft.baseText !== captured.baseText ||
              draft.resourceVersion !== captured.resourceVersion ||
              draft.uid !== captured.uid
            )
              return;
            const storageKey = draftStorageKey(key),
              raw = localStorage.getItem(storageKey),
              previous = raw ? JSON.parse(raw) : undefined;
            const previousVersion = previous?.storageVersion || 0;
            if (!Number.isSafeInteger(previousVersion) || previousVersion < 0)
              throw new Error("Повреждена версия сохранённого YAML-черновика.");
            if (previousVersion !== draft.storageVersion)
              throw new Error(
                `Черновик ${draft.label} изменён в другом окне. Текст этого окна сохранён в памяти; сначала сохраните копию.`,
              );
            const next = {
              ...captured,
              storageVersion: previousVersion + 1,
              dirtyStorage: false,
            };
            localStorage.setItem(storageKey, JSON.stringify(next));
            draft.storageVersion = next.storageVersion;
            // Typing during the lock wait remains dirty and is saved by a later flush.
            draft.dirtyStorage =
              draft.text !== captured.text ||
              draft.baseText !== captured.baseText ||
              draft.resourceVersion !== captured.resourceVersion ||
              draft.uid !== captured.uid;
          },
        );
      }
    });
  manifestFlushTail = work;
  return work;
}
registerWindowClose("ops:manifest-drafts", async () => flushManifestDrafts());

function parseManifest(text: string): Record<string, OpsValue> {
  if (new TextEncoder().encode(text).length > 1024 * 1024)
    throw new Error(
      "YAML ограничен 1 МиБ. Текст не будет обрезан или применён частично.",
    );
  const document = parseDocument(text, {
    version: "1.2",
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      [...document.errors, ...document.warnings]
        .map((e) => e.message)
        .join("\n"),
    );
  const value = document.toJS({ maxAliasCount: 50 });
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ожидается один YAML-объект ресурса.");
  return value;
}
function ResourceView({
  projectId,
  connection,
  type,
  selected,
  visible,
  onClose,
  onBack,
  onAssist,
  refresh,
}: {
  projectId: string;
  connection: OpsConnection;
  type: OpsClusterResourceType;
  selected: KubeObject;
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  onAssist?: (text: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const ask = useAsk();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const preparedDraft = useRef<{ id: string; text: string } | undefined>(
    undefined,
  );
  const confirmedDraft = useRef<
    { text: string; resourceVersion: string } | undefined
  >(undefined);
  const identity = {
    group: type.group,
    version: type.version,
    resource: type.resource,
    namespace: selected.metadata.namespace,
    name: selected.metadata.name,
  };
  const detail = useOpsQuery<KubeObject>(
    projectId,
    connection,
    "cluster.get",
    identity,
    hasCapability(connection, "cluster.get"),
    visible ? 7000 : 0,
  );
  const current = detail.value?.data;
  const [tab, setTab] = useState("overview"),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [action, setAction] = useState<OpsActionRequest>(),
    [replicas, setReplicas] = useState(String(selected.spec?.replicas ?? 1));
  const draftKey = JSON.stringify([
    projectId,
    connection.id,
    connection.targetHash,
    resourceKey(type),
    selected.metadata.namespace,
    selected.metadata.name,
    selected.metadata.uid,
  ]);
  const source = current ? stringify(current, { lineWidth: 0 }) : "";
  const sourceTooLarge = new TextEncoder().encode(source).length > 1024 * 1024;
  if (source && !sourceTooLarge && !manifestBuffers.has(draftKey)) {
    let stored: ManifestDraft | undefined;
    try {
      const raw = localStorage.getItem(draftStorageKey(draftKey));
      if (raw) {
        const candidate = JSON.parse(raw);
        if (
          typeof candidate.text === "string" &&
          typeof candidate.baseText === "string" &&
          candidate.text.length <= 1024 * 1024
        )
          stored = candidate;
      }
    } catch {}
    manifestBuffers.set(
      draftKey,
      stored || {
        text: source,
        baseText: source,
        uid: current?.metadata.uid,
        resourceVersion: current?.metadata.resourceVersion,
        storageVersion: 0,
        dirtyStorage: false,
        label: `${connection.name} / ${selected.metadata.namespace || "cluster"} / ${selected.metadata.name}`,
      },
    );
  }
  const draft = manifestBuffers.get(draftKey),
    dirty = !!draft && draft.text !== draft.baseText;
  const replaced =
    !!current &&
    !!selected.metadata.uid &&
    current.metadata.uid !== selected.metadata.uid;
  const conflict =
    !!draft &&
    !!current &&
    draft.resourceVersion !== current.metadata.resourceVersion &&
    dirty;
  const secret = type.kind === "Secret" || !!current?.workbenchMetadataOnly;
  useEffect(() => {
    if (!current || !draft || dirty || replaced || editing) return;
    if (draft.baseText !== source) {
      draft.text = source;
      draft.baseText = source;
      draft.uid = current.metadata.uid;
      draft.resourceVersion = current.metadata.resourceVersion;
      draft.dirtyStorage = true;
      setRevision((v) => v + 1);
    }
  }, [source, dirty, editing, replaced]);
  useEffect(() => {
    const confirmed = confirmedDraft.current;
    if (!confirmed || !draft || !current) return;
    if (draft.text !== confirmed.text) {
      confirmedDraft.current = undefined;
      return;
    }
    if (current.metadata.resourceVersion !== confirmed.resourceVersion) return;
    // Rebase only the exact submitted text after a matching observed server version.
    // This prevents an older in-flight GET from restoring the pre-apply source.
    Object.assign(draft, {
      text: source,
      baseText: source,
      uid: current.metadata.uid,
      resourceVersion: current.metadata.resourceVersion,
      dirtyStorage: true,
    });
    confirmedDraft.current = undefined;
    setRevision((value) => value + 1);
  }, [source, revision]);
  const persist = async () => {
    try {
      await flushManifestDrafts();
      setError("");
    } catch (e) {
      setError(opsErrorText(e));
      throw e;
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      void flushManifestDrafts().catch((e) => setError(opsErrorText(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [revision]);
  useEffect(() => {
    mountedManifestBuffers.set(
      draftKey,
      (mountedManifestBuffers.get(draftKey) || 0) + 1,
    );
    trimCleanManifestBuffers();
    return () => {
      const count = (mountedManifestBuffers.get(draftKey) || 1) - 1;
      if (count) mountedManifestBuffers.set(draftKey, count);
      else mountedManifestBuffers.delete(draftKey);
      void flushManifestDrafts().catch((e) => {
        window.dispatchEvent(
          new CustomEvent("workbench-error", {
            detail: `Не сохранён YAML-черновик: ${opsErrorText(e)}. Текст удерживается; штатное закрытие заблокировано.`,
          }),
        );
      });
      // StrictMode remount and another mounted view may still own this same key.
      queueMicrotask(trimCleanManifestBuffers);
    };
  }, [draftKey]);
  const events = useOpsQuery<KubeList>(
    projectId,
    connection,
    "cluster.events",
    {
      ...identity,
      fieldSelector: selected.metadata.uid
        ? `involvedObject.uid=${selected.metadata.uid}`
        : `involvedObject.name=${selected.metadata.name}`,
    },
    tab === "events" && hasCapability(connection, "cluster.events"),
    visible ? 8000 : 0,
  );
  const prepare = (
    operation: OpsActionRequest["operation"],
    manifest?: Record<string, OpsValue>,
    submittedText?: string,
  ) => {
    if (
      !current ||
      replaced ||
      detail.error ||
      (operation === "cluster.apply" && conflict)
    )
      return;
    const input: Record<string, OpsValue> = {
      group: type.group,
      version: type.version,
      resource: type.resource,
      name: current.metadata.name,
      uid: current.metadata.uid || "",
      resourceVersion: current.metadata.resourceVersion || "",
    };
    if (type.namespaced) input.namespace = current.metadata.namespace || "";
    if (operation === "cluster.scale") {
      const count = Number(replicas);
      if (!Number.isSafeInteger(count) || count < 0) {
        setError("Количество реплик — целое неотрицательное число.");
        return;
      }
      input.replicas = count;
    }
    if (manifest) input.manifest = manifest;
    const id = crypto.randomUUID();
    if (operation === "cluster.apply" && draft)
      preparedDraft.current = { id, text: submittedText ?? draft.text };
    setAction({
      id,
      projectId,
      connectionId: connection.id,
      expectedTargetHash: connection.targetHash,
      expectedAuthGeneration: connection.authGeneration,
      operation,
      input,
      title:
        (
          {
            "cluster.apply": "Применить YAML",
            "cluster.scale": "Изменить реплики",
            "cluster.restart": "Перезапустить workload",
            "cluster.delete": "Удалить ресурс",
          } as Record<string, string>
        )[operation] || operation,
      target: `${connection.name} · ${connection.environment || connection.kind} / ${current.metadata.namespace || "cluster"} / ${current.kind} ${current.metadata.name}`,
    });
  };
  const apply = async () => {
    if (!draft || secret) return;
    const submittedText = draft.text,
      resourceVersion = draft.resourceVersion;
    try {
      await persist();
      if (!alive.current) return;
      const manifest = parseManifest(submittedText),
        metadata = manifest.metadata as Record<string, OpsValue> | undefined;
      if (
        manifest.kind !== current?.kind ||
        manifest.apiVersion !== current?.apiVersion ||
        metadata?.name !== selected.metadata.name ||
        (metadata?.namespace || "") !== (selected.metadata.namespace || "") ||
        metadata?.uid !== selected.metadata.uid ||
        metadata?.resourceVersion !== resourceVersion
      )
        throw new Error(
          "kind/apiVersion/name/namespace/uid/resourceVersion закреплены за исходным объектом. Для другой цели создайте отдельный ресурс; конфликт версии не перезаписывается.",
        );
      setError("");
      prepare("cluster.apply", manifest, submittedText);
    } catch (e) {
      setError(opsErrorText(e));
    }
  };
  const replaceDraft = async (mode: "server" | "previous" | "stored") => {
    if (!draft || !current) return;
    if (
      dirty &&
      !(await ask("Заменить текущий YAML-черновик?", {
        confirm: true,
        message:
          "Текущий текст будет сохранён отдельной копией. Серверный ресурс не изменится.",
      }))
    )
      return;
    try {
      const storageKey = draftStorageKey(draftKey);
      const raw = localStorage.getItem(
        mode === "previous" ? storageKey + ":previous" : storageKey,
      );
      const retained = raw ? JSON.parse(raw) : undefined;
      if (
        mode !== "server" &&
        (!retained ||
          typeof retained.text !== "string" ||
          typeof retained.baseText !== "string")
      )
        throw new Error("Сохранённый черновик не найден или повреждён.");
      const previous = { ...draft };
      if (dirty) {
        localStorage.setItem(
          storageKey + ":recovery:" + crypto.randomUUID(),
          JSON.stringify(previous),
        );
        if (mode !== "previous")
          localStorage.setItem(
            storageKey + ":previous",
            JSON.stringify(previous),
          );
      }
      const stored = localStorage.getItem(storageKey);
      const version = stored ? JSON.parse(stored).storageVersion : 0;
      Object.assign(
        draft,
        mode === "server"
          ? {
              text: source,
              baseText: source,
              uid: current.metadata.uid,
              resourceVersion: current.metadata.resourceVersion,
            }
          : retained,
        { storageVersion: version || 0, dirtyStorage: true },
      );
      await flushManifestDrafts();
      setRevision((v) => v + 1);
      setEditing(mode !== "server");
      setError("");
    } catch (e) {
      setError(opsErrorText(e));
    }
  };
  const reloadSource = () => void replaceDraft("server");
  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setError("");
    } catch (e) {
      setError("Не удалось скопировать YAML: " + opsErrorText(e));
    }
  };
  return (
    <>
      <div className="ops-detail-head">
        {onBack && (
          <IconButton
            icon="chevron-left"
            label="Вернуться к списку ресурсов"
            onClick={onBack}
          />
        )}
        <div>
          <strong>
            {selected.metadata.name}
            {dirty ? " ·" : ""}
          </strong>
          <small>
            {type.kind} · {selected.metadata.namespace || "cluster"} ·{" "}
            {connection.name}
          </small>
        </div>
        {onAssist && (
          <IconButton
            icon="chat"
            label="Обсудить ресурс с агентом"
            onClick={() =>
              onAssist(
                `Проверь ${type.kind} ${selected.metadata.namespace || "cluster"}/${selected.metadata.name} в ${connection.name}. Project: ${projectId}; connectionId: ${connection.id}; UID: ${selected.metadata.uid}; resourceVersion: ${current?.metadata.resourceVersion || selected.metadata.resourceVersion}. Сначала прочитай актуальное состояние, не меняй цель после переключения интерфейса.`,
              )
            }
          />
        )}
        <IconButton
          icon="close"
          label="Закрыть сведения о ресурсе, сохранив черновик"
          onClick={async () => {
            const text = draft?.text;
            try {
              await persist();
              if (!alive.current || draft?.text !== text) return;
              onClose();
            } catch {}
          }}
        />
      </div>
      <div className="ops-tabs" role="tablist" aria-label="Ресурс">
        {[
          ["overview", "Обзор"],
          ["yaml", secret ? "Метаданные" : "YAML"],
          ["events", "События"],
          ["logs", "Логи"],
        ].map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      <OpsErrorBox
        message={error || detail.error}
        retry={detail.error ? () => void detail.refresh() : undefined}
        dismiss={!detail.error ? () => setError("") : undefined}
      />
      {replaced && (
        <p className="ops-notice warn">
          Объект с этим именем создан заново и имеет другой UID. Существующий
          черновик сохранён. Выберите свежую строку в списке.
        </p>
      )}
      {conflict && (
        <p className="ops-notice warn">
          Серверная версия изменилась: rv {draft?.resourceVersion} →{" "}
          {current?.metadata.resourceVersion}. Ваш YAML сохранён. Сравните
          версии и явно загрузите свежую; Apply заблокирован.
        </p>
      )}
      {!current ? (
        <OpsEmpty
          title={detail.loading ? "Загружается ресурс…" : "Ресурс не получен"}
        />
      ) : tab === "overview" ? (
        <div className="ops-detail-body">
          <dl className="ops-facts">
            <dt>Состояние</dt>
            <dd>
              <OpsBadge status={resourceStatus(current)} />
            </dd>
            <dt>API</dt>
            <dd>{current.apiVersion}</dd>
            <dt>UID</dt>
            <dd>{current.metadata.uid}</dd>
            <dt>Версия</dt>
            <dd>{current.metadata.resourceVersion}</dd>
            <dt>Создан</dt>
            <dd>
              {current.metadata.creationTimestamp
                ? new Date(current.metadata.creationTimestamp).toLocaleString()
                : "—"}
            </dd>
          </dl>
          {current.metadata.labels && (
            <>
              <h3 className="ops-section-label">Labels</h3>
              <OpsCode
                text={stringify(current.metadata.labels)}
                language="yaml"
              />
            </>
          )}
          {secret ? (
            <p className="ops-notice">
              Показаны только метаданные Secret. Значения не загружены и не
              переданы агенту.
            </p>
          ) : (
            <>
              <h3 className="ops-section-label">Состояние</h3>
              <OpsCode text={stringify(current.status || {})} language="yaml" />
              {[
                "Deployment",
                "StatefulSet",
                "ReplicaSet",
                "DeploymentConfig",
                "DaemonSet",
              ].includes(type.kind) && (
                <div className="ops-action-row">
                  {type.kind !== "DaemonSet" && (
                    <>
                      <input
                        type="number"
                        aria-label="Количество реплик"
                        min={0}
                        value={replicas}
                        onChange={(e) => setReplicas(e.target.value)}
                        style={{ width: 75 }}
                      />
                      <button
                        type="button"
                        disabled={
                          replaced ||
                          !!detail.error ||
                          !hasCapability(connection, "cluster.scale")
                        }
                        onClick={() => prepare("cluster.scale")}
                      >
                        Изменить реплики
                      </button>
                    </>
                  )}
                  {["Deployment", "StatefulSet", "DaemonSet"].includes(
                    type.kind,
                  ) && (
                    <button
                      type="button"
                      disabled={
                        replaced ||
                        !!detail.error ||
                        !hasCapability(connection, "cluster.restart")
                      }
                      onClick={() => prepare("cluster.restart")}
                    >
                      Перезапустить
                    </button>
                  )}
                </div>
              )}
              <div className="ops-action-row">
                <button
                  type="button"
                  className="ops-danger"
                  disabled={
                    replaced ||
                    !!detail.error ||
                    !hasCapability(connection, "cluster.delete")
                  }
                  onClick={() => prepare("cluster.delete")}
                >
                  Удалить ресурс
                </button>
              </div>
            </>
          )}
        </div>
      ) : tab === "yaml" ? (
        <div className="ops-editor">
          <div className="ops-code-tools">
            {!secret && (
              <button
                type="button"
                aria-pressed={editing}
                disabled={replaced || sourceTooLarge}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? "Просмотр" : "Редактировать"}
              </button>
            )}
            <span className="ops-muted">
              {dirty ? "Локальный черновик · " : ""}rv{" "}
              {draft?.resourceVersion || current.metadata.resourceVersion}
            </span>
            <span className="ops-spacer" />
            {!secret && (
              <>
                <button
                  type="button"
                  disabled={replaced}
                  onClick={reloadSource}
                >
                  Загрузить свежий
                </button>
                <Menu
                  label="Действия с YAML-черновиком"
                  items={[
                    {
                      label: "Скопировать YAML",
                      action: () => void copyDraft(),
                      disabled: !draft,
                    },
                    {
                      label: "Загрузить сохранённый черновик",
                      action: () => void replaceDraft("stored"),
                      disabled: !draft,
                    },
                    {
                      label: "Восстановить предыдущую копию",
                      action: () => void replaceDraft("previous"),
                      disabled: !draft,
                    },
                  ]}
                />
              </>
            )}
          </div>
          {!secret && draft ? (
            <OpsYamlEditor
              value={draft.text}
              readOnly={!editing || replaced}
              onChange={(text) => {
                if (!editing || !draft || draft.text === text) return;
                draft.text = text;
                draft.dirtyStorage = true;
                setRevision((v) => v + 1);
              }}
              onSave={() => {
                void persist().catch(() => {});
              }}
              onApply={apply}
              onLimit={() =>
                setError(
                  "YAML ограничен 1 МиБ. Вставка не выполнена; исходный текст сохранён.",
                )
              }
            />
          ) : (
            <OpsCode
              text={stringify(current)}
              language="yaml"
              label={secret ? "Метаданные Secret" : "Исходник ресурса"}
            />
          )}
          {sourceTooLarge && (
            <p className="ops-notice warn">
              YAML больше 1 МиБ: редактирование отключено, исходник показан
              ограниченным просмотром.
            </p>
          )}
          {!secret && dirty && (
            <div className="ops-code-tools">
              <span className="ops-muted">
                Черновик привязан к исходной цели и сохраняется при
                переключении.
              </span>
              <button
                type="button"
                className="primary"
                disabled={
                  conflict ||
                  replaced ||
                  !!detail.error ||
                  !hasCapability(connection, "cluster.apply")
                }
                onClick={apply}
              >
                Проверить и применить
              </button>
            </div>
          )}
          {conflict && (
            <details className="ops-receipts">
              <summary>Свежая серверная версия</summary>
              <OpsCode text={source} language="yaml" />
            </details>
          )}
        </div>
      ) : tab === "events" ? (
        !hasCapability(connection, "cluster.events") ? (
          <OpsEmpty title="Чтение событий недоступно" />
        ) : (
          <div className="ops-detail-body">
            <OpsErrorBox
              message={events.error}
              retry={() => void events.refresh()}
            />
            {events.value?.data.items.length ? (
              <ul className="ops-events">
                {events.value.data.items.map((event) => (
                  <li key={event.metadata.uid || event.metadata.name}>
                    <strong>{event.reason || event.type || "Событие"}</strong> ·{" "}
                    {event.message || event.note}
                    <time>
                      {event.lastTimestamp ||
                        event.eventTime ||
                        event.metadata.creationTimestamp}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <OpsEmpty
                title={
                  events.loading
                    ? "Загружаются события…"
                    : events.error
                      ? "События не получены"
                      : "Событий нет"
                }
              />
            )}
          </div>
        )
      ) : type.kind !== "Pod" ? (
        <OpsEmpty title="Логи доступны у Pod">
          Выберите конкретный Pod и контейнер. Workload не подменяется случайным
          pod.
        </OpsEmpty>
      ) : !hasCapability(connection, "cluster.logs") ? (
        <OpsEmpty title="Чтение логов не предоставлено MCP" />
      ) : (
        <ClusterLogs
          projectId={projectId}
          connection={connection}
          object={current}
          type={type}
          visible={visible}
        />
      )}
      {action && (
        <OpsActionReview
          key={action.id}
          request={action}
          onClose={() => setAction(undefined)}
          onExecuted={(receipt) => {
            const data = receipt.data;
            const metadata =
              data && typeof data === "object" && !Array.isArray(data)
                ? data.metadata
                : undefined;
            if (
              receipt.status === "confirmed" &&
              action.operation === "cluster.apply" &&
              preparedDraft.current?.id === action.id &&
              draft &&
              draft.text === preparedDraft.current.text &&
              metadata &&
              typeof metadata === "object" &&
              !Array.isArray(metadata) &&
              typeof metadata.resourceVersion === "string"
            ) {
              confirmedDraft.current = {
                text: draft.text,
                resourceVersion: metadata.resourceVersion,
              };
              setRevision((v) => v + 1);
            }
            void refresh();
            void detail.refresh();
          }}
        />
      )}
    </>
  );
}
function ClusterLogs({
  projectId,
  connection,
  object,
  type,
  visible,
}: {
  projectId: string;
  connection: OpsConnection;
  object: KubeObject;
  type: OpsClusterResourceType;
  visible: boolean;
}) {
  const containers: string[] = [
    ...(object.spec?.containers || []),
    ...(object.spec?.initContainers || []),
  ].map((c) => c.name);
  const [container, setContainer] = useState(containers[0] || ""),
    [previous, setPrevious] = useState(false),
    [follow, setFollow] = useState(true),
    [search, setSearch] = useState("");
  const query = useOpsQuery<OpsLogPage>(
    projectId,
    connection,
    "cluster.logs",
    {
      group: type.group,
      version: type.version,
      resource: type.resource,
      namespace: object.metadata.namespace,
      name: object.metadata.name,
      container,
      previous,
      tailLines: 500,
      timestamps: true,
    },
    !!container,
    follow && visible ? 3000 : 0,
  );
  const text = query.value?.data.text || "",
    filtered = search
      ? text
          .split("\n")
          .filter((line) => line.toLowerCase().includes(search.toLowerCase()))
          .join("\n")
      : text;
  return (
    <div className="ops-log">
      <div className="ops-code-tools">
        <select
          aria-label="Контейнер"
          value={container}
          onChange={(e) => setContainer(e.target.value)}
        >
          {containers.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <label className="ops-checkbox">
          <input
            type="checkbox"
            checked={previous}
            onChange={(e) => setPrevious(e.target.checked)}
          />
          Предыдущий
        </label>
        <button
          type="button"
          aria-pressed={follow}
          onClick={() => setFollow((v) => !v)}
        >
          {follow ? "Пауза" : "Следить"}
        </button>
      </div>
      <div className="ops-code-tools">
        <input
          type="search"
          aria-label="Поиск в снимке лога"
          placeholder="Найти в логе"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <IconButton
          icon="reload"
          label="Обновить снимок лога"
          disabled={query.loading}
          onClick={() => void query.refresh()}
        />
      </div>
      <OpsErrorBox message={query.error} retry={() => void query.refresh()} />
      <div className="ops-scroll">
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
          label={`Лог ${object.metadata.namespace}/${object.metadata.name}/${container}`}
        />
      </div>
      <div className="ops-count">
        Последние 500 строк · {observedAt(query.value?.observedAt)}
        {query.value?.data.truncated ? " · снимок ограничен" : ""}. Обновление
        снимками, не непрерывный watch.
      </div>
    </div>
  );
}

/** A create-only draft uses discovery and the same host preview/receipt path as edits. */
function CreateResourceView({
  projectId,
  connection,
  type,
  types,
  initialNamespace,
  initialName,
  namespaces,
  onTypeChange,
  onClose,
  onCreated,
  onAssist,
}: {
  projectId: string;
  connection: OpsConnection;
  type: OpsClusterResourceType;
  types: OpsClusterResourceType[];
  initialNamespace: string;
  initialName?: string;
  namespaces: string[];
  onTypeChange: (type: OpsClusterResourceType) => void;
  onClose: () => void;
  onCreated: (object: KubeObject) => void;
  onAssist?: (text: string) => void;
}) {
  const draftKey = JSON.stringify([
    "create",
    projectId,
    connection.id,
    connection.targetHash,
    resourceKey(type),
    type.namespaced ? initialNamespace : "",
    initialName || "",
  ]);
  const template = stringify(
    {
      apiVersion: (type.group ? type.group + "/" : "") + type.version,
      kind: type.kind,
      metadata: {
        name: initialName || "",
        ...(type.namespaced ? { namespace: initialNamespace } : {}),
      },
    },
    { lineWidth: 0 },
  );
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [action, setAction] = useState<OpsActionRequest>();
  const namespaceList = useId();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submitted = useRef<{ id: string; text: string } | undefined>(undefined);
  if (!manifestBuffers.has(draftKey)) {
    let saved: ManifestDraft | undefined;
    try {
      const raw = localStorage.getItem(draftStorageKey(draftKey));
      if (raw) {
        const value = JSON.parse(raw);
        if (
          typeof value.text !== "string" ||
          typeof value.baseText !== "string" ||
          new TextEncoder().encode(value.text).length > 1024 * 1024
        )
          throw new Error("Повреждённый YAML-черновик");
        saved = value;
      }
    } catch (e) {
      queueMicrotask(() =>
        setError("Сохранённый YAML-черновик не прочитан: " + opsErrorText(e)),
      );
    }
    manifestBuffers.set(
      draftKey,
      saved || {
        text: template,
        baseText: template,
        storageVersion: 0,
        dirtyStorage: !!initialName,
        label: `Новый ${type.kind} / ${connection.name}`,
      },
    );
  }
  const draft = manifestBuffers.get(draftKey)!;
  let manifest: Record<string, OpsValue> | undefined;
  try {
    manifest = parseManifest(draft.text);
  } catch {}
  const metadata =
    manifest?.metadata &&
    typeof manifest.metadata === "object" &&
    !Array.isArray(manifest.metadata)
      ? manifest.metadata
      : undefined;
  const name = typeof metadata?.name === "string" ? metadata.name : "";
  const namespace =
    typeof metadata?.namespace === "string" ? metadata.namespace : "";
  const setText = (text: string) => {
    if (draft.text === text) return;
    draft.text = text;
    draft.dirtyStorage = true;
    setRevision((value) => value + 1);
  };
  const persist = async () => {
    try {
      await flushManifestDrafts();
      setError("");
    } catch (e) {
      setError(opsErrorText(e));
      throw e;
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      void flushManifestDrafts().catch((e) => setError(opsErrorText(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [revision]);
  useEffect(() => {
    mountedManifestBuffers.set(
      draftKey,
      (mountedManifestBuffers.get(draftKey) || 0) + 1,
    );
    trimCleanManifestBuffers();
    return () => {
      const count = (mountedManifestBuffers.get(draftKey) || 1) - 1;
      if (count) mountedManifestBuffers.set(draftKey, count);
      else mountedManifestBuffers.delete(draftKey);
      void flushManifestDrafts().catch((e) => {
        window.dispatchEvent(
          new CustomEvent("workbench-error", {
            detail:
              "Не сохранён YAML нового ресурса: " +
              opsErrorText(e) +
              ". Черновик удерживается; штатное закрытие заблокировано.",
          }),
        );
      });
      queueMicrotask(trimCleanManifestBuffers);
    };
  }, [draftKey]);
  const setField = (field: "name" | "namespace", value: string) => {
    try {
      parseManifest(draft.text);
      const document = parseDocument(draft.text, {
        version: "1.2",
        strict: true,
        uniqueKeys: true,
      });
      document.setIn(["metadata", field], value);
      setText(document.toString());
      setError("");
    } catch (e) {
      setError("Сначала исправьте YAML. " + opsErrorText(e));
    }
  };
  const prepare = async () => {
    const submittedText = draft.text;
    try {
      await persist();
      if (!alive.current) return;
      const body = parseManifest(submittedText),
        m = body.metadata;
      if (!m || typeof m !== "object" || Array.isArray(m))
        throw new Error("Укажите metadata.name и namespace в YAML.");
      if (
        body.kind !== type.kind ||
        body.apiVersion !== (type.group ? type.group + "/" : "") + type.version
      )
        throw new Error(
          "kind/apiVersion должны соответствовать выбранному API. Смените тип ресурса перед применением.",
        );
      if (
        typeof m.name !== "string" ||
        !m.name.trim() ||
        m.name !== m.name.trim()
      )
        throw new Error("Укажите точное metadata.name без пробелов по краям.");
      if (
        type.namespaced &&
        (typeof m.namespace !== "string" ||
          !m.namespace.trim() ||
          m.namespace !== m.namespace.trim())
      )
        throw new Error("Выберите namespace нового ресурса.");
      if (!type.namespaced && m.namespace)
        throw new Error(
          "Ресурс кластерный: metadata.namespace не допускается.",
        );
      if (
        m.uid !== undefined ||
        m.resourceVersion !== undefined ||
        m.managedFields !== undefined
      )
        throw new Error(
          "Удалите uid/resourceVersion/managedFields чужого объекта. Создаётся новый ресурс.",
        );
      if (body.status !== undefined)
        throw new Error(
          "status принадлежит серверу; удалите его из нового ресурса.",
        );
      const id = crypto.randomUUID();
      submitted.current = { id, text: submittedText };
      setAction({
        id,
        projectId,
        connectionId: connection.id,
        expectedTargetHash: connection.targetHash,
        expectedAuthGeneration: connection.authGeneration,
        operation: "cluster.apply",
        input: {
          group: type.group,
          version: type.version,
          resource: type.resource,
          name: m.name,
          ...(type.namespaced ? { namespace: m.namespace } : {}),
          manifest: body,
          createOnly: true,
        },
        title: `Создать ${type.kind} ${m.name}`,
        target: `${connection.name} / ${type.namespaced ? m.namespace : "cluster"} / ${m.name}`,
      });
      setError("");
    } catch (e) {
      setError(opsErrorText(e));
    }
  };
  return (
    <>
      <div
        className="ops-tabs"
        role="tablist"
        aria-label="Редактор нового ресурса"
      >
        <button type="button" role="tab" aria-selected={true}>
          Новый ресурс · YAML{draft.text !== draft.baseText ? " ·" : ""}
        </button>
        <span className="ops-spacer" />
        {onAssist && (
          <IconButton
            icon="chat"
            label="Подготовить ресурс с агентом"
            onClick={() =>
              onAssist(
                `Подготовь YAML нового ${type.kind} API ${(type.group ? type.group + "/" : "") + type.version} в подключении ${connection.name} (connectionId ${connection.id}), namespace ${namespace || "не выбран"}, имя ${name || "не задано"}. Сначала проверь discovery и требования; spec не выдумывай. Для создания используй createOnly:true, dry-run и проверку результата.`,
              )
            }
          />
        )}
        <IconButton
          icon="close"
          label="Закрыть создание, сохранив YAML-черновик"
          onClick={async () => {
            const text = draft?.text;
            try {
              await persist();
              if (!alive.current || draft?.text !== text) return;
              onClose();
            } catch {}
          }}
        />
      </div>
      <div className="ops-code-tools">
        <select
          aria-label="API нового ресурса"
          value={resourceKey(type)}
          onChange={async (event) => {
            const next = types.find(
              (item) => resourceKey(item) === event.target.value,
            );
            if (!next) return;
            const text = draft.text;
            try {
              await persist();
              if (!alive.current || draft.text !== text) return;
              onTypeChange(next);
            } catch {}
          }}
        >
          {types.map((item) => (
            <option value={resourceKey(item)} key={resourceKey(item)}>
              {item.kind} · {item.group || "core"}/{item.version}
            </option>
          ))}
        </select>
        <input
          aria-label="Имя нового ресурса"
          placeholder="metadata.name"
          value={name}
          onChange={(event) => setField("name", event.target.value)}
        />
        {type.namespaced && (
          <>
            <input
              aria-label="Namespace нового ресурса"
              list={namespaceList}
              placeholder="Namespace"
              value={namespace}
              onChange={(event) => setField("namespace", event.target.value)}
            />
            <datalist id={namespaceList}>
              {namespaces.map((value) => (
                <option value={value} key={value} />
              ))}
            </datalist>
          </>
        )}
      </div>
      <OpsErrorBox message={error} dismiss={() => setError("")} />
      <p className="ops-notice">
        Исходный шаблон содержит только API, тип и метаданные. Заполните
        необходимые поля по требованиям; сервер проверит их перед созданием.
        Существующий объект с этим именем не будет изменён.
      </p>
      <OpsYamlEditor
        value={draft.text}
        readOnly={false}
        onChange={setText}
        onSave={() => {
          void persist().catch(() => {});
        }}
        onApply={prepare}
        onLimit={() =>
          setError(
            "YAML ограничен 1 МиБ. Вставка не выполнена; текущий текст сохранён.",
          )
        }
      />
      <div className="ops-code-tools">
        <span className="ops-muted">
          Черновик сохраняется при переключении · {connection.name}
        </span>
        <span className="ops-spacer" />
        <IconButton
          icon="copy"
          label="Скопировать YAML нового ресурса"
          onClick={() =>
            void navigator.clipboard
              .writeText(draft.text)
              .catch((e) => setError(opsErrorText(e)))
          }
        />
        <button
          type="button"
          className="primary"
          disabled={!hasCapability(connection, "cluster.apply")}
          onClick={prepare}
        >
          Проверить и создать
        </button>
      </div>
      {action && (
        <OpsActionReview
          key={action.id}
          request={action}
          onClose={() => setAction(undefined)}
          onExecuted={(receipt) => {
            const data = receipt.data;
            if (
              receipt.status !== "confirmed" ||
              !data ||
              typeof data !== "object" ||
              Array.isArray(data)
            )
              return;
            const object = {
              ...data,
              apiVersion: (type.group ? type.group + "/" : "") + type.version,
              kind: type.kind,
            } as KubeObject;
            if (
              !object.metadata?.uid ||
              object.metadata.name !== action.input.name
            )
              return;
            if (
              submitted.current?.id === action.id &&
              draft.text === submitted.current.text
            ) {
              draft.baseText = draft.text;
              draft.dirtyStorage = true;
              try {
                const confirmedText = draft.text;
                void flushManifestDrafts()
                  .then(() => {
                    if (alive.current && draft.text === confirmedText)
                      onCreated(object);
                  })
                  .catch((e) => setError(opsErrorText(e)));
              } catch (e) {
                setError(opsErrorText(e));
              }
            }
          }}
        />
      )}
    </>
  );
}
