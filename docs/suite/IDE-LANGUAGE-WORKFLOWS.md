# Полноценная IDE: Java, Python и frontend

Дата исследования: 2026-10-13; расширение до глубины Ultimate — 2026-10-14. Читать [архитектурное исследование](IDE-ULTIMATE-RESEARCH.md) и адресные строки [Ultimate parity](IDE-ULTIMATE-PARITY.md), а не считать этот краткий языковой контракт полным списком функций. Это инженерный контракт и сценарии приёмки для утверждаемого макета. Он **не означает**, что языковые серверы, debugger или framework intelligence уже работают в `app/`. Реализация начинается после общего `prototypeApprovalGate` по [AGENTS.md](../../AGENTS.md). Приоритет — ежедневная работа на Windows, включая Windows PowerShell 5.1 и удалённый рабочий стол.

Документ развивает [IDE.md](IDE.md), [полный объём IDE/Data](IDE-DATA-FULL-SCOPE.md) и [Git внутри IDE](IDE-GIT-PARITY.md). Владельцы остаются в [существующем плане](../../suite/implementation-plan.json): S4-01…S4-07, S3-01…S3-04. Не создавать параллельную систему карточек, документов, Git или запусков. GigaCode CLI остаётся неизменённым; IDE services принадлежат Workbench и доступны UI и агенту через один API.

## 1. Что должно получиться

Открыть существующий проект → понять его реальные модули и окружения → найти код → исправить его → получить диагностику → запустить нужный тест → остановиться на breakpoint → увидеть изменения → подготовить review. Эти операции должны работать без просьбы к агенту написать разовую команду. Агент использует те же операции и показывает пользователю тот же документ, процесс, тест или отладочную сессию.

Полнота измеряется завершёнными сценариями каждого стека. Подсветка синтаксиса, Monaco и кнопки Run/Debug сами по себе не дают полноценную IDE. Семантический rename не подменять текстовой заменой; обнаруженные по исходникам маршруты не называть проверенными работающими endpoints; зелёный test fixture макета не является результатом теста проекта.

Перед переносом на рабочий компьютер агент сравнивает эти сценарии с уже существующей реализацией пользователя. Сохраняет удачные buffers, adapters, lifecycle и UX. Если варианты действительно различаются по качеству, показывает конкретные результаты сравнения и спрашивает, какой оставить; одно отсутствие знакомой архитектуры не является причиной переписывания.

## 2. Матрица возможностей и пробелов

Все строки ниже — **целевые, до проверки runtime**. Для каждой установленной комбинации нужен отдельный capability record: `capabilityId`, язык/framework, `adapterId/version`, toolchain, host/root, состояние, причина ограничения, проверка и evidence. Состояния: `unavailable`, `installable`, `starting`, `indexing`, `ready`, `degraded`, `error`. `ready` сервера не равно готовности каждой функции.

| Область | Основа, которую можно переиспользовать | Что дополнительно делает Workbench | Владелец / критерии |
|---|---|---|---|
| Документы и окна | Monaco, существующий DocumentService | Один buffer/version, tabs/splits, local history, crash draft, conflict preview, межоконное согласование | S4-01/02; IDE-01…03, IDEX-01/11 |
| Языковые функции | LSP, отдельный adapter каждого языка | Project model, project SDK, диагностика с version, readiness, cancellation, restart, UI preview | S4-03; IDE-04/05 |
| Java | Eclipse JDT LS, JDT, Maven/Gradle import | Разделённые JDK, modules/classpath, generated sources, build/profile/configuration UI | S4-03/06; IDEX-04 |
| Java tests/debug | Java Debug Server; Java Test Runner как источник адаптерной реализации; project build tools | Собственный test tree/result stream, выбранный метод, rerun failed, DAP lifecycle, coverage | S4-03; IDE-06, IDEX-07/08 |
| Spring и persistence | Spring Tools как кандидат; project metadata, отдельные XML/YAML/properties services | Согласование Java model, config-to-code, beans/endpoints, HTTP checks; JPA/SQL отдельные capabilities | S4-06; IDEX-04/10 |
| Python | Pyright + Ruff; debugpy; pytest/unittest | Выбор interpreter, manager/lockfile, package actions, test collection, одинаковое окружение редактора и запуска | S4-03/06; IDEX-05/07/08 |
| Python refactorings/frameworks | Проверенные Pyright code actions; опционально pylsp/Rope; framework adapters | Preview/undo, no duplicate providers, Django/FastAPI/templates/notebooks отдельными срезами | S4-05/06; IDEX-03/05 |
| Frontend | TypeScript проекта + LSP wrapper, HTML/CSS/JSON services, ESLint/Prettier, js-debug | Multi-root/package ownership, aliases/references, test adapters, Vite server lifecycle, exact browser target | S4-03/06; IDEX-06…08 |
| Семантические изменения | Реальные code actions/commands конкретного сервера | Матрица rename/move/extract/inline/signature/safe-delete по языку, preview, conflict, atomic apply/undo | S4-05; IDEX-02/03 |
| Git и review | Единый GitService и корпоративный forge adapter | IDE gutter, staged/unstaged/live buffer, graph/branches, merge editor, PR navigation | S3-01…04 + S4-02; SCM-01…12 |
| API/profiling/remote | Отдельные runtime adapters | HTTP requests/environments, реальные профили и dumps, host/path mapping | S4-04/06/07; IDEX-09/10/12 |

Если установленный adapter не умеет нужную функцию, показать причину и следующий реальный шаг в настройке. Функция остаётся в реестре; кнопка не должна притворяться работающей. Нельзя объявить IDE завершённой, закрыв только первые две строки.

## 3. Общая архитектура без потери контекста

### Проектная модель

`WorkspaceProject` содержит стабильные `projectId`, `executionHostId`, `rootId`, `repositoryId/worktreeId`, конфигурацию и обнаруженные языковые roots. Java modules, Python packages и frontend workspaces — дочерние элементы модели, а не новые несвязанные чаты. Один репозиторий может содержать все три стека.

`ToolchainRegistry` хранит путь, версию, архитектуру, источник установки, capability probe и причину выбора. Обнаружение не означает установку или обновление. Порядок выбора: явно сохранённая настройка проекта → конфигурация проекта/manager → найденное подходящее окружение → настройка с диагностикой. Не применять глобальный SDK ко всем projects из-за того, что он первым оказался в PATH.

Должны различаться runtimes самого Workbench, языка сервера и проекта. Выбор SDK не меняет исходники проекта, системный PATH, глобальный `JAVA_HOME` или настройки других проектов. Менеджеры зависимостей могут изменять lockfile/окружение; такие действия показываются как отдельные операции с результатом.

### Буферы и семантические операции

DocumentService — единственный владелец текста. Monaco, agent tools и два окна работают с `documentId + baseVersion`; LSP получает открытый **несохранённый** текст. Diagnostics имеют `documentVersion`, источник и root. Ответ к старой версии не заменяет новую диагностику.

Многофайловый refactoring: получить edit → проверить URI/root/version каждого файла → показать diff → применить как одну change set → сохранить undo information. Между preview и apply повторно проверить версии. Если один файл успел поменяться, не применять половину refactoring. Для изменений на диске нужен журнал транзакции и восстановление после сбоя; слово «atomic» в UI не заменяет этот механизм.

Внешний writer, Git checkout, CLI или пользовательский editor не могут молча перезаписать dirty buffer. Открывается three-way conflict: исходная версия, текущий buffer и актуальный диск. Агент видит конфликт и может предложить решение через тот же DocumentService. Возвращение в проект восстанавливает выбранный файл, группу, caret, scroll и tool window, а не первый tab.

### Работа языкового сервера

Один managed language session на совместимую project/root/toolchain конфигурацию, не на каждый файл или окно. Worktree с отдельным состоянием не делит mutable workspace cache с исходной веткой. После crash: ограниченный restart/backoff → initialize → конфигурация → актуальные `didOpen` snapshots → replay только безопасных идемпотентных запросов. Старые code actions и edit transactions автоматически не повторять.

Protocol framing, `initialize`/capabilities, document synchronization, workspace edits и cancellation сверять со [спецификацией LSP](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/). У каждого language server — ограниченный канал логов и correlation IDs; никакой JSON-RPC parsing или бесконечной полной ленты в renderer. Индексация показывает фактическую фазу и счётчик, если он есть; неизвестный процент не выдумывать.

### Run, tests и debug

`RunConfiguration` хранит project/root/host, launcher, args как массив, cwd, environment references, выбранный toolchain, before-run dependencies и политику сохранения. `Run` получает собственный неизменяемый target и snapshot конфигурации. Переключение вкладки или проекта не меняет target уже идущего процесса.

До запуска показать, какие dirty files входят в конфигурацию. Рекомендуемый стандарт — сохранить входящие файлы по установленной настройке; если пользователь запускает сохранённую версию, обозначить это рядом с результатом. Нельзя показывать tests/coverage зелёными для другого buffer или revision. Configurations допускают run current file/module/test, compound backend+frontend, args/env, named variants и before-run tasks; import существующих launch/task configs делается через проверенный перевод с отчётом о неподдержанных полях.

`TestService` использует стабильный test ID, collection revision, run ID, timestamps, duration, failure location, stack и bounded output. Различать passed/failed/skipped/xfail/cancelled/discovery failed/no tests; timeout не является failed assertion. Повтор одного параметризованного теста не запускает молча весь suite. Live результаты приходят в UI сразу, без дополнительного клика или reload.

DAP управляет capabilities, initialize/configurationDone, breakpoints, threads/stack/scopes/variables, evaluate, continue/step/pause и disconnect. Подробности сверять с [официальной схемой протокола](https://microsoft.github.io/debug-adapter-protocol/specification). Неподтверждённый breakpoint обозначать hollow/pending с причиной; неподдержанный logpoint/hit condition не превращать в обычный breakpoint без предупреждения. `evaluate` и изменение variables могут иметь побочный эффект — это записывается в операцию, не считается read-only инспекцией.

Один `ProcessSupervisor` владеет всеми дочерними процессами. Stop прекращает именно выбранный run/debug/test и его принадлежащее ему дерево. Общий внешний Gradle daemon или чужой dev server не убивать по одному совпадению имени процесса. Close/hide панели не означает Stop. После перезапуска приложения сначала выяснить, жив ли процесс, затем reattach либо показать завершение/неизвестный исход; не порождать второй сервер автоматически.

## 4. Java — первый класс рабочего места

### Import и toolchains

При открытии показывать дерево modules/source roots/tests/resources/generated sources/dependencies. Предоставить Maven/Gradle tool window: goals/tasks, profiles, dependency tree, refresh/import, offline mode, failure navigation. Повторный refresh объединяется с активным import, не создаёт параллельные build storms.

Факт исследования: актуальный README Eclipse JDT LS требует Java 21 минимум для запуска сервера, описывает Maven и Gradle support, annotation processing и отдельный `-data` каталог workspace. Перед установкой сверять требования **зафиксированного** релиза. [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls).

Настройка должна иметь четыре различимых поля: launcher JDK языкового сервера, project SDK, build JVM и runtime JDK конкретного запуска. Maven/Gradle toolchain может выбирать иной compiler; UI показывает фактически выбранный. Проект, например, на Java 17 не переводится автоматически на Java 21 из-за требования language server. Для JDT LS использовать отдельный каталог по host/root/worktree и `config_win`; Windows bootstrap не обязан иметь Python только ради upstream wrapper — host может запускать Java непосредственно.

Обнаружить `pom.xml`, `settings.gradle(.kts)`, `build.gradle(.kts)` и wrappers, сохранить module graph. Wrapper имеет приоритет над глобальным manager при сохранённой конфигурации проекта. Не собирать classpath конкатенацией файлов JAR по памяти: брать модель реально импортированного проекта. Различать обычный import и успешную компиляцию. Build failure остаётся видимым, даже если language server ответил ready.

Проверить multi-module зависимости, test/source scopes, resources, Maven profiles, Gradle source sets, generated sources и annotation processors на отдельных fixtures. Lombok/MapStruct и другие processors не объявлять поддержанными по факту Java completion; это project-specific capabilities с реальным compile/import результатом. Corporate repository, proxy/certificate и offline failure должны иметь понятную диагностику без отключения TLS.

### Редактирование

Обязательны declaration/type/implementation/references, type/call hierarchy, Javadoc, constructor/method completion, imports, formatting, quick fixes и generation. Rename package/class/method/field должен учитывать все затронутые roots. Extract method/interface, inline, move type/member, change signature и safe delete в реестре отдельными capabilities, а не общей галочкой «рефакторинг поддерживается».

Для внешней библиотеки сначала искать опубликованный source attachment; если его нет, обозначить bytecode/decompiled view и provenance отдельного разрешённого adapter. Не выдавать сгенерированный декомпилятором текст за исходник пользователя. Проектные XML/YAML/properties и build files получают schema-aware completion и navigation при наличии соответствующих services.

### Tests, debugger и Spring

Java Debug Server подключается как JDT LS bundle; upstream документирует `initializationOptions.bundles` и команду `vscode.java.startDebugSession`, возвращающую порт DAP. Это отдельный add-on, не встроенная функция любого JDT LS. [Java Debug Server](https://github.com/microsoft/java-debug).

Покрыть JUnit, выбранный метод/класс/module, параметризованные тесты и TestNG по проектному engine. Java Test Runner можно изучить для discovery/execution, но его VS Code client и test explorer нельзя просто загрузить в Monaco. [Test Runner for Java](https://github.com/microsoft/vscode-java-test). Первый пригодный адаптер может запускать project Maven/Gradle и импортировать структурированные отчёты, однако granular discovery/debug потом всё равно должны быть реализованы. Конфигурацию engines брать из проекта и документации установленного build plugin: [Maven Surefire](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html), [Gradle JVM testing](https://docs.gradle.org/current/userguide/java_testing.html).

Debug: launch main class/module, attach к выбранной JVM, conditional/exception breakpoints, threads, frames, values, watches, evaluate, source lookup. Hot code replacement — отдельная capability с результатом compile/reload; unsupported class change сообщает о необходимости restart. Coverage должен хранить tool/version и source revision; выбор Java coverage adapter фиксируется отдельно перед S4-03.

Spring Tools — реальный upstream кандидат для Spring intelligence, но требует интеграции server/client contracts. [Spring Tools](https://github.com/spring-projects/spring-tools), [официальная wiki](https://github.com/spring-projects/spring-tools/wiki). В S4-06 выполнить spike на закреплённой версии: Boot configuration completion/navigation, beans, routes и актуальные server requirements. Не обещать полный Spring/JPA parity на основании одного установленного language server.

Различать static endpoint из кода, endpoint из running application и успешный HTTP check. Для последнего сохранять выбранный launch/environment, request и response evidence. Доступ к actuator или рабочему сервису не включать скрыто. JPA entity navigation, mapping validation, query inspection и migrations связываются с Data через общий connection binding, но не считаются реализованными Java LSP автоматически.

## 5. Python — согласованное окружение и настоящий debugger

Базовый путь: Pyright как language/type service, Ruff как lint/format/imports, pytest/unittest как test engines, debugpy как DAP adapter. Pyright package действительно содержит `pyright-langserver`; текущий source реализует navigation, completion, rename и hierarchy handlers. Это не означает паритет с Pylance. [Pyright package](https://github.com/microsoft/pyright/blob/main/packages/pyright/package.json), [language server source](https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/languageServerBase.ts).

Pyright по умолчанию; pylsp — альтернативный language provider, когда проверенные Jedi/Rope capabilities дают нужный результат. Его upstream описывает Jedi navigation/completion и расширения для refactoring. [python-lsp-server](https://github.com/python-lsp/python-lsp-server). Не запускать два одинаковых rename/completion providers одновременно. Ruff оставляется владельцем lint/format; дублирующие hover/format/import actions других providers отключаются настройкой конкретной capability, а не полным отключением Python intelligence. [Ruff editor integration](https://docs.astral.sh/ruff/editors/), [Ruff setup](https://docs.astral.sh/ruff/editors/setup/).

### Interpreter и packages

Окружение выбирается на package/root: путь к interpreter, версия, venv/manager и обнаруженный lockfile. На Windows стандартный путь `.venv\Scripts\python.exe` — лишь кандидат; подтвердить `sys.executable`, версию и import paths на реальном запуске. Не требовать shell activation и не использовать встроенный runtime Workbench как Python проекта.

Поддержать existing venv, uv, Poetry и ручной interpreter. UI умеет выбрать существующее окружение, создать новое, посмотреть dependencies, выполнить согласованную install/sync/update и показать точный diff lockfile. Выбор manager основан на файлах проекта и явной конфигурации; наличие нескольких lockfiles — конфликт настройки, а не повод менять их все.

Факты для adapter: `uv run` по умолчанию приводит окружение проекта к актуальному состоянию до запуска; значит он не подходит для пассивного discovery с обещанием «ничего не меняем». [uv running commands](https://docs.astral.sh/uv/concepts/projects/run/). Poetry документирует `env info --executable` для получения реального interpreter. [Poetry environments](https://python-poetry.org/docs/managing-environments/). Для readonly probe использовать обнаруженный interpreter/информационные команды; для `uv run` проверить version-specific frozen/no-sync semantics и показать effect policy. Не исполнять напечатанный activate script через eval.

Language imports, test collection, debugger и terminal/run configuration используют один snapshot выбранного окружения. После смены interpreter отменить старое discovery, обновить language config, пометить прошлые результаты stale. Уже идущий процесс остаётся на прежнем interpreter до явного restart.

### Tests и debug

Collection выполняется настоящим pytest, возвращает node IDs и structured failure; импорт тестового файла может исполнять project code. Не определять тесты только regex по `def test_`. При запуске конкретного node ID сохранять параметризацию и fixture semantics. [pytest invocation](https://docs.pytest.org/en/stable/how-to/usage.html). Для unittest — свой adapter, не требовать pytest как скрытую зависимость. Coverage.py/pytest-cov выбираются и проверяются отдельно; coverage отсутствует, если tool не установлен, а не равняется нулю.

debugpy предоставляет DAP и launch/attach механизмы. [debugpy](https://github.com/microsoft/debugpy). Запускать adapter/debuggee с корректной совместимостью Python; различать runtime adapter и interpreter проекта. Поддержать module/file, args, cwd, env references, subprocess behavior, exception breakpoints, threads, stack/locals/watch/evaluate. Attach по умолчанию к точному loopback target; remote path mappings относятся к S4-04. Одновременные debugger двух проектов не делят порт или session ID.

Django/FastAPI routes, templates, migrations, application lifecycle и notebook execution — отдельные adapters S4-06. Показывать discovery source и точность. Notebook kernel, outputs и execution order не заменяются подсветкой `.ipynb` как JSON; пока kernel adapter не проверен, UI объясняет ограничение.

## 6. Frontend — TypeScript, React и браузер в одном цикле

`typescript-language-server` — community LSP layer над TypeScript/tsserver, а не официальный Microsoft LSP service. Он сообщает фактически выбранные TypeScript version/source; это нужно показывать в настройке проекта. [TypeScript Language Server](https://github.com/typescript-language-server/typescript-language-server). Зафиксировать совместимые версии wrapper + project SDK; не обновлять project TypeScript потому, что у Workbench новее bundled server.

Понимать package roots, `tsconfig/jsconfig`, project references, path aliases, workspace packages, exports и package manager. Monorepo с несколькими версиями TypeScript должен иметь раздельные совместимые server contexts. Не запускать один server на каждый open tab и не индексировать `node_modules` полным собственным crawler. Контроль exclusions и watchers — из модели workspace, dependencies language service резолвит по проектным правилам.

Редактор: TS/JS/TSX/JSX, props/completion, imports, hover, definition/references, rename symbol/file с корректировкой imports, semantic actions, JSX pairs, HTML/CSS/JSON, source maps. CSS Modules, Sass, Tailwind, Vue/Angular и прочие framework features требуют собственных проверенных services; выделить capabilities, если они используются проектом. React component/hook navigation не выдавать за runtime React inspector.

ESLint и Prettier брать из проекта с найденной конфигурацией, показывать источник правила и formatter. Их APIs позволяют получать diagnostics/format result, но сам Workbench обязан реализовать worker isolation, version matching и application of edits. [ESLint Node API](https://eslint.org/docs/latest/integrate/nodejs-api), [Prettier API](https://prettier.io/docs/api). Config/plugins исполняют JavaScript: это не безвредное чтение JSON. Format on save имеет одного владельца; ESLint fix и Prettier запускаются в детерминированном порядке, не зацикливают запись файла. Save/format сохраняет caret, selection, EOL и undo.

### Dev server, preview и tests

Package scripts отображаются с root, manager, command и запускаются через RunConfiguration. Vite/React preview — process-backed resource: startup, port, ready URL, terminal output, stop/restart. Определять готовность по реальному endpoint/probe, а не одному произвольному слову в stdout. Занятый порт даёт обнаруженный новый URL либо явный conflict; не открывать прежний чужой процесс.

Preview открывает **одну** связанную вкладку BrowserService и переиспользует её по run ID. Различать браузер пользователя и браузер агента по [контракту разделения](SEPARATE-AGENT-BROWSER.md). HMR, source edits, ошибки console/network и выбранный viewport видны без изменения чужого tab/focus. Остановка dev server оставляет понятное состояние preview, не пустую панель.

Test adapters: Vitest, Jest и Playwright по фактическим зависимостям проекта. Первый слой — structured result/reporters; для Vitest upstream документирует JSON/JUnit и другие reporters. [Vitest reporters](https://vitest.dev/guide/reporters). Watch mode, discovery, file/test selection, rerun failed, snapshots, attachments/trace и coverage проверять отдельно. Не парсить ANSI экран как единственный контракт тестов; не заставлять проект сменить runner ради IDE.

### Debug

`vscode-js-debug` — DAP-compatible debugger; upstream содержит OSS implementation. [js-debug](https://github.com/microsoft/vscode-js-debug). Его VS Code extension API не является generic Electron API: standalone launcher/transport, target discovery и config schema требуют отдельного adapter spike. [Extension API / CDP sharing](https://github.com/microsoft/vscode-js-debug/blob/main/EXTENSION_AUTHORS.md).

Node и browser debug — две конфигурации с явным target. Browser adapter подключается к конкретной вкладке/target ID, не к «первому открытому Chromium». Проверить Electron/embedded Chromium transport, isolated profile и конкуренцию DevTools/automation clients. Если standalone adapter пока работает только с выделенным внешним Chromium, это честно обозначенный ограниченный capability; embedded target остаётся в плане.

При breakpoint в `.tsx` source map должна приводить к реальному исходному frame. HMR/remount может изменить mapping — breakpoint снова подтверждается, старые values не остаются будто актуальные. Асинхронные frames, workers, Node child processes, exception breakpoints, step и evaluate поддерживаются по DAP capabilities. Один debug coordinator владеет target и согласует observer/agent/browser control, не создавая двух конкурирующих run controllers.

## 7. UX полноценной IDE

Файлы показываются только внутри IDE. Слева по умолчанию — скрываемое дерево проекта с быстрым поиском; рядом editor groups, снизу — сворачиваемые Problems / Output / Tests / Debug / Terminal. Навигатор отражает выбранный Java module/Python package/frontend workspace; пользователь не вынужден листать весь monorepo ради одного файла.

Основная верхняя строка содержит выбранную run configuration, Run, Debug, Stop текущего процесса и меню расширенных действий. Toolchain/indexing индикатор компактный; подробности открываются по нажатию. Не помещать все SDK, build tools, Git и framework команды в одну строку. Размеры панелей, visible tool window, selection и tabs сохраняются по проекту/окну. При узкой IDE названия вторичных действий переходят в меню; Stop активной работы остаётся доступным.

Breakpoints, diagnostics, modified lines и test run markers в gutter имеют разные формы и tooltip; не перекрывают номер строки. Ошибка в Problems/Tests/console открывает точный source/range, сохраняет возможность вернуться назад. Findings из разных providers имеют source labels и фильтры; дубликаты не превращаются в тройной список одной ошибки.

Search показывает scope/files/results и preview replace; rename показывает affected files до применения. Toolchain/configuration dialogs имеют Save/Cancel, Esc и корректный возврат focus. Если редактирование возможно в форме, переключение темы, completion или background indexing не перерисовывает её с потерей ввода.

Агентский контекст берётся из выбранного файла/диапазона/diagnostic/test/run, с document version и project/session binding. Пользователь видит, какую операцию делает агент. Скрытая IDE-панель не прекращает его процесс, а команда «Показать результат» раскрывает нужный ресурс без похищения ввода в другой панели. Управление buffers, refactoring, tests и debugger идёт через типизированный API, а не имитацию глобальной мыши.

Обязательные состояния макета: пустой проект; обнаружение toolchain; import/indexing; missing/incompatible SDK; missing dependency; diagnostics; test collecting/running/failed/cancelled; breakpoint pending/verified/stopped; dirty external conflict; adapter crash; stale result; offline registry; source map unavailable; restart recovery. Любой демонстрационный результат помечен как макет, не как live evidence.

## 8. Windows и рабочий компьютер

- Launcher использует абсолютный executable, cwd и массив аргументов; не собирает пользовательские пути в shell string. Native `.exe` и Node/Python entrypoints запускаются непосредственно. Для `.cmd/.bat` wrappers нужен отдельно протестированный Windows shell adapter с корректным quoting; нельзя механически использовать POSIX escaping.
- PowerShell terminal — Windows PowerShell 5.1, если другой не обнаружен. UI не зависит от `pwsh`, Bash или глобального Node. Наличие только PowerShell 5.1 не ограничивает запуск native JVM/Python/Node tools.
- Проверить Unicode, пробелы, `&` и скобки в путях, длинные пути в пределах реально поддержанного окружения, drive letters, case-only rename, CRLF/BOM и удалённые roots. UNC/network workspace показывается явно; lock/cache и watcher limitations не скрывать.
- Отдельно управлять proxy/trust/CA для Node tools, JVM, Python и package managers. Не предполагать, что настройка браузера автоматически исправит Maven/pip. Секреты — references из credential store; команды и logs имеют redaction.
- У каждого managed adapter/toolchain есть pin, checksum, source, license notices, version probe, rollback. Корпоративное зеркало и offline import должны быть настраиваемы. Не скачивать обновление SDK каждый раз при открытии проекта.
- ProcessSupervisor проверяется на реальных деревьях Windows: build wrapper → JVM/daemon, package manager → Node/dev server, Python → worker. После stop нет принадлежащих run orphan процессов и занятых его портов. Existing external daemon идентифицировать, не закрывать чужие задачи.
- Renderer получает компактные snapshots/incremental events; logs/results идут через bounded buffers, virtualization и file-backed history. Активный desktop не ждёт фокуса окна, чтобы отобразить завершение tests/indexing. На ВАРМ применять общую настройку [анимаций](REMOTE-DESKTOP-MOTION.md), а не собственный бесконечный таймер IDE.

## 9. Порядок реализации внутри существующих карточек

Порядок `dependsOn` в JSON остаётся авторитетным. Подпункты ниже — детализация карточек, не новый roadmap в обход реестра. Каждый этап заканчивается видимой работающей сборкой и её ограничениями.

| Карточка | Реализация | Что предъявить пользователю |
|---|---|---|
| S4-01 | Secure origin/workers, DocumentService, CAS/recovery, multiwindow events | Реальный файл в двух окнах; conflict без потери текста; восстановление после crash |
| S4-02 | Editor groups/tree/search/Problems, common Run/Test UI, persisted configs; существующий Git integration | Ежедневный edit/search/run цикл. Отсутствующие semantic/debug capabilities явно обозначены |
| S4-03, Java slice | JDT LS/toolchains/import + Java Debug Server + build/test adapters | Multi-module fixture: navigation → compile failure → исправление → один JUnit test → breakpoint/variables → Stop |
| S4-03, Python slice | Interpreter/manager → Pyright/Ruff → pytest/unittest → debugpy | Venv fixture: diagnostics и запуск используют один interpreter; selected parametrized test; debug stack; failure/cancel |
| S4-03, frontend slice | Project TS + web services → ESLint/Prettier → runner → js-debug/BrowserService | Monorepo React fixture: cross-package rename → test → HMR preview → breakpoint в TSX |
| S4-05 | Capability matrix semantic transformations, structural navigation/search, preview/undo | Реальные многофайловые edits с конфликтом имён, compile/tests после apply и полное undo |
| S4-06 | Spring / Python frameworks / React advanced integration, API requests, notebooks по capabilities | Связанный source/config/route/runtime сценарий; ни одна неподдержанная capability не замаскирована |
| S4-07 | Языковые profiling adapters и dump viewers | Настоящий capture → hot path → исходник; tool и revision сохранены, выдуманных метрик нет |
| S4-04 + S9-01/02 | Remote roots/paths и Windows package, multiwindow/performance/license audit | Проверка на целевом рабочем Windows, host isolation, installer/portable; общий review evidence |

Пока runtime не реализован и не проверен, статусы S4/IDEX остаются planned/unverified. Все три language slices входят в S4-03; завершение только Java не закрывает карточку. S4-06 зависит от S4-05, S4-07 — от S4-03; remote может идти по своей ветке после зарегистрированных dependencies. Новые S3 Git карточки ради language toolbar не нужны.

## 10. Приёмка и доказательства

Каждой строке соответствует fixture + ожидаемый реальный эффект, а не проверка наличия кнопки. Evidence содержит build SHA, adapter/toolchain/version, OS/host, fixture commit, document/revision или snapshot, operation/run ID, фактический результат, UI capture и очищенный trace. Mock/protocol tests полезны для race/cancel, но не закрывают live engine acceptance.

| Сценарий | Доказательство | Реестр |
|---|---|---|
| Java launcher JDK новее project SDK; Maven и Gradle multi-module | Разные paths/versions подтверждены; import graph верен; build использует проектный toolchain | IDE-05, IDEX-04 |
| Annotation processing/generated sources | Generated class доступен completion и compile; отключённый processor даёт реальную ошибку | IDE-04/05, IDEX-04 |
| Java test и debugger | Selected JUnit method реально выполнен; остановка на строке; locals/stack меняются после step | IDE-06, IDEX-07/08 |
| Python два roots с разными venv | `sys.executable`, imports, test и debug совпадают с выбранным root; переключение не смешивает результаты | IDE-05, IDEX-05 |
| Python discovery/error/cancel | Параметризованный node ID, collection error, missing pytest и Stop имеют разные реальные outcomes | IDE-06, IDEX-07/08 |
| Frontend monorepo | TS source/version известен, references/aliases корректны; rename меняет нужные imports и проходит project check | IDE-04/05, IDEX-03/06 |
| Frontend debug и preview | Actual dev server URL, один связанный browser target, TSX breakpoint со source map, HMR и failure state | IDEX-06/08 |
| Каждый язык: refactor conflict и undo | Конфликт имени/старой версии не портит файлы; approved apply проходит compile/tests; undo восстанавливает всё | IDE-02, IDEX-02/03 |
| Агент + два окна + внешний writer | Никакой потери dirty текста; одно согласованное изменение, конфликт разрешим, caret не прыгает | IDE-02/03/07, IDEX-01/11 |
| Hide/move/switch project во время test/debug | Run ID/target неизменны; обновление без focus/click; возврат показывает прежний выбранный ресурс | IDE-06, IDEX-07/08 |
| Malformed frame/crash/cancel/stale response | Остальные языки и UI работают; ограниченный restart; поздние edits не применяются | IDE-04…06 |
| Windows stop/close/relaunch | Принадлежащие run процессы остановлены; чужой daemon жив; no double launch после recovery | IDE-06, IDEX-07/08 |
| Framework/API/profile/remote | Каждый source→runtime переход, source mapping и host подтверждён своей live проверкой | IDEX-04/05/09/10/12 |

Для UX проверить 100/125/150% scaling, светлую/тёмную тему, keyboard-only, узкую split-панель и ВАРМ. Рабочие цели после baseline на целевом устройстве: input не блокируется import/test output; короткие UI действия отвечают менее чем за 100 ms p95; warm local completion — целевой p95 до 500 ms на зафиксированном fixture; отмена визуально отражается до 300 ms, а завершение процесса имеет отдельный измеряемый timeout. Это проектные бюджеты для проверки, не измеренные сегодня показатели. Для тяжёлого monorepo отдельно зафиксировать размер, hardware и cold indexing; нельзя обещать те же числа без измерения.

Проверка полноты: по каждой из IDEX-01…12 перечислить язык/framework/adapter и оставшиеся unsupported комбинации. Evidence одной Java функции не закрывает Python или React. В конце каждой сборки дать пользователю короткий сценарий «открой → измени → запусти → увидишь», список реально работающих функций и честные оставшиеся gaps.

## 11. Переиспользование OSS и лицензии

Проверены upstream источники, а не лицензии будущего собранного дистрибутива. Зафиксировать commit/release и все transitive notices до включения компонентов. Не копировать proprietary плагины JetBrains, закрытый Pylance, брендинг или Marketplace binaries на основании открытого соседнего репозитория. Monaco не даёт extension host VS Code автоматически.

| Компонент | Подтверждённый upstream / граница |
|---|---|
| Eclipse JDT LS | README указывает EPL-2.0; выбрать server distribution и сохранить требуемые notices/source obligations по конкретному пакету. [Источник](https://github.com/eclipse-jdtls/eclipse.jdt.ls) |
| Java Debug Server | README указывает EPL-1.0; это отдельная лицензия, не MIT от соседних Java extension repos. [Источник](https://github.com/microsoft/java-debug) |
| Java Test Runner | README указывает MIT; bundled server jars/dependencies и telemetry требуют собственной проверки. [Источник](https://github.com/microsoft/vscode-java-test) |
| Pyright / pylsp | Pyright package указывает MIT; pylsp — MIT. [Pyright](https://github.com/microsoft/pyright/blob/main/packages/pyright/package.json), [pylsp](https://github.com/python-lsp/python-lsp-server) |
| Ruff / debugpy | MIT с сохранением всех сторонних notices; LICENSE Ruff отдельно перечисляет заимствованные компоненты. [Ruff LICENSE](https://github.com/astral-sh/ruff/blob/main/LICENSE), [debugpy LICENSE](https://github.com/microsoft/debugpy/blob/main/LICENSE) |
| TypeScript Language Server | LICENSE содержит Apache-2.0 для основной части и MIT для перенесённых файлов VS Code; сохранить обе части. [LICENSE](https://github.com/typescript-language-server/typescript-language-server/blob/master/LICENSE) |
| js-debug | Repository указывает MIT; shipping adapter включает transitive dependencies и отдельную проверку launcher. [Источник](https://github.com/microsoft/vscode-js-debug) |
| Spring/framework/profiling adapters | Кандидаты требуют проверки лицензии точных включаемых modules и release artifacts; лицензия полного будущего bundle этим документом не подтверждена |

В исследовании не установлены рабочие версии пользователя, pinned версии будущих adapters, доступность корпоративных registries и endpoint transport встроенного браузера для standalone js-debug. Это обязательные probe на рабочем компьютере, а не повод подставить предположения. Ссылки выше проверены 2026-10-13; mutable upstream main/latest перед реализацией сверить с выбранным релизом и записать его точный идентификатор.
