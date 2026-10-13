# Матрица IDE: целевой уровень IntelliJ IDEA Ultimate

Дата исследования и обновления: 14.10.2026. Это подробная карта реализации и приёмки, а не сертификат полного Ultimate parity. В поставке уже работает Theia 1.76.0; [runtime handoff](IDE-RUNTIME-HANDOFF.md) и [audit](IDE-RUNTIME-AUDIT.md) фиксируют реальные macOS/Windows, включая packaged Windows, сценарии. В JSON строки с подтверждённой частью имеют `partial_evidence`, точный `observedSubset` и незакрытый `remainingAcceptance`; остальные — `planned_unverified`. Полные критерии строк не закрываются установкой расширения или узким smoke test. Сохранены дополнительные JVM/framework/remote сценарии; приоритет Java/Spring/Maven, Python и frontend.

Машиночитаемый источник: [ide-ultimate-parity.json](../../suite/ide-ultimate-parity.json). Обоснование архитектуры: [IDE-ULTIMATE-RESEARCH.md](IDE-ULTIMATE-RESEARCH.md). Источники и фактические snapshots: [ide-research-sources.json](../../suite/ide-research-sources.json). Контрольные сценарии: [ide-engine-fixtures.json](../../suite/ide-engine-fixtures.json).

Для агента: читать только строки текущего `card`/`area`, соответствующий source ID и fixture. Не загружать всю матрицу на каждом ходе. Текущий host — Theia, Java — JDT/Spring Tools; Code-OSS и IntelliJ Java-Kotlin остаются альтернативами исследования. IntelliJ IDEA — UX-ориентир, не встраиваемый продукт. Лицензируемые candidates не становятся обязательными dependencies OSS пути. Не переделывай подтверждённую основу ради исторического слова «кандидат» в таблице; при переносе сравни её с уже написанным кодом пользователя.

## Платформа и расширения

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-001 · S4-00 | Полный IDE engine и extension host | Сравнить текущий engine, Theia, Code-OSS; IntelliJ OSS как JVM-кандидат | Кандидат | Одинаковые Java/Python/React fixtures, реальные расширения, журнал отказов |
| IUP-002 · S4-00 | Каталог и установка расширений | Open VSX, корпоративный registry, проверенный локальный VSIX | Кандидат | Поиск, установка, activation, update, rollback, disable, uninstall без потери workspace |
| IUP-003 · S4-00 | Node и web extensions | Проверять отдельные runtime, native modules и webviews | Кандидат | Workspace extension запускает language/debug процесс на Windows; web extension отдельно |
| IUP-004 · S4-00 | Точная совместимость API | Проверять API calls, partial/stubbed и proposed APIs, а не только engines.vscode | Кандидат | Необходимые команды, Tests, Debug, SCM и custom editors реально работают |
| IUP-005 · S4-00 | Версия и платформа VSIX | Exact version, checksum, actual Windows x64/arm64 target, dependencies и встроенные binaries | Кандидат | Linux ARM пакет отклоняется до установки; воспроизводимый offline lock |
| IUP-006 · S4-00 | Профили IDE extensions | Project/workspace наборы без ручной смены роли агента | Кандидат | Пакеты для Java/Python/frontend включаются по проекту; настройка пользователя сохраняется |
| IUP-007 · S4-00 | Отказ и восстановление host | Process supervision и контролируемый restart | Кандидат | Crash plugin host сохраняет buffers, не создаёт второй LSP/debugger |
| IUP-008 · S4-00 | Изоляция встроенного AI | Собственный GigaCode runtime — владелец агентских сессий | Кандидат | Расширение IDE не создаёт второй скрытый чат/очередь или обязательную подписку |

Первичные источники: [PLATFORM](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [CODE-OSS](https://github.com/microsoft/vscode), [THEIA](https://theia-ide.org/docs/composing_applications/), [THEIA-API](https://eclipse-theia.github.io/vscode-theia-comparator/status.html), [VSCODE-FAQ](https://code.visualstudio.com/docs/supporting/faq), [JB-LSP](https://www.jetbrains.com/help/intellij-vscode/About-instance.html), [JB-LSP-IMPORT](https://www.jetbrains.com/help/intellij-vscode/Project-import.html), [JB-LSP-DEBUG](https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html).

## Документы и проектная модель

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-009 · S4-01 | Один владелец буфера | Engine document authority и versioned Workbench bridge | Кандидат | Два окна и агент видят одинаковый текст; stale edit отклоняется |
| IUP-010 · S4-01 | Dirty, save, autosave и recovery | Atomic file writes, base hash, crash drafts | Кандидат | Несохранённый текст восстанавливается после crash; чужая запись не затирается |
| IUP-011 · S4-01 | Multi-root и worktrees | Project model по projectId/repositoryId/worktreeId | Кандидат | Два проекта с одинаковыми именами файлов не смешивают диагностику |
| IUP-012 · S4-01 | Модули и source roots | Engine project model, исключённые/generated/test roots | Кандидат | Generated/test/source roots различимы; ссылки в generated code индексируются, но файлы не редактируются как пользовательские originals |
| IUP-013 · S4-01 | Кодировки и окончания строк | UTF-8/BOM, LF/CRLF, обнаруживаемые дополнительные encodings | Кандидат | Save и rename сохраняют кодировку; недопустимое декодирование видно |
| IUP-014 · S4-01 | Файловые операции и конфликты | Semantic rename отделён от path rename; единый file service | Кандидат | Case-only rename на Windows, undo, path collision и изменённый внешний файл |
| IUP-015 · S4-01 | Большие файлы и binary | Специальные bounded viewers, без полного чтения в renderer | Кандидат | Открытие большого лога не блокирует чат; binary не превращается в пустой текст |
| IUP-016 · S4-01 | Постепенная индексация | Engine readiness, background work и cancellation | Кандидат | UI показывает indexing; basic editing доступно, semantic operation не даёт ложный успех |

Первичные источники: [PLATFORM](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [THREADING](https://plugins.jetbrains.com/docs/intellij/threading-model.html), [INDEX](https://plugins.jetbrains.com/docs/intellij/indexing-and-psi-stubs.html), [LOCAL-HISTORY](https://www.jetbrains.com/help/idea/local-history.html), [THEIA-ARCH](https://theia-ide.org/docs/architecture/), [JB-LSP](https://www.jetbrains.com/help/intellij-vscode/About-instance.html), [JB-LSP-IMPORT](https://www.jetbrains.com/help/intellij-vscode/Project-import.html), [JB-LSP-DEBUG](https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html).

## Редактор и desktop UX

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-017 · S4-02 | Вкладки и editor groups | Preview/pinned/dirty tabs внутри IDE, workspace panels отдельно | Кандидат | Закрытие/перенос/сжатие не теряет caret, folds, scroll и dirty text |
| IUP-018 · S4-02 | Настольные меню и проводник | Компактные tree rows, inline rename, context popovers, keyboard tree | Кандидат | Стрелки, F2, Ctrl/Shift selection; выбранный файл остаётся видимым |
| IUP-019 · S4-02 | Мультикурсор и колоночное редактирование | Native editor engine | Кандидат | Несколько selection и прямоугольный блок работают с Unicode и undo |
| IUP-020 · S4-02 | Live templates и snippets | Engine snippets и корпоративный каталог | Кандидат | Переменные шаблона, tab stops, контекст языка и версии набора |
| IUP-021 · S4-02 | Folding, breadcrumbs, outline | Semantic/document providers | Кандидат | Глубокая структура и navigation сохраняются после редактирования |
| IUP-022 · S4-02 | Inlay hints, code lens, gutter | Языковые providers, tests/debug/agent annotations | Кандидат | Подсказки соответствуют document version, не закрывают код |
| IUP-023 · S4-02 | Поиск Everywhere и commands | Единый поиск файлов, символов, действий и настроек | Кандидат | Клавиатура открывает точный объект без смены проекта |
| IUP-024 · S4-02 | File/text/regex search и replace | Engine search, scopes, ignore rules, preview diff | Кандидат | Применение выбранных замен и undo на нескольких файлах |
| IUP-025 · S4-02 | Bookmarks и navigation history | Editor locations с live tracking | Кандидат | Back/forward и bookmarks переживают moves, rename и рестарт |
| IUP-026 · S4-02 | Local History | Общая история версий вне Git | Кандидат | Восстановление удалённого/несохранённого текста без reset рабочей копии |
| IUP-027 · S4-02 | Keymaps, theme, fonts и accessibility | Idea/VS Code keymap presets, Monokai dark/light companion | Кандидат | Шорткаты не конфликтуют с shell; ВАРМ и high DPI проверены |
| IUP-028 · S4-02 | Workspace settings и sharing | User/project scopes, EditorConfig, общие профили из Git | Кандидат | Проектные настройки не перезаписывают личные и не содержат секреты |

Первичные источники: [PLATFORM](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [CODE-OSS](https://github.com/microsoft/vscode), [LOCAL-HISTORY](https://www.jetbrains.com/help/idea/local-history.html).

## Навигация и семантический рефакторинг

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-029 · S4-05 | Definition, type, implementation | JDT/TS/Pyright providers или IntelliJ PSI | Кандидат | Точное объявление перегруженного/унаследованного символа |
| IUP-030 · S4-05 | Find usages по всему проекту | Semantic index, module/build context | Кандидат | Отличать одноимённые символы, generated/external usage и text occurrence |
| IUP-031 · S4-05 | Call/type hierarchy и override | Language capabilities с lazy loading | Кандидат | Иерархия соответствует изменённому буферу, переход открывает точный range |
| IUP-032 · S4-05 | Rename символа | prepareRename/workspace edits и conflict preview | Кандидат | Shadowing, imports, overloads, XML/config refs; compile/tests и undo |
| IUP-033 · S4-05 | Move class/package/module | Engine-specific refactor, imports и build metadata | Кандидат | Межмодульное перемещение корректирует ссылки и оставляет проект собираемым |
| IUP-034 · S4-05 | Extract method/variable/field/constant | JDT/TS providers, Python provider или собственный semantic adapter | Кандидат | Scope, captured variables и return flow сохраняют поведение |
| IUP-035 · S4-05 | Inline method/variable/constant | Semantic transformation | Кандидат | Side effects и порядок вычисления не меняются; unsupported отказ явный |
| IUP-036 · S4-05 | Change signature | JDT ChangeSignatureHandler/WorkspaceEdit уже есть в source; подключить versioned UI, проверить callers/overrides/config refs | Частичное покрытие | Parameters/exceptions/callers/overrides обновлены согласованно |
| IUP-037 · S4-05 | Safe delete | Semantic usages и binding-aware dependencies | Своя реализация | При живых ссылках операция блокируется/показывает конфликты |
| IUP-038 · S4-05 | Pull up/push down/extract interface | JDT extract-interface handler есть; pull-up/push-down проверять отдельно, при отсутствии собственный JVM adapter | Частичное покрытие | Наследование, generics, visibility и dispatch проверены тестами |
| IUP-039 · S4-05 | Type migration и generics | JVM adapter, preview каждого affected symbol | Своя реализация | Не просто regex-замена типов; compile/test после миграции |
| IUP-040 · S4-05 | Generate members | Constructor, accessors, equals/hashCode, delegates, override | Кандидат | Генерация по текущему типу и code style без дубликатов |
| IUP-041 · S4-05 | Structural search/replace | AST/semantic templates; отдельный provider для каждого языка | Своя реализация | Структура и constraints отличают код от комментариев и строк |
| IUP-042 · S4-05 | Find duplicates и data flow | Semantic analysis engine или отдельный анализатор | Своя реализация | Результат содержит доказуемый path/scope; нет переименования text search |
| IUP-043 · S4-05 | Versioned preview и единый undo | Один atomic workspace edit с guard по revisions | Кандидат | Изменение файла другим агентом делает preview устаревшим, ничего не затирается |

Первичные источники: [REFACTOR](https://www.jetbrains.com/help/idea/refactoring-source-code.html), [SIGNATURE](https://www.jetbrains.com/help/idea/change-signature.html), [SAFE-DELETE](https://www.jetbrains.com/help/idea/safe-delete.html), [STRUCTURAL](https://www.jetbrains.com/help/idea/structural-search-and-replace.html), [JAVA-REFACTOR](https://code.visualstudio.com/docs/java/java-refactoring), [PSI](https://plugins.jetbrains.com/docs/intellij/modifying-psi.html), [JDT-SIGNATURE](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/ChangeSignatureHandler.java), [JDT-REFACTOR-EDITS](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/GetRefactorEditHandler.java), [JDT-SIGNATURE-TESTS](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/d38ca4f421834e09eb7ffe180ef5d2001e250299/org.eclipse.jdt.ls.tests/src/org/eclipse/jdt/ls/core/internal/handlers/ChangeSignatureHandlerTest.java).

## Качество и анализ

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-044 · S4-05 | Live inspections и quick fixes | Language diagnostics + собственные проверенные inspections | Кандидат | Warning/error, exact range, owner, profile; fix обновляет нужную revision |
| IUP-045 · S4-05 | Inspection profiles и scopes | Project/shared profiles; различать engine-specific rules | Кандидат | Полный и changed-files анализ дают воспроизводимый отчёт |
| IUP-046 · S4-05 | Formatter и optimize imports | Project formatter/EditorConfig/ESLint/Ruff/JDT | Кандидат | Использовать настройки проекта; diff и undo не теряют комментарии |
| IUP-047 · S4-05 | Nullability, dead code и control flow | JDT/Pyright/rule engines, gap к IntelliJ явно | Частичное покрытие | Fixtures с null/branch paths; ложное отсутствие ошибки не выдавать за проверку |
| IUP-048 · S4-05 | Batch cleanup и миграционные recipes | Проверенные transforms/OpenRewrite candidate | Своя реализация | Preview, compile/tests и отдельные ревизии; AI не заменяет semantic engine |
| IUP-049 · S4-05 | Внешний анализ и уязвимости | Sprut через MCP, CI/Qodana при лицензии и наличии | Общий Workbench service | Диагноз связан с версией библиотеки и commit, показан источник |

Первичные источники: [INSPECTIONS](https://www.jetbrains.com/help/idea/code-inspection.html), [JDT](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [PYRIGHT](https://github.com/microsoft/pyright), [RUFF](https://github.com/astral-sh/ruff).

## Java, Maven, Gradle и JVM

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-050 · S4-03 | Project JDK и runtime language server | Отдельные SDK: JDT LS runtime и target Java | Кандидат | Java 8/17/21 проекты не получают принудительный target 21 |
| IUP-051 · S4-03 | Maven multimodule import | Maven wrapper, settings.xml, profiles, repositories | Кандидат | Модули, source roots, dependencies и annotation processors реально импортированы |
| IUP-052 · S4-03 | Maven goals и dependency mediation | Maven explorer + host task adapter | Кандидат | Profile selection, dependency tree, exclusions, effective model и cancel |
| IUP-053 · S4-03 | Gradle и Kotlin DSL | Gradle extension/Tooling API/project model; server JVM, Gradle daemon и project toolchain отдельно | Кандидат | Composite builds, tasks, test filters и project toolchains |
| IUP-054 · S4-03 | Lombok и annotation processing | JDT/compiler integration, generated sources | Кандидат | Lombok accessors и MapStruct outputs доступны навигации и build |
| IUP-055 · S4-03 | JPMS, classpath и scopes | JVM project model | Кандидат | module-info, test/runtime/provided зависимости не смешиваются |
| IUP-056 · S4-03 | JUnit/TestNG и parameterized tests | Java test runner или host adapter | Кандидат | Реальный method/class/suite discovery, structured results и rerun failed |
| IUP-057 · S4-03 | Decompiler и bytecode viewer | Разрешённый OSS decompiler/engine service | Кандидат | External class читается с источником; debug mapping и bytecode отдельно |
| IUP-058 · S4-03 | Java launch/attach/debug | Java Debug Server, DAP и process supervisor | Кандидат | Breakpoint, exception, stack, variables и stop процесса на Windows |
| IUP-059 · S4-03 | Kotlin mixed Java projects | Official IntelliJ Java/Kotlin или Kotlin LSP по лицензии/совместимости; единый language owner, JDT baseline отдельно | Частичное покрытие | Cross-language navigation/refactor/build/debug на fixture |
| IUP-060 · S4-03 | Groovy, Scala, Ant и дополнительные JVM стеки | Отдельные adapters/plugins по проекту | Частичное покрытие | Для каждого стека import, edit, test и debug проверяются отдельно |
| IUP-061 · S4-03 | SDK/source/javadoc management | Project SDK registry и разрешённые mirrors | Кандидат | Offline cache, source navigation и исправление missing SDK через понятный UI |

Первичные источники: [JDT](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [MAVEN](https://www.jetbrains.com/help/idea/maven-support.html), [GRADLE](https://www.jetbrains.com/help/idea/gradle.html), [JAVA-DEBUG](https://github.com/microsoft/vscode-java-debug), [JAVA-TEST](https://github.com/microsoft/vscode-java-test), [JB-LSP](https://www.jetbrains.com/help/intellij-vscode/About-instance.html), [JB-LSP-IMPORT](https://www.jetbrains.com/help/intellij-vscode/Project-import.html), [JB-LSP-DEBUG](https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html), [GRADLE-EXT](https://github.com/microsoft/vscode-gradle/blob/develop/README.md), [KOTLIN-LSP](https://github.com/Kotlin/kotlin-lsp/blob/main/README.md), [KOTLIN-RELEASES](https://github.com/Kotlin/kotlin-lsp/blob/main/RELEASES.md), [JB-LSP-LICENSE](https://www.jetbrains.com/help/intellij-vscode/Register.html).

## Spring и корпоративные frameworks

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-062 · S4-06 | Spring Initializr и project onboarding | Spring Tools + собственный project wizard | Кандидат | Dependency selection и генерация проекта с проверяемым build |
| IUP-063 · S4-06 | Properties/YAML intelligence | Spring metadata language service | Кандидат | Relaxed keys, types, links к config class, profiles и precedence |
| IUP-064 · S4-06 | Beans, qualifiers и dependency graph | Spring Tools + собственная compile/runtime model | Частичное покрытие | Multiple candidates, conditions, profiles и bean origin без догадок |
| IUP-065 · S4-06 | Injection inspections и navigation | Semantic Spring adapter | Своя реализация | Qualifier mismatch, missing/ambiguous bean и переход к producer |
| IUP-066 · S4-06 | Endpoints и controller mappings | Framework provider + API workbench | Кандидат | Mapping связан с source и выбранным runtime/profile |
| IUP-067 · S4-06 | Spring Run, profiles, env и Actuator | ProcessSupervisor, Spring Tools и разрешённые endpoints | Кандидат | Выбранный профиль используется в запущенном процессе, данные актуальны |
| IUP-068 · S4-06 | Runtime bean/property inspection | Actuator/JMX/debug adapter с source links | Своя реализация | Отличать статическую модель от реально поднятого context |
| IUP-069 · S4-06 | Spring-aware debugger | Собственный adapter или licensed IntelliJ companion | Лицензия/своя реализация | Transactions/proxies/bean scopes/cache показаны по настоящему runtime |
| IUP-070 · S4-06 | Spring Security, AOP и transactions | Framework-aware analysis + runtime evidence | Своя реализация | Proxy, advice, self-invocation и transactional boundary проверяются |
| IUP-071 · S4-06 | Spring Cloud и messaging | Project-aware adapters для конфигураций и внешних сервисов | Своя реализация | Связь config/route/topic с source и environment; capability gaps видны |
| IUP-072 · S4-06 | Quarkus, Micronaut, Jakarta EE | Отдельные project adapters/расширения | Своя реализация | Runtime-specific injection/endpoints/config не выдаются за Spring |
| IUP-073 · S4-06 | Application servers | OSS Community Server Connector candidate / собственный adapter | Своя реализация | Tomcat/WildFly run/deploy/attach/logs по выбранному серверу |
| IUP-074 · S4-06 | Templates, XML и schema-aware config | XML/XSD и framework language services | Частичное покрытие | Thymeleaf/JSP/template refs проверяются, rename не только текстовый |

Первичные источники: [SPRING](https://www.jetbrains.com/help/idea/spring-boot.html), [BEANS](https://www.jetbrains.com/help/idea/beans-tool-window.html), [SPRING-DEBUG](https://www.jetbrains.com/help/idea/spring-debugger.html), [SPRING-TOOLS](https://github.com/spring-projects/spring-tools).

## JPA, Hibernate и связь с БД

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-075 · S4-06 | Persistence explorer | Собственная entity/repository model | Своя реализация | Entity, relation, converter и persistence unit связаны с source |
| IUP-076 · S4-06 | JPQL/HQL completion и validation | ORM-aware parser/index, не PostgreSQL SQL LSP | Своя реализация | Ошибка имени entity/field найдена до запуска, source link точный |
| IUP-077 · S4-06 | Spring Data derived queries | JVM/Spring semantic adapter | Своя реализация | Rename entity field корректирует method derivation и query annotations |
| IUP-078 · S4-06 | ORM query console | Isolated JVM helper с project classpath и выбранным connection | Своя реализация | Настоящий JPQL/HQL выполняется, показаны transaction/target/результат |
| IUP-079 · S4-06 | Entity/schema diagrams | Model graph + общий Data ERD | Своя реализация | Mapping различает Java names, SQL names и join columns |
| IUP-080 · S4-06 | Schema/entity generation | Проверенные generators и bounded diff | Своя реализация | Полученный код/DDL валиден; naming и типы согласованы |
| IUP-081 · S4-06 | Flyway/Liquibase и schema evolution | Project migrations adapter + Data compare | Общий Workbench service | SQL preview, checksum и execution target сохранены |
| IUP-082 · S4-06 | Runtime persistence diagnostics | SQL traces, transaction/cache/lazy evidence | Своя реализация | N+1/transactions нельзя диагностировать только по тексту модели |

Первичные источники: [PERSISTENCE](https://www.jetbrains.com/help/idea/persistence-tool-window.html), [JPA](https://www.jetbrains.com/help/idea/using-jpa-console.html), [SPRING-DEBUG](https://www.jetbrains.com/help/idea/spring-debugger.html).

## Run, tests и debugger UX

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-083 · S4-03 | Typed run configurations | Common config registry, separate stack-specific launch adapters | Кандидат | Working directory, SDK, args, env, before tasks и выбранный target точны |
| IUP-084 · S4-03 | Compound/parallel runs | ProcessSupervisor с dependency graph и ports | Кандидат | Несколько сервисов, stop/restart отдельных процессов без orphan |
| IUP-085 · S4-03 | Structured test tree | Java test/pytest/Vitest adapters; у IntelliJ extension test discovery/run пока отсутствуют, нужен отдельный build/test adapter без второго LSP | Кандидат | Class/method/dynamic/parameterized IDs, progress, fail/skip/cancel |
| IUP-086 · S4-03 | Coverage | JaCoCo/coverage.py/V8 adapters и общий viewer | Кандидат | Lines/branches, exact revision, import/export и stale-report indication |
| IUP-087 · S4-03 | Breakpoint types | Verified DAP features: conditions, logpoints, exceptions | Кандидат | Unsupported watchpoints не показываются как рабочие |
| IUP-088 · S4-03 | Stack/threads/variables/watches | Native debug services и pagination | Кандидат | Большой object не блокирует UI; frame/thread selection сохраняется |
| IUP-089 · S4-03 | Evaluate и debug console | Capability-aware expression evaluator | Кандидат | Явно различать pure inspect и выражения с побочными эффектами |
| IUP-090 · S4-03 | Hot code replace и reload | JVM adapter, compiler и class redefinition limits | Кандидат | Изменённый method обновлён; structural change требует честного restart |
| IUP-091 · S4-03 | Remote attach | Host/port/namespace-aware adapter | Кандидат | Отладка DEV-сервиса не присоединяется к одноимённому IFT-процессу |
| IUP-092 · S4-03 | Async/coroutine frames | Adapter-specific support | Частичное покрытие | Реальные async frames; нет обещания universal Kotlin debugger |
| IUP-093 · S4-03 | Rerun, cancel и output navigation | Общий task lifecycle, bounded logs, exact source links | Кандидат | Завершение видно без клика; отмена завершает принадлежащее дерево процессов |

Первичные источники: [DEBUG](https://www.jetbrains.com/help/idea/debugging-code.html), [JAVA-DEBUG](https://github.com/microsoft/vscode-java-debug), [JAVA-TEST](https://github.com/microsoft/vscode-java-test), [COVERAGE](https://www.jetbrains.com/help/idea/code-coverage.html), [DEBUGPY](https://github.com/microsoft/debugpy), [JB-LSP](https://www.jetbrains.com/help/intellij-vscode/About-instance.html), [JB-LSP-IMPORT](https://www.jetbrains.com/help/intellij-vscode/Project-import.html), [JB-LSP-DEBUG](https://www.jetbrains.com/help/intellij-vscode/Run-and-debug.html).

## Python

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-094 · S4-03 | Interpreters и virtual environments | Project registry для venv/conda/Poetry/uv | Кандидат | Правильный interpreter используется edit/test/debug и packages |
| IUP-095 · S4-03 | Python completion, types, symbols | Pyright и выбранный environment, без Pylance binary | Кандидат | Imports, type errors, references и workspace rename на fixture |
| IUP-096 · S4-03 | Ruff lint/format/imports | Project config и проверенный Windows binary | Кандидат | Native formatter реально запущен; версии и rule profile показаны |
| IUP-097 · S4-03 | pytest/unittest | Structured test adapters | Кандидат | Parametrization, fixtures, rerun failed, output и cancel |
| IUP-098 · S4-03 | Python debugger | debugpy/DAP | Кандидат | Launch/attach, watches, exceptions, subprocesses и source mapping |
| IUP-099 · S4-03 | Packages и dependencies | pip/uv/Poetry adapters и project lock files | Кандидат | Install/update не меняет другой venv, progress и отказ понятны |
| IUP-100 · S4-03 | Notebooks | Проверенный notebook extension/API + kernels | Частичное покрытие | Реальные cells, outputs, restart/cancel и exported document |

Первичные источники: [PYTHON](https://www.jetbrains.com/help/idea/python.html), [PYRIGHT](https://github.com/microsoft/pyright), [RUFF](https://github.com/astral-sh/ruff), [DEBUGPY](https://github.com/microsoft/debugpy).

## Python frameworks

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-101 · S4-06 | Django | Framework-aware templates/URL/model adapter | Своя реализация | Переходы view/template/model и debug management command |
| IUP-102 · S4-06 | FastAPI/Flask | Framework endpoints/run/debug provider | Своя реализация | Routes, schema links, env и tests работают на реальном проекте |
| IUP-103 · S4-06 | Python refactoring depth | Дополнительный semantic provider, если Pyright не закрывает операцию | Своя реализация | Extract/change signature/move не подменяются генерацией текста агентом |

Первичные источники: [PYTHON](https://www.jetbrains.com/help/idea/python.html), [PYRIGHT](https://github.com/microsoft/pyright).

## Frontend

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-104 · S4-03 | TypeScript/React project model | Workspace TypeScript SDK и native TS services | Кандидат | Monorepo paths/references, TSX completion и rename imports |
| IUP-105 · S4-03 | HTML/CSS/SCSS/JSON/YAML/XML | Language services и schemas из проекта | Кандидат | Framework files и embedded ranges диагностируются правильно |
| IUP-106 · S4-03 | ESLint/Prettier | Project-owned binaries/configs | Кандидат | Работает выбранная версия и scoped rules, не глобальная подмена |
| IUP-107 · S4-03 | npm/pnpm/Yarn scripts | Native tasks и общий ProcessSupervisor | Кандидат | Run/cancel/watch, ports, workspaces и package-manager lock |
| IUP-108 · S4-03 | Node/browser debugger | Проверенная source/VSIX сборка microsoft/vscode-js-debug и общий BrowserService | Кандидат | Реальный TSX breakpoint, source maps и console; нет лишних вкладок |
| IUP-109 · S4-03 | Vitest/Jest/Playwright | Проверенные test adapters | Кандидат | Discovery, rerun, attachments и trace links к реальному запуску |
| IUP-110 · S4-03 | Frontend performance | CPU/heap/coverage traces из runtime | Кандидат | Снимок/trace привязан к browser/session и source revision |

Первичные источники: [REACT](https://www.jetbrains.com/help/idea/react.html), [CODE-OSS](https://github.com/microsoft/vscode), [JS-DEBUG](https://github.com/microsoft/vscode-js-debug).

## Frontend frameworks

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-111 · S4-06 | React/Next.js framework intelligence | TS services + dedicated extension/custom checks | Частичное покрытие | Routes, client/server boundaries и component refs проверяются |
| IUP-112 · S4-06 | Vue/Angular/Svelte | Проверенные language/framework extensions | Частичное покрытие | Template navigation, type checking, rename и test/debug |
| IUP-113 · S4-06 | API/schema generated clients | OpenAPI/GraphQL tooling и build integration | Своя реализация | Смена schema даёт проверяемый generation diff и compile |

Первичные источники: [REACT](https://www.jetbrains.com/help/idea/react.html), [CODE-OSS](https://github.com/microsoft/vscode).

## API workbench

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-114 · S4-06 | HTTP files и environments | Собственный совместимый subset .http parser/executor или проверенный OSS extension | Своя реализация | Env/headers/auth/secrets/scripts и assertions реально выполняются |
| IUP-115 · S4-06 | OpenAPI и endpoint navigation | Schema index и framework endpoint provider | Своя реализация | Request generated из точного endpoint, schema validation и source link |
| IUP-116 · S4-06 | GraphQL | Schema-aware editor и executor | Своя реализация | Introspection/auth, variables и errors с bounded results |
| IUP-117 · S4-06 | WebSocket/SSE | Connection lifecycle и streaming viewer | Своя реализация | Send/receive/cancel/reconnect различимы, без скрытого replay |
| IUP-118 · S4-06 | GRPC/protobuf | Proto tooling, grpcurl/helper и reflection | Своя реализация | Unary/streaming, metadata/TLS, message type и server target точны |
| IUP-119 · S4-06 | Collections и request history | Import/export Postman-compatible subset, durable receipts | Своя реализация | Несовместимые scripts отмечены, credentials не входят в экспорт |

Первичные источники: [HTTP](https://www.jetbrains.com/pages/idea/http-client/).

## Profiling и диагностика

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-120 · S4-07 | JVM CPU/allocation profiling на Windows | JFR через выбранный JDK/jcmd и JMC parser/helper | Кандидат | Реальный recording, flame/call trees, source mapping и cancel |
| IUP-121 · S4-07 | async-profiler для Linux/macOS | Проверенный native helper на подходящем execution host | Кандидат | Linux remote/container profiling работает; Windows не получает чужой binary |
| IUP-122 · S4-07 | Heap dump и leaks | HPROF + Eclipse MAT helper, индексы на диске | Кандидат | Dominator/retained size/paths; большой dump не загружается целиком в renderer |
| IUP-123 · S4-07 | Thread dumps/deadlocks | JVM dump parser и runtime evidence | Кандидат | Потоки/locks/deadlocks связаны с выбранным процессом |
| IUP-124 · S4-07 | Live JVM metrics | JMX/JFR data adapter | Кандидат | CPU/heap/GC/threads отображаются по настоящим метрикам |
| IUP-125 · S4-07 | Snapshot compare и regressions | Common evidence/artifact comparison | Кандидат | Совпадают build/workload/settings; различия не объявляются причиной без проверки |
| IUP-126 · S4-07 | Python profiling | cProfile/pstats, optional verified sampler | Кандидат | Реальная Python нагрузка и source links, отдельные OS capabilities |
| IUP-127 · S4-07 | Node/browser profiling | V8 CPU/heap, browser devtools trace | Кандидат | Видны измеренные hotspots и ограничения sampler |

Первичные источники: [PROFILER](https://www.jetbrains.com/help/idea/cpu-and-allocation-profiling-basic-concepts.html), [JCMD](https://docs.oracle.com/en/java/javase/21/docs/specs/man/jcmd.html), [ASYNC-PROFILER](https://github.com/async-profiler/async-profiler), [JMC](https://github.com/openjdk/jmc), [MAT](https://eclipse.dev/mat/).

## Git и review

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-128 · S3-02 | Changes, hunks и commit | Общий GitService, buffer/index/HEAD distinction | Кандидат | Stage/unstage по строкам, amend и checks используют нужную revision |
| IUP-129 · S3-02 | History, graph и blame | Общая repository/worktree model | Кандидат | Фильтры, file/selection history и diff именно выбранного commit |
| IUP-130 · S3-02 | Merge/rebase/conflicts | Three-way result editor и Git operation state | Кандидат | Continue/skip/abort, dirty buffer guard и recovery |
| IUP-131 · S3-02 | Stash/shelf/changelists | Разные владельцы Git stash, host shelf и local history | Кандидат | Частичные изменения восстанавливаются без смешения механизмов |
| IUP-132 · S3-02 | Branches/worktrees/multi-root | Host Git ownership и UI status | Кандидат | Агент и пользователь знают реальный execution worktree |

Первичные источники: [CODE-OSS](https://github.com/microsoft/vscode), [LOCAL-HISTORY](https://www.jetbrains.com/help/idea/local-history.html).

## Forge в IDE

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-133 · S3-03 | Pull requests и code review | Bitbucket-like MCP capabilities, shared diff | Общий Workbench service | Clone/checkout, threads, approve/checks/merge по точному head SHA |

Первичные источники: [CODE-OSS](https://github.com/microsoft/vscode).

## Data внутри IDE

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-134 · S7-03 | SQL, procedures и data grid | Общий PostgreSQL/JDBC/Data subsystem, не случайный DB plugin | Общий Workbench service | Те же connections, schema filters, inline edits и transactions |
| IUP-135 · S7-03 | COPY/import/export и большие файлы | Existing streaming Data plan | Общий Workbench service | CSV/XLSX/SQL, backpressure, cancel/recovery и evidence |
| IUP-136 · S7-03 | Связь SQL/entity/source | Schema-aware navigation и mapping context | Своя реализация | Один connection/environment в editor, Data и agent request |

Первичные источники: [PERSISTENCE](https://www.jetbrains.com/help/idea/persistence-tool-window.html), [JPA](https://www.jetbrains.com/help/idea/using-jpa-console.html).

## Remote и корпоративная среда

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-137 · S4-04 | SSH remote workspace | Own/open adapter с host filesystem/LSP/tasks/debug | Кандидат | Реальные remote URI, process ownership, reconnect и workspace identity |
| IUP-138 · S4-04 | Containers и dev environments | Проверенный открытый adapter, не Microsoft Remote binary | Кандидат | Container SDK/paths/forwarded ports работают, global host не подменён |
| IUP-139 · S4-04 | OpenShift/K8s remote debug | Общий Ops MCP и lease port-forward | Общий Workbench service | Namespace/pod/container явно видны; старый tunnel закрыт |
| IUP-140 · S4-04 | Offline, proxy и corporate CA | Registry/artifact mirrors и configured trust stores | Кандидат | Холодная настройка + warm offline старт на Windows, без отключения TLS |
| IUP-141 · S4-04 | Extensions в нескольких проектах | Workspace hosts и общий installation cache | Кандидат | Разные SDK/settings; один проект не перезапускает другой |
| IUP-142 · S4-04 | ВАРМ, high DPI и resource budgets | Desktop checks, bounded snapshots, lazy services | Кандидат | UI обновляется без клика; измерены cold/warm RSS/CPU/startup, без придуманных цифр |

Первичные источники: [REMOTE](https://www.jetbrains.com/help/idea/remote-development-overview.html), [THEIA-ARCH](https://theia-ide.org/docs/architecture/), [VSCODE-FAQ](https://code.visualstudio.com/docs/supporting/faq).

## Агент в IDE

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-143 · S8-09 | Live buffer/symbol/diagnostic context | EngineBridge tools и выбранная task/session | Общий Workbench service | Агент видит unsaved text, exact range, branch/worktree и readiness |
| IUP-144 · S8-09 | Semantic edits от агента | Те же refactor/code action APIs и write leases | Общий Workbench service | Агент не выдаёт text replacement за safe refactoring |
| IUP-145 · S8-09 | Run/test/debug под наблюдением | Общий operation lifecycle и видимые native controls | Общий Workbench service | Старт, вывод, breakpoint и результат видны пользователю |
| IUP-146 · S8-09 | Evidence, recovery и parallel work | Revisioned receipts, partial results, bounded history | Общий Workbench service | После обрыва восстановление без повторного неизвестного write |

Первичные источники: [PLATFORM](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [THEIA-ARCH](https://theia-ide.org/docs/architecture/).

## Вложенные языки и references

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-147 · S4-06 | Language/reference injections | Virtual documents с reversible source maps, escaping, language providers и project rules | Своя реализация | SQL/JSON/regex/HTML в Java/TS/Python strings получают соответствующие diagnostics/navigation; edit не ломает quoting и host offsets |

Первичные источники: [INJECTIONS](https://www.jetbrains.com/help/idea/using-language-injections.html), [JDT](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [CODE-OSS](https://github.com/microsoft/vscode).

## Структура проекта и diagrams

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-148 · S4-05 | UML class/module diagrams | Semantic class/module/dependency graph; common artifact canvas/export, source navigation и refactor preview | Своя реализация | Diagram отражает реальный код, source links и filters; изменение graph требует semantic diff/undo, не картинка без связи с проектом |
| IUP-150 · S4-05 | Code dependencies и architecture rules | Semantic forward/backward dependencies, cycles/DSM, scopes и rule diagnostics | Своя реализация | Usage/path подтверждает dependency, тестовые roots можно исключить; cycle и нарушенное правило обнаружены на fixture |

Первичные источники: [UML](https://www.jetbrains.com/help/idea/class-diagram.html), [PLATFORM](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [CODE-DEPS](https://www.jetbrains.com/help/idea/dependencies-analysis.html), [INDEX](https://plugins.jetbrains.com/docs/intellij/indexing-and-psi-stubs.html).

## Эксперименты и consoles

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-149 · S4-03 | Scratch files и REPL | Persistent scratch document с выбранным module classpath/SDK; Java JShell/Python/Node helpers отдельно | Частичное покрытие | Scratch запускается/отлаживается в точном context, сохраняется после restart; JShell plugin не считается bundled Ultimate core |

Первичные источники: [SCRATCHES](https://www.jetbrains.com/help/idea/scratches.html), [JSHELL](https://www.jetbrains.com/help/idea/jshell-console.html), [DEBUG](https://www.jetbrains.com/help/idea/debugging-code.html).

## Переход из существующей IDE

| ID / этап | Возможность | Как реализовывать | Граница | Проверяемый результат |
|---|---|---|---|---|
| IUP-151 · S4-02 | Импорт настроек и run configurations | Read-only inventory .idea/.run/.vscode/EditorConfig; явный mapping supported fields в общий settings/run registry | Общий Workbench service | Supported configuration импортируется с SDK/env/before tasks; unknown fields/losses показаны, исходники настроек и секреты не копируются молча |

Первичные источники: [RUN-CONFIGS](https://www.jetbrains.com/help/idea/run-debug-configurations-dialog.html), [CODE-OSS](https://github.com/microsoft/vscode).

## Как закрывать строки

Для `verified` нужны: engine/version, extension package hash/source, OS/host, fixture revision, выполнявшаяся операция, реальные observed result и побочные эффекты, отрицательный сценарий, owner buffers/processes и evidence path. Скриншот макета, зелёный значок, ответ агента и установленный VSIX не закрывают строку. Более сильную существующую реализацию пользователя сохранять; конфликтующие варианты сравнивать по тем же fixture и согласовывать.

Количество строк: 151. Это единицы нашего целевого scope; количество не измеряет процент паритета с продуктом JetBrains.
