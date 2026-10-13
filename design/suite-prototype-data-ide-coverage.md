# Data / IDE — interactive review prototype

## Database workspace UX · 14 октября 2026

Обновлён макет DATA; runtime `app/` не менялся. SQL, таблицы и процедуры имеют отдельные документы с собственными target, SQL, result snapshot, transaction, grid draft, параметрами и историей. Объект открывается без замены SQL; последнее закрытие оставляет пустой центр. Компактное дерево слева и редактор регулируются мышью/клавиатурой. Импорт/экспорт фиксируют настройки и источник задания; выбор схем для сравнения идёт по ID реестра подключений макета.

Живой проход проверил сохранение SQL, независимость режимов транзакции, apply/rollback строки orders, параметры экспорта, открытие процедуры, resize, пустое состояние и validation столбцов. Общая подсветка получила светлый фон и согласованные цвета для светлой темы. Подробности, оставшиеся пробелы и функциональная матрица: [Database UX review](../docs/suite/DATABASE-UX-REVIEW.md). Автоматические результаты: `review-evidence/database-workspace-audit.json`; точные границы VM-проверки указаны в отчёте. Наличие макета не означает паритет DataGrip или проверку реального COPY/JDBC/MCP.

## Earlier prototype baseline

This extension is loaded **after** the existing scripts in `suite-workspace-prototype.html`:

```html
<script src="suite-prototype-data-ide.js"></script>
```

It replaces only the content of `[data-panel="data"]` and `[data-panel="code"]`, preserving their existing drag / panel menus. It does not modify `app/`, use the network, read selected import files, execute code, write repository files, connect to databases, or claim DataGrip / IntelliJ parity. All results carry a demonstration label. Runtime implementation remains behind the prototype approval gate.

## Data: review paths

| Scenario | Interaction and observable result |
| --- | --- |
| Connection / environment | Header reads the shared PostgreSQL connection registry filtered by project. ДЕВ / ИФТ defaults are fixtures; a new source starts with an empty catalog. A removed binding remains a disabled captured selection; address/env/schema change requires explicit rebinding. Running work or uncommitted edits prevent switching the execution target. Jobs retain full copied target metadata. |
| Schema explorer | Folder button → search tables, views, procedures, functions and sequences → selected object / procedure definition. |
| SQL consoles | Create, switch, edit and close consoles; closing edited SQL prompts before discarding. Ctrl/Cmd+Enter starts a cancellable delayed fixture. `missing_table` or `error` produces a visible failure. |
| Results | Column sorting, text filter, cell edit dialog, staged-edit count, Apply SQL preview and Discard. Add/delete rows, read-only view results; 5,000 synthetic rows with first/previous/next/last pagination and page size 50/100/250. The primary key stays read-only. NULL is distinct from empty string and the positive-attempt constraint has a visible error path. |
| Transactions | Manual transaction → edit → Apply → Commit or Rollback; changing mode while transaction has changes is blocked. Rollback restores the prior local dataset. |
| Structure | Columns, types, constraints and indexes; DDL can open in a console. Add-column dialog creates an ALTER preview. |
| Procedures / functions | Open correctly typed definition → edit → before/after diff → open SQL console. DDL is not executed. |
| Explain | Plan tree, estimated values and explicit ANALYZE settings. All values are fixtures, never claimed measurements. |
| Import | Three-step source → mapping → review wizard; CSV / XLSX / SQL, 100 MB / 1 GB / 10 GB fixtures, mapping, validation/staging policy, explicit COPY or SQL-runner route. Local file picker uses metadata only. |
| Export | CSV / XLSX / SQL, output name, scope, headers, formula protection and large-result handling explained before a job is created. No download is fabricated. |
| Long jobs | Progress continues across workspace/project selection; cancel produces a rollback scenario; result receipt keeps target and method. Progress is explicitly simulated. |
| History | Completed query, captured target, time and outcome; restore opens a new console without automatically replaying. |
| Schema comparison | ДЕВ → ИФТ multi-object fixture diff; choose index / added column / destructive DROP individually → migration review → SQL console. Destructive difference defaults unchecked. Target warning and transaction restrictions are shown. |
| ER model | Customer → orders → retry relations, zoom controls, scroll and open selected table. |
| Sessions / locks | Session list and lock owner; actual server terminate is disabled with an explanation. |
| Failure recovery | More → connection-loss scenario → unknown-outcome explanation → reconcile. Each import/export job also has a 413/HTML scenario, captured target, unknown outcome, explicit reconciliation and a new attempt only after the scenario confirms no write. Original writes are not replayed. |
| Query parameters / limits | Named parameter values and types; separate binding contract; query timeout / row limit / cursor / lazy LOB settings. |
| Agent | Header action adds the exact selected query / object / target to the current session through `SuitePrototype.ask`. |

### Data boundaries still visible in the mockup

- Tables, view and sequence have separate illustrative rows / structure; values are not introspected from any server. Environment-specific state is kept separately. Large-data mode generates a 5,000-row retry fixture and deliberately says so.
- The SQL editor is a textarea, not a language-aware engine. `SELECT`, `WITH` and error scenarios select a canned result; arbitrary SQL is not evaluated. DDL and write SQL only produce a preview notice.
- Connection settings open the shared registry form. Addresses and secret references are editable only as prototype configuration; there is no authentication or network. `example.invalid` seeds are intentionally non-routable. A new source never inherits another source’s sample rows unless the user explicitly chooses the labeled educational catalog.
- Full Explain JSON/tree side-by-side, rights grant/revoke, deep vendor introspection, database dashboards, debugger for server routines and full server administration still need further detailed prototype slices. ER zoom, selected-object comparison and migration review now have clickable paths; this still does not imply vendor/runtime parity.
- Import/export flow covers the user decisions and progress/cancellation states, not a working streaming implementation, XLSX writer, COPY bridge or memory benchmark. The 8 MiB buffer shown during progress is fixture text.
- SQL results are a paged in-memory table, not a measured million-row cursor. The grid is shared within the project’s illustrative Data workspace rather than isolated per SQL-console result handle. A production result handle must bind console + captured connection + execution ID.

## IDE: review paths

| Scenario | Interaction and observable result |
| --- | --- |
| File explorer | Default visible **inside IDE only**, left of the editor. The panel-outline button hides/restores it. Selected file and expanded folders survive panel switches and are isolated by project. |
| File lifecycle | Search / open / new file / rename / delete from `⋯`; each file keeps an editable in-memory buffer. Closing dirty files offers Save / Don’t save / Cancel. |
| Tabs | Open file selection updates the editor; dirty state survives selection. Last-tab close shows an explicit empty editor; no README or untitled file is created automatically. Deleting all files also leaves Create file available. |
| Editor | TypeScript, React, Java, Python and Markdown fixtures; plain editable code, line numbers, save via Ctrl/Cmd+S; no claims of LSP behavior. |
| Search / replace | Project-wide text search returns actual matching fixture lines; selecting a result opens its line. Replace previews per-file before/after and lets the user select files before applying. |
| Diagnostics | Known checkout defect opens its line; explicitly a review fixture rather than a reported real compiler / linter result. |
| Symbols | Definition and find-usages actions navigate the example symbol. |
| Refactor | Refactor → Rename symbol retains the labeled textual preview. Extract method / Change signature show a concrete per-file before/after, then apply atomically to local unsaved buffers. Name conflicts and buffers changed since preview block Apply. Deleted/changed known source offers a separate example instead of overwriting edits. |
| Diff | Saved and current file side by side. |
| Format | Removes trailing whitespace; no pretend full formatter. |
| Run | Test / React / Java / Python configurations, editable command / cwd / environment / pre-task / variables, save as new, progress, stop and output. No command actually runs. |
| Debug | Set breakpoints, start, call stack / frames / threads, watches, evaluate known variables, edit values, step, continue and stop. Values and stepping are local fixtures. |
| Tests / coverage | Run all / failed, inject known failure, inspect assertion / open test / send to agent; coverage fixture distinguishes values from real evidence. |
| Terminal | PowerShell-oriented input with safe predefined output scenarios, clear, shell profile choices, pass output to agent. Arbitrary commands are never run. |
| Build | Dependency sync / Sprut-result scenarios; no real dependency resolution or vulnerability scan. |
| Profiling | IDE tools → Профилировщик → Node / JVM / Python, CPU / Allocations → record/finish/cancel → timeline sample, flame-style function rows and hotspots → open matching source line or send hypothesis to agent. Empty/error/no-capability scenarios remain explicit. All metrics are synthetic. |
| Save conflict | Compare local buffer with synthetic external change, keep local / take external / open merged draft. No real disk changes. |
| HTTP client | Method / environment / URL / body and a response fixture; no network request. |
| Language services / indexing | IDE tools → Языковые службы: TS/React, Java, Python status, executable, SDK/interpreter, module root, include/exclude settings; indexing progress/cancel, stop/restart, log, ready/unconfigured/error/missing-semantic-capability scenarios. Extract/signature controls follow the modeled TS capability. No language server is started. |
| Agent | Current path + current file contents are added to the active session’s draft through the parent helper. |

### IDE boundaries still visible in the mockup

This is not Monaco, LSP, DAP or a real IDE. Language-service lifecycle/settings, concrete extraction/signature preview, and a selectable profiler timeline now have interactive mock paths. Actual semantic completion, framework navigation, full multi-thread debugging, a complete merge editor and remote-development setup remain further detailed prototype slices.

- Extract method operates on one known delay expression; Change signature adds an optional AbortSignal to one known retry function and updates the two known fixture callers when their expected shape is present. Preview lists absent/changed callers instead of inventing edits. It is a controlled structured demonstration, not general semantic analysis or proof of test success. Every Apply validates all captured buffer contents and project ownership first.
- Language-service capabilities and the 128-unit indexing progress are explicit scenarios. Paths/SDK values are not inspected, and there is no real LSP handshake, background index or Java/Python semantic engine.
- The profiler displays synthetic samples, total/self percentages, a flame-style overview and per-function source navigation. Selecting a sample highlights its interval; hotspot values remain the whole-report fixture, explicitly labeled. CPU/Allocations are selectable display scenarios, not measured CPU time/heap allocations. Missing source or a renamed symbol disables source navigation instead of claiming a mapped frame. Full source maps, call-tree aggregation, async stacks and actual profiler adapters are not implemented.
- Breakpoints remain an illustrative workspace-level set, not persisted source-mapped debugger breakpoints per file.

## State / accessibility / integration

- Project switching listens on `document` to `suite:scope-change` (with `previousProject` rename migration) and retains a separate Data, IDE and file-buffer object for each project. Same-project turn/session events do not rebuild editors or remove focus. SQL/run completion callbacks update their original owner and preserve focused editor caret/scroll, never the project currently in view.
- `suite:connections-changed` refreshes only the connection selector and warning. It does not reset SQL or retarget a transaction/job. Unknown-outcome retries check the original captured connection remains bound with unchanged address/env/schema.
- Context transfer uses `window.SuitePrototype.ask` where available; fallback only writes the existing composer draft. It never sends a prompt automatically.
- Native dialogs trap focus, accept Escape, have visible close and Cancel, and close on outside click. All user-supplied display strings are escaped; new paths reject absolute / traversal / invalid Windows filename syntax.
- Buttons, selects, editors and folder summaries are native controls. Icons use original simple SVG geometry or the prototype’s existing sprite; no external icon/font dependency.
- Warm theme tokens are inherited. Editor/result scroll stays inside its panel; narrow IDE keeps a smaller left explorer, while the database object chooser overlays its surface on narrow widths.
- State is **in memory only**, lost on page reload. This is honest interaction review, not persistence or recovery evidence.

## Verification in this slice

- `node --check design/suite-prototype-data-ide.js`: passed.
- Manual review of event action identifiers, scope capture and fixture boundaries completed.
- A temporary Node VM state-flow harness exercised extract/apply, three-file signature/apply, conflicting identifier, `$` identifier, changed-buffer atomic rejection, changed-project rejection, separate-example recovery, index cancel/complete, profiler cancel/complete, source navigation, missing-symbol guard, empty report and no-capability state. Transformed TypeScript was parsed with the installed TypeScript parser. This checks state logic, not DOM layout or semantic type correctness.
- Parent has observed IDE explorer hide/show and the three-step COPY import / job progress in the browser before the deeper pass; later additions require the next UI pass. Parent owns browser/UI inspection after loading this extension. This file does not claim browser, screen-reader, backend, Windows, LSP, DAP or live PostgreSQL verification.

Stable test selectors: `#di-data`, `#di-ide`, `#di-dialog`, `#di-connection`, `#di-sql`, `#di-tx-mode`, `#di-project-files`, `#di-code-input`, `#di-run-config`; buttons use `data-di`, e.g. `execute`, `import`, `export`, `apply-grid`, `file-tree`, `run`, `debug`, `refactor`.

## File explorer audit follow-up

- File browser remains only inside IDE, default left; database schema explorer is not a repository file browser.
- Corrected last-tab close after README deletion: empty editor supports Create file and Find file, and deleting all files does not fabricate a replacement file.
- Filtering expands matching directories temporarily without modifying the saved expansion set; directory toggle events also carry their original project.
- Hide/show preserves keyboard focus on its explicit panel button; code scroll/selection and explorer scroll survive redraw.
- Project rename migrates state both for the active project and for the separate inactive-project rename event.
- At narrow container widths the explorer stays on the left (150 px, then 124 px) and remains hideable. The textarea scrollbar corner uses the theme background. Parent owns the final live 768 px check; this note does not claim that viewport check has run.
- Node syntax and whitespace checks passed after the fixes.

## Specialized IDE slice: exact review routes

1. **Code → ⋯ (Действия редактора) → Языковые службы**. In **Языковые службы и индексация**, switch TypeScript / React, Java or Python (`#di-language-choice`). Choose the capability/failure scenario (`#di-language-scenario`), configure executable/SDK/root/include/exclude, start indexing and cancel it. Closing the dialog does not silently cancel a started project-owned index scenario.
2. **Code → Refactor → Extract method → Предпросмотр → Применить в макете**. Inspect the removed expression and inserted function in the side-by-side preview. **Change signature** follows the same route and shows tabs for three known fixture files (`data-di="semantic-file"`). If the fixture was already changed, **Создать отдельный пример** gives a safe independent path. Cancel/Escape before Apply leaves buffers unchanged.
3. **Code → ⋯ → Профилировщик → Записать · демо**. Process/mode/scenario selectors are `#di-profile-runtime`, `#di-profile-mode`, `#di-profile-scenario`. Choose a timeline interval (`data-di="profiler-sample"`) or hotspot/flame row (`data-di="profiler-hotspot"`), then **Открыть код**. **Отменить запись**, **Завершить запись**, empty capture, capture failure and no-capability state have separate paths. Closing the dialog keeps recording in its original project; reopening shows its progress/result.

Parent owns the live visual and keyboard pass for these new routes. No browser verification is asserted by this module's author.


## Git внутри IDE · 13 октября 2026

В Code появился переключатель «Редактор / Git». Обе области сохраняют свой UI state; скрытие редактора не уничтожает buffer. Git и Review используют общий проектный Git bank, старый независимый stage/commit workflow из Review удалён. В Review остались PR и вход в тот же Git.

Маршруты проверки:
- **Code → Git → Изменения**: фильтр файла / автора / changelist, stage файла, блока или строк; источник сравнения «Рабочая копия / Индекс», split/unified; commit/amend и выбранные проверки. Подготовка видимых файлов не захватывает скрытые. Смена worktree diff после stage оставляет отдельный staged snapshot, показывает предупреждение и блокирует commit до повторной подготовки.
- **История**: поиск SHA/автора/сообщения, выбор commit, snapshot созданного в макете коммита; interactive rebase, cherry-pick/revert/reset как планы; отдельный Reflog со снимками и recovery branch в явном учебном наборе.
- **Ветки**: branch/tag/worktree, контекстные действия, compare с выбором двух учебных refs; конфликт Base/Yours/Theirs/Result. Сохранение учебного решения не выдаётся за настоящий merge.
- **Stash / Shelf**: отдельные наборы с patch и index; apply сохраняет оригинал, pop удаляет только после применения. Overlap и dirty buffer не перезаписываются.
- **Remotes**: адреса fetch/push, создание и правка, clone plan, pull/push preview, переход к Pull requests. **Консоль**: журнал действий макета, без выполнения команд.
- **Действия файла → Blame**: учебные аннотации и переход к выбранной ревизии. Native history dialogs закрываются Escape и кнопкой; меню действия закрывается при переходе.

Живой UI проверен: partial commit сохраняет второй блок, Stash apply сохраняет запись, filtered stage, index view, dirty-buffer rejection, form preview→edit, Escape, Atlas→Nova→Atlas сохраняет draft/index; Compare меняет diff при смене refs, Blame меняет revision, Reflog создаёт отдельную demo branch; после закрытия Blame нет перекрывающего меню. Светлая тема 768×1000 и тёмная стандартного окна, без внешнего horizontal overflow. JS errors после финальной проверки отсутствуют.

Доказательства: [Git](review-evidence/ide-git-workbench.png), [светлый компактный вид](review-evidence/ide-git-light-768.png), [конфликт](review-evidence/ide-git-conflict.png), `review-evidence/ide-git-audit.cjs` и JSON результата.

Границы: реальные Git/MCP/network/filesystem не подключены; данные страницы не являются durable repository. Старые редакторские примеры и Git fixture имеют разные источники, поэтому Save редактора НЕ выдумывает новый HEAD/status. В продукте их объединение обязательно через DocumentService/RepositoryService, SCM-08…12. Некоторые сложные операции остаются планами, не симуляцией DAG. Полный объём и этапы: [IDE Git parity](../docs/suite/IDE-GIT-PARITY.md), 37 групп; этот прототип не является доказательством полного паритета Git engine с IntelliJ.
