# Аудит обвязки и назначение ролей — 0.5.0-preview.1

Дата: 14.10.2026. Целевая рабочая установка пользователя — **GigaCode CLI 26.10.6**. Её здесь нет. Проверенный upstream — установленный Qwen Code 0.25.1; его исходники не изменялись.

Это исторический отчёт среза 0.5. Изменения и доказательства 0.6 приведены в [новом аудите](RUNTIME-TRANSITIONS-RESILIENCE.md); формулировки о текущем коде ниже относятся к проверенному срезу 0.5.

Это аудит исполняемой обвязки, промптов, смены ролей, восстановления, MCP и пользовательских состояний. Он не объявляет весь roadmap приложения завершённым, полное соответствие IntelliJ/DataGrip или отсутствие всех возможных дефектов.

## Итоговая архитектура

У каждого исполнителя — собственная версия инструкций: **нативная база CLI + CORE + ровно одна роль**. `SYSTEM_PROMPT.md` — entrypoint для legacy/bootstrap, не второй дубликат CORE в native host. Все 14 ролей имеют отдельные предметные инструкции, процесс, критерии результата и основания для передачи работы. Помощь, конструктивная критика, проверка фактов и честная приёмка общие для всех ролей.

Изученный Qwen получает CORE + роль через `--append-system-prompt` своего процесса. Сохраняются встроенные инструкции CLI. Для неизвестного форка применяется явно обозначенный `context_only`: название файла и слова модели не считаются доказательством системного уровня. Существующий пользовательский system override не переписывается; при конфликте композиции выбирается объяснимый context fallback.

Фактический способ, профиль, fingerprint и состояния `prepared/active/closed` доступны в настройках ролей и подсказке composer. `active` означает принятую настройку процесса или завершённую передачу контекста, а не доказательство послушания модели.

## Найдено и исправлено

| Проблема | Исправление и проверка |
| --- | --- |
| Объёмные общие инструкции повторялись в CORE, SYSTEM и ролях; native executor получал обязательные legacy-команды | Единая база, компактные overlays, отдельный legacy adapter, размер процесса зависит от задачи. [Аудит промптов](../../workbench/docs/PROMPT_QUALITY_AUDIT.md) |
| Keyword-router не понимал «теперь реализуй», историю и назначенный этап; слово SDD могло само переключить роль | LLM-router получает ограниченный request/task/project/history/catalog packet. Валидируются ID, confidence и актуальность входных данных; нет ручного role selector и скрытого keyword fallback |
| Роль передавалась только обычным контекстом | Версионированный compiler, проверка точного runtime, per-process system append для Qwen; фактический provider request проверен локальным протокольным стендом |
| Hash промпта не позволял восстановить его после обновления файлов | Content-addressed registry точных CORE + роли; текст связан с manifest/fingerprint, fingerprint записан у сообщений. `instruction_snapshot` читает историческую версию страницами только из истории своей сессии |
| Rename снимка инструкций мог быть подтверждён до durable directory entry при отключении питания | POSIX file sync → rename → instructions dir sync → dataDir sync, включая concurrent/existing return; четыре fault/order regressions. Windows не обещает portable directory-fsync; физическое отключение питания не моделировалось |
| MCP `agent_spawn` всегда передавал запрещённый параметр и падал | Атомарные create + enqueue, durable operationId, повтор возвращает тот же короткий receipt; role hint не override. Проверен настоящий HTTP MCP → WorkbenchService |
| Старый MCP bearer оставался рабочим после смены исполнителя; медленная загрузка обходила первоначальную проверку | Ротация при binding, отзыв до остановки/восстановления, проверка после HTTP body и перед вызовом. Отрицательный контроль старого обработчика: 200/вызов; исправленный: 401/ноль вызовов |
| После cancel мог повторно использоваться ACP с отозванным MCP доступом | Отмена заканчивается checkpoint и заменой процесса; cancel → resume проверен с новым PID и рабочим новым bearer |
| CLI мог игнорировать отмену и навсегда удерживать очередь | Watchdog 10 секунд завершает принадлежащий host процесс; dispatched turn становится UNKNOWN/paused без replay. Неотправленный запрос сохраняется; проверены fresh startup и routing с тёплым процессом |
| Подготовленные и завершённые разговоры копили процессы CLI без ограничения | LRU безопасно простаивающих исполнителей ограничен `maxConcurrent`; перед выгрузкой checkpoint, закрытие binding и revoke. Active/queued/unresolved процессы не удаляются ради лимита |
| Worker копировал строку parent.model вместо принятого ACP значения | Atomic spawn захватывает accepted configValues модели/reasoning отдельной копией; более поздняя смена родителя не изменяет worker |
| Меню модели при переподключении теряло контекст | Checkpoint сохраняется до уничтожения процесса; повторный startup свежей подготовленной сессии устранён |
| recover мог сбросить уже начавшийся параллельный turn | Admission reservation до первого await, durable pause и проверяемая передача. Отрицательный контроль воспроизводит старую гонку |
| Изменение задачи/проекта/профиля во время routing или startup могло применить старое решение | Stale guards перед выбором роли и dispatch; запрос сохраняется в очереди, прежний scope не исполняется молча |
| «Ограниченный» checkpoint включал всё описание, Todo и материалы и мог блокировать продолжение | Ограниченные excerpts + counts/version/refs. `task_context` восстанавливает полное описание, пункты плана и материалы страницами. Источники не удаляются |
| Первая сессия с длинной очередью могла вытеснять остальные | Ротация admission; проверен порядок A1 → B1 → A2 → A3 при одном слоте |
| `agent_status` и повторный spawn могли вернуть весь transcript | Короткие receipts, страницы статусов, UTF-8-safe excerpts и 64 KiB output guard; есть ограничения числа незавершённых workers и глубины |
| Редактор принимал промпт, который compiler позже отклонял | Проверка ID, Unicode и UTF-8 byte budget при сохранении; ошибки проверены через настоящий UI |
| Composer показывал «Авто» без работающего router | Показывает сохранённую роль и объяснение degraded routing. В настройках есть короткое русское описание и раскрываемое техническое основание |

## Итерации исследования реальной модели

Модель теста — `qwen/qwen3.7-flash` через OpenRouter; все задания синтетические. Проверялся выбор роли, не качество реализации продукта. Использована [публичная карточка модели](https://openrouter.ai/qwen/qwen3.7-flash). Публичные отчёты не содержат credentials, частных задач и необработанных provider traces.

| Итерация | Изменение | Результат |
| --- | --- | --- |
| 1 | Router contract в обычном контексте кодового CLI | 8/12 |
| 2 | Малый выделенный system prompt отдельного классификатора | 9/12 |
| 3 | CLI `--json-schema`, требующий вызова `structured_output` | 6/12 |
| Диагностика (отдельный Qwen 0.25.0) | Два дополнительных запроса с 1024/4096 output budget | HTTP 200, `stop`, 370/250 completion tokens, обычный текстовый JSON вместо tool call. Увеличение tokens не исправило контракт; это соседний runtime, не прямой paid retest 0.25.1 |
| **4 — выбранный вариант** | Малый classifier system, JSON-проверка host, отключены шесть лишних eager tools, максимум два чистых classifier attempts | **12/12, 12 launches: все с первой попытки** |
| 5 — отклонённый вариант | Ещё более короткий tool catalog через исключение 22 имён | 10/12; преимущества не подтверждены, точный source выбранного варианта восстановлен |

Все [пять отчётов](evidence/agent-runtime-qwen/) сохранены. SHA-256 `role-router.ts` в срезе 0.5 совпадал с source SHA выбранной итерации 4. Последующие изменения 0.6 имеют другой SHA и не объявляются повторным model benchmark. Один успешный небольшой прогон не доказывает статистического превосходства и не заменяет испытания workplace DeepSeek/MiMo/GLM. Самооценка confidence модели не является измеренной вероятностью правильности.

Classifier работает отдельным headless процессом в временном каталоге: safe mode, без внешних MCP/hooks/project context, обычные tool calls заблокированы **до исполнения**, общий deadline 35 секунд, максимум два запуска. Системные/dump env overrides удаляются только из окружения классификатора. Credentials остаются в native provider settings/child environment; явные auth flags передаются по точному allowlist без логирования. Используется фактически выбранная модель. Повтор классификатора не повторяет пользовательскую задачу.

Текстовые ответы проверяются строго. Некорректный ID/формат и недостаточная уверенность не становятся правом менять профиль или scope. При окончательном отказе сохраняется текущая роль с видимым объяснением. Для GigaCode без проверенного adapter это ограничение автоматизации, а не «успешный LLM-routing».

## Проверки и повторение

1. `cd app; npm test; npm run build` — unit/protocol и сборка.
2. `node tools/test-prompt-binding-live.mjs --capture-local-provider` — настоящий Qwen, два ACP-процесса, локальный фиктивный OpenAI provider. Проверяются native base, ровно одна роль в system и отсутствие инструкций в user message. Это доказательство доставки, не реальная модель.
3. `node tools/test-qwen-router-offline.mjs` — настоящий Qwen против локального provider: обычный/структурированный вывод, бюджет 0, mixed write batch, отрицательный контроль с бюджетом 1, форматные повторы и отсутствие внешних эффектов.
4. `node tools/test-roles-ui.mjs` — настоящее приложение, isolated data, clone/save/ошибки, prepared/active/retained, 1000/1440, dark/light. [Снимки и report](evidence/agent-runtime-ui/).
5. `npm run test:ui` и `node tools/test-chat-live.mjs` — действующие UI, очередь, приоритет и отмена.
6. `test-role-router-live.mjs` — отдельный платный opt-in; нужен `WORKBENCH_LIVE_ROUTER=1`, тестовая модель и приватная native авторизация. Не включается в CI.

Финальная локальная проверка macOS на собранном candidate: **254 unit/protocol passed, 46 skipped**, сборка успешна; **43/43 изолированных UI**, **8/8 actual App role UI**, **3/3 actual chat**; два Qwen ACP процесса с двумя loopback provider requests подтвердили system placement; **11/11 offline Qwen guards**. Skips включают 44 opt-in PostgreSQL случая без fixture-server и два platform-specific. Они не считаются успешными тестами. На candidate37d7308, до независимого directory-durability исправления, отдельно повторены **23/23 настоящих Jenkins/Kubernetes API и 23/23 actual App Operations** с hash guards; [evidence и desktop-снимки](evidence/agent-runtime-operations/). Это локальные тестовые серверы, не корпоративные стенды и не полный OpenShift distribution.

Первый Windows candidate `37d7308` прошёл250 unit/protocol и Qwen protocol checks, но [actual Roles UI отказал7/8](evidence/agent-runtime-ui/windows-37d7308-failed/README.md) при1440→1000resize. Failing geometry тогда не сохранялась, поэтому причина исходного Windows кадра неизвестна. Независимый Mac эксперимент воспроизвёл промежуточное расхождение ResizeObserver→React; harness теперь ждёт dock commit, сохраняет failing geometry и реальные screenshots, не ослабляя overflow oracle. Исправлена и provenance CI: placement сохраняется в явный файл, старые committed reports очищаются; [первый Windows placement извлечён из настоящего CI stdout](evidence/agent-runtime-windows-first/system-placement-win32-from-ci-log.json). Повторный [Windows harness4ad3176](https://github.com/wuller1/gigacode-workbench/actions/runs/38561912330) прошёл: **250 unit/protocol,50 skipped,8/8 Roles UI,3/3 Chat,11 Qwen guards и2 system-placement requests**. [Артефакты с актуальным win32 и проверкой source hashes](evidence/agent-runtime-windows-4ad3176/provenance.json). Четыре POSIX-only directory tests на Windows пропущены явно;50 skips не выданы за pass.

Windows выполняет отдельный workflow **Agent harness on Windows** без внешней модели; широкий **Windows desktop** дополнительно проверяет Database/IDE/Operations и упаковку. Оба финальных run успешны на candidate `4ad3176`: [harness 38561912330](https://github.com/wuller1/gigacode-workbench/actions/runs/38561912330) и [desktop 38561912179](https://github.com/wuller1/gigacode-workbench/actions/runs/38561912179). [Широкая Windows provenance](evidence/windows-4ad3176/provenance.json): source/packaged IDE 44+44, PostgreSQL 44, Data UI 25+25, Jenkins 11 API+12 UI отдельно в source и packaged, 43 изолированных UI, 3 Chat, 18 Python pipe regressions, PowerShell 5.1, PTY/Sharp, NSIS/portable и packaged Qwen 0.25.1. Финальная публикация добавляет только docs/evidence; runtime исходники остаются теми же. Ручная установка, ВАРМ и корпоративные системы не проверялись.

## Производительность и остаточная нагрузка

[Измерения на Apple M1](evidence/agent-runtime-qwen/performance-audit.json) используют настоящий AtomicStore/WorkbenchService и синтетические JSON snapshots 0,5/5 MB. Median update хранилища — 21,2/42,5 мс; три последовательных snapshot reads — 0,68/7,56 мс. Это локальные измерения до последней малой оптимизации, не benchmark Windows, Electron IPC или времени ответа модели.

Устранён лишний full-state clone ради revision уведомления: revision возвращается из уже подтверждённой транзакции. Главные затраты остаются: полные durable snapshots на flush, full-state fanout окнам, длинный transcript/Markdown и повтор scope в native history. Следующий срез — journal/delta subscriptions, paging/virtualization и версионированные context deltas с проверкой восстановления. Durability не отключена ради красивого времени; ускорение всего приложения не заявляется.

## Перенос на рабочий компьютер

Начать с [WORK-COMPUTER-BOOTSTRAP](../../WORK-COMPUTER-BOOTSTRAP.md), раздела 4а. Сначала сравнить существующую обвязку и рабочий LLM-router, сохранить более удачное. `WorkbenchOptions.routeProfile: RoleRouter` подключает существующий workplace router без его замены. Callback получает bounded task context и AbortSignal; host валидирует решение и его актуальность.

Сохранить девять текущих workplace ролей и их working bindings. Дополнительные database/designer/security/architect/technical-writer включать по фактической потребности. На GigaCode 26.10.6 установить реальные flag/config/source/ACP/provider evidence; не копировать Qwen flags вслепую. До этого `context_only` честен, а native system append не подтверждён. Не заменять глобальный пользовательский system override ради каждой роли.

## Что аудит не превращает в готовую функцию

- Host управляет созданными им worker sessions через фактические `agent_spawn`/status/cancel/message services. Скрытые native CLI agents не получают гарантированный UI-control; существующий более полный workplace controller нужно сохранить и подключить. Ни роль, ни наличие панели не ограничивают весь native fan-out.
- Полный managed DAG, leases, worktree isolation и гарантированное join/yield ещё не реализованы. При одном слоте parent должен завершить turn, чтобы queued child получил слот; асинхронный spawn не обещает немедленный параллельный старт.
- Отзыв bearer не откатывает уже допущенную внешнюю операцию. Неизвестный результат требует receipt/readback; повтор write не разрешён автоматически.
- Роль не является sandbox: ограничения analyst/reviewer — инструкции; native CLI сохраняет свои инструменты и права. MCP binding можно адаптировать по роли, но это не доказательство ограничения всех нативных действий.
- Journal сохраняет фактическую историю, инструменты, фазы и версии; скрытые рассуждения модели и непрозрачные внутренние слои CLI не восстанавливаются. Checkpoint — адресная сводка, не полный transcript.
- Отсутствующий/испорченный исторический instruction snapshot отвергается адресным API и не подменяется текущим prompt; startup inventory/notice для всех утраченных references пока не реализован.
- Политики GC/export исторических instruction snapshots, развитая scoped memory и жизненный цикл прерванных пользовательских вопросов требуют дальнейшей работы. Старые данные не удаляются ради ускорения.
- 400/413/429/HTML не исправляются сменой роли. Host не редактирует непрозрачную историю CLI и не объявляет восстановление гарантированно бесшовным.
- Полный поведенческий A/B benchmark старой и новой обвязки на рабочих моделях и проектах ещё нужен. Новые промпты и routing sample не доказывают качество всего создаваемого кода.

Эти границы сохранены в плане; S8-03/S8-10 не закрываются как полный suite по наличию новых файлов.
