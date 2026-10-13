# OpenShift/Kubernetes: полный целевой console workflow

Уточнение пользователя 2026-10-13: нужен полный функциональный объём консоли, а не dashboard с логами. Минимум два стенда; **ДЕВ** и **ИФТ** — начальные примеры названий, а не фиксированный enum. Пользователь может переименовать любой стенд. Число стендов не ограничено. Ни адреса, ни версии, ни namespace пользователя пока не известны; не подставлять демонстрационные значения в реальную конфигурацию.

## Модель стендов и UI

Environment имеет стабильный ID, имя/alias, connection/cluster binding и набор namespace/project bindings. ДЕВ и ИФТ могут быть разными кластерами или разными namespace одного кластера: определить при настройке, не предполагать топологию. Один стенд может включать несколько кластеров, один connection — обслуживать несколько проектов.

В заголовке Operations: **стенд → кластер → namespace/project**. Переключатель с пользовательскими названиями, поиск по остальным, pinned/recent, текстовая подпись окружения; цвет только дополнение. Переименование доступно рядом с переключателем и в настройках подключения. Запоминать выбор по окну/проекту/панели. Таблицы ресурсов, YAML, логи, exec, port-forward и agent tools всегда показывают свой captured target. Два стенда можно открыть рядом для сравнения ресурсов/образов/config/rollout. Секретные значения не переносятся сравнением автоматически.

Переименование — изменение метаданных интерфейса. `environmentId`, connection/cluster identity, namespace, выбранные ресурсы, черновики и захваченные цели операций неизменны; label не входит в ключ данных и не определяет адрес кластера. Названия общие для проектов с тем же подключением, независимы между подключениями. Пустые имена и дубликаты без учёта регистра внутри подключения отклоняются; пробелы по краям удаляются, длина 1–64 символа. Имя сохраняется атомарно; ошибка сохранения оставляет прежнее значение. Историческая запись операции сохраняет имя на момент выполнения вместе со стабильными ID. Это не переименовывает Kubernetes context, namespace, Jenkins folders или подключения БД.

В текущем HTML-макете названия начальных стендов сохраняются в localStorage; ресурсы остаются демонстрационными. В продукте после согласования использовать общий реестр подключений и его постоянное хранилище, не создавать параллельный реестр из макета. Сценарий S6-03: переименовать → переключить стенд/проект → перезапустить приложение → проверить имя, прежнюю физическую цель и отсутствие потери draft/операций.

Смена стенда переключает представление, но не перенаправляет уже открытый терминал/поток логов/команду. Не менять общий kube current-context для обслуживания UI. Operation envelope: projectId, environmentId, connectionId, cluster identity, namespace, kind/name/UID, resourceVersion, actor/sessionId, operationId. Cluster-scoped ресурсы явно отмечены, к ним не добавлять фиктивный namespace.

## Обязательные группы функций

| Группа | Целевой объём |
|---|---|
| Обзор | Cluster/project health, resource inventory, предупреждения, события, quotas/limits, capacity, версии и доступность API |
| Приложения | Topology, ownership/dependencies, deploy из YAML/image/Git/template/chart при поддержке; labels/annotations, приложения и связанные ресурсы |
| Workloads | Pods/containers/init/ephemeral, Deployment/ReplicaSet/StatefulSet/DaemonSet, Job/CronJob, status/conditions/events, replicas, scheduling/affinity/tolerations/resources/probes/env/volumes |
| Развёртывания | Создание/редактирование/apply/patch/delete, YAML/forms, diff/dry-run, rollout/history/restart/scale/rollback, pause/resume/suspend, job run, image changes; действия по реальным capabilities |
| Диагностика | Follow/previous/multicontainer logs, search/filter/timestamps/export, exec terminal/container choice, port-forward, events, debug containers, pod diagnostics и resource usage |
| Сеть | Services/endpoints/EndpointSlices, Ingress, OpenShift Routes/TLS, NetworkPolicy, service discovery, ingress/network operator resources по discovery |
| Service Mesh / Istio | EnvoyFilter и DestinationRule в Kubernetes и OpenShift: список по namespace, поиск, обзор и связанные workload/host/subsets, YAML, создание/редактирование, diff и проверка, apply/readback/delete, история и помощь агента |
| Хранение | PVC/PV/StorageClass, mounts, access modes/capacity, resize, VolumeAttachment и CSI/snapshot objects при наличии controllers |
| Конфигурация и доступы | ConfigMaps, Secrets, ServiceAccounts, Roles/RoleBindings/ClusterRoles/ClusterRoleBindings, ResourceQuota/LimitRange, OpenShift SCC и project access; редактор и diff с respect RBAC |
| Наблюдаемость | CPU/memory metrics, dashboards, query/alerts/rules/silences по доступным metrics/monitoring APIs; link к источнику и честное stale/no-data |
| OpenShift build/image | Builds/BuildConfigs, build start/cancel/logs/history, ImageStreams/tags/import/triggers, DeploymentConfigs только при обнаруженном API |
| Operators/расширения | OperatorHub/catalog/install/update/status, CSV/Subscriptions/InstallPlans/OperatorGroups, CRD и CR explorer/editor, validation по schema, API discovery |
| Cluster administration | Nodes/cordon/drain/uncordon, machine pools/autoscaling/machine config, cluster operators/settings/version/update, authentication/OAuth/identity providers, certificates/CSR, admission/security policies; только по версии и полномочиям |
| Ecosystem console plugins | Pipelines/Tekton, GitOps/Argo, Helm, Serverless, Virtualization, storage/observability extensions — inventory установленных plugins/CRDs, отдельная capability matrix и адаптер для каждого доступного модуля |

Нельзя считать generic YAML editor полноценной заменой всем специальным workflows. Он обеспечивает базовый доступ к новым ресурсам, а специализированные экраны остаются обязательными задачами. Отсутствующие расширения не имитируются. Unsupported, forbidden, disconnected, empty и stale — разные состояния.

## Границы полного объёма

### EnvoyFilter и DestinationRule — обязательный срез

Запрос пользователя 13.10.2026: оба типа ресурсов должны быть явно доступны в **Operations → OpenShift / K8s → Service Mesh**, как при выборе OpenShift, так и Kubernetes. Не прятать их только в generic CRD explorer. Выбор connection, стенда и namespace общий с остальными ресурсами. Список показывает тип, имя, область действия, версию объекта; фильтры позволяют оставить один из двух типов. Пустой список отличается от отсутствующей CRD и отказа в доступе.

Для будущей реализации после согласования макета:

- Обнаруживать `networking.istio.io`, `envoyfilters` и `destinationrules`, served API versions, schema и операции по текущему MCP/cluster discovery. Не предполагать установленный Istio по названию платформы. Отказ читать сами определения CRD не доказывает отсутствие resource API; использовать discovery и реальные ответы ресурсных методов.
- EnvoyFilter: `workloadSelector.labels`, `priority`, несколько `configPatches`; у patch доступны `applyTo`, `match` (включая context), `patch.operation/value`. Область selector видна отдельно; отсутствие selector нельзя изображать как отсутствие затронутых workload. Если schema поддерживает `targetRefs`, показывать ссылки на выбранные ресурсы вместо области selector; `targetRefs` и `workloadSelector` взаимоисключаются. Учитывать mesh root namespace из подтверждённой конфигурации. Совместимость EnvoyFilter проверяется для установленных Istio/Envoy, а не по текущему публичному примеру.
- DestinationRule: `host`, `subsets` с labels и индивидуальной trafficPolicy, общая `trafficPolicy` (load balancing, connection pool, outlier detection, TLS, port-level settings), `exportTo` и `workloadSelector.matchLabels` по доступной schema. Последний выбирает клиентские workload своего namespace, а labels в subsets относятся к адресатам. Короткий host разрешать относительно namespace самого DestinationRule и показывать полный адрес. Связи с VirtualService и Service/ServiceEntry показывать при наличии соответствующих read capabilities; сами subsets не означают настроенную маршрутизацию к ним.
- Форма и полный YAML — два представления одного draft. Правка apiVersion/kind/metadata.name/namespace/UID/resourceVersion не должна переназначать captured target: заблокировать её как редактирование исходного объекта; для другого объекта предложить отдельное создание с новой целью. Не терять неизвестные поля при сохранении формы. Некорректный YAML/структура блокируют apply; schema validation, доступный server dry-run и анализ Istio показываются отдельными результатами, не как один фиктивный зелёный статус.
- Отдельно моделировать отсутствие обоих/одного API, Forbidden list/get, readonly, отсутствие create/update/delete/watch в MCP, stale snapshot и потерю соединения. Нет capabilities — конкретное объяснение в интерфейсе; автоматическая установка Istio/CRD не выполняется.
- Зафиксировать connection/cluster/namespace/GVK/name/UID/resourceVersion до изменения. Конфликт версии открывает свежий diff; неизвестный исход требует readback. Не повторять apply/delete вслепую и не переносить их на вновь выбранный стенд. Для этих ресурсов не показывать replicas/restart/exec как собственные действия.

Порядок: S6-03 — discovery/list/detail/watch и состояния доступа; S6-04 — сохранение draft, diff, валидация, mutations/readback; S6-11 — специализированные формы, связи и проверка полного workflow. Критерий KUX-03 требует evidence отдельно для Kubernetes и OpenShift. До одобрения прототипа это план, не реализованный adapter.

Схемы сверены 13.10.2026 по официальным [EnvoyFilter](https://istio.io/latest/docs/reference/config/networking/envoy-filter/) и [DestinationRule](https://istio.io/latest/docs/reference/config/networking/destination-rule/). В учебных примерах допустимы соответственно `v1alpha3` и `v1`; реальные версии определяются discovery, а не этой записью.

Ориентир — доступные функции реальной консоли на ДЕВ/ИФТ с учётной записью пользователя, включая developer и administrator workflows при наличии прав. Полный паритет нельзя подтвердить без версии и inventory установленных расширений. На рабочем компьютере агент строит таблицу: функция консоли → API/MCP tool → версия/права → UI/action → критерий → evidence. Неизвестные возможности остаются открытыми, не вычёркиваются молча. Прямая ссылка в внешнюю консоль полезна для продолжения работы, но не закрывает требование собственной реализации.

MCP — основной путь. Если сервер не предоставляет watch/exec/port-forward/metrics/action, расширить adapter contract либо явно показать блокировку; не маскировать это HTML mock и не запускать неподтверждённый kubectl за пользователя. Оболочка не модифицирует чужой CLI.

## Исполнение и восстановление

ResourceVersion conflicts → fresh read/diff, без force overwrite. Watch list/resourceVersion/reconnect/relist после 410, отмена подписок скрытой панели не отменяет job. Incremental bounded logs, ограничение памяти и число одновременных stream, backpressure; terminal input не смешивается между стендами. Mutations не копятся offline. Timeout означает reconcile, а не автоматический повтор удаления/restart/build/drain. Recreate resource с прежним именем и новым UID не считается тем же объектом.

Default auto-allow для уже настроенных MCP сохраняется: не вводить постоянные окна разрешения инструмента. Target, diff, влияние и progress видны в рабочем интерфейсе. Нельзя обходить remote RBAC/кластерные policies или считать разрешение инструмента поручением агенту произвольно менять cluster settings. Выполнять действия в рамках запроса/согласованной задачи. Secret values раскрываются по явному действию, не загружаются массово в логи/историю/LLM.

## Этапы и доказательства

1. S6-03: реестр стендов ДЕВ/ИФТ, capability inventory, resources/watch, диагностика, readonly сравнение.
2. S6-04: подготовленные mutations с captured target, dry-run/diff, execute/readback и recovery.
3. S6-11: полноценные topology/deploy/network/storage/access/observability workflows и OpenShift operators/build/image/admin; granular registry вместо одной отметки «поддерживается».
4. S6-12: фактические console plugins/adapters, сравнение с реальной UI на обоих стендах, final parity audit.

Обязательные сценарии: два окна и два стенда одновременно; одинаковые namespace и pod names, но разные clusters; переключение во время exec/scale/log follow; отсутствие влияния на другой target; RBAC denied; CRD отсутствует; watch disconnect/410; stale resourceVersion; deleted/recreated UID; token rotation; HTML gateway errors; namespace deletion; rollout failed; cancel/reconnect; large logs; cluster-scoped action; agent/user shared view. Mutating live tests — изолированные test namespaces на разрешённом стенде. Audit всего объёма остаётся открытым до evidence; существующую более качественную реализацию пользователя не заменять без сравнения.

Источники (проверены 2026-10-13): [OpenShift console](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html-single/web_console/index), [Kubernetes namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/), [Kubernetes objects](https://kubernetes.io/docs/concepts/overview/working-with-objects/). Версия источника — ориентир, не предположение о кластерах пользователя.
