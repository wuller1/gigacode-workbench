# Умная очередь сообщений

Статус на **2026-10-13**: контракт реализации личного Electron UI, не уже работающая live-steering функция. GigaCode CLI не изменяется. Базовое поведение Qwen исследовано в commit **`4360b003a087fe9e57f6ffbe7ba48795980b59c3`**, а опубликованный 0.25.1 дополнительно сверён по tag **`c1a8218f38203e272e6e965778ed6a2795cfeed7`**; конкретные callbacks, steering, восстановление и metadata **GigaCode 26.9.75 нужно проверить на целевой Windows**. Очередь принадлежит host и остаётся полезной без расширений CLI.

Цель: пользователь может продолжать писать, исправлять ожидающее сообщение, менять порядок и отвечать на вопрос, пока агент работает. Приложение сохраняет ввод и показывает, что уже отправлено, что ещё можно изменить и что задерживает следующий шаг. Оно не прерывает текущую работу вторым prompt и не повторяет неизвестные внешние действия после обрыва.

Использовать существующие Task writer, SessionService, Scheduler, PromptAssembler, EventStore и PanelRegistry. Основа — [M2/M3 плана](GIGACODE_UI_DEVELOPMENT_PLAN.md), [PARALLEL_SESSIONS_FIX](PARALLEL_SESSIONS_FIX.md), [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md), [MODEL_AND_CONTEXT_CONTROLS](MODEL_AND_CONTEXT_CONTROLS.md), [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md), [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md). Не создавать второй engine в composer.

## 1. Почему очередь host обязательна

В pinned Qwen новый direct-ACP `Session.prompt` вызывает abort предыдущего pending prompt и затем ждёт его завершения: [Session.ts:5342](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5342), [drain:5406](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5406). Следовательно, второй prompt — не безопасный способ незаметно дописать сообщение в очередь или выполнить live steering.

Qwen 0.25.1 добавил best-effort extension [`craft/midTurnSendNow`](https://github.com/QwenLM/qwen-code/blob/c1a8218f38203e272e6e965778ed6a2795cfeed7/packages/acp-bridge/src/bridgeTypes.ts#L1481): после сохранения текста в host FIFO пользователь может попросить доставить его текущему foreground turn. Агент может прервать только streaming model response; уже начатый tool сначала завершается, а неизвестный method остаётся fallback на следующую безопасную границу. Для этого host обязан реализовать парный `craft/drainMidTurnQueue`, ownership/reconciliation очереди и capability probe. Текущий `app/electron/acp.ts` этого ещё не делает, поэтому UI не должен выдавать обычный второй `session/prompt` или сам факт версии 0.25.1 за рабочий Send now.

`session/cancel` адресует конкретную сессию и её pending admission: [acpAgent.ts:7183](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7183). Отправка notification сама по себе не подтверждает terminal outcome и не откатывает tool effects. Внутренние retry CLI описаны в [QWEN_BASELINE](QWEN_BASELINE.md); host не ставит поверх них второй цикл одинаковых prompts.

Для вопросов Qwen использует реальный permission callback; отдельная ветка читает extension `answers` в response: [Session.ts:15392](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L15392). Abort-aware ожидание и проверка предложенных option IDs находятся в [permissionUtils.ts:196](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/permissionUtils.ts#L196). Это не основание отправлять произвольное поле `answers` любому ACP agent: schema и scope проверяются на target. Обычный текст «да» не равен permission response.

## 2. Основной интерфейс и ожидаемое поведение

| Ситуация | Composer и действие |
|---|---|
| Получатель idle, отправка разрешена | «Отправить»: сначала durable enqueue, затем обычный admission; единый путь без обхода журнала |
| Агент работает / ждёт своего retry / tool result | «Следующим»: durable enqueue без второго prompt. Если versioned adapter подтвердил Qwen mid-turn extension, рядом доступно «Уточнить сейчас»; иначе оно честно остаётся следующим сообщением. Отдельный Stop сохраняется |
| Уже есть ожидающие сообщения | Компактная раскрытая очередь прямо над composer, без popover. Строка содержит начало текста, «Сейчас» с accessible name «Отправить сейчас», карандаш «Редактировать» и корзину «Удалить»; получатель, вложения, настройки и hold reason доступны без потери контекста |
| Ожидающее сообщение выбрано для edit | Inline-редактор в своей строке: «Сохранить» / «Отмена», Ctrl/Cmd+Enter / Escape. Видимый edit hold удерживает очередь разговора до Save/Cancel; текущая работа продолжается |
| Живой вопрос требует ответа | Отдельный ответ на конкретный вопрос; при существующем callback — через него, иначе на ближайшей безопасной границе |
| Очередь paused / blocked / reconnecting | Причина и конкретное Continue/Reconcile/Edit действие; текст и вложения сохраняются |

Очередь и черновик её правки относятся к конкретному разговору (`discussionId` / lane), а не к глобальному composer. Смена проекта, задачи или выбранного разговора не переносит сообщения, получателя, hold или несохранённый текст правки в другую очередь. Основной composer draft и edit draft — разные записи. Кнопки-иконки имеют доступные имена и подсказки; «Сейчас» не является иконкой удаления или сохранения.

**Граница прототипа.** В текущем макете это in-memory демонстрация UI и локальных переходов. «Сейчас» выражает явное возобновление/новый демонстрационный ход; оно не доказывает steering, отправку в CLI, durable enqueue или восстановление после reload. Описанные ниже journal/CAS/adapter/restart требования остаются контрактом рабочей реализации. Наличие экрана или этого документа не означает, что UI-сценарии уже протестированы.

Не заменять молча Enter с «В очередь» на «Прервать». Поведение Enter/многострочного ввода явно следует выбранной настройке; IME composition не отправляет сообщение. Клавиатура и screen reader различают Send, Queue, Stop и Reply. История показывает ожидающее сообщение как **ещё не отправленное**, не как ответ уже работающей модели.

После durable enqueue показать receipt «Сохранено в очереди», только затем очистить соответствующую версию draft. Если пользователь успел дописать новый текст, поздний enqueue success не очищает новый draft. При ошибке диска, копирования вложения или сохранения очередь не притворяется принятой; ввод остаётся доступен. Восстановление после reload не вызывает модель.

## 3. Данные: одна очередь Task с адресными lanes

Task имеет durable очередь; каждый item адресован конкретному discussion/assignment. Внутри неё lane задаёт последовательное исполнение для одного получателя/binding. Несколько независимых workers могут иметь разные lanes, но **на одну ACP session максимум один активный prompt**. Cross-Task Scheduler общий с пользовательскими turns и workers, не отдельный от M2.

Предлагаемые поля — внутренний host DTO, не ACP payload:

| Область | Данные |
|---|---|
| Identity | itemId, operationId, projectId, taskId, discussionId/assignmentId, laneId, createdBy/source, enqueue sequence |
| Версии | itemRevision, queueRevision, draftRevision, accepted requirement/assignment refs; captured revisions адресата, не global currentTask |
| Ввод | immutable content version/ref, attachment snapshots, source references, optional replyTo/questionRef и intentKind |
| Настройки | settingsIntent: pinned snapshot либо явно выбранный inheritAtDispatch; desired role/model/reasoning refs, scope/permission/tool-policy fingerprints |
| Планирование | dependency refs, display order / explicit scheduling order, notBefore/deadline при наличии, hold reasons, edit ownership, quota/budget refs |
| Dispatch | executionId, turnId, runtimeRef, connection generation/session binding, packet hash, dispatch phase и receipts, фактически подтверждённые настройки |
| История | edit/remove/reorder/supersede events, cancellation/reconciliation refs; исходный текст не затирается после dispatch |

`intentKind` может отличать обычную инструкцию, адресный ответ и явную коррекцию; это не доказательство разрешённого действия. IDs вопросов/ролей/ресурсов выдаёт host. Пользовательский текст не может выбрать чужую Task, callback или повысить разрешения через JSON-подобную строку.

Queue draft и отправленный Turn — разные снимки. Enqueue фиксирует пользовательский ввод и намерение настроек. Dispatch после проверок фиксирует окончательный bounded packet, принятые requirements, актуальные evidence и применённые settings. Следующие edits/defaults не меняют этот capture и его internal retries.

## 4. Edit, remove, reorder, объединение и замена

**Edit** разрешён для ещё не claimed item. Backend атомарно ставит edit hold по item/queue revision; редактор не держит транзакцию БД всё время ввода. Draft редактирования autosave имеет собственного owner/revision. Save сохраняет новую content version и снимает hold; Cancel edit возвращает прежнюю версию. Если приложение закрылось при редактировании, сохранить hold/draft и предложить закончить edit; expiry lock не должен неожиданно отправить старый текст. Другое окно видит owner/conflict.

Видимый inline edit hold блокирует автоматический dispatch этой разговорной lane до Save/Cancel, включая момент завершения текущего turn. «Сейчас» для редактируемого сообщения недоступно до явного завершения правки; отдельная явная отправка другого item не снимает edit hold и не отправляет редактируемый item; не отправлять молча старый текст. Save атомарно обновляет content revision и снимает именно edit hold, Cancel сохраняет прежний текст item и снимает тот же hold; ни одно действие не снимает `after_stop`, user pause, dependency или unknown-effect hold. Ctrl/Cmd+Enter выполняет Save, Escape — Cancel, с теми же guards; IME composition не должен случайно сохранять. При смене разговора незавершённая правка остаётся у исходного получателя.

**Remove** ожидающего item — cancelled/tombstone с Undo по [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md), без ACP вызова. Undo возвращает item только если всё ещё допустимы адресат/права/зависимости; он не запускается автоматически поверх текущего turn. Для уже claimed/dispatched сообщения вместо edit/remove предложить correction либо остановку текущего ответа. Не переименовывать это в «удаление отправленного сообщения».

**Reorder** меняет только ещё не claimed элементы выбранной lane, по CAS и валидным dependencies. Не переносить сообщение впереди обязательного ответа/настройки/артефакта, не перескакивать scope hold. Display drag между lanes не меняет получателя сам по себе; «Перенаправить» — отдельное действие с проверкой scope. Перестановка item не меняет порядок уже наблюдаемых effects или историю разговора.

**Batch** и **supersede** опциональны и явно выбираются пользователем. Batch показывает точный состав/порядок и границы отдельных сообщений; одна отправка имеет mapping к исходным IDs. Нельзя автоматически склеивать инструкции с разными получателями, settings/scope, questions или dependencies. Supersede указывает заменяемые pending IDs и сохраняет историю; зависимые links переназначаются только после проверки. Уже dispatched item не заменяется задним числом. Без такого действия каждый queued item остаётся отдельным prompt.

Умность очереди — сохранённый ввод, корректная адресация, безопасные предложения и понятные ограничения. Для дедупликации повторного click использовать operationId; совпадение текста не означает дубликат намерения. Не вызывать LLM на каждый ввод/drag и не применять его скрытую классификацию как разрешение на write, cancel, merge или удаление сообщения.

## 5. Ответы, новые инструкции и steering

Приоритетные control/answer операции проходят **отдельно от обычной prompt queue**, через тех же владельцев и журнал. Они не занимают слот нового LLM turn и не ждут, пока очередь освободится; при этом сохраняют scope, revisions и реальную schema.

| Ввод | Как адресуется | Когда доставляется |
|---|---|---|
| Ответ в карточке живого вопроса/permission | Исходный callback + question/request handle, binding/generation, offered options, получатель | Сразу через реально поддержанный callback, один раз; не вторым session/prompt |
| Ответ на вопрос Task, runtime callback отсутствует | QuestionService сохраняет versioned answer и требования; queued addressed input/ref | Следующий safe boundary, с приоритетом перед зависимой работой. Сохранено в Task не означает уже получено моделью |
| Обычный новый текст | Текущий выбранный discussion/assignment фиксируется при enqueue | Через очередь; «да», «продолжай», «нет» не угадываются как approval другого вопроса |
| Явная коррекция задания | Ref на изменяемый input/requirement; Task writer/impact path | Новая версия и ограничения нового dispatch сразу, доставка модели на безопасной границе |
| Verified live steering | Отдельная кнопка/намерение и поддержанный adapter конкретной версии | Только по его фактическому contract; outcome/visibility показываются честно |
| Cancel | Captured active turn/binding | Вне очереди и независимо от quota/circuit hold; исход ждёт terminal/reconcile |

Если одновременно несколько вопросов, UI показывает, на какой отвечают. Нельзя привязать ответ к «последнему вопросу» после переключения вкладки. Разрешение отвечает конкретному tool request; свободный комментарий остаётся данными, не расширяет option scope. Stale callback после cancel/reconnect закрывается с объяснением; черновик ответа можно сохранить, но не отправить в новый request автоматически.

Входящие structured plan/todo/status updates текущего turn продолжают обновлять соответствующую projection по [TASK_TODO_PANEL](TASK_TODO_PANEL.md), даже когда пользовательские сообщения queued/paused. Они не являются новыми пользовательскими prompts и не требуют LLM-классификации. Изменение плана самим агентом не снимает user pause, не выдаёт authorization и не превращает его reported done в формальный check pass.

Если вопрос реально блокирует текущий turn, нельзя поставить его ответ за тем же turn в обычной очереди: получится deadlock. Использовать подтверждённый callback. Если target не раскрывает такого канала, честно показать ограничение и безопасное действие; не решать deadlock скрытым вторым prompt. Когда вопрос задан в обычном уже завершённом ответе, следующий prompt допустим обычным порядком.

Стандартный путь Queue не является live steering. Если пользователь выбирает **«Остановить и отправить вместо»**, UI прямо называет cancel + новый prompt: сохранить replacement item, запросить отмену, дождаться terminal и сверить pending effects, затем продолжить через admission. При unknown — replacement остаётся held. Не выдавать такой режим за незаметную корректировку уже выполняемого запроса.

## 6. Настройки роли/модели и вложения

По умолчанию item фиксирует **выбранные desired настройки в момент enqueue**: роль/profile version, модель/provider route и reasoning. Если селектор показывал pending change, очередь ссылается на это намерение, а не молча на прежнюю applied модель. До dispatch adapter должен применить/проверить нужную конфигурацию. Failure/partial apply держит item с объяснением; нет скрытого fallback на старую или другую модель.

Изменение default роли/модели после enqueue не меняет старые items. Отдельное действие «Применить к ожидающим» показывает затронутые IDs и сохраняет новые revisions. Optional **inheritAtDispatch** разрешён только как видимый выбор: брать актуальные настройки **адресата**, не активной вкладки; окончательный snapshot и readback фиксируются перед отправкой. Ни один вариант не меняет уже запущенный turn/worker/retry. Подробности — [MODEL_AND_CONTEXT_CONTROLS](MODEL_AND_CONTEXT_CONTROLS.md) и [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md).

Текст и выбранные attachments должны пережить закрытие окна/restart. Для attachments сохранить owned immutable bytes/ref, hash, media type, размер и provenance до receipt «в очереди». Простой путь к изменяемому/временному файлу недостаточен. Пока upload/copy не завершён, показывать подготовку draft, не completed enqueue. Unsent removal освобождает blob только при отсутствии других refs/retention; уже отправленная версия остаётся связанной с receipt.

Вход «прочитать актуальный файл проекта» может быть **адресной source reference**, а не attachment snapshot: это явно другой режим. При dispatch получить разрешённую актуальную версию и записать hash; если сообщение зависело от старой версии, выполнить impact/revalidation. Не заменять незаметно bytes уже выбранного изображения новыми bytes того же имени.

Смена модели требует перепроверить image/media capability, реальные размеры и input/context limits. Несовместимые вложения сохраняются с понятной причиной hold, не удаляются и не отправляются неподдержанной модели. Счётчик контекста actual/estimated/unknown, bounded packet и rollover — по [CONTEXT_BUDGET](CONTEXT_BUDGET.md); вся очередь не загружается в текущий model context заранее. Секреты не копируются в queue metadata/debug export, а payload доступен только своему scope.

## 7. Admission и безопасные переходы

Не вводить новое execution enum: использовать **queued, starting, running, waiting_permission, waiting_retry, cancel_requested, reconciling, completed, failed, cancelled, interrupted_unknown** из M2. Editing/paused/dependency/settings/attachment/unknown-effect — reasons для queue hold, а не новые workflow statuses. Workflow ready/waiting_input/blocked/... остаётся у существующего engine.

Обычный idle Send также сначала добавляет item в хвост существующей очереди. Автоматический admission рассматривает голову FIFO выбранной lane; busy/edit/paused/blocked head не обходится поиском следующего «готового» сообщения. Явное «Сейчас» фиксирует конкретный `itemId`/revision: это отдельный запрос приоритета или возобновления, а не автоматическое перескакивание. Reorder/admission всё равно проверяют dependencies и holds. Если пользователь выбирает item не из головы, допустимая перестановка фиксируется явно и атомарно; при конфликте показывается причина, скрытого обхода зависимостей нет.

Enqueue, Save, Cancel edit, Remove и «Сейчас» используют стабильные IDs и guards владельца очереди. Double click, поздний render callback и завершение turn не должны дважды claim один item. Нельзя адресовать строку по её текущему индексу, генерировать новый ID при rerender или считать отключённую кнопку единственной защитой. В макете необходим локальный атомарный guard, в runtime — CAS/operationId у единственного backend writer; это не обещание exactly-once внешних эффектов.

Один admission transaction:

1. Проверить item/queue/assignment versions, recipient existence/lifecycle, scope/authorization, отсутствие edit/user/deletion holds, dependencies и действующий parent budget.
2. Сверить требования и inputs: изменение label не делает prompt stale; изменение relevant goal/acceptance может требовать обновить packet или получить конкретное решение. Не отправлять старое поручение против новой принятой области автоматически.
3. Проверить свободную session lane, settings readiness, runtime capability, attachments и quota. Все необходимые настройки применяются до prompt; если несколько RPC дали partial result, удержать dispatch.
4. Атомарно claim item и зарезервировать execution identity/slot. Сохранить final packet/settings capture и durable dispatch intent; только затем вызвать adapter.
5. Публиковать receipts и correlated events. Edit/remove, проигравшие claim CAS, возвращают конфликт; уже отправленный текст не меняется. Две окна не посылают один item дважды.

`starting` ещё не доказывает, что отправки не было: хранить dispatch phase. После записи intent и возможной передачи байтов crash может оставить неопределённость. Ни stdout silence, ни успешный локальный write, ни смена вкладки не являются terminal outcome. Следующий prompt этой session не начинается до settlement исходного; при disconnect — unknown и reconciliation.

Terminal failure не делает успешной зависимость A2 от результата A1. После ошибки удержать зависимые items с причиной; явно независимый диагностический follow-up допускается по обычным scope/budget checks. Если из текста нельзя надёжно установить зависимость, не угадывать её «умной» автоотправкой: сохранить pending и предложить проверить следующий шаг. Не считать любой завершившийся ответ основанием безусловно опустошить всю очередь.

Scheduler сохраняет FIFO там, где есть разговорная зависимость, и справедливость между независимыми Task. Foreground может иметь bounded приоритет; фоновые workers не голодают бесконечно. Общие provider/account quota, circuit и task budgets из [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md) включают чаты и workers. Полная lane не должна удерживать database transaction или мешать cancel/ответу на реальный вопрос. Ограничить длину/объём очереди явной policy; overflow сохраняет draft и объясняет причину, не теряет ввод.

## 8. Stop текущего ответа, Pause очереди и Stop всей Task

| Действие | Последствие |
|---|---|
| **Остановить ответ** | Cancel только captured current turn. Ожидающие сообщения сохраняются; безопасный default — видимый hold `after_stop`, чтобы следующее не запустилось неожиданно сразу после остановки. «Продолжить очередь» снимает его после settlement |
| **Приостановить очередь** | Запрет новых dispatch выбранной lane/Task; текущая работа продолжается. UI пишет «Текущий ответ продолжается», не «всё остановлено» |
| **Продолжить очередь** | Проверить revisions/dependencies/settings/unknown effects и снять hold; не переслать прошлый prompt и не сбросить budget |
| **Остановить всю задачу** | Удержать все lanes Task, адресно отменить её managed turns/workers; чужие Task не затрагиваются. Queued items сохраняются paused, пока пользователь отдельно не выберет их отмену |
| **Удалить ожидающие** | Только выбранные недоставленные items становятся cancelled/tombstoned; это не прекращение active turn |

Stop не извлекает и не отправляет остаток очереди, в том числе из запоздавшего completion callback. После подтверждённого settlement «Сейчас» может быть явным запросом возобновить выбранное ожидающее сообщение новым ходом, с теми же revision/dependency/admission проверками; само наличие idle состояния не снимает `after_stop`. При активном turn эта кнопка не разрешает второй `session/prompt`: verified steering использует только поддержанный adapter, а cancel → drain → reconcile → replacement остаётся отдельно названным действием «Остановить и отправить вместо». При unknown результатах оба пути остаются held до сверки. Название «Сейчас» не обещает мгновенное прерывание уже выполняемого tool.

Политику after_stop показать в UI; её можно изменить явной настройкой, но не менять поведение незаметно. Session cancel не означает отмену внешней CI job, PTY или опубликованного изменения. Stop Task показывает реально управляемый scope и pending/unknown, не обещает управление скрытыми native children. При multiplex не убивать общий process ради одного turn.

Cancel и ответы на живые callbacks проходят вне очереди даже при pause/circuit. Отправку и исход всё равно журналировать. Ошибка журналирования не превращает неотправленный cancel в успешный: показать фактическую потерю наблюдаемости/результат emergency path, если он существует в приложении. Не объявлять выполнение по клику кнопки.

## 9. Receipt: сохранено, передано, принято, применено

| Наблюдение | Честная надпись/смысл |
|---|---|
| Durable queue commit | «В очереди»; модель ещё не получила сообщение |
| Claimed/final capture | «Готовится отправка»; фиксированные получатель/настройки, edit уже закрыт |
| Transport write подтверждён локально | «Передано в CLI» только на этом уровне evidence; не «агент выполнил» |
| Реальное correlated событие/ответ CLI | «Обрабатывается» по наблюдаемому факту. Отдельный acceptance ack не предполагается |
| Terminal prompt result | Turn завершён с конкретным outcome; результат/acceptance проверяются отдельно |
| Изменение requirement/settings | «Сохранено в Task», «Ожидает применения» или подтверждённое applied; эти статусы не сливаются с отправкой текста |

У ACP terminal response может быть первым подтверждением; UI не выдумывает промежуточный ack. Условия receipt фиксируются adapter capability evidence. Correlation включает connection/generation/session/turn/request; текст из stderr не подтверждает обработку конкретного item. Timeout после возможной отправки → unknown/reconcile; нельзя переименовать его обратно в queued и автоматически отправить заново.

## 10. Сбой, restart и мультиоконность

После restart восстановить committed queue/drafts/attachments/edit holds, captures, reservations, callback metadata и незавершённые операции. Callback function старого процесса не сериализуется: повторно отвечать можно только восстановленному настоящему запросу с проверенным mapping. Сохранённый текст ответа остаётся draft/данными до такого подтверждения.

Доказанно недоставленные queued items продолжают обычный admission. In-flight с неизвестным исходом удерживают lane и необходимые resource locks; load/resume лишь при поддержанном contract. Новый connection generation не принимает старые callbacks как новые permissions. Не пересылать последний item по факту restart/новой session. Reconciliation использует journal/status/evidence без повторного external write; новая содержательная попытка — отдельное решение с тем же budget.

Каждое окно подписано на одну backend projection + sequence tail. Команда содержит captured recipient ID/revisions, а не указатель на «current chat» в момент ответа callback. Окно может исчезнуть, owner очереди остаётся. Drag/hide/rename/archive view не меняет адрес queued input. Если Task в корзине/deletion hold, dispatcher не отправляет её очередь; Restore не освобождает unknown автоматически.

Модельный retry принадлежит CLI. Host retry допустим для своей доказанно безопасной операции до dispatch либо подтверждённого idempotent adapter; в M2 определены limits/jitter. Semantic failure не ретраится сетью. Не удваивать запрос «для надёжности», не отдавать зависшее сообщение другому worker без reconciliation и нового assignment/capture.

## 11. Реализация небольшими срезами

| Карточка | Что сделать | Приёмка |
|---|---|---|
| **MQ1 · M2/M3, D2** | Durable per-Task/lane queue поверх existing SessionService; busy → Queue, idle → тот же enqueue/admission, один prompt/session | A1 работает, A2 сохранён; B независим; двойной click и reload не дают двойного prompt |
| **MQ2 · M3, D3** | Pending list, edit hold/autosave, remove/Undo, reorder, recipients и attachments snapshots | Edit/dispatch race, кириллица, IME, restart, changed temp file; draft не теряется |
| **MQ3 · M3, D3** | Развести Stop/Pause/Stop Task, реальные question callbacks, honest delivery receipts | Cancel/answer не deadlock в очереди; неподдержанный callback/steer явно unknown, не fallback второй prompt |
| **MQ4 · M3, D3** | Captured desired settings, explicit apply-to-queued/inherit, settings readback и media/context validation | Текущий retry не меняет модель; queued item не уходит со случайным новым default; partial apply held |
| **MQ5 · M4 native** | Полная Task/requirements/dependency integration, shared worker quota, recovery/CAS и optional explicit batch/supersede | Stale inputs/unknown effects блокируют только зависимое; один writer, без постоянного PS на turn |

D2 не ждёт всех advanced controls: первой полезной сборке достаточно настоящего сохранения очереди, одного active prompt/session, сохранённых drafts и безопасной отмены. D3 быстро добавляет удобное редактирование и управление. Сложные зависимости не требуют ждать всех IDE/native features: неподдержанную функцию показывать честно, не имитировать её.

## 12. Fault tests и живой сценарий

| Сценарий | Что должно быть доказано |
|---|---|
| A1 active, A2/A3 queued; B отправляет сообщение | A1 immutable, один prompt/session; B не заблокирован UI очередью A при наличии общей квоты |
| A1 завершился, пока A2 редактируется inline; A3 ожидает | Lane остаётся на edit hold до Save/Cancel; A3 не обходит голову. Save/Cancel не снимают отдельный after_stop или unknown hold |
| Idle с A2/A3 в очереди; пользователь отправляет A4 из composer | A4 добавлен в хвост, сначала допускается A2; заблокированная голова не перескакивается |
| Stop и поздний completion; двойной клик «Сейчас» | Остаток сам не запущен; явный допустимый send-now создаёт один claim, не два. Активный CLI turn не получает скрытый второй prompt |
| Edit A2, переход A → B → A; Ctrl/Cmd+Enter/Escape | Черновик и hold принадлежат A, в B не появляются; клавиши выполняют только Save/Cancel своей версии, не обычную отправку composer |
| Save edit одновременно с claim / Remove одновременно с claim | Один CAS winner; проигравший видит conflict, исходный/новый текст не смешиваются |
| Два окна отправляют один operationId | Один queue receipt и один dispatch; одинаковый текст с разными осознанными операциями не удаляется как «дубликат» |
| Enqueue success пришёл после нового ввода | Очищена только сохранённая draft revision, новый текст остаётся |
| Edit начат, окно закрыто | Draft/hold восстановлены; старый item не отправился от истечения lock |
| Реальный вопрос блокирует A1, A2 в очереди | Ответ идёт исходному callback и разблокирует A1; A2 не вытесняет его. Ответ из старого окна/другой generation отвергнут |
| «Да» обычным сообщением при двух вопросах | Нет auto approval чужой операции; выбранный reply target виден явно |
| Stop A1, затем Pause/Resume; cancel во время retry | Control не ждёт prompt queue; A2 удержан до terminal/reconcile и выбранного resume; B продолжает |
| Подмена модели/роли defaults при queued item | Pinned intent сохранён; inherit применяется только там, где выбран; active retry capture прежний |
| Attachment changed/deleted, новая модель без images | Используются сохранённые bytes либо видимый preparation failure; никакого silent drop/fallback |
| Crash до claim / после intent / после передачи / перед receipt | Каждый случай отдельно: недоставленное можно отправить, неоднозначное held; **нет автоматического replay unknown prompt** |
| Supersede/batch с конфликтующими dependencies | Отказ либо явный исправленный план; уже отправленный item не переписан |
| Task удаляется / scope изменён / parent budget исчерпан | Новый dispatch запрещён; rename metadata сам по себе ничего не инвалидирует; child queue не обходит budget |

Clean control — очередь отдаёт A2 ровно один раз после допустимого завершения A1. Known_bad fixture намеренно отправляет второй prompt или применяет старую generation — проверка обязана обнаружить нарушение. Empty/no event/no runtime — not_run/unknown, не pass. Не создавать настоящую rate-limit нагрузку; simulated faults помечать отдельно.

Live на целевой Windows: A1 с достаточно длительным безопасным запросом → поставить A2/A3 → отредактировать/переставить A3 → переключиться на B → ответить на настоящий вопрос A, если target поддерживает → остановить A1 → проверить hold/результат → продолжить очередь → reload. Сохранить build/runtime/schema, IDs/receipts/timings, фактические prompts/effects и оставшиеся ограничения. Этот сценарий **здесь не выполнялся**. Никаких обещаний скрытого steering, exactly-once удалённых действий или мгновенного применения текста без подтверждения.
