# IDE workspace

## Направление

Приоритетные языковые сценарии, источники, ограничения адаптеров и строгая приёмка описаны в [IDE-LANGUAGE-WORKFLOWS.md](IDE-LANGUAGE-WORKFLOWS.md): **Java, Python и frontend**. Это обязательное продолжение данного контракта для S4-01…07. Интерактивный макет демонстрирует выбор среды, конфигурации, зависимости, отмену, тестовые ошибки и отладочные состояния; настоящий LSP/DAP, компиляторы и test runners ещё не подключены. Не закрывать карточки реализации по демонстрационным результатам.

Сохранить согласованный интерфейс и владельцев состояния. Первоначальная основа Monaco + LSP/DAP больше не определяет конечный объём: пользователь требует глубину IntelliJ IDEA Ultimate либо полноценную VS Code-подобную IDE с plugins. [Исследование пяти вариантов](IDE-ULTIMATE-RESEARCH.md), [151 сценариев](IDE-ULTIMATE-PARITY.md) и [контрольные fixtures](../../suite/ide-engine-fixtures.json) уточняют целевой объём. Theia/Code-OSS — кандидаты полноценной основы, не выбранная по документации миграция. Новое требование расширений VS Code требует сначала выбора движка по **S4-00**: сравнить существующую реализацию пользователя, Theia как подсистему IDE, Code-OSS и слой совместимости Monaco по [IDE-EXTENSIONS-AND-EXPLORER.md](IDE-EXTENSIONS-AND-EXPLORER.md). Один Monaco не запускает произвольные расширения VS Code. Не делать миграцию движка по названию продукта: нужны работающие Windows fixtures Java/Spring/Maven, Python и frontend, замеры и сравнение потерь/преимуществ. При конкуренции с более удачной реализацией пользователя показать результаты и согласовать вариант.

Не копировать закрытые компоненты JetBrains/VS Code. IntelliJ Platform fork и лицензированный IDEA companion исследуются как отдельные варианты по IDE-ULTIMATE-RESEARCH; они не являются небольшой библиотекой для встраивания в Electron. Current file tree, CAS filesystem, Git, terminal, panels, Tasks и artifacts переиспользуются. Marketplace не подключается как каталог альтернативного продукта; проверяются Open VSX, корпоративный registry и допустимые VSIX. Наличие в каталоге не означает совместимость или право распространять любые вложенные компоненты.

## Платформа собственного renderer

Сейчас renderer загружается через `file://`; Monaco предупреждает, что web workers в таком режиме не работают. Для нынешнего renderer/Monaco до редактора нужны шаги ниже. При выборе Theia/Code-OSS сначала согласовать их frontend/backend transport и equivalent security boundaries; не навязывать им неподдерживаемую схему загрузки:

1. зарегистрировать `workbench://` как `standard`, `secure`, `supportFetchAPI`, `codeCache` до `app.ready`;
2. `protocol.handle` отдаёт только realpath внутри `dist`, с корректными MIME/404;
3. CSP разрешает собственные workers без CDN и не включает `bypassCSP`;
4. IPC доверяет точному origin/main frame;
5. preview server разрешает `frame-ancestors workbench:`;
6. Monaco ESM workers собираются Vite и проверяются в packaged Windows.

## Сервисы

- `DocumentService` — единый versioned доступ к buffers, dirty/conflict и crash drafts. S4-00 определяет authority: текущий host owner либо document subsystem выбранного IDE engine с Workbench bridge; второго mutable master нет.
- `SearchService` — filenames/text/symbols с cancellation и limits.
- `ToolchainRegistry` — обнаруженные/managed JDK, Python, Node, package managers, language/debug servers.
- `LanguageHostService` — lifecycle LSP в utility/child processes, JSON-RPC limits и restart.
- `RunConfigurationService` и `ProcessSupervisor` — запуск, stdin/stdout, process tree cancellation.
- `TestService` — discovery, structured results, rerun failed, coverage.
- `DebugService` — DAP sessions, breakpoints, stack, variables, watches, console.
- `GitService` — контракт из [SOURCE-CONTROL](SOURCE-CONTROL.md).

`GitService` один для IDE, Review, терминальных обновлений и агентских operations. Отдельный Git store внутри Monaco или PR-панели запрещён: UI подписывается на host-owned snapshots по `repositoryId + worktreeId`. Полный функциональный контракт — [IDE-GIT-PARITY.md](IDE-GIT-PARITY.md).

LSP/DAP/driver output не разбирается в renderer и не попадает целиком в AppState.

## Document model

```ts
type DocumentSnapshot = {
  documentId: string;
  projectId: string;
  path: string;
  uri: string;
  languageId: string;
  version: number;
  baseHash: string;
  baseMtime: number;
  byteLength: number;
  eol: "lf" | "crlf";
  encoding: "utf8" | "utf8-bom";
  dirty: boolean;
  readonly: boolean;
  conflict?: { diskHash: string; detectedAt: string };
};
```

IPC: `document.open/applyEdits/save/saveAs/revert/close/resolveConflict/list`. Edits incremental и содержат `baseVersion/clientEditId`. В текущем Monaco-варианте model — представление, main DocumentService — source of truth. При другом engine единственный document authority выбирается в S4-00, и Workbench DocumentService координирует обращения через его versioned bridge. Два окна получают одну revision chain. External/agent/CLI write при dirty buffer создаёт three-way conflict, не overwrite.

Сохранять BOM/EOL, проверять UTF-8, atomic replace и optimistic hash. Binary/огромный файл открывается специальным viewer/read-only. Rename обновляет buffers, tabs, diagnostics, breakpoints и LSP notifications.

## UI

- project/files navigator с open editors и outline;
- preview/pinned/dirty tabs, несколько editor groups и split;
- breadcrumbs, sticky scroll, minimap optional;
- quick open, project search/replace и symbols;
- completion, hover, signature, definition/type/implementation, references;
- rename, diagnostics, code actions, format, semantic tokens, inlay hints;
- diff и three-way merge editor;
- Problems, Output, Tests, Debug Console, Terminal;
- run/test/debug actions рядом с выбранной configuration;
- attachment файла/range/symbol/diagnostic/test failure в чат агента.

Editor state (selection, folds, scroll) сохраняется отдельно от document text. При hide/move панели процессы не перезапускаются.

## Полноценный Git прямо в IDE

Git — встроенный рабочий инструмент, а не ссылка из редактора в отдельное приложение. Нужны вкладки Изменения/Журнал/Ветки/Отложенное/Worktrees/Pull requests, контекстное меню файла, gutter actions, branch/worktree selector и быстрый поиск команд. Review раскрывает тот же diff или PR на большую площадь, сохраняя выбранную ревизию и файл.

- Изменения: HEAD/index/disk/live buffer, staged/unstaged по файлам и строкам, changelists, commit/amend и checks с фактической ревизией.
- Журнал: граф, фильтры, file/selection history, blame, comparison, snapshot на commit; reword/fixup/squash/drop/split, cherry-pick, revert/reset и reflog recovery.
- Ветки: local/remote/favorites, upstream/remotes/tags, fetch/pull/push, worktrees, multi-root и видимый execution host.
- Конфликты: three-way result editor с base/ours/theirs, продолжение/skip/abort реальной операции, dirty-buffer guard и сохранённый draft resolution.
- Отложенное: Git stash, IDE shelf, patches и Local History с различимыми владельцами и сроками хранения.
- Расширенные операции: submodules, Git LFS, sparse checkout/shallow history и bisect; actual MCP/adapter capabilities определяют доступность, но не снимают целевой сценарий.
- Pull requests: корпоративный forge из текущего repository, checkout в отдельный worktree, review threads/approve/checks/merge по remote capabilities.

На узкой панели постоянными остаются выбранный repository/branch, активный раздел и primary action. Остальные действия — в меню конкретного объекта и command palette. Нельзя сжать семь вкладок и все Git-команды в одну обрезанную строку. Diff открывается как обычный документ; одновременно доступны source, staged diff и merge result, а крупный viewer можно вынести в отдельную панель.

DocumentService до checkout/reset/apply/rebase сверяет unsaved buffers и disk version. Конфликт с внешним writer не разрешается перезаписью. Смена ветки сохраняет редакторский контекст отдельно от Git commit; смена проекта/панели не меняет ветку фонового агента. Игнорировать `.git` watcher полностью нельзя: внешний Git тоже должен обновлять UI.

## React/TypeScript

- `typescript-language-server` с TypeScript проекта;
- HTML/CSS/JSON language services;
- ESLint/Prettier из проекта через adapters, без auto-install;
- package scripts/task detection;
- React preview как видимая run configuration, открываемая текущим BrowserService;
- JS DAP через проверенный debug adapter.

Monaco встроенный TS worker подходит для одиночного editing, но не выдаётся за полный monorepo LSP.

## Python

- выбранный interpreter/venv, на Windows `.venv\Scripts\python.exe`;
- Pyright для language features;
- Ruff для lint/format/imports;
- pytest/unittest через TestService;
- debugpy через DAP;
- environment/packages UI без скрытого изменения окружения.

Не использовать закрытый Pylance. Interpreter проекта и runtime Workbench не смешиваются.

## Java

- отдельный Java runtime для language server и project JDK;
- Eclipse JDT LS, actual capability/readiness;
- Maven/Gradle wrapper discovery и import;
- compile/test results со структурированной навигацией;
- Java Debug Server/DAP;
- classpath/project model, hierarchy, references, refactors по capability.

Проверенный текущий JDT LS требует минимум Java 21 для самого сервера; это не заставляет менять target JDK проекта. Wrapper execution считается запуском project code и показывается пользователю.

## Контракты

```text
ide.capabilities
language.start/stop/restart/status
language.completion/hover/signatureHelp
language.definition/typeDefinition/implementation/references
language.documentSymbols/workspaceSymbols
language.prepareRename/rename
language.codeActions/resolveCodeAction/applyWorkspaceEdit
language.format/folding/semanticTokens/inlayHints
diagnostics.list
search.files/text/symbols/cancel
run.config.list/save/delete
run.start/stop/input/list/output
test.discover/run/cancel/results/coverage
debug.start/stop/continue/pause/stepIn/stepOut/next
debug.breakpoints.set
debug.stack/variables/evaluate
```

`workspace/applyEdit` проверяет каждый URI, project boundary и expected document version. `workspace/executeCommand` имеет allowlist; language server не получает универсальный shell. Ошибки нормализуются: `STALE_REVISION`, `OUTSIDE_PROJECT`, `TOOL_UNAVAILABLE`, `SERVER_STARTING`, `PROCESS_EXITED`, `UNKNOWN_OUTCOME`, `USER_ACTION_REQUIRED`.

## Этапы

1. I1 — custom protocol, Monaco workers, DocumentService, tabs и crash drafts.
2. I2 — text/file/symbol search, diff/merge, Problems и structured output.
3. I3 — React/TypeScript LSP + real project fixture.
4. I4 — Python interpreter/Pyright/Ruff/tests/debugpy.
5. I5 — Java JDT LS/Maven/Gradle/tests/DAP.
6. I6 — unified run/test/debug configurations и process supervision.
7. I7 — live-buffer agent tools, attachments, task/change-set evidence.
8. I8 — multiwindow/layout/performance/accessibility/Windows packaging.

## Проверки

- Monaco worker реально работает из packaged custom origin;
- completion/definition/references/rename/code action/format на реальном проекте каждого стека;
- dirty external change и два окна дают conflict, не потерю текста;
- LF/CRLF/BOM, кириллица/пробелы и invalid UTF-8;
- escaping workspace edit/command отклоняется;
- malformed/oversized LSP frame, crash/restart и cancellation;
- tests появляются без дополнительного клика, failure открывает точную строку;
- DAP breakpoint/stack/variables/evaluate;
- stop завершает Windows process tree без orphan;
- missing toolchain показывает настройку, а не фальшивую capability;
- packaged Windows не требует глобальный Node для собственного UI; project toolchains обнаруживаются явно;
- 20 открытых документов/LSP не блокируют renderer.

## Расширение конечного объёма

[IDE-DATA-FULL-SCOPE.md](IDE-DATA-FULL-SCOPE.md) и `suite/ide-data-coverage.json` обязательны после базовых этапов. S4-05/06/07 включают semantic refactorings, frameworks/API workflow и profiling. Редактор с LSP не считается завершённой IDE.

Матрица [IDE-GIT-PARITY.md](IDE-GIT-PARITY.md) дополняет этот объём по Git. S3-01…S3-04 владеют Git/forge engine, S4-01…S4-02 — редакторской интеграцией; наличие UI-кнопок не закрывает ни один runtime acceptance. Прежде чем заменить существующий Git пользователя, сравнить его реализацию на тех же сценариях и сохранить более удачные решения.

## Monokai — общая тема кода

Уточнение пользователя 14.10.2026: редакторы, SQL, YAML/JSON, diff, примеры кода и логи следуют теме оболочки. В тёмной теме — Monokai (`#272822`), в светлой — собственная светлая companion-палитра (`#fcfcfa`) с теми же семантическими цветовыми группами. Gutter, caret, выделение, placeholders и выделенная строка меняются вместе с фоном. Не оставлять чёрную область ввода в светлой оболочке. Проверка 22 пар текста/фона: минимум 4.98:1, `design/review-evidence/syntax-theme-contrast.json`; это не полный аудит доступности. Цвета Git-статусов имён файлов независимы от темы кода.

Цветовой ориентир: [открытая тема Monokai VS Code](https://github.com/microsoft/vscode/blob/main/extensions/theme-monokai/themes/monokai-color-theme.json); CSS адаптации написан для этого макета. При переносе в Monaco задать соответствующую editor theme и проверить semantic tokens, diff, selection, caret, diagnostics и режим системной высокой контрастности. Это инструкция для следующего этапа, а не уже внедрённый Monaco runtime.
