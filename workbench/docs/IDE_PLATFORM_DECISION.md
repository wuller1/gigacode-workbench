# Можно ли использовать IntelliJ Platform для нашей IDE

**Да: открытую IntelliJ Platform можно взять за основу собственной IDE или написать расширение к установленной IDEA.** Для уже существующей Electron-оболочки наиболее практичный первый вариант — интеграция с отдельной IDE через документированные возможности и небольшой plugin bridge. Полноценный fork означает отдельное JVM-приложение и существенно другую архитектуру, а не добавление редактора IDEA как React-компонента. JetBrains прямо описывает Platform как основу для сторонних IDE. [IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html).

Это исследованное архитектурное решение для позднего **M12**, не начало переписывания приложения. Текущие Task, panels, browser, terminal и работа с неизменённым GigaCode CLI продолжаются по [плану](GIGACODE_UI_DEVELOPMENT_PLAN.md). Встроенный Electron editor + language services остаётся базовым вариантом [PANELS_AND_IDE](PANELS_AND_IDE.md); bridge и platform fork — альтернативы, выбираемые после небольшого сравнения на реальных проектах. M11 с расширениями не становится обязательной зависимостью M12.

## 1. Что именно открыто, а что надо проверять отдельно

Проверка выполнена 9 октября 2026 по официальным источникам. Прочитан snapshot `JetBrains/intellij-community` [commit `fb96714ad655190435b506a662bd7ac6733ba660`](https://github.com/JetBrains/intellij-community/commit/fb96714ad655190435b506a662bd7ac6733ba660). Это исследованный master, не выбранный стабильный runtime для пользователя. Полная сборка и аудит всех её зависимостей не выполнялись.

| Объект | Подтверждённый статус | Практический вывод |
|---|---|---|
| IntelliJ Platform / соответствующие открытые исходники | SDK указывает Apache; в [Editor.java, строка 1](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/platform/editor-ui-api/src/com/intellij/openapi/editor/Editor.java#L1) явно указан Apache 2.0 для этого source file | Можно строить решение на разрешённом исходном коде с соблюдением его лицензии. Не обобщать один header на все JAR/assets/plugins |
| Корневой `LICENSE.txt` текущего repository | Сейчас это **JetBrains Open-Source Build Terms v1.3 от 15 июня 2026**, с указанием Apache 2.0 source и отдельных third-party условий | Не подписывать его «полный Apache LICENSE». При выборе готового open-source build проверить именно его terms и состав. [Строки 1–9 и 53–56](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/LICENSE.txt) |
| `NOTICE.txt` | Есть отдельное attribution notice JetBrains | Сохранять применимое notice при переносе/распространении. [Закреплённый NOTICE](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/NOTICE.txt) |
| Готовая IntelliJ IDEA с сайта | С 2025.3 единый продукт вместо отдельных Community/Ultimate installers; free и subscription functionality в одной поставке | Бесплатное использование не делает весь installer открытым или свободно перераспространяемым. [Описание перехода](https://www.jetbrains.com/idea/whatsnew/2025-3/) |
| Подключённые библиотеки и plugins | Свои лицензии и фактический набор конкретной сборки | Проверять выбранные зависимости; Marketplace-доступность, bundled или free не равны Apache. В source есть [каталог library licenses](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/platform/build-scripts/licenses/src/CommunityLibraryLicenses.kt#L8), у продукта — [third-party notices](https://www.jetbrains.com/legal/third-party-software/) |
| JetBrains Runtime, JCEF и другие runtime parts | Отдельный слой зависимостей; JBR LICENSE содержит GPL v2 и Classpath exception с указанной областью применимости | Проверять фактически выбранный runtime и его notices; это не основание объявлять весь собственный код GPL или весь runtime Apache. [JBR LICENSE](https://github.com/JetBrains/JetBrainsRuntime/blob/main/LICENSE), [JBR в SDK](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-jetbrains-runtime.html) |
| Иконки, логотипы, название продукта, шрифты | Права на код не автоматически дают права на все assets/бренд | Использовать собственное имя/графику либо подтверждённо разрешённые материалы. Отдельный license/provenance record по используемому asset, как в [ASSET_RIGHTS](ASSET_RIGHTS.md) |

Для Apache 2.0 доступны использование, изменение и распространение, включая собственное приложение; лицензия сама по себе не требует открыть весь независимый код приложения. При распространении нужны копия лицензии, применимые copyright/attribution/NOTICE и отметки об изменённых файлах. Права на товарные знаки этой лицензией не предоставляются за пределами предусмотренного указания происхождения. [Apache 2.0, разделы 2, 4 и 6](https://www.apache.org/licenses/LICENSE-2.0).

Готовый proprietary Product и открытый source следует рассматривать раздельно. В [JetBrains User Agreement, §3.5](https://www.jetbrains.com/legal/docs/toolbox/user/) есть ограничения на копирование/изменение Product и использование для аналогичного/конкурирующего продукта; §4.4 отдельно сохраняет права на third-party software по его условиям. Поэтому не брать закрытые JAR, features или графику из установленной IDEA для нашего fork. Это не автоматический запрет документированного SDK/plugin interoperability: его технические возможности JetBrains специально предоставляет. Для конкретной поставки применимы её договор и лицензии, юридическая гарантия отсутствия вопросов здесь не даётся.

Личное использование упрощает первый срез, но не превращает закрытый код в разрешённый для копирования. На этапе только собственного plugin/bridge не нужно проводить аудит всех компонентов, которые мы не распространяем. Если позднее начнём передавать свою IDE другим, проверить **точный состав** дистрибутива до упаковки. Реестр прав вести один раз на dependency/version/hash, повторять при изменении состава; не добавлять юридический мастер на каждую задачу.

## 2. Четыре технических варианта

| Вариант | Что получаем | Цена/ограничение | Решение для нашего проекта |
|---|---|---|---|
| **A. Electron + Monaco + language services** | Наши панели/Task UI, встроенные файлы, затем LSP/TS services/run/debug по нужде | Editor не даёт автоматически project model, refactoring, debugger и весь IDE UX; это отдельные срезы | Сохранить как текущую базовую архитектуру M12, не реализовывать всё сразу |
| **B. Открывать проект/файл в отдельной установленной IDEA** | Полноценная работа IDE без переноса её binary в наш пакет | Между приложениями сначала только простая связь; feature set зависит от реально установленного продукта/plugins | Самый маленький проверочный шаг. Использовать известный executable и документированный launcher |
| **C. Свой plugin bridge к отдельной IDEA** | Контекст файлов, navigation, diagnostics и разрешённые действия через официальные API; Task остаётся владельцем процесса | Надо поддерживать plugin/build compatibility, lifecycle проектов и конфликт несохранённых buffers | Предпочтительный эксперимент, если нужна глубина IDEA при сохранении текущей оболочки |
| **D. Своя IDE на IntelliJ Platform** | Native JVM IDE, editor/PSI/project model и выбранные открытые plugins; свой Task tool window | Другой application host, build/release/runtime, plugin compatibility и обновления; Electron UI напрямую не переносится | Возможный самостоятельный продукт, только после отдельного решения сменить основу. Не обязательный этап текущего Workbench |

У Platform есть editor, PSI/indexes, project model, infrastructure refactoring/debugger и UI toolkit, но состав языка и готовой IDE определяется подключёнными модулями/plugins. Это основа JVM-приложения, не веб-виджет. Архитектурный вывод: нельзя обещать «вставить IDEA в нашу вкладку» простым npm-import. [Описание Platform](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html).

**JCEF решает обратную задачу:** Chromium browser внутри Swing-приложения/IDE. Он может показать нашу web-страницу в plugin tool window варианта D/C, но не превращает IDEA в DOM-компонент Electron. Нужно проверить поддержку JCEF в конкретном runtime, границу bridge, lifecycle и fallback. Перенос native окна/стриминга экрана не является заменой документированной интеграции редактора. [Официальный JCEF SDK](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html).

Вариант C не обязан дублировать весь наш интерфейс внутри IDEA: достаточно действий «открыть материал», «передать выбранный файл в текущую задачу» и статуса привязки. Если нужная интеграция уже доступна документированным способом, сначала проверить её, а не писать собственный plugin ради plugin. Ни один вариант не требует модификации GigaCode CLI.

## 3. Java, Python и React: не обещать бесплатный Ultimate целиком

| Стек | Обоснованный старт | Что подтвердить на конкретной установке/сборке |
|---|---|---|
| Java | Открытая Java/Platform база — естественный кандидат для project navigation и IDE-проверок | JDK проекта и IDE runtime отдельно; настоящий Maven/Gradle import, module resolution, diagnostics, run/test/debug и нужные framework features |
| Python | В открытом repository есть Python/PyCharm source; Python поддерживается через соответствующий plugin | Какой plugin/build установлен, права/лицензия, interpreter/venv и наличие нужных features. Открытая директория не обещает все PyCharm Professional возможности |
| React / TypeScript | В unified IDEA **с 2026.1** core JS/TS/HTML/CSS и basic React доступны бесплатно | Бесплатная функция не обязательно входит в Apache fork. Advanced debugger/test tooling/framework features и exact plugin set проверять отдельно |

Источник Python: [README открытой директории python](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/python/README.md), [документация Python в IDEA](https://www.jetbrains.com/help/idea/python.html). Актуальная граница frontend free/subscription: [JetBrains, март 2026](https://blog.jetbrains.com/idea/2026/03/js-ts-free-support/). Нельзя повторять устаревшее «Community вообще не поддерживает React», как и нельзя вывести из нового free tier право скопировать все web plugins в свою IDE.

Для варианта A остаются решения из [PANELS_AND_IDE](PANELS_AND_IDE.md): Java language server, Python service и TS/React service с собственными лицензиями и реальным project resolution. Для B/C используем уже имеющееся IDE поведение в пределах доступных функций. Для D нужна доказанная матрица source modules → build plugins → реальные функции, а не список возможностей с marketing-страницы полной IDEA.

## 4. Контракт plugin bridge без двух владельцев задачи

Предлагаемые внутренние сообщения ниже — **наш контракт**, не существующие ACP methods и не обещанные встроенные IDEA endpoints. Plugin реализует их через проверенные public SDK API подходящей версии; transport выбирается после probe. Сам GigaCode остаётся отдельным неизменённым CLI.

- **Identity:** `bridgeVersion`, IDE build/plugin version, instance ID, canonical project root, project ID, task/run ID, connection generation. Один foreground project/window не заменяет явную привязку. Ответы старой generation игнорируются с диагностикой.
- **Минимальное чтение:** handshake capabilities, open/reveal file at location, current selection по разрешённому действию, bounded file/diagnostic refs с revision, indexing status. Не читать все проекты IDE в контекст модели.
- **Изменение:** отдельная операция с operation ID, scope и ожидаемой document revision; проверка unsaved/dirty buffer до patch. Если пользователь редактировал файл после чтения, вернуть conflict и актуальную revision; не молча перезаписать из Electron по старому disk hash.
- **Владение:** Task/Workflow/Authorization/Journal живут в нашем host; IDE владеет своими buffers/project model/indices. Привязка не создаёт вторую копию CLI run, retry scheduler, approval или shared memory. IDE events — evidence с источником, не безусловный stage pass.
- **Permission:** локальный bridge имеет узкие операции и проверку разрешённых roots/instances; доступный порт сам по себе не авторизация. Не давать browser page произвольные IDE write/execute API. Remote uploads и автопубликации не включать.
- **Lifecycle:** закрытие проекта снимает subscriptions; disconnect оставляет pending outcome для reconciliation. Повторный connect не переигрывает edit/run. Indexing/not-ready/no-plugin явно отличается от «диагностик нет».
- **Выдача модели:** summary + ограниченный нужный диапазон + refs к полным данным; настоящее содержимое недоверенно как инструкции. Применяются [контекстный бюджет](CONTEXT_BUDGET.md) и [observability](DESKTOP_OBSERVABILITY.md).

Public SDK описывает project services, disposal и editor listeners — подходящие точки для такого adapter, но не готовый внешней RPC bridge. Реальные операции и доступные API установить по source/typings выбранного build. [Services](https://plugins.jetbrains.com/docs/intellij/plugin-services.html), [Editors](https://plugins.jetbrains.com/docs/intellij/editors.html), [Plugin compatibility](https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html).

## 5. Пошаговое решение в M12

Выполнить один короткий эксперимент за раз, не строить одновременно собственный IDE fork, LSP host и полный bridge. Сравнение ниже — план, не выполненные замеры.

| Шаг | Конкретный результат | Проверка / плохой случай |
|---|---|---|
| `IDE0` — inventory и выбор | Existing installation/build/plugins, Java/Python/React projects, нужные функции и исходные timings; A/B/C/D с причиной | Не менять repo config, IDE settings или dependencies автоматически. Отсутствующая IDE не вызывает скрытую установку |
| `IDE1` — отдельный launch | Открыть разрешённый project/file в известной IDE; сохранить связь Task → project/file | Путь с пробелами/Unicode, второй проект и повторное открытие. Не использовать shell interpolation; не обещать готовность редактора по exit code launcher |
| `IDE2` — read-only bridge | Handshake + файл/selection + один реально доступный источник diagnostics, bounded response | Два проекта, закрытие проекта, indexing, stale generation; нет данных ≠ clean. На первом срезе никаких write/run endpoints |
| `IDE3` — одно изменение | Разрешённый patch/навигация с точной revision и receipt, если нужный SDK поддержан | Dirty buffer меняется пользователем параллельно: конфликт обнаружен, ввод не потерян; reconnect не повторяет изменение |
| `IDE4` — решение после трёх стеков | Сравнить A и фактически доступный B/C на Java, Python, React; оставить минимальное достаточное решение | Настоящие files/import errors/navigation и targeted tests, замеры UI/ресурсов на одинаковых projects; не оценка «IDE стала полной» по syntax highlighting |
| `IDE5` — только при выборе D | Отдельный approved ADR, перечень открытых modules, runtime/notices и воспроизводимая минимальная JVM-сборка | Никаких закрытых plugins из установленной IDEA; own name/assets; фактическая функциональность трёх стеков и обновление версии. Это самостоятельный scope |

Документированный launcher умеет открывать файлы/проекты и другие IDE-действия; для первого среза нужны только разрешённые open/reveal, не автоматические `format`, `merge`, inspections или установка plugins. Вызывать реально найденный executable с отдельными arguments, проверяя версию и результат. [IDEA command-line interface](https://www.jetbrains.com/help/idea/working-with-the-ide-features-from-command-line.html).

Plugin bridge строить текущим подходящим IntelliJ Platform Gradle Plugin 2.x и проверять совместимость с целевыми builds. Актуальная документация различает `intellijIdea(version)` и legacy Community/Ultimate helpers для версий **до 2025.3**; не копировать старый `IC` пример на новую IDEA. Версии Gradle/JDK/plugin определять по выбранной версии SDK, не обновлять рабочий проект целиком. [Gradle plugin](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html), [Target dependencies](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-dependencies-extension.html).

**Сборка plugin и сборка fork — разные задачи.** У прочитанного master README описана текущая миграция IDE build на Bazel; это ещё одна причина не обещать fork одним Gradle-плагином. Для реального D закрепить release/tag и следовать его инструкции в отдельной области, без глобальных Git/settings изменений из примеров README. [README исследованного snapshot](https://github.com/JetBrains/intellij-community/blob/fb96714ad655190435b506a662bd7ac6733ba660/README.md).

## 6. Критерий принятия и краткое поручение

Bridge полезен, если на реальных трёх проектах сокращает нужные ручные переходы, даёт достоверный контекст и сохраняет buffers/Task ownership. Fork оправдан, если собственная IDE на JVM стала явной продуктовой целью и преимущества платформы покрывают стоимость другого UI/runtime/update lifecycle. Ни лицензия Apache, ни наличие готового editor сами по себе не доказывают это. Не обещать сроки или ускорение без probe.

> Исследуй только шаг IDEN по этому документу в текущем приложении. Сохрани Electron Task host и неизменённый GigaCode CLI. Найди реальный IDE build, разрешённые SDK/CLI операции и применимые licenses; не копируй закрытую реализацию/бренд и не создавай fake endpoint. Работай с одним разрешённым project и небольшим packet. Проверь normal case и указанный плохой случай, затем отдельно многопроектную привязку. Отдай фактический результат, evidence той же версии, ограничения и рекомендацию A/B/C/D. Отсутствующее API/неизвестные права/непроверенный UI не обозначай как completed.

В этом пакете добавлено только исследование и решение: IDEA не устанавливалась, исходники/ассеты платформы в deliverable не переносились, plugin/fork не создавались, интеграция и производительность не проверялись.
