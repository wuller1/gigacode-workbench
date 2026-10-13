# Строгий аудит разрывов относительно developer-agent workbench

Срез: **13 октября 2026 года**. Аудит покрывает выбранный рабочий контур одного разработчика: управление агентами, кодом, браузером, дизайном, задачами, данными, Git/forge, CI/CD, Kubernetes/OpenShift и знаниями. Он проверяет полноту этого контура по официально описанным возможностям ориентиров, но **не заявляет исчерпывающий parity со всеми редакциями, тарифами, enterprise-функциями и будущими версиями каждого продукта**.

[`COMPETITOR-CAPABILITY-MATRIX.md`](COMPETITOR-CAPABILITY-MATRIX.md) отвечает на вопрос «что должно быть в целевом Workbench». Этот документ отвечает на более строгий вопрос: «что уже подтверждено исходниками, чего ещё нет, какое решение принято, какой карточкой и каким критерием это закрывается».

## Метод и язык решений

Решения в таблицах означают:

- **adopt** — воспроизвести сам рабочий сценарий собственным контрактом и интерфейсом;
- **adapt** — перенести принцип, изменив его под `Project → Task → Role/Session`, локальную архитектуру, слабые модели и корпоративные MCP;
- **defer** — оставить в очереди после обязательного рабочего контура;
- **reject** — сознательно не реализовывать;
- **reference-only** — изучать поведение и документацию, не переносить код, тексты, assets или фирменный облик.

Уровни evidence:

- **runtime** — путь действительно существует в `app/`; это ещё не доказывает live Windows/Electron/corporate endpoint;
- **legacy runtime** — функция есть в самостоятельном PowerShell Workbench, но не является нативной функцией Electron;
- **contract only** — есть документ, тип или карточка, но пользовательский путь ещё не работает;
- **missing** — нет ни подтверждённого runtime, ни достаточного закрывающего контракта.

Нельзя повышать статус по screenshot, макету, наличию кнопки, ответу модели или описанию в документации. Для закрытия разрыва нужен критерий из [`ACCEPTANCE.md`](ACCEPTANCE.md), evidence с revision и проверка на требуемом уровне.

## Базовая карта текущего evidence

Эти метки используются ниже, чтобы не выдавать план за реализацию.

| Метка | Наблюдаемое состояние | Точное evidence |
| --- | --- | --- |
| **R-CORE** | Сохраняемые Project, Task, Session, очередь, вопросы, Todo, archive/restore и профили | [`app/electron/service.ts`](../../app/electron/service.ts), [`app/electron/store.ts`](../../app/electron/store.ts), [`app/shared/types.ts`](../../app/shared/types.ts), [`app/src/App.tsx`](../../app/src/App.tsx) |
| **R-ACP** | Отдельное ACP-подключение на host-session, cancel без слепого replay, фактические config options и readback model/reasoning | [`app/electron/acp.ts`](../../app/electron/acp.ts), [`app/electron/service.ts`](../../app/electron/service.ts) |
| **R-SHELL** | Перемещаемые right/bottom панели, resize/maximize, панели Plan/Browser/Terminal/Artifacts/Changes/Workers | [`app/src/Workspace.tsx`](../../app/src/Workspace.tsx), [`app/src/Panels.tsx`](../../app/src/Panels.tsx) |
| **R-BROWSER** | Native WebContentsView, вкладки, навигация, viewport/zoom, inspect/click/fill, screenshot; добавлена owner-window изоляция, но live multi-window Windows evidence ещё обязателен | [`app/electron/browser.ts`](../../app/electron/browser.ts), [`app/electron/mcp.ts`](../../app/electron/mcp.ts), [`app/tests/browser-state.test.ts`](../../app/tests/browser-state.test.ts) |
| **R-DEV** | Файлы, ограниченное редактирование, реальные PTY, Git status/diff | [`app/electron/workspace.ts`](../../app/electron/workspace.ts), [`app/electron/terminal.ts`](../../app/electron/terminal.ts), [`app/src/Panels.tsx`](../../app/src/Panels.tsx) |
| **R-ART** | Регистрация, просмотр и экспорт существующего материала; HTML может открываться в browser surface | [`app/electron/service.ts`](../../app/electron/service.ts), [`app/src/Panels.tsx`](../../app/src/Panels.tsx) |
| **R-CHILD** | Дочерняя сессия общей Task и её статус/результат; это ещё не DAG coordinator, lease или worktree isolation | [`app/electron/service.ts`](../../app/electron/service.ts), [`app/src/Panels.tsx`](../../app/src/Panels.tsx) |
| **L-WORKBENCH** | 14 профилей, 29 workflows, память, checkpoints и PowerShell controller существуют отдельно; Electron не исполняет весь этот каталог нативно | [`workbench/profiles`](../../workbench/profiles), [`workbench/workflows`](../../workbench/workflows), [`workbench/workbench.ps1`](../../workbench/workbench.ps1) |
| **C-SUITE** | Канонические target contracts и этапы описаны; кроме отмеченных runtime-slices это план | [`suite/implementation-plan.json`](../../suite/implementation-plan.json), [`ADAPTER-CONTRACTS.md`](ADAPTER-CONTRACTS.md), [`DELIVERY-PLAN.md`](DELIVERY-PLAN.md) |

## Дополнительные карточки и критерии

Разрывы ниже внесены в машинный план и центральную приёмку как самостоятельные карточки. Статус `planned` означает только наличие проверяемого контракта.

| Card | Этап | Результат | Acceptance |
| --- | --- | --- | --- |
| **S1-05** | 1 | Unified search/command palette, session search/pin/archive filters, notification/review inbox | **FND-09:** поиск находит Project/Task/Session/file/command/resource с типом, scope и безопасным переходом; 50k элементов не блокируют renderer. |
| **S3-04** | 3 | Release/tag/changelog и merge queue как capability-aware forge extension | **SCM-07:** release/merge queue используют точные repo/base/head/tag, remote revision и readback; недоступная capability не отображается как рабочая. |
| **S4-04** | 4 | Optional remote workspace: SSH/WSL/dev-container и multi-root mapping | **IDE-08:** UI всегда показывает execution host/runtime/root; paths и процессы разных hosts не смешиваются, disconnect сохраняет recoverable state. |
| **S5-04** | 5 | Task inbox/notifications/dashboards и двусторонний remote tracker sync | **TSK-08:** remote/local conflict не теряет поля; inbox группирует actionable события, mute/snooze и deep link воспроизводимы. |
| **S6-09** | 6 | Read-first GitOps adapter для desired/live diff, health, history и guarded sync | **OPS-07:** desired/live revision, drift и health имеют точный source; sync требует capability/RBAC/target review и подтверждается readback. |
| **S6-10** | 6 | CI pipeline graph: nested/parallel/matrix stages, environments, manual gates и retry/restart semantics | **OPS-08:** graph сохраняет stable stage IDs, parallel/nested structure, agent/environment и live state; approval показывает submitter/target/input, а retry/restart адресует точный run/stage. |
| **S8-06** | 8 | Scheduled automations, triggers и review inbox | **AUT-01:** schedule/trigger, project/task/profile/model, permissions и next run сохранены; один fire создаёт один run, restart не дублирует его, результат попадает в review inbox. |
| **S8-07** | 8 | Declarative hooks/plugin packages и diagnostics | **EXT-01:** plugin показывает origin/version/signature/tools/permissions; hook имеет typed event, timeout и receipt, не повышает права профиля. |
| **S9-03** | 9 | Usage/cost/performance/trace center и update health | **OBS-01:** provider usage, retry/fallback и latency помечены measured/estimated; correlation trace восстанавливает путь без secret/raw corporate payload. |
| **SD-05** | после SD-04 | Optional vector scene graph или внешний Penpot adapter | **DSN-11:** import/export сохраняет geometry/tokens/provenance; несовместимые features видимы, сторонний код/assets проходят точный license review. |

## 1. OpenAI Codex app и CLI

Официальные ориентиры: [Codex app](https://openai.com/index/introducing-the-codex-app/), [developer workflow](https://openai.com/index/codex-for-almost-everything/). Релевантны параллельные агенты по проектам, worktree isolation, review изменений, skills, фоновые automations и сохранение рабочего контекста.

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Projects, threads, run state и быстрый возврат | **R-CORE** покрывает сущности и историю; нет полного project home, pin/search/filter и восстановления всех live resources | **adapt** к иерархии `Project → Task → Role/Session` | S1-01, S1-02, **S1-05** | FND-01, FND-08, **FND-09** |
| Параллельные agents и видимый прогресс | **R-CHILD** даёт дочерние sessions; нет bounded DAG, leases, conflict-aware join и независимой проверки | **adapt** | S8-01 | AGT-01, AGT-02 |
| Worktree isolation и review change set | **R-DEV** показывает только Git status/diff; создание/ownership/merge/discard worktree отсутствуют | **adopt** | S3-01, S3-02, S8-01 | SCM-01, SCM-02, SCM-03, AGT-01 |
| Skills и reusable workflows | **L-WORKBENCH** богат, но не нативен; version/provenance/tool policy UI ещё нет | **adapt**, загружать по необходимости, не раздувать 256k context | S8-03, **S8-07** | AGT-06, **EXT-01** |
| Scheduled automations и review inbox | Runtime отсутствует | **defer** до устойчивого coordinator/recovery, затем **adopt** | **S8-06** | **AUT-01** |
| Queue/steer/follow-up, side chats и fork | Очередь и child sessions есть в **R-CORE/R-CHILD**, но нет явного interrupt boundary, fork-from-checkpoint и return/join contract | **adapt**: пользователь видит queued/steering intent, межсессионная доставка остаётся фоновой и auditable | S8-01, S8-02 | AGT-01, AGT-02, AGT-07 |
| Browser/artifact feedback loop | **R-BROWSER/R-ART** дают базовый live preview и captures; нет trace-quality browser evidence и design implementation compare | **adapt** совместно с Browser Lab и Design | S2-02, S2-03, SD-04 | BRW-05, BRW-06, BRW-08, DSN-08 |
| Cloud/remote/mobile execution и account billing | Нет; не требуется для локального основного продукта | **defer/reference-only**; внешний runner только через adapter | optional после S9 | отдельная приёмка после выбора provider |

**Граница прав:** Codex — проприетарный продукт и функциональный ориентир. Не переносить код приложения, тексты, screenshots, animations, icons, design tokens или торговый облик. Общие patterns «список задач + чат + change review» реализуются собственным layout и графикой. OpenAI SDK/API можно подключать только как отдельную versioned dependency/integration по её условиям; Codex runtime не входит в пакет автоматически.

## 2. Claude Code и Claude Desktop

Официальные ориентиры: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks), [memory](https://code.claude.com/docs/en/memory), [Claude Desktop local MCP/desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Role-scoped subagents с отдельным prompt/model/tools | **R-CHILD** и **R-ACP** частично покрывают session/model; backend tool policy, leases и bounded result отсутствуют | **adapt** | S8-01, S8-03 | AGT-01, AGT-05, AGT-06 |
| Background work, teams и адресный обмен | Same-project peer delivery и child status есть в core, но нет durable coordinator DAG, dependency graph и writer isolation | **adapt** | S8-01, S8-02 | AGT-01, AGT-02, AGT-07 |
| Hooks и deterministic guardrails | Workflows сейчас prompt/controller-driven; typed pre/post/error hooks с timeout/receipt отсутствуют | **adapt** только как declarative, policy-checked host events | **S8-07** | **EXT-01**, CON-02 |
| Hierarchical memory/instructions | Локальная память и профили существуют, но provenance/conflict/forget и нативная миграция неполны | **adapt** | S8-03 | AGT-06, AGT-07 |
| Desktop extensions / local MCP management | Есть MCP host surface и целевой connection registry, но нет installable extension registry, schema health UI и encrypted configuration flow | **adapt** к reusable connections/project bindings; произвольные bundles — после signing/policy | S0-02, **S8-07** | CON-01, CON-02, FND-07, **EXT-01** |
| Проприетарный Claude Desktop experience | Копирование не требуется | **reject/reference-only** | — | REL-04 |

**Граница прав:** Claude Code/Desktop и их интерфейс проприетарны. Допустимы MCP как открытый протокол и собственные адаптеры; `.mcpb` или иной bundle нельзя включать без проверки manifest, бинарников, лицензий, подписи и transitive содержимого. Не копировать фирменный UI, тексты, icons и screenshots.

## 3. Cursor

Официальные ориентиры: [Cursor Agent](https://cursor.com/docs/agent/overview), [Browser](https://cursor.com/docs/agent/tools/browser), [checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints), [rules](https://cursor.com/docs/context/rules).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Agent modes, rules и project context | **R-CORE/R-ACP** имеют role/model/reasoning; **L-WORKBENCH** имеет profiles/workflows. Нет единого prompt layering simulator | **adapt** | S8-03 | AGT-05, AGT-06 |
| Integrated browser, screenshots и agent actions | **R-BROWSER** покрывает базу; отсутствуют generation-bound refs, waits, console/network/AX, trace recorder, cert/proxy/identity | **adopt** полный Browser Lab contract | S2-00, S2-01, S2-02, S2-03 | BRW-01, BRW-02, BRW-03, BRW-04, BRW-05, BRW-06, BRW-07, BRW-08 |
| Checkpoints/revert после agent edit | Host checkpoint и Git diff не образуют selective agent-edit checkpoint | **adapt**: Git, document revision и agent checkpoint показывать раздельно | S3-01, S3-02, S8-02 | SCM-03, AGT-03, AGT-07 |
| Background/cloud agents | Нет локального durable runner; cloud инфраструктура не входит в цель | локальный persisted run **adapt**, vendor cloud **defer/reference-only** | S8-01, S8-02 | AGT-01, AGT-07 |
| IDE edit/search/test/debug | **R-DEV** — только основа, LSP/DAP/test explorer отсутствуют | **adopt** привычный цикл, реализация Monaco/LSP/DAP | S4-01, S4-02, S4-03 | IDE-01, IDE-02, IDE-03, IDE-04, IDE-05, IDE-06, IDE-07 |

**Граница прав:** Cursor — проприетарный ориентир. Не копировать source, editor chrome, microcopy, screenshots или branded motions. Browser/agent/IDE patterns должны иметь собственные contracts и оригинальные assets.

## 4. Windsurf / Cascade

Официальная точка входа: [Windsurf documentation index](https://docs.windsurf.com/llms.txt), включая Cascade, rules, memories, workflows, web/docs search и MCP. На дату среза часть Windsurf URLs может перенаправляться в актуальную документацию владельца; перед реализацией проверять именно текущий официальный index, а не сторонние пересказы.

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Global/workspace rules и reusable workflows | **L-WORKBENCH** уже богаче по числу ролей/workflows, но Electron не даёт authoring/lint/simulation UI | **adapt** с явной областью и ограниченным prompt payload | S8-03 | AGT-06 |
| Workspace memories и automatic suggestions | Память есть, но automatic proposal/diff/reason/conflict/forget неполны | **adapt**; модель предлагает, host валидирует, пользователь может удалить | S8-03 | AGT-06, AGT-07 |
| Web/docs search и selected-context retrieval | Browser inspect и bounded reference tools частичны; unified indexed retrieval/citations нет | **adapt** через typed refs и artifact evidence | S1-05, S2-02, S4-02, S8-03 | FND-09, BRW-05, IDE-07 |
| Terminal/edit loop и visible diff | **R-DEV** частично работает; IDE и change sets ещё отсутствуют | **adopt** | S3-01, S4-01, S4-02, S4-03 | SCM-03, IDE-01, IDE-02, IDE-03, IDE-04, IDE-05, IDE-06, IDE-07 |
| Proprietary Cascade flows/models/cloud | Не нужны для GigaCode-based host | **reject/reference-only** | — | — |

**Граница прав:** Windsurf/Cascade — проприетарный функциональный ориентир. Не переносить rules templates, тексты, UI, branding или bundled model behavior. Если официальная документация сменила домен/названия, сохранять функциональные IDs Workbench и ссылку на дату аудита, а не копировать новую терминологию.

## 5. VS Code и GitHub Copilot

Официальные ориентиры: [VS Code Agents window](https://code.visualstudio.com/docs/agents/run/agents-window), [session management](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions), [custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [GitHub Copilot custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents), [hooks](https://docs.github.com/en/copilot/reference/hooks-reference), [plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Sessions across workspaces, groups, pin/archive/status/change count | **R-CORE** хранит sessions/archive/unread; нет group/pin/search/change rollup и cross-harness discovery | собственный project/task session hub **adopt**; чужие harnesses только через доказанный adapter | S1-02, **S1-05** | FND-01, FND-08, **FND-09** |
| Несколько chats внутри session, fork/checkpoint, stop/steer и handoff | Child session есть, но chats не имеют общего change-set aggregate, fork boundary и typed handoff | **adapt** без обещания совместимости с чужим Agent Host | S8-01, S8-02 | AGT-01, AGT-02, AGT-03, AGT-07 |
| Chat + Files + Changes + editor | **R-SHELL/R-DEV** дают панели, но editor, problems, tests/debug и full docking не готовы | **adopt** общий workflow | S1-01, S1-03, S3-01, S4-01, S4-02, S4-03 | FND-03, SCM-03, IDE-01, IDE-02, IDE-03, IDE-04, IDE-05, IDE-06, IDE-07 |
| Custom agents, handoffs и isolated subagent contexts | Profiles/children есть частично; tool restrictions/handoff contract/join evidence отсутствуют | **adapt** | S8-01, S8-03 | AGT-01, AGT-05, AGT-06 |
| Skills, MCP, plugins и deterministic hooks | MCP/legacy workflows частичны; package registry/diagnostics отсутствуют | **adapt** небольшую подписанную plugin surface | S0-02, S8-03, **S8-07** | CON-01, CON-02, AGT-06, **EXT-01** |
| Remote SSH/WSL/dev containers и multi-root | Нет | **defer** после устойчивого локального IDE | **S4-04** | **IDE-08** |
| Совместимость с VS Code extensions | Нет, архитектурно дорога и рискованна | **reject** обещание binary compatibility; нужные функции через LSP/DAP/собственные adapters | — | REL-04 |

**Граница прав:** GitHub Copilot и Microsoft VS Code distribution — отдельные продукты/условия. Исходный `vscode` repository и Monaco имеют свои лицензии; Workbench выбирает Monaco по MIT и открытые LSP/DAP specifications только после exact-version review. Не переносить Microsoft/GitHub icons, marketplace packages, product UI или proprietary extension services.

## 6. JetBrains IDE и Junie

Официальные ориентиры: [Junie agent](https://www.jetbrains.com/help/ai-assistant/junie-agent.html), [IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/welcome.html), [intellij-community terms](https://github.com/JetBrains/intellij-community/blob/master/LICENSE.txt).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Глубокая Java/Python/React навигация, refactor, diagnostics | **R-DEV** этого не обеспечивает | **adopt** через Monaco + language-specific LSP adapters и project toolchains | S4-01, S4-02, S4-03 | IDE-01, IDE-02, IDE-03, IDE-04, IDE-05, IDE-06 |
| Run/test/debug, problems и evidence | PTY есть, но named run configs, test explorer, coverage, DAP и Problems отсутствуют | **adopt** | S4-02, S4-03 | IDE-04, IDE-06, IDE-07 |
| Tool windows, keyboard navigation, database-style dense UX | **R-SHELL** частичен; full split/tree/focus/accessibility needs stage 1 | **adapt** общие desktop IDE patterns в оригинальном shell | S1-01, S1-03, S7-01, S7-02, S7-03 | FND-03, FND-04, FND-05, FND-06, DAT-01, DAT-02, DAT-03, DAT-04, DAT-05, DAT-06, DAT-07, DAT-08 |
| Autonomous coding/review agent | Profiles/session есть, но code intelligence и independent review gate неполны | **adapt** роль reviewer отделить от прав и фактов | S8-01, S8-03 | AGT-01, AGT-06 |
| Встраивание IDEA Community целиком | Не реализовано и не нужно | **reject**; optional `Open in IntelliJ` adapter допустим позднее | optional после S4 | IDE-07 |

**Граница прав:** JetBrains products, Junie, DataGrip UI, icons и branding не копируются. `intellij-community` — mixed/open build с отдельными terms и third-party inventory, поэтому не считать весь продукт одной Apache-библиотекой. Workbench использует функциональные patterns и отдельные LSP/DAP tools по их лицензиям; whole-IDE embedding отвергнут.

## 7. Figma, Penpot и Storybook

Официальные ориентиры: [Figma Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), [Penpot user guide](https://help.penpot.dev/user-guide/), [Storybook testing](https://storybook.js.org/docs/8/writing-tests), [Playwright trace viewer](https://playwright.dev/docs/trace-viewer).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Brief, flows, artboards, states и interactive prototype | **R-ART** хранит готовый файл, но не имеет design document/version/state model | **adapt** сначала code-prototype canvas | SD-01, SD-02 | DSN-01, DSN-02, DSN-03, DSN-04, DSN-10 |
| Components, variants, tokens/themes и asset provenance | Runtime отсутствует; контракт есть в [`DESIGN-AND-ARTIFACTS.md`](DESIGN-AND-ARTIFACTS.md) | **adopt** открытое token representation и собственную component registry | SD-01, SD-03 | DSN-04, DSN-07, DSN-09 |
| Dev inspect, annotations, version compare и handoff | Runtime отсутствует | **adapt** к Task/implementation links и evidence | SD-03 | DSN-04, DSN-05, DSN-06, DSN-07 |
| Component stories, interaction/a11y/visual tests | Browser screenshot есть, но stories/audit/baselines/behavior compare нет | Storybook как внешний project tool **adapt**, Browser Lab хранит evidence | SD-04 | DSN-05, DSN-06, DSN-08 |
| General-purpose vector editor | Нет; не нужен до завершения code-prototype flow | **defer** | **SD-05** | **DSN-11** |
| Hosted collaboration/whiteboard/enterprise admin | За пределами локального личного workbench | **reject/reference-only** | — | — |

**Граница прав:** Figma — только проприетарный функциональный ориентир. Penpot source — MPL-2.0: прямое изменение/перенос файлов создаёт file-level obligations; default — внешний adapter или reference, пока отдельный license card не одобрен. Storybook — MIT у выбранного upstream version, но hosted services и сторонние addons проверяются отдельно. Screenshots, vendor icons, templates, fonts и trade dress не переносятся. Каждый asset получает provenance/license/hash; иконки Workbench остаются оригинальными.

## 8. Jira и Linear

Официальные ориентиры: [Jira timeline](https://support.atlassian.com/jira-software-cloud/docs/create-manage-and-visualize-work-on-the-timeline/), [Jira boards](https://support.atlassian.com/jira-software-cloud/docs/what-is-a-jira-software-board/), [Linear documentation](https://linear.app/docs).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Rich issue/task aggregate: requirements, acceptance, decisions, relations, activity | **R-CORE** имеет простую Task и Todo; versioned aggregate/relations/workflow transitions отсутствуют | **adapt** поверх существующих IDs | S5-01 | TSK-01, TSK-02, TSK-06 |
| List/detail/board/backlog/cycles/sprints/timeline | Нет рабочего runtime | **adopt** удобный personal workflow с keyboard parity | S5-02 | TSK-03, TSK-07 |
| Agent Todo, progress и Done evidence | Todo runtime есть, но full reasoned replan/evidence gate неполны | **adapt** | S5-03 | TSK-04, TSK-05, TSK-06 |
| Inbox, notifications, saved views, dashboards/reports | Нет | **adopt** actionable personal views и измеримые cycle-time/throughput/blocker reports | **S5-04**, **S1-05** | **TSK-08**, **FND-09** |
| Remote tracker sync/custom fields/workflows | Generic connection contracts есть; live mapper/conflict resolution отсутствуют | **adapt** capability-aware mapping через MCP/API | S0-02, S5-01, **S5-04** | CON-01, FND-07, TSK-01, TSK-02, **TSK-08** |
| Enterprise portfolio/billing/admin parity | Не нужен | **reject/reference-only** | — | — |

**Граница прав:** Jira и Linear — проприетарные функциональные ориентиры. Не копировать UI, field names beyond generic interoperability needs, microcopy, icons, screenshots или board styling. Remote integrations обязаны использовать поддерживаемые API/MCP и права пользователя; данные не становятся частью публичного пакета.

## 9. DataGrip и DBeaver

Официальные ориентиры: [DataGrip Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html), [query execution plans](https://www.jetbrains.com/help/datagrip/query-execution-plan.html), [DBeaver Data Editor](https://dbeaver.com/docs/dbeaver/Data-Editor/), [ER diagrams](https://dbeaver.com/docs/dbeaver/ER-Diagrams/).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Multiple datasources, vault, SSH/TLS, explorer и metadata | Runtime отсутствует; [`DATABASE.md`](DATABASE.md) — contract only | **adopt** собственные isolated driver hosts и project bindings | S7-01 | DAT-01, DAT-02, DAT-08 |
| SQL console, completion, parameters, results/grid/export | Runtime отсутствует | **adopt** по engine capability, с limits/cancel/paging | S7-02 | DAT-02, DAT-03, DAT-04, DAT-05 |
| Transactions и guarded writes | Runtime отсутствует | **adapt** с target/statement class/unknown outcome/readback | S7-02 | DAT-03, DAT-04 |
| Data editor/import/export | Runtime отсутствует | **adopt** optimistic row locator, conflict handling и safe streaming | S7-02, S7-03 | DAT-05, DAT-06 |
| Explain/profile, schema compare/migrations, DDL, dependencies, ERD | Runtime отсутствует | **adapt** deep vertical slices по поддержанным engines | S7-03 | DAT-07, DAT-08 |
| Parity со всеми engines/plugins | Нереалистично для первого выпуска | **reject** универсальное обещание; capability UI скрывает unsupported | S7-01, S7-02, S7-03 | DAT-01, DAT-08 |

**Граница прав:** DataGrip проприетарен и используется только как функциональный ориентир. DBeaver Community upstream имеет Apache-2.0 исходники, но commercial editions, plugins, drivers, branding и assets имеют отдельные условия. Default — собственные contracts/drivers и изучение сценариев; перенос exact source возможен только отдельной карточкой с LICENSE/NOTICE/transitive review.

## 10. Headlamp, OpenShift Console и Lens

Официальные ориентиры: [Headlamp docs](https://headlamp.dev/docs/latest/), [OpenShift Console docs](https://docs.redhat.com/en/documentation/openshift_container_platform/4.16/pdf/web_console/OpenShift_Container_Platform-4.16-Web_console-en-US.pdf), [Lens docs](https://docs.lenshq.io/), [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Multi-cluster/context/namespace resource explorer | Нет Operations runtime; есть только connection/adapter contract | **adopt** read-first, project-bound targets | S0-02, S6-03 | FND-07, CON-01, OPS-01, OPS-02 |
| Discovery/RBAC/CRDs/OpenShift Routes/Builds/Operators | Нет live evidence | **adapt** исключительно по API discovery и current identity | S6-03 | OPS-01, OPS-02 |
| Workload detail, topology, events, logs, metrics | Нет | **adopt** progressive streams с resource UID/restart identity | S6-03 | OPS-02, OPS-04 |
| Apply/scale/restart/delete/exec/port-forward | Нет | **adapt** prepared action, dry-run/diff/expected revision/readback | S6-04 | OPS-01, OPS-03, OPS-04 |
| Plugin/marketplace parity и vendor UI | Нет и не требуется | plugin API **defer**, внешний облик **reject** | optional после S9 | EXT-01, REL-04 |

**Граница прав:** Headlamp и OpenShift Console repositories могут использоваться только по точной Apache-2.0/NOTICE проверке выбранных файлов и transitive assets; default — reference/API adapter. Lens Desktop/OpenLens и extensions имеют меняющиеся/open-core условия: документация — reference-only, пока exact repository/version/license не проверены. Не переносить Kubernetes/OpenShift/Lens logos, topology graphics или branded resource cards.

## 11. Jenkins и Argo CD

Официальные ориентиры: [Jenkins Remote Access API](https://www.jenkins.io/doc/book/using/remote-access-api/), [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/), [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/), [Blue Ocean status](https://www.jenkins.io/doc/book/blueocean/), [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/), [Argo CD upstream](https://github.com/argoproj/argo-cd).

| Capability | Наш runtime evidence и разрыв | Решение | Cards | Acceptance |
| --- | --- | --- | --- | --- |
| Multiple Jenkins instances/folders/jobs/search/favorites | Нет runtime панели; generic project binding contract есть | **adopt** через discovered MCP/API capabilities | S0-02, S6-02 | FND-07, CON-01, OPS-05 |
| Queue→build→stages, progressive logs, tests, artifacts, changes/timings | Нет | **adopt** cursor streams и deep links к Task/commit/PR | S5-01, S6-02 | OPS-05, OPS-06, TSK-06 |
| Nested/parallel/matrix DAG, agents/environments и manual input gates | Нет; простой список stages потеряет фактическую структуру и approval state | **adopt** как capability-aware pipeline graph, включая pause/restart/retry semantics | **S6-10** | **OPS-08** |
| Parameterized trigger/rebuild/cancel/retry | Нет | **adapt** prepared action, correlation, unknown-outcome reconcile | S6-02 | CON-03, OPS-06 |
| CI failure triage by agent | Нет bounded evidence contract в runtime | **adapt**: exact log/test refs, proposed fix/Task, без выдуманного root cause | S6-02, S8-01 | OPS-05, AGT-01 |
| Argo desired/live diff, health, sync history | Нет; matrix помечает optional | **defer**, сначала read-only drift/health, затем guarded sync | **S6-09** | **OPS-07** |
| Blue Ocean visual design | Jenkins официально помечает Blue Ocean deprecated с июля 2026 года | **reject** как implementation/reference baseline; ориентироваться на Pipeline API и актуальные Pipeline Graph/Stage capabilities | S6-02, **S6-10** | OPS-05, **OPS-08** |
| Полный Jenkins/Argo UI или plugin ecosystem | Не требуется | **reject/reference-only** | — | REL-04 |

**Граница прав:** Jenkins core upstream использует MIT, Argo CD — Apache-2.0; это не разрешает копировать plugin code, third-party assets или весь интерфейс без exact-file review. Предпочтение — Remote API/MCP adapters и собственный UI. Имена продуктов используются для interoperability; logos, themes и screenshots не включаются.

## 12. Сквозные разрывы, которые отдельный конкурент не закрывает

Аудит обнаружил возможности, необходимые именно этому Workbench, даже если у конкурентов они разнесены по разным продуктам.

| Priority | Упущенная возможность | Почему это блокирует эффективный процесс | Карта реализации |
| --- | --- | --- | --- |
| **P0** | Truthful implementation/evidence badges в UI | Сейчас документ отличает runtime от contract, но пользовательский shell может создать впечатление готовности по наличию панели | S1-01, S5-03 → FND-05, TSK-05 |
| **P0** | Live Windows multi-window/browser regression | Mock test не подтверждает реальные WebContentsView focus/events/cert/SSO | S2-00, S2-01, S2-02 → BRW-01, BRW-02, BRW-03, BRW-04, BRW-05, BRW-06, BRW-07, BRW-08 |
| **P0** | Нативный role/prompt/tool/MCP layering и simulator | Legacy profiles/workflows качественны, но не полностью управляют Electron/ACP runtime | S8-03, S0-02 → AGT-05, AGT-06, CON-01 |
| **P0** | Context compaction/recovery для 400/413/429 и HTML errors | 256k window и provider failures могут оборвать Task; скрытый fallback недопустим | S0-02, S8-02 → AGT-03, AGT-04, AGT-05, AGT-07, CON-03 |
| **P0** | Full design artifact/version/review loop | Регистрация HTML/screenshot не заменяет brief→prototype→audit→handoff→live compare | SD-01, SD-02, SD-03, SD-04 → DSN-01, DSN-02, DSN-03, DSN-04, DSN-05, DSN-06, DSN-07, DSN-08, DSN-09, DSN-10 |
| **P0** | Sprut vulnerable dependency workflow | Наличие scanner MCP не даёт trace package→advisory→fixed version→safe tested upgrade | **S6-05, S6-06, S6-07, S6-08** → **SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08** |
| **P1** | Unified search/command palette и session inbox | При множестве проектов/tasks/sessions ручная навигация станет узким местом | **S1-05** → **FND-09** |
| **P1** | Worktree/change-set ownership | Параллельные агенты без изоляции конфликтуют в одном tree | S3-01, S3-02, S8-01 → SCM-03, AGT-01 |
| **P1** | Browser console/network/AX/traces/recorded recipes | Агент иначе повторит текущую ошибку «написал, что работает, хотя live UI сломан» | S2-02, S2-03 → BRW-05, BRW-06, BRW-08 |
| **P1** | Full code edit/search/test/debug loop | Текущий file textarea + PTY не даёт ежедневный IDE workflow | S4-01, S4-02, S4-03 → IDE-01, IDE-02, IDE-03, IDE-04, IDE-05, IDE-06, IDE-07 |
| **P1** | Forge PR review и exact changed-by-agent view | Git diff без hunk guards, PR threads/checks/remote revision недостаточен | S3-01, S3-02, S3-03 → SCM-01, SCM-02, SCM-03, SCM-04, SCM-05, SCM-06 |
| **P1** | Task board/backlog/timeline/remote sync | Простая Task не покрывает требования, decisions и управляемый delivery flow | S5-01, S5-02, S5-03, S5-04 → TSK-01, TSK-02, TSK-03, TSK-04, TSK-05, TSK-06, TSK-07, TSK-08 |
| **P1** | Connection health/capability inspector и project defaults | Несколько clusters/Jenkins/forge spaces нельзя выбирать бесшовно и безопасно без live schema/RBAC | S0-02 → FND-07, CON-01, CON-02, CON-03 |
| **P1** | Database daily workflow | Полностью отсутствует runtime | S7-01, S7-02, S7-03 → DAT-01, DAT-02, DAT-03, DAT-04, DAT-05, DAT-06, DAT-07, DAT-08 |
| **P1** | Operations/CI read→action flows | Полностью отсутствует runtime | S6-02, S6-03, S6-04 → OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06 |
| **P1** | CI nested/parallel DAG, environments и manual gates | Job/run list без фактической pipeline topology скрывает, где идёт работа и где требуется человек | **S6-10** → **OPS-08** |
| **P2** | Scheduled automations/review inbox | Полезно после устойчивых checkpoints, permission policy и dedupe | **S8-06** → **AUT-01** |
| **P2** | Signed plugin/hook packages | Ускоряет расширение, но до policy/signing создаёт новую поверхность риска | **S8-07** → **EXT-01** |
| **P2** | Usage/cost/latency/trace center | Нужен для дешёвых flash models, retries и диагностики, но не раньше core recovery | **S9-03** → **OBS-01** |
| **P2** | GitOps desired/live view | Ценно при работе с OpenShift/K8s, но после read-only cluster и action safety | **S6-09** → **OPS-07** |
| **P3** | Remote workspace/SSH/WSL/dev-container | Полезно, но локальный Windows IDE должен стать надёжным первым | **S4-04** → **IDE-08** |
| **P3** | General vector editor | Code prototypes, tokens и browser verification дают большую часть пользы раньше | **SD-05** → **DSN-11** |
| **P3** | Voice/mobile/cloud agents | Не нужны для заявленного локального personal workbench | optional; отдельное решение и threat model |

## 13. Маппинг разрывов на этапы поставки

| Этап | Что переносится из конкурентного анализа | Что сознательно остаётся за границей этапа |
| --- | --- | --- |
| **S0** | Live capability inspector, multiple connections, credential refs, project/environment bindings | Установка произвольных непроверенных plugins/binaries |
| **S1** | Codex/Claude-like task focus, VS Code-like session hub, original IDE shell, unified status and search | Визуальное копирование любого продукта |
| **S2** | Cursor/Codex-style browser control плюс более строгие refs/trace/live evidence, corporate identity | Копирование cookies/password stores; заявление о поддержке без Windows live test |
| **S3** | Codex/IDE change review, worktrees, full Git/forge/PR workflow | Автоматический destructive Git/merge action без exact target/readback |
| **S4** | VS Code/JetBrains-class edit/search/LSP/DAP/test cycle | VS Code extension binary compatibility и whole IntelliJ embedding |
| **S5** | Jira/Linear-class Task workflow, динамический agent Todo, inbox и evidence gate | Enterprise portfolio/billing/admin parity |
| **S6** | Jenkins, OpenShift/Kubernetes, knowledge и Sprut dependency flows; optional GitOps read-first | Vendor console/plugin UI parity и blind production actions |
| **S7** | DataGrip/DBeaver-class daily DB flow по реально поддержанным engines | Обещание всех engines/features сразу |
| **SD** | Figma/Penpot/Storybook patterns: versioned code prototypes, tokens, review, audit, handoff | Figma trade dress и ранний general vector editor |
| **S8** | Claude/Copilot/Codex-style scoped roles, subagents, memory, compaction, recipes, hooks и automations | Скрытое повышение прав, silent fallback или безграничная параллельность |
| **S9** | Windows packaging, update/diagnostic/usage center, accessibility/performance/license gates | Bundling чужого CLI/assets без явного redistribution right |

## 14. Итог покрытия

Для выбранного developer-agent workbench контура **каждая выявленная конкурентная capability либо связана с существующей/предложенной карточкой и проверкой, либо явно отложена/отклонена с причиной**. Это полнота планирования по выбранному контуру, а не утверждение о полной реализации и не обещание буквального parity.

Самые крупные фактические разрывы сейчас: Design workspace, IDE/LSP/DAP, full Git/forge, Task tracker, Operations/Jenkins, Data workbench, coordinator/recovery и native integration legacy profiles. Единственный заметно продвинутый suite slice — Browser foundation; даже он остаётся незавершённым до live multi-window Windows evidence и полного diagnostics/identity слоя.

Перед закрытием любой строки исполнитель обязан:

1. подтвердить current official source и реальные capabilities подключённого CLI/MCP/API;
2. указать exact plan card и acceptance ID;
3. показать runtime evidence, а не screenshot макета;
4. проверить права на exact dependency/file/asset/version;
5. обновить этот аудит, capability matrix и implementation status одной revision.
