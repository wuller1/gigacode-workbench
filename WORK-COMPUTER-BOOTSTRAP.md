# Автономный запуск на рабочем компьютере

Data runtime: перед переносом БД прочитай [DATABASE-RUNTIME-HANDOFF](docs/suite/DATABASE-RUNTIME-HANDOFF.md). Там описаны рабочий код, настройка MCP, повторяемые проверки и оставшиеся gaps. Сначала сравни существующий код пользователя; не заменяй более удачный без предметного сравнения.

Обновление 14.10.2026: добавлена рабочая IDE на Theia с Java/Python/frontend расширениями, общими с агентом buffers, семантическими операциями, build/test/debug bridge и восстановлением. Установка, перенос и границы проверки: [IDE-RUNTIME-HANDOFF](docs/suite/IDE-RUNTIME-HANDOFF.md). Полная матрица Ultimate остаётся отдельной пофункциональной приёмкой.

Этот файл — единая точка входа для агента GigaCode на рабочем Windows-компьютере пользователя. Пользователь поручил:

1. перенести и активировать Workbench;
2. сохранить полезные сведения прежней обвязки в общей памяти;
3. адаптировать уже подключённые MCP к профилям;
4. проверить установленный GigaCode CLI 26.10.6 и подключить его к приложению;
5. продолжить существующий проект GigaCode UI с учётом уже реализованного результата.

Выполняй работу самостоятельно. Не останавливайся после чтения документов, составления плана или сообщения «настроено». Не проси пользователя повторить требования из этого репозитория. Задавай вопрос только при реальном блокере, который нельзя установить из открытого проекта, локальной конфигурации, сохранённого checkpoint или безопасного read-only осмотра. Обычные обратимые действия локальной настройки уже поручены.

Это поручение не разрешает публиковать частный код, секреты или корпоративный GigaCode; менять Jenkins/OpenShift; выполнять деплой; обходить сертификаты, execution policy или ограничения безопасности; массово перенастраивать существующие репозитории. Не изменяй исходники чужого CLI.

## 0. Найди корни и восстанови продолжение

Считай каталог этого файла корнем исходников `RepoRoot`. Не считай соседний installer или распакованный release отдельным UI-репозиторием.

1. Прочитай `AGENTS.md`, `README.md` и `docs/IMPLEMENTATION_STATUS.md`.
2. Прочитай `workbench/START-HERE.md`. Для самонастройки следуй `workbench/SETUP-AGENT.md`; этот файл определяет цель и последовательность, но не заменяет его проверки.
3. До записи найди прежний receipt и checkpoint по `workbench/docs/POST_SETUP_HANDOFF.md`. Обычный адрес карточки — `<TargetRoot>/workbench-memory/bootstrap/gigacode-ui-handoff.json`.
4. Если соответствующая установка уже подтверждена и входы не менялись, не переустанавливай её. Проверь хеши/активацию и продолжи с незавершённого этапа.
5. Не сканируй весь компьютер. Разрешены адресные проверки открытого проекта, конфигурации GigaCode, известных пользовательских каталогов GigaCode и путей из receipt/checkpoint.

Веди установочный журнал в отдельной рабочей папке вне этого репозитория, установленного Workbench и памяти. Не помещай секреты, полное окружение или необработанные корпоративные логи в журнал.

## 1. Установи фактическую конфигурацию GigaCode

Проверь и запиши с происхождением:

- версию GigaCode CLI; актуальная ожидаемая версия пользователя — **26.10.6**; 26.9.75 в прежних отчётах является историческим baseline и не подтверждает новую установку;
- фактическую CLI-команду или entrypoint и поддерживаемые ACP-аргументы;
- Windows PowerShell 5.1, LanguageMode и доступность записи;
- действующий `GIGACODE_SYSTEM_MD`, личный `GIGACODE.md`, каталоги памяти и профилей;
- реальный формат MCP-конфигурации без чтения/печати значений секретов;
- доступные MCP tool names, schemas, эффекты и области действия;
- доступные model/reasoning config options через настоящий readback CLI.

Пользователь уточнил: на работе будет **GigaCode IDE — форк IntelliJ IDEA Community**. Это отдельный продукт, а не наш IDE runtime. Если агент запущен внутри него, адресно прочитай доступные About/build metadata, project settings и список установленных plugins; не считай их версиями Qwen или Theia. Не копируй корпоративную IDE в наш дистрибутив. Для дизайна и привычных действий основной ориентир — IntelliJ IDEA, но сама IDEA в Workbench не встраивается, наличие Ultimate-лицензии не предполагается. Сравнение с уже реализованными частями пользовательской оболочки сохраняется; подключать обязательный companion plugin или менять архитектуру только из-за наличия GigaCode IDE не нужно.

Не переноси флаги Qwen в GigaCode по предположению. Не называй совместимость подтверждённой по документации или сходству форка.

Для ACP сначала выполни бесплатный metadata/config probe по `docs/MANUAL_ACP_PROBE.md`. Платные prompt-проверки не запускай без отдельного явного разрешения пользователя. Не повторяй запрос после неизвестного исхода.

## 2. Подготовь и установи Workbench

Следуй точному процессу `workbench/SETUP-AGENT.md`:

1. Проверь `workbench/MANIFEST.txt` и `workbench/scripts.json`.
2. Если материализованные `.ps1` отсутствуют, восстанови их только из соответствующих файлов `workbench/source/*.txt`. Не переписывай отличающийся существующий файл без выяснения происхождения.
3. Запусти в Windows PowerShell 5.1:

   ```powershell
   powershell.exe -NoLogo -NoProfile -File .\workbench\workbench.ps1 validate
   powershell.exe -NoLogo -NoProfile -File .\workbench\tests\run-tests.ps1 -RequireNode
   ```

   Если Node отсутствует, зафиксируй отдельный непроведённый JavaScript check; не выдавай это автоматически за поломку контроллера. Обязательный провал установки не обходи.

4. Определи `TargetRoot` из фактической конфигурации GigaCode; обычный вариант — `$env:USERPROFILE\.gigacode`. Не зашивай имя пользователя или диск.
5. Подготовь новый личный `GIGACODE.md`, сохранив предметные ограничения пользователя и удалив конфликтующие процессные правила старой обвязки. Добавь короткие указатели на установленный Workbench, `local-context.json`, общую память и checkpoint.
6. Запусти `install-user.ps1` сначала с `-PlanOnly`, проверь точный список изменений и конфликты. Примени установку только с возвращённым `ExpectedPlanHash` и теми же параметрами.
7. Передавай `-GlobalContextPath` на подготовленный личный контекст. Сохрани существующий `GIGACODE_SYSTEM_MD` с происхождением и способом отката; не меняй его ради смены ролей. `-SetUserSystemPrompt` — только для действительно проверенной и выбранной legacy установки. Для App используй процессный CORE + role binding из раздела 4а ниже; неизвестный GigaCode пока получает context-only без догадки о Qwen flags.
8. `-IncludeAgents` применяй только после проверки формата нативных субагентов и реальных tool allowlists. Последовательные профили должны работать и без этого флага.
9. Сохрани receipt, резервные копии, фактические пути и результаты проверок. Не устанавливай hooks и не запускай onboarding существующих репозиториев.

## 3. Перенеси знания и адаптируй MCP

Общая память располагается отдельно от заменяемого Workbench, обычно в `<TargetRoot>/workbench-memory`.

1. Следуй `workbench/docs/SHARED_MEMORY.md` и `workbench/docs/PROCESS_ADAPTATION.md`.
2. Импортируй адресно полезные личные инструкции, решения, прежнюю память и текущий подтверждённый контекст. Для каждой записи сохраняй источник, scope, дату/версию или хеш и статус доверия.
3. Не импортируй секреты, полные логи, временные ошибки, дубликаты, устаревшие разрешения или весь архив разговоров без необходимости.
4. Повторный импорт должен быть идемпотентным. Старые сведения не становятся verified только из-за миграции.
5. Следуй `workbench/docs/MCP_PROFILE_SETUP.md`: сопоставь 14 шаблонов пакета с фактически действующими профилями. Сохрани девять рабочих профилей и существующий LLM-router; настрой реальные bindings используемых профилей. Новые роли не активируй автоматически как часть миграции. Отдельная оптимизация профилей записана в `suite/implementation-plan.json/requestedFollowUps`.

Ожидаемое назначение подключений:

| MCP | Назначение |
| --- | --- |
| Git | репозитории, ветки, diff, история и pull request в разрешённых границах |
| Confluence | требования, SDD, решения и корпоративные знания |
| Jenkins | сборки, тесты и диагностика CI |
| OpenShift | чтение состояния окружений и явно поручённые операции |
| Sprut | сведения об уязвимых версиях библиотек; чтение отчёта не доказывает наличие команды запуска сканирования |

Сначала прочитай реальные schemas. Не выдумывай tool names, endpoints или credentials. Не расширяй глобальные permissions ради профиля. Сохрани inventory, bindings и permissions в памяти и укажи их в `workbench/config/local-context.json` без секретов.

## 4. Активируй и проверь настройку

До перезапуска создай/обнови обе карточки из `workbench/docs/POST_SETUP_HANDOFF.md`:

- `<memory_store>/bootstrap/gigacode-ui-handoff.json`;
- `<memory_store>/bootstrap/gigacode-ui-handoff.md`.

В них должны быть: `RepoRoot`, установленный Workbench, `TargetRoot`, memory store, receipt/backup, версии, MCP inventory/bindings, результаты probe, фактический delivery mode/receipt инструкций и состояние router adapter, известный путь UI-репозитория, текущий этап, открытые ограничения и точный следующий шаг.

Если изменение `GIGACODE_SYSTEM_MD` требует перезапуска:

1. сохрани checkpoint;
2. сообщи пользователю только о необходимости полностью перезапустить GigaCode;
3. в новой сессии сам найди checkpoint;
4. не проси повторно прислать это поручение;
5. проверь фактическую загрузку legacy entrypoint/CORE, `/workbench`, памяти, профилей и MCP. Не называй ответ модели доказательством system placement; режим и scope подтверждения сохраняй отдельно.

Выполни короткую безопасную проверку памяти между сессиями. Не используй ответ модели «всё работает» как доказательство; нужны readback, файлы или наблюдаемое поведение.

## 4а. Перенеси роли, системные инструкции и рабочий LLM-router

Это обязательная часть миграции обвязки. Не заменяй существующий удачный маршрутизатор встроенным fallback и не создавай второй controller рядом с ним.

1. Сохрани backup/checkpoint текущих промптов, каталога ролей, router, session IDs и настроек запуска. Установи, где находятся общая политика, профиль, project rules, task context и реальные CLI settings. Сравни с `workbench/CORE.md`, `workbench/profiles/*.md`, `app/electron/prompt-binding.ts`, `app/electron/role-router.ts` и точкой `new WorkbenchService` в `app/electron/main.ts`. Переноси matching shared types/service contracts совместно.
2. Общая исполняемая база — **CORE + ровно один профиль**. `SYSTEM_PROMPT.md` — legacy/bootstrap entrypoint, его не нужно повторно компилировать поверх CORE. Project policy, принятые требования и короткий task packet передаются отдельно. Не встраивай каталог, всю историю/SDD/память в system append.
3. `compileInstructions` создаёт immutable текст, source hashes и fingerprint. `discoverPromptCapability`/`planPromptBinding` выбирают delivery. Текущая allowlisted source evidence относится к точным bytes **Qwen 0.25.1**, а не GigaCode 26.10.6. Для неизвестного Giga сохраняй **context-only** до source review и ACP-проверки реальной сборки. Не меняй family/version ради включения append.
4. Найди действующий workplace LLM-router и подключи через **`WorkbenchOptions.routeProfile`** — тип `RoleRouter` из `app/electron/role-router.ts`. Adapter получает `RoleRoutingInput` и `AbortSignal`, возвращает `{profileId, reason, confidence}`. Используй request + conversation + task + project + доступные IDs; сопоставь поля прежнего router с этим контрактом. ID должен существовать, reason непустой, confidence 0..1; host валидирует ответ. Adapter уважает abort/deadline, не выполняет задачу и не выдаёт permissions. Credentials/context payload в диагностике не печатай.
5. Передай adapter в существующий `new WorkbenchService({ ..., routeProfile })`. Не удаляй более качественную workplace router logic; оберни её проверенным контрактом. Headless Qwen router предназначен только для подтверждённого Qwen. Giga без adapter сохраняет текущую роль и `roleRouting.source=retained`: это ограниченный режим, **не готовая автоматическая маршрутизация** и не keyword-эквивалент LLM-router.
6. Сохрани девять действующих workplace IDs и пользовательские настройки. Architect/database/designer/security/technical-writer добавляй как проверяемое расширение, не скрытую замену при импорте. Custom roles сохраняют ID/version/description/source, переименование не разрывает историю.
7. Сравни варианты на одинаковых безопасных задачах: brief с противоречием, «теперь реализуй» после описания, локальная UI-правка, SQL/schema, диагностика, независимое review. Сначала structural/fixture без модели; model-сравнение — в уже разрешённом бюджете. Фиксируй профиль, пригодность результата, неподтверждённые утверждения, время/tokens при доступности. Доказуемо лучший существующий вариант сохрани; при несовместимых преимуществах подготовь diff/аргументы и один вопрос о конкретном варианте, а не о выборе роли.
8. Проверь invalid/invented role, low confidence, router timeout/abort и изменение task/project/catalog во время routing. Очередь не потребляется отменённым решением; старое решение не исполняется после существенного изменения входов. Смена роли применяется на безопасной idle boundary, сохраняет Task/решения/evidence/pending и не меняет env/system file другого исполнителя.
9. Process-scoped append сохраняет native CLI base. Существующие user system override/dump settings, duplicate append, Windows command-line overflow и непроверенный entrypoint требуют совместимого fallback/решения, не глобальной перезаписи. Не выдумывай append-file flag. `prepared` — план, `active` — наблюдаемая граница адаптера, не доказательство obedience/полного provider request.
10. Сохрани receipt: source hashes, CLI path/version/fingerprint, delivery mode/reason/evidence scope, router adapter/version, проверки и непроверенное. Показывай роль/состояние компактно без ручного selector. Продолжи уже порученный UI-срез с checkpoint.
11. Перенеси автоматические этапы одной задачи по [IN_TASK_ROLE_TRANSITIONS](workbench/docs/IN_TASK_ROLE_TRANSITIONS.md): `role_transition_request` сохраняет намерение, а host продолжает после чистого terminal/flush и подтверждения LLM-router. Совместно перенеси service/types, MCP и main binding: `mcpServersForSession(sessionId, generation)` → `mcp.binding(sessionId, generation)`. Generation задаёт host, не модель. Внутренний continuation не попадает в очередь пользователя; новое сообщение пользователя имеет приоритет. Не заменяй этим механизмом уже более удачную workplace координацию без сравнения. Giga без проверенного router adapter не получает фиктивный автоматический переход.
12. Сравни и перенеси [отказоустойчивость 0.6](docs/suite/RUNTIME-TRANSITIONS-RESILIENCE.md) единым контрактом: quiesce до ожидания диска, runtime.stopped/main fatal gate, generation-bound questions, ACP process ownership, read-only SnapshotFeed, window/session DraftJournal и bounded renderer recovery. Проверь реальные сбои, а не только успешный запуск. Существующие более полные retries/controller сохрани после сравнения; UNKNOWN не превращай в автоматический повтор. Настройки и работу пользователя не сбрасывай при импорте.

Минимальная локальная регрессия из `app` под Windows PowerShell 5.1:

```powershell
npm.cmd exec --offline -- vitest run tests/prompt-binding.test.ts tests/role-routing.test.ts tests/agent-runtime.test.ts tests/role-transition.test.ts tests/role-transition-mcp.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Role/prompt regression failed' }
```

Эти tests подтверждают host/compiler/fixture, а не GigaCode совместимость. Бесплатный `node tools/test-prompt-binding-live.mjs` относится к вложенному allowlisted Qwen и выполняет только ACP initialize/new; это не Giga probe. Целевой GigaCode проверяй отдельно по `docs/MANUAL_ACP_PROBE.md`. Аудит текущего среза — `docs/suite/RUNTIME-TRANSITIONS-RESILIENCE.md`, исторический 0.5 — `docs/suite/AGENT-HARNESS-AUDIT.md`; если документа нет во взятой ревизии, используй код/тесты и зафиксируй отсутствие, не выдумывай результаты.

## 5. Подключи установленный GigaCode к приложению

Сначала подключи внешний установленный CLI и проверь его фактическое поведение. Используй `docs/MANUAL_ACP_PROBE.md`, `app/CONTRACT.md` и настройки приложения.

Обязательный порядок проверки:

1. `initialize/session` и metadata/config без model prompt;
2. фактические model/reasoning choices и readback;
3. запуск приложения с отдельным тестовым `WORKBENCH_DATA_DIR`;
4. обновление ответа на экране без клика или reload;
5. две независимые сессии/окна без смешения ответов;
6. queue, cancel и explicit recovery после неизвестного исхода;
7. обработка 429, обрывов, 400/413 и HTML error bodies без слепого повторения внешних действий;
8. сохранение состояния после перезапуска и очищенный диагностический пакет.

Если поддерживаемый ACP entrypoint/аргументы ещё не установлены, зафиксируй точное несовпадение и исправь минимальный adapter path приложения. Не патчь GigaCode CLI.

## 6. Сделай собственный runtime внутри сборки

Встраивание выполняй только после проверки внешнего CLI и фактических условий лицензии/передачи. Следуй `docs/BUNDLED_CLI.md`.

- Не копируй весь GigaCode Desktop или пользовательский профиль.
- Создай отдельную чистую папку с entrypoint и всеми runtime-зависимостями.
- Исключи `.gigacode`, `.qwen`, `.env`, auth/credentials, tokens, cookies, OAuth, ключи, историю и сессии.
- Не публикуй корпоративный runtime в открытый GitHub.
- Не добавляй его в commit. `app/runtime/package` остаётся локальным build input.

Импорт из `app`:

```powershell
node tools\bundle-cli.mjs --source "C:\BuildInputs\GigaCode-runtime" --entry "ФАКТИЧЕСКИЙ_ОТНОСИТЕЛЬНЫЙ_ENTRYPOINT"
```

При существующем runtime замена требует явного `--replace` после проверки источника. Затем выполни проверку исходников и упакованного приложения из `app` под Windows PowerShell 5.1. `npm.cmd` исключает случайный запуск заблокированного `npm.ps1`. Ошибка любого шага останавливает дальнейшую упаковку:

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-WorkbenchCheck {
    param([scriptblock]$Action)
    . $Action
    if ($LASTEXITCODE -ne 0) { throw "Workbench check failed: $Action" }
}
Invoke-WorkbenchCheck { npm.cmd ci --include=optional }
Invoke-WorkbenchCheck { npm.cmd run setup:ide }
Invoke-WorkbenchCheck { npm.cmd test }
Invoke-WorkbenchCheck { npm.cmd run build }
Invoke-WorkbenchCheck { npm.cmd run test:ui }
Invoke-WorkbenchCheck { node tools/test-chat-live.mjs }
Invoke-WorkbenchCheck { node --test ../ide/tools/test-python-result-drain.mjs }
Invoke-WorkbenchCheck { node tools/test-ide-live.mjs --languages }
Invoke-WorkbenchCheck { node tools/test-database-live.mjs }
Invoke-WorkbenchCheck { node tools/test-database-live.mjs --ui }
Invoke-WorkbenchCheck { npm.cmd run prepare:ide-package }
Invoke-WorkbenchCheck { npm.cmd exec --offline -- electron-builder --win --dir --x64 --publish never }
Invoke-WorkbenchCheck { node tools/test-database-live.mjs --ui --packaged }
Invoke-WorkbenchCheck { node tools/test-ide-live.mjs --packaged --languages }
Invoke-WorkbenchCheck { npm.cmd exec --offline -- electron-builder --win nsis portable --x64 --prepackaged release/win-unpacked --publish never }
```

Обёртка выполняет scriptblock в текущей области и проверяет код последней native-команды. Это базовая семантика Windows PowerShell 5.1: [dot sourcing/scopes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_scopes?view=powershell-5.1) и [LASTEXITCODE](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables?view=powershell-5.1).

Language acceptance требует доступной команды `python` с модулем venv. Data harness требует PostgreSQL binaries (`WORKBENCH_PG_BIN`, `PGBIN` или обнаруженный локальный путь); он создаёт только собственный временный cluster, не использует рабочую БД. Если зависимости недоступны, запиши конкретный unverified check, заверши независимые шаги переноса и не объявляй полную приёмку. Установщики создаются из уже проверенного `win-unpacked`: не пересобирай его между packaged-проверкой и NSIS/portable. Платные model prompts этим блоком не вызываются.

Проверь именно упакованное приложение: выбранный runtime/version, авторизацию вне runtime, ACP, короткий безопасный запрос, две сессии, restart и диагностируемый отказ на повреждённый манифест в отдельной тестовой копии.

`setup:ide` относится к IDE этого репозитория и не меняет глобальный JDK/Python. Подробности установки, SDK, native buffers/recovery и сравнения с существующей реализацией — `docs/suite/IDE-RUNTIME-HANDOFF.md`. Если оставляешь другой, уже более подходящий IDE engine, сначала адаптируй packaging/resources к нему; не выдавай отсутствие нашего staging за готовую сборку. Новый `session.prepare` получает реальный model/reasoning каталог до prompt. Переноси composer, очередь, MCP и backend контракт совместно, сохраняя существующие IDs и историю.

Проверь отдельный **упакованный** runtime до передачи пользователю. Windows CI сначала собирает `win-unpacked`, запускает `node tools/test-ide-live.mjs --packaged --languages`, затем формирует NSIS/portable из проверенной папки. Сохрани parent mapping `runtime/.ide-package` → resources: electron-builder исключает корневой `node_modules` в extraResources, поэтому отображение только `runtime/.ide-package/ide` теряет зависимости IDE. Regression `app/tests/ide-packaging.test.ts` проверяет настоящий copier electron-builder. Он не заменяет запуск упакованной IDE.

## 7. Продолжи существующий GigaCode UI

Не создавай новый пустой Electron-проект. Найди существующий UI-репозиторий из:

1. текущего открытого проекта;
2. checkpoint/памяти;
3. известных project/workspace settings GigaCode.

Если после этих адресных проверок путь неизвестен, задай пользователю один вопрос о пути. Не сканируй все диски.

Сохрани несохранённые пользовательские изменения. Сопоставь существующую заготовку с этим `RepoRoot`; не затирай её целиком и не переноси mock вместо backend. Прочитай `SUITE-UPGRADE-AGENT.md` и заполни `suite/migration-inventory.example.json`, затем загружай только документы карточки из `suite/implementation-plan.json`. Для миграции прежних workflows дополнительно используй `workbench/START-GIGACODE-UI.md`. Источник фактов о готовности — `docs/IMPLEMENTATION_STATUS.md` и код, а не полный roadmap.

Сохрани существующий LLM-router и подключи через `WorkbenchOptions.routeProfile` по разделу 4а: retained/context fallback этого репозитория не заменяет его. Переноси проверенный недостающий контракт с полной цепочкой imports и matching shared types, а не отдельный экран поверх старого backend. SQL/IDE сохранение, host activityRevision, `expectedCloseActivity` и общий close barrier переносятся совместно по Data/IDE handoff.

Первая работа на целевом репозитории:

1. воспроизводимый запуск существующей заготовки;
2. максимальная локальная диагностика main/preload/renderer/ACP с correlation IDs и очисткой секретов;
3. воспроизведение обновления UI только после клика/reload;
4. воспроизведение и исправление изоляции двух параллельных сессий;
5. retries/backoff для допустимых transient failures, circuit breaker и explicit recovery для неизвестного результата;
6. работа с 429/400/413 и HTML errors;
7. первая проверенная Windows-сборка и короткий пользовательский сценарий.

После ближайшего устойчивого среза продолжай карточки `suite/implementation-plan.json`; для старого workflow-controller сохраняй checkpoints по `workbench/docs/DELIVERY_AND_DOGFOOD_PLAN.md`. Используй Design & Artifacts для dogfood новых экранов. Не отмечай требования выполненными по наличию документа или макета.

## 8. Условия завершения этого поручения

Не заканчивай поручение, пока не получены либо подтверждённый результат, либо конкретный внешний блокер для каждого пункта:

- Workbench установлен или доказано, почему применение заблокировано;
- прежняя конфигурация сохранена и существует путь отката;
- общая память создана, миграция имеет отчёт и не содержит секретов;
- MCP inventory и profile bindings основаны на реальных schemas;
- CORE + одна роль доставлены подтверждённым способом; append/context-only и границы доказательства видны; legacy activation проверена после перезапуска, если применялась;
- рабочий LLM-router сохранён и подключён через adapter, либо retained-mode явно отмечен незавершённой автоматизацией;
- GigaCode ACP/model/reasoning проверены на доступном бесплатном metadata уровне;
- существующий UI-репозиторий определён или запрошен ровно один недостающий путь;
- следующий UI-срез начат, если нет внешнего блокера;
- checkpoint содержит точный способ продолжить после обрыва.

Итог пользователю: что установлено, что проверено, где receipt/backup/memory/checkpoint, какие MCP доступны профилям, что изменено в UI, как повторить проверку, что осталось неподтверждённым. Не раскрывай значения секретов и не выдавай локальный receipt за доказательство качества всей системы.

