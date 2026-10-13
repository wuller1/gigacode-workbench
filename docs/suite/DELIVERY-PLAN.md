# План разработки полного Workbench

## Принцип поставки

Каждый этап заканчивается работающим вертикальным сценарием в приложении, который пользователь может сразу применять для дальнейшей разработки самого Workbench. Макет, типы и кнопки без backend не закрывают этап. Для каждого среза сохраняются acceptance IDs, миграция, rollback, тестовые доказательства и screenshot живого приложения.

Машинный список карточек находится в `suite/implementation-plan.json`. Агент берёт одну готовую карточку, читает только связанные документы, выполняет её и обновляет evidence. При обнаружении уже написанной реализации сначала проверяет её и выбирает `reuse`, `repair` или `replace` в migration inventory. Решение строится по одинаковым живым сценариям, измерениям и data/owner impact. Если существующий вариант существенно лучше и объединить достоинства нельзя, он остаётся активным: агент готовит изолированную альтернативу, завершает независимую работу и просит пользователя выбрать один из двух уже проверяемых вариантов с аргументированной рекомендацией. До ответа никакого overwrite/migration нет.

## Этап 0. Инвентаризация и безопасное продолжение

**Результат:** агент на рабочем Windows запускает существующее приложение, находит владельцев состояния и составляет честную карту уже реализованных функций.

- отдельный тестовый `userData`, commit/dirty snapshot и команды запуска;
- inventory существующих browser/editor/tracker/MCP/database/Git модулей;
- реальные MCP schemas, endpoints aliases, scopes и read-only canaries;
- backup данных и план миграции;
- воспроизведение известных проблем: обновление только после клика, несколько окон, вкладки браузера, 400/413/429/HTML errors;
- базовая запись производительности и доступности.
- evidence-first comparison каждого существующего модуля с целевым контрактом: одинаковые сценарии, UX/шаги/время, recovery, a11y, performance, сопровождение и migration risk;
- reviewable decision receipt для неоднозначного случая; вопрос пользователю только если подтверждённый существующий вариант materially better и trade-off нельзя снять `repair`/adapter.

**Выдача пользователю:** экран Capability Inspector, migration report с `reuse/repair/replace`, сохранённый working baseline и один предложенный/начатый исправляющий срез. При реальном trade-off — один конкретный выбор с двумя screenshots/diffs/metrics и rollback, а не вопрос до аудита.

## Этап 1. Общая оболочка и бесшовный проектный контекст

**Результат:** один shell с Project → Task → Session и автоматически выбранной Role, а также рабочими пространствами Chat, Code, Browser, Design, Tasks, Operations, Data и Review.

- activity rail, Project/Task switchers, command palette, quick open;
- navigator, document tabs, inspector и dock tree;
- workspace/resource registry без уничтожения ресурса при переносе панели;
- project bindings, environment selector и visible target bar;
- сохранение layout/selections по `window + project + workspace`;
- status center, operation drawer, notification aggregation;
- единая политика анимаций always/system/reduced и ВАРМ-отрисовка по [REMOTE-DESKTOP-MOTION](REMOTE-DESKTOP-MOTION.md); локальная HTML-проверка и удалённая Windows-приёмка отмечаются отдельно;
- Settings → Integrations с несколькими connections каждого типа;
- нижняя строка composer с model, reasoning, context, read-only auto-role и Git branch/worktree;
- unified search по Project/Task/Session/file/command/resource и actionable review inbox;
- keyboard/focus/reduced-motion/zoom 100–200%.

Первым экраном остаётся полезная текущая работа, а не перегруженный dashboard. Проект восстанавливает свою задачу, вкладки и targets; фоновые операции продолжаются с badges.

## Этап 2. Browser Lab

**Результат:** стабильный браузер для ручной и агентской проверки UI.

1. Адресные события окна, устойчивый active tab, `requestId`/`reuseKey`, сохранение порядка и выборов.
2. Profiles, permissions, downloads, auth/cert/proxy policy.
3. Console, page errors, network, element/AX snapshot и screenshots.
4. Управление viewport/orientation/DPR/touch/zoom и side-by-side layouts.
5. Устойчивые refs, action/wait/assert APIs, recipes/traces и evidence.
6. External-browser connector для сценариев, где нужна существующая корпоративная identity.

Dogfood: агент открывает локальное приложение, выполняет сценарий в двух окнах без лишних вкладок, собирает screenshot/console/network evidence и прикрепляет к Task.

## Этап 2D. Design & Artifacts

**Результат:** агент собирает интерактивный responsive макет, пользователь комментирует его, а реализация проверяется по утверждённой версии.

1. Versioned artifact store, provenance и sandbox preview.
2. Critical brief, flow/state matrix и варианты решений.
3. Responsive code-prototype canvas с artboards/themes/states.
4. Tokens/components/inspector, comments, versions и compare.
5. Количественный design/accessibility audit и browser trace.
6. Handoff в IDE и визуально-поведенческое сравнение реализации.
7. Необязательный vector scene graph/внешний Penpot adapter только после полного code-prototype flow и exact-version license review.

Dogfood: следующий экран Workbench проходит brief → prototype → review → code → screenshot/interaction comparison внутри одной Task.

## Этап 3. Source Control и Review

**Результат:** пользователь видит все изменения агента и управляет Git/корпоративным forge из одного пространства.

- repository status, diff working/index/HEAD/base, change sets;
- stage/unstage/discard hunks, commit, branches, worktrees, history, blame, conflicts;
- clone/fetch/pull/push с явным remote/branch target;
- несколько forge connections/workspaces/repositories;
- PR create/update, threads, comments, approve/request changes, checks и merge capability;
- capability-aware release/tag/changelog и merge queue после основного PR flow;
- неизвестный исход push/merge сверяется с remote;
- agent completion ведёт в Review с фактическим diff и test evidence.

Dogfood: текущий срез Workbench просматривается, тестируется, коммитится и публикуется через новый интерфейс.

## Этап 4. IDE

**Результат:** полноценный ежедневный кодовый цикл для React/TypeScript, Python и Java.

Сначала [исследование Ultimate](IDE-ULTIMATE-RESEARCH.md), [151 capability](IDE-ULTIMATE-PARITY.md) и [21 fixture](../../suite/ide-engine-fixtures.json). Они уточняют существующие S4-карточки, не меняют их зависимости и общий prototype approval gate.

0. S4-00: inventory/Windows spike, engine ADR Theia/Code-OSS/current implementation; отдельно Java backend JDT либо допустимый IntelliJ extension, license/API/single-backend gaps.
1. Secure origin/worker либо согласованный transport выбранного engine.
2. Единственный document authority/DocumentService bridge, multi-tab/split, crash drafts, external-change conflict.
3. Search/replace, symbols, Problems, Output, diff/merge.
4. Run/test configurations и process supervisor.
5. Java/Spring/Maven project import, tests/debug; затем Python и frontend по тем же end-to-end требованиям, без ложного закрытия остальных языков.
6. DAP/debug, breakpoints, stack, variables, watches.
7. Интеграция с Task, agent attachments, terminal, Browser Lab и Review.
8. S4-05: semantic refactors/inspections, structural/dependency/UML analysis; S4-06: Spring/JPA/framework/API/injections; S4-07: real profiling/dumps. Каждая capability имеет собственный evidence и явный gap.
9. S4-04: SSH/WSL/dev-container adapters после устойчивого локального Windows IDE; execution host всегда видим. Их поздняя волна не исключает remote workflows из конечного scope.

Dogfood: исправить небольшой дефект Workbench внутри Workbench, запустить тест, проверить UI в Browser Lab и открыть diff.

## Этап 5. Tasks

**Результат:** существующая Task становится центром требований, плана и доказательств, без второго issue-store.

- versioned description, requirements, acceptance, decisions и dependencies;
- list/detail/board/backlog/sprints/releases/timeline;
- custom workflows, fields, saved filters, comments, activity и attachments;
- динамический агентский Todo: completed зачёркнуты/приглушены, current выделен и анимирован с reduced-motion fallback;
- links на sessions, commits, PR, runs, deployments, queries и artifacts;
- локальный offline режим и adapter remote tracker;
- actionable inbox, saved views/dashboards и двусторонняя remote sync с conflict resolution;
- Done gate проверяет acceptance/evidence согласно workflow.

Dogfood: весь следующий этап Workbench ведётся как Task с реальными sessions, Todo, change set и evidence.

## Этап 6. Operations и Knowledge

**Результат:** проектные подключения дают единый read-only обзор, затем безопасные действия.

1. Connector inventory, project bindings, credentials refs, audit/error normalization.
2. Knowledge search/tree/read/draft/version conflict/publish.
3. Jenkins jobs/queue/runs/progressive log/tests/artifacts.
4. Kubernetes/OpenShift discovery, resources, ownership, events/logs/watch.
5. Prepared Jenkins triggers и cancel с queue→build reconciliation.
6. Cluster dry-run/diff/apply, scale/restart/delete, exec и port-forward.
7. Dependency inventory/SBOM, Sprut findings, baseline и expiring suppressions.
8. Reviewable dependency upgrade proposal, compatibility tests и повторный Sprut scan.
9. Read-first GitOps desired/live drift, health/history и guarded sync после cluster safety.
10. Jenkins pipeline graph с nested/parallel/matrix stages, environments и manual gates.

Dogfood: по failed CI открыть адресный log, создать/связать Task, проверить workload rollout и сохранить receipt. Production target всегда видим и требует соответствующей policy.

## Этап 7. Data workspace

**Результат:** безопасный DataGrip-подобный ежедневный рабочий инструмент.

1. Vault, drivers в utility processes и read-only datasource explorer.
2. SQL console, параметры, pagination/cancel и виртуализированный result grid.
3. Transactions, mutation preview, affected-row guard и readback.
4. Data editor, import/export, schema DDL/diff/migration preview.
5. Explain plan, query history/favorites, sessions/locks и ER diagram.
6. Дополнительные DB drivers через versioned adapter API.

Dogfood: выполнить parameterized read query, закрепить результат в Task, проверить explain; mutation тестировать только на fixture DB.

## Этап 8. Оркестрация, память и оптимизация слабых моделей

**Результат:** управляемые из native UI host-owned subagents работают параллельно и восстанавливаются после обрывов в пределах 256k контекста; CLI остаётся execution adapter, а не control plane.

- capability probe для role instructions, session isolation, model и reasoning readback;
- AI router автоматически выбирает роль из request/Project/Task/stage/resource context, показывает reason/confidence и применяет переход на safe boundary; ручного profile selector нет;
- host-owned AgentTask/attempt store, Scheduler и durable outbox; DAG с leases/fencing на files/resources, fair bounded parallelism и общим provider/project budget;
- subagent cards/status/output и coordinator view с native controls: pause/resume admission, addressed clarify, stop/cancel, safe retry/reconcile, next-attempt model/reasoning и result disposition;
- per-subagent requested→actual model/reasoning, auto-role/version, budget, dependencies, lease/scope и join status;
- адресный межсессионный обмен внутри project, explicit cross-project link;
- общий task journal, verified facts, decisions и resource refs;
- context budget UI, pinned facts, compaction preview/restore points;
- 400/413 recovery, model fallback, 429 provider queue/backoff/circuit breaker;
- crash/restart recovery для assignments/outbox/reservations/attempts/leases/questions/results/unknown effects; possible dispatch/write не повторяется;
- библиотека проверенных повторяемых snippets/recipes с provenance, version и tests;
- role recommendation и пользовательские profiles с capability/binding suggestions;
- analyst/SDD vertical slice: contradiction/gap matrix, traceability и передача реализации другой роли;
- native queue/steer и durable Question Queue: один active overlay для выбранной Task/Session, choices+freeform с explicit confirm, idempotent receipt, sequential advance, defer/cancel/expiry, exact origin routing, stale/restart recovery и запрет преобразования hidden inter-agent traffic в вопросы; динамический Todo, artifacts/evidence;
- scheduled automations/review inbox после устойчивых checkpoint/dedupe и declarative signed extensions/hooks после policy diagnostics;
- компактные tool cards и Markdown без засорения чата.

Dogfood: из UI основной агент создаёт два независимых назначения, одно ставится на queue pause/resume, второе адресно останавливается без влияния на первое; после restart Scheduler восстанавливает outbox/leases, затем parent принимает свежие candidates, разрешает конфликт через единственного integration writer и закрывает join только после общих tests. Запуск тех же workers вручную в CLI не закрывает этап.

## Этап 9. Укрепление и выпуск

- Windows PowerShell 5.1 bootstrap и packaged NSIS/portable;
- bundled GigaCode CLI после локальной лицензионной/технической проверки, без credentials/history;
- migration/backup/restore/diagnostic export;
- crash/restart/offline/multi-window/load tests;
- accessibility, performance, memory/CPU and long-session tests;
- usage/cost/latency/retry/fallback trace center с measured/estimated provenance;
- license/SBOM/NOTICE и проверка собственных icons/assets;
- signed release только когда инфраструктура пользователя это позволяет.

## Порядок при конкуренции приоритетов

1. Потеря данных, смешение проектов/окон, ложный success и неверный target.
2. Основной цикл Chat → Code/Browser → Review → Task evidence.
3. Восстановление после сбоя и диагностика.
4. Скорость и сокращение ручных переходов.
5. Расширенные функции отдельного инструмента.

В личном проекте допускается быстрый выпуск среза, но acceptance реального поведения не пропускается. Строгие production policies из общих профилей не навязываются самому Workbench; для инфраструктурных target правила остаются привязаны к окружению.
