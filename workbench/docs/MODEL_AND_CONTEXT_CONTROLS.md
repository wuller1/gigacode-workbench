# Выбор модели, reasoning и состояние контекста

Дата: **2026-10-09**. Контракт интерфейса личного Electron UI, не отчёт о реализованных controls. Read-only исследован Qwen Code commit **`4360b003a087fe9e57f6ffbe7ba48795980b59c3`** и официальная документация ACP v1. Поддержка именно GigaCode **26.9.75**, wire schema, provider aliases и usage проверяется на целевой Windows. CLI не менять. Не считать modern upstream или latest ACP доказательством возможностей форка.

Выбор модели, reasoning и заполненность контекста должны быть доступны **рядом с composer**, без перехода в общие настройки. Это элементы существующих Task/SessionService/PromptAssembler, а не новый контроллер. Связанные правила: [ROLE_ROUTING](ROLE_ROUTING.md), [TASK_WORKSPACE](TASK_WORKSPACE.md), [CONTEXT_BUDGET](CONTEXT_BUDGET.md), [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md).

Уточнение пользователя от 2026-10-10: reasoning уже выбирается в существующем GigaCode UI. Сохранить этот рабочий путь, его значения и настройки; перенос выполнять по [MODEL_AND_REASONING_CONTROLS](MODEL_AND_REASONING_CONTROLS.md). Отсутствие upstream config API не отменяет действующий adapter форка. Управление сжатием и 400/413 описано отдельно в [CONTEXT_CONTROL_AND_ERROR_RECOVERY](CONTEXT_CONTROL_AND_ERROR_RECOVERY.md).

## 1. Что обязательно видно пользователю

Не превращать composer в панель из десятков переключателей: компактная основная строка, детали по нажатию. На узком окне вторичные controls уходят в доступный popover, сохраняя модель и состояние отправки. Модель, reasoning и контекст — ближайшее дополнение; остальные строки ниже являются инвентарём необходимых состояний и доступных действий, а не требованием показать все controls одновременно или задержать выпуск до готовности каждого из них.

| Контроль | Основной вид | Детали/обязательное поведение |
|---|---|---|
| Модель + provider | Фактическое имя модели ▾; provider рядом или внутри selector | Поиск по доступным моделям, текущий выбор, источник списка, недоступные варианты с причиной. Одинаковые labels разных providers не сливаются |
| Reasoning | Применённый уровень/«По умолчанию» ▾ | Только допустимые значения текущей конфигурации; toggle-only, fixed, unsupported и unknown различаются |
| Контекст | Валидный процент либо «Оценка»/«Нет данных» | Used/limit, дата/граница наблюдения, качество данных, breakdown и output reserve; пояснения ниже |
| Роль | Analyst / Frontend / другая роль ▾ | Текущий assignment и следующий шаг, политика auto/manual; смена роли не создаёт Task |
| Область и доступ | Проект/рабочая копия + краткий режим полномочий | Реальные allowed resources/tools и действующие ограничения; имя режима не выдаёт прав |
| MCP / подключение | Компактный статус или проблема | Какие нужные tools доступны/недоступны, binding version; не весь сырой каталог на главном экране |
| Вложения | Видимые chips с типом и состоянием | Прикрепить/убрать/просмотреть, размер и применимые limits; image input только по verified capability модели **и транспорта** |
| Отправка / очередь / отмена | Однозначная основная кнопка и текущая очередь | Queued не равно dispatched; cancel_requested не terminal; retry не повторяет неизвестный write |
| Параллельная работа | Например, «Работают 2» при фактическом счётчике | Текущая Task и другие managed executions по отдельности, их модели/роли/состояния |
| Ошибка / provider disconnect | Причина и конкретное действие | Повтор соединения, вход или безопасное продолжение; draft/attachments не теряются, скрытого fallback на другую модель нет |

В advanced drawer доступны CLI runtime/version, transport/connection generation, capabilities freshness и диагностические IDs. Пользователь не обязан понимать generation, чтобы отправить сообщение. На основном экране не показывать API keys, raw env/config, токены, полные URL с credentials или технический JSON. Авторизация provider — отдельный поддержанный flow, не текстовое поле секрета внутри prompt.

## 2. Подтверждённый механизм и его границы

ACP v1 позволяет получить `configOptions`, включая текущие значения и варианты, изменить их через `session/set_config_option` и получить полный обновлённый список; `config_option_update` также сообщает изменение. Категории `model`, `thought_level`, `model_config`, `mode` помогают раскладке, но могут отсутствовать. Неизвестный тип обрабатывать без падения; boolean требует соответствующей negotiated capability. [Официальные Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options).

| Проверено в pinned Qwen | Практическое следствие |
|---|---|
| [`acpAgent.ts:16626`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L16626): `buildConfigOptions`, model и permission mode; reasoning option возвращается условно | Строить controls по actual options/currentValue, не по списку из макета |
| [`acpAgent.ts:6871`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L6871): `setSessionConfigOption`, model вызывает `setModel` с `persistDefault:false`; reasoning проверяет допустимость и readback | Выбор в задаче не должен молча менять общий provider/project default; успешная отправка команды ещё не подтверждение применения |
| [`acpAgent.ts:6851`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L6851), [`Session.ts:12428`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/Session.ts#L12428): отдельный `unstable_setSessionModel`, сохранение default зависит от пути/options | Не считать старый model setter взаимозаменяемым со session-local config API; проверить transport и побочные эффекты форка |
| [`model-configuration.ts:27`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/model-configuration.ts#L27), [`option builder:450`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/model-configuration.ts#L450): tiered/toggle-only, canDisable/thinkingMandatory | У разных моделей наборы различаются; наличие reasoning не означает доступность High или Off |
| [`model-providers.md:133`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/docs/users/configuration/model-providers.md#L133): модели/endpoint задают profile, efforts/default; requests/retries/children используют captured reasoning | Не менять reasoning в середине retry; не переносить provider-specific wire fields между aliases |
| [`status.ts:706`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/acp-bridge/src/status.ts#L706), [`acpAgent.ts:9042`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L9042): отдельный context usage status, total/window/breakdown/isEstimated; error fallback содержит 0/0 и estimated | Это Qwen-specific поверхность, не универсальное ACP обещание. 0/0 означает отсутствие пригодного измерения, не пустое окно |

У Giga сначала найти существующие controls/calls и адресно зафиксировать их mapping, protocol/schema version и реальные ответы. Нужные SDK names сопоставить с wire contract; не вызывать приватные классы Qwen. Если конкретная новая возможность не поддерживается ни config API, ни работающим adapter, для неё показать фактическое состояние read-only и объяснение способа настройки либо использовать проверенный launch config + новый binding. Не отключать уже работающий выбор из-за отличий от upstream. Не рисовать работающий selector поверх неподдержанного механизма. Не переносить изменения полей ACP v2 в соединение v1.

## 3. Модель и reasoning: честный selector

Хранить stable option ID отдельно от display label и фактической model/provider route. Переиспользовать подтверждённую конфигурацию endpoint/credentials; название модели не доказывает provider, vision, reasoning или лимиты. В списке показать provider label и состояние доступа. Полный base URL — только в advanced при необходимости, с очисткой секретов. Источник списка/время обновления сохраняется; «обновить» не требует создания нового Task.

Reasoning имеет отдельные состояния: selectable tiers; on/off only; fixed/mandatory; default; unsupported; unknown; pending apply. Не кодировать универсальную лестницу Low/Medium/High для всех. `По умолчанию` означает default модели/провайдера, не скрытое Medium. `Off` показывается только когда отключение разрешено. Выбранный tier может маппиться/clamp в provider adapter; если effective значение не раскрыто, писать «запрошено High», а не обещать его точное выполнение. В pinned Qwen это прямо предусмотрено [reasoning-effort.ts](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/core/src/core/reasoning-effort.ts#L11).

После смены модели заново принять полный configOptions snapshot и проверить reasoning/attachments/context limit. Нельзя оставить прежний High или image attachment зелёным, если новая модель их не принимает. При несовместимости сохранить draft и вложения, показать конкретный выбор; не удалять данные и не выбирать более дорогую модель автоматически. Provider-side fallback, если он реально сообщён, отображается отдельно как фактически использованная модель.

Модель и reasoning запоминаются в versioned preferences текущей Task/assignment; project default задаётся отдельным явным действием «Для новых задач проекта». Приоритет: project default → Task override → явно выбранный assignment override. Это настройки исполнения, не факты общей памяти и не бессрочное разрешение. Повторное открытие Task восстанавливает намерение, затем сверяет с actual capabilities; устаревший alias не считается applied. Смена модели не меняет цель, requirement revisions, workflow, budgets или scope.

## 4. Применение на безопасной границе

ACP допускает изменения конфигурации во время генерации; **наша оболочка выбирает более строгий предсказуемый контракт**: новая модель/reasoning применяется к следующему неотправленному turn после idle. Это host policy, не ограничение протокола. Пользователь может выбирать во время работы; UI показывает «После текущего ответа» и сохраняет желаемую пару отдельно от текущей.

1. Task writer записывает proposal с operationId, expected settings revision, assignment/binding, connection generation и desired model/reasoning. Другие окна получают ту же pending настройку.
2. Scheduler удерживает новый dispatch, пока текущий turn/retry/permission не завершён или исход не согласован. Cancel requested, таймер тишины и разрыв соединения не означают idle.
3. Проверенный adapter применяет модель, получает актуальные options, затем допустимый reasoning. Это может быть **несколько внешних вызовов**, а не атомарная транзакция CLI. Host обеспечивает атомарность допуска следующего prompt, а не выдуманный rollback всего CLI.
4. После подтверждения полного состояния сохранить applied settings revision и передать captured snapshot в следующий Turn. При частичном успехе/timeout показать фактически известное + reconciling/blocked; не утверждать, что старая пара восстановлена. Не выполнять новый prompt с неопределённой конфигурацией.
5. Если требуется другой процесс/сессия, выполнить handoff по [CONTEXT_BUDGET](CONTEXT_BUDGET.md): checkpoint, pending reconciliation, разрешённый новый binding того же Task, сохранённые вопросы/решения/attempt/budgets. Не пересылать выполненный запрос заново.

Уже отправленные prompts, internal retries и запущенные workers сохраняют captured settings. В очереди видна модель конкретного элемента; изменение defaults не меняет queued snapshot молча. Если пользователь явно выбрал «применить к ожидающим», изменить только ещё не dispatched элементы с отдельной записью revision. Две окна не применяют конфликтующие настройки одновременно; stale CAS отклоняется. Роль, модель, scope и permission mode — разные controls; смена модели не расширяет MCP permissions.

## 5. «Контекст заполнен» и «потрачено токенов» — разные данные

В официальной ACP v1 schema `usage_update.used` описывает токены **текущего контекста**, `size` — размер окна, а optional `cost` — накопленную стоимость сессии. Поддержка и точность этих полей конкретным CLI всё равно требуют проверки. [ACP UsageUpdate](https://agentclientprotocol.com/protocol/v1/schema#usageupdate).

Сумма input/output всех запросов может многократно превышать окно и не является его заполненностью. Последний API `prompt_tokens` описывает вход того запроса, а не автоматически текущее состояние после output, tool calls или compaction. Usage накопленных retries/субагентов отображается отдельно. Cached tokens занимают контекст; это не освобождённая память. В Qwen breakdown cached является перекрывающейся аннотацией, а не дополнительным слагаемым. [status.ts:680](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/acp-bridge/src/status.ts#L680).

Контекстная запись host содержит session/binding + connection generation + context revision/epoch, model/provider/config fingerprint, observed sequence/time, numerator/denominator с источниками, `actual/estimated/unknown`, scope покрытия и stale reason. Эти поля внутренние: если upstream не сообщает revision/epoch, host отслеживает только наблюдаемые изменения и честно отмечает неизвестное. Нельзя искусственно назвать snapshot fresh, имея лишь текущее время получения старого ответа.

Правило процента: показывать `100 × used / limit` только при **положительном проверенном limit, измеренном/достоверно сообщённом used и совпадающей контекстной идентичности обоих значений**. Числа finite/non-negative; `used > limit` — ошибка/overflow, а не зелёный зажатый до 100% badge. При смене модели, compaction, новой generation или непокрытом приросте входа прежний процент становится stale до нового измерения. Не собирать used от A и limit от B.

| Данные | Компактное отображение | Детали |
|---|---|---|
| Валидный actual snapshot | «Контекст N%» и неброский индикатор | Used/limit, источник, момент наблюдения; округление только при выводе |
| Только оценка | «Контекст: оценка» | Диапазон estimated tokens, метод, запас и неизвестные компоненты; без точного процента |
| Последний request, уже stale | «Контекст: обновляется» или «Последние данные» | Последнее число подписано границей запроса и причиной stale; не выдаётся за сейчас |
| Нет numerator/denominator, 0/0, hidden history | «Контекст: нет данных» | Что именно CLI не сообщает; собственный pack count показан отдельно |

**256k — заявленный пользователем ориентир**, не default denominator для всех моделей. Реальный предел может ограничивать endpoint, CLI или отдельный input cap. Разделять input window, совместный input+output limit, maximum output и рабочий бюджет; применять формулу/резервы из [CONTEXT_BUDGET](CONTEXT_BUDGET.md). Процент raw occupancy и «можно безопасно отправить» — разные показатели. Индикатор не должен обещать свободное место, которое уже зарезервировано для ответа.

В раскрытии показать имеющийся breakdown: system/project instructions; tool schemas builtin/MCP; history/messages; memory/skills; attachments/images; unattributed overhead; cached annotation; output reserve и guard. Категории выводить только если они реально измерены/оценены; отсутствующее не заменять нулём. Не суммировать одновременно history с входящими в неё tool results или cached с их исходными категориями. Изображения считать по правилам провайдера; bytes файла не равны tokens. Детальные source/tool names показывать по необходимости, без полного дампа prompt или секретов.

Накопленные tokens/cost — отдельная строка «За задачу/сессию» с ясным scope и покрытием. Не суммировать повторно cumulative snapshots, не учитывать reasoning дважды внутри output. Currency, model-specific rates, cached rates и дата тарифов обязательны для локальной оценки денег; если их нет — стоимость неизвестна. Из token count нельзя придумать цену. Общий контекст разных параллельных workers не складывается в одно окно.

## 6. Связь с существующими сервисами

CapabilityRegistry хранит проверенный список/схему и freshness; Task writer — preferences и proposals; SessionService/ProcessManager — applied binding/runtime; Scheduler — безопасную границу и captured Turn; PromptAssembler — входной pack/резервы; EventStore — receipts и usage history; renderer — проекцию. Ни selector, ни progress bar не владеют CLI и не запускают второй workflow engine.

Обновление идёт от подтверждённых config/usage событий и ограниченного запроса snapshot при reconnect/открытии деталей, без LLM на click и без постоянного дорогого context inventory. Окно после reload восстанавливает pending/applied из owner, не применяет настройки повторно. Точная generation доступна в диагностике, краткий connected/reconnecting/error — в обычном UI. Неподдержанная функция имеет объяснение и проверяемый следующий шаг, а не фиктивный интерактивный контрол.

## 7. Малые карточки и приёмка

**MC1:** адресная проверка существующего mapping Giga/model/provider → **MC2:** перенос работающих selector/reasoning и сохранение preferences/per-Task persistence → **MC3:** дополнить выявленные пробелы queued apply/readback/CAS → **MC4:** usage source adapter и честный context badge → **MC5:** связать scopes/MCP/attachments/errors/parallel counts в composer. Не делать новый полный capability inventory условием переноса действующей функции. Использовать существующие components; не менять framework и не трогать CLI. Эти controls нужны в ближайшем рабочем UI, не после IDE или всех M12 функций.

Проверить на целевой сборке:

- Модели с tiers, toggle-only, fixed и unknown; список зависит от provider, unsupported выбор не отправляется и не становится applied.
- Смена модели во время stream/429 остаётся pending; текущий turn и retry сохраняют settings, следующий использует подтверждённую пару. Partial apply/timeout не маскируются успехом.
- Два окна одной Task дают один результат CAS; соседняя Task и уже работающий subagent не меняются. Project default влияет только на предназначенные новые исполнения.
- После restart сохраняются preferences, draft/attachments и pending transition; bindings сверяются, внешние действия не повторяются.
- Usage actual, estimated, missing, 0/0, stale, overflow, compaction и model limit change отображаются различно; cached/расход за историю не искажают occupancy.
- Known_bad: подставить used старой generation или cumulative tokens как occupancy — индикатор обязан отвергнуть данные. Empty: нет usage — «Нет данных», не 0%. Clean: заведомо корректная пара одного snapshot даёт ожидаемый процент.
- Provider disconnect/auth expired, недоступный MCP и несовместимое image attachment дают конкретное объяснение без потери ввода и секретов в логах.
- Keyboard/focus, русские labels и узкая ширина: selector/reasoning/context доступны, Send/Cancel не перекрыты; controls обновляются без клика/reload.

Отчёт содержит build/runtime/model/provider, фактические schema/options, observed applied values, источники usage и выполненные сценарии. Макет может иметь явно обозначенные demo values; они не являются результатами интеграции. Работа GigaCode 26.9.75 и реальная заполненность его контекста здесь **не проверены**.
