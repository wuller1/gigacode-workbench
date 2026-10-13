# Матрица возможностей конкурентов и целевое покрытие

Срез исследования: **13 октября 2026 года**. Матрица охватывает функции, полезные одному разработчику в GigaCode Workbench. Она не требует копировать интерфейс, код, названия, логотипы или assets продуктов. Для каждого pattern указан наш собственный целевой модуль. Коммерческое администрирование организаций и функции, требующие собственного облака провайдера, отмечены как optional.

Статусы показывают фактическую базу и этап, на котором закрывается оставшийся разрыв; знак `/` объединяет несколько этапов:

- **R** — уже есть работающая основа в `app/`;
- **R+** — текущим срезом исправлена/расширена работающая основа;
- **P0** — инвентаризация, capability discovery и project bindings до миграции;
- **P1…P9** — этап из [`DELIVERY-PLAN.md`](DELIVERY-PLAN.md);
- **SD** — линейка Design & Artifacts `SD-01…SD-05` из машинного плана;
- **O** — optional после основного локального продукта;
- **N/A** — сознательно не переносится.

## Агентский command center

Ориентиры: [Codex app](https://openai.com/index/introducing-the-codex-app/), [Codex developer workflow](https://openai.com/index/codex-for-almost-everything/), [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Cursor agents](https://prod.cursor.com/help/ai-features/agent), [Cursor checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints), [GitHub Copilot custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents), [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [JetBrains Junie](https://www.jetbrains.com/help/ai-assistant/junie-agent.html).

| ID | Возможность, встречающаяся у конкурентов | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-A01 | Проекты с сохранёнными чатами/задачами | `Project → Task → Role/Session`, project home и restore | R/P1 |
| CMP-A02 | Несколько параллельных агентов | bounded coordinator, subagent cards, leases и join evidence | R/P8 |
| CMP-A03 | Изоляция изменений агента | Git worktrees/change sets с явным base и merge/discard | P3/P8 |
| CMP-A04 | Background/long-running tasks | persisted operations, status badges, recovery и cancel | R/P1/P8 |
| CMP-A05 | План перед исполнением | динамический Todo с current/completed/blocked и изменениями плана | R/P5 |
| CMP-A06 | Steer/queued prompts во время работы | умная очередь: steering, follow-up, replace, cancel-after-step | R/P8 |
| CMP-A07 | Вопросы/approvals поверх работы | overlay с вариантами и свободным ответом; resume исходного focus | R |
| CMP-A08 | Side chats/forks | дочерние sessions одной Task, fork context и return link | R/P8 |
| CMP-A09 | Межсессионный обмен | скрытая project-scoped mailbox с refs и audit | R/P8 |
| CMP-A10 | Agent teams/координатор | DAG, roles, dependencies, concurrency limits и conflict control | P8 |
| CMP-A11 | Custom agents/profiles | профиль: prompt, model, reasoning, tools, MCP, permissions, memory, hooks | R/P8 |
| CMP-A12 | Автовыбор профиля | router сам выбирает profile/version из request/project/task/stage/resource context; read-only chip показывает reason/confidence и safe-boundary handoff, ручного picker нет | R/P8 |
| CMP-A13 | Отдельные models/effort на subagent | live capability readback и per-role selection | R/P8 |
| CMP-A14 | Tool allow/deny и permission modes | capability policy, project/env scope и prepared external action | R/P6/P8 |
| CMP-A15 | Auto-review конструктивным критиком | независимый reviewer result, severity/evidence, без fake approval | P8 |
| CMP-A16 | Skills/rules/instructions | user/project skills registry с version/provenance и lazy loading | R/P8 |
| CMP-A17 | Plugins/MCP bundles | plugin/profile package: skills, adapters, prompts, optional hooks | P8 |
| CMP-A18 | Lifecycle hooks | typed declarative events; scripts только в доверенной установке, с логами | P8 |
| CMP-A19 | Memory | global/project/task scopes, provenance, trust, conflict и forget | R/P8 |
| CMP-A20 | Automatic memories | предложения записей с diff/reason; права не запоминаются | P8 |
| CMP-A21 | Checkpoints/rewind | agent-edit checkpoints отдельно от Git; preview и selective restore | P3/P8 |
| CMP-A22 | Context meter/compaction | used/limit/reserve, pinned facts, preview summary и restore revision | R/P8 |
| CMP-A23 | Separate-context research/reviewer | subagent context с bounded result и citations/refs | P8 |
| CMP-A24 | Compact tool calls | collapsed cards: action, target, status, summary; details по запросу | R/P1 |
| CMP-A25 | Markdown/diagrams/math | GFM, code, tables, Mermaid/LaTeX artifacts with safe renderer | R/P1/P8 |
| CMP-A26 | Attach files/images/selected code | typed attachments с immutable snapshot и source revision | R/P2/P4/P8 |
| CMP-A27 | Usage, rate limit и cost visibility | provider/model counters, queue, Retry-After, estimated/actual labels | P8 |
| CMP-A28 | 400/413/429 recovery | normalize HTML/JSON, compact/chunk/reference, fallback и circuit breaker | R/P8 |
| CMP-A29 | Session search/pin/archive/rename/delete | все CRUD, unread/run state, filters и restore | R/P1 |
| CMP-A30 | Share/export session | redacted task package/diagnostics; локальная ссылка и optional share | P8/O |
| CMP-A31 | Scheduled automations | local scheduler, existing-thread continuation и review inbox | P8 |
| CMP-A32 | Proactive suggestions | project/task state based next actions, quiet/dismissable | P8 |
| CMP-A33 | Voice input/readback | OS/approved provider adapter; transcript review | O |
| CMP-A34 | Remote/mobile control | authenticated local/remote control plane, no terminal imitation | O |
| CMP-A35 | Cloud agents | adapter to external runner when available; local remains primary | O |
| CMP-A36 | Personality/tone | communication style separate from capability/permissions | P8 |
| CMP-A37 | Agent doctor/diagnostics | self-check transport, runtime, tools, permissions, performance | P9 |
| CMP-A38 | Reusable commands/workflows | recipe library with inputs, contracts, evidence and versioning | R/P8 |
| CMP-A39 | Self-optimization | agent proposes reusable recipe/profile after repetition, tests before activation | P8 |
| CMP-A40 | Explicit goals/long horizon | Task outcome, milestones, budgets, resume state and completion gate | P5/P8 |

## Desktop shell, IDE и runtime

Ориентиры: VS Code/Monaco/LSP/DAP, JetBrains IDEs/Junie, Codex multiple files/terminals/SSH. Реализация описана в [`UX-FOUNDATION.md`](UX-FOUNDATION.md) и [`IDE.md`](IDE.md).

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-I01 | Activity bar/tool windows | собственный rail + navigator + main + inspector + bottom dock | P1 |
| CMP-I02 | Произвольные splits/tabs/groups | versioned layout tree, drag/drop, resize, maximize, restore | R/P1 |
| CMP-I03 | Command palette/quick open | commands, files, symbols, tasks, resources и recent | P1/P4 |
| CMP-I04 | Несколько terminal tabs/profiles | PTY tabs, shell chooser, split, task ownership и restore marker | R/P1 |
| CMP-I05 | File explorer CRUD | tree, search, new/rename/move/delete/reveal с conflicts | R/P4 |
| CMP-I06 | Multi-editor tabs/splits | Monaco models, preview/pinned/dirty и breadcrumbs | P4 |
| CMP-I07 | Find/replace project-wide | cancellable indexed search, preview replace и exclusions | P4 |
| CMP-I08 | Code intelligence | completion/hover/signature/navigation/references/rename/actions | P4 |
| CMP-I09 | Problems/diagnostics | source/version grouped issues, filters, quick fixes | P4 |
| CMP-I10 | Format/lint/imports | project-owned tools and visible run receipts | P4 |
| CMP-I11 | Run configurations/tasks | named configs, env refs, input, cancel и output | P4 |
| CMP-I12 | Test explorer/coverage | discovery, tree, rerun failed, debug, coverage overlay | P4 |
| CMP-I13 | Debugger | DAP, breakpoints, stack, variables, watches, console | P4 |
| CMP-I14 | Refactoring | LSP/workspace edits with version and project boundary checks | P4 |
| CMP-I15 | Diff/merge editor | two/three-way editor, conflicts, comments | P3/P4 |
| CMP-I16 | Outline/call/type hierarchy | LSP capability-aware navigators | P4 |
| CMP-I17 | Inlay hints/semantic tokens/folding | adapter capability matrix; no dead buttons | P4 |
| CMP-I18 | Local history/checkpoints | document revisions + Git + agent checkpoint, clearly separated | P4/P8 |
| CMP-I19 | Autosave/crash recovery | versioned drafts, external change detection and conflict UI | P4 |
| CMP-I20 | Java | JDT LS, Maven/Gradle, test and Java Debug Server | P4 |
| CMP-I21 | Python | Pyright, Ruff, pytest/unittest and debugpy | P4 |
| CMP-I22 | React/TypeScript | TS server, ESLint/Prettier adapters, browser preview | P4 |
| CMP-I23 | Dev containers/WSL/SSH | remote workspace adapter with explicit host/runtime/paths | P4/O |
| CMP-I24 | Extension/plugin ecosystem | narrow signed Workbench plugin API; no VS Code binary compatibility promise | P8/O |
| CMP-I25 | Settings sync/keymaps | export/import safe preferences, familiar presets and conflict preview | P1/P9 |
| CMP-I26 | Native desktop chrome | custom title bar/window controls/menu inside UI, OS accessibility | R/P1 |
| CMP-I27 | Update channel | check/download/verify/install/rollback states, enterprise-offline option | P9 |
| CMP-I28 | Multi-window ownership | resource leases/transfer with per-window view state | R+/P1 |
| CMP-I29 | Performance tooling | renderer/main/process metrics, profiles and long-session leak checks | P9 |
| CMP-I30 | Logs/diagnostic bundle | correlated main/preload/renderer/CLI/tools, redacted export | R/P9 |

## Browser, визуальное тестирование и Design

Ориентиры: [Cursor Browser](https://cursor.com/docs/agent/tools/browser), встроенный browser Codex, [Figma Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), [Penpot](https://help.penpot.dev/user-guide/), [Storybook testing](https://storybook.js.org/docs/8/writing-tests), [Playwright trace viewer](https://playwright.dev/docs/trace-viewer).

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-B01 | Несколько browser tabs/windows | owner-scoped tabs, stable active/pinned/order и tab groups | R+ / P2 |
| CMP-B02 | Адресная строка/history/reload/stop | compact browser chrome, history suggestions и security origin | R/P2 |
| CMP-B03 | Rename/close/duplicate/reopen/external/fullscreen | icon controls, context menu, shortcuts и closed-tabs history | R/P2 |
| CMP-B04 | Profiles/incognito/proxy | project-bound profiles, isolated partitions и explicit proxy | P2 |
| CMP-B05 | Existing corporate identity | external browser/CDP connector where permitted; no cookie copying | P2 |
| CMP-B06 | Client certificates/auth/SSO | certificate fingerprint refs, OS trust and Windows live checks | P2 |
| CMP-B07 | Responsive device mode | width/height/orientation/DPR/mobile/touch/zoom presets | R/P2 |
| CMP-B08 | Agent navigation/actions | generation-bound semantic refs, click/fill/keys/select/drag/upload | R/P2 |
| CMP-B09 | Auto-waits/assertions | URL/load/visible/text/count/network stability with bounded timeout | P2 |
| CMP-B10 | Screenshots/video/trace | viewport/full/element captures, filmstrip/action trace/evidence | R/P2 |
| CMP-B11 | Console/page errors | filtered/cursored logs tied to navigation/action | P2 |
| CMP-B12 | Network inspector | request timing/headers/body with redaction and HAR-like artifact | P2 |
| CMP-B13 | DOM/AX/element inspect | compact semantic tree, selector/ref, computed/accessibility info | P2 |
| CMP-B14 | Downloads/uploads/dialogs/permissions | visible managed resources and policy decisions | P2 |
| CMP-B15 | Page comments to agent | select point/element/region, screenshot crop and instruction ref | P2/P4 |
| CMP-B16 | Test recorder/recipes | record user actions, normalize refs, replay with assertions | P2 |
| CMP-B17 | Visual regression | expected/actual/diff/overlay with environment metadata | P2/SD |
| CMP-B18 | Browser origin allowlists | per profile/task rules plus backend policy, redirects audited | P2 |
| CMP-D01 | Design brief and flow map | critical analyst pipeline, state/screen inventory | SD |
| CMP-D02 | Responsive artboards | code-prototype canvas with multiple viewports/themes/states | SD |
| CMP-D03 | Layers/pages/components/variants | navigator, component registry and linked implementation | SD |
| CMP-D04 | Tokens/themes/modes | open JSON tokens, light/dark/high contrast and code sync | SD |
| CMP-D05 | Interactive prototypes | links/overlays/transitions/variables/keyboard scenarios | SD |
| CMP-D06 | Version history/compare | immutable versions, overlay/slider/diff and approval | SD |
| CMP-D07 | Comments/annotations | element/version anchored threads and resolution | SD |
| CMP-D08 | Dev inspect/handoff | measurements/tokens/states/assets/interactions/code links | SD |
| CMP-D09 | Accessibility/design audit | contrast, target size, focus, overflow, density and consistency | SD |
| CMP-D10 | Component gallery/stories | states/props/themes/tests, Storybook adapter | SD |
| CMP-D11 | Image/icon generation | original assets with provenance/license and theme variants | SD/P8 |
| CMP-D12 | Vector editor | later scene graph or compatible OSS integration after license audit | SD/O |

## Source control, review и forge

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-G01 | Multi-repository project | explicit root/repository mapping and repository switcher | P1/P3 |
| CMP-G02 | Status grouped by staged/unstaged/untracked/conflict | porcelain-v2 parser and virtualized list | R/P3 |
| CMP-G03 | Inline/side-by-side diff | Monaco diff, whitespace/context controls and binary handling | R/P3 |
| CMP-G04 | Agent change attribution | change sets by task/session/checkpoint with overlap warning | P3 |
| CMP-G05 | Stage/unstage hunks/lines | expected-index guard and patch check | P3 |
| CMP-G06 | Discard/revert/restore | exact impact, dirty-buffer check and recovery | P3 |
| CMP-G07 | Commit composer | message templates, hooks result, amend/sign capability | P3 |
| CMP-G08 | Branch/tag/worktree | create/switch/rename/delete/compare with dirty-state protection | P3 |
| CMP-G09 | Stash/shelf | create/list/preview/apply/pop/drop with conflicts | P3 |
| CMP-G10 | History/blame/file history | graph, filters, commit/file navigation | P3 |
| CMP-G11 | Merge/rebase/cherry-pick | prepared steps, conflicts, continue/abort and reflog recovery | P3 |
| CMP-G12 | Clone/init/remotes | credential refs, progress, cancel and destination validation | P3 |
| CMP-G13 | Fetch/pull/push | explicit remote/refspec, force-with-lease only, unknown reconcile | P3 |
| CMP-G14 | PR create/edit/draft | canonical forge adapter and template | P3 |
| CMP-G15 | PR files/commits/checks | review workspace, annotations and linked CI logs | P3/P6 |
| CMP-G16 | Review comments/threads | add/edit/resolve/reply with remote revision | P3 |
| CMP-G17 | Approve/request changes | capability and self-review policy aware | P3 |
| CMP-G18 | Merge strategies/queue | detected capabilities, exact base/head and result reconcile | P3 |
| CMP-G19 | Forks/workspaces/multiple Bitbucket-like spaces | reusable connections + per-project repo bindings | P1/P3 |
| CMP-G20 | Releases/tags/changelog | release draft and artifacts through forge capability | P3 |

## Tasks, планирование и knowledge

Ориентиры: [Linear docs](https://linear.app/docs), [Jira timeline](https://support.atlassian.com/jira-software-cloud/docs/create-manage-and-visualize-work-on-the-timeline/) и корпоративный knowledge adapter.

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-T01 | Inbox/triage | incoming/local/remote queue with duplicate detection | P5 |
| CMP-T02 | List/board/detail | shared Task aggregate, filters/groups/sort and saved views | P5 |
| CMP-T03 | Backlog/cycles/sprints | rank, capacity, start/complete and carry-over | P5 |
| CMP-T04 | Roadmap/timeline/releases | dependencies/milestones/releases and progress | P5 |
| CMP-T05 | Parent/subtask/relations | blocked/blocking/related/duplicate/caused-by | P5 |
| CMP-T06 | Custom workflows/statuses/fields | schema/versioned transitions and validation | P5 |
| CMP-T07 | Templates | project/global templates for Task/SDD/bug/incident | P5/P8 |
| CMP-T08 | Comments/activity/mentions | typed activity and linked agent/operation evidence | P5 |
| CMP-T09 | Attachments/artifacts | versioned artifacts, preview, provenance and permission | R/P5/SD |
| CMP-T10 | Estimates/time/priority/labels/assignees | configurable fields, optional for personal workflow | P5 |
| CMP-T11 | Bulk actions | preview, permission and partial-result handling | P5 |
| CMP-T12 | Dashboards/reports | cycle time, throughput, blockers, stale work and quality evidence | P5 |
| CMP-T13 | Notifications/inbox | grouped actionable events, mute/snooze and deep link | P1/P5 |
| CMP-T14 | Offline/outbox/conflicts | local-first Task, versioned remote sync | P5 |
| CMP-T15 | Remote tracker sync | canonical adapter with field/workflow mapping | P5/P6 |
| CMP-T16 | Requirements/SDD/acceptance/decisions | critical analyst role and versioned sections | R/P5 |
| CMP-T17 | Agent Todo bound to work | self-updating plan, current animation and evidence links | R/P5 |
| CMP-T18 | Coding session link | branch/worktree/change set/model/status in Task | R/P3/P5 |
| CMP-T19 | Project/initiative health | personal portfolio rollup and risk/stale indicators | P5 |
| CMP-K01 | Spaces/tree/search | multiple knowledge connections/spaces per project | P6 |
| CMP-K02 | Rich page read/edit/draft | safe renderer, local draft and version conflict | P6 |
| CMP-K03 | History/compare/publish | optimistic version and prepared publish | P6 |
| CMP-K04 | Attachments/labels/comments/backlinks | capability-aware knowledge adapter | P6 |
| CMP-K05 | SDD publishing | Task spec → versioned page with source/evidence links | P5/P6 |

## Data workbench

Ориентиры: [DataGrip Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html), [DataGrip query plans](https://www.jetbrains.com/help/datagrip/query-execution-plan.html), [DBeaver Data Editor](https://dbeaver.com/docs/dbeaver/Data-Editor/) и [DBeaver diagrams](https://dbeaver.com/docs/dbeaver/ER-Diagrams/). Полный контракт — [`DATABASE.md`](DATABASE.md).

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-DB01 | Multiple connections/environments | project bindings, colors/badges, vault and SSH/TLS refs | P7 |
| CMP-DB02 | Driver management | signed/versioned driver hosts in utility processes | P7 |
| CMP-DB03 | Database/schema/object explorer | lazy metadata, search/filter/favorites and refresh | P7 |
| CMP-DB04 | Object details/DDL/dependencies | source, properties, grants, stats and links | P7 |
| CMP-DB05 | SQL consoles/files/scratch | Monaco dialect, connection/schema/transaction binding | P7 |
| CMP-DB06 | Completion/navigation/format | metadata-aware SQL language adapter | P7 |
| CMP-DB07 | Parameters/multiple result sets/messages | typed inputs, grids and diagnostics | P7 |
| CMP-DB08 | Result grid/filter/sort/group | server/client modes, virtualization and value inspector | P7 |
| CMP-DB09 | Editable data | key-aware changes, preview, transaction and conflict checks | P7 |
| CMP-DB10 | Transactions | auto/manual, savepoint, commit/rollback and unknown state | P7 |
| CMP-DB11 | Query history/favorites/templates | redacted bounded history and reusable parameterized queries | P7 |
| CMP-DB12 | Explain/analyze/flame/tree | capability-aware plan visualizer and warnings | P7 |
| CMP-DB13 | Import/export/data transfer | streaming CSV/JSON/XLSX where supported, mappings and preview | P7 |
| CMP-DB14 | Schema compare/migration | snapshots, dependency ordering, editable SQL and review | P7 |
| CMP-DB15 | ER diagrams | searchable relation graph, custom layout and export | P7 |
| CMP-DB16 | Sessions/locks/long queries | monitor, inspect and prepared cancel/terminate | P7 |
| CMP-DB17 | Backup/restore/native tools | visible external tool configs and operation receipts | O |
| CMP-DB18 | Agent DB tools | bounded schema/query refs and prepared mutations | P7 |
| CMP-DB19 | DB test fixtures | disposable local databases and deterministic contract tests | P7/P9 |
| CMP-DB20 | Cross-connection compare | metadata/data sample comparison with explicit sources | O |

## Operations, CI и observability

Ориентиры: [Headlamp](https://headlamp.dev/docs/latest/), [Headlamp activity model](https://kubernetes.io/blog/2026/01/22/headlamp-in-2025-project-highlights/), [OpenShift console](https://docs.redhat.com/en/documentation/openshift_container_platform/4.16/pdf/web_console/OpenShift_Container_Platform-4.16-Web_console-en-US.pdf), [Lens docs](https://docs.lenshq.io/), Jenkins Remote API и Argo CD patterns.

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-O01 | Multiple clusters/contexts/namespaces | reusable connections, project environments and pinned targets | P1/P6 |
| CMP-O02 | Overview/health/warnings/quotas | lazy environment home and stale/live labels | P6 |
| CMP-O03 | Resource explorer/YAML/details | discovery-driven kinds, virtualized list and sanitized viewer | P6 |
| CMP-O04 | Ownership/topology map | resource relations, workload/service/route/build links | P6 |
| CMP-O05 | Events/conditions/history | correlated timeline and filters | P6 |
| CMP-O06 | Logs | multi-pod/container, follow, previous, search, download | P6 |
| CMP-O07 | Exec terminal | scoped PTY resource, audit and close/reconnect states | P6 |
| CMP-O08 | Port forward | managed process, collision detection and Browser link | P6 |
| CMP-O09 | Metrics/charts | detected metrics provider, bounded ranges and source labels | P6 |
| CMP-O10 | Rollout/history/scale/restart | prepared action, RBAC, dry-run/readback | P6 |
| CMP-O11 | Edit/apply/delete | server-side validation/diff/revision guard and receipt | P6 |
| CMP-O12 | Secrets safety | metadata by default, values excluded from model/cache/logs | P6 |
| CMP-O13 | OpenShift projects/routes/builds/operators | discovery extensions over Kubernetes adapter | P6 |
| CMP-O14 | GitOps desired/live diff | optional Argo-like adapter, sync/status/history capability | P6/O |
| CMP-CI01 | Multiple Jenkins/folders/jobs | connection/folder bindings and search/favorites | P6 |
| CMP-CI02 | Queue/build/stages | queue→run tracking, plugin capability detection | P6 |
| CMP-CI03 | Parameters/trigger/rebuild | typed form, prepared action and idempotency reconciliation | P6 |
| CMP-CI04 | Progressive logs | cursor stream, search/follow and no duplicate chunks | P6 |
| CMP-CI05 | Tests/artifacts/changes/timings | result explorer and links to commit/Task | P6 |
| CMP-CI06 | Cancel/retry | addressed run, unknown outcome and receipt | P6 |
| CMP-CI07 | CI failure triage | agent summary with exact log lines/test refs and suggested Task | P6/P8 |
| CMP-OBS01 | App log/trace explorer | initial adapter interface; full observability products optional | P9/O |

## Настройки, безопасность и качество desktop-продукта

| ID | Возможность | Решение Workbench | Статус |
| --- | --- | --- | --- |
| CMP-S01 | Multiple MCP endpoints of same type | connection registry, aliases, health, scopes and project bindings | P1 |
| CMP-S02 | Configurable credentials/CA/certs/proxy | credential refs and main-process providers | P1/P6 |
| CMP-S03 | Capability inspector | schemas, hashes, effects, read canary and unavailable reason | P0/P1 |
| CMP-S04 | Profiles/rules editor | visual editor + source view + lint/test/simulation | P8 |
| CMP-S05 | Model/reasoning/context controls | composer controls and per-role defaults from live readback | R/P1/P8 |
| CMP-S06 | Permission/policy editor | actor/capability/project/environment rules and audit | P6/P8 |
| CMP-S07 | Theme/font/density/motion/keymap | system/light/dark, accessible presets and preview | R/P1 |
| CMP-S08 | Backup/export/import/reset | selective safe export, preview, schema migration and rollback | P9 |
| CMP-S09 | Updates/runtime selection | bundled/external CLI status, update channel and health | R/P9 |
| CMP-S10 | Crash reporting | local crash records, consented/redacted export | P9 |
| CMP-S11 | Secret-free logging | central redaction, correlation chain and retention | R/P9 |
| CMP-S12 | Accessibility | keyboard, screen reader semantics, contrast, zoom, reduced motion | P1/P9 |
| CMP-S13 | Localization | UTF-8/Cyrillic paths/text and future locale packs | R/P9 |
| CMP-S14 | Windows integration | custom window chrome, PowerShell 5.1 bootstrap, paths/process trees | R/P9 |
| CMP-S15 | Offline/degraded mode | local tasks/code/artifacts, stale remote caches and recovery | P5/P6/P9 |

## Что сознательно не копируется

- фирменный внешний вид Claude, Codex, Cursor, JetBrains, Jira, Linear, Figma, DataGrip, DBeaver, OpenShift, Jenkins или Bitbucket;
- их логотипы, screenshots, icons, animations, закрытые design tokens и тексты интерфейса;
- облачная инфраструктура и billing конкурентов;
- бинарная совместимость с расширениями VS Code/JetBrains без отдельного доказанного runtime;
- импорт cookies/password databases из Chrome/Edge;
- фиктивные кнопки для capability, которой нет в подключённом CLI/MCP/API;
- автоматическое выполнение production/deploy/DDL только потому, что такой action есть у другого инструмента.

## Как поддерживать матрицу

Перед крупным этапом агент проверяет только официальные источники его области, добавляет новую capability отдельной строкой и связывает её с карточкой/acceptance. Изменение сайта конкурента не является причиной автоматически менять продукт. Pattern переносится, если он сокращает путь пользователя, улучшает контроль или проверяемость и согласуется с локальной архитектурой.
