# Приёмка полного Workbench

## Как использовать критерии

Карточка реализации указывает IDs ниже. Evidence включает команду/среду, ожидаемый и наблюдаемый результат, screenshot либо receipt и точную revision. Unit, fixture, Electron E2E, live corporate endpoint и Windows package считаются разными уровнями доказательства.

### Foundation

- **FND-01:** `Project A → Project B → Project A` восстанавливает Task, workspace, вкладки, layout и target A без смешения ресурсов B.
- **FND-02:** два окна одного или разных проектов получают только адресные resource events; пропуск sequence вызывает snapshot reconcile.
- **FND-03:** панель можно открыть, закрыть, перенести, split/reorder/resize и восстановить; живой resource не перезапускается от layout action.
- **FND-10:** чат, IDE, браузер, задачи, дизайн, эксплуатация, БД и Git открыты одновременно; повторный выбор инструмента фокусирует существующую панель. Перенос мышью к четырём краям/в центр и временное разворачивание сохраняют черновики, выбранные вкладки и остальные панели. Левая полоса возвращает скрытый чат по нажатию и работает с клавиатуры. Подробности: [WORKSPACE-PANEL-LAYOUT.md](WORKSPACE-PANEL-LAYOUT.md).
- **FND-04:** Project/Task/command/workspace/quick-open доступны клавиатурой, focus видим, modal не создаёт trap, reduced motion соблюдается.
- **FND-05:** loading/empty/partial/stale/offline/denied/conflict/error/success имеют различимые состояния и recovery action.
- **FND-06:** zoom 100–200%, 1024–1920px и light/dark не скрывают основной action/target/status.
- **FND-07:** несколько connections одного типа привязываются к проектам и окружениям; alias и полный target видим перед действием.
- **FND-08:** rename/archive/delete/restore Project, Task, Session и reusable connection сохраняют связи либо показывают impact до удаления.
- **FND-09:** unified search находит Project/Task/Session/file/command/resource с типом, scope и безопасным переходом; 50k элементов не блокируют renderer.

### Evidence-first migration

- **MIG-01:** до изменения каждого существующего модуля inventory фиксирует commit/dirty/data/runtime, единственного owner, entry points, working live scenarios и evidence; UI/type/prompt без выполнения не считается `present`.
- **MIG-02:** `reuse/repair/replace` опирается на одни сценарии и сравнительные facts по completeness, steps/time, recovery, accessibility/UX, performance, maintainability и data migration risk; unknown остаётся `audit`.
- **MIG-03:** если существующая реализация materially better и достоинства нельзя объединить, она не меняется: альтернативный candidate готов в изоляции, independent work завершена, а пользователю показан один конкретный выбор с рекомендацией, screenshots/diffs/metrics, impact и rollback.
- **MIG-04:** совместимые преимущества объединяются через reuse/repair/adapter без второго owner и лишнего вопроса; replace имеет failure evidence, backup/migration/rollback и verification на тех же сценариях.
- **MIG-05:** decision/user-choice receipt versioned и привязан к candidate/baseline revisions; отсутствие ответа сохраняет working baseline и не запускает migration.

### Browser

- **BRW-01:** окна A/B с одним project не видят вкладки/события друг друга; навигация B не меняет active A.
- **BRW-02:** фоновые title/loading events, hide/show, drag, maximize и workspace switch не сбрасывают выбранную вкладку.
- **BRW-03:** закрытие фоновой вкладки сохраняет active; закрытие active выбирает предсказуемую соседнюю; порядок стабилен.
- **BRW-04:** одинаковый `requestId` создаёт одну вкладку; разные IDs — две; один artifact `reuseKey` переиспользует preview.
- **BRW-05:** agent click/fill/wait использует generation-bound refs; после navigation старый ref даёт `STALE_BROWSER_REF`.
- **BRW-06:** screenshot соответствует выбранной вкладке/viewport; console/network/page error привязаны к navigation generation.
- **BRW-07:** permissions, downloads, popup, auth, proxy, certificate и external-browser flows проверены без раскрытия секретов.
- **BRW-08:** живой Electron сценарий проходит без промежуточного клика/reload; active tab корректен после смены окна.
- **BRW-13:** личный и агентский browsers имеют независимые tabs/active/history/profile; просмотр не создаёт вкладок и не меняет execution target; скрытие панели и смена проекта не отменяют работу, запоздалое событие не перезаписывает чужой ввод.
- **BRW-14:** агентский present открывает отдельную панель без focus/project/tab stealing; при вводе, диалоге или занятом пространстве предлагает «Показать». Takeover сначала приостанавливает владельца; личный браузер и auth данные не передаются агенту молча.
- **BRW-15:** агентская загрузка привязана к project/task/session/profile/tab и operation receipt; pause/cancel/retry/restart не создают повторных файлов и не переключают личный браузер. Проверены collision/path traversal/Windows names, interruption, lack of range, disk-full, HTML error/login вместо документа, bounded memory для большого файла; исходник неизменяем, progress и ошибка видны пользователю.
- **BRW-16:** скачанный текст открывается для просмотра/редактирования, HTML/SVG не выполняются; preview binary/document зависит от capability. Большие данные читаются страницами/диапазонами, не целиком в prompt. Не поддерживаемое редактирование явно обозначено; никакого скрытого запуска исполняемых файлов.
- **BRW-17:** agent и user используют единый fileId/revision/working copy и conflict protocol; stale patch не перезаписывает новую правку. Save/diff/revert/export/IDE handoff сохраняют исходник; повторное открытие и переименование не теряют IDE draft. Старый callback не меняет иной проект/разговор; обычные разрешённые download/read/edit не требуют нового permission popup. Windows end-to-end: download → read → edit → diff → save → reopen/export с совпадением байтов и журнала.
- **BRW-09:** DevTools привязаны к выбранным tab/profile/navigation: Console, Network, Elements, Sources с breakpoint/step/watch и Performance; resize/maximize/close сохраняют страницу. Native DevTools и агентский CDP используют одного broker; detach не выдаётся за работающее управление.
- **BRW-10:** cookies, HTTP cache и другие storage очищаются отдельными категориями с явным scope/периодом и readback; соседний профиль не затронут, domain-wide cookies не названы origin-only, unsupported granularity не подменяется глобальной очисткой.
- **BRW-11:** save/update/autofill/never-save проверены на Windows test endpoint; сохранение только после успешной авторизации, совпадают origin/frame/profile. OS-encrypted vault, отказ при недоступном шифровании; секретов нет в prompt/log/export/localStorage. Очистка cookies не удаляет пароли или закладки.
- **BRW-12:** закладки создаются, редактируются, перемещаются в папки, ищутся, экспортируются/импортируются и восстанавливаются после рестарта; повторное открытие того же адреса переиспользует вкладку. Ошибка сохранения отображается явно, malformed import не теряет прежние данные. Панель под адресом показывает ссылки/папки, overflow оставляет все элементы доступными, hide/show и Ctrl/Cmd+Shift+B сохраняют выбор; редактирование из менеджера обновляет ту же запись. Проверить обе темы, узкую панель, Escape/клавиатуру и отдельные stores личного/агентского браузера; просмотр агента не перенаправляет выполнение.


### IDE

- **IDE-01:** editor workers и frontend/backend transport выбранного IDE engine работают в packaged Electron с проверенными origin/CSP/IPC boundaries; для текущего Monaco-варианта — secure app origin и ESM workers.
- **IDE-02:** один документ в двух views имеет одну revision chain; stale edit отклоняется, dirty external change создаёт conflict.
- **IDE-03:** crash draft восстанавливается; EOL/BOM сохраняются; binary/large file не портится.
- **IDE-04:** search/symbol/diagnostic/code action возвращают source/version и поддерживают cancel.
- **IDE-05:** React/TypeScript, Python и Java adapters показывают только фактические capabilities и project toolchains.
- **IDE-06:** run/test/debug processes останавливаются деревом на Windows; output не теряется и не блокирует renderer.
- **IDE-07:** file/range/symbol/diagnostic/test evidence прикрепляется к Task/agent message адресно.
- **IDE-08:** remote workspace всегда показывает execution host/runtime/root; paths и процессы разных hosts не смешиваются, disconnect сохраняет recoverable state.

### Source control and forge

- **SCM-01:** status/diff корректны для rename, untracked, binary, conflicts, spaces/Cyrillic paths, submodules, detached/unborn/worktree.
- **SCM-02:** stage/unstage by hunk проверяет expected index/worktree; discard требует review и не затрагивает dirty editor buffer.
- **SCM-03:** agent change set показывает фактический diff, overlaps, commands/tests и untracked files.
- **SCM-04:** clone/fetch/pull/push показывают connection/repository/remote/branch; неизвестный push сначала reconciles.
- **SCM-05:** PR create/update/review/approve/checks/merge основываются на live forge capabilities и remote revision.
- **SCM-06:** credential/permission/scope одного forge space не переносится в другой.
- **SCM-07:** release/merge queue используют точные repository/base/head/tag, remote revision и readback; недоступная capability не отображается как рабочая.
- **SCM-08:** Git доступен внутри IDE; Code, Review, агент и два окна используют один RepositoryService. Переключение проекта/forge не переносит index, draft commit, stash, dirty buffer и историю чужой рабочей копии.
- **SCM-09:** HEAD, index, сохранённый файл и dirty buffer различаются. Partial stage/commit по строкам и блокам сохраняет остаток; изменение файла после stage не меняет подготовленный снимок. Changelists — метаданные IDE, не второй index. Amend заменяет HEAD, не дублирует файлы.
- **SCM-10:** Stash, Shelf и Local History имеют раздельные модели; точный patch/base/index и untracked files восстанавливаются без потерь. Apply сохраняет запись, pop удаляет только после успешного применения. Конфликт, dirty buffer и stale branch не допускают незаметной перезаписи.
- **SCM-11:** История/selection history/blame/diff, interactive rebase и edit/reword/fixup/squash/drop/split, reset/revert/undo и reflog recovery проверены на реальном Git fixture. Base/ours/theirs/result учитывают семантику merge и rebase; abort/continue восстанавливаются после перезапуска.
- **SCM-12:** Ветки, tags, upstream, multi-root/worktrees, submodules, LFS, sparse checkout, bisect, hooks/signing, patch import/export и настройки покрыты отдельно по [IDE Git parity](IDE-GIT-PARITY.md). Наличие меню не закрывает ни один runtime-критерий.


### Tasks

- **TSK-01:** migration сохраняет существующие Project/Task/Session IDs и rollback; два writers получают conflict вместо lost update.
- **TSK-02:** illegal workflow transition заблокирован одинаково через UI, IPC и agent tool.
- **TSK-03:** list/detail/board/backlog сохраняют rank/filter/selection; drag и keyboard transition эквивалентны.
- **TSK-04:** агент может перестроить Todo с причиной; completed зачёркнуты/приглушены, current выделен с accessible animation.
- **TSK-05:** Done gate проверяет заданные acceptance/evidence; отсутствие evidence видимо, но workflow настраиваемый.
- **TSK-06:** session/commit/PR/build/deployment/query/artifact links открывают правильный объект и возвращают к Task.
- **TSK-07:** 10k tasks и длинный activity log виртуализированы и не блокируют renderer.
- **TSK-08:** remote/local conflict не теряет поля; inbox группирует actionable события, mute/snooze и deep link воспроизводимы.

### Connections and operations

- **CON-01:** изменение MCP schema hash делает затронутый mapping stale и блокирует только вызов, который host больше не может корректно сформировать; остальные capabilities binding продолжают работать, tool annotation не считается доказательством эффекта.
- **CON-02:** secrets отсутствуют в state, renderer, logs, prompt, screenshots и diagnostic export.
- **CON-03:** 400/403/413/429/5xx JSON/text/HTML нормализуются; mutation timeout становится `unknown`.
- **OPS-01:** Kubernetes/OpenShift discovery и RBAC соответствуют live identity; denied action блокируется backend.
- **OPS-02:** list/watch resume и 410 relist не теряют/дублируют resources; cached state явно stale.
- **OPS-03:** apply/scale/restart/delete показывают target+diff, используют expected revision/dry-run и подтверждаются readback.
- **OPS-04:** Secrets не читаются автоматически; logs различают cluster/namespace/pod/container/restart.
- **OPS-05:** Jenkins folders/parameters/queue/runs/progressive logs/tests/artifacts не зависят от несуществующего plugin API.
- **OPS-06:** trigger связывает queue→build→result; потерянный ответ reconciles по correlation, cancel адресен.
- **OPS-09:** избранные Jenkins сохраняются по connection identity и переиспользуются общими проектами; фильтр сочетается с поиском и пространством, звезда не запускает сборку, пустые состояния различаются, focus/scroll сохраняются.
- **OPS-07:** GitOps desired/live revision, drift и health имеют точный source; sync требует capability/RBAC/target review и подтверждается readback.
- **OPS-08:** CI graph сохраняет stable stage IDs, parallel/nested/matrix structure, agent/environment и live state; approval показывает submitter/target/input, а retry/restart адресует точный run/stage.
- **KNW-01:** search/pagination/version conflict/attachments работают; remote HTML sanitised; SDD publish сохраняет page/version ID.

### Data

- **DAT-01:** native drivers изолированы от renderer/main loop; авария одного connection не рушит приложение.
- **DAT-02:** query parameters, cancellation, row/byte/time limits и paging не смешивают datasource/schema/transaction.
- **DAT-03:** write/DDL показывает connection/database/schema, transaction mode, statement class и expected impact; readback подтверждает результат.
- **DAT-04:** unknown commit/timeout не повторяется; UI сохраняет transaction state и предлагает reconcile/close.
- **DAT-05:** grid virtualizes large results, сохраняет NULL/type/binary/timezone semantics; export streaming и formula-injection safe.
- **DAT-06:** data editing использует PK/unique locator и optimistic predicate; affected rows != 1 создаёт conflict.
- **DAT-07:** schema diff/migration order учитывает dependencies; generated SQL редактируем и запускается только через обычный review path.
- **DAT-08:** agent получает bounded schema/query evidence, secret-free DSN refs и не выполняет raw mutation без prepared action.

### Design and artifacts

- **DSN-01:** агент из Task создаёт brief, state matrix и runnable prototype; после перезапуска все версии и links доступны.
- **DSN-02:** preview не имеет Node/preload/privileged IPC и не выходит из разрешённой навигации.
- **DSN-03:** artboards 320–1920px, light/dark и long/error/loading states проверяются одной matrix run.
- **DSN-04:** комментарий привязан к version/element; новая версия не уничтожает историю и resolved state.
- **DSN-05:** compare показывает baseline/actual/diff и не принимает новую baseline без явного review action.
- **DSN-06:** contrast/focus/keyboard/overflow/target-size failures воспроизводимы и ведут к точному element ref.
- **DSN-07:** handoff содержит tokens, states, interactions, assets/provenance и implementation acceptance без скрытого remote dependency.
- **DSN-08:** живое приложение проверяется рядом с approved design; screenshot success без behavioral scenario не закрывает Task.
- **DSN-09:** каждый asset имеет provenance/license; repository scan не находит скопированных vendor icons/screenshots.
- **DSN-10:** 200 artboards/versions и крупные screenshots не блокируют renderer благодаря thumbnails/virtualization/lazy loading.
- **DSN-11:** vector import/export сохраняет geometry/tokens/provenance; несовместимые features видимы, сторонний код и assets проходят exact-version license review.

### Corporate UI kit

- **UIK-01:** core + light/dark/high-contrast DTCG sources имеют одинаковые semantic paths; unresolved alias останавливает CI.
- **UIK-02:** component catalog показывает фактический maturity/status; `specified` component не маркируется ready/stable.
- **UIK-03:** gallery воспроизводит declared variants/states/viewports/themes и связывает fixture с source/tests/version.
- **UIK-04:** каждый icon/asset имеет origin/license/hash; scan не находит незарегистрированных или vendor/Sber/competitor assets.
- **UIK-05:** 1024/1440 и 200% zoom сохраняют selection, главное действие и agent lifecycle без горизонтального page overflow.
- **UIK-06:** binding работает с несколькими forge/package spaces, хранит secret refs вне repository/renderer/model и разрешает central capability disable.
- **UIK-07:** publish требует protected review/check policy, immutable digest, changelog/migration, SBOM, signature/provenance и readback verification.
- **UIK-08:** `canary → next → stable` продвигает тот же digest; production lockfile не меняется по channel автоматически.
- **UIK-09:** consumer view показывает pinned/available/compatibility и создаёт reviewable update PR с migration/tests.
- **UIK-10:** Design/Kit agent surface восстанавливает active Session/operation и явно проходит proposal/preview/execute/result/verify/evidence/reconcile.
- **UIK-11:** bound normal capabilities не создают per-call permission modals; centrally disabled capability остаётся видимой с причиной.
- **UIK-12:** reference source проходит type/catalog checks; stable promotion дополнительно требует unit/interaction/a11y/visual/metrics/consumer/supply-chain evidence.
- **UIK-13:** composer bottom row различает requested/actual model и reasoning, показывает context, AI-selected role и branch; при 1024 px Send/Stop не уходит за пределы области.
- **UIK-14:** role router объясняет factors/confidence и pending safe-boundary handoff, не имеет manual selector, сохраняет Task/Todo/context/artifacts/evidence и не меняет capabilities.

### Dependency security

- **SEC-01:** dependency finding сохраняет lockfile/SBOM revision, direct/transitive paths и не дублирует один advisory.
- **SEC-02:** недоступный Sprut или неполный ecosystem показывает unknown/partial, а не нулевое число уязвимостей.
- **SEC-03:** affected version, package presence и reachability отражаются отдельно; неизвестное не становится фактом.
- **SEC-04:** upgrade proposal содержит источник fixed version, compatibility impact, lockfile diff и targeted tests.
- **SEC-05:** finding закрывается на новой revision после resolve/tests/re-scan; ambiguous mutation не повторяется.
- **SEC-06:** suppression имеет owner/reason/scope/expiry и возвращается на review при expiry/advisory change.
- **SEC-07:** registry secrets и закрытые данные согласно policy отсутствуют в prompt/export/diagnostics.
- **SEC-08:** JSON/text/HTML/429/timeout ошибки Sprut нормализуются без fake success.

### Lifecycle and settings

- **LFC-01:** rename/archive/restore Project, Task и Session сохраняют IDs/links и переживают reload.
- **LFC-02:** delete preview показывает impact и pending effects; внешние объекты не удаляются неявно.
- **LFC-03:** Settings показывает effective value/source/scope и реальную границу применения.
- **LFC-04:** несколько connections одного типа и project bindings восстанавливаются без silent target fallback.
- **LFC-05:** secrets отсутствуют в renderer/state/log/export/prompt; canary не считается mutate verification.
- **LFC-06:** custom title bar сохраняет Windows drag/double-click/minimize/maximize/restore/close и accessibility.
- **LFC-07:** panel drag/dock/resize/hide/restore не перезапускает resource и не возвращает удалённые вкладки.
- **LFC-08:** diagnostic bundle восстанавливает correlation chain, redacts known-bad fixtures и остаётся bounded.

### Orchestration and resilience

- **AGT-01:** subagents имеют ownership/leases, bounded parallelism, status и join evidence; conflicting writes сериализуются.
- **AGT-02:** same-project messages адресны и восстанавливаются; cross-project обмен требует явной scoped link.
- **AGT-03:** context budget показывает used/limit/reserve; compaction имеет preview, pinned facts, summary revision и restore point.
- **AGT-04:** 413 compact/chunk/reference recovery не теряет Task; 429 следует Retry-After/backoff; 400 не повторяется вслепую.
- **AGT-05:** model/reasoning доступны по live config readback; fallback фиксируется, а не подменяется скрытно.
- **AGT-06:** reusable recipes/snippets имеют owner, version, provenance, tests и ограниченный scope; самооптимизация не повышает права.
- **AGT-07:** restart восстанавливает checkpoint/todo/resources и не повторяет неизвестную внешнюю операцию.
- **AGT-08:** создание/запуск/queue/pause/resume/stop/retry/reconcile managed worker проходят через host Scheduler/AgentTask API и доступны из UI; ручной CLI spawn или prompt-команда не засчитываются.
- **AGT-09:** durable outbox адресует assignment/session/generation и дедуплицирует два окна/reload; `next`, verified `steer`, question answer и coordinator handoff имеют разные receipts, возможный dispatch становится `unknown` без replay.
- **AGT-10:** общий provider/project budget, bounded active/queued/depth, fair admission, DAG и lease/fencing выдерживают restart; истёкший lease не запускает конфликтующего writer, 429 соблюдает `Retry-After`/backoff/circuit без fan-out fallback.
- **AGT-11:** каждый child показывает requested→actual model/reasoning и автоматически выбранную role/version/reason; смена настроек применяется только следующему safe attempt и не расширяет project binding.
- **AGT-12:** панель Исполнители показывает dependencies, state/current step, hold/retry reason, budget, lease/scope, result/evidence и join. Pause не маскирует running turn, Stop ждёт terminal boundary, Retry доступен только по классифицированному пути.
- **AGT-13:** coordinator routes addressed messages, принимает immutable candidate envelope, защищает conflicting writers, выполняет join и tests на интегрированных байтах; completed child сам не завершает parent.
- **AGT-14:** crash/restart восстанавливает assignments, queue/outbox, reservations, attempts, leases, pending questions/results и unknown effects; старые generation/callbacks отвергаются, возможный внешний effect сначала reconciles и не повторяется.

### Agent question queue

- **QST-01:** host хранит durable ordered queue по `(taskId, sessionId)` с `questionId`, `revision`, monotonic sequence и не более чем одним active head; Task/Session switch, второе окно и новый event не меняют head или порядок скрытно.
- **QST-02:** active overlay показывает одну bounded card без scrolling/stack, reason/impact, choices и всегда freeform; выбор не отправляется до explicit confirm, close/Escape/minimize сохраняют draft, после durable answer receipt последовательно открывается следующий вопрос.
- **QST-03:** answer command содержит unique operation ID и expected question revision; double click/reconnect возвращает тот же receipt, concurrent answer или stale revision отклоняется с сохранением draft для явного переноса.
- **QST-04:** answer доставляется только сохранённому origin assignment/attempt/session/generation/callback; смена активной Session не меняет адрес, late generation отвергается, возможная доставка остаётся `unknown` без автоматического replay.
- **QST-05:** defer сохраняет draft/reason/not-before и следует явному правилу очереди; cancel разрешён только cancellable question; expiry не выбирает default/recommended option и не снимает обязательный blocker.
- **QST-06:** renderer/app restart восстанавливает queue head/order, drafts, answer receipts и pending delivery; два окна видят один authoritative state и не активируют разные вопросы одной Task/Session.
- **QST-07:** только валидный typed `user_blocker_question` может войти в пользовательскую очередь; hidden coordinator↔worker/session traffic, tool output, document quote и обычный model text никогда не превращаются в вопрос автоматически.
- **QST-08:** overlay сохраняет keyboard focus/return, accessible name и главное действие при 1024px/200% zoom; Task switch скрывает чужой вопрос и при возврате восстанавливает его draft, не создавая отдельную Questions panel.

### Roles and interaction

- **ROL-01:** instruction manifest содержит version refs, delivery mode и actual binding; роли соседних Task изолированы.
- **ROL-02:** analyst на противоречивом brief фиксирует conflict/unknown/options; SDD имеет двустороннюю traceability.
- **ROL-03:** router автоматически выбирает роль из request/Project/Task/stage/resource context, показывает reason/confidence и применяет captured binding на safe boundary, сохраняя Task/Todo/queue/artifacts.
- **ROL-04:** model/reasoning показывают requested/actual; unsupported значение не выглядит применённым.
- **ROL-05:** fast workflow не запускает полный ceremony, а strict не пропускает impact/rollback/evidence.
- **ROL-06:** queue, steering и question callback различаются; reload не отправляет pending input повторно.
- **ROL-07:** memory import имеет preview/provenance/scope и не переносит секреты/догадки как факты.
- **ROL-08:** docs/retro используют diff и structured evidence; known-bad fixture ловит ложный pass.
- **ROL-09:** 400 JSON/text/HTML, 413, 429 и ambiguous timeout имеют разные bounded recovery paths.
- **ROL-10:** независимые workers параллельны, conflicting writers защищены, parent ждёт join и общую проверку.
- **ROL-11:** bundled catalog содержит ровно 14 уникальных profile ID; для каждого существуют валидные profile, GigaCode adapter и capability entry, а все role references в workflows разрешаются. Активной считается только captured version с binding/delivery receipt.
- **ROL-12:** в composer и child controls нет ручного profile selector; role chip read-only показывает selected/captured/actual, reason/confidence/evidence. Изменение цели пересчитывает роль, смена роли не меняет permissions, model или reasoning.

### Central execution policy

- **POL-01:** новый Project binding получает default `auto_allow_bound`: все обнаруженные и привязанные read/write/destructive capabilities доступны без per-call MCP/tool permission dialog.
- **POL-02:** Session и subagent захватывают одну effective policy revision; child не расширяет resource/environment scope, а смена роли не требует нового разрешения и не урезает набор tools.
- **POL-03:** central disable connection/capability/environment или target rule блокирует новые dispatch во всех исполнителях; уже отправленная mutation получает result/reconcile и не повторяется.
- **POL-04:** каждая операция записывает actor/session-or-child, connection, exact target, effect, policy revision, fingerprint, external ID, result и verification; inline preview не требует подтверждения.
- **POL-05:** `established_strict` добавляет impact/dry-run/tests/rollback/readback/evidence как workflow gates без цепочки approval popups; `personal_fast` сохраняет достаточную проверку результата.
- **POL-06:** target вне Project binding показывает одно действие настройки binding без временного bypass; OS/provider login или certificate prompt различается с собственным permission UI приложения.

### Agent control surface

- **ACS-01:** во всех workspace видны Project/Task/Session/Role, requested→actual model/reasoning и run state; смена workspace не меняет Session, а смена Task не подменяет её молча.
- **ACS-02:** `Attach current` для каждого workspace создаёт typed ref с target/revision; stale/missing/conflict виден, а ресурс другого окна/проекта не прикрепляется неявно.
- **ACS-03:** composer различает next/steer/question/stop; queue переживает reload, а two-window dispatch не создаёт дубль.
- **ACS-04:** operation переживает renderer/app restart и имеет наблюдаемые proposal/prepare/execute/stream-or-result/verify/evidence/reconcile phases с одним operation ID.
- **ACS-05:** configured Project binding даёт Session/subagents все его capabilities без per-call MCP permission modal; child не расширяет scope, а central disable блокирует новые dispatch и фиксируется в audit.
- **ACS-06:** destructive operation показывает exact target, diff/SQL/parameters, impact и recovery inline; при разрешённом binding strict gates выполняются в workflow без repetitive approval dialog.
- **ACS-07:** timeout/lost response после possible effect даёт `unknown`; исходная mutation не повторяется, reconcile восстанавливает outcome по authoritative identity/revision либо честно оставляет unknown.
- **ACS-08:** два окна/сессии не смешивают selection, drafts, events и operation targets; same-session outbox и writer lease предотвращают duplicate turn/conflicting writer.
- **ACS-09:** Data recipe перед dispatch показывает connection/database/schema/query revision/class/limits, возвращает typed bounded result, выполняет result/readback validation и сохраняет secret-free evidence; write/DDL unknown не retry-ится.
- **ACS-10:** Chat, Tasks, Browser, IDE, Git/PR, Jenkins, Kubernetes/OpenShift, Docs, Data и Design имеют capability-aware recipes и один lifecycle/target/evidence UX; недоступная capability не выглядит исполненной.
- **ACS-11:** surface полностью доступен с клавиатуры/screen reader, не теряет target/status/send при 1024px и 200% zoom, а progress не засоряет live region.
- **ACS-12:** context meter показывает effective budget/reserve до dispatch; attachments bounded, compaction имеет preview/checkpoint, а 413 recovery не теряет operation records и не повторяет external effect.
- **ACS-13:** нижняя строка composer во всех workspace показывает model, reasoning, context, автоматически выбранную role с reason/confidence и branch/worktree; role не имеет ручного selector, а переход workspace не меняет captured values.

### Automation and extensions

- **AUT-01:** schedule/trigger, project/task/profile/model, permissions и next run сохранены; один fire создаёт один run, restart не дублирует его, результат попадает в review inbox.
- **EXT-01:** plugin показывает origin/version/signature/tools/permissions; hook имеет typed event, timeout и receipt, не повышает права профиля.

### Observability

- **OBS-01:** provider usage, retry/fallback и latency помечены measured/estimated; correlation trace восстанавливает путь без secrets или raw corporate payload.

### Release

- **REL-01:** clean install/update/uninstall NSIS и portable проходят на Windows; пользовательские данные и rollback проверены.
- **REL-02:** bundled CLI содержит runtime/manifest/license, но не auth/config/history/credentials и не зависит от installed CLI.
- **REL-03:** installer, packaged app и текущий source commit проходят unit, build, modal UI, smoke, multi-window и targeted live checks.
- **REL-04:** SBOM/NOTICE/licenses проверены; icons/illustrations оригинальны либо имеют совместимую лицензию и attribution.
- **REL-05:** diagnostic bundle восстанавливает correlation chain и состояние без secrets/raw corporate data.

### Полный целевой объём IDE и Data

- **IDEX-01:** Документы и редактор: Изменение с диска при dirty buffer даёт конфликт, история восстанавливает точный текст.
- **IDEX-02:** Навигация и поиск: Межфайловый поиск/замена с preview и отменой; structural search не выдавать за regex.
- **IDEX-03:** Семантические рефакторинги: На каждом языке прогнать fixtures с конфликтами имён; после правки compile/tests, undo возвращает исходное.
- **IDEX-04:** Java и корпоративные frameworks: Реальный multimodule Spring fixture: configuration navigation, endpoint discovery, тест и debug; unsupported features видны по capability.
- **IDEX-05:** Python: Venv и окружение запусков согласованы; тест/отладка/навигация проекта; notebooks проверять отдельным adapter fixture.
- **IDEX-06:** React и web: Breakpoint в исходном TSX соответствует реальному browser stack; rename не ломает импорты workspace.
- **IDEX-07:** Запуск и тесты: Остановка завершает дерево процессов; результаты обновляются без клика; покрытие привязано к revision.
- **IDEX-08:** Отладка: Каждая заявленная DAP capability проверена настоящим adapter; reconnect не создаёт двойную debug session.
- **IDEX-09:** Профилирование: Захват реального профиля, просмотр горячего пути и переход в код; отсутствие данных обозначено, метрики не выдуманы.
- **IDEX-10:** API и deployment workflow: Запрос с параметрами из среды и тест ответа; секреты скрыты, target не меняется при переключении проекта.
- **IDEX-11:** Git, агент и совместная работа окон: Агент и два окна редактируют один buffer без потери чужих изменений.
- **IDEX-12:** Удалённая разработка и расширения: Remote debugger и filesystem используют правильный host; расширение не обещает совместимость с произвольным JetBrains/VS Code plugin.

Дополнительные обязательные сценарии IDE — [IDE-LANGUAGE-WORKFLOWS](IDE-LANGUAGE-WORKFLOWS.md) и [IDE-EXTENSIONS-AND-EXPLORER](IDE-EXTENSIONS-AND-EXPLORER.md). Они уточняют те же критерии, не заменяют их зелёными fixture-проверками:

- **IDEX-02/03:** массовое переименование и перенос показывают конкретные пути и semantic edits до применения; Windows case-insensitive collisions, путь-файл вместо папки, изменившийся buffer и другой project owner останавливают применение. Undo сохраняет buffers/tabs/breakpoints и не повторяется как скрытый Redo. Файловая операция и rename symbol обозначены отдельно.
- **IDEX-04/07:** Maven reactor/modules/goals/effective POM/dependency conflicts, wrapper, offline/reimport, раздельные Maven и Spring profiles. Spring Boot start/stop/restart, source navigation по beans/mappings/config и отдельное подтверждение live endpoints. Явный запуск тестов не подавляется флагом skipTests, выбранным для сборки.
- **IDEX-05/06/08:** одинаковое окружение для диагностики, запуска и debugger; current-project TS и source maps; параметризованные pytest IDs; изменение исходника делает прежние test/coverage results устаревшими. Debug target не следует за активной вкладкой, удалённый исходник не заменяется другим.
- **IDEX-01/11:** async completion сохраняет focus/caret черновика терминала/поиска и подсветку редактора; закрытие последнего файла оставляет доступ к Stop, среде и результату фонового запуска. Компактные папки остаются закрытыми после перерисовки; размеры проводника/результатов меняются мышью и клавиатурой.
- Дополнение к **IDEX-12**: на Windows подтвердить installation → activation → реальную заявленную функцию → update/rollback → host restart для каждой выбранной версии extension. Open VSX metadata, наличие лицензии или запись в плане установки не являются доказательством совместимости. Проверить VSIX paths/limits, dependency conflicts, настройку registry и отсутствие токенов в логах. До этих проверок S4-00 и последующие extension-работы остаются planned.
- **DATX-01:** Подключения и драйверы: Общее подключение к двум проектам сохраняет разные database/schema/session scopes.
- **DATX-02:** Каталог объектов: Partial introspection различается с пустым каталогом; metadata соответствует версии сервера.
- **DATX-03:** SQL intelligence: Corpus каждого диалекта: quoted identifiers, CTE, temp objects и routine body; ошибки parser не приводят к выполнению другого SQL.
- **DATX-04:** SQL файлы и offline schemas: После перезапуска file-to-target binding сохраняется; offline metadata отмечена timestamp/revision.
- **DATX-05:** Исполнение и транзакции: Disconnect mid-commit остаётся unknown до сверки; mutation не повторяется автоматически.
- **DATX-06:** Просмотр и правка данных: BIGINT/decimal/NULL/timezone round-trip; stale row конфликт; нет stable identity — нет притворной правки строки.
- **DATX-07:** Сравнение и синхронизация данных: Два набора с duplicate/null keys: не неверный update; apply только выбранных изменений, отчёт частичного результата.
- **DATX-08:** Структура и миграции: Rename не угадывается как факт; повторный diff стабилен; nontransactional DDL отражён честно.
- **DATX-09:** Планы и производительность: ANALYZE явно выполняет запрос; unsupported metrics отсутствуют; cancel не объявляет серверную операцию завершённой без результата.
- **DATX-10:** Диаграммы и моделирование: Composite/cross-schema FK верны; виртуальные связи отделены от серверных.
- **DATX-11:** Импорт, экспорт и файлы: Round-trip данных по типам, большие файлы без OOM; formula cells не исполняются при просмотре.
- **DATX-12:** Vendor/admin tools: На каждом engine capability отдельно; restore target показан и проверен, driver/tool version и результат сохранены.
- **DATX-13:** Разные engine families: Для каждой заявленной СУБД отдельный live suite; generic JDBC/MCP connection не означает полную поддержку.
- **DATX-14:** Агент и восстановление: В двух проектах и окнах нет чужих результатов, утечки секретов или повторного исполнения запроса.

### Автоматические названия

- **TSK-09:** ИИ создаёт название по подтверждённой цели и обновляет только при её существенном изменении; история и поиск по прежним названиям доступны. CAS отвергает устаревший результат, ручное название не перезаписывается; сбой генератора не блокирует задачу. Проверить два проекта/окна, быстрые уточнения, restart, malformed model output и реальный title generation.

### PostgreSQL и developer integrations

- **PGX-01:** Реальные PostgreSQL JDBC/MCP transfers: CSV/XLSX через COPY FROM STDIN, CSV/XLSX/SQL export и SQL import через отдельный runner, 10 GB fixture с bounded memory, fidelity round-trip, отмена/rollback, disk-full, commit unknown, Excel sheet limits.
- **FGX-01:** Через корпоративный MCP clone в нужный filesystem host, push/PR/inline review/approve/unapprove/request changes/merge по capabilities; stale reviewed SHA и unknown outcome исключают незаметное повторение side effects.
- **TRX-01:** Developer workflow трекера от поиска и назначения до transitions/review/закрытия, required/custom fields, attachments/history/time tracking и связи PR/build; partial remote mutation и conflict сохраняют контекст задачи.

### OpenShift/Kubernetes console scope

- **KUX-01:** Полные topology/deploy/network/storage/access/observability/build/operator/admin workflows имеют отдельные capability/evidence записи; нет подмены специальной функции универсальным YAML editor.
- **KUX-02:** ДЕВ/ИФТ работают одновременно с captured target; равные namespace/resource names не смешиваются; inventory реально установленных console plugins сопоставлен с MCP/API и UI, пробелы остаются открытыми до реализации/согласования.
- **KUX-03:** EnvoyFilter и DestinationRule явно доступны в Service Mesh для Kubernetes и OpenShift: discovery версий/прав, list/detail/YAML, специализированный draft/diff, apply/readback/delete с captured target; CRD missing, Forbidden, readonly, конфликт resourceVersion и неизвестный исход различаются. Проверки не теряют неизвестные поля YAML и не предлагают workload-действия для этих CRD; нужны раздельные evidence обеих платформ.

## Анимации ВАРМ — FND-11

**FND-11:** `always` (по умолчанию) сохраняет авторское движение независимо от ОС; `system` следует её signal; `reduced` выключает движение явно. Отключённые CSS animations не останавливают совместимые индикаторы работы и курсор. После завершения шага, скрытия/удаления поверхности scheduler освобождает targets. Сохранение, смена темы/окна, interrupted cursor move, refresh и восстановление проверяются отдельно. Методика и ограничения: [REMOTE-DESKTOP-MOTION](REMOTE-DESKTOP-MOTION.md). Локальный HTML не закрывает live Electron/Windows/ВАРМ acceptance.

### Цвета Git в проводнике IDE

Дополнение к **IDEX-01** и **SCM-08**: цвет имени берётся из общего Git snapshot для текущего repository/worktree; modified синий, added зелёный, untracked коричневый, renamed бирюзовый, ignored оливковый, conflict красный. Dirty-буфер обозначается отдельно. Неизвестное/устаревшее состояние не объявляется clean. Индекс и working tree не смешиваются, конфликт имеет приоритет. Проверить темы/контраст/выбранную строку, tooltip и текстовые маркеры, commit/stash/refresh без потери focus или выделения файлов.

### Глубина IntelliJ Ultimate и выбор IDE engine

Матрица [IDE-ULTIMATE-PARITY](IDE-ULTIMATE-PARITY.md) задаёт отдельные acceptance units; [fixture pack](../../suite/ide-engine-fixtures.json) различает core spike, depth probes и later acceptance. Ниже групповые gates существующих карточек. Unsupported на probe допустим только как зафиксированный пробел; он не закрывает позднюю приёмку этой capability. Не подменять live engine/Windows evidence макетом.

- **IUQ-00:** S4-00 сравнивает current-engine/Theia/Code-OSS на IEF-01…08; фиксирует engine/API/package/SDK/OS versions, hashes/licenses, actual functions, recovery и measurements. IUP-001…008 получают факты; depth probes IEF-09…18 — supported/partial/unsupported и gap owners; IEF-21 условно проверяет официальный IntelliJ Java/Kotlin backend, activation/expiry, single-backend/multi-window и отдельный test adapter. Отсутствие его лицензии не блокирует OSS вариант. ADR выбирает engine/document authority и migration/rollback по сравнению, не по названию или metadata. Существующий существенно лучший вариант сохраняется до конкретного выбора пользователя.
- **IUQ-01:** S4-01 закрывает IUP-009…016: один authority для UI/extensions/agent, multi-root/index state, BOM/CRLF, large/binary files, dirty external conflict, stale edit rejection и crash drafts. Два окна, restart и undo проверяются по фактическому тексту и revisions.
- **IUQ-02:** S4-02 закрывает IUP-017…028: desktop explorer/editor groups, search/history/templates/settings/keymaps/theme; hidden/moved panels не теряют selection, focus, dirty text и процессы. Проверить mouse/keyboard, light/dark, 1280×720/1920×1080, split/narrow panel, отсутствие лишних headers и мобильных modal CRUD; IUP-151 проверяет read-only import/mapping старых настроек без потери unsupported fields.
- **IUQ-03:** S4-03 отдельно проверяет все принадлежащие карточке строки матрицы: Java multimodule Maven/Gradle, JDK/server-runtime separation, generated code; Python venv/lint/tests/debug; React/TS monorepo/tests/source maps; actual run/test/coverage/DAP. Успех одного языка не закрывает остальные, mixed JVM/notebook/advanced-debug capabilities имеют собственные evidence или остаются открытыми.
- **IUQ-04:** S4-04 проверяет IUP-137…142 на точных local/remote hosts и Windows corporate fixture: proxy/CA/offline, SSH/containers/cluster mapping, extension placement, host reconnect, несколько фоновых проектов и ВАРМ/resource measurements. Remote unavailable не заменяется тихим local run.
- **IUQ-05:** S4-05 проверяет IUP-029…049: semantic reference sets, rename/move/extract/signature/safe-delete, hierarchy/structural search/inspections и batch preview. Collision, dirty/stale files и uncertain dynamic references показаны; apply/undo, compile и tests подтверждены. Regex/text model output не выдаётся за semantic engine. IUP-148/150 отдельно проверяют source-linked UML и dependency/cycle/architecture rules.
- **IUQ-06:** S4-06 проверяет собственные строки Spring/JPA/Python/frontend/API: negative injection/config/query/template cases, framework navigation, ORM/project-classpath console, runtime inspection, HTTP/GraphQL/gRPC/WS. SQL success не доказывает JPQL/HQL/JPA; обычный DAP не доказывает Spring debugger. IUP-147 проверяет injection offsets/escaping и обратное применение edits. Для license/custom-required gaps остаются явные owners и открытый статус.
- **IUQ-07:** S4-07 проверяет IUP-120…127: Windows JFR capture/analysis, heap/thread dump analysis, Python/Node profiling, source links/compare и bounded large-file operations. Async-profiler допускается по реальному поддерживаемому OS; HPROF не проверяется JFR parser. Findings подтверждены fixture с известной проблемой, memory/cancel и corrupt-file tests.
- **IUQ-08:** S8-09 проверяет IUP-143…146 через общий CommandBus: live buffer context, versioned semantic edit, видимый пользователю run/test/debug, evidence receipts, конфликт и recovery. Две session/project operations сохраняют отдельные targets; остановка UI/host не вызывает повтор неизвестного mutation.
