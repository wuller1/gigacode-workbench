# Автономное расширение GigaCode Workbench

Data runtime: перед переносом БД прочитай [DATABASE-RUNTIME-HANDOFF](docs/suite/DATABASE-RUNTIME-HANDOFF.md). Там описаны рабочий код, настройка MCP, повторяемые проверки и оставшиеся gaps. Сначала сравни существующий код пользователя; не заменяй более удачный без предметного сравнения.

Обновление 14.10.2026: добавлена рабочая IDE на Theia с Java/Python/frontend расширениями, общими с агентом buffers, семантическими операциями, build/test/debug bridge и восстановлением. Установка, перенос и границы проверки: [IDE-RUNTIME-HANDOFF](docs/suite/IDE-RUNTIME-HANDOFF.md). Полная матрица Ultimate остаётся отдельной пофункциональной приёмкой.

Этот файл — единая точка входа для агента на рабочем компьютере, которому поручено объединить существующие реализации пользователя с полным рабочим пространством браузера, IDE, трекера задач, эксплуатации и баз данных. Текущая стадия — реализация: прямое поручение пользователя от 14.10.2026 снимает прежний prototype-only запрет и разрешает любые необходимые функциональные/UI/UX правки. Не просить повторного одобрения уже порученной реализации. Исторические gate-формулировки ниже не отменяют это поручение; тестирование и сохранение более удачного существующего кода обязательны.

## Ожидаемый результат

Сохрани текущую оболочку Electron и существующий CLI. Развивай один продукт с общей иерархией `Project → Task → Session/Role` и восемью рабочими пространствами:

1. **Browser Lab** — обычная работа с несколькими вкладками, управляемая агентом автоматизация, DevTools-подобные console/network/elements, responsive preview, screenshots и воспроизводимые сценарии.
2. **IDE** — редактор, файлы, поиск, Git, терминал, diagnostics, LSP, запуск/тесты и DAP для Java, Python и React/TypeScript.
3. **Design & Artifacts** — critical brief, flow/state matrix, интерактивные responsive макеты, versions/comments, количественный audit, handoff, проверка реализации и корпоративный UI kit с tokens/components/original icons/templates/reviewed releases.
4. **Tasks** — собственный трекер уровня повседневной работы Jira: list/board/timeline, требования, acceptance criteria, связи, подзадачи, комментарии, история и связь с сессиями/артефактами/проверками.
5. **Operations** — единый control center для OpenShift/Kubernetes, Jenkins и корпоративного аналога Confluence через реальные MCP/API/CLI adapters.
6. **Data** — DataGrip-подобный database workbench: connections, schema explorer, SQL consoles, result grid/editing, transactions, explain, history, import/export, diagrams и безопасная работа агента.
7. **Source Control & Review** — локальный Git, change sets агента, clone/fetch/pull/push, ветки/worktrees и pull requests/review/approvals через корпоративный MCP.
8. **Chat** — основной разговор, план, очередь, вопросы, subagents и компактные tool cards с переходами в остальные пространства.

UI/UX — главный критерий. Функция не считается готовой, пока пользователь не может найти её, понять фактический target, выполнить типичный сценарий без чтения документации, увидеть состояние/ошибку и безопасно восстановиться.

## Что прочитать

Сначала прочитай `AGENTS.md`, `docs/IMPLEMENTATION_STATUS.md`, затем:

- `docs/suite/README.md` — границы и карта документов;
- `docs/suite/UX-FOUNDATION.md` — обязательная компоновка, interaction rules и метрики;
- документ текущей области: `docs/suite/BROWSER.md`, `docs/suite/DESIGN-AND-ARTIFACTS.md`, `docs/suite/IDE.md`, `docs/suite/TASK-TRACKER.md`, `docs/suite/OPERATIONS.md` или `docs/suite/DATABASE.md`;
- `docs/suite/DESIGN-SYSTEM-AND-UI-KIT.md` и `ui-kit/README.md` для корпоративной библиотеки, component gallery, provenance, forge/package binding, releases и consumer updates;
- `docs/suite/SOURCE-CONTROL.md` для Git и корпоративного аналога Bitbucket;
- `docs/suite/CONNECTIONS-AND-SETTINGS.md` перед настройкой MCP, адресов и credentials;
- `docs/suite/DEVELOPER-WORKFLOW.md` перед навигацией, Project bindings и cross-workspace flows;
- `docs/suite/COMPETITOR-CAPABILITY-MATRIX.md` для проверки полноты и выбора переносимого pattern;
- `docs/suite/COMPETITOR-GAP-AUDIT.md` для решений adopt/adapt/defer/reject и оставшихся gaps;
- `docs/suite/AGENT-RUNTIME-AND-ROLES.md` для системных инструкций, ролей, analyst/SDD, queue/questions, memory, retries и subagents;
- `workbench/docs/ARTIFACTS_AND_QUESTIONS.md` перед Question UI/runtime: durable Task/Session queue, один active overlay, choices+freeform, exact-origin receipts и restart/stale semantics;
- `docs/suite/LIFECYCLE-AND-SETTINGS.md` для CRUD/archive, Settings, desktop chrome и диагностики;
- `docs/suite/DEPENDENCY-SECURITY.md` для Sprut и уязвимых версий библиотек;
- `docs/suite/ADAPTER-CONTRACTS.md` и `app/shared/suite-contracts.ts` перед backend-интеграцией;
- `docs/suite/DELIVERY-PLAN.md` и `docs/suite/ACCEPTANCE.md` перед реализацией и завершением среза;
- `design/suite-workspace-prototype.html` как интерактивный визуальный контракт, а не источник демонстрационных backend-данных.

Существующие системные правила и роли не переписывай заново. Перед интеграцией прочитай точные пути: `workbench/SYSTEM_PROMPT.md`, `workbench/docs/ROLE_PROMPT_BINDING.md`, `workbench/docs/ROLE_ROUTING.md`, `workbench/docs/CUSTOM_PROFILES.md`, `workbench/docs/SHARED_MEMORY.md`, `workbench/docs/ARTIFACTS_AND_QUESTIONS.md`, `workbench/docs/NATIVE_MOCKUP_ARTIFACTS.md`, `workbench/docs/BUNDLED_CLI_RUNTIME.md`, `workbench/docs/QWEN_BASELINE.md`, `workbench/docs/GIGACODE_COMPATIBILITY.md`, `workbench/docs/ADAPTIVE_EXECUTION.md`, `workbench/docs/PIPELINES.md` и `workbench/docs/DOCUMENTATION_AND_RETROSPECTIVE.md`. Перенеси полезное поведение в native UI/typed contracts, сохраняя фактические ограничения CLI.

Не загружай все документы в один контекст. Для слабой модели выполняй одну карточку из `suite/implementation-plan.json`, сохраняй checkpoint по `suite/checkpoint.example.json`, затем загружай следующую карточку с её ссылками и acceptance IDs.

## Обязательный аудит уже написанного кода

Пользователь сообщил, что в его рабочем репозитории уже есть реализации, сделанные другими агентами. Не удаляй и не переписывай их целиком.

1. Зафиксируй текущий commit, dirty files, команды запуска и отдельный тестовый `userData`.
2. Найди владельцев состояния, IPC, browser views, editor buffers, tasks, MCP и database connections. Не заводи рядом вторых владельцев.
3. Для каждого существующего модуля заполни `suite/migration-inventory.example.json`: `present`, `evidence`, `owner`, `data model`, `working scenarios`, `gaps`, `reuse/repair/replace`.
4. `present` подтверждается кодом и воспроизводимым сценарием. Кнопка, тип или текст агента не являются доказательством.
5. Составь mapping старых команд на канонические команды из `app/shared/suite-contracts.ts`. Сохраняй совместимый adapter, пока данные и callers не мигрированы.
6. При конфликте схем сделай версионированную миграцию и резервную копию. Не поддерживай два расходящихся хранилища после проверенного перехода.
7. Сохрани полезные UX-паттерны и работающие integrations. Замени только то, что не проходит требования, небезопасно или создаёт второго owner.
8. Для каждого решения `reuse/repair/replace` приложи сравнение существующего и предлагаемого варианта на одних сценариях: полнота, число действий и время до результата, восстановление после сбоя, доступность, производительность, сопровождение, совместимость данных и фактические тесты. Не сравнивай макет новой функции с живой старой функцией как равные доказательства.
9. Если существующий вариант по подтверждённым сценариям **существенно лучше** предлагаемого и их нельзя совместить без ухудшения, не перезаписывай его. Сохрани текущий owner и данные, подготовь альтернативу в изоляции, закончи всю независимую работу и только затем задай пользователю один конкретный вопрос: какой из двух уже проверяемых вариантов оставить. Дай рекомендацию, аргументы, измерения, screenshots/diffs, migration impact и rollback. До ответа действует существующий вариант.
10. Если преимущества можно объединить без второго owner, выбери `reuse` или `repair` и перенеси только недостающий контракт. Не спрашивай пользователя о техническом выборе, который уже однозначно следует из evidence. Если фактов недостаточно, решение остаётся `audit`, а не превращается в `replace`.

## Архитектурные ограничения

- Renderer вызывает только `window.workbench.invoke` и получает адресные events. Credentials, native drivers, child processes и network clients остаются в main/worker process.
- Один `CommandBus` маршрутизирует UI и agent actions через одинаковые типизированные команды. Агент не получает скрытый привилегированный путь.
- Каждый вызов содержит `projectId`, при необходимости `taskId`, target identity, correlation/operation ID и ожидаемую revision. Backend проверяет область заново.
- Долгие и внешние операции имеют persisted operation record, progress, cancel semantics и recovery по external ID. Не повторяй неизвестный POST/DDL/deploy/build.
- Read, propose и mutate различаются. Опасная операция сначала показывает diff/SQL/manifest/parameters и точный target; фактический результат подтверждается readback.
- Секреты сохраняются через ОС/корпоративный credential provider. В state, логи, prompt, task description, exports и Git попадают только `secretRef`.
- Remote web content, HTML preview, database values, cluster resources и документы считаются недоверенными данными. Они не получают app preload или право командовать агентом.
- MCP adapter строится по фактическим `tools/list`/schemas. Не угадывай имена методов корпоративных серверов. Capability может быть `unavailable`, и UI должен это честно показывать.
- Существующие browser, terminal, workspace, artifact, Task и session services расширяются; второй универсальный контроллер запрещён.
- GigaCode/Qwen CLI является execution transport. Назначения, очередь/outbox, бюджеты, leases, pause/resume admission, stop/cancel, retry classification, checkpoints, join и recovery принадлежат native host services и управляются из UI. Не выдавай вызов CLI-команды или prompt-инструкцию за полноценное управление subagent.
- Роль выбирает AI router по пользовательскому запросу, Project/Task, текущему stage, выбранному workspace/resource, accepted requirements, риску и доступным capabilities. Ручного role selector нет: UI показывает выбранную роль, причину, confidence и captured/actual binding; смена применяется на safe boundary и не меняет permissions.

## Порядок реализации

Канонический порядок задаёт `dependsOn` в `suite/implementation-plan.json`, а `docs/suite/DELIVERY-PLAN.md` объясняет этапы. Бери карточку только после evidence по всем её зависимостям; независимые карточки можно вести параллельно. Внутри каждой карточки доводи один вертикальный сценарий до реальной проверки. Опорная последовательность:

0. **Audit & bindings:** заполни inventory для текущего кода, зафиксируй owners/migrations/evidence и только затем включи live capability inspector и project bindings (`S0-01`, `S0-02`).
1. **Foundation:** activity rail, workspace tabs, command palette, quick open, shared selection/target bar, persisted layout, status center, unified operation drawer, keyboard/focus/accessibility. Сначала перенеси существующие панели без регрессий. Сохрани queue, questions/free answer, model/reasoning/context, Todo, subagents, artifacts, Markdown, archive и settings. В нижней строке composer ветка слева, автоматически выбранная роль и единая кнопка model/reasoning справа; reasoning настраивается в popup модели. Контекст — цветное кольцо вокруг отправки без постоянных процентов. При переполнении сначала скрывается ветка; reasoning и отправка не обрезаются. Роль доступна для объяснения, но не для ручного выбора.
2. **Browser:** укрепи текущий `BrowserService`; добавь target revisions, console/network/DOM diagnostics, downloads/permissions, trace recipes и adapter для корпоративной browser identity.
3. **Design foundation:** как только закрыты browser-зависимости, сделай versioned artifact store, safe preview, brief/state matrix и responsive interactive prototype (`SD-01`, `SD-02`). Не жди всего IDE для этого среза.
4. **Source control:** полноценный diff/change set, затем локальные Git operations, после этого MCP forge/PR/review/approval/merge.
5. **IDE и design verification:** сначала S4-00: [исследование Ultimate](docs/suite/IDE-ULTIMATE-RESEARCH.md), адресные строки [матрицы](suite/ide-ultimate-parity.json) и [fixtures](suite/ide-engine-fixtures.json). В поставке уже есть рабочая Theia; сравни её с существующим кодом на одинаковых сценариях, проверь версии/лицензии/Windows. IntelliJ IDEA — основной UX-ориентир пользователя; саму IDEA/GigaCode IDE не встраиваем и companion plugin по умолчанию не создаём. Развивай единый document authority, search/symbols/diagnostics, LSP, tasks/tests и DAP по фактическим незакрытым проверкам. После `S4-02` доведи tokens/components/inspect/review/handoff (`SD-03`), а после `SD-03` и browser recipes — сравнение с живой реализацией (`SD-04`). Затем развивай корпоративный starter/catalog (`SD-06`), repository/review/release channels (`SD-07`) и context-aware agent publication/consumer updates (`SD-08`). Не называй `specified` components готовыми.
6. **Tracker:** расширь существующий Task aggregate и мигрируй текущие задачи; list/detail сначала, затем board/timeline/backlog. Не создавай несвязанные issues.
7. **Operations и dependency security:** Начни с существующего runtime [Jenkins/cluster handoff](docs/suite/OPERATIONS-RUNTIME-HANDOFF.md), сохрани более удачную рабочую реализацию.  общий adapter inventory и read-only overview; затем Jenkins, Kubernetes/OpenShift, knowledge и Sprut. Mutations добавляй только с preview/readback.
8. **Database:** connection vault и read-only query slice; затем schema, grid, transaction/DDL safety, editing/import/export/explain/diagrams и дополнительные drivers.
9. **Agent runtime:** probe role/model/reasoning, затем host-owned coordinator с durable queue/outbox, context/retries, profiles/memory/recipes, полноценные native subagent controls, native Chat controls и analyst/SDD slice. Question Queue реализуй как host-owned ordered state по Task/Session: одна active overlay-card, explicit answer confirmation, exact origin routing, idempotent receipt, defer/cancel/expiry и restart/stale tests; hidden coordinator traffic не является вопросом пользователю. Сначала докажи управление одним worker, затем двумя независимыми и join; не оставляй управление только в CLI/terminal.
10. **Cross-module workflows:** открыть task из diagnostics, приложить design/browser/CI/DB/Git evidence, создать change proposal, запустить проверку, зафиксировать receipt и вернуться в тот же Task.

Browser, IDE, tracker, operations и database появляются в navigation с первого foundation-среза, но недоступная capability показывает причину и действие настройки. Не подставляй fake success или фиктивные ресурсы.

## UI/UX gates для каждой карточки

До backend-кода опиши основной пользовательский путь и состояние интерфейса. Для каждого экрана обязательны:

- понятный default target и всегда видимые project/environment/connection boundaries;
- loading, empty, partial, stale, offline, permission denied, conflict, error и success/readback states;
- быстрый путь мышью и клавиатурой, сохранение focus и отсутствие keyboard traps;
- сохранённые размеры/вкладки без воскрешения несуществующего процесса;
- никаких постоянных технических форм в основном потоке: details/logs/schema раскрываются по запросу;
- compact activity cards для agent/tool operations вместо вывода полных логов в чат;
- destructive/restart/deploy/DDL action не прячется за неоднозначной иконкой;
- undo там, где операция локальная и обратимая; для внешней операции — точный follow-up и receipt;
- контраст, reduced motion, масштаб 100–200%, ширина 1024–1920 и отсутствие обрезанных главных действий;
- реальная проверка кликами/клавиатурой и screenshot review. DOM existence не доказывает качество UX.

Если функция не укладывается в общий shell, сначала исправь shell/interaction model. Не добавляй отдельный визуальный язык для database или DevOps.

## Работа с MCP и локальными адаптерами

В `integration.discover` собери фактический inventory. Для каждого adapter запиши:

- source: MCP/API/CLI/native;
- version/endpoint identity без секрета;
- capabilities и schemas;
- scopes/targets;
- auth method как `secretRef`;
- read/mutate risk class;
- health/latency/last successful read;
- retry/idempotency/recovery behavior.

Предпочитай уже подключённый MCP, если он даёт нужную capability и provenance. Локальный adapter добавляй для UX, streaming, protocol gaps или offline-функций. Не заставляй модель парсить необработанные CLI-логи, когда host может вернуть типизированный результат.

После discovery агент должен предложить mapping и применить безопасные read-only bindings самостоятельно. Изменения реальной инфраструктуры, запуск Jenkins с воздействием, apply/delete/scale, публикация документа и database mutations выполняются только в пределах конкретного поручения пользователя и показывают review surface по правилам продукта.

## Проверка и продолжение после обрыва

Для каждой карточки сохраняй в локальном task journal:

- card/acceptance IDs;
- цель и пользовательский сценарий;
- touched owners/files;
- до/после и migration revision;
- выполненные автоматические и живые проверки;
- screenshots/receipts/log references;
- оставшиеся неизвестные факты;
- один точный следующий шаг.

После сбоя прочитай checkpoint и actual Git/state, не повторяй внешнее действие только потому, что ответ потерян. Периодически компактируй journal в короткий verified checkpoint; необработанные логи остаются адресными evidence.

## Критерий выдачи результата

Срез готов только когда есть рабочий код, миграция/rollback, типизированный контракт, проверка обычного и ошибочного сценария, screenshot UX-review и обновлённый статус. В отчёте различай:

- реализовано и проверено в целевой среде;
- реализовано, но требует корпоративного endpoint/credential для live-проверки;
- описано следующим этапом.

Не называй весь Browser/IDE/Jira/DataGrip аналог готовым по одному вертикальному сценарию. Продолжай следующую карточку самостоятельно, пока не закончится порученный scope или не возникнет внешний блокер, который невозможно установить из проекта и доступных read-only источников.
