# Управляемые субагенты без изменения GigaCode CLI

Дата: **2026-10-10**. Проектирование для существующего личного Electron UI; это не готовый runtime и не отчёт о проверке Windows/GigaCode. Прочитан Qwen Code commit **`4360b003a087fe9e57f6ffbe7ba48795980b59c3`**. Поддержка соответствующих возможностей **GigaCode 26.9.75 неизвестна до probe целевой сборки**. Не патчить CLI, не импортировать его private-классы, не подделывать parent capabilities. Использовать поставляемый приложением pinned runtime по [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md), без скрытого глобального fallback.

Полное управление здесь означает, что **host владеет назначением, очередью, сессией, бюджетом, отменой, принятием результата и восстановлением своих workers**. Это не обещание управлять каждым скрытым действием модели или внутренним субагентом CLI. Неизвестная граница контроля видна пользователю.

Документ детализирует M2/M5 из [плана разработки](GIGACODE_UI_DEVELOPMENT_PLAN.md), дополняет [QWEN_BASELINE](QWEN_BASELINE.md), [PARALLEL_SESSIONS_FIX](PARALLEL_SESSIONS_FIX.md), [TASK_WORKSPACE](TASK_WORKSPACE.md) и [NATIVE_WORKBENCH_MIGRATION](NATIVE_WORKBENCH_MIGRATION.md). Их WorkflowEngine и единственный writer сохраняются. Для личного UI действует personal_fast: короткие карточки, целевые live-проверки, без производственных согласований для каждого шага.

### Фактическая граница текущего приложения

В текущем `app/` уже есть полезный baseline: persisted child `Session.parentId`, отдельные ACP process/session, глобальный `maxConcurrent`, per-session FIFO, cancel с удержанием очереди, conservative unknown recovery после возможного dispatch, bounded checkpoint, deduplicated peer-message receipts и панель worker с create/open/clarify/cancel. Это нужно **переиспользовать**, а не удалять.

Полноценный control plane ещё не реализован: нет `AgentTask` и immutable assignment/attempt/result-disposition records, dependency DAG, provider quota/Retry-After circuit, durable reservations, execution/resource leases и fencing, per-child requested→actual model/reasoning, join/integrated evidence, worktree writer isolation и authoritative restart reconciliation. Текущий `agent_spawn` принимает `profileId`, но первый prompt может быть заново классифицирован обычным router; это не гарантированный captured child profile. Карточки `S8-*` остаются `planned` без evidence. Макет, интерфейс types или запуск через CLI не повышают этот статус.

Migration сохраняет работающие sessions/queues и вводит host-owned assignment слой поверх них. Внешний caller и пользователь не передают `profileId`: coordinator формулирует assignment, AI router выбирает profile/version по Task/project/resource context, host фиксирует решение и только затем создаёт binding. Model/reasoning следующего attempt могут настраиваться в UI; роль пересчитывается router и вручную не pin-ится.

## 1. Три разных вида исполнителей

| Вид | Кто владеет | Что можно обещать |
|---|---|---|
| **Managed worker** | Наш Scheduler/SessionService; отдельные AgentTask, chat и ACP session | Контроль своей очереди, binding, сообщений, budgets, принимаемых artifacts и доступных permission callbacks; это основной путь M5 |
| **Native subagent CLI** | Внутренний runtime Giga/Qwen, вызванный его агентом | Только реально раскрытые операции/события. Файл профиля и текст prompt не дают host отдельную кнопку pause/retry или изоляцию tools |
| **Qwen live-host / HTTP daemon** | Отдельный upstream control plane | Отдельный проверяемый adapter, только если такой интерфейс действительно есть в целевом продукте. Не стандартный ACP и не обязательная зависимость нашего UI |

Не отображать native child как fully managed только потому, что его имя найдено в tool output. Хранить `execution_kind` и `control_capabilities`; неподдержанные кнопки скрывать либо объяснять. Если worker способен создавать скрытых native children, общий счётчик показывает ограниченность покрытия. Для строгого общего лимита такую делегацию нужно отключить подтверждённой штатной настройкой/permission policy; prompt-запрет не считается enforcement. Если это невозможно, не утверждать, что host ограничивает весь внутренний fan-out.

### Что подтверждено исходниками

| Источник pinned Qwen | Значение для нашего проекта |
|---|---|
| [`acpAgent.ts:3926`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L3926), [`prompt:7038`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7038) | Map сессий и адресация prompt по sessionId; это основание для отдельных workers, не доказательство безошибочного multiplex в форке |
| [`Session.ts:5342`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5342), [`drain:5406`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5406) | Новый prompt прерывает предыдущий и ждёт его; host держит один активный turn на сессию, сообщение worker не отправляется вторым prompt поверх первого |
| [`initialize:5468`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L5468), [`cancel:7183`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7183) | Upstream объявляет load/list/resume; cancel адресует сессию, включая admission wait. Обе возможности нужно отдельно проверить в Giga |
| [`sub-agents.md:213`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/docs/users/features/sub-agents.md#L213), [`fork:42`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/docs/users/features/sub-agents.md#L42) | Native определения — Markdown/frontmatter; fork может наследовать разговор. Наш bounded worker packet не обязан использовать native fork или копировать его историю |
| [`SubagentExecutor:27`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/agents/runtime/subagent-executor.ts#L27) | execute/external inputs/AbortSignal — внутренний интерфейс, не доступный приложению ACP API |
| [`live control types:94`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/qwen-live/src/subagents/types.ts#L94), [`daemon-connection.ts:419`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/live-host/src/main/daemon-connection.ts#L419) | Live-host имеет list/stop/permission, capability `subagentsControlV1`, проверку instance и POST `/live/subagents` с auth. Это не доказательство start/pause/resume/retry через ACP |
| [`retry.ts:99`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/utils/retry.ts#L99), [`provider:110`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/openaiContentGenerator/provider/default.ts#L110), [`stream budgets:697`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/llm-chat.ts#L697) | Уже есть несколько внутренних слоёв retry. Внешний повтор целого prompt создаёт дополнительное исполнение, а не продолжает прежний retry |

Никакие перечисленные private методы не вызывать из UI. Для target probe сохранять очищенные handshake/schema/версии и наблюдаемый результат; при unknown использовать последовательный режим или явно отключённую возможность.

## 2. Сущности и один источник состояния

`Project → Task → role assignment / AgentTask → execution attempt → chat + session binding → Turn → Operation`. Role не равен новой Task. Worker — дочернее назначение той же цели; его запуск не создаёт новый пользовательский Task или workflow run ради обнуления ограничений. **Содержательный coordinator — текущий основной агент с действующим профилем**, который планирует, уточняет контракты и соединяет результаты. Это не десятая роль и не обязательный дополнительный CLI-процесс. Детерминированные Scheduler/Task writer/SessionService исполняют и проверяют его допустимые proposals; не вызывают LLM на каждое событие.

Ниже предлагается внутренняя versioned схема host, **не дополнительные поля ACP**. Использовать существующие сущности/имена прототипа, если семантика совпадает.

| Сущность | Минимальные данные |
|---|---|
| AgentTask | id, projectId, taskId, parentAssignmentId, role/profile version, цель, acceptance refs, dependencies, assignmentRevision, run/stage/attempt refs либо явный standalone, scope, output contract, budgetRef |
| Input snapshot | accepted requirement revision, source commit **и dirty fingerprint**, input evidence hashes, artifact versions, разрешённые пути/действия, profile/tool-policy/model settings fingerprints |
| Execution attempt | executionId, AgentTask id/revision, lease epoch, status из M2, timestamps/deadline, captured packet hash/settings, binding, transport attempts, content attempt ref, outcome/reconcile refs |
| Binding | process owner/id/start identity, pinned runtimeRef, connection generation, ACP sessionId, chatId; sessionId не глобально уникален |
| Turn / Operation | turnId + RPC request key; operationId, target, intent, dispatch evidence, outcome, idempotency/reconcile policy; локальный ID не приписывается серверу |
| Result envelope | AgentTask/revision, executionId, исходные run/stage/revision/attempt_id, base/input fingerprints, immutable artifacts, checks/evidence, unresolved questions, known limitations |
| Scheduler record | queue order/dependencies, hold reason, lease owner/epoch, notBefore/deadline, quota reservations, counted attempts, cancellation intent; всё переживает restart |

Workflow сохраняет **ready, waiting_input, blocked, needs_rework, blocked_budget, cancelled, completed**. M2 execution statuses живут отдельно. Результат worker может быть candidate/accepted/rejected/obsolete, даже когда его генерация completed; это disposition артефакта, а не новый workflow status. Единственный WorkflowEngine принимает submit/rework/resume/cancel; Scheduler не переводит этап в completed сам.

Все команды проходят existing backend writer с operationId и expected revision. Команда из второго окна с устаревшей revision отклоняется; повтор того же локального operationId возвращает receipt, а не ещё один dispatch. Приём child result не меняет его старую revision на текущую автоматически.

Минимальный внутренний service contract: `createAssignment`, `enqueue`, `list/get`, `queueMessage`, `pauseQueue/resumeQueue`, `requestCancel`, `retryOrReconcile`, `submitCandidate` и `integrate`. Это методы native host, не ACP RPC и не CLI commands. UI вызывает их через узкий IPC. Для самостоятельного делегирования основным агентом реализовать один реальный путь: валидируемое structured proposal, которое исполняет backend, либо собственный scoped MCP broker с опубликованной schema и проверенным подключением Giga. До подключения не писать в prompt, что инструменты уже доступны. Broker получает Task/parent/resource scope от authenticated binding, не доверяет произвольному projectId/profileId/permission из текста модели; запрещает произвольный spawn/argv и повышение разрешений. Роль/version присваивает router, а результат содержит receipt и доступные host controls, не только свободный текст.

## 3. Жизненный цикл: таблица для реализации

Использовать перечисление состояний M2 без отдельной конкурирующей worker state machine. `queue hold` — поле Scheduler (`user_pause`, `dependency`, `quota`, `circuit`, `unresolved_effect`), а не новое состояние workflow.

| Событие / исходное состояние | Следующее состояние и действие |
|---|---|
| Новое разрешённое назначение | queued; записать входы/бюджет/dependencies, ничего не отправлять до admission |
| queued, dependencies приняты, нет hold, квоты/lease доступны | starting; одной транзакцией резервировать slots и execution identity; подготовить проверенный binding и packet |
| starting, durable dispatch intent сохранён, передача началась | running; хранить промежуточный dispatch phase. Если нельзя доказать, что байты не ушли, сбой трактуется как unknown |
| running → настоящий external/provider permission request | waiting_permission; сохранить привязанный callback/options. При default `auto_allow_bound` bound MCP/tool вызовы выбирают реальный `allow_*` без modal; утверждение модели «жду разрешения» не создаёт настоящий permission request |
| waiting_permission → валидный ответ владельца | running; отклонённый/просроченный ответ не разрешает иной запрос; итог определяется реальным ответом CLI |
| Подтверждённое ожидание retry | waiting_retry; хранить чей retry и known notBefore. Если CLI не передаёт такую информацию, оставить running с нейтральным ожиданием |
| waiting_retry → разрешённое продолжение | running для живого CLI turn; starting для своей безопасной недоставленной операции. Не выполнять второй prompt |
| queued → Cancel | cancelled без ACP dispatch; сохранить причину и очередь зависимых работ |
| starting/running/waiting_* → Cancel | cancel_requested; остановить свои retry timers/новые отправки, адресно запросить отмену только если есть соответствующий live turn |
| Исходный prompt дал terminal response | completed/failed/cancelled по факту response, не по желаемому исходу кнопки; затем принять/отклонить result отдельно |
| Transport exit/EOF, dispatch мог состояться, terminal не получен | interrupted_unknown; удержать неопределённые effects и запрет повторного исполнения, начать reconciliation |
| Нужна сверка после сбоя | reconciling; читать journal/files/external operation status через разрешённый adapter; не запускать модельный повтор как проверку |
| Reconciliation нашёл достоверный итог | completed/failed/cancelled с evidence; если итог не установлен, вернуться к interrupted_unknown/видимой блокировке, а не назначить успех по timeout |
| failed/cancelled/completed, требуется новая работа | Старый attempt не переписывать; создать следующий только по отдельному разрешённому продолжению/исправлению, сохранив общий budget |

Для отмены в starting, когда достоверно ещё не было dispatch и не осталось принадлежащего запуску процесса/эффекта, host сам завершает cancellation в cancelled с локальным receipt. Если отправка могла начаться, такой короткий путь запрещён.

Свободный process slot, ACP session slot, workspace writer lease и unresolved-effect lock — разные ресурсы. После подтверждённой смерти процесса можно освободить его capacity, но не считать неопределённую запись разрешённой и не выдавать конфликтующий workspace writer. Пока живой prompt не settled, его session slot не освобождается даже после отправки cancel.

Workflow cancel требует orchestration: сначала запрет новых child dispatch, затем адресные отмены active workers и применение существующей команды workflow. Один вызов workflow cancel не останавливает CLI. Workflow resume не оживляет старый process и не повторяет последний prompt; сначала reconciliation. Pending operations продолжают блокировать completed/rework по [NATIVE_WORKBENCH_MIGRATION](NATIVE_WORKBENCH_MIGRATION.md).

## 4. Admission, очередь и lease

Один Scheduler обслуживает пользовательские turns и workers. В одной транзакции он проверяет Task/assignment revisions, неотменённую авторизацию, принятие dependencies, deadlines, общий budget, quota/circuit, свободный session slot и workspace ownership. Затем создаёт execution attempt, lease и reservation. Только после commit вызывается Process/SessionService. Crash между commit и spawn оставляет восстанавливаемое starting, не потерянную карточку.

Очередь справедлива между Task: FIFO внутри задания с явным приоритетом пользователя и bounded приоритетом foreground. Старые фоновые задания не должны бесконечно голодать; reorder разрешён только до dispatch. Dependency DAG проверяется на циклы. Наличие файла не завершает dependency: нужен принятый artifact с нужными revision/hash. Изменившийся вход инвалидирует зависимое назначение; готовый старый output не перештамповывается.

Lease содержит owner instance, монотонный epoch/fencing token и срок. Renew/claim/accept выполняются CAS. Expiry означает «владелец не подтверждён», **не «старый CLI перестал исполняться»**. Новый owner сначала устанавливает судьбу старого process и операций. Fencing блокирует старые записи в наш store/managed adapter; CLI, напрямую пишущий файл или вызывающий внешний сервис, может его не знать. Поэтому takeover сам по себе не разрешает второго writer.

Не привязывать lease к активному окну renderer. Native owner process/service владеет очередью и подписками, окно только отправляет intent. Для локального приложения достаточно одного подтверждённого владельца data store; не строить распределённый кластер. После рестарта сохранять deadline/notBefore; clock jump не должен обнулять budget или делать job автоматически готовым. Внутри процесса интервалы измерять монотонными часами, восстановление проверять консервативно.

Process-per-worker — допустимая простая начальная граница сбоя; multiplex включать после live A/B/permission/cancel/config tests. Конфигурации launch-time system prompt/tool policy/runtime группировать только при доказанной совместимости. Разный обычный prompt не равен разному системному prompt. Нельзя прикрепить два workers к одной restored session ради экономии запуска.

### 4.1. Когда агент действительно распараллеливает работу

Пользователь запросил видимую полезную параллелизацию и **обязательную координацию** её ветвей. В пределах уже порученной задачи текущий основной агент самостоятельно выделяет небольшие независимые назначения и запускает доступных workers через существующий admission, когда это сокращает ожидание или даёт нужную независимую проверку. Он сохраняет ответственность за цель, общие контракты, разрешение зависимостей и итоговую интеграцию. Host не выводит общий успех просто из суммы зелёных карточек. Не просить подтверждение каждого такого разделения при действующих scope/permissions; новые внешние действия и расширение области не становятся разрешёнными от слова «субагент». Простую локальную правку выполняет один подходящий профиль. Все роли каталога не превращаются в обязательные отдельные процессы.

До запуска достаточно короткого DAG: у каждого назначения есть результат, owner, входные refs/revisions, зависимости, разрешённая область чтения/записи и общий budgetRef. Готовая схема исполняется детерминированно; LLM не решает заново на каждом token, кого запустить. Разделение имеет смысл, если назначения можно выполнить по принятым входам, их результаты можно независимо проверить и затем соединить. Подготовка зависимого шага допустима как явно предварительная, но не как принятый output по ещё неизвестному контракту.

Общий контракт закреплён acceptance/contract revision, а общая подготовительная работа имеет один owner и один output ref: не поручать каждому worker заново изобретать shared API/schema. DAG не содержит циклов; assignment count, queued count, depth и суммарный бюджет ограничены текущей policy, а не растут рекурсивно от предложений модели. Соблюдать file/workspace/resource locks §8 даже для непересекающихся на вид задач. Неясный общий контракт разбирает основной агент; круговая зависимость или два неудачных содержательных прохода ведут к сужению/предметной эскалации, не к созданию ещё одного coordinator.

Перестраивать план внутри scope можно самостоятельно: сохранить новую plan/assignment revision с причиной, проверить DAG/owners/budget, затем пометить зависимые от изменённого входа results obsolete и остановить их новые dispatch. In-flight packet не переписывается; нужную отмену/сверку провести по §7/9, особенно при writes. Новый результат старой revision не принимается как свежий. Неизменённые ветви продолжаются; доказанно применимый результат можно переиспользовать с явными input/evidence refs. Изменение принятого бизнес-контракта проходит существующий requirement/decision flow, а не скрытое расширение полномочий coordinator. Replan и новый child не обнуляют attempts.

| Разделение | Что можно делать одновременно | Где требуется join |
|---|---|---|
| Исследовать две независимые причины | Два read-only исследования разных источников с отдельными выводами | Coordinator сопоставляет свидетельства и выбирает подтверждённую причину до изменения кода; две гипотезы не объявляются двумя доказательствами. |
| Frontend и backend по принятому контракту | Изолированные patches в принадлежащих workers worktrees; общий контракт закреплён revision | Один integration writer, контрактная совместимость и адресный live smoke на объединённых байтах. Изменение контракта инвалидирует зависимые результаты. |
| Независимое ревью и проверка документации | Чтение одного immutable candidate snapshot с разными критериями | Замечания связаны с тем же candidate; автор не меняет этот snapshot под работающим reviewer. |
| Два исполнителя хотят менять один файл/ресурс | Последовательные writes либо worker готовит read-only предложение для владельца | Само различие ролей не разрешает общий mutable writer. При отсутствии изоляции не форсировать второго write-worker. |

Root и workers используют общие quota/circuit/attempt/deadline правила §5–6. Два running workers при лимите 2 допустимы, когда coordinator сейчас только принимает события как сервис; его новый LLM turn ждёт слот. Завершённая карточка не занимает active slot, а waiting_retry/permission не освобождают живой turn. Rename, split, новый child и другая модель не дают отдельный бесплатный retry budget.

**Join — принятие результатов, а не человеческое согласование по умолчанию.** Host проверяет свежесть/область/envelope, coordinator выполняет нужное содержательное сопоставление, integration writer применяет согласованные изменения и проходит адресные checks §8. Это можно делать автоматически в прежнем scope. Если нужен ответ человека, показать настоящий вопрос и его blocker; не переводить каждый completed child в фиктивное «Ожидает одобрения». Пока обязательный child pending/unknown/obsolete, общий результат не completed. Ненужное назначение отменяется/заменяется с причиной и сохранённой историей, а не отмечается выполненным.

### 4.2. Пользовательские чаты и worker lanes

User Task сохраняет цель и discussion; AgentTask — дочернее назначение, его рабочая лента не создаёт новый верхнеуровневый Task. У каждого реально отдельного worker свой binding и очередь; в одной ACP session — один in-flight prompt. Смена роли внутри последовательного шага может переиспользовать подходящий binding на безопасной границе и не обязана создавать worker. Message worker адресуется захваченному assignment/binding через [SMART_MESSAGE_QUEUE](SMART_MESSAGE_QUEUE.md), а не глобальному «активному агенту».

Независимые пользовательские Tasks разных проектов тоже могут выполняться параллельно через тот же Scheduler и общий provider budget. Их контекст, рабочие деревья, credentials scopes и permission callbacks остаются раздельными. Cross-Task/project сообщение автоматически проходит фоновый контракт [SESSION_COLLABORATION](SESSION_COLLABORATION.md): заранее разрешённая связь, источник/получатель, версия/refs и receipt. Не рассылать полный разговор или секреты соседним агентам; такое сообщение не меняет цель, не выдаёт permissions и не превращает чужой Task в child автоматически. Если связи нет, не расширять scope и не отправлять данные; лишь существенная нерешённая зависимость требует вопроса человеку. В рамках существующей link policy обмен и ответы выполняются без согласования каждого message, без отдельной peer-панели/переписки в обычном UI.

## 5. Retry: владелец, бюджет, неопределённые effects

Сначала классифицировать **конкретную операцию**, а не всё AgentTask. Хранить `retry_owner`, classification, evidence, attempt count, notBefore, deadline и cancellation. Содержательное исправление кода, новый transport connect и HTTP retry модели — разные счётчики. Попытки CLI неизвестны, если он их не раскрывает.

| Ситуация | Разрешённое действие host |
|---|---|
| Spawn/connect до доказанной отправки prompt | Bounded retry того же launch/connect с новой connection generation; перед повторным spawn проверить, не появился ли уже первый process |
| CLI жив и сам ждёт 429/stream recovery | Наблюдать, ограничить новые admissions, сохранить cancel. Не посылать тот же prompt в другую сессию |
| EOF/timeout после возможного dispatch | Unknown → reconcile; не повторять ни prompt, ни MCP write на основании сетевой ошибки |
| Реально read-only host operation с безопасной семантикой | Bounded retry adapter по его контракту; даже чтение повторно учитывается в budget/quota |
| Idempotent remote operation | Повтор допустим только при подтверждённом API idempotency contract с тем же key, тем же payload/resource и в пределах retention; сначала использовать status lookup, если доступен |
| Remote write без такой гарантии | Искать фактический результат по operation/external ID, revision или business key. Неоднозначность сохранять; обычный hash prompt не является idempotency key сервера |
| Auth/permission/config/schema error | Fail-fast с предметной причиной; после исправления — явное продолжение, без бесконечного retry |
| Результат неверен по acceptance | Диагностика и следующая содержательная попытка по existing rework rules; не transport retry |

Стартовая host policy согласована с M2: **до 3 повторов после первой безопасной попытки и до 120 секунд автоматического ожидания**, configurable; это не лимиты CLI и не обещанный SLA. Delay — bounded exponential backoff с jitter. Если реально доступен валидный Retry-After, не повторять раньше него; когда срок выходит за budget, остановить auto retry и показать время/следующее действие. Не извлекать authoritative HTTP headers из случайного текста модели.

Для неопределённого результата нельзя сделать exception только потому, что prompt назывался «прочитать»: реальная tool policy должна исключать writes. Даже такой повтор выполняется лишь после прекращения/изоляции старого исполнения и как новая наблюдаемая попытка с учётом возможной двойной стоимости, не как доказанное exactly-once продолжение. По умолчанию unknown prompt автоматически не пересылается.

Перед собственным эффектом durable `action_started` с operationId/intent/target/reconcile; после — `action_finished` с проверенным outcome либо `action_unknown`. ACP может не раскрывать скрытые CLI actions: логировать только наблюдаемое, не генерировать вымышленные pre-events. Если полнота наблюдения неизвестна, неизвестны и внешние effects; blocked безопаснее ложного «ничего не было».

## 6. Общая квота и circuit breaker

Ключ квоты — фактический provider/account/endpoint scope, без секрета в ID; связанные aliases не получают независимый лимит автоматически. Несколько окон одного приложения используют один quota owner. Чужие приложения и скрытые native requests нельзя полностью посчитать; coverage отображается честно.

Начальная настройка M2 — **до 2 одновременно активных managed turns на общий quota scope**, с уменьшением до 1 при подтверждённом давлении 429. M5 допускает основного агента-coordinator и **до 2 workers**, глубина 1, но они проходят **тот же** лимит. LLM turn основного агента занимает слот; детерминированная обработка событий backend-сервисом — нет. Два workers плюс пользовательский чат не означают три свободных слота.

Отдельно ограничивать active processes/RSS, queued jobs, aggregate task deadline, суммарные содержательные attempts и подтверждённый расход. Reservations освобождаются транзакционно один раз. Внутреннее ожидание retry удерживает reservation, пока turn может самостоятельно возобновиться; waiting_permission тоже не доказывает, что запрос завершён. Без поддержанного CLI budget hook host не обещает жёсткий потолок токенов скрытого запроса: он ограничивает admissions, наблюдает usage и запрашивает отмену по своей политике.

Circuit breaker относится к **новым безопасным admissions provider scope**, а не переписывает statuses уже живых turns. Состояния closed/open/half-open — состояние quota policy, не workflow. Пример стартовой настраиваемой политики: три подтверждённых capacity/transport failures за 60 секунд → open; cooldown не менее 30 секунд и наблюдаемого Retry-After; затем одна разрешённая проба. Это проектные значения, не замер сервиса. Probe — следующая разрешённая реальная работа либо документированный безопасный health call, не платный LLM ping на timer. Успех постепенно возвращает лимит; очередной capacity failure открывает breaker снова.

Auth error останавливает соответствующий provider до исправления credentials, а не запускает half-open loop. Если источник 429 неизвестен, не менять квоты всех providers. При отсутствии retry/countdown telemetry показывать «CLI ожидает/соединение проверяется» без выдуманного номера попытки. Cancel отменяет собственные timers; restart не сбрасывает circuit/budget. Новые children не обходят отказ parent budget и не порождают бесконечное дерево.

## 7. Cancel, pause, сообщения и смена роли/модели

**Queue pause** немедленно запрещает новые dispatch выбранной Task/worker scope, сохраняя задания. Текущий turn продолжает работу: UI пишет «После текущего ответа». Это не обещание заморозки вычисления и не выдуманный ACP `pause`. Для остановки текущего ответа есть отдельная Cancel. Возобновление очереди снимает hold после проверки revisions/authorization/dependencies; оно не replay старого unknown prompt.

Cancel адресуется captured binding, включая generation; поздний click старой карточки не отменяет новый worker. Закрыть stale permissions по реальному callback contract; принимать только предложенный option ID от разрешённого владельца, один раз. После cancel continue receiving terminal/events нужного turn. Подтверждённый завершившийся результат может прийти раньше отмены — записать фактический outcome, не подделывать cancelled.

Если graceful cancel не завершился, показать продолжающуюся отмену/unknown. Terminate — отдельная операция для принадлежащего host процесса с явной областью поражения; не применять по каждому timeout и не убивать общий multiplex process ради одного worker. Даже подтверждённая смерть процесса не откатывает выполненный Git/MCP эффект. Remote operation может продолжаться после неё.

Человеческое **«Уточнить поручение»** в карточке worker создаёт versioned queued input с captured назначением; по умолчанию отправляется после текущего turn. Это управление assignment, а не интерфейс peer-переписки. Автоматические coordinator/worker сообщения используют тот же backend/queue через фоновый broker и не требуют пользовательского ввода. Live steering включать лишь при проверенном target API и отдельно объяснённой семантике. Изменение acceptance/области задачи — новая requirement/assignment revision и invalidation, а не незаметное редактирование уже работающего packet.

Роль автоматически пересчитывается по [ROLE_ROUTING](ROLE_ROUTING.md); model/reasoning настраиваются по [MODEL_AND_REASONING_CONTROLS](MODEL_AND_REASONING_CONTROLS.md). Host показывает reason/confidence и requested→actual, применяет изменения после safe boundary и сохраняет captured settings для turn/retries. Ручного role selector нет, в том числе у child. Новый binding при необходимости остаётся внутри той же Task, с теми же обязательствами/budget. Resume, rollover и rename worker не обнуляют попытки. Кнопка Retry доступна только для классифицированного безопасного действия либо явно подготовленного нового содержательного назначения; нет универсального «Повторить всё».

## 8. Workspace, permissions и принятие результата

У каждого write-worker отдельный worktree/checkout с зафиксированным base и принадлежащим ему diff, когда Git позволяет. У существующего dirty дерева сначала сохранить и описать состояние; не делать reset/clean/stash чужой работы автоматически. Если нет проверенной изоляции, один writer и последовательные изменения; параллельно — только реально ограниченные read-only исполнители. Разные директории worktree разделяют изменения, но не являются OS sandbox: `.git`, внешние пути, credentials и remote APIs могут быть общими.

Host проверяет свои Git/browser/MCP/IPC dispatch по Task authorization, captured project binding, parent assignment scope, actual tool binding, resource/environment, exact target и central policy revision. Роль выбирает инструкции/workflow, но не расширяет и не урезает bound capabilities. Для direct CLI tools использовать подтверждённые штатные permissions. Если общий shell обходит заданные пути, список allowedPaths в prompt не даёт техническую гарантию. Worker без нужной доказанной границы не получает отметку «изолирован». Remote write-workers, credentials scopes и Jenkins/OpenShift targets могут конфликтовать даже с разными worktrees: нужны отдельные resource locks и проверенные environment permissions.

Integration принадлежит одному host-owned writer:

1. Получить result envelope и сохранить candidate artifacts неизменяемыми байтами с hashes. Слова «готово/тесты прошли» не принимаются как evidence.
2. Проверить execution/lease ownership, assignment revision, run/stage/revision/attempt_id, входные hashes/base, допускающий submit статус run и отсутствие unresolved effects. Поздний output отменённого назначения не интегрируется автоматически. Старые результаты сохранить для просмотра как obsolete; не перезаписать ревизии.
3. Сопоставить diff с разрешёнными путями и изменившимся целевым деревом. Конфликт — новая предметная интеграционная работа; не автоматический force/merge в main. Не затереть пользовательский dirty diff.
4. Провести acceptance checks на **интегрированных байтах**. Тесты worker полезны, но не доказывают совместимость двух patches. Для backend/UI — targeted regression/общий smoke по влиянию; для чистого исследования проверить источники и completeness.
5. Только через существующий ArtifactService/WorkflowEngine принять output/submit. Child completion сам по себе не завершает workflow stage или Task. Содержательный rework использует existing invalidation и общие limits.

Интеграция локальных авторизованных изменений может идти автономно. Публикация, deployment и несвязанные оптимизации следуют действующей области задачи; не добавлять повторное подтверждение каждой обычной правки. Строгие правила других рабочих проектов сохраняются по [CHANGE_SAFETY](CHANGE_SAFETY.md).

## 9. Crash recovery и компактный контекст

Восстановление выполняется сервисом, без LLM на чтение каждого journal event:

1. Открыть последний committed checkpoint + tail, проверить schema/integrity и единственного writer. Восстановить queue, counts/reservations, leases, cancellation, deadlines, pending effects и result candidates.
2. Сверить принадлежащие host процессы по process identity/start time/runtime/path, не одному PID. Не убивать совпавший чужой PID. Известный живой orphan блокирует takeover соответствующего writer, пока не восстановлен контроль или не установлен его исход.
3. Новый transport получает новую generation. Старые RPC replies/permissions/events не разрешают новые операции. Update с неизвестным owner остаётся диагностикой, а не applied state.
4. Поддержанный load/resume сначала проверить на target; восстановление истории не доказывает отсутствие работающего старого prompt и не гарантирует продолжения in-flight tools. Direct stdio старого процесса может быть недоступен новому owner — не обещать reconnect к потерянному pipe.
5. Сверить внешние effects через read-only status/evidence. Доказанный итог закрывает operation; неоднозначность оставляет interrupted_unknown и объяснение. Новый процесс, новая сессия или истёкший lease не являются reconciliation.
6. Возобновить только доказанно недоставленные queued задания с актуальными входами/разрешениями. Для нового binding подготовить bounded handoff; исходный prompt автоматически не пересылать. Окна получают согласованный snapshot + sequence tail, а не создают работников заново.

Каждый packet содержит одну цель, текущую роль/этап, accepted requirement revision, relevant constraints, разрешённые действия, несколько source/evidence refs с hashes, acceptance, открытые вопросы и delta предыдущей попытки. Общая память scoped global + текущий project и служит навигацией к источникам. Не передавать полный журнал, все 14 профилей, все workflow, весь MCP каталог или весь SDD каждому child.

Применять [FLASH_MODEL_EXECUTION](FLASH_MODEL_EXECUTION.md) и [CONTEXT_BUDGET](CONTEXT_BUDGET.md): учёт total input с системными/tool overhead, actual/estimated/unknown, 256k не универсальный denominator, rollover только на safe boundary. Все наблюдаемые шаги сохраняются вне контекста; большие payloads — immutable refs. Checkpoint сохраняет constraints, pending effects, questions и непринятые рекомендации. Model summary не становится авторитетным источником и не очищает blockers.

## 10. Видимая параллельная работа в разговоре и панели

Разговор остаётся основным экраном. Когда есть child assignments, рядом с текущей активностью показать одну компактную строку: например, **«Исполнители · 2 работают · 1 завершил»**. Click открывает панель **«Исполнители»** через существующий правый rail/PanelRegistry; не нужен переход в отдельный dashboard. Счётчики вычисляются из актуальных execution records выбранной Task, не из количества карточек в mock. Дополнительно показывать queued/needs attention, когда они есть; completed означает terminal worker, не принятый общий результат. Selection панели не меняет получателя composer.

В панели сверху короткая coordinator strip: **«Основной агент · <текущая роль>»**, фактическое состояние/модель и следующий общий шаг. Ниже две или нужное небольшое число связанных ветвей и строка join: например, «Интеграция ждёт 1 результат». Если основной агент сейчас только ждёт, не показывать его как выполняющий LLM-запрос. Это компактная проекция DAG/ownership, не новый task dashboard; завершённые ветви можно свернуть. По click на join видны конкретные недостающие/устаревшие inputs и ответственный основной агент.

Панель поддерживает обычные hide/move/resize/tab/layout правила, без новых владельцев процесса. У назначения стабильная компактная карточка либо строка с раскрытием:

| Видимая часть | Источник и смысл |
|---|---|
| Имя и роль | AgentTask/assignment, краткая цель; роль не маскирует неизвестный execution kind. |
| Модель и состояние | Фактически подтверждённая модель, при pending — отдельно requested; состояния §3 и [TASK_ACTIVITY_INDICATORS](TASK_ACTIVITY_INDICATORS.md). Дуга только для реальной активности, clock/вопрос/unknown различаются. |
| Текущая работа | Последний текущий шаг из agent plan либо структурированный tool title/path. При отсутствии данных — «Работает; действие не сообщено», без выдуманного «анализирует архитектуру» по таймеру. |
| Зависимость / прогресс | Конкретная причина ожидания и получатель join; при наличии известный elapsed. Нет искусственного процента завершения и LLM-summary каждого token. |
| Результат | Ссылка на реальный candidate artifact/diff/отчёт и disposition `candidate/accepted/rejected/obsolete`; completed worker может ещё ждать интеграции, но не автоматически пользователя. |
| Действия | **Открыть работу**, **Уточнить поручение**, **Pause/Resume queue**, **Stop**, **Retry/Reconcile** только по классифицированному пути, **Результат** после реального ref. Priority и model/reasoning меняются для следующего safe attempt; role read-only. Pause не выдаётся за заморозку running turn, Stop меняется на «Останавливается» до terminal. |

В раскрытии: входные refs/revisions, read/write scope, связанная worker-лента, результат/checks, pending operations, timeline и бюджет. Diagnostic IDs доступны там, не заполняют основную карточку; секреты/raw env не выводить. Native children имеют отдельную отметку и только реально раскрытые controls. Не рисовать кнопки cancel/message для непрозрачного native child как работающие.

**Уточнить поручение** открывает небольшое поле для текущего назначения с его названием. Оно создаёт addressed queued input/receipt; при активном turn текст ждёт безопасной границы, если нет verified steering. Это опциональное управление со стороны человека; coordinator сам обменивается нужными данными с workers через §4.2 без ручного выбора получателя/отправки каждого message. Ответ на живой question/permission идёт через его настоящий callback вне обычной очереди. Уточнение одному worker не broadcast, не смена глобальной роли и не start duplicate run. После человеческого submit показывать сохранено/доставлено согласно фактам, не утверждать прочтение моделью по одному click.

Служебные coordinator↔worker/peer messages не показываются отдельным inbox/outbox, right-rail инструментом, composer или bubble в основном разговоре и не создают уведомление на каждый ack. Их payloads/receipts остаются в durable audit/debug и доступны адресно при диагностике с bounded scope. Пользователь видит актуальную работу, проверяемый результат и настоящие blockers; это не отказ от observability и не скрытое расширение полномочий.

При значимом start, blocker или получении child result в основной разговор добавляется компактное событие со ссылкой на ту же карточку/версию результата; не переписывать весь worker transcript в root. Пример смысла: «Frontend передал изменения — интеграция ещё не выполнена». Открыть result не значит accept; принять внутри разрешённой задачи может coordinator через §8, без обязательного человека. Результат, вопрос и artifact сохраняют свою source identity после restart.

Coordinator сначала разрешает worker question по принятым требованиям/источникам в своём scope. Только настоящий blocker, требующий человека, появляется в **Task/question-bound overlay поверх разговора** с автором, влиянием и evidence; inline entry открывает его повторно. Есть варианты и свободный ответ; minimize сохраняет draft/pending и не считается ответом. Отдельной Question dock/right-rail панели нет. Ответ versioned и направляется только нужным назначениям; диалог неизвестного CLI не получает автоматически ответ от имени пользователя. Известное согласование применяется в своей области, новое не фабрикуется. Hide/reload окна не отменяет worker; Exit следует принятой политике приложения, без скрытого kill. Родительский check «Завершено» недопустим при обязательном pending/unknown child.

Для макета допустима ясно помеченная fixture **2 running + 1 completed**, чтобы пользователь сразу видел рисунок параллельной работы, роли/модели/current activity и действия. Это демонстрационные records, не живые Giga sessions и не evidence SA7. В настоящем пустом Task не создавать декоративных workers: показать спокойное empty state. M3 может показать реально доступные наблюдаемые назначения; полноценные managed controls принимаются в M5 после SA0–SA6, не обещаются только по готовой панели.

## 11. Малые карточки реализации для Flash-модели

Каждая карточка: один contract, 1–3 затронутых компонента, реальные paths из прототипа, failing сценарий, затем минимальное изменение и evidence. Не выдавать весь документ одной командой «реализуй всё».

| Карточка / зависит от | Что сделать | Завершение |
|---|---|---|
| **SA0**, M0/M1 | Probe target runtime/ACP, capabilities, два отдельных sessions, route/cancel; inventory native tools/permissions | Recorded supported/unsupported/unknown matrix, live независимость A/B, без изменений CLI |
| **SA1**, SA0 + existing Task writer | AgentTask/execution/result DTO, migration schema, CAS + read-only projections | Restart восстанавливает данные; stale/duplicate command не создаёт второй execution |
| **SA2**, SA1 + M2 | Общая admission очередь, текущий агент-coordinator и небольшой versioned DAG, quota reservation, lease/fencing | Coordinator и workers делят лимит; циклы/разрастание/конфликтующие writers отклонены; shared contract закреплён, replan инвалидирует только зависимое |
| **SA3**, SA2 | Один worker adapter через SessionService, bounded packet, durable dispatch, terminal result | Один prompt на session; результат остаётся candidate до проверки |
| **SA4**, SA3 | Cancel, queue pause, queued message, settings capture/readback | Cancel одного не гасит другого; pause не выдаётся за заморозку; старый callback отвергнут |
| **SA5**, SA4 | Retry classifier, budget/notBefore, shared breaker, restart reconciliation | Fault cases ниже проходят без повторного unknown write и без сброса counters |
| **SA6**, SA3 + workspace adapter | Worktree ownership, candidate import, diff/base checks, один integration writer | Два patches интегрированы и проверены на общем результате; stale/conflict сохранён без потери |
| **SA7**, SA4–SA6 | Inline count + панель «Исполнители», main coordinator/ветви/join, auto-role reason, requested→actual model/reasoning, current activity, pause/resume/stop/retry/reconcile, child-result refs | Два реальных независимых workers видны одновременно; третий завершённый результат отдельно от acceptance, parent не получает ложный check, reload не порождает новые процессы; unsupported control честно недоступен |

Не запускать автоматически процессы для всех ролей. Сначала один worker, затем два независимых; глубина 1. Reviewer нужен для содержательного риска, не каждой косметической правки. После двух содержательных неудач конкретного цикла по Flash policy сохранить evidence и сузить/эскалировать задачу; не создавать новое имя child, чтобы получить ещё две попытки.

## 12. Fault tests и критерии приёмки

Unit/contract fault tests выполняются через собственный adapter и управляемые clocks/fixtures; это simulated evidence. Реальный Windows/Electron/Giga happy path и адресная отмена — отдельные live tests с build/runtime/model/provider, IDs, timestamps, actual results. Не создавать нагрузку на рабочий provider ради 429.

| Сценарий | Обязательный наблюдаемый результат |
|---|---|
| Два окна одновременно start одной revision | Один execution/dispatch; второе получает тот же receipt либо conflict, не второй child |
| A и B stream; отменить A; сразу поставить A2 | B продолжает. A2 ждёт settlement A; cancel_requested не освобождает session slot |
| Queue pause во время running, затем restart | Running не объявляется frozen; новые dispatch отсутствуют до явного resume; queued input сохранён |
| Automatic route меняется во время active child turn | Текущий attempt сохраняет captured profile/version; новый route с reason/confidence pending до safe boundary. UI не предлагает ручной profile selector, permissions/model/reasoning не меняются от role decision |
| Child assignment создан coordinator | Host router фиксирует profile/version и input factors до binding; первый prompt не перетирает роль fallback-классификацией. Requested→actual model/reasoning читаются обратно и видны в карточке |
| Клиентский timeout после возможной отправки | Interrupted unknown, **ноль автоматических повторов prompt**; виден reconcile путь |
| Remote write выполнен, ответ потерян | Status lookup находит один эффект либо остаётся unknown; ни второго write, ни ложного pass |
| Падение между durable intent, spawn, dispatch и result commit | Каждая граница отдельно; очередь/lease/receipt восстанавливаются, неизвестный dispatch не классифицируется как недоставленный |
| Lease истёк, старый process ещё жив | Новому owner запрещён конфликтующий dispatch; старый result не принимается с новым fencing token |
| Старые generation/permission callbacks после reconnect | Ни записи, ни разрешения нового действия; диагностическое событие с причиной отказа |
| Подтверждённый 429, Retry-After, auth error | Общий scope учитывает чаты и workers; CLI retry не дублируется; ожидание bounded, auth fail-fast |
| Два окна управляют одним assignment | Pause/resume/stop/retry используют expected revision и один operation receipt; stale click не создаёт второй dispatch, retry timer или cancel другого worker |
| Cancel во время своего retry timer / app shutdown | Timer больше не отправляет операцию; reservation освобождается ровно один раз при соответствующем исходе |
| Родитель исчерпал budget, child предлагает нового child | Отказ admission, counters прежние; resume/restart/model switch не дают новый budget |
| Изменён requirement/input/base, child прислал старый output | Obsolete/rejected с сохранённым артефактом; никакого restamp или accepted stage |
| Два worktrees меняют общий контракт | Integration проверяет общий diff/tests; clean worker tests недостаточно; dirty пользовательский diff не потерян |
| DAG A/B → integration, B ещё работает | A result становится candidate; root показывает обе ветви, не завершает Task; join проверяет объединённый результат после нужных inputs |
| Coordinator меняет общий контракт/план при работающем B | Новая revision и адресная invalidation, старый packet/result не переписаны; writes reconciled, независимая ветвь продолжается, бюджет не сброшен |
| Inline count и панель, переключение Task, сообщение/отмена A | Счётчик относится к выбранной Task; captured адресат A сохраняется, B продолжает; worker-ответ связан с тем же result ref, не дублируется как новый Task |
| Role change или микро-правка без независимой работы | Нет обязательного нового CLI child или запуска всего каталога ролей; один исполнитель и достаточная адресная проверка |
| Недоступный MCP, скрытая native delegation, отсутствующая telemetry | Unknown/unsupported и ограниченное coverage; не fake isolated/0 tokens/точный retry countdown |
| Три context rollovers и restart | Task/attempt/budget/scope/questions/pending сохраняются, полного history clone и replay неизвестного prompt нет |

**Контроль измерителя:** clean — две безопасные независимые работы завершаются и дают один принятый интегрированный результат; known_bad — fixture намеренно дублирует dispatch/подменяет generation или evidence revision, проверка обязана упасть; empty — нет событий/реальных запусков, результат «не проверено», не pass. Число выполненных сценариев, retries, external-effect receipts и конфликтов фиксировать отдельно; test count 0 не зелёный отчёт.

Измерить baseline и после изменения: queue wait, process cold start, active managed count, время восстановления, context pack size, принятые результаты/содержательные попытки и расход с известным coverage. Не обещать ускорение, exactly-once внешних effects или отсутствие регрессий заранее. Готовность M5 означает доказанные lifecycle/recovery/isolation boundaries собственных workers на целевой сборке, а не наличие кнопок и prompt-файлов.
