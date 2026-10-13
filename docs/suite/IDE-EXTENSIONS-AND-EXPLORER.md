# IDE: расширения, возможности VS Code и компактный проводник

Исследование официальных источников: 2026-10-13, расширено 2026-10-14 по цели Ultimate. Сравнение архитектур, Spring/JPA/refactoring gaps и licensing — [IDE-ULTIMATE-RESEARCH](IDE-ULTIMATE-RESEARCH.md); capabilities — [IDE-ULTIMATE-PARITY](IDE-ULTIMATE-PARITY.md). Требование: полный рабочий цикл IDE, совместимые расширения, массовые переименования, компактное дерево; Java/Spring/Maven, Python и frontend. Это дополнение к [workflows](IDE-LANGUAGE-WORKFLOWS.md), [IDE](IDE.md) и [реестру](IDE-DATA-FULL-SCOPE.md). Реализация разрешена пользователем 14.10.2026; в поставке уже работает Theia. Точный код, доказательства и незакрытые сценарии — [runtime handoff](IDE-RUNTIME-HANDOFF.md). Ниже сохранены требования исследования; они не отменяют выполненную интеграцию и не означают полный Ultimate parity.

## 1. Вывод и выбор основы

Нужен настоящий IDE engine/extension host. Monaco сам по себе не запускает произвольные VS Code extensions. Не писать новый `vscode` API вручную и не объявлять установку VSIX доказательством работающей Java/Python IDE.

**Выбранная самостоятельная основа поставки — Eclipse Theia как IDE subsystem внутри Workbench**, с extension host и Open VSX. Собственный frontend/backend и document lifecycle интегрированы через scoped bridge; это не отдельный маленький React-компонент. Агентский shell, Projects/Tasks/Sessions, Browser/Data/Operations и GigaCode CLI сохраняют свои обязанности. При переносе сравнивать с существующим кодом, а не заменять его автоматически. IntelliJ IDEA остаётся UX-ориентиром, сам продукт не встраивается.

Альтернативный кандидат для сохранения нынешней архитектуры — Monaco + `monaco-vscode-api`, но принять его можно только после доказательства необходимых native extension сценариев. Если они требуют фактически написать свой Node extension host и большую часть VS Code workbench, этот путь не следует выбирать ради меньшего первоначального diff. Code-OSS остаётся вариантом, когда максимальная совместимость оказывается важнее стоимости глубокой переработки shell. Окончательный выбор — по одинаковым live fixtures и сравнению с уже работающей IDE пользователя.

| Вариант | Подтверждённая основа | Сильная сторона для Workbench | Стоимость и граница |
|---|---|---|---|
| Code-OSS fork / собственная сборка | Исходный `microsoft/vscode` доступен по MIT; Microsoft product distribution имеет другую лицензию | Самая близкая исходная реализация editor/workbench/extension APIs | Миграция архитектуры продукта, регулярные upstream merges, своё branding/distribution; source code не даёт доступ к Microsoft Marketplace |
| Theia desktop | IDE framework с Electron frontend и Node backend, runtime VS Code extensions и Open VSX | Готовые IDE services, extension lifecycle, адаптация собственного продукта | Проверить API version и stubbed/partial API; объединить lifecycle с Workbench; нельзя обещать все extensions |
| Monaco + CodinGame API packages | Service overrides, VS Code API, web-worker extension host и VSIX build integration | Точный контроль текущего UI и постепенная интеграция сервисов | Web extension host не равен Node/native host; filesystem/model lifecycle требует bridge; runtime installer не появляется из build-time VSIX loader |
| Отдельный managed IDE process / companion | Выделенный поддерживаемый engine с file/command bridge | Наиболее изолированный compatibility experiment, recovery и обновления | Два UX/lifecycle; external window не закрывает цель «IDE у нас внутри»; нельзя просто вложить произвольное чужое desktop-окно |

Фактическая основа сравнения: [Code-OSS README](https://github.com/microsoft/vscode), [Theia architecture](https://theia-ide.org/docs/architecture/), [Theia extension mechanisms](https://theia-ide.org/docs/extensions/), [CodinGame API README](https://github.com/CodinGame/monaco-vscode-api). Стоимость интеграции в таблице — вывод для нашей архитектуры, а не обещание upstream.

### Обязательный architecture gate

После утверждения прототипа, до закрепления редакторских services в S4-01, провести ограниченный engine spike. Выход — решение с доказательствами и перечнем неудач. Проверить Theia и подход, уже реализованный пользователем; CodinGame/Code-OSS добавлять в сравнение, если первые два не закрывают критерии. Не пересоздавать всю оболочку ради исследования.

1. Packaged Windows, PowerShell 5.1, без глобального Node: открыть multi-module Maven/Spring проект и Python/React fixtures.
2. Установить один web extension и один необходимый native language/debug extension из допустимого источника, активировать, выполнить настоящую операцию, disable/re-enable/update/rollback.
3. Java/Spring/Maven: config navigation, import, один тест и breakpoint; Python: выбранный venv и debug; React: workspace SDK и breakpoint в TSX.
4. Открыть один dirty документ в двух Workbench views; применить extension edit и agent edit; подтвердить отсутствие расхождения текста и обработки stale version как успеха.
5. Переместить IDE-панель, скрыть её, открыть второй проект; расширения не перезапускают фоновые процессы без причины, UI не теряет фокус и selected tab.
6. Убить extension host и восстановить его; buffers/agent conversation сохраняются, не создаётся двойной language/debug process.
7. Зафиксировать API coverage, source/license/provenance, размер дистрибутива, startup/memory/latency и цену поддержки. Решение должно показать, что станет владельцем каждого сервиса, а не только красивый экран.

Это уточнение existing S4-01/03/04 и S8-07. Если плану требуется отдельная milestone карточка, добавить её перед началом runtime с dependency на prototype approval и до engine-specific S4-01. Этот документ сам не меняет зависимости и не создаёт новую параллельную цепочку. Результат «engine пока не выбран» не закрывает S4-01.

Официальный `JetBrains.intellij-server` добавлен как дополнительный license-dependent Java/Kotlin backend, а не новая shell-платформа. Его ограничения test discovery/run и single-backend workspace учитываются в [исследовании](IDE-ULTIMATE-RESEARCH.md) и IEF-21. Не запускать одновременно JDT и IntelliJ language owner для одних документов.

## 2. Источники расширений и лицензии

Microsoft прямо указывает, что альтернативные продукты, включая Code-OSS forks, не могут обращаться к Visual Studio Marketplace, а Microsoft/affiliate extensions, полученные оттуда, не лицензируются для применения вне семейства Visual Studio. Открытый исходный репозиторий и скачанный Marketplace binary — разные источники прав. [Официальный FAQ, раздел Extensions](https://code.visualstudio.com/docs/supporting/faq#_extensions).

Поэтому в Workbench нет переключателя «замаскироваться под VS Code» или обхода Marketplace API. Поддерживаются:

- **Open VSX**: поиск, совместимые версии, installation/update. Наличие пакета в registry не заменяет проверку его лицензии и runtime capabilities.
- **Корпоративный registry/proxy**: URL, trust/CA, credential reference, mirror/cache, source priority, offline manifest. Theia документирует собственный registry через `VSX_REGISTRY_URL` и маршрутизацию нескольких registries. [Theia registries](https://theia-ide.org/docs/extensions/).
- **VSIX пользователя**: локальный пакет с допустимой лицензией и происхождением. Ручная установка не снимает restrictions пакета. Нужно показать publisher/version/API/target platform/dependencies и причину несовместимости до activation.
- **Сборка OSS из upstream**: зафиксированный tag/commit, воспроизводимая сборка, licenses/notices и проверка всех included binaries. Не извлекать «тот же самый» binary из чужого Marketplace, называя его source build.

Theia поддерживает install from VSIX и публикует сведения о поддержанной версии VS Code API; её документация предупреждает о stubbed API. [Установка расширений в Theia](https://theia-ide.org/docs/user_install_vscode_extensions/), [API compatibility report](https://eclipse-theia.github.io/vscode-theia-comparator/status.html). Совпадение `engines.vscode` является только первым фильтром: runtime, proposed APIs, native modules, Webviews и services проверяются отдельно.

Theia repository указывает EPL-2.0 и вторичный GPL-2.0 с Classpath Exception, а также содержит notices для других компонентов; нельзя пометить весь будущий bundle одной лицензией без проверки. [Theia license files](https://github.com/eclipse-theia/theia). CodinGame API имеет MIT; отдельные packages/extensions сохраняют свои notices. [CodinGame LICENSE](https://github.com/CodinGame/monaco-vscode-api/blob/main/LICENSE). Брендинг, Microsoft services, Remote Development binaries и коммерческие extensions не переходят в наш продукт автоматически.

### Проверенные кандидаты для каталога макета

Следующие IDs реально присутствовали в ответах Open VSX API на 2026-10-13. Повторная проверка 14 кандидатов с версиями/API/платформой и upstream source snapshots от 2026-10-14 сохранена в [ide-research-sources.json](../../suite/ide-research-sources.json); использовать её как более свежие metadata, а выбранные архивы всё равно проверять отдельно. `license` ниже — metadata registry, не заключение о составе binaries. В макете статус **«Кандидат · совместимость не проверена»**, установка не выполняется. Не использовать `latest` как production pin: оно может указывать на preview; при реализации выбрать конкретный подходящий релиз и сохранить artifact checksum/license files.

| Extension ID | Назначение | `license` из API | Подтверждение |
|---|---|---|---|
| `redhat.java` | Java language/project model | EPL-2.0 | [Open VSX API](https://open-vsx.org/api/redhat/java/latest) |
| `VMware.vscode-spring-boot` | Spring Boot tools | EPL-1.0 | [Open VSX API](https://open-vsx.org/api/VMware/vscode-spring-boot/latest) |
| `vscjava.vscode-maven` | Maven explorer/goals | MIT | [Open VSX API](https://open-vsx.org/api/vscjava/vscode-maven/latest) |
| `ms-pyright.pyright` | Python language/type checking | MIT | [Open VSX API](https://open-vsx.org/api/ms-pyright/pyright/latest) |
| `charliermarsh.ruff` | Python lint/format | MIT | [Open VSX API](https://open-vsx.org/api/charliermarsh/ruff/latest) |
| `dbaeumer.vscode-eslint` | JS/TS lint | MIT | [Open VSX API](https://open-vsx.org/api/dbaeumer/vscode-eslint/latest) |
| `esbenp.prettier-vscode` | Formatting | MIT | [Open VSX API](https://open-vsx.org/api/esbenp/prettier-vscode/latest) |

Дополнительно registry содержит `ms-python.python` (metadata MIT), `vscjava.vscode-java-debug` (metadata ссылается на `LICENSE.txt`) и `vscjava.vscode-java-test` (license поле не заполнено в проверенном ответе). Это повод прочитать LICENSE конкретного VSIX, а не подставить license соседнего upstream server. Исходные репозитории Java debugger, Java test и Maven extension проверены как MIT; это не распространяет source license на произвольный Marketplace binary или все вложенные зависимости. Python/Java debugger можно интегрировать как OSS adapters из [языкового контракта](IDE-LANGUAGE-WORKFLOWS.md), если extension package не подходит; это разные варианты поставки с отдельной приёмкой.

## 3. Extension host и системные границы

Различать **IDE extension**, **Workbench plugin/recipe**, **MCP server** и **agent role**. Они могут быть связаны рекомендацией, но не являются одним механизмом установки или полномочий. GigaCode/Qwen CLI не хостит VS Code extensions; его код не меняется.

Официальная архитектура VS Code различает Node, web worker и remote extension hosts; возможность запуска зависит от location и entrypoint. Web extensions не получают Node APIs только потому, что Electron установлен на компьютере. [Extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [Web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions).

Workbench host владеет проектами, процессами, credentials, журналом операций и ACL существующей конфигурации. Extension host работает отдельно от renderer и agent CLI, с явным `workspaceId/rootId/executionHostId`. UI получает typed events, а не доступ к произвольному Node объекту. Webviews изолированы по origin/CSP; навигация, local resource roots, command URIs и privileged IPC обрабатываются через явный bridge.

**Отдельный процесс — изоляция сбоев, не доказательство security sandbox.** Native Node extension может обращаться к FS/process/network напрямую. Нельзя утверждать, что узкий bridge запретил ему это, пока не реализована реальная OS isolation. Existing full-permission policy пользователя применяется без новой серии MCP-попапов; installation/execution records и достоверные technical compatibility checks всё равно нужны.

Не передавать extension host весь environment Workbench, OpenRouter keys, пароли БД и MCP credentials «на всякий случай». Необходимые credentials запрашиваются по конкретному provider reference. Auth providers, external URI callbacks и secrets storage имеют scoped implementation; не эмулировать недоступные Microsoft auth/services фиктивным success.

### Один document authority

Engine, Workbench UI и agent должны иметь **одну revision chain**. Возможны два проверяемых варианта:

1. Engine text-document service становится внутренней реализацией Workbench DocumentService; все agent/editor operations проходят через adapter, а не вторую копию текста.
2. Existing host DocumentService остаётся authority; engine filesystem/text-model services адаптируются к его versioned snapshots/edits и dirty lifecycle.

Выбор фиксируется в architecture gate. Нельзя синхронизировать две равноправные модели по принципу «кто записал последним». Прямую запись extension на диск обрабатывать как внешнюю: watcher/hash/CAS, dirty conflict, no lost updates. `workspace.applyEdit` через API проходит preflight/version checks; это не гарантирует перехват прямого `fs.writeFile` extension.

Общие Run/Test/Debug/Git services также получают по одному authority. Если выбран engine-native service, Workbench оборачивает его API и events; существующий shell не создаёт дубликат процесса, test run или SCM store. Lease и correlation ID привязывают extension operation к выбранному проекту, а агент получает видимый пользователю результат.

## 4. Настройки, клавиши и установка в UI

Внутри IDE доступны страницы «Расширения», «Настройки редактора», «Клавиши»; их можно открыть из command palette или IDE overflow, без ещё одной постоянной широкой панели. Общие settings Workbench дают ссылку на тот же экран и данные.

**Расширения**: поиск, Installed/Recommended/Updates, source filter, publisher, version, compatible API/runtime, назначение и статус. Detail открывается как editor tab. Действия: install, cancel, enable/disable global или workspace, uninstall, pin version, update, rollback, install VSIX, открыть logs/readme/license. Не показывать «Установлено и работает», если только распакован archive.

Lifecycle: `resolving → downloading → verifying → staged → installed → activating → active`; отдельно `disabled`, `incompatible`, `activation_failed`, `restart_required`. Каждый шаг имеет idempotency key и revision. Interrupted download/install очищает временный каталог и сохраняет прежнюю версию; interrupted activation не объявляет upgrade завершённым. Перезапуск extension host сохраняет editor buffers и conversation, а run/debug sessions перед reload проверяются отдельно.

VSIX installer проверяет archive traversal/symlinks/размер распаковки, manifest/schema, dependency graph/cycles, publisher identity, target OS/architecture, runtime/API и source policy. Устанавливать в versioned каталог, activation переключать после verification; не перезаписывать работающую версию по файлам. Отсутствие подписи отображать честно, не называть любой checksum цифровой подписью.

**Настройки**: поиск, group/language/extension filter, UI и JSON-view, effective value/source, reset one setting, scope User → Workspace → Folder → Language. Не переносить машинные paths и secrets в shared repository settings. JSON editing сохраняет unknown extension keys и комментарии формата, если импортируется JSONC. При import `.vscode/settings.json`, `tasks.json`, `launch.json`, `extensions.json` показать переведённые поля и unsupported без молчаливого удаления.

**Клавиши**: поиск по действию и нажатой комбинации, пользовательское назначение, conflicts, `when` contexts, reset. Глобальная команда чата не должна перехватывать editor shortcut, когда пользователь печатает в editor/terminal/webview. Возможность выбрать знакомый keymap — mapping команд, а не копирование закрытых plugin assets.

**Профили IDE** — набор editor settings/extensions/keybindings, отличающийся от автоматически выбираемых AI ролей. AI может рекомендовать extensions по language/project facts и объяснять эффект; не менять роль вручную ради включения Java support. Установка должна быть доступна пользователю напрямую и агенту через один service.

## 5. Максимальный объём возможностей VS Code

Это список для реализации и приёмки, а не утверждение, что всё уже предоставил выбранный engine. Основные ориентиры: [VS Code editing](https://code.visualstudio.com/docs/editing/codebasics), [navigation](https://code.visualstudio.com/docs/editing/editingevolved), [refactoring](https://code.visualstudio.com/docs/editing/refactoring). Перед реализацией сверять точные страницы установленного релиза.

| Группа | Целевые возможности | Встраивание / владелец |
|---|---|---|
| Editor | Multi-cursor/column selection, undo groups, find/regex/replace, snippets, folds, bracket pairs, minimap/sticky scroll, Unicode/encoding/EOL, format-on-save | S4-01/02; одна document history |
| Tabs/groups | Preview/pin/dirty, split/reorder/move, reopen closed, independent scroll/selection, large/binary/custom viewer | S4-02; существующий dock shell |
| Navigation | Quick open/symbols, breadcrumbs, definitions/implementation/references, peek, call/type hierarchy, back/forward, outline | S4-03/05; actual language provider |
| Workspace | Multi-root, compact explorer, excludes/nesting, file operations, create from template, local history, watcher/conflict/recovery | S4-01/02/04 |
| Refactoring | Symbol/file/folder rename, import repair, bulk changes preview, extract/move/signature/safe delete по capability | S4-05; transaction contract ниже |
| Problems | Diagnostics sources, fix/preview, suppress по tool, stale state, navigation и filters | S4-02/03 |
| Terminal/tasks | Несколько terminal profiles/tabs, split, cwd/env, task dependencies, problem matchers, cancellation | S4-02/03; общий ProcessSupervisor |
| Testing/debug | Discovery/rerun/watch/coverage, assertions/output, launch/attach/compound, breakpoints/stack/watch/console | S4-03; IDEX-07/08 |
| Source control | Changes/index/hunks, commit/history/branches, conflict editor, worktrees, PR review | Existing S3-01…04, S4-02; IDE-GIT-PARITY |
| Config/extension ecosystem | Settings UI/JSON scopes, command palette/keymaps, themes/snippets, compatible extensions, custom editors/webviews | S4 engine integration + S8-07 |
| Web/API | Markdown preview, dev server/browser preview, HTTP/API workflow, logs/source maps | S4-06 + BrowserService; не второй браузер |
| Notebook/profiling | Kernels/outputs/execution,реальные profile capture/dumps и source navigation | S4-06/07; отдельные live adapters |
| Remote | SSH/WSL/container roots, port mapping, remote extension location/debug path mapping | S4-04; exact execution host |
| Workbench agent | Inline action/chat context, visible edits/tests, evidence, task/session binding | Existing agent runtime; не второй Copilot clone |

Settings Sync, Live Share, Copilot/service APIs, произвольные proposed APIs и proprietary Remote Development — отдельные capability/provider задачи с лицензиями. Их нельзя назвать реализованными через Code-OSS clone. Если пользователь требует конкретную функцию, найти допустимый provider или создать собственный контракт; не снимать цель молча и не обещать коммерческий service без доступа.

## 6. Компактный проводник как инструмент работы

Ориентир поведения — project/package views, compact packages, nesting и reveal active file, описанные в [IntelliJ Project tool window](https://www.jetbrains.com/help/idea/project-tool-window.html). Делаем собственную реализацию и иконки в текущем стиле Workbench.

Проводник существует **только внутри IDE**, по умолчанию слева, скрывается одной кнопкой и возвращается в том же месте. Верхняя строка: «Проект» с view selector, compact search/reveal и overflow. Не дублировать Actions плитками под каждым файлом.

- Стандартная ширина 240 px, minimum 180 px; resize пользователем, сохранение по проекту/окну. Компактная строка 26 px; доступен увеличенный режим. Это design tokens макета, итог проверяется при scaling и keyboard navigation.
- Одна строка: disclosure, собственная file/type icon 16 px, имя, короткий Git/diagnostic marker. Путь и полный статус — tooltip/details. Нет крупных карточек, лишнего вертикального padding и цветных плашек на каждом элементе.
- Режимы Files / Packages / Modules / Open Editors; scopes Current module, Changed files, Tests. Package view строится по project model, не по произвольным именам папок. Generated/excluded/library roots отличаются и объясняются.
- Compact folders и compact Java packages сворачивают промежуточные пустые уровни; каждый сегмент может быть выбран как реальная папка. Create/move в `a.b.c` спрашивает/показывает точный destination, не предполагает всегда последний уровень.
- File nesting для TSX+tests/styles или source+generated — только presentation. Delete/move родителя не включает невидимые nested файлы без явного перечисления operation set.
- Single click — preview tab, double click/Enter — pin; arrows/Home/End/type-to-search и Shift/Ctrl multi-select; Shift+F10 контекстное меню; rename inline с validation и Esc. Навигация не запускает файл.
- Context menu: New file/folder/class/package/component, Rename, Bulk rename для selection, Copy/Cut/Paste/Duplicate, Move, Delete/restore, Copy path/relative path, Open in split, Reveal in OS, terminal here, Compare, Local history, Git и «Передать агенту».
- Drag/drop показывает destination и copy/move mode до отпускания. Перенос между roots/дисками проходит тот же transaction preview. Внешний drop импортирует с collision policy; ничего не перезаписывается только из-за совпадения имени.
- Lazy children/virtualization, отмена search, стабильные keys. Refresh сохраняет expanded nodes/selection/scroll и dirty editors. Узкое дерево обрезает только label, не badge/context target. Автопереход к текущему файлу настраиваемый, чтобы не сбивать пользователя при поиске другого файла.

### Цвет имён по Git status

Файлы в этом же проводнике получают цвет имени по фактическому Git status, как в привычном IDE workflow. Отдельное дерево Git не создавать. Базовые значения blue Modified, green Added, brown Unversioned и red Conflict соответствуют [референсу IntelliJ](https://www.jetbrains.com/help/idea/adding-files-to-version-control.html). Остальные оттенки — адаптация к теме Workbench, а не точная копия палитры JetBrains.

| Semantic token | Значение | Представление |
|---|---|---|
| `fileStatus.modified` | Изменён отслеживаемый файл | Синий, `M` |
| `fileStatus.added` | Добавлен в index | Зелёный, `A` |
| `fileStatus.untracked` | Есть на диске, Git не отслеживает | Коричневый/оранжевый, `?`; не зелёный Added |
| `fileStatus.renamed` | Подтверждённый rename | Бирюзовый, `R`, прежний путь в details |
| `fileStatus.deleted` | Удаление | Красный, `D`; отсутствующий файл доступен через Changes, не притворяется существующим |
| `fileStatus.conflict` | Unmerged entry | Красный, conflict marker; приоритет выше остальных цветов |
| `fileStatus.ignored` | Игнорируется Git | Оливковый, `!`; фильтр исключений не заменяет статус |
| `fileStatus.clean` | Подтверждённо без изменений | Обычный цвет текста |
| `fileStatus.unknown` | Не проверен, stale/error/нет repository | Нейтральный, tooltip причины; не утверждать clean |

У tokens отдельные значения для светлой/тёмной темы и selected/hover backgrounds. Выбор строки не заменяет имя белым/общим foreground: статус сохраняется, фон выделения остаётся спокойным. Подбирать контраст текста ≥4.5:1 на всех используемых фонах, проверять grayscale/high-contrast. Статус не кодировать только цветом: короткий marker, tooltip и accessible description сообщают смысл; dirty dot обозначает несохранённый buffer и существует независимо от Git. Имя/иконка типа/диагностика/dirty не должны конкурировать за один glyph.

Runtime получает один revisioned snapshot из общего GitService для exact repository/worktree root. Использовать machine format `git status --porcelain=v2 -z --untracked-files=all`; ignored получать при необходимости тем же broker (`--ignored=matching`/`check-ignore`), учитывая стоимость больших деревьев. Parser читает NUL-delimited записи и record types `1`, `2`, `u`, `?`, `!`, сохраняет destination/source при rename; поля метаданных выделяет по формату, оставшийся pathname не разделяет по пробелу или переводу строки. `XY` index/worktree состояния сохранять раздельно: tooltip «В index: добавлен; на диске: изменён» информативнее потери одной стороны. [Официальный git-status](https://git-scm.com/docs/git-status).

Unknown/stale snapshot не превращается в clean из-за отсутствующей строки. Только полный успешно завершённый снимок соответствующего root/version позволяет выводить отсутствие изменений. Состояние обновляется после save/stage/unstage/commit/checkout и внешних watchers, с debounce и защитой от запоздалого ответа другого проекта. Не вычислять `.gitignore` собственным regex: tracked файл может совпадать с ignore pattern, но сохранять статус tracked. У linked worktree `.git` может быть файлом; вложенные repositories/submodules имеют явную boundary и собственный status owner.

Приёмка: обе темы/selected row, `M/A/R/?/!/conflict`, dirty+Git одновременно; rename с пробелом/Unicode/переводом строки; index+worktree changes; внешние stage/commit; stale и failed refresh; смена проекта во время запроса; ignored tracked path и nested repo. В прототипе источник — общий fixture SCM state с честной пометкой демонстрации. Цвет не является доказательством настоящего Git backend.

## 7. Массовое переименование и semantic rename

Это три разных операции с общим review UI:

1. **Rename symbol**: язык определяет references и проверяет имя. Текст в unrelated comments/strings меняется только отдельной выбранной опцией, если provider её поддерживает.
2. **Rename/move file или package**: filesystem target + language-provided changes imports/declarations/config. Для Java public type/file/package согласуются; для frontend учитываются aliases/barrel exports; для Python imports и package roots.
3. **Bulk rename files/folders**: выбранные paths преобразуются по правилу с preview. Это функция Workbench; не утверждать, что произвольный установленный editor/extension уже её поддерживает.

### Dialog без сюрпризов

Одна форма: scope/count, find/replace literal или regex, case sensitivity, prefix/suffix, numbering, basename vs extension, include children. Live таблица «Было → Станет → Статус» с фильтром conflicts и снятием отдельных строк. Показать сколько файлов, directories, symbol edits и references изменятся. Основная кнопка «Переименовать N» доступна только после полного preflight; Cancel не меняет project.

Опция «Обновить ссылки» показывает фактические providers и coverage. Если часть файлов не имеет semantic provider, UI не выдаёт regex repair за semantic correctness. Можно выполнить явно выбранный path-only rename с показанными ограничениями; после него diagnostics/tests нужны для проверки. Недоступный provider не должен тихо выключать import update.

### Transaction algorithm

1. Зафиксировать root/host/worktree, source paths, realpaths, file IDs где доступны, disk hashes/mtime, document versions, выбранные правила и raw names. Paths нормализовать для идентичности, но сохранить оригинальное написание.
2. Рассчитать полный destination graph **до изменений**. Проверить duplicate targets, Windows case-insensitive collisions, reserved names, trailing dot/space, запрещённые символы, ограничения path length, symlink boundary, readonly/locked files, parent+child moves и пересечение с другими operations.
3. Case-only rename и циклы `A→B, B→A` требуют временных уникальных имён и persisted journal. Не выполнять простую последовательность rename поверх существующих файлов. Cross-volume move — отдельная copy/verify/delete операция, не обещание atomic rename.
4. Запросить доступные file-operation hooks/semantic edits у engine/language services. Таймаут, stale version или отсутствие поддержки дают явный outcome. Один provider владеет edit набором на документ; два extensions не применяют конфликтующие edits по очереди.
5. Показать consolidated diff и paths. После изменения selection/rule весь plan пересчитать. Непосредственно перед apply снова проверить disk/document revisions и target availability; конфликт не пропускать как «уже сделано».
6. Применять через общий FileOperation/DocumentService с operation ID и recovery journal. Поддержать открытые dirty buffers, file watches, tab URI, breakpoints, diagnostics, bookmarks, test IDs и language notifications; не закрывать dirty tab ради rename.
7. Проверить final paths/content и версию project model; refresh ограниченно по затронутым roots. Сохранить inverse plan и snapshots для undo. Undo сначала сверяет текущее состояние; чужие изменения после rename не перезаписываются — показать conflicts и варианты восстановления.
8. После success — нужные compile/tests/lint/import resolution; результат привязать к change set. После crash — восстановить по journal/readback, не повторять rename вслепую. Partial result показывается явно, snapshot не объявляется полным rollback до readback.

Реализация hooks и их доступность сверяются со [VS Code API](https://code.visualstudio.com/api/references/vscode-api) и [LSP workspace file operations](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_willRenameFiles). Требования transaction/recovery выше — наша ответственность поверх API; наличие события `willRename` их не реализует.

## 8. Spring и Maven обязательны

Java не ограничивается JDT LS completion. Обязательный bundled/managed набор capabilities: JDT LS, Java debug adapter, Java tests, Maven project/build model и Spring Tools integration. Exact packages/revisions определяются engine gate и source/license audit. Gradle работает вторым build provider с теми же UX/data contracts. Подробное разделение launcher/project/build/runtime JDK — в [языковом контракте](IDE-LANGUAGE-WORKFLOWS.md).

**Maven**: обнаружение aggregator/module POM, reactor graph, profiles, lifecycle/plugin goals, effective POM/settings с redaction, dependency tree/scopes/conflicts, wrapper, offline mode, settings/repository/proxy/CA, refresh/cancel, selected module/test, failed-goal navigation. «Добавить dependency» создаёт reviewable POM edit и потом reimport; никакой автоматической смены versions всех зависимостей. Официальная документация VS Code отдельно описывает Maven project/module explorer, goals и dependency tree — это ориентир scope, не лицензия extension binary. [Java build tools](https://code.visualstudio.com/docs/java/java-build).

**Spring**: Boot apps по модулям; run/debug/restart; явно выбранные Spring profiles и env; beans/configuration properties navigation; validation/completion YAML/properties; Java↔config links; source endpoints; runtime endpoints только для доступного запущенного target; port/status/readiness/logs; JUnit unit/integration tests; HTTP check из endpoint и переход к controller. Maven profile и Spring runtime profile — отдельные настройки, не общий dropdown «Профиль».

Spring Tools server package явно содержит EPL-1.0 license и ссылки на third-party notices. [Server LICENSE](https://github.com/spring-projects/spring-tools/blob/main/headless-services/spring-boot-language-server/LICENSE). VS Code client manifest также указывает EPL-1.0 и свои requirements. [Spring Boot Tools manifest](https://github.com/spring-projects/spring-tools/blob/main/vscode-extensions/vscode-spring-boot/package.json). Java Debug Server использует EPL-1.0, JDT LS — EPL-2.0; не маркировать весь Java pack как MIT. [Java Debug Server](https://github.com/microsoft/java-debug), [JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls).

Проверка Spring integration должна доказать связь с реальным Java project model и активной конфигурацией. Наличие отдельного Spring server процесса не закрывает beans/config navigation; regex поиск `@RequestMapping` не закрывает framework intelligence. Не экспортировать второй agent chat/MCP controller из Spring extension как основной workflow: полезные language/runtime commands адаптируются к существующей Task/Session.

Gradle: tasks/source sets/build variants/dependency graph, wrapper/JVM, selected tests и build cancellation; собственный daemon model не смешивать с Maven. Annotation processors и generated sources проверяются на реальных fixtures. При отсутствии доступа к корпоративному repository показать конкретный failed artifact/endpoint без secrets, а не «индексация успешно завершена».

## 9. Проверки, которые не заменяются макетом

| Срез | Минимальная настоящая проверка | Existing registry |
|---|---|---|
| Engine authority | Два окна + agent + extension edits одного dirty документа; crash/restart; одна revision chain | S4-01/02, IDE-02/03, IDEX-11 |
| Extension installation | Open VSX/corporate/VSIX, valid/incompatible/failed dependency, activate/disable/update/rollback, interrupted install | S4-04 + S8-07, IDEX-12, EXT-01, REL-04 |
| Native host | Java/Python adapter реально запускается на packaged Windows; web-only package не объявляется native-ready | S4-03, IDE-05/06 |
| Compact explorer | 10k nodes virtualized, keyboard/multi-select, compact segment target, preview/pin, hide/return, refresh without jump | S4-02, IDEX-01/02 |
| Bulk rename | A↔B cycle, case-only, duplicate targets, Win reserved names, parent+child, dirty documents, external write, crash midway, undo after user edit | S4-05, IDEX-02/03/11 |
| Semantic move | Java package/public class, Python package import, React path alias/barrel export; expected edits + compile/tests | S4-05, IDEX-03…06 |
| Maven/Spring | Multi-module import, two distinct profile types, config-to-code, bean, endpoint, selected JUnit, debug locals, stop tree | S4-03/06, IDEX-04/07/08/10 |
| Settings/keys | Scope precedence/readback, JSONC import unknown keys, key conflict, extension defaults, restore last settings after crash | S4-02/04, IDEX-01/12 |
| User/agent continuity | IDE resize/hide/switch projects не меняет run target, browser tab, selected session или active task | S1/S4/S8 existing acceptance |

Evidence: exact engine/extension/toolchain versions, OS, source URL/checksum, fixture commit, action ID, expected/actual result, screenshot и очищенный trace. Установка без activation test — не compatible. Макет с красивым tree — не рабочий Maven import. Таблица legacy/current/user implementation должна показывать, где уже существующий вариант лучше, с воспроизводимым сравнением.

До общего согласования показываем полный interactive prototype этих flows и проблемных состояний. После — architecture gate → existing S4-01/02 → три language slices S4-03 → semantic/bulk rename S4-05 → Spring/framework/API S4-06, с extension-host compatibility в S4-04/S8-07 согласно dependencies реестра. Spring/Maven входят в обязательную конечную приёмку, а не необязательную кнопку «когда-нибудь установить».
