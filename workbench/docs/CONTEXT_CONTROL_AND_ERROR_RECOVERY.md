# Ручной контроль контекста и восстановление после 400/413

Статус: проектирование и read-only проверка исходников, **не реализованное исправление целевого UI**. Дата: 2026-10-10. Qwen исследован в commit `4360b003a087fe9e57f6ffbe7ba48795980b59c3`; возможности установленного GigaCode 26.9.75, его endpoint и корпоративного proxy нужно проверить на Windows. CLI остаётся неизменённым. Бесшовность означает сохранённые Task, черновик, материалы и понятное продолжение; она не означает скрытые бесконечные повторы или гарантированное исправление любого ответа сервера.

Контракт дополняет [бюджет контекста](CONTEXT_BUDGET.md), [model/reasoning controls](MODEL_AND_CONTEXT_CONTROLS.md), [очередь сообщений](SMART_MESSAGE_QUEUE.md), [управляемых работников](MANAGED_SUBAGENTS.md), [роль и prompt binding](ROLE_PROMPT_BINDING.md), [Task](TASK_WORKSPACE.md) и [M2/M4 основного плана](GIGACODE_UI_DEVELOPMENT_PLAN.md). Один SessionService владеет исполнением, PromptAssembler — собственным pack, WorkflowEngine — этапами/результатами. ContextService и RecoveryService — предлагаемые модули этого backend, не ещё один контроллер Task.

## 1. Что действительно есть в исследованном Qwen

Все ссылки в таблице закреплены на указанном commit. Это **upstream evidence**, не разрешение вызвать такой метод у форка без capability probe.

| Механизм | Подтверждённое поведение и граница |
|---|---|
| Контекстная диагностика | [`contextCommand.ts:364`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/ui/commands/contextCommand.ts#L364) собирает overhead/history и предпочитает последний API count текущего chat; при отсутствии chat есть fallback на process-global telemetry. [`:600`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/ui/commands/contextCommand.ts#L600) задаёт `isEstimated`; [`:657`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/ui/commands/contextCommand.ts#L657) отдельно обрабатывает отсутствие provider count. Последний input count не равен автоматически следующему запросу; breakdown содержит оценки. |
| Qwen extension для usage | [`status.ts:141`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/acp-bridge/src/status.ts#L141) определяет `qwen/status/session/context_usage`; [`acpAgent.ts:10058`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L10058) обрабатывает `sessionId` и `detail`. Это Qwen extension. [`:9042`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L9042) при ошибке сборщика возвращает estimated fallback с нулевыми total/window: UI не превращает его в «0% занято». |
| Summary compression | [`compressCommand.ts:25`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/ui/commands/compressCommand.ts#L25): `compress`, alias `summarize`, режим ACP; вызывает `tryCompressChat` и выдаёт progress/result. Пользовательские focus instructions ограничены 2000 символами, есть notice об усечении. Это вызов сжатия с моделью, который сам может завершиться ошибкой. |
| Быстрое сжатие | [`compressFastCommand.ts:19`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/ui/commands/compressFastCommand.ts#L19): `compress-fast`, без аргументов и без LLM side-query, включая ACP mode. Возможен `noop`. [`client.ts:5925`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/client.ts#L5925) после изменения истории инвалидирует связанные read/memory delivery caches. Кнопка host не должна имитировать эти внутренние операции. |
| Как команды доходят до ACP session | [`Session.ts:6363`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L6363) передаёт slash input capability-filtered handler. [`acpAgent.ts:10071`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L10071) имеет отдельную Qwen supported-commands диагностику. Наличие handler не доказывает доступность каждой команды во всех managed modes. Не изобретать ACP `compact` RPC или универсальный `/compact`. |
| Уже встроенное восстановление 413 | [`llm-chat.ts:3905`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/llm-chat.ts#L3905) отделяет context overflow от request-body overflow и исключает их из части transport replay/continuation. [`:4227`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/llm-chat.ts#L4227) содержит однократное reactive compression для соответствующей non-exact route; bare 413 не выдаёт provider token count. [`:4406`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/llm-chat.ts#L4406) различает сбой самого compression, `noop` и исчерпанное восстановление. Не дублировать эту логику повтором всего ACP prompt. |
| 400 и другие 4xx | [`retryErrorClassification.ts:180`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/utils/retryErrorClassification.ts#L180) обычно классифицирует 4xx как fail-fast; узкое исключение — доказанная обёрнутая network failure без provider code/message. [`:399`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/utils/retryErrorClassification.ts#L399) отдельно распознаёт permanent provider codes, включая context/request-size. Это не правило «повторять любой 400». |
| Load/resume | [`acpAgent.ts:5517`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L5517) объявляет load/list/resume; [`:5911`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L5911) реализует load с replay, [`:6485`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L6485) — `unstable_resumeSession`, с `replayHistory: false` в restore path [`:6691`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L6691). Отсутствие replay в UI не означает очистку model history. Resume не является compression. |

Для target capability record нужны runtime hash/version, transport/version, model route, фактически объявленные/проверенные команды, observation time и `verified/absent/unknown`. На disposable read-only Task проверить progress, terminal, cancel, `noop`, ошибку и freshness usage. Команды compression отправлять через единственного владельца сессии на безопасной границе; не писать строки в её stdin обходным путём. Native auto-compaction может работать независимо: настройку/отключение показывать только при подтверждённом механизме. Host не обещает возможность полностью запретить его.

## 2. Разделить токены, байты и ошибки схемы

HTTP 400 означает, что сервер считает запрос некорректным; статус сам по себе не указывает на контекст. HTTP 413 означает отказ из-за размера содержимого запроса. При временной причине стандарт рекомендует серверу прислать `Retry-After`; само наличие 413 не говорит ни о лимите токенов, ни о размере допустимого окна. `Retry-After` содержит дату либо задержку в секундах. [RFC 9110: 400](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.1), [413](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.14), [Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

Следующая таблица — **правила нашего приложения**, основанные на диагностике конкретного endpoint, а не новые значения HTTP-кодов:

| Наблюдение | Что можно заключить | Первое полезное действие |
|---|---|---|
| Явный provider `context_length_exceeded`/подтверждённый token limit, иногда при HTTP 400 | Слишком большой model input и/или input+output budget согласно деталям провайдера | Пересчитать весь вход и output reserve; сжать доступную историю, уменьшить материалы либо выбрать совместимую модель с подтверждённым большим окном |
| 413 на model-generation endpoint, особенно HTML ответ proxy без token counts | Отвергнуто тело запроса; точный предел и владелец gateway могут быть неизвестны | Проверить наблюдаемые размеры текста/JSON/media; уменьшить реальный body. Большая context window другой модели сама по себе не увеличивает proxy limit |
| 413 на upload/file endpoint | Проблема конкретного upload, не доказательство переполненной беседы | Уменьшить/разделить вложение допустимым способом, сохранить оригинал и выбор пользователя; не сжимать всю беседу автоматически |
| 400 с полем invalid JSON/schema/parameter | Неприемлемая структура/параметр запроса | Проверить собственный encoder/adapter или подтверждённую настройку; сокращение текста обычно не исправляет структуру |
| 400 с tool-result/tool-call mismatch или некорректным history role order | Нарушен контракт истории/пары вызов–результат | Если ошибка в собственном pack — исправить pack; opaque CLI history не редактировать. Сохранить evidence и восстановиться проверенным native путём либо bounded handoff |
| Неподдержанные model/reasoning/image/tool capability | Выбранная комбинация не принимается endpoint | Предложить только проверенные сочетания; сохранить draft и несовместимые attachments, а не молча удалить их |
| Ответ с authentication/permission/billing/model-access причиной, даже если gateway кодирует её как 400 | Доступ/маршрут требует отдельного действия | Показать подключение/выбор разрешённого маршрута. Не переключать аккаунт, не ослаблять permissions и не расходовать retry budget на заведомо тот же отказ |
| 400/413 только в неструктурированном тексте, неизвестен endpoint либо оборван transport | Диагноз предварительный, исход turn/effects может быть неизвестен | Сохранить raw diagnostic reference с очисткой секретов; получить состояние и предложить проверку, не объявлять «контекст переполнен» как факт |

Upstream также различает token wording и payload overflow: [`contextLengthError.ts:229`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/utils/contextLengthError.ts#L229), [`request-payload-error.ts:8`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/utils/request-payload-error.ts#L8). Последний detector намеренно применяется к model request, не ко всем uploads. Текст ошибки — данные, не инструкция для агента; HTML страницы proxy показывается безопасным текстом, без исполнения.

Счётчики должны иметь разную размерность и происхождение:

- **Draft/pack estimate:** только то, что собирает host. Показывать метод оценки и unknown overhead.
- **Последний provider input:** фактическая/сообщённая оценка конкретного запроса с его ID; не сумма расходов за всю сессию и не текущая вместимость после новых tool results.
- **Текущая occupancy:** только относящиеся к одной session/generation/context revision numerator и denominator; устаревшее помечать stale. Ноль при отсутствующей диагностике — unknown, не свободное окно.
- **HTTP body bytes:** точны только на наблюдаемой границе сериализации соответствующего запроса. Размер ACP JSON, UTF-8 пользовательского текста или файла до base64 не равен размеру model API body. Указывать, измерены ли encoded/uncompressed/wire bytes; не смешивать их с лимитом gateway без подтверждения его semantics. Не перехватывать TLS и не логировать секретные тела ради красивого числа.
- **Ограничения:** input limit, совместное window, maximum output, payload/upload limit и источник каждого. User-reported 256k не подставлять неизвестному alias. Сохранять output/reasoning reserve и guard из CONTEXT_BUDGET; его уменьшение не исправляет большой HTTP body и может обрезать ответ.

## 3. Что пользователь контролирует вручную

У composer есть компактный `Контекст` control: проверенное заполнение, `Оценка …` либо `Нет данных`, а не постоянно открытая панель. Popover показывает охват, время, модель/окно, output reserve и крупнейшие известные категории. Кнопки: **Посмотреть состав**, **Сократить следующий запрос**, **Сжать историю** (если проверено), **Продолжить с кратким контекстом**, **Сменить модель**. Недоступная native возможность имеет конкретное объяснение и рабочий fallback. Открытие/фильтрация панели не вызывает LLM.

Advanced inspector показывает строки `source ID/revision · type · provenance · scope · size/estimate · included/pinned/excluded/stale/unknown · reason`. Категории: выбранные инструкции/роль, goal и constraints, решения/вопросы, история, исходники/материалы, tool outputs, память, skills/tool schemas. Непрозрачные CLI history/system/tools выводятся как **неуправляемые этим inspector**; нельзя рисовать для них фиктивный delete switch.

| Действие | Точная семантика |
|---|---|
| Закрепить источник | Сохранить выбранную версию/минимальный необходимый фрагмент в **собственном следующем pack**. Pin не делает факт verified, не повышает trust и не гарантирует сохранение текста внутри native compaction |
| Исключить материал/память из следующего pack | Не вкладывать его body; сохранить адрес/историю и объяснить impact. Это не удаление с диска, не отзыв уже отправленных данных и не очистка hidden CLI history |
| Перечитать изменившийся источник | Создать evidence новой версии, пометить зависимые выводы stale; не restamp старый результат новым hash. Повторное чтение ограничить нужными spans |
| Уменьшить attachment | Создать производный artifact с provenance, сохранить оригинал; показать, что теряется. Удаление страниц/снижение разрешения/замена изображения OCR-текстом не являются автоматически эквивалентными |
| Сжать историю | Выполнить только проверенный native механизм после checkpoint/idle. Отдельно быстрый и summary пути, реальные результат/`noop`/ошибка; не показывать заранее выдуманное число освобождённых токенов |
| Продолжить с кратким контекстом | Новый model binding/session того же Task по §5; это host handoff, не обещание восстановить невидимое внутреннее состояние старой сессии |
| Сменить модель | Existing model control и проверенная route/reasoning/media compatibility; применить на idle, захватить новую конфигурацию следующего turn. Старый retry сохраняет прежнюю captured model |

Защищённый минимум нельзя молча снять: принятые ограничения/необходимые требования, unresolved questions, pending effects, актуальные authorization references, Task/run/stage/attempt identity. Если pinned минимум не помещается, объяснить конфликт: разделить работу, выбрать подходящее подтверждённое окно или изменить scope через обычный requirement flow. Не отбрасывать ограничения ради процента.

Context plan имеет собственную revision и before/after manifest. Это не новая requirement revision, пока смысл цели/ограничений не меняется; смысловое исключение обязательного материала/критерия требует существующего impact/invalidation flow. Удаление body не удаляет evidence. Кеш assembled pack, usage и оценки инвалидируется по context revision/model/tools/source hash; queued captured packs не переписываются без выбранного действия. «Отменить изменения» восстанавливает ещё не отправленный context plan; отменить уже произошедшее native сжатие можно только при реально поддержанном restore, а не записью старого числа в UI.

## 4. Recovery card вместо бесконечного toast

Карточка остаётся в конкретном turn и кратко сообщает: **что отвергнуто; что известно; что сохранено; следующий безопасный шаг**. Например: «Запрос слишком большой для endpoint. Лимит тела не сообщён. Черновик и 3 вложения сохранены». Ни error code, ни ожидание не перекрывают доступ к Task/другим чатам. Технические детали раскрываются отдельно: очищенные code/type/request ID, endpoint class, CLI build, timestamp, observed sizes, прежние recovery attempts и coverage gaps. Секреты, полный raw config и credentials в карточку не попадают.

Показывать одну подходящую основную кнопку и несколько вторичных, а не одинаковое «Повторить» всем ошибкам:

- История доминирует, native compression подтверждён → **Сжать и подготовить продолжение**; user видит result перед новым действием, если auto-continue policy не была выбрана.
- Первый prompt/attachment слишком велик, compression `noop` → **Уменьшить запрос** с черновиком и выбором вложений. Новая сессия с тем же body не считается решением.
- Подтверждённый context limit → **Выбрать модель** или **Продолжить с кратким контекстом**, с новым budget и совместимостью.
- Schema/tool-pair/capability проблема → **Посмотреть причину / исправить настройку**, не автоматический summarizer.
- Неопределённый исход → **Проверить выполнение**; пока результат не установлен, кнопка полного resend недоступна.

В обычном режиме уже данное разрешение на работу сохраняется: повторное подтверждение каждого read/checkpoint не нужно. Автоматически допустимы сохранение draft/evidence, классификация, read-only reconciliation и подготовка сокращённого pack. Native compaction/новый binding/продолжение выполняются автоматически только в выбранной пользователем политике, в прежнем scope, с проверенными capability и guards. Ручная кнопка является конкретным намерением пользователя. Новые provider/account, расширение доступа, потеря обязательных материалов или изменение требований не подразумеваются словом «восстановить». Режим `personal_fast` не превращается в production approval wizard.

## 5. Ограниченный алгоритм восстановления без повторных эффектов

1. **Зафиксировать инцидент.** `incidentId`, Task/run/attempt, binding/generation, turn/request ID, captured role/model/config, последний event cursor, source/error provenance и исходящие операции. Сохранить draft и версии attachments. Текстовый error не доказывает terminal: сохранять занятый слот, пока владелец не подтвердит границу.
2. **Определить фазу отказа.** Ошибка нового model request может прийти после успешных tools предыдущей итерации того же turn. Даже достоверный 413 не означает, что весь пользовательский запрос ничего не изменил. Установить completed/failed/unknown каждого наблюдаемого effect; при coverage gap сохранить неизвестность.
3. **Остановить автоматическую отправку этой lane.** Использовать existing queue hold и M2 states: active internal recovery остаётся running либо реально наблюдаемым waiting_retry; после terminal failure — failed с recovery reason; disconnect — interrupted_unknown/reconciling. Это не перевод workflow stage в pass. Cancel_requested не terminal; соседние независимые Task продолжают по общей квоте.
4. **Выбрать одно объяснённое преобразование.** Проверить диагностику, manifest и capabilities. Не отправлять без изменений тот же payload после постоянного 400/413. Не сжимать историю для upload error. Возможные actions: убрать необязательный body, подготовить производное вложение, verified native fast/summary compression, совместимая модель, bounded handoff. Если LLM compression сам не помещается/падает — не отправлять ему всю ту же историю ещё раз; использовать существующие структурные checkpoint records.
5. **Commit checkpoint до изменения binding/history.** Сохранить immutable manifest с included/excluded source IDs/hashes, предыдущий valid checkpoint и journal cursor; проверить closure ниже. Сначала сохранить известные результаты и pending registry. Host не обещает backup opaque CLI history, если CLI её не экспортирует. Не изменять private CLI session files.
6. **Урегулировать effects и дождаться безопасной границы.** Native load/resume восстанавливает прежнюю session только при проверенной поддержке и владельце. Для handoff старый исполнитель terminal/недоступен с установленным ownership; относящиеся к продолжению uncertain writes reconciled либо новый pack допускает только read-only сверку. Unknown operation не получает повторный write из нового prompt.
7. **Подготовить следующий turn.** Создать новый session/binding поддерживаемым способом при необходимости, связать old→new и recovery cause, оставить прежние Task/run/requirements/attempt accounting. Выполнить configured role/system binding и применить проверенную model/reasoning configuration; одной заметки с названием роли недостаточно. Новый pack содержит следующий невыполненный шаг и receipts завершённых действий, а не дословный replay исходного запроса или synthetic tool results.
8. **Проверить размер и dispatch ровно один раз.** Пересчитать pack/known overhead/output reserve; неизвестные части оставить видимыми. Операция захватывает context revision и queue item CAS. Receipt `prepared/captured/transport/observed/terminal` имеет фактический источник; не выдумывать acknowledgment при отсутствии отдельного ack. После нового usage обновить snapshot, сохранив прежние измерения.
9. **При повторном отказе остановить автоматическую лестницу.** Предложение стартовой host policy: максимум одна дополнительная native compression operation и один handoff на incident, только если они допустимы и ещё нужны после внутренних действий CLI; не выполнять оба обязательным ритуалом. Safety retries уже ограничены M2, не выдавать каждому новому helper отдельный budget. Счётчик переживает restart и смену модели. Неудачный новый binding не вызывает автоматическое переключение по всем моделям/провайдерам.

Model API retries остаются у CLI. Host повторяет только собственную операцию с доказанным безопасным повтором и установленным исходом; не весь ACP prompt. Соблюдать общий provider/account quota и circuit breaker для coordinator, workers и compression LLM calls, если они управляемы host; скрытые native side-queries отмечаются как неполное покрытие. Свой `Retry-After` использовать только если он реально получен и причина допускает ожидание; не раньше указанного срока, с отменой. Если срок больше automatic wait budget — сохранить очередь и показать срок, не урезать его до раннего повторного запроса. Задержка не исправляет постоянную схему/размер. Не включать unattended infinite retry и не monkeypatch CLI.

## 6. Проверка потерь при сжатии

Canonical events/evidence сохраняются независимо от рабочего набора. Checkpoint содержит `checkpointId`, `parentCheckpointId`, `projectId/taskId`, requirement/context revisions, run/stage/attempt, journal cursor, manifest hash и ссылки на обязательное замыкание:

- accepted requirements/constraints/decisions с их IDs и текущими версиями;
- unresolved question/answer/permission IDs с текущим состоянием, без переноса чужого authorization;
- pending/completed effect IDs, outcome и reconciliation refs; известный write никогда не превращается в «ещё сделать»;
- актуальные artifacts/source hashes, stale/conflicting evidence и source addresses;
- текущий agent plan/todo snapshot и formal result refs; agent-reported done не повышается до verified/pass;
- deferred/rejected recommendations, scope exclusions, budget/attempt counters и следующий разрешённый шаг.

Валидатор сравнивает ID sets/status/revisions и существование evidence; отсутствующий источник даёт insufficient evidence. Он ловит пропуск/самовольное закрытие, но **не доказывает смысловую точность любого LLM summary**. Для summary дополнительно сравнить ключевые ограничения/следующее действие с исходными фрагментами; неоднозначную переформулировку не принимать автоматически. Не просить модель раскрывать chain-of-thought и не превращать её уверенное резюме в новый authority.

Если native compaction не позволяет увидеть итоговую историю, записать coverage gap и сохранить verified Task handoff отдельно. Нельзя утверждать «все закрепления сохранены внутри модели». При продолжении дополнить контекст минимальными актуальными constraints поддерживаемым каналом либо использовать bounded новую сессию; не добавлять бесконечно весь журнал. После сжатия адресное чтение исходника остаётся допустимым, даже если старая UI строка говорит, что файл когда-то читали.

## 7. Маленькие карточки реализации

| Карточка | Объём и зависимость | Условие готовности |
|---|---|---|
| CR0 — capability record | M0/M1: inventory реального bundled CLI, usage/commands/model/resume probes на disposable session | Есть versioned `verified/absent/unknown`; неподтверждённая команда не отправляется |
| CR1 — diagnosis + recovery card | **M2 baseline**: error envelope, endpoint boundary, existing turn state/queue hold, draft persistence | 400 schema и 413 body имеют разные действия; нет blind resend/ложного terminal |
| CR2 — безопасное ручное продолжение | **M2 baseline**, без ожидания всего native M4: checkpoint из имеющихся Task records, уменьшение draft, модель и supported handoff | Цель/constraints/questions/effects сохранены; один владелец/один dispatch; CLI и Giga capabilities честно ограничены |
| CR3 — context popover | M3 composer: происхождение usage, reserve, actions и быстрый переход к draft/materials | Unknown/stale не превращаются в точный процент; панель работает без LLM |
| CR4 — advanced inspector | **M4**: native EventStore/PromptAssembler, manifests, pins/exclusions/preview/CAS, dependency invalidation | Управляются только собственные inputs; preview действительно совпадает с captured pack |
| CR5 — fault/recovery suite | Добавлять по CR1–4, затем long-task live test | Clean/known-bad/missing контролируют сам наблюдатель; отчёт привязан к source/build/CLI/model route |

Не блокировать первую полезную D2/D3 сборку полным редактором всей history. CR1/CR2 дают сохранённый запрос, понятную причину и рабочий следующий шаг; M4 добавляет детальное управление источниками. Не называть CR2 полноценным native recovery, если пока доступен только журнал адаптера и coverage ограничен.

## 8. Приёмка и fault matrix

Это запланированные проверки; целевой Giga/Electron здесь не запускался. Для каждой фиксировать IDs, входной trace/fixture, фактическое число dispatch/tools и coverage, а не только скриншот карточки.

| Сценарий | Проверяемый результат |
|---|---|
| 400 invalid parameter при коротком запросе | Нет автоматического compression/retry; retained draft, конкретная диагностика и исправление только допустимой настройки |
| 400 context code + реальные counts | Token reason отделён от generic 400; input+output reserve пересчитан для данной модели |
| 413 proxy при маленьком token estimate, большой media body | Нет выдуманного token limit; body/attachment action, безопасный plain-text error |
| 413 upload | Не сбрасывает беседу и не запускает model-history compression |
| Первый turn слишком большой, native compression noop | Предлагается уменьшить текущий запрос; новая пустая сессия с тем же body не отправляется автоматически |
| CLI уже сжимает/повторяет model request | Host не создаёт второй ACP prompt и не захватывает второй слот; если событие недоступно, показывает только наблюдаемое ожидание |
| Compression failed/noop/done, estimate flags/unknown usage | Отдельные состояния, без false success/выдуманного before→after; потеря обязательного ID блокирует commit собственного handoff |
| Write завершён, следующая model итерация получила 413 | Write присутствует в checkpoint как завершённый и не выполняется второй раз |
| Disconnect после write dispatch, restart/two windows | Unknown остаётся до reconciliation; один recovery owner, stale CAS отклонён, повторный click не дублирует операцию |
| Неясный исход native compression | Сначала native state/usage reconciliation; нельзя повторять команду только потому, что пропал progress |
| Неподдержанный native command/hidden history | Работает честный bounded new-session fallback, нет редактирования private CLI files/фиктивного удаления истории |
| Модель с меньшим окном, иной reasoning/vision | Старый retry остаётся captured; новый pack/config валидируется, несовместимые attachments сохраняются для выбора |
| Pin/exclude изменён в другом окне после enqueue | Dispatch использует согласованный captured manifest; stale edit не меняет отправленный turn |
| Повтор ошибки, Retry-After больше бюджета, отмена ожидания | Нет infinite loop, раннего retry или обхода circuit; таймер отменён, draft/очередь сохранены |
| Три handoff в длинной Task с вопросом, конфликтом и deferred recommendation | Сохранены исходные IDs/revisions/status/budgets; нет тихого закрытия вопроса и расширения scope |
| Clean / deliberately missing constraint / empty telemetry | Clean проходит structural loss checks; known-bad отвергается; empty сообщает insufficient evidence. Нулевой live test не считается pass |

После реализации отдельно проверить target Windows: спокойный переход между recovery card, composer и Task без reload; смена окна не меняет получателя; current turn не перезапускается от открытия popover. Измерить фактический размер pack, latency и ошибки до/после на одинаковых fixtures. Не обещать заранее нулевые 400/413, фиксированную экономию токенов или восстановление скрытого контекста без поддержки CLI.
