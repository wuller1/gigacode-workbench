# Назначение инструкций роли и их применение к исполнителю

Статус: полный контракт и частичная реализация 0.5. Native host уже собирает CORE + одну роль, сохраняет версии и использует проверенный system append для Qwen 0.25.1; подробные доказательства и границы — ../../docs/suite/AGENT-HARNESS-AUDIT.md. Остальные native services/activation preview/full workflow поля ниже остаются целевыми до отдельной приёмки. Существующий workplace LLM-router сохраняется; его код и GigaCode 26.10.6 здесь недоступны. Исследование upstream не заменяет проверку установленного форка.

Иерархия остаётся **Project → Task → роли внутри Task**. Роль определяет ответственность текущего исполнителя. Она не создаёт новую задачу, не выдаёт права и не заменяет workflow. Выбор следующей роли описан в [ROLE_ROUTING](ROLE_ROUTING.md); здесь определены состав её инструкций, способ доставки и проверяемая активация. Использовать существующие CatalogService, InstructionRegistry, PromptAssembler, Task writer, SessionService и ContextPacketBuilder/TaskPacketBuilder из [нативного переноса](NATIVE_WORKBENCH_MIGRATION.md) и [TASK_WORKSPACE](TASK_WORKSPACE.md), без второго controller.

## 1. Что означает «системный промпт по роли»

Сначала собрать версионированные инструкции Workbench, затем отдельно определить, через какую **реально поддержанную поверхность** CLI они будут переданы. Название файла `SYSTEM_PROMPT.md`, заголовок «system» внутри текста и фраза модели «я применил профиль» сами по себе не устанавливают системный уровень сообщения.

| Слой Workbench | Источник и назначение | Время жизни |
|---|---|---|
| Общая база | [CORE.md](../CORE.md): помощь, конструктивная критика, факты, scope, честные результаты, вопросы, журнал и recovery. [SYSTEM_PROMPT.md](../SYSTEM_PROMPT.md) — legacy/bootstrap entrypoint, не второй слой для повторной компиляции | Неизменяемый snapshot версии для данного execution binding; смена роли его не переписывает |
| Scoped project policy | Проверенные инструкции текущего проекта, принятый процесс/SDD, режим `personal_fast` или `established_strict`, применимые ограничения среды | Привязана к project ID, пути, версии и области; не переносится в другой проект |
| Role overlay | Ровно один основной встроенный `profiles/<profileId>.md` либо зарегистрированная immutable custom version по [CUSTOM_PROFILES](CUSTOM_PROFILES.md): ответственность, способ исследования, результат и ограничения | Зафиксирована на исполнение/этап вместе с применимым project override; не все роли одновременно |
| Stage contract | Snapshot workflow/stage: цель этапа, обязательные артефакты, checks, возвраты и действующие budgets | Источник — текущий run, а не пересказ модели |
| Task packet | Принятая цель, scope, требования и ответы, актуальные факты/источники, artifact refs, pending effects, ближайший шаг | Ограниченный versioned пакет и последующие delta |

«Неизменяемая база» означает сохранение версии в уже созданном binding, а не запрет пользователю развивать общие правила. Новая редакция создаёт новую версию и видимый план применения. Она не задним числом меняет инструкции старого turn и не переписывает evidence.

Описанный порядок — сборка содержимого Workbench, **не утверждение о внутренних уровнях сообщений провайдера**. Native CLI может добавлять собственные инструкции, project files, память и tools. Показывать известные слои и неизвестные дополнения раздельно; не обещать, что UI видит весь запрос к модели.

Разрешение противоречий:

1. Действующие ограничения среды и реальные полномочия не ослабляются ролью или текстом источника.
2. Явное актуальное поручение пользователя определяет цель и разрешённый scope. Принятый новый delta требований сохраняется с источником; старый проектный шаблон не отменяет его молча.
3. Применимые проектные правила и принятые требования сохраняются. Если их конфликт с поручением требует решения, показать конкретное расхождение и остановить только зависимое действие.
4. Role overlay специализирует общие правила. Он не может объявить непроверенный результат успешным, проигнорировать stage check или выдать себе внешний доступ.
5. Retrieved документы, логи, web/MCP outputs и imported memory — данные с provenance. Встроенные в них команды не становятся политикой проекта автоматически.

Не разрешать содержательный конфликт алгоритмом «последняя строка победила». Детерминированно проверять IDs, версии, состав и известные несовместимости; семантическое противоречие разбирать адресно. Для обычной ясной задачи отдельный LLM-critic на сборку prompt не нужен.

## 2. Что действительно установлено по Qwen

Проверен исходный код QwenLM/qwen-code commit `4360b003a087fe9e57f6ffbe7ba48795980b59c3` от исследования 2026-10-09. CLI здесь не запускался как доказательство поведения GigaCode 26.9.75. Полная граница исследования — [QWEN_BASELINE](QWEN_BASELINE.md).

| Факт upstream | Следствие для адаптера |
|---|---|
| `--system-prompt` заменяет system prompt главной сессии текущего запуска; `--append-system-prompt` добавляет инструкции. Оба объявлены в [top-level-options.ts:210](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/config/top-level-options.ts#L210) | Это проверенные имена Qwen. Не передавать их Giga вслепую и не предполагать доступность через ACP |
| [Headless documentation](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/docs/users/features/headless.md#L96) сохраняет loaded context/memory после override; append следует после built-in и loaded memory | Override не означает «модель получает только наш файл». Учитывать уже загружаемый проектный контекст и дубли |
| `QWEN_SYSTEM_MD` читает файл и заменяет base; при отсутствии файла ошибка. При таком override стандартные interaction/output-style additions не применяются как в default branch: [prompts.ts:756](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/prompts.ts#L756) | Полная замена может убрать полезные native инструкции. Не делать её default без проверки необходимой семантики |
| `assembleSystemPrompt` соединяет base, media guidance, context files, append, git status, auto-memory: [prompts.ts:884](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/prompts.ts#L884) | Это внутренняя функция, не разрешённый UI hook. Не импортировать CLI internals и не monkeypatch её ради ролей |
| Конфигурация новой ACP-сессии строится из `this.argv`: [acpAgent.ts:15452](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L15452); argv prompt передаётся в config: [config.ts:2512](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/config/config.ts#L2512) | Возможность нескольких sessions не доказывает публичный per-session system override. Разные launch-time prompt могут требовать разных процессов/групп конфигурации |

У старой пользовательской обвязки есть локальное свидетельство `GIGACODE_SYSTEM_MD` и `GIGACODE_WRITE_SYSTEM_MD`. Это отдельные имена форка, не переименование Qwen по догадке. Условия и непроверенное перечислены в [GIGACODE_COMPATIBILITY](GIGACODE_COMPATIBILITY.md). Не включать ни одну из этих переменных глобально для проверки роли.

Native `.gigacode/agents/*.md` описывает именованных субагентов. Это отдельная поверхность: выбор такого файла не доказывает смену system prompt главной ACP-сессии. Main-session role и native subagent должны иметь отдельные bindings и capability evidence. См. [MCP_PROFILE_SETUP](MCP_PROFILE_SETUP.md) и [ROLE_ROUTING](ROLE_ROUTING.md).

## 3. Проверка поверхности на целевой установке

Проверка входит в runtime inventory, затем переиспользуется по runtime/config fingerprint. Не запускать её на каждое сообщение и не повторять setup уже настроенного проекта.

1. Установить точные executable, runtime version/hash, способ запуска и рабочую директорию по [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md). Не использовать случайный глобальный CLI из PATH вместо выбранного runtime.
2. Прочитать справку и доступную документацию этой сборки: поддерживаемые flags, env/file mechanism, settings scopes. Наличие поля в чужом примере не подтверждает поддержку. Не выдумывать `session/setSystemPrompt`, `role` в ACP request или недокументированную настройку.
3. В изолированном тестовом проекте без секретов провести два запуска с разными безвредными инструкциями; проверить, что запуск A не меняет B и существующие пользовательские настройки. Сохранить argv/env **имена и безопасные ссылки**, версии и наблюдения, без полного environment/секретов.
4. Если есть документированный dump/diagnostic эффективной инструкции, проверить его область: base или весь assembled prompt, main session или subagent. Dump только base не подтверждает весь итоговый request. Сохранять такой диагностический материал локально с ограниченным доступом и очисткой чувствительного контекста.
5. Отдельно проверить фактический запуск с ACP и выбранным механизмом. Успех headless запуска не доказывает ACP совместимость. Проверить новый session, восстановление, границу смены роли и отсутствие влияния на соседнюю Task.
6. Записать `supported`, `unsupported` или `unknown`, версию, provenance и ограничения. Ответ модели на контрольную фразу — поведенческое наблюдение, не доказательство system placement или enforcement.

Предпочтение адаптера при подтверждённой семантике: сохранить native base и добавить Workbench-инструкции через поддержанный append. Полный override использовать только после явного выбора подхода и проверки, что необходимые native правила/режимы не потеряны. Если доступен только `@file` или обычный ACP prompt, назвать его **«Инструкции в контексте»**. Он полезен, но не равен системному binding. Если задача требует именно системной настройки или изоляции, отсутствие соответствующего механизма остаётся blocker этой возможности.

## 4. RoleCatalog и воспроизводимая сборка

RoleCatalog — представление существующего каталога, не ещё один registry с расходящимися копиями. Источники builtins: [profiles](../profiles/analyst.md), `bundle.json`, workflow snapshots, [profile-capabilities.json](../config/profile-capabilities.json). Портативный пакет 1.3 проверяет четырнадцать известных IDs и пути; произвольный custom ID не становится поддержанным его controller. Native пользовательские версии регистрируются по [CUSTOM_PROFILES](CUSTOM_PROFILES.md) в M4.9/D5. ProfileRegistry — ответственность того же CatalogService/InstructionRegistry, PromptComposer — того же PromptAssembler; новые имена не требуют второго store или framework. Custom draft, published version и активный execution binding различаются. Недоступный профиль не заменять молча «похожим».

Предлагаемые **внутренние DTO host, не поля ACP**:

```text
RoleDefinition
  profileId, profileVersionRef, profileSourceRef, profileContentHash, catalogRevision
  origin, scopeRef, appliedProjectOverrideVersionRefs
  responsibility, exclusions, contextualReadTriggers, resultContractRefs
  potentialCapabilityPolicyRef

CompiledInstructionSet
  compilerVersion, compositionSchemaVersion
  baseRefs, coreRef, projectPolicyRefs, roleRef, stageContractRef
  immutableInstructionBlobRef, instructionFingerprint
  deliveryMode, adapterVersion, runtimeCapabilityEvidenceRef
  knownNativeContextRefs, unknownNativeComponents

ActivationPlan
  operationId, taskId, runId, stageId, attemptId
  expectedTaskRevision, expectedRunRevision, expectedAssignmentRevision
  desiredProfileId, desiredProfileVersionRef, compiledInstructionRef, taskPacketRef
  authorizationRef, capabilityFingerprint, runtimeRef
  needsNewSession, needsNewProcess, reason, previousExecutionBindingRef

ExecutionBinding
  taskId, assignmentId, profileId, profileVersionRef, instructionFingerprint, taskPacketRevision
  connectionId, connectionGeneration, sessionId, processGroupRef, runtimeRef
  requested / prepared / pending_idle / active / failed / unknown
  deliveryReceiptRef, verificationEvidenceRef
```

Состояния последней строки относятся только к активации, не заменяют состояния Task/run controller. Не смешивать task revision, requirement revision, run revision, attempt ID, assignment revision и transport request ID.

Fingerprint вычислять детерминированно по версионированному manifest: упорядоченные content hashes точных UTF-8 payload, профиль, применимый project policy, stage contract, delivery mode и версия compiler/adapter. Алгоритм, нормализацию переводов строк и schema version явно зафиксировать; не менять legacy digest controller незаметно. Отдельно хранить hash реально переданных байтов. Не включать случайный timestamp в identity одинаковой компиляции; время наблюдения хранить в receipt. Секреты не помещать в compiled prompt; диагностический manifest хранит безопасные config refs, не значения credentials.

Инструкции компилируются из immutable snapshots. Перед отправкой сверяются их зависимости и authorization/capability fingerprints. Изменение файла после compile делает план устаревшим; нельзя «починить» receipt новым hash и считать, что старый исполнитель получил новую версию.

Публикация custom версии, изменение project default и рекомендация агента не обновляют активные bindings автоматически. App/project inheritance разрешается до compile с точными version refs; queued intent не ссылается на изменяемое «latest». Upgrade создаёт новый activation plan на безопасной границе §6. Archive запрещает новые назначения, но сохраняет активные/исторические snapshots; отсутствующий required snapshot даёт конкретный blocker, не автоматический fallback. Изменение prompt не расширяет permissions; актуальный revoke имеет силу и для старого capture. Создание/clone/import, validation и optional trial определены единственным контрактом [CUSTOM_PROFILES](CUSTOM_PROFILES.md).

Никакой генерации всей базы моделью при каждом ходе. Одни и те же версии дают одни и те же байты. Проверить, не доставляет ли native project context тот же `CORE` или профиль: одна authoritative доставка каждого блока, а не удвоение через append + `@file` + сообщение. Если полная native сборка неизвестна, отметить риск дублирования, исследовать доступный inventory и не объявлять гарантированную дедупликацию.

## 5. Встроенные роли: конкретное назначение

Матрица сокращает выбор; полный профиль остаётся источником инструкций. В каждый turn передавать текущий overlay и только источники по его read triggers, а не всю таблицу и весь каталог. Любая роль помогает и конструктивно критикует собственный результат; независимый reviewer нужен по workflow/риску, а не обязательным вторым вызовом каждой микрозадачи.

| Роль / источник | Ответственность и результат | Не входит автоматически | Когда дочитать / кому передать |
|---|---|---|---|
| [analyst](../profiles/analyst.md) | Совместно с пользователем понять функциональность, предложить варианты, самому написать brief, SDD, stories, сценарии, DOCX либо улучшить существующий текст; проверить цель, правила, ошибки и acceptance | Production-код, scaffold, deployment; полный SDD для каждого вопроса; фиктивный DOCX из переименованного MD | Читать принятый проектный формат/источники только затронутых требований. Spec — при нужной формальной проверке; реализация — разработчику после достаточной постановки и действующего поручения |
| [spec](../profiles/spec.md) | Формальная непротиворечивость и проверяемость назначенных требований/контрактов, адресный delta и readiness | Обязательное повторное авторство после analyst, новое интервью, молчаливое продуктовое решение, реализация | Читать конфликтующие положения и версии API/данных/прав. Существенное решение — пользователю через Task questions; принятая версия — назначенному исполнителю |
| [architect](../profiles/architect.md) | Межсистемные границы, ownership, ADR, compatibility/migration/recovery и реализуемая декомпозиция | Архитектура ради документа, молчаливое продуктовое решение, реализация всех частей | Читать фактические компоненты и quality attributes. Продуктовое решение — analyst/spec; реализация — профильным разработчикам; операция — devops |
| [backend](../profiles/backend.md) | Реализация серверной/внутренней логики в принятом scope, совместимость и адресная валидация | Непорученные upgrades, миграция данных, расширение функции, пересмотр бизнес-правил | Читать затронутый код, контракты и релевантные тесты. Неясное правило — вопрос/analyst; готовый diff — QA/reviewer по маршруту; инфраструктура — devops |
| [database](../profiles/database.md) | Схемы, запросы, индексы, migrations, data integrity и измеряемая производительность | Применение к общей БД без поручения, выдуманные данные, обещание отката необратимого преобразования | Читать DDL/ORM/plan и статистику только по влиянию. Применение — devops; бизнес-инвариант — analyst/spec; API — backend |
| [designer](../profiles/designer.md) | UX flow, design contract, responsive states, tokens/components, оригинальные assets и корпоративный UI kit | Копирование чужого trade dress/assets, публикация draft как корпоративной нормы, декоративный happy path без states | Читать brief, текущую систему и измерения. Реализация — frontend; audit — QA/reviewer; публикация kit — через forge/release workflow |
| [frontend](../profiles/frontend.md) | UX-поток, иерархия, состояния, реализация UI; применимые измерения и экспертная визуальная проверка | Копирование чужого стиля/assets, единый «балл качества», полная матрица для каждой подписи | Читать действующие tokens/components и рецепт изменяемого сценария, design contract по влиянию. Затронутый backend contract — соответствующему владельцу; independent review только когда назначен |
| [security](../profiles/security.md) | Threat model, применимые findings, Sprut/SCA dependency evidence, remediation и residual risk | Общий checklist как finding, destructive exploit, приписывание Sprut неподтверждённых функций | Читать точную revision/SBOM/report и затронутые trust boundaries. Исправление — владельцу кода/данных/окружения; повторная проверка — QA/security |
| [devops](../profiles/devops.md) | Сборка, окружение, delivery/config, разрешённая операция в точной среде, внешний operation ID, health/smoke и условия восстановления | Новые полномочия на deploy/данные, глобальная перенастройка, повтор неизвестного write, гарантированный rollback данных | Читать фактический job/cluster/resource schema и текущее состояние. Pending outcome — reconcile; сбой причины — diagnostics; изменение требований — явный delta |
| [technical-writer](../profiles/technical-writer.md) | Адресная документация, проверенные примеры, links/render и versioned knowledge/repository publish | Переписывание незатронутого, фиктивный DOCX, публикация только из-за наличия tool | Читать source of truth и формат аудитории. Неустановленное поведение — владельцу; публикация — только назначенному target с receipt |
| [qa](../profiles/qa.md) | Проверить поведение против версии требований, воспроизвести плохой случай, сохранить реальные результаты и дефекты | Автоматическое исправление продукта/ослабление assertions, pass по наличию тестового файла, live verdict по mock | Читать acceptance, diff, build/runtime provenance и нужные данные. Дефект — владельцу области; неоднозначная норма — analyst/spec; повторять затронутые проверки на исправленной версии |
| [reviewer](../profiles/reviewer.md) | Независимая оценка назначенного документа/diff/evidence, конкретные findings, важность и основание verdict | Самостоятельный patch/merge/publish без поручения; объявление авторской самопроверки независимым review | Читать точную ревизию, требования и зависимые evidence; дополнительный источник только для проверки finding. Возврат — существующий rework target, без нового run ради обхода budget |
| [diagnostics](../profiles/diagnostics.md) | Воспроизведение, различение гипотез, причинная цепочка, минимальное предлагаемое исправление | Любой произвольный patch, повтор неизвестной внешней операции, объявление гипотезы фактом | Читать адресные логи/метрики/код и выполнить различающий эксперимент. Подтверждённая причина — назначенному backend/frontend/devops; unknown — честный следующий probe |
| [gigacode-ui](../profiles/gigacode-ui.md) | Один интегрированный исполнитель узкого среза личной Electron-оболочки: Task/session/ACP/state/panels, реальный текущий build и живые проверки затронутого сценария | Патч CLI, вымышленные ACP hooks, полная UI-матрица любой косметической правки, live успех без запуска | Читать только контракт изменяемого компонента из плана UI. Изменение session/CLI — real-CLI + live Electron; reviewer по выбранному маршруту; быстрый renderer/doc slice без лишних переключений |

Не превращать «может читать» в обязательное полное чтение. Для изменения текста кнопки достаточно текущего компонента, краткого критерия и применимого UI состояния. Для гонки ACP нужны реальный lifecycle, source/build identity и перекрывающийся сценарий; сокращение prompt не отменяет эти факты.

Profile overlay и stage должны совпадать с текущим workflow snapshot. Если automatic router выбрал несовместимый профиль, host отклоняет decision, пересчитывает маршрут с причиной и не отправляет конфликтующие инструкции. Пользователь уточняет цель/результат, но не выбирает роль вручную. Переименование backend в reviewer не доказывает независимость, а подключение spec не превращает brief в обязательный SDD.

## 6. Активация и смена роли без потери Task

Порядок выполняет host; модель выдаёт bounded routing candidate, host валидирует и автоматически применяет его на safe boundary. Политики действий `assisted` и `automaticWithinScope` определены в [ROLE_ROUTING](ROLE_ROUTING.md); в обеих роль выбирается автоматически. Применять уже выданную авторизацию без повторных вопросов. Поручение только подготовить описание не становится поручением менять код при выборе development роли.

1. Сохранить desired role и activation plan через Task writer с expected revisions и operation ID. Повторное нажатие возвращает тот же receipt. Другое окно не может применить устаревший план поверх принятого изменения.
2. При active turn показать «После текущего шага». Не переписывать launch env/argv, текущий task packet или уже отправленный prompt. Cancel request не означает terminal: дождаться ответа исходного prompt; pending effects сверить до зависящего от них исполнения. При disconnect состояние unknown/recovery, не новый автоматический prompt.
3. На безопасной границе сохранить checkpoint, требования/ответы, artifact/evidence refs, scope, pending, budgets и контекст. Не создавать новый Task/run/attempt ради роли и не обнулять счётчики. Обычное уточнение продолжает текущую задачу.
4. Выбрать подтверждённый механизм доставки. Если допустимый task context передаётся только следующим ACP prompt, подготовить `context-only` payload в состоянии prepared/pending; compile, preview и очередь ещё не доказывают доставку. Это не смена system base. Если system-параметры startup-only, создать подходящий новый process/binding; один `session/new` в старом процессе с прежним argv недостаточен.
5. Если поддержан публичный per-session механизм именно этой версии, использовать его подтверждённую схему, ограничения и результат; не придумывать его по аналогии. Даже тогда смена только на idle/recovered границе. В отсутствие доказанного механизма не изображать hot switch.
6. Связать подготовленный connection/generation/session с прежним Task/run/assignment через одну запись. Старую сессию сохранить в истории. Подготовить актуальный минимальный checkpoint/packet для поддержанной границы доставки, а не повторять исходный запрос со всеми уже выполненными действиями.
7. Для native launch/config binding отметить active только после успешного setup/session и предусмотренного подтверждения выбранной конфигурации. Сохранить receipt и уровень свидетельства: готовность процесса/сессии сама по себе не доказывает system placement. Для context-only, доставляемого следующим prompt, до шага 8 сохранить prepared/pending; заранее active не выставлять.
8. Отправить следующий разрешённый turn с captured fingerprint/revision и записать наблюдаемую границу. Раздельно хранить «payload зафиксирован», «передан transport» и «наблюдаемо принят/исполняется» по реально доступному correlated событию/ответу. Стандартный `session/prompt` может вернуть только terminal response: отдельный acceptance ack не предполагать. До достаточного наблюдения UI пишет «Инструкции переданы; принятие не подтверждено»; после него допускается active с подписью «Инструкции в контексте этого хода», без заявления о системной установке. Timeout после возможного dispatch даёт unknown/recovery, не active и не автоматическую повторную отправку. Поздние updates старого binding не меняют новую задачу/роль. Run submit по-прежнему использует текущие run/stage/revision/attempt и проверки controller, а не один profile label.

Ключ переиспользования process group включает совместимые runtime/version, immutable launch configuration, prompt delivery/fingerprint, project/resource scope и фактическую permission configuration. Один процесс допустим для нескольких sessions только после проверки multiplexing и совместимости этих условий. Разные launch-time роли не разделяют один mutable глобальный `currentRole`/system file. Логическая process group приложения и OS process group — разные вещи; OS изоляцию нельзя обещать без её реализации.

Запускать выбранный executable с отдельным массивом arguments (`shell: false`) и новым объектом env для конкретного child. Не выполнять глобальный `setx`, не менять env родителя и не перезаписывать общий `system-gigacode.md` перед каждым turn. Поддержанный file override получает immutable файл данного binding с безопасными правами/путём; его содержимое не меняется, пока процесс может его читать. Не предлагать несуществующий file flag ради обхода ограничения длины командной строки: при лимите нужен действительно поддержанный file/env mechanism или меньший пакет.

Сохранять существующую подтверждённую auth configuration безопасными refs; не копировать секреты в Task, prompt, журнал или новый profile file. Новая session не гарантирует автоматического восстановления provider auth — проверить и показать ограничение. Project-scoped память и accepted evidence сохраняются в host независимо от CLI history; переносить только нужные verified факты, а imported/stale материал явно маркировать. Global memory и разрешённая общая память текущего project доступны разным Task этого проекта по действующему scope. Изменение роли не даёт читать память другого project или приватные payloads другой Task. Сохранённое в памяти разрешение прежней Task не становится авторизацией текущей.

## 7. Permissions и workflow остаются вне промпта

Роль может перечислять потенциально нужные capabilities. Host определяет применимые действия и действующие разрешения по [MCP_PROTOCOL](MCP_PROTOCOL.md) и [MCP_PROFILE_SETUP](MCP_PROFILE_SETUP.md). Capability label — не actual tool name и не разрешение на любой MCP вызов.

- Собственные MCP/PTY/browser dispatch host реально проверяет по Task/project binding/resource/environment, exact target и central disables; отсутствие обязательного доступа блокирует действие. Роль выбирает контекст/workflow, но не расширяет и не урезает уже привязанный набор tools.
- Для внутренних tools CLI нельзя обещать enforcement со стороны UI, если они не проходят через подтверждённый контролируемый интерфейс. «Reviewer не пишет файлы» в prompt не делает процесс технически read-only. Когда изоляция обязательна, нужны проверенные runtime allowlists/sandbox/права либо честный unsupported/blocker.
- Native subagent не наследует роль и prompt автоматически. Managed child получает captured project binding revision, parent assignment scope и central target rules; все bound capabilities остаются доступными без per-call modal, но child не добавляет новый connection/environment/target. Для opaque CLI child честно показывать неизвестную полноту enforcement.
- Checks, evidence, immutable history, CAS, rework и pending операции сохраняются при смене роли. Завершение stream или текст «готово» не подтверждает приёмку.

`personal_fast`/`established_strict` — режим проекта; `quick/standard/deep` — глубина; профиль — ответственность; workflow — последовательность/checks; модель/reasoning — настройки исполнения. Ни одна ось не подменяет остальные. Более рискованный участок personal UI получает адресные критичные проверки без автоматического превращения проекта в production-процесс.

## 8. Компактное отображение в UI

Основное место — компактный read-only role chip в нижней строке Task/composer context согласно действующему дизайн-контракту. Он не открывает отдельный чат и не позволяет вручную назначить профиль. Обычный разрешённый переход сопровождается коротким статусом; дополнительный вопрос нужен только при действительно новом продуктовом решении/scope, без постоянных modal.

Chip показывает selected → captured → actual роль/version, reason, confidence, factors/evidence и pending safe-boundary handoff. Создание/помощь/история профилей доступны в Settings → Роли по [CUSTOM_PROFILES](CUSTOM_PROFILES.md), но publish/default не назначают роль текущей Task вручную: router учитывает новую версию на следующем пересчёте. Рядом в той же нижней строке всегда видны model, reasoning, context и branch/worktree.

По раскрытию **«Инструкции роли»** показать:

- текущую и ожидающую роль, применимость к stage; какие request/project/task/resource factors выбрал router, reason/confidence и следующий результат;
- базу, project policy, overlay и task packet отдельными вкладками/секциями on demand, их версии и фактический diff перед изменением;
- механизм: verified native append/override, native agent либо context-only; runtime version, известные и неизвестные слои; время/основание проверки;
- status requested/prepared/pending idle/active/failed/unknown, причину новой session/process и честные возможности инструментов;
- объём/usage: actual, estimated или unknown по [MODEL_AND_CONTEXT_CONTROLS](MODEL_AND_CONTEXT_CONTROLS.md), без полного dump секретов и окружения.

Preview показывает то, что host собирается передать, а не необозримый «весь system prompt модели». После отправки дать доступ к сохранённому receipt/безопасному manifest. Различие selected/captured/actual должно быть видно при очереди, retry, ошибке запуска и смене вкладки. Route A не меняет B. Перемещение/скрытие панели не запускает активацию роли и не завершает её session.

## 9. Контекст и стоимость переключений

Применять [CONTEXT_BUDGET](CONTEXT_BUDGET.md): общий input включает system/tools/history, а не только наш task packet. Не передавать этот документ целиком каждой роли. Сохранить стабильный prefix и hashes, в обычном turn — актуальный delta. Повторное использование возможно лишь при подтверждённом наличии соответствующих версий в контексте данной session; локальный cache не доказывает модельную память после restart/compression.

Текст роли компилировать один раз на зависимости, task packet — только для нужного исполнения. Не вызывать модель при открытии preview, переключении панели, повторном чтении известного binding или совпавшем cache key. Смена роли оправдана другим результатом/обязательным stage, а не желанием показать больше «агентов». Самокритика автора входит в обычную работу; отдельный critic/reviewer добавляется только по назначенному маршруту/основанию.

При budget overflow не удалять цель, ограничения, принятые требования, pending и проверки. Сократить нерелевантные sources/старые logs, сделать addressed retrieval или safe handoff по Context Budget. Новый session сохраняет Task/run/attempt и budgets. Повтор отправки после 429 не пересобирает роль/модель; текущий turn остаётся под capture существующего retry owner.

## 10. Приёмочные сценарии

Это план тестирования native UI и адаптера; сценарии ниже здесь не запускались. Unit fixtures подтверждают сборку/переходы, отдельные live проверки на целевой Giga-сборке подтверждают реально доступную доставку. Для негативного сценария проверять отсутствие запрещённого dispatch и неизменность нужного state, а не только текст предупреждения.

| Сценарий | Обязательное наблюдение |
|---|---|
| Повтор одинаковой компиляции | Те же входы дают те же байты/fingerprint; preview/open/retry не добавляют второй CORE/overlay и не вызывают LLM |
| Изменённый источник после preview | Stale activation отклонён; новая версия показана, старый receipt/evidence неизменны; два окна не применяют оба варианта |
| Конфликт analyst→код / backend→reviewer stage | Analysis-only не пишет production; несовместимая роль не скрывает stage check. Разрешённая реализация продолжается без повторного согласования |
| Analyst brief и SDD | Один автор сам пишет выбранный материал; brief не разрастается в полный SDD, spec не включается обязательным вторым писателем; существенное неизвестное сохраняется blocker только затронутой части |
| Системная доставка недоступна | `@file`/ACP user prompt обозначен context-only; самоотчёт модели не повышает его до system verified. Требующий настоящей изоляции сценарий не получает ложный pass |
| Context-only без отдельного acceptance ack | Compile/preview/queued остаются prepared/pending; запись в transport не выдаётся за подтверждённое принятие. Фактическое correlated событие либо terminal response определяет наблюдаемую границу; timeout даёт unknown без replay. В UI нет ложного system active |
| Разные launch-time роли A/B | Каждый процесс/binding получает свой неизменный prompt; env/файл A не изменяет B и глобальные настройки. Поддержка одного процесса проверяется отдельно |
| Переключение во время stream/429 | Видно pending role; capture текущего turn неизменен; второй prompt не отправлен; retry не стартует новую session |
| Cancel и сразу новая роль | Busy сохраняется до terminal ответа исходного prompt. Permission/cancel и поздние updates маршрутизируются в прежнюю session; соседняя Task продолжает работу |
| Disconnect с неизвестным write | Сохранены pending/operation ID и recovery; нет автоматического повторного write или сброса бюджета под новой ролью |
| New session / restart | Сохраняются Task/run/attempt, scope, accepted decisions, вопросы, evidence и drafts; не повторяются выполненные действия; auth либо подтверждён, либо показана точная проблема |
| Scope/tools/memory | Reviewer prompt не выдаётся за технический sandbox; запрещённый host tool отклонён. Task A не получает память другого project, приватные payloads/permissions или window/browser/PTY authority B. Global и разрешённая общая память текущего project доступны обеим Task; найденное в памяти разрешение B не выдаёт авторизацию A |
| Недостаточный контекст | Считается весь наблюдаемый input; unknown overhead виден; нет молчаливого удаления обязательных правил. Quick не читает весь каталог profiles и весь журнал |
| Автоматический выбор роли | Request/Project/Task/stage/resource factors дают объяснимый profile/version и confidence; в UI нет ручного selector. Коррекция цели пересчитывает pending role, текущий turn сохраняет capture, permissions не меняются |
| Native subagent | Main role и child overlay проверены отдельно; child не выходит за captured project binding, parent assignment и central target rules; возврат child не завершает run сам |
| Реальная целевая сборка | Зафиксированы runtime/config/hash, поддержанный механизм, A/B запуск и scope наблюдения. Успех mock/Qwen source probe не назван доказательством Giga hot switch |

## 11. Небольшие шаги реализации

1. **RP1 — catalog и compiler:** прочитать существующие встроенные профили, snapshots и текущие services; реализовать deterministic composition, manifest и cache. Проверить duplicate/missing/conflicting inputs и Unicode/переводы строк без изменения legacy hashes.
2. **RP2 — runtime probe и delivery adapter:** зафиксировать supported surface целевой версии, отдельные append/override/context-only стратегии и безопасный child launch. Вернуть фактический receipt; неизвестное не маскировать.
3. **RP3 — activation transaction:** подключить существующий Task writer/SessionService, revisions, idempotency, idle boundary, checkpoint и process/session generation. Проверить A/B, cancel, stale plan и pending recovery.
4. **RP4 — role chip и очередь:** read-only reason/confidence/factors, selected/captured/actual status, on-demand diff/версии/ограничения, без role picker, обязательного wizard и перечитывания каталога при каждом клике.
5. **RP5 — целевая живая приёмка:** пройти короткий brief → уже разрешённую реализацию → адресную проверку; отдельно analysis-only, конфликт, role switch при 429 и restart. Сохранить actual build/runtime evidence и ограничения; выдать небольшой пригодный результат по [DELIVERY_AND_DOGFOOD_PLAN](DELIVERY_AND_DOGFOOD_PLAN.md).

Эти карточки уточняют существующие M4/M5 и RRole1–RRole5; не создают отдельный workflow engine или обязательный новый run. Первый полезный срез может честно использовать verified context-only доставку, если её достаточно для порученной работы, сохраняя отдельным невыполненным требование настоящего системного binding. В финальной native реализации не запускать PowerShell на каждый turn ради сборки текста.
