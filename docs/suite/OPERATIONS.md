# Operations workspace

Этот документ описывает целевой roadmap. Фактический runtime 0.4 содержит две самостоятельные dock-панели Jenkins и Kubernetes/OpenShift. Реально реализованные пути, перенос и ограничения: [runtime handoff](OPERATIONS-RUNTIME-HANDOFF.md), [аудит и проверки](OPERATIONS-RUNTIME-AUDIT.md). Единый workspace с knowledge links ниже ещё не объявляется завершённым.

## Общая организация

Один Operations workspace объединяет Kubernetes/OpenShift, Jenkins и knowledge links, но adapters и permissions остаются раздельными. Navigator начинается с environments текущего Project, затем resources. Context bar всегда показывает connection/cluster/namespace/environment.

## Подсветка исходников и логов

Обязателен общий [SYNTAX-HIGHLIGHTING](SYNTAX-HIGHLIGHTING.md): YAML/JSON/Groovy/Markdown и OpenShift/Kubernetes/Jenkins logs используют одинаковые theme tokens без свечения. Timestamp/severity, multiline JSON, stacktrace и ANSI отображаются как данные; поиск, tail/pause и потоковый экспорт сохраняют target/source revision, ограниченные buffers и redaction до индексации/render/export. Это часть O2/O4/O5/O7 и существующего этапа 6; цветной fixture не подтверждает runtime stream или успешное применение manifest.

## Kubernetes и OpenShift

OpenShift — расширение Kubernetes adapter через API discovery, не копия клиента.

Функции:

- connections, contexts, clusters, namespaces/projects;
- overview health/warnings/quotas;
- workloads: deployments/statefulsets/daemonsets/pods/jobs/cronjobs;
- services/ingress/routes, configmaps, PVC, HPA, nodes;
- Service Mesh: EnvoyFilter и DestinationRule, явно в обеих платформах; список/detail/YAML/forms/diff/apply/readback, discovery CRD/API и RBAC; подробный контракт в `OPENSHIFT-K8S-FULL-SCOPE.md`;
- events/conditions/ownership, YAML/source/diff;
- multi-container logs с follow/search/timestamps/download;
- exec terminal и port-forward как управляемые resources;
- rollout status/history, scale/restart/apply/delete;
- OpenShift Routes, Builds/BuildConfigs, ImageStreams, DeploymentConfigs, Operators/CSV/Subscriptions по discovery;
- links к Task, commit/PR, Jenkins run, release и evidence.

Secret metadata можно показывать; values не читаются/кешируются автоматически. Watch: list → resourceVersion → watch; `410 Gone` вызывает relist. Перед action проверять remote authorization (например SelfSubjectAccessReview), затем server-side dry-run, diff, policy, execute и readback. Resource version conflict не перезаписывается.

Mutations никогда не ставятся в offline queue. Timeout после apply/delete/scale даёт `unknown` и reconciliation по UID/resourceVersion/observed state.

## Jenkins

Несколько controllers/folders/jobs. UI:

- job/pipeline list и search;
- queue и recent runs;
- parameters с фактическими types/validation;
- stages только при обнаруженном API/plugin;
- progressive console с cursor;
- tests, artifacts, changes, timings;
- trigger, cancel, retry/rebuild по capability;
- queue item → build number → terminal result;
- task/commit/PR/environment/deployment links;
- create defect/incident из failure.

Потерянный trigger сначала reconciles queue/build по correlation/cause/time window. Не повторять POST вслепую. Unsupported stage/rebuild скрыт как unavailable, а не имитируется.

## Knowledge / аналог Confluence

Канонический adapter:

- spaces/collections и page tree;
- search/read с citations/version;
- draft/edit/publish и conflict editor;
- version history/compare;
- attachments/labels/comments/backlinks;
- Task/SDD/ADR/release links;
- local offline draft, но publish только после fresh version check.

Remote HTML санитизируется; scripts/macros не выполняются в renderer. Citation хранит connection/space/page/version/fragment. Несколько spaces на Project настраиваются по [CONNECTIONS-AND-SETTINGS](CONNECTIONS-AND-SETTINGS.md).

## Adapter operations

```text
cluster.connections/contexts/resources/get/watch/logs
cluster.prepareApply/execute/scale/restart/delete/reconcile
cluster.exec.start/portForward.start/resource.stop
ci.controllers/jobs/runs/run/logs/tests/artifacts
ci.prepareTrigger/trigger/cancel/reconcile
knowledge.spaces/tree/search/get/history
knowledge.draft/save/preparePublish/publish/reconcile
```

Большие logs/YAML/doc bodies читаются страницами/курсорами и закрепляются как artifact; не проходят через полный state. Events содержат connection/target/resource revision и sequence.

## UX и безопасность

- Environment marker постоянен; prod обозначен текстом и цветом.
- Overview читает данные, но не скрывает stale age.
- Action review показывает manifest/diff/parameters/target/preflight/rollback.
- Exec/port-forward/stream/log follow имеют явный lifecycle и Stop.
- Close/hide panel не останавливает operation без команды.
- Credential и TLS настройка централизована; TLS bypass отсутствует; доверие настраивается через системные корни и CA.
- Agent получает стабильные narrow tools, а host переводит их в фактический MCP.

## Этапы

1. O1 — connection discovery/capability inspector и normalized errors.
2. O2 — Jenkins read-only jobs/runs/logs/tests/artifacts.
3. O3 — Jenkins trigger/cancel/reconcile.
4. O4 — Kubernetes/OpenShift discovery/resources/watch/events/logs.
5. O5 — dry-run/diff/apply, rollout, scale/restart/delete.
6. O6 — exec/port-forward/downloads и lifecycle hardening.
7. O7 — knowledge tree/search/read/drafts/version conflicts/publish.
8. O8 — agent tools, Task links, Windows/corporate live matrix.

## Проверки

- multiple connections не смешивают identity/cache/events;
- actual permission denial блокирует backend, не только кнопку;
- watch resume/410/reconnect не теряет/дублирует revisions;
- Secret body не попадает renderer/logs/prompt/diagnostics;
- logs разделяют pod/container/restart и не дублируют chunks;
- apply diff соответствует отправленному body, conflict не overwrites;
- rollout receipt подтверждён observed state;
- Jenkins trigger прослеживается queue→build→result без duplicate;
- HTML error/429/timeout нормализуются с Retry-After/unknown outcome;
- knowledge publish conflict сохраняет обе версии;
- page sanitization и attachment limits;
- packaged Windows проверяет реальный MCP/CA/client certificate и restart во время stream.

## Полный OpenShift/Kubernetes console scope

Обязателен [OPENSHIFT-K8S-FULL-SCOPE.md](OPENSHIFT-K8S-FULL-SCOPE.md). Минимальные стенды — ДЕВ и ИФТ, но topology, адреса и namespace обнаруживаются на рабочем окружении. Конечный объём включает developer/admin console workflows и доступные plugins; текущие read/action этапы являются только основой.

## Jenkins: все джобы пространства и запуск (уточнение 13.10.2026)

Вход: Operations → Jenkins. Сверху выбор сохранённого controller connection и пространства (folder/view/root), затем поиск по полному пути. Пространство Jenkins не тождественно стенду Kubernetes: связь с ДЕВ/ИФТ настраивается в ProjectBinding. Прототип использует папки ДЕВ/ИФТ только как примеры. Все доступные пользователю джобы выбранного scope видны, включая вложенные папки и конкретные ветки multibranch; не ограничивать список последними запусками. Containers/folders показывать отдельно от runnable jobs: запуск multibranch parent может означать сканирование, а не сборку ветки.

Каталог загружается ограниченными порциями с индикатором незавершённого обхода; поиск не выдаёт частичный локальный индекс за полный результат. Сохранять connectionId + fullName, учитывать одинаковые имена в папках. Строка: имя/путь, тип, последний результат/номер/время, очередь/текущий запуск, доступная кнопка запуска. Disabled и отсутствие Build permission объясняются прямо в строке. Ошибка авторизации, HTML вместо JSON и недоступность controller не отображаются как пустой каталог.

Нажатие «Запустить» открывает компактную форму с immutable controller/job target. Поля строятся из фактической схемы параметров (string/choice/boolean/password/file и расширения только при поддержке adapter), серверные default values, required/validation. Не добавлять ветку или стенд к джобе, которая таких параметров не принимает. Форма настройки запуска не является дополнительным MCP permission dialog. Без параметров достаточно явного запуска; прототип показывает короткую форму для наглядности.

При submit блокировать повторный клик, host фиксирует operationId, точный target/параметры без секретов. Через MCP adapter выполнить build/buildWithParameters согласно discovery. Вернуть queue receipt, затем связать queue item с фактическим build number. Никогда не вычислять номер lastBuild+1. Показать ожидание executor и причину, выполнение, итог, progressive log, stages/tests/artifacts по capabilities. Отмена queue и stop build — разные операции; отмена требует readback, а не только закрытия панели. Переключение проекта/controller не отменяет запуск и не меняет его target. Результат неизвестен после timeout: reconciliation, без автоматического повторного trigger.

В прототипе реализованы выбор двух fixture controllers, полный fixture-список, фильтр пространства, поиск, запуск с/без параметров, отмена очереди и иллюстративный переход очередь → сборка → результат. Данные/параметры/таймеры демонстрационные, refresh страницы их сбрасывает. Не переносить этот код в production adapter и не считать доказательством живой интеграции.

Приёмка для S6 Jenkins-среза: вложенные папки + одинаковые имена; >1000 jobs с неполной загрузкой; все реальные типы параметров; disabled/403; HTML/timeout; двойной submit; очередь отменена до назначения executor; запуск после смены controller; неизвестный исход trigger; сопоставление реального queue/build; логи без утечки secrets. Live тест — на тестовой джобе рабочего Jenkins через настроенный MCP, отдельно от fixture UX.

Первичный источник: [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/), проверен 13.10.2026. Конкретный API и параметры сверить с установленным controller и MCP.

### Избранные джобы

В списке и карточке джобы постоянно видна отдельная кнопка-звезда. Она добавляет или убирает джобу из личного избранного, включая отключённые джобы, и никогда не запускает сборку. Над списком — переключатель «Только избранные» со счётчиком всего избранного выбранного подключения. Он сочетается с поиском и пространством; повторное нажатие возвращает полный список.

Избранное и переключатель сохраняются по `user + connectionId`, доступны всем проектам с тем же подключением и не смешиваются между контроллерами. Имя подключения не является ключом. В макете используется `connectionId + fixture job.id` и localStorage; в приложении — постоянное хранилище пользовательских настроек. Для настоящей джобы используй подтверждённый стабильный ID адаптера, если он доступен, иначе канонический полный путь внутри подключения. Подтверждённое переименование обновляет ссылку; совпавшее короткое имя не основание переносить избранное. Записи, отсутствующие в частично загруженном каталоге, не удалять автоматически.

Фильтр действует во вкладке «Джобы», включая её последние запуски. Отдельные «Очередь» и «История» сохраняют все запуски пространства: снятие звезды не скрывает активную сборку из мониторинга. Пустое избранное предлагает показать все джобы; отсутствие совпадений — сбросить поиск и пространство, сохранив избранное. После снятия последней звезды фокус переходит на фильтр. Обновление сборок сохраняет фокус и прокрутку. Ошибка сохранения объясняет, что настройка действует только до закрытия страницы.

OPS-09: проверить звезду, одинаковые имена в разных папках, сочетание фильтров, пустые состояния, снятие последней отметки, reload, изоляцию подключений и общие проекты. Изменения конфигурации Jenkins через MCP для личного избранного не нужны.
