# Нативный Workbench в существующей GigaCode UI

Уточнение этапов от 2026-10-10: **M4** включает durable обмен сессий внутри проекта и между явно связанными проектами по [SESSION_COLLABORATION](SESSION_COLLABORATION.md). **M5** использует тот же broker для управляемых исполнителей: основной агент координирует независимые ветви, host контролирует зависимости, ownership, общий бюджет и безопасный dispatch. Общий результат принимается после join и интеграционной проверки, а не по числу зелёных карточек. Подробный контракт и вид панели — [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md). Это расширение существующих Task/Queue services, не ещё один движок задач и не новый обязательный профиль.

Дата плана: **2026-10-09**. Цель — перенести **весь подготовленный Workbench и спроектированную новую функциональность** в существующую Electron-оболочку пользователя. Конечный runtime — модули её существующего Node backend/Electron main, без PowerShell-процесса на каждый ход. Репозиторий прототипа находится на другом компьютере и здесь не изменён. Этот документ — конкретный план реализации и готовое задание, не отчёт о готовом UI.

Сохраняются установленный GigaCode CLI, его подтверждённые параметры/config, ACP и реальные MCP. Никаких патчей CLI, monkeypatch, private API Qwen, фиктивных host tools или скрытой подмены CLI отдельным model API. Если CLI не видит сервис оболочки через подтверждённый MCP/инструмент, он получает подготовленный контекст и возвращает предложение; backend сам применяет разрешённую операцию через внутренний API. Имена предлагаемых сервисов ниже **не имена ACP методов или существующих файлов прототипа**.

Нативный перенос — обязательный конечный результат M4 в [GIGACODE_UI_DEVELOPMENT_PLAN.md](GIGACODE_UI_DEVELOPMENT_PLAN.md). Временный PowerShell bridge допустим при переходе, не как постоянная архитектура. Сначала M0–M2: подробные локальные traces, исправление параллельности и state delivery без клика/reload, восстановление/429. Сразу в M3 нужны собственные window controls, настраиваемые панели, basic browser/terminal и baseline Task bindings; полный native Task workflow развивается в M4. M3 включает минимальный реальный bridge управления браузером и screenshot; M7 — расширенная browser automation. IDE Java/Python/React отложена в M12 после M10, без зависимости от optional M11.

## 1. Что переносим и что создаём заново

Статусы не смешиваются:

- **Исполнено в пакете:** локальные controller/memory/docs-impact и JavaScript design-metrics; имеются тесты. Они не образуют полноценный UI и не управляют всеми вызовами CLI.
- **Описано в пакете:** 9 профилей, 29 workflow, routing, инструкции, templates, capability policy и методы проверки. JSON/Markdown определяет процесс, но не исполняет его автоматически.
- **Спроектировано для UI:** native services, настоящий scheduler, автоматический ledger, окна, browser, agents, артефакты и интеграционные панели. Их предстоит реализовать и проверить в репозитории пользователя.
- **Требует целевой проверки:** возможности именно установленного GigaCode, модели, actual MCP permissions, Windows/Electron runtime и реальные внешние действия.

Пути далее относятся к корню поставки gigacode-workbench: документы/JSON, source/*.txt и готовые собственные SVG по assets/icons.json и manifest. Исполняемые исходники и тесты в source/*.txt — текст для чтения/переноса, не автоматически установленный runtime. Старые Python/JavaScript reference-файлы и PowerShell-файлы без расширения в финальную поставку не входят. При временном legacy запуске .ps1 создаётся локально; native backend затем обходится без него. SVG/JSON — обычные assets, они не требуют PowerShell-порта или генерации на turn.

### Полный каталог ролей и сценариев

| Профиль | Источник | Нативное представление |
|---|---|---|
| analyst | profiles/analyst.md | Совместное написание описания функциональности в выбранном формате, включая SDD; варианты, самопроверка и рекомендации в заданной области |
| spec | profiles/spec.md | Формальная проверка/доработка непротиворечивости, контрактов и критериев на назначенном этапе; не обязательный второй автор после analyst |
| backend | profiles/backend.md | Серверный код и применимая проверка поведения |
| frontend | profiles/frontend.md | UX, интерфейс, design contract и визуальная проверка |
| devops | profiles/devops.md | Среда, CI/CD, инфраструктура и подтверждение внешних операций |
| qa | profiles/qa.md | Проверка критериев на фактическом результате |
| reviewer | profiles/reviewer.md | Предметная независимая проверка при нужном риске |
| diagnostics | profiles/diagnostics.md | Воспроизведение, причины, инциденты и recovery |
| gigacode-ui | profiles/gigacode-ui.md | Electron, ACP и проверка живой оболочки |

Каждый ID сохраняется; профиль — политика поведения, а не обязательный отдельный процесс/субагент. Соответствующие существующие adapters/gigacode/agents/workbench-analyst.md, workbench-spec.md, workbench-backend.md, workbench-frontend.md, workbench-devops.md, workbench-qa.md, workbench-reviewer.md, workbench-diagnostics.md и workbench-gigacode-ui.md остаются экспортными адаптерами только для подтверждённого native agent формата. Основной UI не обязан создавать CLI-subagent ради переключения профиля.

| Группа | Все существующие файлы workflow |
|---|---|
| Быстрые | workflows/quick-answer.json, workflows/quick-backend.json, workflows/quick-frontend.json, workflows/quick-doc.json |
| Требования и освоение | workflows/discovery.json, workflows/specification.json, workflows/onboarding.json |
| Реализация и сопровождение | workflows/backend-feature.json, workflows/frontend-feature.json, workflows/behavior-change.json, workflows/bugfix.json, workflows/refactor.json, workflows/dependency-upgrade.json, workflows/data-migration.json, workflows/performance.json |
| Дизайн | workflows/ux-design.json, workflows/design-audit.json, workflows/design-system.json |
| Проверка и доставка | workflows/acceptance.json, workflows/review.json, workflows/security-review.json, workflows/pull-request.json, workflows/release.json |
| Эксплуатация | workflows/infrastructure.json, workflows/incident.json |
| Документы и улучшение процесса | workflows/documentation.json, workflows/retrospective.json |
| Разработка самой оболочки | workflows/gigacode-ui-feature.json, workflows/gigacode-ui-diagnostics.json |

Всего **29**, без объединения разных сценариев в одну универсальную «разработку». Сохраняются schema_version, ID, порядок stages, profile, instructions, required_artifacts, checks, kind, allow_na, capabilities и rework_targets. Quick-answer имеет один этап; остальные три quick — по два; documentation — три; retrospective — два. Короткие маршруты не обрастают скрытыми обязательными вызовами.

### Матрица существующего пакета → backend → UI → приёмка

Названия сервисов — логические границы внутри существующего приложения, не требование завести микросервисы или новый framework.

| Исходные файлы и нынешний статус | Native service | Элемент UI | Проверяемая приёмка |
|---|---|---|---|
| SYSTEM_PROMPT.md, CORE.md, BOOTSTRAP.md, docs/MAIN_WORK_PROCESS.md — инструкции | InstructionRegistry + PromptAssembler | Выбранные правила/профиль, краткие источники, текущий шаг | Новый контекст получает нужные правила; повтор не отправляет все профили; hash изменившегося источника инвалидирует cache. Модель следует ТЗ и отдельно предлагает улучшение без самовольного scope creep. |
| bundle.json, profiles/*.md, workflows/*.json, docs/PIPELINES.md — каталог | CatalogService | 9 профилей, 29 сценариев, пояснение текущего этапа | Каталог валидируется; чужой profile/capability, неправильный rework target и duplicate ID отвергаются; существующий run сохраняет snapshot определения. |
| docs/ROLE_PROMPT_BINDING.md, docs/ROLE_ROUTING.md — проект native binding/переходов | Существующие CatalogService + PromptAssembler + SessionService/Task writer | Role selector, инструкции по запросу, desired/pending/active, фактический delivery mode | Одна роль/stage, fingerprint и immutable capture; context-only не system override, недоставленный prompt не active, startup config не меняет глобальный env. |
| docs/MANAGED_SUBAGENTS.md — проект managed worker controller | Тот же Scheduler/SessionService + OperationLedger/WorkflowEngine | Исполнители Task, очередь, message/cancel/recovery/result | Один quota owner для чатов/coordinator/workers; cancel не terminal; lease expiry не останавливает CLI; native children не объявлены fully managed; stale candidate не принимается. |
| docs/ENTITY_LIFECYCLE_AND_EDITING.md — проект CRUD/lifecycle | Существующий Task/entity writer + LifecycleService как его модуль, без второго store | Create/edit/rename/archive/trash/restore, отдельный purge по scope | Captured ID/revision, idempotency и recovery; archive не cancel, soft trash не native delete, restore сохраняет ID и прежние outcomes; unknown не успешное удаление. |
| docs/TASK_TODO_PANEL.md — рабочий план агента | Native ACP plan после probe либо реальный host PlanService/tool; один revisioned store | Агент сам создаёт и перестраивает пункты, отмечает done/current/remaining; история показывает причину изменений | Стабильные IDs, replay reconciliation; выполненные пункты сохраняются. Reported done не formal pass, visual reorder не scheduler reorder; открытие панели не вызывает LLM. |
| docs/ARTIFACTS_AND_QUESTIONS.md — проект материалов и интерактивных вопросов | ArtifactService + Question/Answer projections у Task writer, actual bridge | M3 local preview и choices/free text; M4 requirement delta/resume; M6 edit/export | Draft/Answer receipt durable уже в M3; received/delivered/applied различаются, stale/double answer не применяется; настоящий файл/формат/версия, CAS edits, export через реальный generator. |
| docs/CHAT_FIRST_DESIGN.md, docs/COMPETITOR_FEATURE_PLAN.md — текущая композиция и адресные предложения | Общий PanelRegistry/LayoutService + versioned reference corpus | Разговор/composer, левая навигация, contextual plan/checks/materials, own assets | Нет обязательных Task tabs и конкурирующей навигации ролей; preview не объявляется готовым desktop; выбранные идеи не расширяют scope автоматически. |
| config/routing.json, docs/ADAPTIVE_EXECUTION.md, config/project.example.json, docs/PROJECT_SETUP.md — декларативная политика | RoutingService + ProjectContextService | Рекомендованный маршрут и короткое основание; смена при новых фактах | Tiny fix не запускает full SDD/всех агентов/docs/retro. Риск, ambiguity, impact, external effects меняют маршрут; формат ТЗ и количество строк сами этого не делают. Existing repo не перенастраивается. |
| source/workbench.txt — текст PowerShell controller; docs/CONTROLLER.md | WorkflowEngine | Этап, критерии, waiting/blocked/rework, счётчик попыток | Сохраняются переходы, revision/attempt checks, архивирование invalidated results, max attempts и pending guard. Reject не меняет состояние. |
| docs/JOURNAL.md; record/recover/journal в source/workbench.txt; templates/checkpoint.md, templates/handoff.md | EventStore + OperationLedger + RecoveryService | Лента фактов, checkpoint, открытые операции, точка продолжения | Pre-event сохранён до dispatch; неизвестное не replay; compact recovery и страницы не теряют tail; full export содержит весь журнал и integrity problems. |
| Evidence-проверки source/workbench.txt, docs/CHANGE_SAFETY.md, docs/PROMPT_EVALUATION.md | EvidenceService + ValidatorRegistry | Проверено / не проверено / неприменимо, версия и источник | Факт запуска приходит от инструмента. Старый build, 0 tests, пустой evidence, fail и unknown не становятся pass. Новый validator проверяется на clean/bad/empty. |
| templates/specification.md, templates/question.md, templates/defect.md, templates/incident.md, templates/release.md | RequirementService + ArtifactService | SDD, вопросы, дефект, инцидент, release checklist | Требование/decision связано с проверкой; изменение ответа инвалидирует только зависимые результаты. Есть отдельные proposed/accepted/implemented/verified статусы. |
| Решения в SYSTEM_PROMPT.md, CORE.md, docs/JOURNAL.md, docs/ZIDAO_PROCESS_TRANSFER.md; отдельного templates/decision.md в пакете нет | DecisionLedger | Принятое решение, предложение, противоречие, обоснование | Не выдумывается отсутствующий шаблон; сохраняются источник решения и версии; рекомендация не переписывает утверждённый SDD. Уже данное решение не спрашивается повторно. |
| source/memory.txt, config/memory-entry.example.json, docs/SHARED_MEMORY.md — helper плюс правила автосохранения | MemoryService + KnowledgeImportService | Scoped search, происхождение, конфликт, freshness, импорт | Global + текущий project; expiry → needs_verification; идемпотентный import; конфликт не затирает старое; новое полезное знание сохраняется без отдельного memory-agent на каждый ход. |
| config/bindings.example.json, config/profile-capabilities.json, config/authorization.example.json, docs/MCP_PROTOCOL.md, docs/MCP_PROFILE_SETUP.md — политика, не dispatcher | CapabilityRegistry + AuthorizationService + реальные MCP adapters | Доступные действия роли, ресурс/окружение, наблюдённый enforcement | Actual tool/schema/effect/scope подтверждены. Host проверяет собственный dispatch; неподконтрольные внутренние tools CLI не объявляются изолированными. Старое task authorization переиспользуется по scope. |
| config/design-quality.json; source/design-metrics.txt — PowerShell-текст с JavaScript helper внутри Get-DesignMetricsScript; docs/DESIGN_QUALITY.md; templates/design-contract.md, templates/design-report.md | DesignQualityService + browser measurement adapter | Контракт, матрица состояний, измерения, before/after, экспертные замечания | JavaScript переносится в native/browser module один раз при разработке, без PS wrapper на turn. Геометрия/контраст/coverage не заменяют экспертное ревью; unknown не pass; normative thresholds отличимы от project targets. |
| source/docs-impact.txt, config/docs-map.example.json, docs/DOCS_IMPACT_TOOL.md | DocsImpactService на локальном Git adapter | Затронутые документы, unmapped, staged mismatch, no-op rationale | Сохраняется index/worktree/base/rename семантика; карта false/unknown не даёт успех. No-op не вызывает модель и не объявляет semantic freshness. |
| workflows/documentation.json, workflows/retrospective.json, docs/DOCUMENTATION_AND_RETROSPECTIVE.md | DocumentationCoordinator + ImprovementSignals | Малый document delta; события для retro; 0–3 предложения | Документы обновляются по влиянию; retro только по значимому событию/запросу. Нет автоизменения prompts и бесконечного цикла reviewers. |
| docs/FLASH_MODEL_EXECUTION.md, docs/ZIDAO_PROCESS_TRANSFER.md — метод коротких заданий | TaskPacketBuilder + ModelPolicy + BudgetService | Назначение исполнителя, ограниченный packet, попытки, причины эскалации | Сохраняются критерий, плохой случай и источники. Лимит содержательных попыток вне модели; непроверенный alias не становится доступной моделью/vision capability. |
| adapters/gigacode/GIGACODE.fragment.md, adapters/gigacode/commands/workbench.md, все agents adapters; docs/GIGACODE_COMPATIBILITY.md | CliCompatibilityAdapter + optional export service | Диагностика совместимости, экспорт поддержанных native инструкций | Инструкции подключены реально поддержанным способом; native-agent allowlist проверен, иначе изолированная делегация не включается. Внутренний host API не выдаётся за CLI tool. |
| source/install-user.txt, source/prepare-scripts.txt; README.md, SETUP-AGENT.md, START-GIGACODE-UI.md, MANIFEST.txt, scripts.json | PackageImportService + native onboarding/migration view | Импорт пакета, отчёт, версия, rollback | Installer/preparation нужны для legacy/перехода, не на normal turn. Новый проект настраивается только по запросу; импорт Workbench не перезаписывает инструкции существующего repo. |
| source/test-workbench.txt, source/test-memory.txt, source/test-docs-impact.txt, source/test-design-metrics.txt, source/test-install-user.txt, source/run-tests.txt | Native contract/parity suite + migration fixtures | Раздельный отчёт unit/contract/live/target | Сценарии из текстовых тестов переносятся в текущий Node test runner; это не доказательство нового runtime. Legacy oracle запускается только на копиях; результаты native suite фиксируются заново. |
| docs/TASK_WORKSPACE.md, docs/PANELS_AND_IDE.md — спроектированная новая функциональность | Task projection/aggregate + общий PanelRegistry/LayoutService; поздние language adapters | On-demand task views, movable/resizable/tabbed panels, базовый browser/PTY сейчас; IDE позже | Стабильные panel/content bindings; hide/move не stop/spawn. Task/run revisions различаются, WorkflowEngine один; каскад IDE не блокирует M3/M4. |
| assets/icons.json, assets/icons/*.svg — готовые собственные знаки по каталогу; docs/ICON_LIBRARY.md, docs/GRAPHICS_AND_MOTION.md, docs/ASSET_RIGHTS.md, docs/DESIGN_IMPLEMENTATION_GUIDE.md | Native asset catalog/icon renderer + versioned reference corpus | Общие иконки, состояния, motion/reduced-motion и проверяемое происхождение | SVG/JSON импортируются как assets, не как PS runtime; локальная отрисовка/accessible names проверяются. Никакой загрузки чужого брендинга или вечного генератора иконок; новые материалы проходят rights check. |
| docs/DESKTOP_STATE_AND_CHROME.md, docs/DESKTOP_OBSERVABILITY.md — проектные требования и диагностические контракты | StateDelivery/Reconciliation + DiagnosticRecorder + WindowService внутри существующего backend | Актуальное состояние без клика, видимое восстановление, custom controls, локальный пакет диагностики для агента | Sequence/revision связаны через CLI/main/IPC/store/render; gap не теряет tail. No-pointer live test, bounded/redacted logs, actual read-only adapter; reload не считается исправлением. Это новый native код, не порт PS. |
| docs/BUNDLED_CLI_RUNTIME.md — проект собственного CLI runtime, готовый CLI в пакет не включён | RuntimeInventory/Manifest/Resolver + ProcessService и поздний RuntimeUpdateService | Версия/источник runtime, readiness, проверенный upgrade/rollback | M0 inventory/probe и права fork; M1 absolute-path spawn с runtimeRef на connection generation, без global PATH fallback. Ранняя packaging проверка до release; M10 atomic upgrade для новых задач, старые sessions сохраняют версию. Не объявлять Git/JDK/Python включёнными по факту поставки CLI. |

Все templates перечислены выше. Остальные документы остаются адресно открываемым справочным корпусом, а не обязательным prompt каждого хода: docs/ARCHITECTURE.md, docs/BOOTSTRAP_AUDIT.md, docs/DESIGN_PROCESS_SOURCE.md, docs/GIGACODE_UI.md, docs/GIGACODE_UI_DEVELOPMENT_PLAN.md, docs/OPEN_SOURCE_RESEARCH.md, docs/PARALLEL_SESSIONS_FIX.md, docs/QWEN_BASELINE.md, docs/UI_REFERENCES.md, docs/DESIGN_IMPLEMENTATION_GUIDE.md, docs/GRAPHICS_AND_MOTION.md, docs/ASSET_RIGHTS.md и docs/VALIDATION.md. Исторические отчёты сохраняют дату/проверенную версию; старые числа тестов не переносятся как результат новой реализации.

## 2. Целевая архитектура и эффективность

Task-путь и panels-path расширяют ту же архитектуру. В legacy source/workbench.txt task — описание-строка. Новый Task aggregate хранит goal/scope/project_mode/acceptance/decisions/questions/artifacts/evidence/revisions и ссылки threads/runs; не подменяет state controller. Сначала в M3 — базовая связь и проекция текущей задачи; в M4 — полный native Task с versioned requirements и bounded retrieval по [TASK_WORKSPACE](TASK_WORKSPACE.md). UI открывает обсуждение/план/diff/checks/materials по необходимости, не создаёт постоянный dashboard из всех видов.

PanelRegistry/LayoutService один для Task views, browser, terminal, files и tools. Стабильные panelId/contentRef сохраняются при move/resize/tab/hide; follow-task reference остаётся логическим slot, текущий resolved resource хранится отдельно. Session/Terminal/Browser/Buffer services владеют ресурсами; detach view не stop и не duplicate spawn. Layout revisions не являются Task/run revisions; реальные snapshot/CAS остаются per task/run. Native WebContentsView требует собственного main/bounds/visibility/attachment adapter, это не DOM div и не второй browser service. Детали — [PANELS_AND_IDE](PANELS_AND_IDE.md).

Доставка состояния является инфраструктурой этих представлений, не вторым WorkflowEngine: один владелец публикует versioned snapshot и последовательность событий, renderer делает наблюдаемую projection и сверяет gap/generation. Task/run revisions, transport seq и rendered seq различаются. Диагностика связывает их, не создавая ложных ACP полей; события должны отражаться без дополнительного input. WindowService и узкий preload управляют собственными minimize/maximize/restore/close без стандартного menu bar; diagnostics export остаётся локальным и читается агентом только через реальный файловый/MCP adapter. Контракты — [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md) и [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md).

CLI runtime имеет собственного native resolver/manifest, а не неявную зависимость от пользовательского PATH. ProcessService запускает конкретные абсолютные executable/arguments с runtimeRef, version/hash и connection generation; не патчит fork. Ранняя упаковка проверяет именно поставляемый runtime на целевой машине без глобального CLI и права его распространения. Upgrade меняет выбор новых sessions атомарно; активные дорабатывают закреплённую версию. Документ [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md) импортируется как проектный контракт, не как уже доставленный бинарник или гарантия включения всех development toolchains.

Использовать фактический язык, framework, persistence и IPC прототипа. Если backend уже вынесен из Electron main, он остаётся единственным владельцем. Не создавать второй SessionManager или параллельную БД в renderer. SQLite — допустимый вариант при отсутствии хранилища, после проверки драйвера с Electron ABI; это не требование заменить работающую БД.

~~~text
Existing renderer / windows
    └─ typed narrow IPC → existing main/backend, one state owner
          ├─ SessionService → AcpAdapter → installed GigaCode CLI
          ├─ WorkflowEngine / RoutingService / TaskPacketBuilder
          ├─ EventStore / OperationLedger / Evidence / Requirements
          ├─ MemoryService / Catalog / ArtifactService
          ├─ Scheduler / managed AgentTask / ModelPolicy
          └─ Git / Browser / Preview / MCP adapters
~~~

Native означает вызов функции/транзакции backend, а не запуск workbench.ps1 через спрятанную кнопку. Остаются необходимые внешние процессы: сам CLI, Git, PTY, dev server и фактические tools. Они имеют lifecycle/ownership; не нужно заменять Git собственным движком ради запрета subprocess.

Общие инструкции и неизменные профили читаются один раз на content hash; в turn входит нужная роль/этап, свежие факты и изменения. Context reuse допустим лишь при подтверждённом наличии этих версий в текущем контексте модели. Memory search scoped и ограничен, recovery по checkpoint/tail, документы по Git delta; большой журнал и все роли не перечитываются на каждой реплике. Streaming обновляет конкретный чат пакетами, не весь sidebar на каждый token. DTO и индексы производные, их rebuild не меняет журнал.

Измерять число запусков legacy scripts, подготовку контекста, локальную IPC/DB latency, размер packet, cold start, RSS и время до принятого результата. В steady state число запусков PowerShell для workflow/memory/docs/design на turn равно **нулю**. Это проверяемая цель архитектуры, не заранее обещанный выигрыш wall-clock или токенов.

## 3. Контракты native ядра, которые нельзя потерять

### Workflow, журнал и evidence

Сохранить команды как операции сервиса: list, validate, init, status, prompt, result-template, submit, resume, rework, cancel, verify, record, recover и journal. UI может дать им удобные кнопки; прежняя CLI syntax не обязательна, семантика обязательна.

- Состояния ready, waiting_input, blocked, needs_rework, blocked_budget, cancelled, completed различаются. Дополнительные running/cancelling состояния ACP turn не подменяют workflow status.
- Submission содержит run_id, workflow, stage, revision и attempt_id. Compare-and-swap проверяется внутри транзакции; два окна не принимают два результата одной ревизии. Rejected write не создаёт частичное событие/артефакт принятия.
- Accepted result требует точный комплект artifacts/checks. not_applicable только при allow_na с предметным объяснением и evidence. Missing tool, failure и unknown не являются неприменимостью.
- Rework архивирует результаты целевого и последующих этапов, сохраняет события, увеличивает попытку и меняет attempt_id. Cancel/resume не удаляет pending и не обнуляет budget; cancelled хранит предыдущий статус.
- action_started фиксируется до отправки эффекта с operation_id, target, intent, expected_result и reconcile. action_finished допускается только с проверенным outcome и evidence; action_unknown не закрывает действие. Pending блокирует completed и rework.
- Один writer и транзакционное событие/состояние. Live UI читает snapshot sequence + tail и обнаруживает пропуски. Idempotency локальной команды не означает exactly-once удалённого эффекта.
- Evidence хранится неизменяемыми версиями с SHA-256 **байтов**, размером, source/build/spec revision и scope. Замена accepted файла не «лечится» пересчётом hash. Исторические snapshots сохраняются; valid hash не доказывает истинность содержимого.
- Legacy paths разрешены только внутри artifacts/ или evidence/; symlink/junction/reparse сохраняют строгий отказ reference. В native import исключить traversal/escape и гонку чтения подменяемого пути; копировать проверенные байты в owned immutable storage до публикации записи.
- Compact recover показывает checkpoint, открытые операции, актуальные records и ограниченный tail с omitted/has_more; full проверяет всю историю. Ни одна recovery-команда не повторяет внешние действия.

Автоматический журнал охватывает вызовы, которые host фактически наблюдает/выполняет. ACP не обещает раскрыть все внутренние шаги CLI: не изобретать pre/post event скрытого действия. Для видимых tool events хранить доступные IDs и payload projection; для host-owned вызова — фактические argv/parameters, результат и очищенный receipt. Модельный пересказ отмечать отдельно.

### Точная совместимость hash и JSON

Legacy workflow/state имеет schema_version=1 и workflow_digest_algorithm=python-json-v1; раннее отсутствие поля обрабатывается как документированный legacy-вариант, не как произвольный алгоритм. Нативный codec должен получить тот же SHA-256:

1. Рекурсивная сортировка строковых ключей по **Unicode code points**, не locale и не стандартный UTF-16 sort JavaScript.
2. Семантика Python JSON ensure_ascii=False, sort_keys=True и разделители **", "** / **": "**; UTF-8 без BOM в хешируемом canonical payload. Порядок массивов сохраняется; Unicode не нормализуется.
3. Сохраняются case-sensitive keys, пустые/одноэлементные массивы, null/bool, ISO date как строка, точные integer значения. Обычный JSON.parse не может молча округлить integer вне safe range: нужен lossless parser/number-token или явный отказ с причиной.
4. Canonical legacy digest не принимает дробные/exponent workflow metadata. Не заменять его JSON.stringify, который выдаст другой hash; не перевычислять старый digest «для удобства». Неизвестный алгоритм/схема — quarantine и явная миграция.
5. Reject malformed JSON, duplicate keys и unpaired surrogate; объектные ключи не должны превращаться в prototype mutation. Golden vectors включают кириллицу, emoji/astral keys, BMP, escapes, дату-строку, большой integer, arrays и case-distinct keys.

Это ограничение относится к legacy canonical workflow/memory digest, **не запрещает** дробные design thresholds или время измерения в других versioned форматах. Новая схема native DB/export имеет собственную версию; legacy original bytes и hash остаются доступными для сверки. Нельзя молча изменить алгоритм существующего run.

### Общая память и автоматическое сохранение

Перенести remember/search/get/import/retire/verify, категории preference/project_fact/decision/tool_knowledge/lesson, scope global/project, project_id, status verified/needs_verification/proposed/retired, sources и expires_at. Project fact не становится global. Search по умолчанию global + выбранный проект с limit 25, максимум 100; чужой проект не подмешивается.

Сохранить input_digest, record_hash, integrity_hash, sequence/revision и цепочку events.previous_hash/hash; снимки retirement/replacement остаются историей. Повтор payload не растит store; повтор retired payload не реактивирует его. Конфликт одного scope/key сохраняет старое и proposed, а не две одновременные подтверждённые истины. ReplaceId/retire требуют текущую ExpectedRevision. Просроченное возвращается как effective_status needs_verification. Структурно полный источник не равен фактической истине.

Автосохранение — реакция на принятое решение, полезное проверенное наблюдение, передачу/завершение задачи. Host детерминированно сохраняет событие; модель при необходимости предлагает краткую knowledge entry, которую проверяют schema/provenance/scope/conflict rules. Не требуется отдельный memory-agent на каждый turn. Секреты и полные чаты не становятся памятью; plaintext store не называется secret vault.

**Два разных импорта:** (a) перенос существующего проверяемого Workbench memory.json сохраняет IDs, статусы и hashes, затем отдельно оценивает freshness; (b) извлечение знаний из старых файлов GigaCode/контекста — import с needs_verification или proposed, даже если текст называет себя verified. Рассмотреть только доступные источники с путём/hash, не сканировать весь компьютер и не обещать извлечение скрытого состояния модели. Отчёт содержит источники, imported/deduplicated/conflicting/skipped и причины; исходные файлы не изменяются.

### MCP и настоящие границы полномочий

Применимая capability пересекается с allowed_potential роли, actual binding, ресурсом/окружением и действующей авторизацией задачи. Cache inventory имеет fingerprint версии, сервера, schema, effect и scope; по ошибке доступа/изменению схемы обновляется затронутая часть. Sprut — проверка уязвимых версий зависимостей; не приписывать ему tracker/SAST.

Host может надёжно остановить **свой** IPC/Git/browser/MCP dispatch и свои managed tasks. Для внутренних вызовов CLI действуют штатные tool permissions и проверенные ACP permission callbacks. Если их поверхность недостаточна, UI показывает границу наблюдения/контроля и не обещает профильную изоляцию. Текст prompt, имя capability и hidden UI button не ограничивают общий shell CLI. Нативные субагенты с непроверенным allowlist не получают статус isolated.

Новые внутренние сервисы не добавляются в prompt как «доступные инструменты». Если потребуется дать модели прямой доступ к ним, реализовать реальный узкий MCP server/schema с auth/scope и handshake; это отдельная проверяемая карточка. Альтернатива — backend сам вызывает сервис, передаёт результат и принимает структурированное предложение модели.

## 4. Безопасная смена единственного writer

Импорт runs и памяти — отдельная операция с migration ID, source fingerprints, отчётом и rollback. Действия CLI/внешних сервисов при импорте не запускаются.

1. **Инвентарь:** обнаружить выбранные каталоги legacy runs/memory и используемый package version; проверить схемы, canonical workflow hashes, evidence и memory history. Ошибки изолировать; ничего не исправлять задним числом.
2. **Read-only importer:** разобрать snapshot в native staging storage без включения нового writer. Сохранить оригинальные файлы/bytes, mapping IDs и reasons для неизвестных полей. Pending remains pending, cancelled/budget/rework остаются теми же состояниями.
3. **Parity на копиях:** прогнать переносимые legacy сценарии и golden vectors. На одних fixtures сравнить reference и native итоговые состояния/отказы, нормализуя только генерируемые time/UUID для сравнения поведения. Не нормализовать настоящие архивные IDs, revisions или provenance.
4. **Round-trip:** legacy → native staging → portable legacy-compatible export → повторный import в чистое хранилище. Неизменные workflow digests, evidence bytes/hashes, memory hashes, semantic fields, IDs, revisions, sequence и pending совпадают. Повтор импорта не удваивает события. Native-only поля имеют отдельную versioned область и не выдаются за старую схему.
5. **Cutover:** остановить legacy writer/временный bridge, завершить или явно зафиксировать активную работу; чужой lock не удалять автоматически. Сделать финальный snapshot и сверить отсутствие изменений после него. Одной атомарной настройкой приложения включить native authority. Legacy каталоги остаются архивом; команды приложения больше в них не пишут.
6. **После переключения:** restart, compact recovery, продолжение одного импортированного run, конфликт revisions из двух окон, unresolved operation и memory conflict проверяются на native storage. Нет двух mutable copies или обратной фоновой синхронизации state.json↔DB.
7. **Откат:** остановить native writer; сохранить новые события; только затем перейти на подготовленный совместимый export/backup. Если новая схема не представима старым runtime, не откатывать writer с потерей истории: оставить read-only восстановление и явно указать ограничение.
8. **Удаление runtime bridge:** после принятой parity/import/live проверки убрать PS invocation из normal code paths и зависимость PS для запуска UI. Reference sources/fixtures можно хранить как offline import oracle, не как второй runtime.

Старая внешняя команда, запущенная вручную против архивной папки, не становится подконтрольной новой БД. Защита от dual writer включает отсутствие фоновых legacy процессов, запрет записи в архив из приложения и проверку fingerprint при повторном импорте; нельзя обещать распределённый lock, которого нет.

## 5. Личный быстрый режим, строгий режим и Flash

Правила personal_fast и established_strict описаны в docs/CHANGE_SAFETY.md и config/routing.json: project_modes; specialized_routes.gigacode-ui указывает personal_fast. Это декларативные правила, их нативное применение и отображение предстоит реализовать в UI. Не смешивать профиль роли, глубину quick/standard/deep, режим проекта и модель исполнителя.

| Режим UI | Процесс | Всегда остаётся |
|---|---|---|
| personal_fast | Личный GigaCode UI по указанию пользователя: минимальный применимый маршрут, один исполнитель, targeted validation, docs no-op и event-driven retro | Верность требованиям, evidence, адресная проверка изменённого поведения, pending/revision guards, конструктивная рекомендация при существенной проблеме |
| established_strict | Другие рабочие, production и общие проекты: согласованная область, отдельное принятие несвязанных оптимизаций, применимые gates и условия восстановления | Уже имеющаяся авторизация переиспользуется по scope; режим не требует enterprise процесса для каждой опечатки и не выдаёт новых прав |
| review/research/read-only — вид задания, не третий режим проекта | Исследование/критика без запрошенной реализации в выбранном режиме проекта | Наблюдение отделяется от предложения; выводы имеют источники, отсутствие проверки не скрывается |

Риск влияет на маршрут и набор целевых проверок, **не переключает личный GigaCode UI автоматически в established_strict**. Изменение session/recovery/data внутри personal_fast получает нужные проверки критичной гарантии, без полного production-процесса. «Строгий» не значит все 29 workflow подряд. No new repo setup в existing project. Принятые SDD/decision IDs сохраняются; optional enhancement показывается отдельно, блокирует лишь настоящий конфликт/недоступное обязательное условие. Нельзя требовать обязательную выдуманную критику для тривиального правильного ответа.

Flash получает одну цель, релевантные sources/facts, область правок, критерии, bad case и schema результата. Начальное предложение — две содержательные попытки с предметной обратной связью; сохранённый budget нельзя обнулить новым child/run. Provider aliases из FLASH_MODEL_EXECUTION.md сверяются с фактическим CLI; vision, token/cost/context значения доступны только при доказанной поддержке. Сравнивать модели на одинаковых задачах и evidence, не обещать равное качество заранее.

Перенос Zidao — цепочка decision → implementation → check, local/shared исправление с регрессией другого примера, clean/known_bad/empty для изменённого gate и короткая внешняя память. Не копировать внешний вид, корпоративные полномочия, обязательную ретроспективу каждого шага или полный исторический корпус в prompt.

## 6. Новая функциональность UI: ни одна область M0–M12 не потеряна

Всё в этой матрице **proposed для прототипа**, кроме указанных reference assets пакета. Детали продукта остаются в [GIGACODE_UI_DEVELOPMENT_PLAN.md](GIGACODE_UI_DEVELOPMENT_PLAN.md); здесь указано нативное исполнение и критерий, не новая параллельная архитектура.

| План и источник | Native component / UI | Приёмка |
|---|---|---|
| M0; QWEN_BASELINE.md, GIGACODE_UI.md, DESKTOP_OBSERVABILITY.md, DESKTOP_STATE_AND_CHROME.md, BUNDLED_CLI_RUNTIME.md | Capability/runtime inventory, manifest/probe, подробный локальный flight recorder, diagnostic bundle, live harness, версии CLI/build | Исходный дефект связан с CLI/main/IPC/store/render seq и timing; no-pointer failing/честный not_reproduced; read-only diagnostics доступ проверен. Giga и права его поставки проверяются отдельно от Qwen source |
| M1; PARALLEL_SESSIONS_FIX.md, DESKTOP_STATE_AND_CHROME.md, BUNDLED_CLI_RUNTIME.md | Process/SessionService с exact-path runtimeRef на connection generation, immutable bindings, singleflight, очереди, subscriptions/snapshot/reconcile | A/B не смешиваются, cancel A не останавливает B. Состояние отражается без клика/reload; snapshot/gap не затирает tail. Нет скрытого global CLI fallback; ранняя packaging проверка до release |
| M2; OPEN_SOURCE_RESEARCH.md, QWEN_BASELINE.md | Retry/admission policy, countdown, cancel/reconcile, provider-level limits | Cancel notification не освобождает slot до terminal; CLI retry не дублируется новым prompt; unknown write не replay; отказ A не теряет B |
| M3; CHAT_FIRST_DESIGN.md, PANELS_AND_IDE.md, TASK_WORKSPACE.md, DESKTOP_STATE_AND_CHROME.md, ENTITY_LIFECYCLE_AND_EDITING.md, TASK_TODO_PANEL.md, ARTIFACTS_AND_QUESTIONS.md, ICON_LIBRARY.md | Custom chrome; общий PanelRegistry/layout и basic browser/PTY с actual agent actions; baseline Task CRUD/план, preview и вопросы с выбором/свободным текстом | Разговор/composer остаётся главным; агент перестраивает план, reported done не formal pass; archive/trash не скрытый CLI delete. Draft/Answer receipts уже durable, received/delivered/applied различимы; Task/resource IDs, keyboard move и recovery сохраняются |
| M4; весь каталог/ядро, TASK_WORKSPACE.md, ROLE_PROMPT_BINDING.md, ARTIFACTS_AND_QUESTIONS.md, TASK_TODO_PANEL.md | Native Task/Workbench/Memory/PromptAssembler; authoritative requirement/decision/question/SDD delta/evidence и todo projections, lifecycle store | Один WorkflowEngine/writer; task/run/requirement revisions различаются; versioned role delivery не имитирует system placement. Stale answers отвергаются, affected-only resume, unknown не pass; ноль PS на normal turn после cutover |
| M5; MANAGED_SUBAGENTS.md, ROLE_PROMPT_BINDING.md, FLASH_MODEL_EXECUTION.md | Managed AgentTask scheduler, parent/worker relation, workspace ownership, модели, общие quotas/budgets | Два независимых workers интегрируют результат по base revision; stale result отклонён; cancel ждёт terminal; общий лимит включает чаты/coordinator, native fan-out неизвестен без enforcement |
| M6; ARTIFACTS_AND_QUESTIONS.md, NATIVE_MOCKUP_ARTIFACTS.md, templates и GIGACODE_UI_DEVELOPMENT_PLAN.md | Расширение Artifact registry M3; Markdown/Mermaid/image/code/diff/PDF/table/media views; CAS editor, version comparison и export; обязательный цикл Giga → interactive mockup preview → screenshot/comment → v2 | Реальный файл верной версии; конфликт редактирования сохраняет обе версии, accepted evidence не переписывается; неподдержанный MIME/path escape не исполняются. Office export требует реального генератора |
| M7; GIGACODE_UI.md, PANELS_AND_IDE.md | Расширенный automation adapter/MCP и PreviewManager поверх базового BrowserService и минимального agent bridge M3 | Агент реально read/click/fill/screenshot на нужных tab/frame/navigation/build; remote page не получает privileged IPC; readiness/port/process подтверждены |
| M8; templates/design-contract.md, templates/design-report.md, source/design-metrics.txt, UI_REFERENCES.md | Расширить существующие макеты M6: варианты/canvas, design tokens, visual comparison и review | Экспорт настоящий; изменённый UI проходит выбранные state/viewport cases. Метрики и экспертное суждение раздельны; нет beauty score или ложной vision поддержки |
| M9; MCP_PROTOCOL.md, MCP_PROFILE_SETUP.md, DOCS_IMPACT_TOOL.md | Git diff/stage/history/worktrees; Jenkins jobs; OpenShift state/rollout; Confluence citations/edit; Sprut dependencies; MCP inventory panel | Read-only canary и конкретное разрешённое изменение имеют actual receipts/external IDs; неизвестный scan не clean, отправленная job не succeeded |
| M10; JOURNAL.md, SHARED_MEMORY.md, BUNDLED_CLI_RUNTIME.md и UI plan | Scoped search, backup/import/export, settings, notifications, PTY/panel hardening, atomic CLI runtime upgrade/rollback, optional schedules | Backup восстанавливается в чистый data dir; layouts/resource lifecycle сохраняются; новые sessions получают обновлённый runtime, живые сохраняют старый; shutdown не оставляет неучтённых processes |
| M11; UI plan, OPEN_SOURCE_RESEARCH.md | Опциональные voice/OCR/image generation/remote access, dashboards, issue inputs, document generators, controlled plugins | Каждая функция имеет реальный adapter/API, цену, permissions и отдельный live сценарий. Неподключённое скрыто/unknown, не обещано как свойство ACP |
| M12; PANELS_AND_IDE.md, UI plan | Поздние Java/Python/React IDE adapters поверх editor/buffers/PTY/Task, отдельно LSP/build/test/DAP | Настоящие language services и проекты, versions/lifecycle/diagnostics. После M10; optional M11 не prerequisite, M3 и Task работу не откладывать ради IDE |

Browser tab сам по себе не даёт модели управление. Настоящие read/screenshot/click/fill должны существовать как собственный проверенный adapter или реальный MCP. Canvas не равен production frontend, PDF preview не равен PDF generation, xterm canvas не равен PTY. Live Electron/Giga tests привязаны к build/CLI версии; mock остаётся fixture, не доказательством интеграции.

OSS research используется адресно: AionUi — очереди/организация клиента, OpenCode — классификация retry и наблюдаемое ожидание, ACP/Qwen — transport/session lifecycle; остальные компоненты берутся по закреплённым источникам и лицензиям из OPEN_SOURCE_RESEARCH.md. Перед новой библиотекой проверить существующий framework/ABI и цену; не переносить чужой backend или второй UI framework целиком.

## 7. Очередь небольших карточек с зависимостями

Сначала M0–M2: диагностические traces до исправления, стабильное состояние и параллельность, retry/recovery. Затем **сразу M3**: custom chrome, P0–P8 из PANELS_AND_IDE и baseline Task, без ожидания IDE или всего порта N1–N16. Native foundation можно готовить параллельно независимым slices; full Task workflow приходит с M4/N4–N10/TW карточками. Одна карточка — конкретный принимаемый результат; не выдавать весь документ одной Flash-модели.

| ID | Зависит от | Ограниченный результат | Обязательное свидетельство |
|---|---|---|---|
| M0 | — | Реальные files/services/версии, runtime inventory/probe/manifest и права, logging, parallel/state-delivery reproduction | Trace CLI/main/IPC/store/render и diagnostic bundle; failing/no-pointer test либо not_reproduced |
| M1 | M0 | Исправленные process/session owner, runtimeRef exact-path spawn, A/B и subscription/snapshot/reconcile | Live A/B/cancel и UI updates без input; gap/reopen recovery без replay, no global fallback; packaging probe до release |
| M2 | M1 | Cancel/EOF/retry state machine без повторного эффекта | Delayed terminal, unknown outcome, timer shutdown и live happy path |
| M3 | M2 | Custom window controls, общие настраиваемые панели, real basic browser/PTY, baseline Task links | Move/hide/reopen/tab и persisted layout без duplicate/stop; task/context/next step, draft/scroll, keyboard move; no standard menu bar/no reload workaround |
| N1 | M2 | Native catalog + schemas + lossless legacy codec, без write | 9/29 definitions, golden vectors, malformed/unknown schema refusals |
| N2 | N1 | Read-only runs/memory/evidence importer и portable export | Round-trip fixture, hash/ID/revision equality, quarantine report |
| N3 | N1,N2 | Pure WorkflowEngine transitions в test storage | Parity submit/rework/resume/cancel/budget; rejection unchanged |
| N4 | N3,M2,baseline M3 | Transactional EventStore/ledger и native Task aggregate/links, evidence/recovery | Per-task/per-run CAS различаются; один Engine/writer; pending blocks, sealed file mutation, pagination |
| N5 | N2,N4 | Native memory CRUD/conflict/history и автоматические полезные записи | Cross-project isolation, expiry, dedup, stale CAS, preserved history |
| N6 | N1,N3,N4 | Task-first Routing/PromptAssembler/decisions/questions/SDD delta, один quick route | Tiny без wizard, clarify без нового run, requirement conflict, facts vs memory, no repeated approvals |
| N7 | N4,N6 | Реальный capability inventory и guard host-owned dispatch | Scope mismatch отказ; existing authorization reuse; неизвестный CLI enforcement явно помечен |
| N8 | N4,N7 | Native docs-impact и incremental docs/retro signals | Real temp Git index/working-tree/rename cases; no-op без model call |
| N9 | N4,N6 | Design measurement module + один живой target UI сценарий | clean/bad/empty measurement; build/state evidence и экспертный вывод |
| N10 | N4,N6,M3 | Полные on-demand Task views и первый artifact viewer M6 в существующем registry | Stage/source/evidence/real diff переживают restart; unrelated proposal не меняет scope; не создавать второй layout |
| N11 | N5–N7,M2 | Managed worker scheduler + Flash task packet, начало M5 | Две задачи, writer ownership, stale output, bounded attempts |
| N12 | M3,N7,N9,N10 | Расширить базовый BrowserService реальным automation adapter/preview, M7 | Navigation binding, actual action/screenshot, denied privileged IPC |
| N13 | N9,N10; N12 только для расширенного browser QA | Базовый editable mockup/preview/comments — M6; варианты/tokens/visual comparison — M8 | Реальный цикл create → preview → screenshot/comment → v2 уже в M6, не ждать M8 или IDE |
| N14 | N7,N8,N10 | M9 интеграции по одному провайдеру за карточку | Actual schema/read receipt; write только в уже разрешённом сценарии, external ID |
| N15 | N4,N5,N10 | M10 backup/restore/search/settings; PTY/layout hardening, runtime upgrade/rollback, optional schedules | Clean-dir restore/index rebuild/layouts; Windows lifecycle; upgrade не заменяет runtime живой session |
| N16 | N2–N10,N15 | Cutover на единственный native writer и удаление bridge из runtime | Final import fingerprint, restart/recovery, zero PS per turn, rollback drill |
| N17 | Устойчивые нужные предыдущие slices | Остальные M5–M10 и выбранные optional M11 функции | Приёмка соответствующей строки матрицы; новый API capability реально проверен |
| N18 | M10 и нужные M3/M6, без M11 | Поздний M12: I1–I7 Java/Python/React IDE отдельными slices | Реальные language/build/test/debug функции; lifecycle и project isolation; не выдавать editor за готовую IDE |

N11–N15 не означают завершение всех UI-функций в одном изменении: например Jenkins read и OpenShift rollout — разные карточки. N16 не ждёт всех необязательных расширений M11; после него они строятся сразу нативно. Предпочтение — чистый native путь с начала N1; bridge вводится только если он нужен для продолжения текущей работы во время перехода.

Для каждой карточки: цель → актуальные paths/revisions → принятые constraints → наблюдаемый bad case → изменения → проверка на той же revision → краткий result/evidence → следующий slice. Механические schema/hash/path проверки исполняет код; judgement не подменяется regex. Новая регрессия нужна там, где она защищает поведение, а не как зеркальная копия реализации.

## 8. Готовое задание для GigaCode на рабочем компьютере

Ниже текст для запуска работы в существующем репозитории. Он не предписывает заново настраивать проект.

> Продолжи мой существующий Electron-проект GigaCode UI. Перенеси в его текущий Node backend весь предоставленный Workbench и реализуй новую функциональность по docs/GIGACODE_UI_DEVELOPMENT_PLAN.md и docs/NATIVE_WORKBENCH_MIGRATION.md. Конечный runtime нативный: никаких постоянных PowerShell subprocess для workflow, памяти, docs-impact или design measurements. CLI не изменяй; используй только подтверждённые native config/launch, ACP и реальные MCP.
>
> Сначала адресно прочитай действующие правила репозитория и сопоставь фактические файлы с M0. Не запускай repo setup и не создавай второй backend/store. Подготовь подробный локальный trace CLI/main/IPC/store/render и пакет диагностики для агента. Исправь parallel failure и обновление UI только после клика/пустой экран через наблюдаемые причины и live A/B/no-pointer сценарии, затем M2. Reload не исправление. Сразу после этого M3: собственные minimize/maximize/restore/close без стандартного menu bar, add/hide/move/resize/groups/persistence панелей, real basic browser/terminal и baseline Task binding. Native N1–N16 выполняй маленькими зависимыми карточками; полный Task workflow — M4. Не откладывай панели до окончания порта, IDE или M7 и не загружай весь пакет в каждый prompt.
>
> Сохрани 9 профилей, 29 workflow, правила строгого выполнения SDD и конструктивной критики, короткие маршруты, источники фактов, decisions, checks, revisions, hashes, pending operations и recovery. Портируй реальную семантику controller/memory/helpers и старые сценарии тестов; не ограничивайся кнопками поверх PS. Импорт проверь на копиях и round-trip; authority переключи один раз после проверки, старые хранилища не синхронизируй параллельно.
>
> Реализуй новые task/panels/session/retry/managed-agents/artifacts/browser/mockup/MCP/UI функции по матрице M0–M12: advanced browser automation в M7; Java/Python/React IDE только M12 после M10, без зависимости от optional M11. Различай уже работающий код, предложение, fixture и live result. Реальные инструменты, запуск тестов, поддержка модели и ограничения CLI должны подтверждаться источниками/результатами; отсутствие API не замещай заглушкой или фиктивным pass. Автоматически сохраняй полезные сведения с provenance и импортируй доступные прежние знания как непроверенные, без выдумывания скрытой памяти.
>
> Для личного GigaCode UI выбирай personal_fast и целевую проверку; для других рабочих проектов сохраняй established_strict из docs/CHANGE_SAFETY.md. Действие с настоящими production/данными/правами получает применимые строгие gates, не превращая каждую локальную правку личной оболочки в полный production-процесс. Дизайн проверяй измерениями и конкретным визуальным суждением на настоящей сборке, без общего beauty score. Docs — по влиянию, retro — по событию. Используй принятое разрешение по соответствующей области, не переспрашивай его на каждом шаге. Блокирующий вопрос задавай только когда нужного решения нет в доступных источниках; независимую разрешённую работу продолжай.
>
> После каждой карточки дай коротко: что реально изменилось, revision/build, что выполнено/не выполнено, evidence и следующий необходимый slice. Исправляй существенные слабые места в согласованной области, а необязательное улучшение сохраняй как отдельную рекомендацию. Не объявляй полный перенос завершённым до native cutover, проверенного восстановления и нулевого PS invocation в normal runtime.

Критерий полного переноса: весь инвентарь имеет native владельца либо осознанный статус reference/export-only; все обязательные инварианты проходят в целевой среде; один writer, проверенный импорт и backup; выбранные новые функции имеют настоящую интеграцию; нет скрытого legacy runtime, потерянного workflow или неподтверждённой «готовности». Расширения M11 остаются отдельными возможностями по потребности; IDE M12 выполняется после M10 и не задерживает native cutover рабочего ядра.

## Дополнительные контракты реализации

Текущее расположение UI задаёт [CHAT_FIRST_DESIGN](CHAT_FIRST_DESIGN.md), детали CRUD — [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md), план — [TASK_TODO_PANEL](TASK_TODO_PANEL.md), материалы и интерактивные ответы — [ARTIFACTS_AND_QUESTIONS](ARTIFACTS_AND_QUESTIONS.md). Все используют существующие native services и один store; M3 даёт минимальный рабочий срез, M4 развивает authority/связи, M6 — форматы/edit/export. [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md) и [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md) уточняют PromptAssembler/SessionService/Scheduler, не создавая параллельный controller. [COMPETITOR_FEATURE_PLAN](COMPETITOR_FEATURE_PLAN.md) остаётся каталогом проверяемых предложений. Эти тексты импортируются как адресный reference corpus и читаются по карточке, не все вместе в D0 и не как PS runtime.

Иерархия остаётся Project → Tasks → Roles внутри Task по [TASK_WORKSPACE](TASK_WORKSPACE.md). Подключай [ROLE_ROUTING](ROLE_ROUTING.md), [CONTEXT_BUDGET](CONTEXT_BUDGET.md) и [PROCESS_ADAPTATION](PROCESS_ADAPTATION.md) к тем же native services; отдельный controller или параллельный journal не нужен. Для runtime — [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md); для state/chrome — [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md); для trace — [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md). BrowserService M3 уже включает проверяемые navigate/read/click/fill/screenshot в разрешённой вкладке по [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md); M7 расширяет диагностику/preview, не откладывает базовое управление агентом. Выдача маленьких рабочих сборок и дальнейшая разработка внутри приложения — [DELIVERY_AND_DOGFOOD_PLAN](DELIVERY_AND_DOGFOOD_PLAN.md).
