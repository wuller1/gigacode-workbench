# Макет Tasks / Git / Operations / Knowledge

Статус: интерактивная демонстрация для согласования, **не реализация интеграций**. Внешних запросов, Git-команд, shell, CLI, MCP или изменений кластеров нет. `app/` не изменялся. Состояние хранится в памяти страницы и сбрасывается при обновлении.

Подключение: `suite-prototype-tasks-ops.css` и затем `suite-prototype-tasks-ops.js` после прежних inline scripts и `suite-prototype-shell.js`. Исходный Jenkins DOM сохраняется скрытым. Основной экран Jenkins расширен отдельным интерактивным fixture-контроллером с очередью, стадиями и остановкой. Переиспользованы исходные draggable-заголовки панелей.

## Реальные пути взаимодействия в макете

| Область | Что можно пройти | Проверяемый локальный результат |
| --- | --- | --- |
| Задачи | Доска, список, бэклог, спринт; поиск по ключу/названию/меткам; фильтры по исполнителю/статусу; сохранённые варианты | Меняется список/колонки; карточки доступны клавиатурой; drag между колонками меняет статус |
| Карточка | Создать/изменить, описание/критерии, исполнитель/статус/приоритет/оценка/спринт/метки | Поля изменяются, история фиксирует действия |
| Детали задачи | Подзадачи, комментарии, связи, файлы, учёт времени, дополнительные поля, история | Подзадачи отмечаются и зачёркиваются, комментарии и связи сохраняются, вложения сохраняют имена/размеры, без загрузки содержания |
| Работа | Взять в работу, обсуждение с агентом | Событие `suite:task-selected` передаёт ключ/название/описание/критерии shell; `suite:agent-request` подготавливает draft в выбранном разговоре |
| Жизненный цикл | Массовое изменение статуса/исполнителя и архивирование; архивировать/восстановить; завершить спринт; планировать следующий | Архив сохраняет историю; незавершённые задачи возвращаются в бэклог; выбранные задачи получают следующий спринт |
| Git | Разные fixture diffs файлов, авторство, stage/unstage файла и блока, stage all, commit; stash save/apply/drop; сравнение веток; cherry-pick; редактируемое разрешение конфликта | Файлы удаляются из рабочего списка после локального коммита, коммит появляется в истории и числе к push |
| Git remote | Clone форма, ветки/создание, pull mode, push preview | Clone переключает на демонстрационный репозиторий; ветка сохраняется; push снимает число неотправленных коммитов; реальные файлы не создаются |
| Pull requests | Фильтры, создание, обзор, diff, inline/general comments, review tasks, approve/unapprove, changes requested, rerun checks, merge | Merge disabled с причиной до выполнения критериев; после approve/успешных checks/закрытых задач доступна стратегия merge |
| Cluster | Пользовательские названия стендов → кластер → namespace; переименование рядом с выбором и в настройках; категории workloads/pods/network/storage/config/access/operators/cluster/builds; поиск | Названия сохраняются в localStorage и общие для проектов подключения; стабильные environmentId и физические цели, независимые банки ресурсов по кластеру/namespace |
| Состояния кластера | Готово, загрузка, нет связи, нет прав, устаревшие данные | Восстановление возвращает снимок; устаревшие данные выключают мутации |
| Ресурс | Обзор, YAML/diff/apply/export, события, логи/период/pause/export, exec fixture, история rollout | ResourceVersion увеличивается; операции записаны с неизменным target; exec знает help/pwd/ls/clear, остальные команды не исполняются |
| Операции | Реплики, restart/rollback, create, delete; properties по kind (image, route host/TLS, PVC, config, secret fixture, operator channel, roles, node, build) | Локальные свойства/версия изменяются, удаление убирает ресурс; неподдерживаемые действия disabled с причиной |
| Jenkins | Все джобы, подключение/папки/поиск, параметры, job detail/config, очередь/история, pipeline stages, input approval, логи/pause/export, тесты/detail, артефакты, изменения, rerun | Персональные таймеры запусков; остановка queued/running; стадия Input ждёт ответа; заданный error/success; артефакты скачивают демонстрационный текст |
| Knowledge | Дерево/поиск страниц, read/edit/create, Markdown formatting/table/code, пространства, история/compare/restore, комментарии, экспорт, conflict editor | Симуляция чужой правки вызывает сравнение при сохранении; merged версия сохраняется; restore создаёт новую версию |
| Cluster расширения | Топология, метрики/диапазон/PromQL fixture, alerts, RBAC matrix/binding, operator install plan, CRD form, node cordon/drain/PDB, port-forward | Настройки дают видимый результат; PDB блокирует drain; local-port collision блокирует второй проброс; каждый target зафиксирован |
| Общий UX | Связь с выбранным разговором, narrow layouts, original theme variables, close/cancel/Escape/outside | Нет browser alert/confirm; новые модальные окна используют native dialog и удаляются после закрытия |

## Контракт с shell

- `window.SuiteTasksOps.open('tasks' | 'scm' | 'ops', { tab: 'jenkins' | 'knowledge' })` — открыть панель/раздел.
- `suite:agent-request` — `{prompt,text,source,surface,project,...context}`. Только подготовка draft, не скрытая отправка.
- `suite:task-selected` — `{key,title,description,criteria,project}`. Существующие разговоры не должны перезаписываться.
- `suite:scope-change` — перерисовать видимый проект; fixture-банки задач, Git и Knowledge независимы по имени проекта. Cluster ресурсы разделены по зафиксированному cluster/namespace, поэтому общий кластер может переиспользоваться между проектами.

## Проверка автора модуля

- `node --check design/suite-prototype-tasks-ops.js` — пройдено.
- Ручной обзор обработчиков: modal close/cancel, archive restore, captured target, escaped user strings, keyboard-native controls, disabled reasons.
- Браузерную проверку общего прототипа проводит основной агент после сборки модулей. Автор этого модуля не выдаёт статический обзор за live UI тест.

## Итерация критики и исправлений

1. Устранено повторение Atlas в других проектах: Nova имеет NU-91 и layout-файл/репозиторий; Ledger — LG-73/COPY; новый проект начинается пустым. Git/Tasks/Knowledge fixture-банки мигрируют при переименовании проекта.
2. Исправлена ошибка расположения обработчиков: свойства ресурсов ошибочно были в showPR и блокировали approve. Обработчики перенесены в ресурсный диалог. Основной агент перепроверяет живой PR путь.
3. Архив задачи получил восстановление; clone очищает прошлые PR/файлы, первый PR в пустом репозитории имеет корректный ID.
4. Сохранены прежние drag handles; переключение панели не уничтожает управление docking.
5. Jenkins использует таймер каждого запуска; running/queued можно остановить. Вопрос Input не пересоздаётся при каждом tick, поэтому пользовательский текст сохраняется. Поиск сохраняет фокус при обновлении списка.
6. ДЕВ/ИФТ, namespace и фильтры восстанавливаются по проекту. Ресурсы общего кластера могут переиспользоваться, но запущенная операция захватывает собственный target.

## Следующие live сценарии проверки

- Atlas → Tasks → GC-249 → take → вернуться → история разговора сохранена; Nova → только NU-91, собственный repo.
- Tasks → создать → время 1.5h → пользовательское поле → bulk archive → восстановление.
- SCM → stage block → commit → push; More → stash → apply; More → conflict → ручной результат → resolved; PR184 → approve → merge.
- Operations → Jenkins → deploy → launch → Input через 6 секунд → свободный комментарий/continue → Tests → Artifacts; отдельный запуск stop до завершения.
- Cluster → ИФТ → API → scale → target receipt; Pod → port-forward → collision → stop; Node → drain → PDB block → retry; Metrics → name/range; Operators → CRD create.
- Knowledge → edit → simulate concurrent change → save → compare/merge; history compare → restore new version.

## Предел полноты и следующие специализированные экраны

Этот модуль закрывает перечисленные интерактивные пути, но не доказывает буквальную копию каждой версии Jira/Bitbucket/Jenkins/OpenShift:

- Tracker: глубокая epic-иерархия, формулы custom fields, полноценный burndown/velocity, схемы корпоративных переходов, remote conflict/permissions и пагинация огромного трекера ещё нуждаются в конкретизации по доступным capabilities. Текстовое custom field и массовые действия уже доступны.
- Git: один блок на fixture файл, поэтому stage block не моделирует несколько независимых блоков; нет графического rebase todo, blame, server branch permissions и ревизий комментариев после нового PR head. Conflict resolution, stash, cherry-pick и branch compare уже интерактивны.
- Cluster: формы node/storage/operator/CRD иллюстративны. Не прорисован каждый установленный console plugin/CRD или edge case rollout. PromQL не исполняется. YAML и свойства не являются универсальными валидными манифестами. Target console parity сверяется на рабочей машине.
- Jenkins: replay редактор Jenkinsfile, credentials management, сложные matrix pipeline и выбор агента исполнения не прорисованы полностью; базовые job/build/queue/input/log/test/artifact пути доступны.
- Knowledge: редактор Markdown, не полный WYSIWYG/Confluence schema; нет inline comments на выделение и полноценной обработки бинарных вложений. Version compare/restore и сохранение конфликта уже доступны.
- Общие: состояние живёт до reload, окна не имеют общего backend; все цифры/события — fixtures; нет реальных TLS/credentials/RBAC/MCP/Windows проверок. Названия подключений вымышленные.

Никакую runtime-карточку нельзя закрывать этим документом. Эти пределы не являются разрешением пропустить соответствующие требования при реализации после согласования макета.

## Общий реестр подключений — последняя интеграция макета

Jenkins, OpenShift/Kubernetes, Bitbucket и база знаний читают `SuitePrototype.connections()` с фильтрацией по текущему проекту. Их селекторы обновляются после `suite:connections-changed`; новая запись в настройках появляется без перезагрузки макета.

- Один `connectionId` переиспользуется в нескольких проектах. Выбранное подключение сохраняется по проекту/инструменту.
- Известные `fixtureKey` подключают только явно заданный демонстрационный адаптер. Новое подключение без `fixtureKey` показывает пустое состояние «данные ещё не получены», не копию Atlas. Отсутствие привязки показывает настройку подключений.
- Запуск Jenkins сохраняет собственные `connectionId`/название/стенд. Переключение селектора не меняет его назначение.
- Cluster cache keyed by `connectionId + cluster + namespace`; операция захватывает target. Для нового адреса недоступны создание/сравнение до получения возможностей.
- PR bank keyed by `project + connectionId`; локальный Git остаётся доступен без forge, remote actions требуют подтверждённого fixture адаптера.
- Knowledge bank keyed by `project + connectionId`; выбор пространства учитывает namespace из настройки и доступные fixture pages.
- Переименование проекта переносит ключи состояния, не создаёт новый пустой банк.
- Settings должен удалять `fixtureKey` при изменении адреса/типа предустановленного подключения. Переименование подписи само по себе не меняет адаптер.

Live-проверка: добавить второй Jenkins для Atlas → выбрать его в Operations → список пуст без чужих джоб; снять все Jenkins-привязки → экран «Настроить подключения»; вернуть Payments → прежние fixture запуски сохранены. Аналогично для cluster/forge/knowledge. Эти действия изменяют только состояние макета, не подключаются к адресам.

## Закрытый дополнительный срез: история Git, повторное review, эпики и аналитика

Добавлены только интерактивные экраны макета; Git/API/CLI не запускаются.

- **Граф истории:** Git → «История» → «Граф истории». Переключатель «Ветка графа» показывает текущую ветку или демонстрацию нескольких линий; нажатие коммита открывает его контекст. Пустая история не заменяется Atlas-данными.
- **Blame:** Git → «Другие действия Git» (`⋯`) → «Авторство строк · Blame». Выбор файла, переключатель пробелов, строка/автор/commit и переход к контексту. При отсутствии снимка файлов показано пустое состояние.
- **Rebase todo preview:** то же меню → «Interactive rebase · план», либо «История» → «Подготовить rebase». Действия pick/reword/squash/fixup/drop, перестановка вверх/вниз, редактируемый reword. Первый сохраняемый squash/fixup, пустой reword и удаление всех коммитов блокируют предпросмотр с объяснением. «Сохранить план» сохраняет только todo, не меняет историю; доступен текстовый экспорт.
- **Новый PR head:** PR #184 → «Изменения» → «Комментарий к строке 38» → добавить комментарий → «Обзор» → «Новый commit · демо». Approve сбрасывается, checks становятся pending, комментарий помечается «Устаревший контекст» и сохраняет свой commit/snapshot. «Открыть исходный контекст» не переносит строку на новый head. «Проверить новый head» → «Отметить просмотренным» снимает необходимость просмотра; затем отдельно нужны проверки и approve для текущего SHA. История head доступна из обзора.
- **Эпик ↔ дочерняя задача:** Tasks → «Фильтры» → «Эпики проекта» → `GC-EP1`, `NU-EP1` или `LG-EP1`. Состав эпика меняется с выбором задач, перенос из другого эпика отмечен. Дочерняя карточка содержит ссылку назад на эпик. «Изменить эпик»/«Привязать к эпику» доступны в деталях задачи. Удаление связи не удаляет задачу/историю/разговор. Поменять тип эпика с дочерними задачами на обычную задачу нельзя до переноса детей.
- **Burndown / Velocity:** Tasks → «Спринт» → «Аналитика спринта». «Тип графика»: Burndown/Velocity. Для Burndown работают выбор спринта и «День спринта»; отдельно показаны остаток, выполненные SP и изменение объёма. Для Velocity нажатие столбца показывает состав показателя; незавершённый текущий спринт исключён из средней скорости. Цифры прямо отмечены как fixture история и не выдаются за вычисленные по живому трекеру.

Проверки автора: `node --check design/suite-prototype-tasks-ops.js`, `git diff --check` — пройдены. Общий браузер автор модуля не трогал; live пути переданы основному агенту. Ранее перечисленные отсутствующие graph/blame/rebase/head-review и epic navigation/simple charts перекрыты этим срезом; полный vendor workflow/schema и реальная расчётная аналитика остаются вне интерактивной симуляции.

## Service Mesh: DestinationRule и EnvoyFilter в Kubernetes и OpenShift

Срез KUX-03 интегрирован в существующий путь «OpenShift / K8s → Service Mesh». Панель использует тот же реестр подключений, стенд и namespace; активная категория остаётся видимой в узкой горизонтальной ленте. Новое подключение без fixtureKey не получает фиктивного Istio discovery или чужих объектов.

- Список собственных fixture-объектов, поиск, карточки «Обзор / YAML / История», экспорт YAML, создание, редактирование, diff, локальное применение и удаление.
- DestinationRule: host, subsets и trafficPolicy. Поля subsets/trafficPolicy редактируются как структурированный JSON, чтобы не ограничивать пользовательские параметры только несколькими переключателями. Неизвестные поля полного документа сохраняются между формой и YAML. При существующем workloadSelector.matchLabels область клиентских workload показана в описании.
- EnvoyFilter: workloadSelector.labels, несколько configPatches, перестановка patch вверх и удаление, applyTo, match.context, полный match и patch с operation/value. Пустой selector прямо показывает все workload namespace и особую область root namespace; targetRefs показываются отдельно и не превращаются в namespace-wide selector. Одновременные targetRefs и workloadSelector блокируются.
- CRD-доступность раздельная для двух типов: «Доступен», «CRD не установлен», «Нет прав на чтение», «Только чтение (RBAC)». Missing CRD и read denied скрывают список соответствующего типа; read-only оставляет просмотр и экспорт, отключая изменения. Настройки сценария привязаны к captured connection/cluster/namespace. Наличие платформы не считается доказательством наличия CRD.
- У Mesh-объектов отсутствуют generic replicas, rollout, exec и контейнерные логи. Сохранение manifest не выдаётся за подтверждение применения к proxy.
- Все модификации фиксируют connectionId, имя подключения, cluster, environment и namespace до открытия редактора. Raw-изменение namespace, kind, имени, версии API, UID или resourceVersion относительно открытого объекта отклоняется; новый объект не принимает серверные UID/resourceVersion. Diff показывает конкретную цель. Применение повторно проверяет версию и доступность.
- В preview доступны воспроизводимые исходы «Успех», 409, 422 и 403. Ошибка сохраняет черновик и не меняет fixture. Успех обновляет rv, историю и журнал локальных операций.

Ограничения намеренно видимы в UI: локальный YAML parser принимает maps/sequences, строки, числа, boolean, null и JSON flow. Anchors, tags, block scalars, несколько документов и inline mapping после элемента списка не поддерживаются; они вызывают ошибку с сохранением текста. Для такого документа можно использовать JSON либо канонический YAML, сформированный макетом. Это не универсальная YAML-библиотека и не schema-validation Istio. Не выполняются discovery, SSAR, server-side dry-run, istioctl analyze или запрос proxy status. В рабочем приложении нужны полный parser и реальные served-version/schema/capability ответы.

Официальные источники, сверены 2026-10-13: [Istio DestinationRule API](https://istio.io/latest/docs/reference/config/networking/destination-rule/) и [Istio EnvoyFilter API](https://istio.io/latest/docs/reference/config/networking/envoy-filter/). В fixture использованы networking.istio.io/v1 для DestinationRule и networking.istio.io/v1alpha3 для EnvoyFilter; production adapter обязан выбрать served version по discovery. Примеры составлены для макета самостоятельно.

Точные live пути:

1. Operations → OpenShift / K8s → Service Mesh → «Подключение кластера»: «Корпоративный кластер» / «Sandbox». Ресурсы «checkout-api-policy» и «checkout-api-timeout» для payments.
2. «Доступность CRD и права» → «Доступность DestinationRule» либо «Доступность EnvoyFilter». Проверить missing/read denied/read-only отдельно; вернуть «Доступен».
3. Карточка → «Редактировать» → Форма: Host, Subsets, Traffic policy либо selector/patches → «Проверить diff» → «Применить в макете».
4. Редактор → YAML: поле `#stoMeshRaw`. Неполный JSON, невалидный YAML или изменение namespace должны показать `#stoMeshEditorError` без изменения объекта.
5. Preview → «Демо исход применения»: 409/422/403; возврат к «Успех» позволяет применить тот же черновик. Просмотреть историю и журнал captured targets.
6. Карточка → «Удалить» → подтверждение с Kind/name/target/rv → «Удалить в макете». В режиме read-only действие недоступно с причиной.

Статическая проверка автора: node --check и git diff --check пройдены. In-memory проверки проверили roundtrip канонического YAML для обоих объектов, сохранение неизвестного поля, ошибки синтаксиса, дубли ключей, namespace/UID/resourceVersion/apiVersion mismatch, пустой host и selector/targetRefs conflict. Живой браузер проверяет основной агент; реальные Kubernetes/OpenShift/Istio операции этим не проверены.
