# Состояние реализации и продолжение работы

Обновление 14.10.2026: добавлена рабочая IDE на Theia с Java/Python/frontend расширениями, общими с агентом buffers, семантическими операциями, build/test/debug bridge и восстановлением. Установка, перенос и границы проверки: [IDE-RUNTIME-HANDOFF](suite/IDE-RUNTIME-HANDOFF.md). Полная матрица Ultimate остаётся отдельной пофункциональной приёмкой.

Срез исходников: **14 октября 2026 года**. Приложение — `app/`, версия 0.2.0-preview.1; сохранённый пакет Workbench — `workbench/`, версия 1.3.0; полный suite-пакет требований — `docs/suite/` и `suite/`. Это разные уровни с разными проверками. Документ фиксирует наблюдаемое состояние и незавершённую работу, а не выдаёт целевой Browser/IDE/Design/Tracker/Operations/Data suite за готовый runtime.

Для следующего агента начальная загрузка контекста: [README](../README.md), этот файл, [контракт приложения](../app/CONTRACT.md), затем только исходники и продуктовый документ конкретной задачи. Не перечитывать весь каталог `workbench/docs/` на каждом ходе. Актуальные исходники и результаты проверок имеют приоритет над историческими описаниями эскиза.

## Три уровня готовности

1. **Есть код** — реализован сервис/UI-путь, который можно вызвать. Это не означает, что он проверен на каждой целевой ОС.
2. **Есть проверка** — известны команда, среда, ожидаемый и полученный результат. Fixture, живой CLI и desktop E2E — разные доказательства.
3. **Есть контракт/план** — описано желаемое поведение. Документы требований и изображения `mock-*` не являются реализацией.

Проверки ниже относятся к конкретному срезу. После существенной правки прикладывать новое подтверждение; не переносить старый `pass` на другой код. Наличие кнопки, завершение стрима, ответ «готово» или галочка плана не закрывают критерий приёмки автоматически.

## Что работает в исходниках и где проходят границы

| Область | Реализованная основа | Что ещё нельзя обещать |
| --- | --- | --- |
| Проект → задача → разговор | Сохраняемые сущности, роли, история, очередь, архивирование/восстановление; atomic store с одним writer | Полный Task aggregate с версионируемыми requirements, decisions, acceptance и workflow runs ещё не перенесён |
| ACP и параллельность | Отдельный процесс/remote session на host-разговор, один активный prompt на подключение, общий лимит параллельности, адресные события | Это не изоляция общего рабочего дерева. Полного provider quota/cost scheduler и circuit breaker ещё нет |
| Отмена и сбой | Отмена ждёт исходный terminal response; очередь удерживается. Потерянный исход сохраняется как unknown; автоматического replay нет | Отмена процесса не доказывает откат его внешних действий. Продолжение требует сверки возможных эффектов |
| Роль и модель | Встроенные/пользовательские профили, model/reasoning через реальные configOptions/readback, захват параметров текущего хода | CORE и роль передаются как context, не выдаются за system injection. Не все способы настройки GigaCode подтверждены |
| Контекст | Наблюдаемые usage updates; явная передача короткого host checkpoint в новую ACP-сессию; host tools `task_history` и `workbench_reference` для адресного чтения сохранённой истории/документов | Host не видит весь скрытый контекст CLI и не обещает нативное сжатие его истории. Наличие retrieval tool не доказывает, что модель воспользовалась им |
| Планы, вопросы, инструменты | ACP plan updates/host plan tool, MCP-вопрос с вариантами и свободным ответом; отдельные реальные permission replies | Todo — план агента. Это не журнал формальных stage checks, не независимая проверка и не разрешение расширить задачу |
| Исполнители и обмен | Дочерние сессии общей задачи, статус/результат; фоновая доставка same-project peer messages с сохранением очереди | Полный DAG scheduler, writer/worktree leases, межпроектные links/allowlists и полный join-контракт остаются в плане |
| Панели и ресурсы | Dock справа/снизу, drag, resize, группы, сохранение layout, несколько browser/PTY вкладок | Нет полной произвольной docking-системы и восстановления всех живых ресурсов после рестарта. Сохранённый layout не воскрешает процесс |
| Браузер | Настоящий WebContentsView, навигация/DOM read/click/fill, screenshot, zoom/viewport, session ownership и project partitions. Текущий source slice добавляет адресные window events, active tab state, request dedupe и artifact reuse | Новый regression test использует mock Electron. Живой multi-window renderer/Windows test ещё обязателен; persisted tabs, navigation revisions, certificates и corporate identity остаются в плане |
| Полный suite | `SUITE-UPGRADE-AGENT.md`, `docs/suite/`, typed reference contracts и машинные карточки описывают перенос Browser/Design/IDE/Tasks/Ops/Sprut/Data/Review и agent runtime в существующий app | Кроме явно отмеченного browser slice это целевой контракт, интерактивный target prototype и migration plan, а не реализованные панели/backend |
| Файлы и терминал | Локальные файлы проекта, текстовый просмотр/редактирование, optimistic save, Git status/diff; реальные PTY | Это не IDE/LSP/DAP. Переименование файлов ограничено безопасным текущим путём; операции с каталогами не объявлять поддержанными без проверки |
| Материалы | Существующие файлы регистрируются как immutable copies; есть узкий импорт завершённого Qwen builtin artifact metadata с workspace path, проверкой области и dedup; текст/Markdown/изображения/HTML preview, экспорт | Полный CAS editor/version graph, annotations, DOCX/PDF/презентации и цикл interactive mockup → review → v2 ещё не закрыты |
| Память и поиск контекста | Локальная текстовая память; `memory.remember` атомарно добавляет ограниченную запись statement/evidence с явным global scope, hash dedup и статусом `reference_only`; есть host MCP surface | Это не полный provenance memory из `tools/memory.ps1`: нет полного native project-scope/import/conflict lifecycle. Запись не становится verified автоматически; фильтр типовых credentials не является DLP. Не заявлять полноценный RAG или новые межпроектные права |
| Workbench workflows | Каталог 14 профилей/29 workflows и работающий самостоятельный PowerShell controller | Electron пока не исполняет все 29 workflows и не импортировал целиком legacy run/journal/evidence. Не заводить второй независимый engine ради UI |
| Разрешения | Host ограничивает свои IPC/MCP операции, ACP permission callback использует предлагаемые CLI варианты | Роль «reviewer» не делает все инструменты CLI read-only. Prompt не заменяет sandbox/OS permissions, отдельный процесс не ограничивает его ФС |

Главные владельцы кода: `app/electron/service.ts` — задачи/сессии/очередь; `store.ts` — запись состояния; `acp.ts` — транспорт; `main.ts` — IPC и окна; `browser.ts`, `terminal.ts`, `workspace.ts`, `mcp.ts` — соответствующие сервисы. Renderer находится в `app/src/`, общие типы — в `app/shared/types.ts`. Не дублировать эти владельцы новым «универсальным контроллером».

## Что фактически проверено

| Проверка | Результат и предел |
| --- | --- |
| 12 текстовых источников и 12 готовых `.ps1` | SHA-256 обеих копий совпадают с `workbench/scripts.json`; UTF-8 BOM сохранён. `.ps1` в GitHub-поставке уже материализованы |
| Повторный запуск готовых PowerShell suites | **85/85**: controller/journal 35, docs-impact 15, install-user 16, memory 19; **8/8 Node** checks метрик плюс целостность экспортируемого payload. 5 suites без failures; actual runtime **PowerShell 7.4.20, macOS arm64** |
| Полный installer preflight | Из `workbench/install-user.ps1`: **240 файлов**, 9 агентов при явном `-IncludeAgents`; все sources внутри `workbench`, `app/` и `node_modules/` не включены. `PlanOnly`, установка и глобальная среда не менялись |
| Текущая Qwen dependency | `@qwen-code/qwen-code` **0.25.1** закреплён в package/lock; установленный entrypoint локально вернул 0.25.1. Build/tests/package и Windows CI текущей revision перечисляются отдельно и не наследуют pass 0.25.0 |
| Реальный Qwen ACP | Qwen Code **0.25.0**, OpenRouter, macOS: независимые перекрывающиеся сессии, отмена A без остановки B, продолжение после отмены, конфигурация reasoning/readback. Приватный harness и credentials не поставляются |
| App fixture tests | **54 passed, 2 Windows-only skipped** в локальном `npm test` 13 октября; browser regression покрывает ownership всех existing-tab операций, order/adjacent close, bounds без activation, project-scoped request/reuse dedupe и transfer. Наборы в [app/tests](../app/tests) не заменяют живой desktop/Windows-прогон |
| Build и аудит зависимостей | Локальный `npm run build` успешен; полный `npm audit` с dev и prod: **0** по всем severity на момент проверки. Аудит базы известных уязвимостей не является общим доказательством безопасности |
| macOS packaging | `electron-builder --mac dir` завершился с кодом 0; упакованный Electron с `ELECTRON_RUN_AS_NODE=1` запустил фактический bundled Qwen `cli.js --version` → **0.25.0**, код 0. Это не Windows installer и не GigaCode |
| Отдельный manual ACP probe | Metadata/config и опциональная marker-ветвь проверены на offline fixtures; провайдер не вызывался. [Инструкция](MANUAL_ACP_PROBE.md) отделяет этот запуск от обычного `npm test` и платного режима |
| Windows CI | **pass на `de0b6df`**, [run 37965731926](https://github.com/wuller1/gigacode-workbench/actions/runs/37965731926): Windows PowerShell 5.1 — 85 checks + 8 Node; app — 49 passed / 2 platform skips, 6 files; реальные PTY marker/exit/cleanup и Sharp; build, NSIS/portable, packaged Qwen 0.25.0. Electron Modal/focus regression — 10/10 после последнего исправления; ручная Windows-установка не выполнена |
| Живой Electron UI | На macOS наблюдались настоящий ответ Qwen, переключение модели/reasoning, MCP-вопрос со свободным ответом, artifact → HTML/browser → click, перенос живой browser tab между окнами, настоящий дочерний Qwen с результатом и закрытие приложения с активным zsh PTY без аварии. Реально проверены browser 390 × 844/DPR 1, maximize/Escape, pointer docking, archive/restore и финальная Modal focus/Escape последовательность; отдельный Electron fixture 10/10 с падающим старым negative control. Подробности и незавершённые пункты — в [отчёте](LIVE_TEST_REPORT.md); полный roadmap этим не закрыт |
| GigaCode пользователя | **26.9.75 недоступен в этой среде**. Совместимость его auth/config/options/ACP extensions пока не подтверждена. Legacy PowerShell 5.1 suites проверены отдельно в Windows CI; это не проверка GigaCode |

Датированный срез, происхождение результатов и открытые пункты собраны в [LIVE_TEST_REPORT.md](LIVE_TEST_REPORT.md). Он отдельно фиксирует успешный Windows CI конкретного commit, успешный повтор после последней UI-правки и непроверенные ручную Windows-установку/GigaCode.

Проверка `design-metrics` выше не запускала настоящий browser DOM collector: она проверяла payload и математические функции. Она не доказывает качество дизайна. PowerShell 7 на macOS сам по себе не доказывает совместимость Windows PowerShell 5.1; дополнительное подтверждение даёт уже выполненный Windows CI, ограниченное пройденными сценариями.

Для воспроизведения без модели:

```powershell
# В корне репозитория:
node tools/check-bundle.mjs
powershell.exe -NoLogo -NoProfile -File workbench/tests/run-tests.ps1 -RequireNode
cd app
npm ci --include=optional
npm test
npm run build
```

На другом хосте с PowerShell 7 вместо `powershell.exe` можно использовать `pwsh`, но результат подписывать фактической версией/ОС. Не отключать недоступный обязательный check молча. `check-bundle.mjs` только читает данные и не запускает код из проверяемого пакета. Помимо карты скриптов, BOM, `MANIFEST.txt` и относительных ссылок он статически проверяет структуру и DAG `suite/implementation-plan.json`, полное соответствие acceptance IDs, единый набор 14 ролей в bundle/профилях/GigaCode adapters/capability policy/workflows, UI kit catalog и минимальные accessibility markers интерактивного прототипа. В JSON-результате `legacyIssues` и `suiteIssues` разделены, поэтому устаревшие hashes нельзя принять за ошибку нового suite и наоборот. Checker ничего не устанавливает, не чинит hashes и не является криптографической подписью издателя.

## Legacy-пакет: как не установить всё приложение в CLI

Корень legacy-пакета здесь — **`<repo>/workbench`**, не `<repo>`. Установщик по умолчанию использует собственный `$PSScriptRoot`, поэтому запуск файла из этой папки корректен независимо от текущего каталога терминала. Если передаётся `-SourceRoot`, указывать именно `<repo>/workbench`.

Установщик рекурсивно перечисляет указанный source; универсального исключения `app/` у него нет. Не передавать корень GitHub-репозитория: это может включить приложение, зависимости и build output. `TargetRoot`, память и рабочие run-папки находятся вне source; план и hashes проверяются до применения. Установка старой CLI-обвязки не нужна для запуска Electron и не выполняется приложением автоматически.

`source/*.txt` и готовые `.ps1` — две побайтно одинаковые формы одной версии, а не разные реализации. При намеренном изменении скрипта обновлять обе формы, соответствующую запись `scripts.json`, проверки и затем `MANIFEST.txt`; не принимать отличающийся target за корректный только потому, что файл существует. `.gitattributes` сохраняет байты без преобразования line endings.

Перед публикацией пересчитать `workbench/MANIFEST.txt` по текущим файлам, включая 12 `.ps1`, исключая сам manifest, и снова запустить checker. При переносе в этот repo исходный manifest ещё относился к текстовой поставке и нескольким документам до обезличивания; его первоначальный отказ был ожидаемым и не требовал изменения скриптов. Нельзя просто подавить ошибку в CI.

## Какие старые формулировки читать как исторические

- `workbench/bundle.json` описывает исходную текстовую поставку; `distribution: text-source-and-static-graphics` не описывает весь GitHub-репозиторий с Electron-кодом и готовыми `.ps1`.
- [workbench/docs/VALIDATION.md](../workbench/docs/VALIDATION.md) и старые preview/audit reports относятся к предыдущему пакету/макету. «Нет исполняемых файлов», прежние числа файлов и «Electron ещё не написан» не являются текущим статусом `app/`.
- `SETUP-AGENT.md` допускает подготовку из текстовых исходников для прежнего формата. В этом репозитории сначала сверить уже готовые `.ps1`; повторное копирование при совпадающих hashes не нужно.
- M0–M12 и D0–D13 — порядок продукта и приёмки. Появление реализации нескольких поздних кнопок не закрывает ранний этап целиком.

## Последовательность следующей работы

Не запускать всё одновременно. Брать одну небольшую задачу, сохранять живую рабочую сборку и отдельный candidate `userData`. Настройка приложения, QA fixture и собственный production-проект не должны разделять одно тестовое хранилище.

1. **Стабилизировать поставку — M0–M2 / первые delivery checkpoints.** Windows CI финального кода `de0b6df` уже зелёный; проверить installer и portable в отдельном Windows-профиле: запуск без глобального Qwen, PTY PowerShell/cmd, путь с пробелами/кириллицей, restart, обновление/откат без потери задач. Исправлять конкретный сбой и записывать evidence. Проверить GigaCode 26.9.75 отдельно, когда он доступен; не переносить результат Qwen на форк.
2. **Закрепить рабочий UI — M3.** Прогнать два окна/две сессии, stop и удержанную очередь, browser ownership, вопросы с черновиком, hidden/moved panel без дублирования процессов, архивирование, реальные screenshots и file save conflict. Не использовать reload как штатное средство обновления UI. Сохранить existing reasoning selector.
3. **Завершать нативное состояние небольшими миграциями — M4.** Перенести один legacy run fixture с revision/attempt/journal/pending/evidence и доказать roundtrip/hash semantics. Затем — вопросы/decisions, scoped knowledge с источниками, bounded task history/reference retrieval. Один writer, один owner выполнения; после проверенного импорта не вести два расходящихся хранилища.
4. **Расширять совместную работу — M4/M5.** Сначала явные project links и scope для фонового обмена, затем DAG/worker leases/quota/join. Независимые ветви допускают параллельность; общий файл/неизвестный эффект требуют координации. Техническую переписку не возвращать в основной UI как обязательный peer inbox.
5. **Доставить полный цикл Design & Artifacts — SD-01…SD-04.** Brief/state matrix → versioned interactive responsive prototype → safe preview → comments/compare/audit → handoff → визуально-поведенческая проверка реализации. Базовый preview и новый target prototype уже есть; полный цикл определён в `docs/suite/DESIGN-AND-ARTIFACTS.md` и не считается реализованным по макету.
6. **Подключить Sprut и agent runtime небольшими срезами.** S6-05…S6-08 строят dependency inventory → findings/baseline → upgrade proposal → re-scan. S8-00…S8-05 проверяют реальные bindings/model/reasoning, automatic-only role routing, coordinator/context/profiles/native Chat и analyst/SDD; S8-10 отдельно доводит host-owned subagent lifecycle, outbox, leases/budgets, UI controls, join/evidence и crash recovery. Документы, prompt-файлы и ручной CLI spawn сами по себе не закрывают карточку.
7. **Дальнейшие этапы по потребности.** Advanced browser automation M7, расширенные design checks, упаковка/обновления M10, необязательные extensions M11 и языковая IDE Java/Python/React M12 после устойчивой основы. Самооптимизацию скриптов не запускать непрерывной фоновой LLM-петлёй.

Адресные контракты: [native migration](../workbench/docs/NATIVE_WORKBENCH_MIGRATION.md), [Task workspace](../workbench/docs/TASK_WORKSPACE.md), [role binding](../workbench/docs/ROLE_PROMPT_BINDING.md), [session collaboration](../workbench/docs/SESSION_COLLABORATION.md), [managed workers](../workbench/docs/MANAGED_SUBAGENTS.md), [native mockups](../workbench/docs/NATIVE_MOCKUP_ARTIFACTS.md). Остальное открывать по требованию выбранной задачи.

## Инструкция агенту на первый ход

Прочитай короткий ввод выше и уточни фактический checkout/runtime по локальным файлам. Выбери первый незакрытый критерий ближайшей поставки, а не новый проект или переписывание приложения. Зафиксируй ожидаемый результат, владельца файлов, воспроизведение и минимальную проверку; для маленького исправления не требуй полный SDD или обязательных субагентов. При противоречии требований покажи его и предложи решение, не расширяя реализацию молча.

Сначала используй локальные fixtures, затем нужный live-сценарий с явным лимитом платных ходов и безопасной тестовой папкой. Credentials передаются только разрешённым способом вне repo; не искать их автоматически в чужих проектах. Каждую проверку подписывай средой и источником evidence. В конце выдай пользователю рабочую сборку либо точный воспроизводимый результат, что проверить руками, оставшиеся ограничения и способ отката. Обнови этот файл после подтверждённого изменения состояния; не помечай весь roadmap завершённым.
