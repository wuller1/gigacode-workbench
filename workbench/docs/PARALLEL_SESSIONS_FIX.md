# Параллельные сессии: локализация сбоя и исправление оболочки

Дата: **2026-10-09**. Цель — исправить параллельные чаты в существующей Electron-оболочке, **не меняя GigaCode CLI**. Код прототипа и ACP-трасса установленного GigaCode пока не получены; конкретная причина его сбоя ещё не доказана. Ниже — проверенные факты Qwen, различающие проверки и предлагаемые изменения только в UI/host. Это не утверждение о выполненном исправлении пользовательского приложения.

Самая полезная первая проверка: **не разделяют ли чаты один mutable currentSessionId, повторный connect() и один набор callbacks?** Сервер Qwen поддерживает несколько сессий; это не делает любую клиентскую обёртку многосессионной.

## Что уже установлено по исходникам

Использован уже скачанный checkout QwenLM/qwen-code, commit **4360b003a087fe9e57f6ffbe7ba48795980b59c3**, версия package.json **0.25.0**, время commit **2026-10-09T09:27:05Z**. Это snapshot main, не номер релиза GigaCode. Исходники находятся в рабочем каталоге исследования; зависимости не устанавливались, Qwen/GigaCode с авторизацией не запускались. Полная граница совместимости — в [QWEN_BASELINE.md](QWEN_BASELINE.md).

| Проверенный факт именно Qwen | Следствие для нашей оболочки |
|---|---|
| Сервер хранит Map<string, Session>; prompt ищет объект по params.sessionId. [Карта сессий](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L3926), [prompt lookup](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7038). | Один процесс может адресовать разные сессии в этом upstream. Поддержку и реальное перекрытие работы GigaCode надо проверить отдельно. Handshake сам по себе не доказывает отсутствие гонок. |
| VSCode AcpConnection имеет **один sessionId**; newSession() записывает результат в него, sendPrompt() берёт текущее значение, switchSession() меняет его локально, cancelSession() отменяет текущее значение. [Поле](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L56), [newSession/sendPrompt](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L495), [switch/cancel](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L673). | Нельзя использовать такую абстракцию как общий mutable адресат нескольких чатов. Это характеристика API данного класса, **не доказанный баг расширения Qwen и не утверждение о коде пользователя**. Нужен явный sessionId, полученный из неизменной привязки chatId. |
| connect() при существующем child вызывает disconnect(); disconnect() закрывает stdin и затем завершает процесс. [connect](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L81), [disconnect](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L738). | Вызов connect() при открытии каждой вкладки на общем instance может оборвать соседний чат. Нужен один сохраняемый promise запуска на процесс, а не повторный reconnect. |
| У того же клиента один onSessionUpdate, onPermissionRequest и onEndTurn; последний вызывается после prompt-response без sessionId. [Callbacks](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L63), [end turn](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L537). | Не переназначать callbacks под активную вкладку/окно. Завершение prompt привязывается к captured chat/session в promise этого запроса; updates маршрутизируются по входящему sessionId. |
| В Session новый prompt после допуска к исполнению отменяет предыдущий pendingPrompt и ждёт его завершения. Это **не независимые параллельные ходы внутри одной сессии**. [Abort](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5342), [drain](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L5406). | По умолчанию один активный prompt на sessionId, очередь остальных сообщений. Параллельные независимые чаты получают разные сессии. Режим намеренного interrupt — отдельное явное действие UI. |
| session/update содержит sessionId; cancel ищет конкретную сессию и также отменяет ожидающие admission вызовы этой сессии. [Updates](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L8474), [cancel](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L7183). | Кнопка Stop должна адресовать исходный binding. Отправка cancel — не подтверждение rollback и не основание сразу начать следующий prompt. |
| Клиент защищён от поздних ответов/exit старого connection: проверяет identity child и SDK connection; initialize состязается с завершением процесса. [Exit ownership](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L169), [initialize](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.ts#L372). | Сохранить такую проверку после каждого await. Старый process exit не должен очищать новый process/session registry. Добавить конечный startup deadline; один фиксированный sleep не подтверждает готовность. |

Upstream содержит отдельные тесты для [concurrent newSession с разными настройками workspace](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.test.ts#L4057), [конфликта одновременно создаваемого sessionId](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.test.ts#L5272), [поздних ответов старого connection и переключения сессии во время prompt](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/vscode-ide-companion/src/services/acpConnection.test.ts#L500). Их исходники прочитаны, **upstream suite здесь не запускался**. Наличие этих тестов не устанавливает, что соответствующие изменения вошли в GigaCode 26.9.75.

Уже отправленный sendPrompt в этом клиенте сохраняет snapshot sessionId перед await; последующее переключение вкладки **не переадресует этот wire request**. Опасность общей переменной относится к следующему dispatch/cancel и к обработчику completion без адресата. Сами session/update сохраняют sessionId: нужно правильно использовать его в оболочке, а не считать все callbacks upstream безадресными.

## Первая диагностическая трасса

Добавить в Electron main process кольцевой диагностический журнал метаданных. На один сценарий достаточно запуск → два session/new → два prompt → переключение вкладки → Stop первого чата. Записывать:

- monotonic timestamp, направление sent/received/lifecycle, method, JSON-RPC id и направление request/response;
- внутренние chatId, windowId, connectionId, generation, PID; wire params.sessionId, если поле присутствует;
- состояние starting/ready/creating/idle/running/cancelling/unknown/closed, локальный turnId и тип update;
- причины spawn/close/reconnect, correlation запроса с ответом; номер и размер frame, ошибки парсинга/EOF; решение о маршрутизации.

**chatId, windowId, connectionId, generation и turnId — поля нашей оболочки, не новые поля ACP.** Не добавлять их в wire payload и не полагаться на выдуманный ACP turnId. SDK может не отдавать raw JSON-RPC id в callback: тогда использовать его штатный transport observer или собственный локальный permissionKey, сохранив callback-resolution closure. Пароль, токен, prompt, содержимое файлов и полный tool rawInput в диагностическую трассу по умолчанию не записывать.

Проверяемые инварианты:

1. Для одного process slot во время запуска — один spawn и один initialize; второй потребитель ждёт тот же promise.
2. Ответ session/new записывается в binding **того chatId, который его запросил**, независимо от порядка завершения.
3. На одной живой connection независимые чаты имеют разные sessionId. Один sessionId не получает два параллельных prompt.
4. Каждый update/permission/ответ относится к исходным connection generation и sessionId; активная вкладка не участвует в выборе адресата.
5. Cancel A содержит sessionId A. Закрытие окна или вкладки не завершает процесс с другими живыми чатами.
6. После EOF/restart старые callback и permission-vote не изменяют новое поколение. Неизвестный результат отправленного prompt не повторяется автоматически.

## Симптом → проверка → минимальное исправление

| Симптом | Различающая проверка | Минимальное изменение UI/host |
|---|---|---|
| Открытие B прекращает A, появляется EOF/process exit | Сравнить PID до/после открытия B; найти второй connect/disconnect/kill и причину | Один process manager в main process, singleflight запуска. Разделить ensureReady и explicitReconnect. Renderer не владеет child process. |
| A пишет в B либо продолжает историю B | Сопоставить chatId каждого исходящего prompt с sessionId из его session/new; поменять порядок завершения newSession в fake transport | Убрать общий activeSessionId из API отправки. Map<chatId, Binding>, explicit binding на каждый вызов. |
| Текст правильный, но Stop/индикатор completion относится к другому чату | Переключить выбранную вкладку между отправкой prompt и ответом/cancel | Captured binding + локальный turnId на весь async-вызов; completion не брать из общего onEndTurn без адресата. |
| Два независимых чата отменяют друг друга | Проверить равенство wire sessionId и число in-flight prompt на этот ID | Разные сессии для независимых чатов; очередь внутри одной сессии. Не лечить очередью на все чаты сразу. |
| Подвисает только одновременный первый запуск | Сосчитать spawn/initialize/session-new promises; проверить исключение до handshake и process-exit listener | Создавать и сохранять startup promise до первого await; fail startup на exit/error/deadline; session creation singleflight отдельно на chatId. |
| Ошибка только при одновременном session/new разных workspace | Отдельный transport harness: один connection, два newSession, потом последовательные prompt; повтор с последовательным newSession | Если установленный fork не проходит concurrent creation, сериализовать **только создание** на connection. Уже созданные разные сессии проверить на параллельные prompt отдельно. Не объявлять весь multiplex невозможным по одному startup race. |
| Permission появляется не в том окне, кнопка разрешает не ту операцию | Запросить разрешение A, переключить/перезагрузить окно, ответить из старого диалога | Registry ожидающих permissions с исходным connection/session и owner; одноразовый resolver; разрешать только предложенный optionId; устаревший vote отклонять. |
| Странный JSON, потеря части сообщения, зависание при длинном выводе | Подать fake transport склеенные frames, разбитый frame и UTF-8 символ на границе chunks; проверить stderr | Один ACP SDK/NDJSON transport на child, streaming UTF-8 decoding, framing и backpressure. Не JSON.parse каждого data chunk; не объединять stdout со stderr. |
| Перезапуск починил B, затем поздний exit A снова «отключил всё» | Задержать exit/ответ старого process в fixture до ready нового | Сравнивать identity/generation во всех callback; завершение старого process очищает только его registry/pending calls. |
| Два окна показывают одну историю, хотя нужны независимые чаты | Проверить session/new против load/resume/attach, одинаковый persisted session ID и фактический transport | Окна одного разговора имеют одного writer-owner; независимый чат создаёт новую сессию. Если используется отдельный daemon — проверить его documented attach scope, не переносить REST-параметры в ACP. |
| Второй чат просто медленнее; 429/долгое retry без смешения | Убедиться, что оба prompt отправлены в разные sessionId, процессы живы, pending calls не перепутаны; сравнить sanitized retry/error наблюдения | Это может быть provider quota, очередь CLI или ресурсы. Ограничить собственную admission concurrency/показать ожидание. Не пересылать ACP prompt «на всякий случай»: внутри Qwen уже есть retry. |
| Два процесса тоже мешают друг другу | Один и тот же test case с раздельными bindings/PID; проверить launch args, общий порт MCP/службы, один restored ID, фактические ошибки auth/provider | Не увеличивать pool. Локализовать общий ресурс/настройку; не создавать новые учётные данные и не менять CLI. Multiplex UI может оказаться не причиной. |

Источник для транспорта: [Qwen ACP stdio setup](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L3179) и [NDJSON stream](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/acp-bridge/src/ndJsonStream.ts#L1). Для permission — [abort-aware request](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/permissionUtils.ts#L196) и [проверка offered options](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/permissionUtils.ts#L230).

Отдельный qwen serve имеет свои правила attach/queue. Его документация прямо описывает [default single scope: второй клиент одного workspace присоединяется к той же сессии](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/docs/users/qwen-serve.md#L320). Это не поведение обычного session/new direct ACP и не подтверждённая возможность GigaCode.

## Предлагаемая структура transport и session registry

Это **псевдокод изменения host**, не готовый патч прототипа и не существующий API GigaCode. Названия helper-функций ниже внутренние. Использовать совместимую с установленным агентом версию ACP SDK; не импортировать private-классы Qwen. SDK сохраняет wire request/response correlation.

Один SessionManager в существующем backend либо Electron main process владеет child processes, ACP connections и session registry. Не создавать второго владельца в main, если backend уже выполняет эту роль. Renderer отправляет IPC с chatId; main process проверяет связь отправителя с проектом/чатом. Выбор вкладки — только UI-состояние. Если разрешено несколько независимых app instances, нужен один broker/OS single-instance ownership для того же хранилища; два main process с отдельными registry сами собой не координируются.

~~~ts
// Все типы/поля здесь наши, не расширения протокола ACP.
type Binding = Readonly<{
  chatId: string;
  connectionKey: string;       // launch config + workspace boundary
  generation: number;         // меняется при замене child
  sessionId: string;          // только значение из ответа ACP
  ownerWindowId: number;      // один writer; observers возможны
}>;

const processes = new Map<string, Entry>();
const bindings = new Map<string, Binding>();
const byWireSession = new Map<string, Binding>();
const creatingChat = new Map<string, Promise<Binding>>();
const queues = new Map<string, PerChatQueue>();

function wireKey(e: Entry, sid: string): string {
  return JSON.stringify([e.key, e.generation, sid]);
}

function ensureReady(key: string, launch: VerifiedLaunch): Promise<Entry> {
  const existing = processes.get(key);
  if (existing) return existing.ready; // не вызывает reconnect
  const e = allocateEntry(key, nextGeneration(key));
  processes.set(key, e);               // до первого await
  e.ready = Promise.resolve().then(async () => {
    try {
      // Helper обязан подключить exit/error/stdout/stderr до handshake.
      // Он создаёт ОДИН transport и обрабатывает backpressure.
      e.child = spawnOwnedChild(launch, e);
      e.rpc = createCompatibleAcpConnection(e.child, {
        sessionUpdate: p => routeUpdate(e, p),
        requestPermission: p => requestPermission(e, p),
      });
      const init = await handshakeOrExitOrDeadline(e);
      assertCurrent(e);                // identity и generation
      recordNegotiatedCapabilities(e, init);
      await authenticateIfActuallyRequired(e, init);
      assertCurrent(e);
      e.status = "ready";
      return e;
    } catch (error) {
      // Deadline сам по себе НЕ завершает процесс.
      // Нельзя забыть старый child и немедленно создать дубликат.
      await retireAndReapOwnedEntry(e, error);
      if (processes.get(key) === e) processes.delete(key);
      throw error;
    }
  });
  return e.ready;
}

function ensureChat(chatId: string, launch: VerifiedLaunch,
                    cwd: string, windowId: number): Promise<Binding> {
  const bound = bindings.get(chatId);
  if (bound) return Promise.resolve(requireCurrentBinding(bound));
  const pending = creatingChat.get(chatId);
  if (pending) return pending;
  const p = Promise.resolve().then(async () => {
    const e = await ensureReady(processKey(launch, cwd), launch);
    const result = await e.rpc.newSession({
      cwd, mcpServers: approvedSessionMcpServers(chatId),
    });
    assertCurrent(e);
    const b = Object.freeze({
      chatId, connectionKey: e.key, generation: e.generation,
      sessionId: requireValidSessionId(result.sessionId),
      ownerWindowId: windowId,
    });
    // На живом ключе нельзя молча заменить владельца другого чата.
    assertNotOwnedByAnotherChat(wireKey(e, b.sessionId));
    bindings.set(chatId, b);
    byWireSession.set(wireKey(e, b.sessionId), b);
    flushPrebindingUpdates(e, b);
    return b;
  });
  creatingChat.set(chatId, p);
  return p.finally(() => {
    if (creatingChat.get(chatId) === p) creatingChat.delete(chatId);
  });
}
~~~

Process key учитывает executable/version, несовместимые process-wide параметры профиля/config/auth scope и принятую границу workspace. Не помещать секреты в ключ/лог. Разные process-wide system prompt требуют разных подходящих процессов, если горячая per-session настройка установленной версии не подтверждена. Конкретный launcher GigaCode берётся из его установленного help/работающего Desktop; upstream [--acp](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/config/config.ts#L646) подтверждён для Qwen, но команда форка здесь не выдумывается.

Неизвестный sessionId в update никогда не отправлять в выбранную вкладку. Защитный вариант: ограниченный по времени/объёму prebinding buffer на connection для сообщений, полученных до завершения session/new; после binding доставить их владельцу. Такой буфер — предлагаемая защита от порядка событий, а не утверждение, что установленный Giga обязательно присылает их раньше ответа. При переполнении/невозможной привязке показать protocol error; не терять события молча. Permission без установленного владельца не разрешать: дождаться ограниченного binding либо вернуть предусмотренный протоколом отказ/отмену и зафиксировать ошибку.

### Prompt, cancel и события

~~~ts
function submit(chatId: string, blocks: AcpContent[]): Promise<AcpPromptReply> {
  const b = requireCurrentBinding(bindings.get(chatId));
  const q = queueFor(chatId);          // не глобальная очередь всех чатов
  return q.enqueue(async localTurnId => {
    if (q.blockedUnknown) throw new Error("Нужна сверка исхода прошлого хода");
    const e = requireCurrentEntry(b);
    q.active = { binding: b, localTurnId, state: "running" };
    try {
      const reply = await e.rpc.prompt({ sessionId: b.sessionId, prompt: blocks });
      assertCurrent(e);
      requireSameBinding(b);
      finishCapturedTurn(b.chatId, localTurnId, reply);
      return reply;
    } catch (error) {
      const outcome = classifyOutcomeFromObservedEvidence(error);
      // EOF/deadline после отправки != доказательство отсутствия side effects.
      if (outcome === "unknown") q.blockedUnknown = true;
      recordCapturedTurnFailure(b, localTurnId, outcome, error);
      throw error;
    } finally {
      clearOnlyMatchingActiveTurn(q, b, localTurnId);
    }
  });
}

async function stop(chatId: string, expectedLocalTurnId: string) {
  const q = queueFor(chatId);
  const active = q.active;
  if (!active || active.localTurnId !== expectedLocalTurnId) return;
  const e = requireCurrentEntry(active.binding);
  q.pauseDispatch();                    // не запускать queued prompt во время cancel
  active.state = "cancelling";
  settlePendingPermissionsCancelled(active.binding, active.localTurnId);
  await e.rpc.cancel({ sessionId: active.binding.sessionId });
  // Это доставка notification, НЕ ack завершения агентного хода.
  // Ожидаем settlement исходного prompt; по deadline отмечаем unknown.
  // Возобновить очередь можно лишь после известного terminal outcome.
}

function routeUpdate(e: Entry, p: AcpSessionNotification) {
  if (!isCurrent(e)) return recordStaleUpdate(e);
  const b = byWireSession.get(wireKey(e, p.sessionId));
  if (!b) return bufferOrReportUnboundUpdate(e, p);
  appendSessionEvent(b.chatId, p.update);
  publishToAuthorizedObservers(b.chatId, p.update);
}
~~~

Очередь должна иметь предел длины, сохранять draft и показывать queued/running/cancelling/unknown. Stop по умолчанию останавливает конкретный текущий ход и приостанавливает очередь; судьба неотправленных сообщений видна пользователю. Удаление ещё не отправленного элемента очереди — локальная операция, ему не нужен session/cancel. Двойной Stop не должен отменять уже следующий ход: expectedLocalTurnId проверяется в main process.

После terminal prompt response возможны отдельные фоновые session events у поддерживающего их агента. Их адресует sessionId; нельзя без доказательства приписывать каждый поздний update следующему локальному turnId. Завершение одного хода определяется ответом его request/поддержанным протоколом, а не фактом, что UI перестал получать текст.

При cancel клиент отвечает cancelled на pending permission requests текущего хода и продолжает принимать tool updates до завершения исходного prompt. Визуальная отметка отмены незавершённых tools не доказывает rollback внешнего действия. Протокол требует финального ответа исходного prompt после остановки операций; отправленная cancel notification сама такого подтверждения не даёт. [ACP cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation).

### Permissions, окна и завершение процесса

Для каждого callback requestPermission main process создаёт локальный permissionKey и сохраняет: Binding, generation, offered option IDs, owner/subscribers и **resolver этого callback**. Если используется низкоуровневый transport, wire request key включает connection, generation, направление и JSON-RPC id; raw id не глобально уникален. Renderer получает отображаемые данные и permissionKey, но не возможность выбрать произвольный sessionId.

Ответ принимается один раз, только от разрешённого владельца и только для ещё живого запроса. Выбранный optionId должен присутствовать в options исходного запроса; никакого общего «allow» с выдуманным wire значением. После cancel/exit/reconnect устаревший диалог закрывается и не разрешает следующий инструмент. В SDK ответ возвращается из исходного callback; не создавать вручную второй JSON-RPC reply.

Закрытие вкладки/перезагрузка renderer снимает UI-подписку, но не вызывает общий disconnect. Main process явно применяет политику: оставить выполняющийся чат в фоне либо отменить **его** ход. Process завершается после освобождения всех зависимых сессий и pending operations согласно политике пула; reference count включает работу, а не только видимые окна. Другой window может наблюдать тот же разговор; writer передаётся явно, после остановки/сверки активной работы. Не загружать одну persisted сессию одновременно в два child процесса.

Сбой child переводит связанные отправленные ходы в unknown, если финального подтверждения нет. Pending RPC отклоняются, permissions закрываются, новые отправки приостановлены. Новый generation не принимает ответы старого. Resume/load делается только по реально поддержанной схеме установленного GigaCode и после сверки журнала; содержимое неизвестного prompt не пересылается автоматически. Это также защищает от повторного MCP write. У Qwen есть собственные слои retry; сведения и их пределы описаны в [QWEN_BASELINE.md](QWEN_BASELINE.md).

## Если multiplex установленного GigaCode не проходит проверку

Сначала различить создание сессий и выполнение ходов. Если ломается только concurrent session/new, минимальный обход — очередь **создания** на одном connection. Если даже две уже созданные разные сессии на одном connection не проходят routing/cancel E2E, проверить запасной режим:

- **Начальный диагностический предел — два child process**, по одному независимому активному чату/сессии в каждом. Это выбранный предел нашей оболочки, не установленный лимит Qwen/GigaCode и не обещание его работоспособности.
- Третий запрос ждёт свободного slot; процесс не создаётся бесконечно на каждую вкладку. Во время диагностики startup concurrency можно ограничить единицей, сохранив параллельную работу уже готовых двух процессов.
- Не переиспользовать один restored sessionId в двух процессах. У каждого child отдельный ACP transport, pending requests и generation; process-wide конфигурация соответствует профилю чата.
- Проверить actual GigaCode на два процесса, включая auth refresh, используемые MCP серверы, порты, память и 429. Два процесса могут удвоить часть MCP дочерних процессов и не устраняют квоту поставщика модели.
- Отдельные сессии/процессы не изолируют файлы проекта. Параллельные изменения одного checkout требуют явного распределения файлов/задач или отдельных рабочих копий; read-only тест этого не проверяет.

Если два процесса работают, а один с двумя sessionId нет, это полезная локализация. Оставить режим двух процессов как **наблюдённый для конкретной версии fallback**, не патчить CLI. Если не работают оба режима, остановить увеличение параллелизма и проверить общий ресурс/launch/auth/MCP. Для одного процесса capability status остаётся unsupported/unknown с причиной; UI не изображает параллельное исполнение, если фактически поставил всё в очередь.

## Что проверено здесь и что ещё нужно проверить в приложении

В отдельной локальной fixture без npm-зависимостей выполнены **11/11 тестов** на Node **v26.8.1**. Fixture моделирует предложенные host-инварианты; она **не импортирует Qwen, не запускает CLI и не является тестом прототипа пользователя**:

1. Negative control воспроизводит неверного адресата prompt при общем mutable sessionId.
2. Разный порядок ответов session/new сохраняет binding каждого chatId.
3. Перемежающиеся updates и cancel идут по исходному binding.
4. Старое поколение не изменяет и не отменяет новую сессию.
5. Два одновременных потребителя используют один startup promise.
6. Очередь сериализует одну сессию, сохраняя параллельность разных.
7. Неизвестный исход блокирует автоматическое продолжение очереди.
8. Permission требует исходного владельца и предложенный optionId; stale vote отвергается.
9. Два writer не получают один live session.
10. NDJSON fixture принимает склеенные frames и фрагментированный UTF-8.
11. Доставленная cancel A не освобождает slot: A2 ждёт terminal response A1, пока B продолжает работу.

Эти проверки показывают механизм ошибки и проверяемые свойства предложенного исправления. Они не подтверждают скорость, авторизацию, MCP side effects или совместимость GigaCode. Полный транспорт должен использовать проверенный SDK/реализацию с лимитами и backpressure; минимальный parser из scratch fixture не предназначен для production.

### Приёмка на реально запущенном прототипе

Использовать тестовый проект/каталог, действующую авторизацию пользователя и обычные разрешения. Сначала read-only запросы без записи в Jenkins/OpenShift/Confluence. Не создавать rate-limit нагрузку на рабочий сервис. Сохранить sanitized launch/version/handshake и трассу инвариантов; скриншот двух вкладок недостаточен.

| Сценарий | Действие | Проверяемый результат |
|---|---|---|
| Холодный параллельный старт | Из остановленного host открыть A и B почти одновременно; в fake transport задержать ответ A, в live проверить доступный естественный порядок | Для multiplex один PID/initialize, два разных returned sessionId, ни одного disconnect из-за второго окна. Для fallback не больше двух PID. |
| Два prompt | A просит ответ только с маркером TEST-A, B — TEST-B; отправить одновременно. Повторить с достаточно длинными read-only заданиями, чтобы наблюдать перекрытие outstanding requests | Ответ каждого request и все session events в своём чате; одинаковый контент нельзя считать единственным доказательством — проверить wire sessionId. Два отправленных запроса ещё не доказывают параллельные обращения к модели; отметить наблюдаемую степень перекрытия. |
| Смена вкладок/окон | Пока A работает, выбрать B, перенести/перезагрузить окно A; дождаться финала A | Финал/индикатор завершения относится к A; B остаётся жив; нет лишнего spawn от renderer reload. |
| Адресная отмена | Пока A и B активны, нажать Stop A, затем быстро переключить вкладку и повторить старый UI callback | В wire cancel только sessionId A; B продолжает. Повторный старый callback не отменяет новый ход. A выходит из cancelling по фактическому результату или unknown, не по таймеру «успех». |
| Очередь одного чата | Во время A1 отправить A2 | A2 queued; второго session/prompt для A нет до settlement A1. Явный interrupt тестировать отдельно. |
| Permission routing | В fixture задержать permission A и B. В live использовать только уже настроенное разрешение безопасного тестового действия, если оно доступно | Диалоги адресованы исходным чатам; vote B не разрешает A; закрытый/старый dialog не действует после reconnect. Не ослаблять approval-mode ради теста. |
| Отказ процесса | Завершить только тестовый child A/fallback либо общий child/multiplex во время read-only запроса; перезапустить | Правильная область affected chats, unknown outcome, отсутствие автоматического повторного prompt, старый exit не очищает новый generation. |
| Два окна одной истории | Открыть один сохранённый разговор во втором окне | Один writer-owner, observer либо явная передача владения; нет второго restore того же ID в другом процессе. |
| Выбор обхода | Тот же A/B test: один процесс/два sessionId → последовательное создание/параллельные prompt → два процесса | Установлено, какая граница ломается. Режим выбирается по trace; неподдержанное не объявляется реализованным. |

Для воспроизводимости холодный старт/переключение прогнать несколько раз с разным порядком событий; фиксированное число успешных повторов не доказывает отсутствие всех гонок. Детерминированные перестановки задержек в fake transport важнее простого увеличения количества live запросов.

Минимальный порядок работы в реальном репозитории: найти владельца процесса и mutable sessionId → добавить компактную трассу → воспроизвести один failing сценарий → заменить адресацию на bindings и singleflight → добавить регрессию именно этого сценария → выполнить live A/B/cancel/renderer-reload → только при необходимости включить ограниченный fallback. Полный редизайн приложения для первого исправления не требуется.
