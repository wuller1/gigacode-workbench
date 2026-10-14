# Управляемые исполнители и координация GigaCode

Этот срез реализован в существующем `WorkbenchService` и его `AtomicStore`. Метаданные `_managed` дополняют задачи, сессии, очередь и receipts; отдельного workflow/process engine нет. `Session.status` и `Control` остаются источником фактического состояния процесса. Native hidden subagents самого CLI этим контроллером не объявляются управляемыми.

## Работа пользователя и агента

Пользователь задаёт цель в текущем разговоре. Агент создаёт ограниченную независимую работу через `agent_spawn`, либо отдельную задачу/разговор через `agent_delegate`. Роль дочернего исполнителя выбирает существующий LLM-router. У каждого дочернего ACP-процесса свои generation, tool binding, очередь, контекст, модель/reasoning и retained fingerprint инструкций: CORE + контракт управляемого исполнителя + одна роль. Неизвестный GigaCode CLI получает этот контракт как явно обозначенный context-only до проверки рабочего adapter; системная доставка не выдумывается.

Панель исполнителей использует реальные host metadata и состояния сессий. Доступны pause, cancel, resume, retry, свежий followup, зависимости и просмотр checkpoint. Удалённый исход хранится отдельно от факта завершения процесса: `completed` не означает приёмку результата или интеграцию изменений.

Операции и MCP:

| Метод host | Назначение |
| --- | --- |
| `agent.spawn` | Один idempotent child в текущей задаче; `parentId`, `operationId`, `title`, `prompt`, опциональные roleHint/dependencies/writeScopes/contextBudget |
| `agent.delegate` | Дочерний управляемый исполнитель в указанной существующей задаче или новой задаче существующего проекта; `targetTaskId`/`targetProjectId` |
| `agent.list` | Страница metadata с реальным sessionStatus, policy и checkpoint; без bearer/lease secrets |
| `agent.control` | `pause`, `cancel`, `resume`, `retry`; MCP может управлять только своими потомками |
| `agent.followup` | Новая ограниченная работа после чистой границы; прежний prompt не повторяется |
| `agent.dependencies` | Изменение DAG до первого admission; циклы и межпроектные DAG-ребра отвергаются |
| `agent.checkpoint` | Короткие проверенные факты, ссылки и оставшаяся работа текущего generation/lease |
| `agent.reconcile` | Только human host UI/verifier, отсутствует в MCP. Реальная проверка applied/not_applied со ссылками на наблюдения |
| `coordination.links/link/revoke` | Направленные связи проектов, их действия и авторизация человека |
| `session.peerMessage` | Сохранённая скрытая записка существующему разговору с idempotency и causal chain |

MCP предоставляет `agent_spawn`, `agent_delegate`, `agent_status`, `agent_control`, `agent_followup`, `agent_checkpoint`, `coordination_targets`, `session_message`. Authenticated source/session/generation добавляет host; модель не выбирает их через аргументы. Проверка binding выполняется снова внутри сериализованного store update. `agent.reconcile`, изменение Settings и выдача link authorization не публикуются как MCP-возможности модели.

## Ограниченный scheduler для flash-моделей

По умолчанию: глобальная concurrency приложения 2, не более 2 дочерних работ одного coordinator одновременно, **32 000 токенов суммарной packet reservation** управляемых workers, **16 000 на пакет одного worker**, не более 3 попыток. Reservation относится к прикладной задаче/checkpoint, исключает непрозрачные native CLI base/tools и не является измерением KV memory, стоимости, точной токенизации или полного prompt. Контекстный supervisor отдельно ограничивает наблюдаемое накопление worker: high-water не выше 48k, low-water не выше 24k, с дополнительным учётом реальной capacity. Слепой лимит полного контекста 16k сам вызывал бы бесконечные renewal при большом native base; повторное отсутствие полезного уменьшения после двух renewal удерживает очередь для исправления конфигурации.

Worker не получает полный родительский или соседний чат. Передаются ограниченная задача, контекст текущего проекта, ссылки, checkpoint, зависимости и объявленные write scopes. Checkpoint содержит не более 12 000 символов суммарно. MCP status возвращает короткий хвост результата и сокращённые checkpoint-сведения; полный transcript остаётся в task_history.

Зависимый worker допускается только после `completed` всех DAG-предшественников. Failed/cancelled/unknown предшественник не трактуется как успешный. Чистая смена роли внутри одного child сохраняет identity и блокирует его dependants до завершения всей цепочки.

Указанные project-relative write scopes канонизируются через realpath, включая ближайшего существующего родителя ещё не созданных файлов. Проверяются выход через symlink/junction за настоящий project root и изменение project/task scope после асинхронного разрешения. Совпадающие директории/файлы и aliases имеют пересекающиеся leases. Столкновение admission из устаревшего pump snapshot — нормальное ожидание, не failed/paused и не потеря входа.

**Write leases не являются filesystem sandbox.** CLI имеет свои обычные OS-права и native tools; prompt и объявленный scope не запрещают ему произвольный доступ. Перед edits требуется согласованное владение; для строгой изоляции на рабочем месте отдельно подключаются реальные worktrees/OS sandbox. Пустой write scope — заявленная analysis/review работа, а не техническое read-only ограничение всех native CLI tools.

## Отказы, повторы и восстановление

Lease содержит host owner, epoch, expiry и actual sessionGeneration после dispatch. Старые lease/generation не могут принять dispatch, checkpoint, heartbeat или terminal результат. Реальный ACP update продлевает lease только текущего аутентифицированного исполнителя. Таймер наблюдает workers **и обычные recipient peer sessions**; истечение срока останавливает конкретный принадлежащий host процесс. Restart восстанавливает metadata, очереди и checkpoint; он не воскрешает процесс и не повторяет уже отправленный prompt.

Сбой до dispatch может получить ограниченный host retry. HTML диагностируется как текст; HTTP 429 распознаётся по реальному status/явному HTTP diagnostic, не по случайному числу в HTML. Учитываются bounded Retry-After, экспоненциальный backoff и jitter. Для managed worker внутренние startup attempts не перемножаются с outer retries. Ошибка LLM-router не запускает worker молча под прежней ролью.

HTTP 400/413 требуют разбирательства с форматом/контекстом, 401/403 — авторизацией. Они не повторяются бесконечно. После dispatch **429, HTML, отмена, обрыв и неизвестный terminal outcome не доказывают отсутствие filesystem/tool/network effects**: ставится UNKNOWN/effectFence, automatic retry запрещён. Unknown owner удерживает writer/context reservations до реальной сверки. `applied` освобождает fence, но запрещает replay той же работы; `not_applied` допускает явный retry в оставшемся budget. Успешный readback требует фактических свидетельств, произвольная строка агента ими не становится.

Human host attestation содержит точный `assistantMessageId` остановленного turn. История `in_progress` tool сохраняется; её перестают считать текущим незавершённым вызовом только при совпадении этого ID с host ledger и отсутствии effect fence, либо после явно установленной границы нового executor. Текст сообщения, время и слова «проверено» не освобождают UNKNOWN. Новое действие требует явного retry/followup; старый prompt автоматически не повторяется.

Если неизвестный CLI не выдаёт ACP usage, context supervisor считает **оценку известных UTF-8 байтов / 2**, отдельно от фактических измерений. Host сохраняет offset нового executor до добавления сообщений, учитывает реально отправленные wrappers/checkpoint и свежие user/assistant сообщения, ограниченные tool input/output. Старый полный transcript не прибавляется после renewal. Подсчёт ограничен 16 MiB, каждый tool input/output — 64 KiB, входные объекты — глубиной 6 и 128 узлами; непрозрачные native system/tools, скрытые обрезанные output и точная токенизация неизвестны. Это не измерение окна модели. Реальные ACP/verified-adapter измерения сохраняют приоритет; прирост видимого текста после них показывается отдельной оценкой. Два renewal, не уменьшающие известный wrapper, удерживают очередь для исправления конфигурации; при появлении фактического usage его оценка имеет приоритет.

Human host attestation принимается только после подтверждённой остановки реального owned executor (live/launch/configuring проверяются повторно при сохранении). Сохраняются outcome, evidenceRefs, epoch, время и humanRequestId в bounded metadata и полном системном сообщении task history. Повтор того же humanRequestId с теми же фактами возвращает прежний результат; изменение attestation под тем же ID отвергается. Это утверждение человека со ссылками на наблюдения, не автоматическое доказательство полноты проверки.

После attestation сессия получает свежую idle/paused boundary и generation; сама сверка ничего не запускает. Только явный Retry после `not_applied` может восстановить сохранённый исходный **пользовательский** input, с проверкой его hash и новым queue ID, если очередь пуста. Неизвестная peer delivery или role continuation не превращается в вымышленное сообщение человека: требуется новый followup. После `applied` доступен только свежий ограниченный followup, старый input не повторяется. UI использует вычисляемый host `canRetry`, а не выводит разрешение по одному статусу failed.

Pause/cancel отзывает native tool authority и останавливает owned CLI до ожидания медленного сохранения. Безопасное преддиспетчерское pause допускает resume с новым lease. Dispatched cancellation остаётся unknown до проверки: остановка процесса не откатывает внешнее действие. Свежее отдельное диагностическое поручение можно создать в другой сессии; старый unknown prompt не пересылается автоматически.

## Связи проектов и скрытая доставка

`allowCrossProjectCoordination` — настройка human host UI. В этой поставке она включена по запросу пользователя о межпроектной работе. При первом внутреннем обращении создаётся сохранённый **направленный** link с provenance host setting; модель не создаёт себе новое разрешение. После явного revoke link не включается обратно автоматически. Другая установка может отключить возможность целиком; существующая workplace policy должна сохраняться при миграции.

Записки и результаты всегда `reference_only`: их текст не становится новым пользовательским поручением, разрешением на production changes или внешнюю отправку. `agent_delegate` создаёт самостоятельную работу внутри уже разрешённой человеком области. Внешние email/Slack/публикации этим каналом не отправляются.

Inbox имеет retained → claimed → dispatched → observed/unknown. Сохранённый operationId с тем же payload возвращает прежний receipt, с другим — ошибку. Lost reply/restart не создаёт повторный dispatch unknown delivery. До отправки journal и generation сохраняются атомарно вместе с существующей peer queue.

Host автоматически выводит causal parent из текущего peer turn. Модель не может сбросить цепочку, забыв parentDeliveryId. Reply, созданный во время dispatch родителя, сохраняется, но допускается к исполнению лишь после observed родителя; unknown родитель удерживает reply. Ограничены 8 causal hops, inbox 32, исходящие project deliveries 32/мин и общая ёмкость receipts. Это ограничивает автоматические циклы; полноценный semantic coordinator/join-result verifier ещё требует отдельной приёмки.

Revoke удаляет отменённые pending peer entries и обновляет receipts без повреждения обычной очереди пользователя. Claimed undispatched получатель останавливается и освобождает admission; queued human message остаётся. Уже dispatched получатель останавливается с UNKNOWN, его следующие пользовательские сообщения сохраняются для явного восстановления.

## Воспроизведение

Из `app/`: `npx vitest run tests/managed-coordination.test.ts tests/managed-service.test.ts tests/agent-runtime.test.ts tests/backend.test.ts`. Наборы используют реальные локальные ACP child processes и AtomicStore, а также deterministic protocol fixtures; платных provider calls и корпоративных endpoints нет.

Проверяются dedup, stale generation/lease, DAG, concurrency/context/write reservations, canonical aliases, normal writer deferral, HTML 429 before dispatch, unknown HTML after dispatch, native cancel и actual store restart, cross-project note/delegation, pending/claimed/dispatched revoke, host-derived causal reply gating, lease expiry обычной peer session и смена роли внутри managed child. Это не подтверждает совместимость корпоративного GigaCode 26.10.6 или качество рассуждений реальной flash-модели: оба проверяются на рабочем компьютере.

Владельцы: [контракты](../../app/shared/managed-coordination.ts), [чистые reducers](../../app/electron/managed-coordination.ts), [service](../../app/electron/service.ts), [MCP](../../app/electron/mcp.ts). При миграции переносить эти части согласованно вместе с host IPC/UI integration, сохраняя более удачный уже реализованный controller пользователя.
