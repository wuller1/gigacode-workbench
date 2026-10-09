# Фоновое сотрудничество сессий и проектов

Статус: обязательная функция в плане реализации, **не установленный MCP и не проверенное поведение GigaCode 26.9.75**. Дата: **2026-10-10, уточнение пользователя: обмен работает автоматически в фоне**. Сессии frontend/backend обмениваются вопросами, контрактами и результатами внутри одного проекта и между заранее разрешёнными связанными проектами. Пользователь видит ход задачи, итог и настоящие блокеры, требующие его решения; приложение сохраняет технический обмен после restart для восстановления и аудита. CLI остаётся неизменённым.

Основы: [Task](TASK_WORKSPACE.md), [умная очередь](SMART_MESSAGE_QUEUE.md), [Artifact/Question](ARTIFACTS_AND_QUESTIONS.md), [роль и права](ROLE_PROMPT_BINDING.md), [managed workers](MANAGED_SUBAGENTS.md), [контекст](CONTEXT_BUDGET.md). Предлагаемый MessageBroker использует existing Task writer, EventStore, ArtifactService и SessionService. Он маршрутизирует данные и delivery receipts, не создаёт второй WorkflowEngine, отдельную историю файлов или новую машину исполнения turn.

## 1. Автоматический путь без отдельного пользовательского чата

Пользователь поручает работу текущей Task. Основной агент-координатор определяет полезную зависимость, например требуемую frontend версию backend API, и в пределах уже разрешённой связи вызывает реальный broker/agent tool. Host проверяет адреса, scope, данные и budget, сохраняет message, доставляет на безопасной границе и связывает ответ с dependency/result. Полученный контракт проверяется и используется в обычной работе; пользователь не обязан выбирать peer, составлять служебное сообщение или пересылать ответ вручную.

**В обычном UI нет broker inbox/outbox, списка адресатов, peer composer, правой кнопки «Обмен сессий» или bubble для каждого служебного сообщения.** Outbox/inbox ниже — backend записи, а не продуктовые панели. Автоматизация не делает новый LLM call ради подписи/уведомления каждого сообщения. Главная Task показывает только полезную сводку прогресса, например «Frontend ждёт контракт API», затем общий результат/материал. Технический обмен не создаёт unread-dot или системное уведомление на каждый message/ack/retry.

Если возникло решение, которого нет в принятых требованиях или полномочиях, coordinator формулирует один настоящий Task-bound вопрос с влиянием/вариантами/рекомендацией через действующий Question flow. Он не пересылает пользователю каждый вопрос другого агента. Обычные уточнения контрактов, чтение доступных источников и согласование зависимостей внутри scope выполняются автоматически. Worker status/details/cancel остаются видимыми; человеческое «Уточнить поручение» в карточке управляет назначением и не открывает peer chat.

Техническая переписка, адреса, payload refs и delivery receipts доступны адресно в audit/debug по необходимости — агенту через реально подключённый read-only diagnostic путь и при диагностике пользователю. Это не постоянно открытая лента и не полный transcript в каждом prompt. Доступ к audit сохраняет scope/redaction/bounded reads. Первичная настройка cross-project link остаётся отдельным коротким действием с областью обмена; после неё разрешённые сообщения не требуют каждого approval.

## 2. Устойчивые адреса и ограниченная связь проектов

| Сущность | Минимальный контракт |
|---|---|
| CollaborationLink | Stable ID/revision, source/target project IDs, разрешённые направления, Task/role scope, message kinds, payload/ref policy, auto-delivery/wake policy, срок/отзыв и основание авторизации |
| Message | Immutable `messageId`, sender project/task/discussion/assignment/session logical IDs и actor, recipient IDs, kind, content/version refs, origin, создано/срок, correlation/replyTo/causalRoot, source requirement/contract revisions, authorization/link revision |
| Outbox/Inbox | Ссылка на Message, recipient, durable sequence, queue item/operation IDs, отдельные delivery receipts/hold reason, deadline, retry/reconciliation refs; original bytes не перезаписываются |
| Binding resolution | Логический получатель → текущие execution binding/connection generation/ACP session; разрешается SessionService при dispatch, не определяется строкой title или последним активным окном |
| Thread budget | Общий causal root, parent message, depth/hops, auto-turn/time/token limits и quota reference; счётчики сохраняются при restart и смене binding |

Project → Task → assignments/sessions остаётся основной иерархией. Межпроектный разговор ссылается на две самостоятельные Task; он не объединяет их workflow runs, requirements, permissions или память. Адрес «Task X, backend assignment» может следовать её новой execution session после проверенного handoff; адрес конкретной закрытой логической сессии остаётся blocked/archived, пока не выбран явный redirect. Rename не меняет адрес, удаление/архивация не отправляет сообщение похожей по имени сессии.

Внутри проекта агент может автоматически посылать релевантные сообщения в пределах действующей project policy и авторизации работы. Это не доступ ко всем приватным Task payloads: broker проверяет право sender опубликовать выбранные данные и право recipient их читать. Между проектами пользователь один раз связывает конкретные направления и виды сотрудничества, например `frontend ↔ backend: API contracts/questions/results`; scope можно посмотреть и отозвать. Не требовать повторного согласования уже разрешённого обмена.

Входящий текст другого агента — данные/предложение с источником, **не новое разрешение владельца получателя**. Требование «задеплой/удали/прочитай секрет» не получает силы от доверенного route. Получатель выполняет действия только в собственной Task и её полномочиях; неоднозначное расширение scope остаётся proposal. Подтверждённая shared project memory не превращается в общий межпроектный пул; чужое разрешение в памяти/сообщении не переносится. Global preferences остаются отдельным существующим механизмом.

## 3. Транспорт без выдуманного ACP API

В pinned Qwen `prompt` адресуется конкретной session, updates связаны с её ID, а второй prompt может прервать первый. Это обоснование использовать существующую очередь; оно не доказывает native inter-session messaging у Giga. [QWEN_BASELINE](QWEN_BASELINE.md), [pinned prompt routing](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7038), [pending send handling](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5342).

В **один** broker поступают структурированные команды существующего coordinator/service либо вызовы фактически реализованного host MCP с проверенными schema/registration/role allowlist. Имена будущих операций send/list/reply описывают проектируемый service, а не существующие инструменты. Нужный автоматический adapter сначала реализуют и проверяют; пока его нет, feature остаётся unsupported, а не имитируется ручной peer-панелью или prose parsing. Coordinator может продолжать независимую работу в своём разрешённом scope; только существенная нерешённая зависимость становится видимым blocker. Не менять CLI, не писать в чужой stdin и не угадывать `session/message` RPC.

Broker помещает проверенный контент в технический recipient inbox и existing queue lane. В prompt pack входят только новое сообщение, route/provenance, нужные artifact spans и refs, текущая цель/ограничения получателя. Peer question сначала обрабатывается агентами в их scope; существующий human Question создаётся только при действительно необходимом решении человека. Peer message не имитирует native permission callback и не отвечает на него вместо пользователя. Сохраняются реальная role/model capture, context budget и receipts очереди; recipient не зависит от активного окна пользователя.

## 4. Доставка не равна пониманию или применению

| Receipt | Что подтверждено | Что ещё не подтверждено |
|---|---|---|
| retained | Message и outbox durable на стороне host | Получатель ещё может быть недоступен/запрещён |
| queued | Recipient inbox/queue commit подтверждён | CLI ещё не получил message |
| dispatched | Конкретный captured turn содержит message/version и отправлен по фактическому transport | Нет гарантии, что модель увидела/поняла/применила весь payload |
| observed | Есть реальное поддержанное событие либо ответ получателя, явно связанный с message ID; источник receipt указан | Agent acknowledgment — не evidence корректного изменения кода |
| applied | Receiver owner связал сообщение с конкретным decision/change/result на актуальной базе; нужные проверки имеют собственные evidence | Не означает pass всех критериев отправителя или применение в другом проекте |
| unknown | После dispatch/применения исход не установлен | Нельзя автоматически отправить ту же работу повторно и показать delivered/applied |

Это техническая проекция доставки Message поверх existing queue/turn states, не альтернативные состояния выполнения. Наличие terminal response без корреляции не создаёт `observed`; просмотр debug record человеком не доказывает, что агент получил сообщение. Нет отдельного native acknowledgment — его не выдумывают: dispatched и результат/unknown достаточно. `rejected`, `expired`, `withdrawn`, `blocked` — причины завершения/удержания доставки с историей, не workflow failure всего проекта. Обычный UI показывает их только через значимый Task progress/blocker, без отдельной ленты receipts.

В одном локальном store outbox/message/recipient enqueue фиксировать общей транзакцией либо transactional outbox с unique delivery key. Повтор `operationId` возвращает прежний receipt; unique key включает message + recipient + delivery revision. Restart восстанавливает намерение и owner lease, а не повторяет каждый dispatched prompt. При раздельных stores нужны идемпотентный ingress и сверка receipt; **exactly-once external execution не обещать**. Unknown dispatch рассматривает общий recovery, queue item удерживается до установления исхода.

## 5. Busy/idle, изменения и остановка

Busy recipient получает message в технический inbox сразу, модель — на следующей безопасной границе существующей очереди. Не отправлять второй prompt в session, не делать forced cancel ради «срочно». Urgency влияет на допустимый приоритет pending и значимого blocker, но не обходит dependencies, permissions, active turn или captured settings. Для реального question channel действует только его подтверждённый contract.

Для включённого автоматического сотрудничества релевантный message в пределах link/Task policy пробуждает idle recipient обычным bounded turn через admission/quota. Отдельного подтверждения каждого сообщения нет. Явный queue/task hold или отключённое auto-wake оставляют работу в scheduler до обычного разрешённого продолжения задачи; это не заставляет человека вручную обслуживать inbox. Просмотр debug record не запускает модель. Отзыв link, deadline, archived recipient, incompatible scope/model binding или unresolved effect ставят hold с причиной; recipient не создаётся автоматически ради обхода ограничения.

Изменение coordinator-ом retained/pending message допустимо только по CAS; сохранение даёт новую content revision и меняет ещё не claimed delivery. После dispatch исправление — отдельное correction/superseding message с `supersedes`, исходник остаётся. Отмена unsent dispatch intent сохраняет audit; отзыв после отправки посылает технический notice, но не стирает уже прочитанное и не гарантирует остановки исполнения. Это service semantics, а не обязательные кнопки peer-редактора. Отмена turn/действия — отдельная проверенная операция его владельца.

Обычный stop/pause Task либо отключение сотрудничества держит новые auto-turns её causal thread, не отменяя молча unrelated Task. Отзыв разрешённой project link запрещает будущие доставки по ней; выбранная очередь получает hold. Уже запущенный turn требует обычного stop/cancel/terminal reconciliation. Replies по старой requirement/contract revision сохраняются как stale proposals, а не незаметно применяются к новому API. Для служебной переписки отдельный пользовательский чат/Stop discussion UI не нужен.

## 6. Frontend и backend: конкретный обмен контрактом

Frontend Task автоматически отправляет технический `question` с current contract version: какие поля/ошибки доступны для экрана. Backend отвечает `api_contract` с immutable schema/version, endpoint/method, request/response примерами без секретов, error cases, compatibility и source/evidence. Coordinator проверяет и использует результат; пользователь получает полезный итог/ссылку на принятый материал, без последовательности служебных messages. Audit хранит точный исходный контракт; сообщение «всё готово» без материала его не заменяет.

Frontend сопоставляет контракт с принятыми требованиями и своими fixtures, сохраняет dependency на версию и сообщает result/несоответствие. Есть два разных подтверждения: **обмен доставлен/наблюдался** и **контракт принят/проверен потребителем**. Они не возникают от автоматического «OK», не являются двухфазной транзакцией и не означают синхронный merge/deploy двух репозиториев. Breaking change создаёт новый version + impact для зависимой Task; старые checks остаются историческими, затронутые становятся stale.

Ни message type, ни acceptance контракта не разрешают автоматически менять чужой код, merge ветку, выполнять release или расширять scope. Разрешённые изменения делает owner соответствующего проекта, с его mode/checks. Независимая работа не блокируется ожиданием нерелевантного ответа; обязательный unanswered contract dependency не объявляется закрытым по timeout.

## 7. Payloads, права и защита от бесконечного разговора

Перед enqueue и dispatch проверять действующие link/Task права, versions, deadline и payload policy. Передавать минимальные тексты/образцы и immutable artifact refs либо разрешённые snapshots; абсолютный путь из другого проекта не является разрешением его читать. Artifact resolver проверяет scope на каждом dereference, не допускает path traversal/symlink escape. Источник обновился — message ref остаётся историческим; запросить актуальную версию отдельно. Неразрешённый/отозванный ref — unavailable, не пустой доказанный документ.

Не отправлять полные histories, system prompts, credentials, browser cookies, private keys или необработанные service responses с секретами. Redaction сохраняет provenance и список скрытых типов полей без самих значений; snippet не становится verified полным ответом. Ошибка прав видна sender без раскрытия приватных деталей чужой Task. Уже доставленную копию нельзя «отозвать из памяти модели»; дальнейшее чтение/распространение блокируется policy, история доставки сохраняется.

Любой auto-reply несёт causalRoot/parent/hop и общий budget. Receipt/status/duplicate не порождают reply-turn; `heads-up` по умолчанию не требует ответа. Для auto-turn предложить стартовый предел **4 последовательных peer hops** на causal chain плюс существующие time/token limits Task; значения — настраиваемая host policy, не лимит CLI. В fork/fan-out дети делят root budget, не получают каждый свежие лимиты. После исчерпания показать thread hold и результат, не создавать новую Task/chain ради обхода.

Все пробуждения coordinator/peers/workers делят M2 provider/account quota. Нельзя занимать все execution slots ожидающими ответами: ожидание peer dependency хранится в scheduler; новый model turn стартует только при полезной работе. Active native permission/CLI turn не объявлять освобождённым только из-за отправленного вопроса. Цикл A→B→A без нового содержания/изменённой dependency удерживается; автоматический detector не подменяет сообщение новым смыслом и не скрывает оригинал. Если исчерпание общего budget блокирует результат, Task показывает эту причину; обычное явное продолжение задачи может пересмотреть budget по существующей policy, без отдельного peer-чата и без автоматического сброса счётчиков.

## 8. Поставка M4 и проверки

| Карточка | Узкий результат | Приёмка |
|---|---|---|
| **PM1 — M4 same-project** | Автоматический coordinator→broker→recipient; durable technical Message/outbox/inbox, actual MCP/service и existing queue | A→B и reply без ручной peer-формы; repeat/restart не создают второй queue item; labels rename не меняют адрес. Нет rail/inbox/message-notification на каждый обмен |
| **PM2 — M4 linked projects** | Explicit link scope, разрешённые payload/ref snapshots, ingress/dispatch ACL | Разрешённая frontend/backend пара работает; unlinked/denied/private payload не доставляется; grant не переносит permissions |
| **PM3 — M4 execution** | Busy safe boundary, policy-based automatic idle wake, correlation/receipts, causal budgets/Task stop | Нет concurrent prompt/forced cancel, fake ack или ping-pong; technical hold/unknown отражается в Task только если влияет на прогресс/нужно действие |
| **PM4 — M4 recovery/live** | Fault traces и target Windows/CLI integration | Actual result принадлежит recipient/version; нулевой live run не называется работающим messaging |

M5 managed workers используют этот же broker для поручений/результатов с parent/assignment scope; native скрытые subagents не объявляются доступными адресатами без реальной capability. Межпроектный обмен не зависит от полной IDE, canvas или нативного system-prompt hot switch.

Обязательные негативные сценарии: disconnect после dispatch без ack; поздний reply старой Task revision; unknown apply после write; повтор reply/operation ID; message после expiry/отзыва link; исчезнувший artifact; конкурирующие изменения pending message; закрытый recipient и новая session generation; запрещённая и разрешённая межпроектные пары; превышенный causal budget. Expected: сохранить исходник/адреса/effects, reject/hold с причиной, не replay неизвестную запись и не restamp stale result. Отдельно clean trace проходит **автоматически** без ручного выбора получателя/каждого согласования; technical traffic не создаёт шум в обычном разговоре. Настоящий business/scope blocker появляется один раз как Task question, audit доступен адресно агенту. Неверный recipient/version отвергается, пустые receipts дают insufficient evidence. В отчёте фиксировать реальные enqueue/dispatch counts, connection bindings и limits покрытия; гарантий доставки через неподдержанный Giga API нет.
