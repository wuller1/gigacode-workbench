# Open source, лицензии и безопасное использование референсов

Срез проверки: **13 октября 2026 года**. Этот документ задаёт инженерные правила выбора; окончательный состав проверяется по exact version/commit и фактическому installer. Текущие поставляемые зависимости и собственная графика перечислены в [`docs/THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

IDE-часть расширена **14 октября 2026**: [исследование Ultimate](IDE-ULTIMATE-RESEARCH.md) и [source/package catalog](../../suite/ide-research-sources.json) уточняют engine, extension host и Java backend. Старый Monaco baseline не ограничивает конечный scope.

## Четыре способа использования

1. **Функциональный ориентир.** Изучаем сценарий и проектируем собственный контракт/UI. Код, текст, screenshots и assets не переносим.
2. **Внешний adapter.** Запускаем установленный пользователем tool/server и связываемся по открытому протоколу. Его бинарники не входят в Workbench.
3. **npm/native dependency.** Добавляем pinned package после license/transitive/security/Windows packaging проверки и сохраняем notices.
4. **Перенос исходного кода.** Допускается только отдельной карточкой с exact files, license compatibility, attribution, отметкой модификаций и тестом обновления. По умолчанию этого не делать.

Ссылка на open-source repository не даёт права переносить его логотипы, screenshots, документацию, шрифты, sample data или trademark. Референсы дизайна используются как общие patterns; интерфейс и иконки Workbench остаются оригинальными.

## Предпочтительные кандидаты

| Область | Кандидат | Лицензия на момент проверки | Применение |
| --- | --- | --- | --- |
| Editor | [Monaco Editor](https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt) | MIT | Editor building block; полноценный host выбирается в S4-00 по Theia/Code-OSS/current-engine fixtures. Сохранить LICENSE и worker/security boundaries |
| Terminal | [xterm.js](https://github.com/xtermjs/xterm.js/blob/master/LICENSE) | MIT | Уже используется; полный notice в сборке |
| Protocols | [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) / [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) | спецификации; implementation licenses проверяются отдельно | Типизированные собственные clients/adapters |
| TypeScript | TypeScript + `typescript-language-server` | Apache-2.0 / MIT у соответствующих проектов | Project toolchain с pinned compatibility |
| Web languages | `vscode-langservers-extracted` | MIT | HTML/CSS/JSON adapters; проверить exact package |
| Python | Pyright, Ruff, debugpy | permissive licenses у upstream; проверить exact releases | Внешние managed/project tools, без Pylance |
| Java | Eclipse JDT LS | EPL-2.0 | Отдельный process; сохранить notices, не смешивать исходники без review |
| Java debug | Microsoft Java Debug Server | проверить exact release/license | DAP adapter после отдельной проверки |
| Drag/drop | dnd-kit | MIT | Docking/boards при подтверждённой совместимости React |
| Tables | TanStack Table | MIT | Headless table state; virtualization выбирается отдельно |
| Large grids | Glide Data Grid или react-data-grid | permissive у выбранной версии | Prototype обоих на DB fixtures; выбрать один после accessibility/performance test |
| Graphs | React Flow | MIT | ERD/ops topology/flow map, если performance подтверждена |
| Browser tests | [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 + NOTICE | Test harness и trace import; runtime Electron tab controller остаётся собственным |
| Component tests | [Storybook](https://github.com/storybookjs/storybook) | MIT | Внешний project tool/adapter; не встраивать hosted commercial services |
| Accessibility | axe-core | MPL-2.0 | Допустимая dependency с сохранением лицензии; modifications требуют file-level obligations |
| Kubernetes | [official JavaScript client](https://github.com/kubernetes-client/javascript/blob/master/LICENSE) | Apache-2.0 | Основной direct adapter при необходимости |
| Cluster UI reference | [Headlamp](https://github.com/kubernetes-sigs/headlamp/blob/main/LICENSE) | Apache-2.0 | Сценарии/plugins как reference; перенос файлов только с NOTICE review |
| OpenShift reference | [OpenShift Console](https://github.com/openshift/console/blob/main/LICENSE) | Apache-2.0 | API/resource patterns; не переносить брендинг/assets |
| MCP | Official TypeScript SDK | текущую dual/transition license проверить по pinned commit | Client transports/discovery; сохранить все требуемые LICENSE/NOTICE |
| PostgreSQL | `pg` | MIT | Driver внутри отдельного utility process |
| MySQL/MariaDB | `mysql2` | MIT | Driver внутри отдельного utility process |
| SQLite | Node built-in `node:sqlite` / SQLite | runtime API / SQLite public domain | Предпочесть bundled Node capability после version/package test |
| SQLite fallback | `better-sqlite3` | MIT | Только после Electron ABI и Windows packaging test |

Перед добавлением любой строки агент обязан проверить актуальный upstream LICENSE, package artifacts и transitive binaries. Таблица не заменяет lockfile audit.

## IntelliJ Platform и Ultimate

Исходники `intellij-community` состоят из открытых компонентов, главным образом под Apache-2.0, но актуальный repository также публикует отдельные [JetBrains Open-Source Build Terms](https://github.com/JetBrains/intellij-community/blob/master/LICENSE.txt) и перечень third-party software. Кроме лицензий есть практическая проблема: IntelliJ Platform — отдельная JVM desktop-платформа с собственным window/plugin/runtime lifecycle, а Workbench — Electron.

Целевой объём — рабочие возможности, близкие к Ultimate; открытая платформа не является всем коммерческим продуктом. Решение принимается по S4-00:

- сравнить Theia/Code-OSS и уже работающий engine пользователя; сохранить единый shell и document authority;
- рассмотреть IntelliJ Platform product или лицензированный IDEA companion с явной ценой JVM/desktop интеграции;
- отдельно проверить официальный IntelliJ Java/Kotlin LSP extension: license/expiry, test gaps, один backend на workspace и multi-window bridge;
- для OSS пути сначала использовать JDT/Spring Tools и подтверждённые upstream refactor handlers; недостающие Ultimate функции остаются отдельными capabilities;
- не копировать чужой branding, закрытые plugins и коммерческую distribution; exact package rights и notices проверяются независимо от source license.

Полнота подтверждается отдельными live scenarios по [IDE-ULTIMATE-PARITY](IDE-ULTIMATE-PARITY.md). Установка plugin, использование LSP или чтение исходников не доказывают паритет с Ultimate.

## Design и макеты

- Figma, Claude, Codex, Cursor, Jira, Linear, DataGrip и JetBrains IDE используются только как функциональные ориентиры через официальные документы.
- [Penpot](https://github.com/penpot/penpot/blob/develop/LICENSE) публикуется под MPL-2.0. Можно изучать архитектуру и применять продукт через API/внешний adapter. Прямой перенос изменённых файлов создаёт file-level obligations, поэтому без отдельной карточки код Penpot не копировать.
- Собственный первый canvas — code prototype, отрисованный в безопасном browser view. Это быстрее, ближе к реальной реализации и не требует клонировать Figma/Penpot.
- SVG проходит sanitizer; bitmap metadata очищается; каждый asset имеет origin/hash/license/attribution.
- Generated images/icons сохраняют доступные model/prompt metadata. Генерация «в стиле конкретного живого художника» или копирование vendor icons не используется.
- Сберовские assets допустимы только из явно разрешённого пользователем источника или проверенного OSS package с сохранённой лицензией. Общая корпоративная строгость/плотность/цветовые принципы не являются копированием assets.

## Сильный copyleft и mixed-license проекты

Plane, Taiga, OpenProject, Focalboard и некоторые design/task/database продукты полезны для изучения функций, но их AGPL/GPL/mixed terms несовместимы с бездумным переносом исходников в текущий пакет. По умолчанию:

- использовать документацию и наблюдаемое поведение как reference;
- не копировать source/components/styles/assets;
- не подключать серверный код как библиотеку;
- external integration по API возможна после отдельной проверки условий развёртывания;
- если пользователь позже выберет copyleft distribution, принять это как отдельное продуктовое и лицензионное решение.

## Proprietary и корпоративные компоненты

- DataGrip/Jira/Linear/Codex/Claude/Cursor/Windsurf/GigaCode Desktop/Bitbucket-like corporate service не включаются в пакет.
- GigaCode CLI может быть bundled только после проверки фактической лицензии конкретного fork/build. Его наличие как установленной программы и совместимость кода Qwen не дают права публично перераспространять корпоративный runtime.
- В открытый GitHub не попадают corporate MCP binaries/config, endpoints, certificates, schemas с чувствительными названиями, credentials или sample responses.
- Приложение хранит generic adapters и примеры; рабочий агент выполняет discovery на месте.

## Процесс добавления зависимости

1. Зафиксировать проблему, которую нецелесообразно решать текущим кодом.
2. Сравнить минимум два кандидата по UX, API, maintenance, bundle/native footprint, Windows и accessibility.
3. Зафиксировать exact version/commit, license, NOTICE, transitive/native artifacts и trademark/assets.
4. Сделать маленький disposable prototype и failure test.
5. Принять решение в Task; добавить dependency через lockfile.
6. Обновить `THIRD_PARTY_NOTICES.md`, SBOM и installer audit.
7. Проверить clean install/offline start/update/uninstall на Windows.
8. Для copied source указать исходный path/commit, изменения и полный attribution в самом модуле.

## Release gate

- repository и release не содержат неизвестных бинарников/исполняемых вложений;
- bundled runtime имеет собственный manifest и полный список файлов;
- Windows installer содержит требуемые Electron/Chromium/Node/native notices;
- все images/fonts/icons имеют provenance;
- `npm` license scan сравнивается с ручной проверкой native/platform packages;
- документы не заявляют лицензию собственного кода, пока владелец явно её не выбрал;
- release source ZIP и binary package проверяются отдельно.

Если license неясна, capability остаётся за adapter boundary или реализуется самостоятельно. Не заменять проверку предположением «это open source».
