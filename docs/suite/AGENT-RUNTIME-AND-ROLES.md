# Agent runtime, роли и отказоустойчивость

Статус 0.5: часть этого целевого контракта реализована и проверена в [AGENT-HARNESS-AUDIT](AGENT-HARNESS-AUDIT.md). Native compiler использует CORE + одну роль; SYSTEM_PROMPT — legacy entrypoint. Остальные fields/services ниже являются целевыми там, где не подтверждены аудитом и исходниками.

Этот документ связывает уже подготовленные профили и процессы Workbench с нативным UI. Он не объявляет новые возможности GigaCode CLI: системный prompt, выбор модели, reasoning, steering, subagents и MCP используются только после capability probe и фактического readback конкретной сборки.

## Единица работы

Иерархия неизменна: **Project → Task → Session/Role → Attempt**. Task хранит цель, требования, Todo, решения, вопросы, артефакты и evidence. Session — один разговор/исполнитель. Роль задаёт способ работы внутри Task, но не создаёт вторую задачу и не выдаёт дополнительных прав.

Для каждого запуска сохраняются `taskRevision`, `roleVersion`, `instructionFingerprint`, requested/actual model и reasoning, capability fingerprint, context budget, attempt ID и delivery receipt. После обрыва новый процесс читает checkpoint и фактическое состояние ресурсов; он не восстанавливает контекст по памяти модели.

## Сборка инструкций

Prompt assembler собирает immutable snapshot в таком порядке:

1. ограничения платформы, разрешения и подтверждённые возможности CLI;
2. общие правила [`CORE.md`](../../workbench/CORE.md); [`SYSTEM_PROMPT.md`](../../workbench/SYSTEM_PROMPT.md) служит entrypoint для legacy/bootstrap и не дублируется в native compiler: помощь, факты, качество, журнал, честные проверки, конструктивная критика;
3. versioned project rules и выбранный режим качества;
4. Task contract: цель, scope, requirements, acceptance, решения, открытые вопросы и запреты;
5. ровно один role overlay из `workbench/profiles/`;
6. stage/workflow contract из `workbench/workflows/`;
7. фактический capability snapshot выбранных MCP/CLI adapters;
8. bounded task packet: ближайшая работа, релевантные refs и последний verified checkpoint.

Retrieved документы, HTML, логи, данные БД и MCP outputs остаются недоверенными данными. Их текст не становится инструкцией. `--system-prompt`, append, env/file и ACP delivery считаются разными механизмами; UI показывает, какой из них реально использован. Если поддержан только обычный context prompt, так и писать.

## 14 встроенных ролей

| Роль | Основная ответственность | Обязательный результат | Не делает молча |
| --- | --- | --- | --- |
| `analyst` | Помочь описать функциональность, исследовать процесс, подготовить варианты, gap/impact analysis, текст или DOCX | Проверенные факты, неизвестные, противоречия, варианты и согласованное описание | Не превращает раннюю идею в утверждённое требование и не реализует код вместо профильной роли |
| `architect` | Определить границы системы, контракты, quality attributes и безопасную последовательность изменений | Проверенная карта зависимостей, короткое ADR, migration/recovery/observability contracts и реализуемые increments | Не добавляет слой или большой документ без необходимости и не выдаёт диаграмму за подтверждение runtime-поведения |
| `spec` | Интерактивно собрать SDD/спецификацию | Полная, непротиворечивая, проверяемая спецификация с acceptance, states, NFR, migrations и open decisions | Не заполняет пробелы заглушками; при достаточных данных не затягивает бесконечными вопросами |
| `backend` | Реализовать backend по принятому Task/SDD | Небольшой diff, миграция/совместимость, meaningful tests и evidence | Не меняет внешний контракт без impact/recommendation |
| `database` | Проектировать схемы, запросы, миграции и безопасный rollout данных | Versioned migration/query change, планы применения и восстановления, реальные plans/measurements и проверенные инварианты | Не применяет mutation к общей БД из-за одной доступности MCP и не объявляет пустую локальную базу эквивалентом production |
| `designer` | Спроектировать пользовательский путь, измеримый design contract и расширяемый корпоративный UI kit | Versioned contract/prototype/assets, state matrix, метрики, provenance и точный handoff frontend | Не копирует чужие assets/интерфейсы и не принимает красивый happy-path screenshot за проверенный UX |
| `frontend` | Реализовать UI и дизайн-систему | Все states, responsive/a11y, визуальная и поведенческая проверка | Не принимает screenshot или наличие DOM за работающий UX |
| `devops` | Настройка CI/CD, OpenShift/Kubernetes, Jenkins и окружений | Plan/diff, точный target, dry-run/preflight, readback и recovery | Не выбирает production по умолчанию и не повторяет unknown mutation |
| `qa` | Составить стратегию и выполнить проверки | Risk-based scenarios, воспроизводимое evidence и честный verdict | Не подтверждает функцию только unit/mock-тестом, если заявлен живой UI |
| `reviewer` | Независимо проверить код, дизайн, требования и риски | Findings с severity, evidence, предложением исправления и residual risk | Не блокирует косметическими предпочтениями и не переписывает работу без причины |
| `diagnostics` | Локализовать дефект по runtime evidence | Timeline/correlation, минимальная гипотеза, reproduction и проверка исправления | Не чинит наугад и не объявляет исчезновение симптома причиной |
| `security` | Проверить модель угроз, границы доверия и применимость уязвимых версий зависимостей, включая Sprut/SCA | Findings с применимостью и remediation, revision-bound SCA evidence до/после и остаточный риск | Не приписывает сканеру неподтверждённые функции, не выдаёт совпадение версии за достижимую уязвимость и не запускает destructive exploit |
| `technical-writer` | Создать и поддерживать точную документацию для разработчиков, операторов и пользователей | Versioned документ или receipt публикации, источники утверждений и результаты link/render/example checks | Не закрепляет предположения как норму, не публикует без поручения и не переписывает незатронутые разделы ради единообразия |
| `gigacode-ui` | Быстро развивать личную оболочку | Рабочий вертикальный срез, живой dogfood-сценарий, observability и checkpoint | Не применяет производственный ceremony к каждой мелочи, но не ослабляет live UI test |

Аналитик работает в одном из режимов: `feature-description`, `sdd`, `document`, `review-only`. SDD — важный режим, а не вся роль. Реализация принятой спецификации передаётся подходящей роли: architect для границ и контрактов, backend/frontend/database для кода и данных, designer для design contract, security для применимости рисков, devops для общей среды, technical-writer для проверяемого документа.

### Автоматический выбор роли

Пользователь **не выбирает профиль вручную**. AI router определяет роль на старте Task и после смыслового изменения stage по совокупности фактов:

- запрос и требуемый результат, а не отдельное ключевое слово;
- Project: тип продукта, stack, quality mode, connections и принятые правила;
- Task: цель, accepted requirements/decisions, текущий workflow stage, Todo, blockers и уже полученные artifacts/evidence;
- активный workspace и прикреплённый ресурс: SQL/query, diff, browser trace, design artifact, deployment или документ;
- риск, внешние эффекты, необходимость независимой проверки и фактически доступные adapters/capabilities.

Результат router содержит `selectedProfileId/version`, `reason`, `confidence`, использованные evidence refs, ожидаемый результат, альтернативу и условие следующего пересчёта. Host валидирует существование profile/adaptor, совместимость stage и instruction binding. Неизменный input fingerprint переиспользует решение; model router не вызывается на каждый token, focus change или открытие панели. Низкая confidence не открывает список ролей: router выбирает безопасный provisional профиль и задаёт один предметный вопрос только тогда, когда ответ меняет контракт или допустимый следующий шаг. `analyst` не является универсальной заглушкой для любой неопределённости.

В нижней строке composer роль показана read-only chip: название, причина, confidence и `captured → actual` binding. По нажатию открывается объяснение и история маршрута, а не selector. Пользователь корректирует цель, ограничения или ожидаемый результат обычным сообщением; router пересчитывает роль. Новый binding применяется только на safe boundary, сохраняет Task/Todo/queue/artifacts и не меняет project permissions. Текущий turn сохраняет captured role даже если следующая уже подготовлена.

Routing выбирает роль по требуемому результату и текущему stage. `behavior-change` отдаёт impact и границы `architect`; `data-migration` — baseline/plan/prepare `database`, репетицию `qa`, применение `devops`; `dependency-upgrade` — inventory/compatibility и `security-review` профилю `security`, реализацию профильному разработчику; `design-audit`, `design-system` и `ux-design` — contract/prototype/handoff `designer`, код `frontend`; `documentation` — impact/delta/checks `technical-writer`. `reviewer`, `qa` и `diagnostics` сохраняют независимые verdict, проверку и локализацию и не подменяют владельца изменения. Совпадение названия роли само по себе не доказывает активный prompt или доступный инструмент.

## Критический аналитик и SDD

Процесс SDD:

1. зафиксировать цель, пользователей, границы, термины и источники;
2. построить requirements/state/data/integration matrix;
3. проверить пары требований на противоречия и каждый критичный путь на недостаточность;
4. отделить факт, принятое решение, предположение, рекомендацию и вопрос;
5. предложить 1–3 способа закрыть пробел с последствиями;
6. задать только вопросы, которые меняют контракт или мешают следующему безопасному шагу;
7. собрать functional flows, error/empty/loading/permission/conflict states, API/data, NFR, compatibility, migration, observability и acceptance;
8. провести self-review по traceability: каждое требование имеет источник и проверку, каждый acceptance ссылается на требование;
9. отдать versioned artifact и change summary. Реализацию начать под профильной ролью.

Для DOCX и других документов используется тот же фактологический контур; форматирование не должно заставлять перечитывать весь проект. Повторная проверка запускается только для изменённых разделов и их зависимостей.

## Режимы скорости

Router выбирает минимально достаточный workflow по риску и объёму, а не по длине пользовательской фразы:

- `fast`: обратимая локальная правка, 1–3 файла, нет изменения контракта/данных/прав; короткий Todo, targeted check, один checkpoint;
- `standard`: обычная функция или дефект; план, реализация, meaningful tests, review затронутой области;
- `strict`: установленный продукт, данные, auth, публичный API, infrastructure, dependency/security или миграция; impact, rollback и расширенная проверка;
- `gigacode-fast`: личный GigaCode UI; быстрые вертикальные срезы и dogfooding, но browser/Electron behavior подтверждается живым сценарием.

Документация работает от `git diff + docs impact map`: правятся только связанные разделы, ссылки и статус. Ретроспектива читает structured journal и считает повторяющиеся сбои/время ожидания/ложные проверки; она не пересказывает весь transcript. Маленькая задача не получает полный SDD, отдельного critic-agent и многостраничную ретроспективу.

## Видимый Chat runtime

В нижней части composer одной спокойной status-строкой всегда видны: фактически поддержанные model и reasoning, context `used / effective limit / reserve` с источником оценки (`provider`, `tokenizer estimate`, `unknown`), автоматически выбранная роль с reason/confidence и текущая Git branch/worktree. Model/reasoning сохраняются на Task/session scope; fallback не происходит скрытно. Role chip открывает объяснение, но не ручной selector. Branch chip открывает Source Control для проверки target и не переключает ветку одним случайным кликом. На узкой ширине secondary details уходят в popover, но model, role, context state и Send/Stop остаются доступны.

Queue различает:

- **Следующим сообщением** — durable FIFO после текущего turn;
- **Уточнить текущую работу** — steering только если adapter это подтверждает; иначе message ставится следующим;
- **Ответить на вопрос** — адресный callback конкретного pending question;
- **Остановить** — cancel request с состояниями requesting/settling/stopped/unknown.

Queued message можно редактировать, удалить, переставить и преобразовать в новую Task до dispatch. После dispatch хранится snapshot. Вопросы обслуживает host-owned durable queue по `(taskId, sessionId)`: `questionId + revision`, monotonic order, один active head, exact origin assignment/attempt/generation и idempotent answer receipt. В выбранной Task/Session показывается одна bounded overlay-card `Вопрос N из M`: причина, влияние, варианты, свободный ответ и explicit submit. Закрытие/minimize сохраняет draft и pending state; отдельной панели, прокручиваемого списка или стека вопросов нет. После подтверждённого сохранения ответа открывается следующий; defer/cancel/expiry не выбирают вариант автоматически. Restart восстанавливает head/order/drafts/receipts, stale revision отклоняется, а скрытые coordinator↔worker сообщения никогда не становятся пользовательскими вопросами. Полный контракт — [ARTIFACTS_AND_QUESTIONS](../../workbench/docs/ARTIFACTS_AND_QUESTIONS.md#31-durable-question-queue).

Todo строит агент из этапов фактической работы. Он может добавлять, дробить, переставлять или снимать пункты с короткой причиной. Выполненное зачёркнуто и приглушено, текущий пункт выделен спокойной доступной анимацией, блокер имеет причину. `done` требует evidence текущей revision.

Inspector Chat содержит вкладки `Todo`, `Исполнители`, `Artifacts`, `Evidence`. Tool calls свёрнуты в карточку action/target/status/duration; raw input/output открывается отдельно. Session list показывает running/queued/needs-attention/completed/failed без выдуманного процента.

## Контекст, память и восстановление

Рабочий бюджет меньше объявленного окна модели. Из effective limit заранее вычитаются system/tool schemas, reserve для ответа и safety margin. Для окна 256k default soft thresholds: предупреждение около 65%, подготовка compaction около 75%, обязательная safe-boundary compaction до 85%; фактические значения адаптируются по provider overhead и ошибкам.

Compaction создаёт preview и versioned summary с:

- целью, scope и constraints;
- решениями и provenance;
- изменёнными файлами/ресурсами и revisions;
- выполненными checks и их границами;
- pending/unknown external effects;
- открытыми вопросами и одним следующим шагом;
- ссылками на большие artifacts/logs вместо копирования.

Pinned facts не удаляются без явного replacement. Summary — производный индекс, а не источник истины. Пользователь может просмотреть, закрепить факт, создать restore point и запустить раннее сжатие. При 413 сначала сохраняется checkpoint, затем удаляются дубли/неиспользуемые tool outputs, большие данные заменяются refs, история дробится; исходный огромный запрос не повторяется.

Общая память хранит только устойчивые факты с scope, source, confidence, timestamps и expiry. При первом запуске импорт существующих project files/memory проходит preview: `accept`, `edit`, `reject`, `project-only`. Пароли, временные ошибки, догадки и полный transcript не импортируются. Новое знание предлагает merge/replace/conflict, а не бесшумно переписывает старое.

## Managed subagents

**Текущая реализация — baseline, не итог.** `app/` уже сохраняет child sessions с `parentId`, отдельные ACP sessions, per-session FIFO, глобальный `maxConcurrent`, cancel/held queue, conservative unknown recovery, bounded checkpoint, peer receipts и простую панель workers. В ней ещё нет host-owned AgentTask/attempt/disposition, durable provider quotas/reservations, execution leases/fencing, per-child requested→actual settings, dependency join/integrated evidence, worktree ownership и authoritative external reconciliation. Поэтому `S8-01/S8-02/S8-10` остаются `planned`; существующий код нужно reuse/repair по migration inventory, не объявлять полной оркестрацией и не заменять без сравнения.

Managed subagent — host-owned assignment, а не команда, вручную введённая в CLI. GigaCode/Qwen process и ACP session являются сменным execution adapter. `CoordinatorService`, `Scheduler`, durable outbox, operation store и единственный Task writer принадлежат приложению и переживают renderer/CLI restart. Встроенный CLI child без отдельного control API показывается как `native/opaque`; приложение не рисует для него ложные pause/retry/message controls и не учитывает его как полностью управляемый worker.

Coordinator создаёт child только для реально независимой работы. У assignment есть input/acceptance refs, read/write scope, owner, lease/fencing token, shared budget, requested/actual model и reasoning, автоматически выбранная роль с route evidence, expected result и join dependency. Default: depth 1 и небольшой parallelism, увеличиваемый только после измерений. Конфликтующие writers сериализуются или работают в изолированных worktrees; child result остаётся candidate до интеграции и общих tests.

Host lifecycle различает `draft → queued/held → starting → running → waiting_retry|waiting_input|cancel_requested → completed|failed|cancelled|interrupted_unknown → reconciling`. Pause останавливает **новые dispatch и очередь**, но не выдаётся за заморозку уже выполняемого model/tool turn. Resume заново проходит admission. Stop адресно отменяет выбранный live turn и остаётся `cancel_requested`, пока adapter не подтвердит terminal boundary. Retry доступен только для доказанно недоставленной/idempotent операции либо создаёт новый содержательный attempt с прежним общим budget; кнопки «повторить всё» нет.

Durable outbox хранит assignment/session/generation, monotonic sequence, message kind (`next`, verified `steer`, question answer, coordinator handoff), payload fingerprint и состояния `prepared → queued → dispatching → observed|unknown|failed`. Один in-flight turn на session; reload и два окна не создают второй dispatch. Coordinator↔worker сообщения адресны и скрыты из основного разговора, но сохраняют receipt и bounded audit. Cross-project link требует явной области и не переносит secrets, permissions или полную историю.

Scheduler применяет общий provider/project budget, лимиты active/queued/depth, fair queue, dependency DAG и circuit breaker. Lease содержит owner, epoch/fencing token и expiry; истечение lease не доказывает смерть старого process. Новый owner сначала reconciles process, session и external effects. File/resource writer leases предотвращают конфликт; один integration writer принимает candidate по revision, объединяет результаты и запускает tests на интегрированных байтах. Parent завершает Task только после обязательного join/evidence, а не по числу зелёных child cards.

UI показывает компактный счётчик и панель **Исполнители** без terminal/CLI команд. Для каждого assignment видны parent/dependencies, автоматически выбранная роль и reason, requested→actual model/reasoning, queue/run/retry state, текущий шаг, scope/lease, budget, blocker, result/evidence и join disposition. Доступные host controls: открыть работу, уточнить queued assignment, pause/resume admission, изменить приоритет или model/reasoning следующего attempt, stop/cancel, безопасный retry/reconcile и принять/отклонить candidate. Роль остаётся результатом router: изменение поручения вызывает пересчёт, ручного profile dropdown нет. Unsupported controls имеют точную причину.

Crash recovery читает checkpoint + journal tail, восстанавливает queue/outbox, reservations, attempts, leases, pending questions/results и unknown effects, затем сверяет реальные processes/sessions/external IDs. Доказанно недоставленное может продолжиться; возможный dispatch никогда не повторяется автоматически. Старые generation/events/callbacks не меняют новый attempt. Все эти функции проверяются через native UI/API приложения; запуск worker из CLI вручную не является доказательством.

Retry policy классифицирует действие:

| Сбой | Поведение |
| --- | --- |
| 429 | Уважать `Retry-After`, jittered backoff и общий provider budget; не запускать толпу fallback workers |
| 413 | Checkpoint → compaction/chunk/reference → один новый attempt с новым payload fingerprint |
| 400 | Разобрать JSON/text/HTML; исправлять только известную несовместимость. Не повторять тот же request |
| auth/permission | Fail fast, показать connection/scope; не переключать credential скрытно |
| timeout после возможной отправки | `unknown`, reconcile по session/operation ID; не дублировать prompt/write |
| transient transport до dispatch | Ограниченный idempotent retry с тем же request ID |

HTML error page распознаётся по status/content-type и безопасной сигнатуре, sanitised excerpt сохраняется в diagnostics, но не рендерится как доверенный HTML. Circuit breaker общий для provider/endpoint, persisted через restart; ручной retry не обнуляет бюджет.

## Self-optimization без самоповреждения

Агент может предложить сохранить повторяемый recipe/script после минимум двух подтверждённых повторов либо явного решения пользователя. Артефакт получает owner, purpose, parameters, platform, version, provenance, risk, tests, last-used и expiry/review. Сначала draft и known-bad test, затем shadow run, только потом activation в ограниченном scope. Самооптимизация не меняет права, system base, production targets или credential bindings и не распространяется на все проекты автоматически.

## Карточки внедрения

1. **S8-00 Role binding probe:** проверить GigaCode/ACP delivery, model/reasoning readback и два изолированных session bindings.
2. **S8-01 Coordinator:** persisted assignments, bounded queue, leases, results и project mailbox.
3. **S8-02 Context/resilience:** budget, preview compaction, checkpoints, 400/413/429/HTML classifier и resume.
4. **S8-03 Profiles/memory/recipes:** versioned каталог всех 14 bundled profiles, проверка соответствующих adapters/capability entries/workflow references, recommendations, import preview и safe optimization.
5. **S8-04 Chat controls:** queue/steer/questions/Todo/agents/artifacts/evidence, lifecycle и accessibility.
6. **S8-05 Analyst/SDD vertical slice:** feature description → contradiction matrix → accepted specification → handoff другой роли.
7. **S8-06 Scheduled automations:** persistent schedule/trigger хранит project/task/profile/model, effective policy и next run; deduplication создаёт один recoverable run, а результат возвращается в review inbox.
8. **S8-07 Declarative extensions:** signed package registry и typed bounded pre/post/error hooks показывают origin/version/signature/tools/effective policy, имеют timeout/receipt/diagnostics и не повышают права профиля.
9. **S8-10 Native subagent control plane:** host-owned AgentTask/attempt store, Scheduler, outbox, leases, quotas, pause/resume/stop/retry/reconcile, per-child requested→actual settings, visible control UI, join/integration/evidence и crash recovery. CLI остаётся adapter; acceptance выполняется через приложение.

## Приёмка

- **ROL-01:** effective instruction manifest показывает точные version refs, delivery mode и actual binding; соседняя Task не получает роль/память первой.
- **ROL-02:** analyst на противоречивом brief выдаёт conflict/unknown/options, а не SDD с выдуманными заглушками; accepted SDD имеет двустороннюю traceability.
- **ROL-03:** router автоматически выбирает роль из request/Project/Task/stage/resource context, показывает reason/confidence и не переключает активный turn; новый captured binding на safe boundary сохраняет Task/Todo/queue/artifacts.
- **ROL-04:** model/reasoning показывают requested/actual; unsupported значение не выглядит применённым.
- **ROL-05:** fast задача не запускает полный ceremony; strict задача не пропускает impact/rollback/evidence gates.
- **ROL-06:** queue/steer/question различаются, свободный ответ адресен, reload сохраняет pending input и не отправляет дубль.
- **ROL-07:** memory import имеет preview/provenance/scope; конфликт не переписывается автоматически, секрет не попадает в prompt/export.
- **ROL-08:** docs/retro обновляют только затронутое и используют structured evidence; known-bad проверка ловит ложный pass.
- **ROL-09:** 400 JSON/text/HTML, 413, 429 и ambiguous timeout приводят к разным bounded recovery paths и сохраняют correlation.
- **ROL-10:** два независимых worker работают параллельно, конфликт writers предотвращён, parent завершается только после join и общей проверки.
- **ROL-11:** каталог содержит ровно 14 уникальных bundled profile ID; для каждого существуют валидные profile, GigaCode adapter и capability entry, все role references в workflows разрешаются. На целевом runtime активной считается только captured version с binding/delivery receipt; отсутствующий либо неподдержанный binding не показывается применённым.
- **ROL-12:** в composer и child controls нет ручного profile selector; role chip read-only показывает selected/captured/actual, reason/confidence/evidence. Изменение цели пересчитывает роль, смена роли не меняет permissions, model или reasoning.
- **AGT-08:** создание/запуск/queue/pause/resume/stop/retry/reconcile managed worker проходят через host Scheduler/AgentTask API и доступны из UI; ручной CLI spawn или prompt-команда не засчитываются.
- **AGT-09:** durable outbox адресует assignment/session/generation и дедуплицирует два окна/reload; `next`, verified `steer`, question answer и coordinator handoff имеют разные receipts, возможный dispatch становится `unknown` без replay.
- **AGT-10:** общий provider/project budget, bounded active/queued/depth, fair admission, DAG и lease/fencing выдерживают restart; истёкший lease не запускает конфликтующего writer, 429 соблюдает `Retry-After`/backoff/circuit без fan-out fallback.
- **AGT-11:** каждый child показывает requested→actual model/reasoning и автоматически выбранную роль/version/reason; смена настроек применяется только следующему safe attempt и не расширяет project binding.
- **AGT-12:** панель Исполнители показывает dependencies, state/current step, hold/retry reason, budget, lease/scope, result/evidence и join. Pause не маскирует running turn, Stop ждёт terminal boundary, Retry доступен только по классифицированному пути.
- **AGT-13:** coordinator routes addressed messages, принимает immutable candidate envelope, защищает conflicting writers, выполняет join и tests на интегрированных байтах; completed child сам не завершает parent.
- **AGT-14:** crash/restart восстанавливает assignments, queue/outbox, reservations, attempts, leases, pending questions/results и unknown effects; старые generation/callbacks отвергаются, возможный внешний effect сначала reconciles и не повторяется.

