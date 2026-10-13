# IDE с глубиной IntelliJ IDEA Ultimate: исследование и решение

Проверено по первичным источникам 14.10.2026. Цель пользователя — максимально близкий к Ultimate рабочий инструмент, особенно Java/Spring/Maven, Python и frontend, с расширениями и общим агентским интерфейсом. Это расширение целевого объёма, **не отчёт о реализованной IDE**. `app/` в рамках исследования не меняется. После исследования пользователь 14.10.2026 разрешил реализацию. Текущий код и проверенные сценарии: [IDE-RUNTIME-HANDOFF](IDE-RUNTIME-HANDOFF.md); исследовательская матрица ниже не означает полную готовность Ultimate.

## Вывод

Для самостоятельного Workbench нужна полноценная IDE-платформа с extension host, проектной моделью, запуском и отладкой. Один Monaco, LSP и несколько кнопок не покрывают эту цель. Кандидат первого технического сравнения — **Theia desktop**, второй — **Code-OSS**. Выбор остаётся открытым до S4-00: проверить необходимые расширения и реальные проекты на Windows, сопоставить результат с уже написанным пользователем кодом. Theia удобна для создания собственного продукта; Code-OSS стоит предпочесть, если нужные расширения упираются в несовместимость Theia и устранение этого разрыва дороже интеграции shell. Это инженерная рекомендация, а не результат замеров.

Уточнение пользователя 14.10.2026: на работе будет **GigaCode IDE, форк IntelliJ IDEA Community**; IntelliJ предпочтительна как UX-ориентир, но **саму IDEA в Workbench не встраиваем**. Самостоятельный путь уже реализован на Theia. Точная версия и набор plugins корпоративного форка проверяются на месте; Ultimate-лицензия и Ultimate-функции не предполагаются. Ни companion plugin, ни отдельное окно IDEA не являются обязательной частью выбранного решения. Исторический вариант companion ниже оставлен только как отдельная исследовательская альтернатива, требующая нового конкретного запроса и проверки.

Дополнительно найден официальный **Java and Kotlin by IntelliJ IDEA**: IntelliJ-based LSP/extension для VS Code-подобных редакторов. Это отдельный кандидат Java backend внутри выбранной платформы, без необходимости самим извлекать PSI из JAR. Он даёт редакторские Java/Kotlin функции; весь Ultimate этим не подтверждён. [Описание JetBrains](https://www.jetbrains.com/help/intellij-vscode/About-instance.html).

С 2025.3 IntelliJ распространяется как единый продукт, расширенные возможности открываются Ultimate subscription. Бесплатные функции готового продукта и исходники открытой платформы — разные множества. Нельзя считать GitHub-репозиторий лицензией на перенос всего Ultimate. [Описание текущей модели IntelliJ](https://www.jetbrains.com/help/idea/intellij-idea-single-distribution.html).

## Что проверено и где смотреть детали

- [Матрица из 151 отдельных сценариев](IDE-ULTIMATE-PARITY.md) и её [JSON](../../suite/ide-ultimate-parity.json): конкретная функция, способ реализации, известный разрыв, карточка и наблюдаемая приёмка. Это не утверждение об исчерпывающем покрытии всех версий и plugins Ultimate и не процент готовности.
- [Каталог источников](../../suite/ide-research-sources.json): 66 первичных источников, снимки 18 upstream-репозиториев, metadata 14 расширений Open VSX. Коммиты веток служат ссылкой для исследования, **не заменяют release lock**.
- [Набор контрольных проектов и сценариев](../../suite/ide-engine-fixtures.json): что запускать при выборе основы и дальнейшем сравнении.
- [План](../../suite/implementation-plan.json), [приёмка](ACCEPTANCE.md), [контракт IDE](IDE.md), [extension lifecycle](IDE-EXTENSIONS-AND-EXPLORER.md), [Git](IDE-GIT-PARITY.md) и [Data](DATABASE.md) остаются каноническими владельцами реализации.

Базовая версия сравнения по официальной странице загрузки — IntelliJ IDEA **2026.2.3, build 262.10968.63**. Перед реальной разработкой сверить установленную версию и документацию снова. [Загрузка IntelliJ](https://www.jetbrains.com/idea/download/?section=community).

## Пять вариантов основы

| Вариант | Что получаем | Что придётся интегрировать | Решение для Workbench |
|---|---|---|---|
| IntelliJ IDEA + companion plugin | Реальный установленный IDE engine и доступные по лицензии функции | JVM plugin, обмен project/file/range/run/debug/evidence, привязка к Task; отдельное окно и lifecycle | Дополнительный путь для точного Java/Ultimate workflow; не поставлять чужой Ultimate в нашем архиве |
| Продукт на IntelliJ Platform / открытой сборке | JVM IDE core, PSI, индексы, editor и plugin architecture | Новый JVM-продукт либо отдельная IDE-подсистема, мост к Electron; недостающие framework tools | Исследуемая альтернатива при безусловном приоритете Java; не обещает Ultimate из открытых исходников |
| Code-OSS fork | Исходный workbench и VS Code extension APIs | Собственное оформление/сборка, интеграция Workbench services, сопровождение upstream | Кандидат на максимальную близость к VS Code; сравнить цену архитектурной миграции |
| Theia desktop | IDE frontend/backend, VS Code extension host и настраиваемые services | Встраивание на уровне продукта, document/project bridge, UI contributions, проверка API | Первый кандидат S4-00; не считать готовым React-виджетом |
| Monaco + monaco-vscode-api | Editor и совместимые API/services в web-архитектуре | Остальные lifecycle, native host, project/test/debug/extensions по фактической поддержке | Сохранить, если существующий вариант проходит те же fixtures; не выбирать только ради маленького diff |

Основания: [IntelliJ Platform](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [Theia architecture](https://theia-ide.org/docs/architecture/), [составление Theia application](https://theia-ide.org/docs/composing_applications/), [Code-OSS](https://github.com/microsoft/vscode), [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api).

IntelliJ PSI — проектная инфраструктура с индексами, потоковыми ограничениями и command/write lifecycle. Предложение «подключить несколько JAR и получить весь анализ Ultimate» не является готовой архитектурой. Для отдельного JVM service нужно доказать bootstrap, project model, index readiness, memory/process lifecycle, version compatibility и разрешённый состав дистрибутива. [PSI writes](https://plugins.jetbrains.com/docs/intellij/modifying-psi.html), [indexing](https://plugins.jetbrains.com/docs/intellij/indexing-and-psi-stubs.html), [threading](https://plugins.jetbrains.com/docs/intellij/threading-model.html).

## Выбор Java backend: два обязательных направления сравнения

**Открытая основа:** JDT LS + Java debug/test + Maven/Gradle + Spring Tools. Проверка исходников JDT LS на зафиксированном commit выявила готовые change-signature и extract-interface handlers, преобразующие изменения в WorkspaceEdit. Для change signature есть upstream test source. Поэтому сначала подключать существующие операции, не писать их заново. Это source evidence, не доказательство Windows/client integration. [ChangeSignatureHandler](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/ChangeSignatureHandler.java), [WorkspaceEdit handler](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/GetRefactorEditHandler.java), [tests source](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/ChangeSignatureHandlerTest.java).

Для интеграции: получить code actions на точном range/version; по pinned server/client исходникам разрешить соответствующий custom request/command и argument schema; собрать параметры через компактный editor popover; показать versioned multi-file diff; применить через единый authority; проверить compile/tests и undo. Не угадывать RPC name и не запускать произвольный `executeCommand` как shell. Java core change signature не доказывает понимание Spring/XML/config references. Extract interface не закрывает pull-up/push-down/type migration.

**Лицензируемая IntelliJ-основа:** официальный `JetBrains.intellij-server`, опубликованный через Open VSX. Его нужно испытать как дополнительный backend на том же fixture. Документация запуска описывает EAP со сроком жизни сборки; отдельная licensing page — trial и Ultimate activation. Перед включением проверить точный build/EULA/expiry/offline activation; бессрочную бесплатность не предполагать. Не обходить activation и не включать чужие credentials в пакет. [Установка через Open VSX](https://www.jetbrains.com/help/intellij-vscode/get_started_cursor.html), [licensing](https://www.jetbrains.com/help/intellij-vscode/Register.html).

В текущем описании **test discovery/run ещё не поддержаны**, выполнение не делегируется build tools. Поэтому при выборе этого backend нужны собственные Maven/Gradle test/run adapters, сохраняющие project build параметры. Нельзя решить проблему запуском второго JDT LS только ради Java test extension, если оно требует конкурирующего language owner. [Run/debug limitations](https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html).

Также документирован **один backend на workspace**. Для нескольких окон Workbench нужен один project backend lease и проверенный bridge/multiplexing к UI. При невозможности multi-client integration этот кандидат не проходит наш multi-window gate. Отдельные worktrees могут иметь отдельные backend по своим roots; два backend на одном root запрещены. [Project/import limitations](https://www.jetbrains.com/help/intellij-vscode/Project-import.html).

Официальный Kotlin-only server частично закрыт и имеет отдельные условия, не является гарантированно Apache-only заменой. Не запускать одновременно Kotlin-only, combined IntelliJ и JDT providers для одних документов. Его оставляем дополнительным кандидатом, не обязательной зависимостью. [Kotlin LSP status](https://github.com/Kotlin/kotlin-lsp/blob/main/README.md), [release/license changes](https://github.com/Kotlin/kotlin-lsp/blob/main/RELEASES.md).

Таким образом, выбор host (Theia/Code-OSS) и выбор Java semantic backend — разные решения. Платный backend не должен делать обязательной оплату для остальных IDE языков. Пока лицензия/совместимость неизвестны, рабочая базовая ветка — открытая основа; лицензируемый вариант сравнивается условно, с явно указанными преимуществами и потерями.

## Где находится основной разрыв с Ultimate

| Область | Реальная основа для самостоятельной IDE | Что нельзя объявить готовым установкой plugins |
|---|---|---|
| Java и build | JDT LS, Maven/Gradle import, Java debug/test adapters | Полнота multi-module model, generated sources, annotation processors, разные JDK, Kotlin/Java interoperability |
| Semantic refactoring | Language-server code actions/workspace edits; JDT change signature/extract interface подтверждены в source | Safe delete, сложные callers/overrides, type migration, structural search, связанные XML/YAML/шаблоны; полнота уже имеющихся операций проверяется отдельно |
| Spring | Spring Tools — кандидат для properties, boot, beans/endpoints и navigation | Глубокий DI/AOP/security анализ, runtime transaction/cache/bean inspection и Spring-aware debugger |
| JPA/Hibernate | Собственный entity model, framework adapters, общая Data-подсистема | JPQL/HQL completion, derived queries, ORM console на project classpath, entity/schema evolution и runtime ORM diagnostics |
| Python | Python extension, Pyright, Ruff, debugpy и test adapters | Django templates/ORM, межфайловой refactor, notebooks и framework navigation — отдельные capabilities |
| Frontend | TypeScript, ESLint/Prettier, test/browser/Node debug adapters | Monorepo aliases, source maps, Next/Vue/Angular/Svelte conventions и framework-aware refactors |
| Profiling | JFR/jcmd, JMC, отдельный heap-dump analyzer, Python/Node tools | Корреляция source/flame graph/allocations, большие dumps, сравнение snapshots и восстановление после сбоя |

Функции сравнения: [рефакторинги IntelliJ](https://www.jetbrains.com/help/idea/refactoring-source-code.html), [Spring debugger](https://www.jetbrains.com/help/idea/spring-debugger.html), [Persistence tool window](https://www.jetbrains.com/help/idea/persistence-tool-window.html), [JPA console](https://www.jetbrains.com/help/idea/using-jpa-console.html). Открытые кандидаты: [JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [Spring Tools](https://github.com/spring-projects/spring-tools), [Java refactoring в VS Code](https://code.visualstudio.com/docs/java/java-refactoring).

Дополнительный аудит добавил language/reference injections с source mapping, UML class/module diagrams, code-dependency/cycle analysis, scratch/REPL и перенос существующих IDE settings/run configurations. Это отдельные проверяемые функции, а не следствие наличия editor. IntelliJ plugins и VS Code extensions имеют разные API; их архивы нельзя взаимозаменять. Возможность стороннего IntelliJ plugin остаётся условной для IntelliJ-based пути и его лицензии. [Injections](https://www.jetbrains.com/help/idea/using-language-injections.html), [UML](https://www.jetbrains.com/help/idea/class-diagram.html), [dependencies](https://www.jetbrains.com/help/idea/dependencies-analysis.html), [scratches](https://www.jetbrains.com/help/idea/scratches.html).

Сложная функция остаётся отдельной строкой со статусом `planned_unverified`, пока нет evidence. `partial` не означает «можно забыть остаток». Если adapter не покрывает сценарий, сохранить пробел, определить собственную реализацию/допустимый plugin/companion и стоимость. Не удалять из объёма без решения пользователя. Агента использовать для выбора инструмента, объяснения и проверки; сгенерированный моделью diff не заменяет семантический движок.

## Архитектура интеграции

1. **Один Workbench shell.** Projects → Tasks → Sessions, docking, Browser, Data, Operations, artifacts, agent coordinator и неизменяемый GigaCode CLI сохраняются. IDE добавляет editor groups/tool windows в тот же shell. Не помещать целый второй workbench с дублирующей боковой панелью внутрь iframe.
2. **Один document authority.** После выбора основы явно решить, где authoritative buffer/version/undo. При сохранении текущей модели — host DocumentService; если engine требует владения document model — его документная подсистема становится authority, а Workbench получает versioned bridge. Не оставлять два изменяемых master-буфера. Agents, extensions, UI и внешний filesystem writer проходят одну conflict/CAS цепочку.
3. **Project model рядом с language host.** Modules, roots, dependency scopes, project SDK, server runtime, generated sources и indexing state имеют identity `projectId + rootId + executionHostId`. Переход в другой проект меняет представление, не target фонового процесса.
4. **Native processes вне renderer.** Extension hosts, language/debug servers, tests/builds и profiler helpers запускаются через supervision выбранной платформы/host bridge. Renderer получает ограниченные структурированные events. Согласовать владельца процесса вместо двойного supervisor.
5. **Единые Git/Data/Browser/Run services.** Extension contributions подключаются через adapter; если plugin хранит собственное состояние, определить authoritative domain и синхронизацию. Запретить расхождение dirty files, staging, breakpoints, connections и test results между панелями.
6. **Типизированные IDE actions для агента.** Open/reveal, navigate/refactor, inspect diagnostics, run/test/debug и attach evidence указывают document version, host, adapter и operation ID. Агент показывает те же buffer, diff, тест и debugger пользователю. Ни text prompt, ни CLI-команда не становятся доказательством выполненного IDE action.
7. **Protocol boundaries.** Для собственного renderer сохраняются secure app origin, isolated preload и workers по IDE.md. Для Theia/Code-OSS отдельно проектируется согласованный транспорт их frontend/backend. Не переносить механически `workbench://` во все upstream services, не открывать backend без идентификации и не выключать CSP ради webviews.

Companion plugin проектируется отдельно: protocol handshake/version, project/root identity, revisioned document changes, dirty conflict, run/debug handles, cancellation, selection reveal и evidence receipts. Не отправлять секреты проекта в чат. При потере соединения IDE продолжает работать, Workbench показывает разрыв. Companion может давать точный функционал установленной IDE, но не выполняет требование полностью самостоятельного продукта.

## Расширения и лицензии

Code-OSS source доступен по MIT; готовая Microsoft distribution имеет другие условия. Microsoft отдельно ограничивает доступ альтернативных продуктов к Visual Studio Marketplace и использование Microsoft/affiliate пакетов, приобретённых там. Для нашего каталога — Open VSX, корпоративный registry, разрешённые VSIX или сборка из допустимого upstream source. Лицензия source не автоматически покрывает любой готовый бинарный пакет. [Официальный FAQ Microsoft](https://code.visualstudio.com/docs/supporting/faq).

IntelliJ Platform описана как Apache 2.0, но состав конкретной сборки проверяется отдельно. Текущий корневой `LICENSE.txt` репозитория содержит JetBrains Open-Source Build Terms и отсылает к лицензиям компонентов. Сохранить notices и проверить source headers, bundled dependencies, branding и условия выбранного plugin. Бесплатность доступа к функции не означает открытые исходники. [Platform licensing](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [текущие build terms](https://github.com/JetBrains/intellij-community/blob/master/LICENSE.txt).

Для каждой поставляемой версии нужен lock: `publisher/name/version`, upstream/tag/commit, source URL, VSIX URL, SHA-256, platform, engines.vscode, dependencies, native binaries, license files/notices, install source, known API gaps, fixtures и rollback version. Нельзя закрепить `latest`. У каталога Ruff при исследовании `latest` оказался `alpine-arm64`, у JetBrains extensions — `darwin-arm64`; на рабочем Windows нужен проверенный подходящий пакет. Metadata Open VSX — повод проверить архив, не юридическое заключение или runtime тест.

Проверенные исходные кандидаты: JDT LS — EPL-2.0, Spring Tools — EPL-1.0, Java debug/test/Maven repositories — MIT, Pyright/debugpy/Ruff — MIT. Для Java test registry не вернул лицензию; для Java debugger вернул `SEE LICENSE`. Не считать это отказом от upstream license, но перед поставкой прочитать **сам выбранный архив** и вложенные компоненты. Pylance, Microsoft Remote Development и другие закрытые продукты не добавляются как будто это части MIT Code-OSS.

Для Gradle отдельно исследован [microsoft/vscode-gradle](https://github.com/microsoft/vscode-gradle/blob/develop/README.md): project/tasks/dependencies, wrapper и task server требуют интеграции с общим Run/Terminal owner. Для frontend DAP кандидат — [microsoft/vscode-js-debug](https://github.com/microsoft/vscode-js-debug); наличие его source не доказывает source maps и BrowserService integration в нашем приложении.

Theia документирует ограничения extension APIs; её сравнительная таблица различает поддержку, частичную реализацию и заглушки. Зафиксировать конкретную версию engine/API, проверить required commands, webviews, debug adapters, testing API, native packages и activation. «VSIX установлен» не является успешной приёмкой. [Установка extensions в Theia](https://theia-ide.org/docs/user_install_vscode_extensions/), [API comparison](https://eclipse-theia.github.io/vscode-theia-comparator/status.html).

Различать три профиля: AI-role под задачу, IDE extension set под языки проекта и toolchain configuration под execution host. AI выбирает роль автоматически; отсутствие ручного role selector не запрещает пользователю управлять расширениями или SDK. Встроенный второй AI engine/чат отключается или интегрируется без конкурирующего coordinator; платный сервис не запускается из-за установки editor plugin.

## Windows и корпоративная среда

- Runtime JDT LS требует Java 21 минимум по текущему upstream; project JDK/target выбирается отдельно. Не переводить старый проект на Java 21 ради language server. [JDT LS requirements](https://github.com/eclipse-jdtls/eclipse.jdt.ls).
- Проверять выбранную версию Windows, архитектуру, пути с пробелами/кириллицей, case-only rename, CRLF/BOM, длинные пути, file locks, portable/package и PowerShell 5.1. Драйверы и helpers имеют lock независимо от версии CLI.
- Offline import использует корпоративные Maven/npm/PyPI/Gradle mirrors, proxy и CA по правилам конкретного runtime. Настройки Electron CA не автоматически чинят Java/Python/Node trust stores. Не отключать TLS verification. Bundle/cache можно перенести разрешённым способом и проверить hashes до установки.
- Native Windows profiling: сначала JFR/jcmd capability probe. async-profiler по upstream ориентирован на Linux/macOS; его наличие в plugin не доказывает Windows profiling. [jcmd](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jcmd.html), [async-profiler platforms](https://github.com/async-profiler/async-profiler).
- JFR analysis — JMC или проверенный parser; HPROF heap dump — MAT или отдельный совместимый analyzer. Не выдавать JFR reader за heap analyzer. Большие snapshots обрабатываются file-backed worker/index, ограниченными выборками и cancel, а не загрузкой всех данных в renderer. [JMC](https://github.com/openjdk/jmc), [MAT](https://eclipse.dev/mat/).
- На ВАРМ измерить input latency, rendering, indexing CPU/RAM и idle/background usage. Пользователь просит сохранять рабочую анимацию: её application policy отдельно от системного reduced-motion, при этом статусы должны быть читаемы и без движения. Нельзя обещать обход throttling невидимого/приостановленного OS процесса.

## План с выдачей полезного результата

Это подробности существующего DAG, не новый порядок запуска. Зависимости карточек и общий prototype gate сохраняются.

| Карточка | Работа | Что выдать пользователю |
|---|---|---|
| S4-00 | Inventory существующей IDE; изолированные Theia/Code-OSS/current-engine spikes; extension/API/package/license evidence | Сравнение на одинаковых Windows fixtures, реальные startup/indexing/interaction measurements, gaps, engine ADR и rollback. Пробелы Ultimate ещё не блокируют исследовательский выбор, но остаются в матрице |
| S4-01 | Document authority, secure origin/engine transport, roots/index state, drafts/conflicts | Один документ в двух окнах, agent/external edits, crash recovery без потери текста |
| S4-02 | Compact explorer, editor groups, search, local history, problems, base run/test UI, theme/keymaps | Ежедневная навигация/редактирование мышью и клавиатурой; без лишних постоянных заголовков и мобильных форм |
| S4-03 | По одному законченному стеку: Java/Spring project import prerequisites, Python, frontend; actual run/test/DAP | Рабочий multi-module Maven цикл, breakpoint и failed-test rerun; затем эквивалентные Python/React сценарии. Framework depth закрывается в S4-06 |
| S4-05 | Семантические refactors/inspections и versioned multi-file preview/undo | Переименование, change signature, safe delete и structural transforms на реальных проектах; capability gaps видны |
| S4-06 | Spring/JPA, Python/frontend frameworks, HTTP/GraphQL/gRPC, XML/templates | Вертикальные framework workflows, ORM/query/source navigation, отрицательные примеры и совместная Data/Browser интеграция |
| S4-07 | JFR/heap/thread/Python/Node investigations | Снимок реальной проблемы → source → исправление → сравнение; большие файлы и Windows доказаны |
| S4-04 | Remote/containers, corporate network, extension isolation и resource budgets | Тот же edit/build/debug цикл на remote host; фоновые проекты не смешивают target и не теряют сессии |
| S3-02/03, S7-03 | Общие Git/forge/Data возможности | Рабочие review/conflict/DB workflows в IDE; не создавать вторые Git и Data реализации |
| S8-09 | Те же IDE команды для агента, задачи и evidence | Агент меняет видимый buffer, запускает тест, видит ошибку и исправляет её; перезапуск/повтор не дублируют внешние действия |

Внутри карточки сначала пользовательский путь и состояния макета, затем после одобрения runtime slice, negative tests, live desktop review и результат. Если старый вариант пользователя существенно лучше нового и их нельзя объединить, сохранить существующий, показать сравнение и спросить конкретный выбор по [migration rules](../../SUITE-UPGRADE-AGENT.md).

## Строгая проверка полноты

В [fixture pack](../../suite/ide-engine-fixtures.json) отделены **обязательные проверки выбора engine**, **пробы глубины**, где допустим документированный unsupported result, и **приёмочные сценарии поздних карточек**, где unsupported означает открытый пробел. Не требовать весь Ultimate до выбора основы и не закрывать Ultimate по одному успешному Maven import.

Для каждого результата фиксировать engine/API/extension/SDK versions, OS/arch, project commit, dirty baseline, adapter readiness, выполненное действие, expected/observed, logs/receipt и screenshot. Нужны успешный и ошибочный путь. Compile success дополняет framework/runtime checks, но не доказывает корректность injection, transaction, JPQL или source maps. При наличии лицензированной IDEA сравнивать один fixture на обеих IDE; без неё отметить отсутствие сравнительного live evidence.

Показатели измеряются на названном рабочем месте: cold/warm start, import/index duration, p50/p95 typing/command latency, peak/idle RAM, extension-host restart recovery, cancellation time, число действий и сохранение focus. До измерений не публиковать выдуманные баллы или обещанные миллисекунды. Большой файл/проект: записать размер, число файлов/строк, выбранные limits и memory budget.

На текущем этапе выполнены документарное исследование, upstream metadata checks и структурная проверка новых материалов. **Ни IDEA, ни IDE extensions на Windows не установлены и не проверены этим исследованием.** Все 151 runtime rows имеют `planned_unverified`, evidence пустое. Следующий агент загружает одну карточку, соответствующие строки и fixture IDs; не переносит всю документацию в 256k контекст. Статус меняется только по наблюдаемому результату.
