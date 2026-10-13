# Universal Agent Control Surface

## Назначение

Agent Control Surface — единый способ работать с агентом из Chat, Browser, IDE, Source Control, Tasks, Operations, Data и Design. Пользователь не должен возвращаться в Chat, чтобы обсудить выбранный SQL, DOM-element, diff hunk, build stage или Kubernetes resource.

Это один контракт поведения над существующими Task, Session, queue, adapters и operation records. Он не создаёт второй agent runtime и не даёт UI обходить [`ADAPTER-CONTRACTS.md`](ADAPTER-CONTRACTS.md), [`AGENT-RUNTIME-AND-ROLES.md`](AGENT-RUNTIME-AND-ROLES.md) и project bindings.

## Основные принципы

1. **Одна выбранная Session.** Во всех workspace видно, какая Project/Task/Session и автоматически выбранная Role получит сообщение и артефакты. Роль объяснима, но вручную не выбирается.
2. **Контекст прикрепляется явно.** Current selection не копируется в prompt молча. Кнопка `Attach current` создаёт видимый typed ref с revision/generation.
3. **Один lifecycle для UI и агента.** Каждая операция проходит `proposal → prepare → execute → stream/result → verify → evidence` либо `reconcile` при unknown outcome.
4. **Настроенный binding уже является разрешением.** Внутри разрешённых project/environment/capability агент не показывает per-call MCP permission modal.
5. **Права не расширяются ролью, recipe или subagent.** Child наследует пересечение project binding, parent assignment и явных центральных запретов/target rules. Профиль выбирает контекст и workflow, но не сужает доступные инструменты.
6. **Точный target виден до external effect.** Для destructive/mutate action показываются connection, environment, resource, diff/SQL/parameters и recovery. Это inline review surface, а не повторяющийся `Are you sure?` dialog.
7. **Качество проверяет workflow.** `established_strict` запускает impact, dry-run, tests, readback и rollback gates как этапы работы; они не превращаются в цепочку permission popups.
8. **Результат равен evidence, а не тексту модели.** Статус `verified` появляется только после фактического readback/test/inspection на той же revision.

## Компоновка во всех workspace

Surface занимает одинаковое место в shell: компактная полоса над bottom dock либо внутри него. Она не перекрывает editor/browser/canvas и не меняет высоту при появлении progress. Состоит из четырёх уровней.

### 1. Session capsule

Всегда видны:

- Project и Task;
- Session title, автоматически выбранная Role, reason/confidence/captured state и run state: running, queued, needs attention, stopped, completed или failed;
- requested → actual model/reasoning;
- context `used / effective limit / reserve` и источник оценки;
- current Git branch/worktree либо честное `not bound to repository`;
- binding status: configured, degraded, stale или disabled;
- счётчик queue и active child workers.

Нажатие открывает session picker текущей Task. Смена workspace не меняет Session. Смена Project или Task выбирает последнюю session этой Task или показывает `Start session`; скрытая подмена запрещена.

### 2. Attached context tray

`Attach current` берёт выбор из активного workspace и создаёт immutable attachment. Каждый chip показывает icon/type, короткое имя, target и stale/conflict state. Details открывают exact identity и revision. Chip можно удалить, заменить текущей revision или закрепить для всей Task.

| Workspace | Typed attachment |
| --- | --- |
| Chat | message/turn, Todo step, question, artifact/evidence, checkpoint или child result ref |
| Tasks | Task revision, requirement/acceptance/decision/Todo/comment/activity ref |
| Browser | `tabId`, URL/origin, navigation generation, viewport, element/region ref, capture ref |
| IDE | workspace root, document ID/path, document revision, range/symbol/diagnostic/test ref |
| Data | connection alias/ref, database/schema, console/query revision, selected SQL/result rows/object ref |
| Git | repository/worktree, base/head/index revisions, file/hunk/change-set ref |
| PR | forge connection, repository, PR number, remote revision, file/thread/check ref |
| Jenkins | connection, folder/job, queue/build/stage ID, log cursor/test/artifact ref |
| Kubernetes/OpenShift | connection, cluster/context, namespace, kind/name, UID/resourceVersion, pod/container/restart |
| Docs | connection, space, page ID/version, selected block/range/draft ref |
| Design | artifact/version, page/artboard/element, viewport/theme/state, audit/comment ref |

Большие SQL results, DOM, screenshots, logs и documents остаются в artifact/resource store. В prompt попадает bounded excerpt и ref. При смене revision chip становится stale, но не перенацеливается молча.

### 3. Composer and queue

Composer имеет одно поле и явный delivery mode:

- `Send next` — durable FIFO после текущего turn;
- `Steer current` — interrupt/steering на safe boundary, только если binding это подтверждает; иначе честно превращается в `Send next`;
- `Answer question` — адресный callback pending question, включая свободный ответ;
- `Stop` — cancel request с фазами requesting, settling, stopped и unknown.

Queue drawer даёт редактировать, удалять, менять порядок и переносить ещё не отправленное сообщение в новую Task. После dispatch сохраняется immutable payload fingerprint. Reconnect/reload не дублирует dispatch.

Question callback не смешивается с message queue. Host держит durable ordered queue по Task/Session с `questionId`, `revision`, одним active head и exact origin assignment/attempt/generation. Поверх выбранного разговора видна одна bounded card `Вопрос N из M`, choices + freeform и явная кнопка подтверждения; закрытие сохраняет draft, а не отвечает. Answer receipt идемпотентен, stale revision отклоняется, после durable save последовательно открывается следующий вопрос. Defer/cancel/expiry имеют отдельные состояния и никогда не выбирают default. App restart восстанавливает head/order/drafts/receipts; скрытый межагентный traffic не может попасть в эту очередь. Канонический lifecycle и edge cases заданы в [ARTIFACTS_AND_QUESTIONS](../../workbench/docs/ARTIFACTS_AND_QUESTIONS.md#31-durable-question-queue).

В нижней кромке поля, перед Send/Stop, находится постоянная compact status row: `model · reasoning · context · role · branch`. Model и reasoning открывают поддержанные настройки следующего safe turn; context — состав/reserve/compaction; role — только объяснение AI routing и история `selected → captured → actual`; branch — точный repository/worktree и переход в Source Control. Ручного выбора роли нет. При 1024px элементы сворачиваются в одну строку summary с popover, но фактические model, role, context warning и Send/Stop не исчезают. Значение не меняется от focus другого workspace.

### 4. Recipes and operation strip

Слева от composer находятся 3–5 релевантных recipes текущего workspace. Recipe не является новым правом: он подставляет typed intent, required attachments, expected result и verification recipe. Если выбор неполон, recipe показывает одно конкретное недостающее действие.

Над surface показывается только текущая operation card: action, exact target, lifecycle phase, duration/progress, cancel/recovery action. История и raw details уходят в Status Center/Evidence, не захламляют workspace.

## Контракт состояния

```ts
type AgentSurfaceContext = {
  windowId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  roleBindingRevision: number;
  projectBindingRevision: number;
  workspace: "chat" | "browser" | "ide" | "source" | "tasks" | "operations" | "data" | "design";
  attachments: Array<{
    attachmentId: string;
    kind: string;
    targetRef: string;
    sourceRevision: string;
    summaryRef: string;
    state: "current" | "stale" | "missing" | "conflict";
  }>;
};

type AgentOperation = {
  operationId: string;
  correlationId: string;
  requestId: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  childAssignmentId?: string;
  connectionId?: string;
  capabilityId: string;
  target: { display: string; canonicalRef: string; revision?: string };
  effect: "read" | "local_write" | "remote_write" | "destructive";
  phase:
    | "proposed" | "preparing" | "ready" | "executing" | "streaming"
    | "result_received" | "verifying" | "verified" | "evidence_recorded"
    | "canceling" | "canceled" | "failed" | "unknown" | "reconciling";
  policySnapshot: string;
  inputFingerprint: string;
  externalId?: string;
  progressRef?: string;
  resultRef?: string;
  verificationRef?: string;
  evidenceRefs: string[];
};
```

Source of truth для selection остаётся владелец ресурса — BrowserService, DocumentService, GitService, database driver host или adapter. Surface хранит ссылку и snapshot metadata, а не копию ресурса. Operation store находится в main process и переживает renderer reload/restart.

## Политика `Allow all within configured binding`

По умолчанию включена политика **Allow all within configured binding**:

- Project Settings связывает connection с project, environments/targets и набором read/mutate capabilities;
- эта настройка авторизует вызовы UI, Session и subagents в указанной области;
- per-call MCP permission modal не показывается;
- Session получает binding revision, а child assignment — её пересечение с parent scope; child не может добавить connection, environment или capability;
- центральный Connection/Capability Center может отключить connection, отдельную capability или environment для всех новых операций;
- смена binding revision не останавливает молча уже отправленную external mutation: host просит cancel, а затем ведёт result/reconcile;
- actor, session/child, capability, target, binding revision, payload fingerprint, time, external ID, result и verification попадают в audit;
- secrets остаются `secretRef` в main process и не попадают в surface, prompt или audit export.

Если target/capability не входит в binding, operation card показывает `Unavailable outside project binding` и одно действие `Open project binding`. Это не per-call approval и не temporary bypass. После настройки binding новая revision подхватывается без повторного подтверждения каждого tool call.

## Lifecycle операции

### Proposal

Агент фиксирует intent, exact target, expected result, effect class, затронутые attachments и verification plan. В UI это одна сжатая card, а не полный tool payload.

### Prepare

Host, а не модель:

- разрешает canonical target и current revision;
- проверяет project binding/capability/RBAC;
- классифицирует read/write/destructive;
- валидирует parameters, limits, expected revision и idempotency support;
- делает dry-run/diff/query plan/impact estimate, если capability это поддерживает;
- создаёт operation ID, input fingerprint, lease/fencing token и recovery recipe.

Для destructive action inline card показывает target, proposed change, blast radius и recovery. Если Task и binding уже разрешают действие, workflow переходит к execute без approval modal. Пользователю доступны Stop и переход к details.

### Execute

CommandBus отправляет prepared command ровно один раз. Pre-dispatch failure можно безопасно повторить с тем же request ID. После dispatch automatic retry разрешён только для доказанно idempotent capability.

### Stream or result

Progress адресуется по operation/window/session и имеет monotonic sequence/cursor. Renderer получает bounded summary; logs, rows, screenshots и artifacts идут в свои stores. Перезапуск renderer делает snapshot reconcile, а не создаёт новую операцию.

### Verify and evidence

Verification использует независимый readback, targeted test или live scenario на resulting revision. Если result получен, но verification невозможен, card говорит `Result received; verification unavailable`, а не `Success`.

Evidence сохраняет operation ID, target/revisions, prepared diff/SQL/parameters, bounded result, verification, limits и artifact refs. Оно прикрепляется к Task/Todo/acceptance и открывает source workspace на том же target.

### Unknown and reconcile

Если response потерян после возможного effect, state становится `unknown`. Повтор исходной mutation запрещён. Reconcile ищет по correlation/external ID, remote revision, queue/build ID, Git ref, Kubernetes UID/resourceVersion, page version или DB transaction state. Итог:

- effect confirmed → verify → evidence;
- no effect confirmed на authoritative source → новый prepared attempt с новым operation ID;
- нельзя установить → остаться unknown, показать bounded manual inspection path и не блокировать остальную Session.

## Пример: Data workspace

Пользователь открыл `payments-dev`, выбрал schema `public` и SQL в console `retry-audit.sql`:

```sql
select order_id, attempt, status_code, created_at
from checkout_retry
where order_id = :order_id
order by created_at desc;
```

1. **Attach.** Chip хранит connection ref, `payments-dev/public`, console/query revision, selected range и secret-free parameter schema. Сам password/DSN не попадает в Session.
2. **Recipe.** `Run and validate selected query` создаёт proposal: понять retry history для `order_id`, вернуть bounded result и проверить порядок attempts.
3. **Prepare.** Driver host подтверждает exact connection/database/schema, query revision, read-only classification, typed parameter, timeout, row/byte cap и cancellation support. UI показывает target и normalized SQL fingerprint.
4. **Execute.** Parameter передаётся typed binding; не склеивается с SQL. Operation и transaction/query IDs сохраняются до dispatch.
5. **Stream/result.** Grid получает rows/pages напрямую; агент получает columns/types, row count, truncation, duration и bounded sample ref.
6. **Verify.** Host проверяет result schema, `attempt` ordering, expected `order_id`, cap/truncation и absence driver error. Если задача утверждает больше, чем доказывают rows, агент фиксирует unknown.
7. **Evidence.** Task получает query fingerprint, target, parameters без secrets, result metadata, validation и link на result artifact.

Для `UPDATE/DELETE/DDL` тот же flow добавляет statement class, transaction mode, expected affected rows/objects, generated diff/SQL, rollback/readback и unknown-transaction handling. Точный connection/database/schema виден в operation card. Если `data.mutate` разрешён project binding, отдельный MCP approval dialog не появляется; transaction/impact/readback gates остаются обязательными этапами workflow.

## Recipes и evidence по workspace

| Workspace | Ключевые recipes | Точный target в proposal/prepare | Verification/evidence |
| --- | --- | --- | --- |
| Chat | Replan current work; hand off to role; fork from checkpoint; compact context; review child result | Task/Session/Attempt, Todo/checkpoint revision, selected message/artifact/child result | updated Todo/checkpoint, handoff receipt, joined child evidence and preserved queue |
| Tasks | Critique requirement; complete SDD section; split/reorder Todo; diagnose blocker; prepare implementation handoff | Task revision, selected requirement/acceptance/decision/Todo/activity | traceability/conflict checks, versioned Task diff, workflow transition and evidence links |
| Browser | Inspect selection; reproduce flow; collect console/network/AX trace; compare viewport; save replay recipe | window/tab, URL/origin, navigation generation, viewport, element ref | URL/generation, assertions, console/network/page errors, screenshots/trace |
| IDE | Explain/fix selection; implement diagnostic; refactor symbol; run affected tests; diagnose failure | host/root, document revision/range/symbol, toolchain/run config | saved document revision, diagnostics delta, structured test/run result, code diff |
| Git | Review agent changes; prepare commit; rebase/merge; reconcile push | repository/worktree, base/head/index, remote/refspec | post-operation status/refs, diff/change set, hooks/tests, remote readback |
| PR | Draft/update PR; review selected hunk/thread; request changes/approve; merge/queue | forge space, repo, PR, remote revision, base/head, thread/check | returned PR revision, thread/check state, merge result and exact remote refs |
| Jenkins | Triage failed build; explain selected log/test; prepare trigger; retry failed stage; cancel run | instance/folder/job, parameters, queue/build/stage IDs | queue→run correlation, stage graph, tests/artifacts, terminal result/readback |
| Kubernetes/OpenShift | Diagnose workload; inspect logs/events; compare desired/live; prepare apply/scale/restart; verify rollout | connection/cluster/context/namespace and resource UID/resourceVersion/container/restart | dry-run/diff/RBAC, observed generation, rollout/conditions, logs/events receipt |
| Docs | Summarize selected section; draft Task/SDD update; validate links; publish prepared revision | knowledge connection/space/page/version/block/draft | sanitised preview, link check, returned page/version and conflict-free readback |
| Design | Critique selection; complete state matrix; run visual/a11y audit; compare implementation; create handoff | artifact/version/page/artboard/element/viewport/theme/state | audit finding refs, captures/diff, comments/version, approved handoff links |
| Data | Explain/execute selected query; inspect plan; validate result; prepare data/DDL change; diagnose lock | connection/database/schema/transaction, query/object/result revision | result schema/limits, plan/readback, affected rows/object revision, transaction state |

Recipes адаптируются по live capabilities. Кнопка, которую adapter не поддерживает, не выглядит рабочей: recipe либо скрыт, либо показывает точную недостающую capability и переход в Connection Center.

## Multi-window, Session и subagents

- Выбранная Session и draft composer являются window-local view state; они не меняют focus в другом окне.
- Attachments принадлежат draft/message/operation, а не глобальному clipboard. Selection окна B не попадает в message окна A.
- Два окна могут смотреть одну Session. Outbox использует message ID и monotonic session sequence; dispatch происходит ровно один раз.
- Active attempt имеет writer lease. Второе окно может queue/steer/stop через тот же coordinator, но не запускает параллельный writer скрыто.
- Operation events имеют `projectId/taskId/sessionId/windowId/operationId/sequence`. Чужое окно не получает resource event, кроме явной read-only mirror subscription.
- Subagent получает prepared assignment с typed refs, binding/policy revision, budget и expected evidence. Его operations видны в parent surface как child cards, но не подменяют parent selection/composer.
- Межпроектная Session не наследует bindings первого Project. Каждая операция проходит по binding Project-владельца target.

Панель **Исполнители** является native host control, а не оболочкой вокруг terminal/CLI-команд. Host хранит assignment/attempt/outbox/lease/quota/join records и использует CLI/ACP только как execution adapter. Для каждого child видны dependencies, автоматически выбранная role/reason, requested→actual model/reasoning, queue/run/retry state, current step, scope/lease, shared budget, candidate/evidence и join status. Из UI доступны: открыть работу, уточнить ещё не завершённое поручение, pause/resume admission, изменить priority или model/reasoning следующего attempt, stop/cancel, классифицированный retry/reconcile и disposition candidate. Pause не замораживает уже отправленный turn, stop не освобождает slot до terminal/unknown, а retry не повторяет возможный effect. Непрозрачный CLI-native child получает отметку `opaque` и только реально обнаруженные controls.

## Context budget и compaction

Surface показывает context до dispatch, а не после 413:

- used, effective limit, response/tool reserve и confidence/source;
- оценочную стоимость attachments и queued message;
- compact warning без блокирующего modal;
- `Compact now` с preview, pinned facts и restore point;
- замену больших contents на refs, сохраняя source revision;
- recipe-specific bounded packet: только selected SQL/DOM/range/log window и metadata, а не вся база/страница/repository/log.

При threshold coordinator завершает current safe boundary, создаёт checkpoint и compacted packet. Текущая external operation не перезапускается из-за compaction; она восстанавливается по operation record.

## Accessibility и responsive behavior

- команда `Agent: Focus composer` доступна из Command Palette и имеет настраиваемый shortcut; keymap resolver не перехватывает Browser `Ctrl/Cmd+L`, editor chords и terminal input;
- Session, attachments, recipes, delivery mode, queue и send доступны в логичном keyboard order;
- статусы не полагаются на цвет; phase, target и result имеют текстовые accessible names;
- progress объявляется через throttled polite live region; error/needs-attention — один раз, а не на каждый stream chunk;
- ни один recipe не скрыт только за icon; tooltip и accessible name обязательны;
- reduced motion убирает pulse/spinner animation, сохраняя текстовую фазу;
- при zoom 200% и width 1024 surface сворачивает recipes в menu и attachments в horizontal list, но Session/target/status/send не исчезают;
- question overlay показывает одну card без scrolling/stack, сохраняет draft/focus return и не создаёт keyboard trap.

## Логи, performance и privacy

- все lifecycle transitions имеют timestamp, actor, correlation/operation ID и reason;
- raw MCP/CLI response не попадает в renderer state; surface получает normalised summary/ref;
- stream батчится и виртуализируется, queue/operation history имеет cursors;
- diagnostic export сохраняет state machine, target identities и fingerprints, но redacts secrets, credentials, DB values, document body и raw corporate payload;
- recipe telemetry меряет time-to-proposal, prepare/execute/verify duration, recovery/reconcile и false-success rate; content prompt не сохраняется ради аналитики.

## Порядок внедрения

1. Вынести session capsule, composer, attachment chips и operation strip в shared shell без изменения текущей queue semantics.
2. Ввести typed `selection.describe/attach/refresh` для одного workspace и stale revision handling.
3. Связать surface с project binding/capability inspector и доказать inheritance для parent/child Session.
4. Реализовать persisted operation lifecycle на read-only Browser и Data recipes.
5. Добавить write/destructive prepare, target preview, verify и unknown reconcile на disposable fixtures.
6. Подключать workspace по одному, не дублируя lifecycle в adapters.
7. Проверить same-session/two-window, parent/child, reload mid-stream, disable mid-operation, 400/413/429/HTML и lost response fixtures.
8. Провести keyboard/screen reader/zoom/reduced-motion и long-session performance audit.

## Карточки и зависимости

Карточки ниже включены в `suite/implementation-plan.json`; центральная policy вынесена в предшествующую `S0-03`.

| Card | Outcome | Depends on | Proposed acceptance |
| --- | --- | --- | --- |
| **S0-03** Central execution policy | `auto_allow_bound`, Session/subagent inheritance, central disables и audit без per-call MCP prompts | S0-02 | POL-01…POL-06 |
| **S1-06** Agent surface shell and typed selection | Session capsule, shared composer/queue, `Attach current`, operation strip и bottom model/reasoning/context/auto-role/branch во всех workspace | S0-03, S1-02, S1-03, S1-04 | ACS-01…ACS-03, ACS-11, ACS-13 |
| **S8-08** Bound operation lifecycle | policy inheritance, persisted lifecycle, unknown reconcile, multi-window/session routing, context integration | S0-03, S1-06, S8-02, S8-04 | ACS-04…ACS-08, ACS-12 |
| **S8-09** Workspace recipes and evidence parity | Chat/Tasks/Browser/IDE/Git/PR/Jenkins/K8s/Docs/Data/Design recipes и одинаковая verification/evidence UX | S8-08 и готовые domain adapters | ACS-09, ACS-10 |
| **S8-10** Native subagent control plane | Host-owned assignments/attempts/outbox/leases/budgets, visible pause/resume/stop/retry/reconcile, join/evidence и restart recovery | S8-02, S8-03, S1-06 | AGT-08…AGT-14 |

`S8-09` сертифицирует паритет после всех зависимостей. Каждый domain slice может подключить свои recipes раньше, когда его adapter и `S8-08` готовы. Final audit зависит от `S8-09`.

## Приёмка

- **ACS-01:** во всех workspace видны Project/Task/Session/Role, requested→actual model/reasoning и run state; смена workspace не меняет Session, а смена Task не подменяет её молча.
- **ACS-02:** `Attach current` для каждого workspace создаёт typed ref с target/revision; stale/missing/conflict виден, а ресурс другого окна/проекта не прикрепляется неявно.
- **ACS-03:** composer различает next/steer/question/stop; queue переживает reload, а two-window dispatch не создаёт дубль.
- **ACS-04:** operation переживает renderer/app restart и имеет наблюдаемые proposal/prepare/execute/stream-or-result/verify/evidence/reconcile phases с одним operation ID.
- **ACS-05:** configured project binding даёт Session/subagents все его capabilities без per-call MCP permission modal; child не может расширить scope, а central disable блокирует новые dispatch и фиксируется в audit.
- **ACS-06:** destructive operation показывает exact target, diff/SQL/parameters, impact и recovery inline; при разрешённом binding `established_strict` gates выполняются в workflow без repetitive approval dialog.
- **ACS-07:** timeout/lost response после possible effect даёт `unknown`; исходная mutation не повторяется, reconcile восстанавливает outcome по authoritative identity/revision либо честно оставляет unknown.
- **ACS-08:** два окна/сессии не смешивают selection, drafts, events и operation targets; same-session outbox и writer lease предотвращают duplicate turn/conflicting writer.
- **ACS-09:** Data recipe перед dispatch показывает connection/database/schema/query revision/class/limits, возвращает typed bounded result, выполняет result/readback validation и сохраняет secret-free evidence; write/DDL unknown не retry-ится.
- **ACS-10:** Chat, Tasks, Browser, IDE, Git/PR, Jenkins, Kubernetes/OpenShift, Docs, Data и Design имеют capability-aware recipes и один lifecycle/target/evidence UX; недоступная capability не выглядит исполненной.
- **ACS-11:** surface полностью доступен с клавиатуры/screen reader, не теряет target/status/send при 1024px и 200% zoom, а progress не засоряет live region.
- **ACS-12:** context meter показывает effective budget/reserve до dispatch; attachments bounded, compaction имеет preview/checkpoint, а 413 recovery не теряет operation records и не повторяет external effect.
- **ACS-13:** нижняя строка composer во всех workspace показывает model, reasoning, context, автоматически выбранную role с reason/confidence и branch/worktree; role не имеет ручного selector, а переход workspace не меняет captured values.
