# Библиотека скриптов, которая улучшает повторяющуюся работу

Дата: **2026-10-10**. Пользователь разрешил агенту самостоятельно сохранять и улучшать полезные повторяемые операции. Это инструкция и контракт будущей native-функции, **не уже установленный script runner или проверенная оптимизация целевого GigaCode**. CLI не изменяется; нет специальных придуманных Qwen flags.

Использовать существующие ArtifactRegistry, EventStore, Task writer, Scheduler и WorkflowEngine. Library — тип версионируемого артефакта и его индекс, не второй агентный framework. В [Settings](SETTINGS_AND_CONFIGURATION.md) достаточно компактной области **«Автоматизация / Скрипты»**: active versions, происхождение, ограничения, последние результаты, rollback/disable и краткий эффект. Полные workflow не дублируются в новом экране.

## 1. Что агент делает сам, а где сохраняется scope

Внутри текущего поручения и действующих tool/resource permissions агент сам:

1. Находит подходящий проверенный helper вместо повторного сочинения команд.
2. Замечает повторяемую полезную операцию по журналу, предлагает внутренний candidate или сразу создаёт его в разрешённой рабочей области, если это экономит работу.
3. Параметризует и проверяет новую immutable версию на применимых fixtures/входах.
4. Продвигает проверенную совместимую версию в active, измеряет результат разрешённого применения и откатывает ухудшение к прежней версии.

**Каждый обычный helper не требует нового согласования.** Пользователь уже поручил такую оптимизацию. Но сам факт сохранения скрипта не расширяет права: запуск deployment, изменение production-кода/контракта, массовый refactor/upgrades вне поручения, новый доступ, account/endpoint или публикация остаются под существующим [CHANGE_SAFETY](CHANGE_SAFETY.md) и MCP policy. Автономная оптимизация вспомогательного инструмента не разрешает ему оптимизировать чужой проект или менять системные prompts/permissions по собственному усмотрению.

Не сохранять каждую одноразовую команду как продукт. Хороший повод — одинаковая последовательность уже повторилась либо следующая повторная операция явно нужна в текущей задаче; источник решения фиксируется коротко. Число повторов — сигнал, а не требование тратить время на две одинаковые дорогие операции специально. Если простая проверенная команда дешевле библиотеки, выполнить её и продолжить работу.

## 2. Текстовый пакет и локальная библиотека — разные поставки

**Почтовый пакет сохраняется текстовым с разрешённой графикой.** Его 12 `source/*.txt` — исходный материал; `.txt` не является готовым исполняемым runner. Их содержимое/hashes не меняются ради self-optimization. Настоящие локальные `.ps1`/другие helpers Giga создаёт или материализует на целевой машине только в разрешённой области по действующему setup/prepare contract; не переименовывать пакетные файлы на месте и не включать новые executables в ZIP.

App-managed library находится отдельно от immutable bundle: host определяет реальный data/work root и проверяет доступ. Не угадывать `%APPDATA%`, cwd или чужой репозиторий как место установки. Native registry появится в SL1; **до него SL0** позволяет агенту сохранять versioned source, краткий manifest и test evidence как обычные artifacts в уже разрешённом рабочем каталоге. Это не заявление о готовом автоматическом backend registry.

Для Windows известная базовая среда — **Windows PowerShell 5.1**. В manifest указать точный engine/минимальную версию, architecture, encoding, необходимые modules/executables и их обнаруженные версии. Успех на pwsh 7/macOS не подтверждает PS5.1/.NET Framework. Node/Python/другой runtime допустим только когда реально есть в соответствующем проекте/host и разрешён; скрытую новую runtime-зависимость не вводить. Не устанавливать зависимости по каждому запуску helper.

## 3. Scope и структура записи

**Project** library содержит знание о данном repo/toolchain и его допустимых операциях. **Global** — только общий совместимый helper без project paths, account names, private бизнес-данных или credentials; promotion project→global — отдельная проверка portability и области, а не перенос всех входов. Global доступность не даёт дополнительных прав в принимающей Task.

Поля ниже — предлагаемый native manifest, **не уже существующая ACP/CLI schema**. Данные остаются у existing writer и versioned ArtifactRegistry; memory может содержать ссылку на helper, а не заменять его проверенный source.

| Поле/связь | Смысл и проверка |
|---|---|
| Stable helper ID, scope/project, purpose/tags | Адресная задача helper, версия схемы и правила поиска; совпавшее display name не перезаписывает запись |
| Immutable version/parent/source ref и SHA-256 | Exact source bytes; parent и producer Task/run/actor. Edit создаёт новую версию, active bytes не меняются |
| Runtime/dependencies/environment fingerprint | Engine/platform/architecture, реальные dependencies/версии, требуемые resource/API schemas и значимые настройки; unknown не compatible |
| Input contract | Typed parameters/JSON stdin schema, обязательные значения, bounds и path scope; нет скрытых значений из текущего окна или случайного env |
| Output contract | Вид результата, schema/encoding, success/failure/partial, размер, exit semantics и evidence refs; exit 0 сам не доказывает весь контракт |
| Effects/read/write scopes | Файлы/сеть/MCP/processes, target/environment, read-only либо реальные writes, idempotency/reconciliation method и deadline |
| Validation refs | Tested source hash, fixture/input revisions, runtime, assertions/results, реальный coverage и ограничения; known-bad/negative case где нужен |
| Lifecycle/health | candidate/tested/active/retired; отдельно quarantine reason и effective usability. Active pointer меняется CAS-командой, история сохраняется |
| Baseline/observed metrics | Время, input bytes/tokens где наблюдаемы, количество вызовов/ошибок, среда/объём входа; estimated/unknown подписаны |
| Execution receipt | Task/run/attempt, helper version/hash, входная revision, scope authorization, start/end/outcome/effect IDs и привязанные artifacts |

Хранить секреты в manifest/source/args/logs нельзя. Получать нужную авторизацию через имеющийся host credential/MCP механизм с scoped refs; input snapshots очищаются по policy. Нельзя «спрятать» токен в global helper и считать его reusable знанием.

## 4. Дешёвый поиск и повторное использование

Перед повторяемой операцией запросить индекс по purpose/типу входа/current project/runtime/effects. **Не больше трёх наиболее подходящих кандидатов** в обычном контексте; сначала короткие metadata, затем только выбранный manifest/source delta. Не перечитывать всю библиотеку, все старые logs и все версии на каждом turn.

1. Сверить current scope, active pointer, source hash, input contract, runtime/dependency fingerprint и required permissions. Quarantined/retired/unknown-compatible версия не запускается автоматически.
2. Проверить, применимо ли прежнее validation evidence к текущей версии helper и среде. При полном совпадении не повторять неизменные дорогостоящие self-tests; новый реальный запуск всё равно имеет собственный outcome.
3. Запустить через фактически доступный tool/service. Перед write сохранить intent; принять реальный результат, проверить output contract, связать с текущей Task. Не подменять проверку изменённого приложения старым helper test receipt.
4. Если подходящего helper нет, выполнить текущую работу простым способом и оценить маленький candidate; отсутствие библиотеки не повод блокировать обратимую разрешённую операцию.

## 5. Создание, проверка, promotion и rollback

**Candidate** сохраняет источник повторения: например две конкретные journal operation refs, тип/объём входа, прежний способ и ожидаемую пользу. Достаточно короткого manifest/delta; отдельные SDD, отчёт на много страниц или новый reviewer-agent для каждого helper не нужны.

Агент выделяет детерминированную часть: параметры и валидация вместо копирования project constants; чтение/парсинг/сбор результата вместо LLM на каждый файл. Не прятать изменения смысла, пропуск ошибки или непроверенную зависимость под «ускорением». Сначала source/code review по конкретной области, затем применимые positive/negative проверки. Для file/MCP writes сначала temporary fixture или реально доступный dry-run contract; сам придуманный `--dry-run` не является защитой. Не повторять настоящий write только для сравнения скорости.

**Tested** — actual запуск проверок на указанных runtime/входах с наблюдаемыми assertions. Если нужная PS5.1/служба недоступна, сохранить target-not-run и использовать только доказанно допустимый прежний путь. **Active** — tested version прошла compatibility, effect/scope проверки и обычный разрешённый запуск, дала корректный output; policy позволяет её автоматическое повторное использование. Различать «проверен» и «быстрее»: отсутствие измеренного выигрыша не превращать в claimed optimization.

Promotion выполняется автоматически в уже разрешённой области через CAS active pointer; сохранить прежнюю рабочую версию и явное основание. Новая версия не меняет уже запущенный invocation/captured script hash. Несколько Tasks не соревнуются за один mutable file: concurrent candidate остаются отдельными версиями, stale promotion получает conflict.

При ошибке/ухудшении нового helper — зафиксировать receipt, удержать affected use, снять effective active для этого compatibility scope, **quarantine** проблемную версию и вернуть подходящую previous active. Rollback меняет только выбор будущих запусков; не отменяет уже выполненные внешние effects. Источник/payload не удалять из-под текущего расследования. Если исход write неизвестен, никакой автоматический запуск старой версии «взамен» до reconciliation.

**Retired** сохраняет history/provenance и не используется новым dispatch. Удаление bytes допускается только общей retention/integrity policy ArtifactRegistry; не разрушать evidence прошлых runs. Исправление quarantine создаёт новую candidate version и адресную проверку, а не снимает флажок без основания.

## 6. Cache не заменяет новую проверку приложения

Различать два cache:

- **Validation cache helper**: ключ включает exact source hash, manifest/input schema, проверенные fixture/dependency/runtime versions и значимые env/tool schemas. Source/dependency/runtime/config change инвалидирует соответствующее evidence. Хранить область применимости, не один вечный зелёный badge.
- **Read-only output cache**: только если контракт допускает reuse. Ключ включает helper version, параметры, input/source revisions/hashes, authorization/data scope и declared freshness. Repo/code/file изменились, external revision неизвестна, TTL истёк или permission отозван — output stale. Нельзя cached pass тестов перенести на другую ревизию кода или cache write outcome выдать за новую операцию.

Перед использованием сверять hash/metadata из canonical store; corrupted/missing artifact или индекс несогласован — quarantine cache entry и адресный rebuild, без выполнения подозрительных bytes. Cache hit записывает происхождение/reuse evidence, но не поддельный «тест только что запущен». Полезный неизменный результат можно использовать без лишнего повторения после доказанной проверки зависимости.

## 7. Запуск, paths, inputs и effects

Host разрешает фактический executable/entrypoint и создаёт процесс с **массивом аргументов, без shell interpolation**. Не конкатенировать пользовательские paths/values в `-Command`, `Invoke-Expression`, bash string или URL; сложные данные передавать по валидированному bounded JSON stdin/файлу параметров. Для PS5.1 проверить настоящий launch/encoding/exit contract на Windows; не полагаться на API только .NET Core или случайный global pwsh.

Canonical roots, symlink/reparse escape и source hash проверяются перед исполнением. Артефакт не берётся из произвольного пути, указанного непроверенным логом. Exact validated bytes захватываются execution manifest/контролируемым неизменяемым snapshot, чтобы замена файла между lookup и запуском не подменила код. Resource owner проверяет cwd/env и область effects; выход за scope не разрешается тем, что script когда-то был active.

Скрипт не получает общий unrestricted shell/MCP bypass ради удобства. Native инструмент Giga может иметь собственные реальные permissions; host не заявляет контроль того, что он не перехватывает. В manifest указать необходимую границу и её actual enforcement/unknown. Непроверенная техническая изоляция не превращается в подтверждённую из текста prompt.

Один общий Task/operation retry budget. Ненулевой exit, schema mismatch и частичный результат различаются; **повтор скрипта не является автоматически идемпотентным**. Timeout после Git/MCP/deploy/migration/write: сохранить operation ID и unknown, сверить фактический target. Script version switch, quarantine rollback и новый helper ID не обнуляют attempts и не разрешают replay всей операции. Cancel ждёт соответствующий actual process/operation outcome, а не только закрытие UI.

## 8. Самооптимизация ограничена полезной работой

Триггеры: повтор операции в уже выполняемой Task; существенная failure/compatibility delta; завершение небольшого среза, когда есть явно полезный candidate. Metadata о повторении собирает существующий EventStore; deterministic lookup/счётчики не требуют LLM. Нет постоянного «optimizer agent», фоновых model calls на timer, бесконечного профилирования или рекурсивной оптимизации собственного журнала.

Предлагаемая стартовая policy: **не более одного нового candidate/improvement за обычный рабочий срез**, а остальное — queued proposal. Это host/project budget, не лимит CLI. Срочный пользовательский результат имеет приоритет; candidate можно оставить незавершённым с точным next step. Не обнулять лимит созданием новой Task/версии. Небольшие адресные maintenance actions в разрешённой области не требуют отдельной Task/формального интервью.

Сравнение измеряет наблюдаемые величины на сопоставимых входах: elapsed wall time/локальная latency, число tool calls, объём читаемых данных/context input, ошибки/повторные попытки. Provider latency и локальный код разделяются, hidden CLI token overhead — unknown. Одна быстрая проба не доказывает устойчивое улучшение; сохранять baseline/input size/environment и ограничение выборки. Критерий correctness не уменьшается ради скорости. Не добавлять benchmark в production только ради красивой цифры.

При подтверждённом выигрыше/упрощении агент автоматически выбирает новую активную версию для будущих подходящих операций и кратко фиксирует эффект. Если выигрыш не подтверждён — нет необходимости бесконечно тюнинговать: оставить рабочий вариант либо candidate с честным статусом. Пользователю достаточно полезного итога/существенной ошибки; подробные tuning events остаются в диагностике.

## 9. Карточки внедрения

| Карточка | Когда и что сделать | Минимальный gate |
|---|---|---|
| **SL0 — инструкция агенту сейчас** | При bootstrap читать этот контракт только при повторяемых операциях; использовать доступные file/tools, source text + metadata/evidence в разрешённом work root. Сохранить рабочие scripts пользователя с provenance, сначала непроверенный import | Найти/сохранить один полезный helper без изменения 12 bundle sources; не заявить native registry/Windows validation до реализации/запуска. Нет forced repo setup |
| **SL1 — native registry и lookup** | **M4.10 / D5**: script artifact kind/index, global/project scope, immutable versions, active pointer, metadata top-3 и Settings/Automation summary | Same-name conflict не затирает версию; global не выдаёт project secrets; restart/CAS, retired/quarantined исключены. Один EventStore/writer, без PS per-turn runner |
| **SL2 — validation и безопасный dispatch** | **M4.10 / D5**: runtime/input/effect manifest, actual launcher, source snapshot/hash, validation cache, bounded stdout/evidence | Positive helper и invalid input/hash/reparse/PS-runtime mismatch; changed dependency invalidates evidence. Unknown write не replay; fixture и live scope различаются |
| **SL3 — измеренное автоматическое улучшение** | **M4.10 / D5**, после SL1–SL2: bounded repetition signal→candidate→test→measured promotion, rollback/quarantine, useful output freshness | Старый correct baseline сохранён; новая версия применяется без approval каждого normal helper, failure откатывает только future pointer. Разный code revision не наследует cached test pass; никаких endless/background LLM loops |

Это срез существующего native Workbench, а не зависимость для каждой маленькой задачи. UI library summary показывает version/status/source/scope/compatibility, последний run и rollback, но не притворяется установленным CLI tool. Конкретные процессы реализации — [MAIN_WORK_PROCESS](MAIN_WORK_PROCESS.md), [ADAPTIVE_EXECUTION](ADAPTIVE_EXECUTION.md), [MCP_PROTOCOL](MCP_PROTOCOL.md), [JOURNAL](JOURNAL.md). Применять их по необходимости, без полной загрузки пакета.

Для приёмки показать: повторное разрешённое действие нашло подходящий helper; candidate проверен на actual доступной среде; активная версия захвачена по hash; локальный эффект измерен; изменённый input/code invalidates cache; ошибка quarantine/rollback не теряет историю и не повторяет uncertain effect. Новый parser/manifest/launcher проверяется адресно; не требовать full regression всего проекта после правки подписи в library UI. Все целевые проверки этого документа пока **target-not-run**.
