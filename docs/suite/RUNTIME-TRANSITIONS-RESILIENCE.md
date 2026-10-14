# Этапы одной задачи и восстановление — 0.6.0-preview.1

Дата: 15.10.2026. Цель — продолжать одну задачу разными ролями и сохранять управляемое состояние при сбоях. Рабочий GigaCode CLI пользователя — **26.10.6**, здесь недоступен. Реальный upstream для проверок — неизменённый Qwen Code **0.25.1**. Полное отсутствие ошибок, полное соответствие IntelliJ/DataGrip и весь suite roadmap этим срезом не объявляются.

## Порядок и итог архитектуры

Сначала реализован и проверен переход внутри задачи: backend → diagnostics → frontend без нового сообщения человека. Затем усилены хранение, отмена, транспорт, MCP и восстановление окон. Единый `WorkbenchService` остаётся владельцем задач, очереди и исполнителей; второй независимый контроллер не создаётся.

Исполнитель получает native CLI base + CORE + ровно одну роль. Вызов `role_transition_request` сохраняет предложение следующего этапа, а не заменяет инструкции текущего процесса. Host ждёт чистое завершение и durable checkpoint, проверяет вопросы/неизвестные эффекты/очередь/актуальность контекста, подтверждает роль LLM-router и создаёт новый процесс с новым MCP bearer и fingerprint. Внутренний continuation хранится отдельно от человеческой очереди. Пользовательские сообщения имеют приоритет.

Полный контракт, включая ограничение шести автоматических переходов на один реально отправленный запрос и условия `canResume`, — [IN_TASK_ROLE_TRANSITIONS](../../workbench/docs/IN_TASK_ROLE_TRANSITIONS.md). Обычная самопроверка и исправление локального дефекта не требуют переключать роль. Progress fingerprint предотвращает очевидные циклы, но не доказывает полезность результата.

## Итеративная критика и исправления

| Обнаруженный сценарий | Реализованное поведение / независимая проверка |
| --- | --- |
| После handoff новая роль теряла исходную цель за коротким history window | Original human request и оставшаяся работа входят в bounded continuation packet; исторические решения и факты доступны адресно |
| Модель пыталась задавать generation/session или перепрыгнуть router | MCP внедряет trusted binding; лишние аргументы отвергаются, renderer direct call запрещён, role hint требует подтверждения router |
| Отмена, новый вопрос или изменение scope приходили во время routing/startup | Повторные guards перед dispatch; никакого скрытого replay, человеческая очередь сохраняется |
| Остановленный безопасный этап не имел понятного продолжения | Host-derived `canResume` и компактное «Продолжить этап»; UNKNOWN и неподтверждённые эффекты этим действием не обходятся |
| Headless Qwen работал в Node-тесте, но не в Electron RUN_AS_NODE | Проверена реальная Electron argv-семантика; статическая совместимость `process.defaultApp` только для собственного child launch, без изменения CLI |
| ACP label модели попадал в provider как wire ID и давал 400 | Только source-verified Qwen selector раскладывается по реальному ACP catalog/auth type; неизвестные/неоднозначные значения удерживают routing. `--model=value` не допускает превращения model ID во flag |
| Classifier мог унаследовать cron/team housekeeping из HOME/env | Изоляция только classifier child: cron и memory-team отключены, safe mode сохраняется, native executor settings и credentials не переписываются |
| Ошибка создания lock оставляла собственный частичный lock | Cleanup только lock, созданного текущей попыткой; чужой/невалидный существующий lock не удаляется ради старта |
| ENOSPC/EIO/EBUSY/ENOENT или ошибка flush оставляли частично живой runtime | Глобальный stop admission, revoke bindings и запуск завершения owned CLI до ожидания диска. Фактический exit асинхронный. Read-only история и диагностика остаются; сохранение явно pending/saved/failed |
| Cancel ожидал запись и при hung disk не доходил до CLI | Native cancel и watchdog запускаются до первого FS await; игнорирующий отмену owned process завершается независимо от disk ack |
| Сбой одного cleanup мешал остановить остальные executors | Немедленное наблюдение всех dispose promises, изоляция synchronous throw и all-settled cleanup; storage wait ограничен |
| Поздний ответ вопроса уходил старому исполнителю | Generation и bearer проверяются при создании, ожидании и доставке. Ответ может остаться в истории, но не превращается в согласие для нового/остановленного процесса |
| Медленный HTTP body удерживал локальный MCP без границ | 1 MiB body, 10 s deadline, до 64 pending bodies и 256 connections; освобождение admission проверено отдельно от истечения срока |
| Невалидные UTF-8 bytes MCP body превращались в другой текст вопроса | Fatal complete-body decoder отвергает запрос до invoke; настоящий HTTP test отдельно подтверждает корректный split Unicode |
| Повреждённый UTF-8/незавершённый frame принимался за корректный результат | Fatal streaming decoder, ограничение frame, bounded drain stdout при exit; неопределённый исход остаётся UNKNOWN |
| Secret разрывался между stderr chunks и обходил redaction | Bounded line accumulation перед redaction; oversized незавершённая строка не публикуется |
| Retirement оставлял обычные CLI background children | Owned process group на POSIX и отдельная Windows ветвь; managed IDE Task/Debug живут у host независимо от роли. Это не отмена внешних jobs/daemon/удалённых эффектов |
| UI терял event или получал устаревший snapshot | Coalesced refresh, revision/late guards, focus/visibility refresh и bounded polling/backoff; refresh не повторяет мутации |
| Падение renderer стирало draft или заново отправляло prompt | Window/session-scoped journal, draft записывается до React commit; host reload сохраняет процесс/очередь. Восстановленный чужой draft предлагается явно и не отправляется автоматически |
| Повреждённый localStorage/layout приводил к циклу падений | Валидация формы даже корректного JSON, нормализация layout, bounded React remount и ручное повторение |
| Streaming events обходили retry backoff при отказе snapshot reads | Единый retryNotBefore действует для polling/event/focus/manual refresh; event-storm regression не допускает возврат к ~13 reads/s |
| Два окна незаметно перезаписывали queued edit, поздний Save стирал новую версию | UI сохраняет captured baseText в journal, host атомарно сравнивает expectedText; конфликт оставляет очередь и локальный текст. Tombstone проверяет текст и исходную версию; legacy edit без base восстанавливается в composer |
| Uncaught main error только логировалась и приложение продолжало писать | Fatal gate + service quiesce до логирования, состояние всех окон, диагностика и явный restart; повтор пользовательских действий не запускается |
| Renderer автоматически перезагружался бесконечно | До трёх попыток за 60 s на окно, coalescing reload, затем native выбор восстановления/нового окна; фоновые задачи не перезапускаются |
| Whole-app quit ожидал бесконечный FS cleanup/log, crash во время отменённого закрытия оставлял мёртвое окно | Cleanup каждого владельца запускается независимо; через 15 s явный выбор ожидать/завершить без подтверждения, без автоматического relaunch неизвестного сохранения. Log не блокирует shutdown. Deferred renderer recovery продолжается после отмены preflight |
| Operations ожидал disk receipt до закрытия клиентов и мог dispatch после начавшегося shutdown | Retirement уже подключённых клиентов запускается независимо от записи; post-await closing guard запрещает новый execute. Неотправленное действие — notApplied, уже отправленное — unknown с readback, без replay |
| Завершившийся cleanup с failed receipt ошибочно считался сохранённым | `dispose` возвращает фактический persistence receipt; rejection/failed/pending/terminal unconfirmed требуют явного diagnostic/exit выбора, без автоматического relaunch |
| Windows возвращал одинаковые метаданные после быстрой замены CLI того же размера | Content hashes проверяются до capability cache lookup для неизвестного executable и reviewed Qwen anchors. Повторный `--help` кэшируется по тем же байтам; regression не использует sleep или другую длину файла |
| Параллельные сессии сохраняли одинаковые инструкции через несколько rename в один destination; Windows иногда возвращал EPERM | Один in-flight publisher на абсолютный dataDir/fingerprint внутри host. Все одинаковые callers ждут его полный durability barrier; settled promise удаляется и следующий вызов снова проверяет файл. Ошибки записи не подавляются, corrupt evidence не переписывается. Это не межпроцессный lock |
| Новые кнопки имели слабый контраст, fatal UI предлагал недоступный session recover | Scoped цвета проверяются вычисленным contrast в dark/light; остановленное состояние компактно, remote queue actions отключены, локальные правки и чтение сохранены |

## Проверки и свидетельства

Машинные отчёты публикуются отдельно от этого описания: [actual role transitions](evidence/role-transitions-ui/report.json), [actual renderer resilience](evidence/renderer-resilience-ui/report.json), [Qwen offline controls](evidence/agent-runtime-qwen/offline-router.json), [actual Operations](evidence/runtime-0.6-operations/app-darwin.json). Их source hashes и platform относятся к конкретному запуску. Windows evidence дополнительно привязывается к commit, отдельно от macOS.

Loopback provider в тесте переходов — детерминированный сервер под нашим контролем. Он проверяет настоящие Electron/ACP/MCP процессы, доставку системных инструкций и host orchestration; он **не доказывает**, что рабочая модель всегда корректно выберет роль. В новом срезе платные model prompts не нужны. Исторический routing benchmark 12/12 из 0.5 относится к прежнему source SHA и остаётся историческим.

Повторение из `app/`, после `npm ci --include=optional`:

```text
npm test
npm run build
node tools/test-qwen-router-offline.mjs
node tools/test-prompt-binding-live.mjs --capture-local-provider
node tools/test-role-transitions-ui.mjs
node tools/test-renderer-resilience-ui.mjs
node tools/test-roles-ui.mjs
node tools/test-chat-live.mjs
npm run test:ui
```

Драйверы живого UI используют отдельный временный dataDir и проверяют cleanup. Unit fault injection, настоящий Qwen с scripted provider, actual Electron и Windows packaging — разные уровни доказательства. Пропущенные platform/opt-in tests не считаются успешными.

Финальная локальная приёмка macOS: **374 unit/protocol passed, 46 skipped**, сборка успешна; actual transitions **6/6**, actual renderer resilience **8/8**, Roles **8/8**, Chat **3/3**, изолированные UI **43/43**. Реальный Qwen прошёл **13 offline guards** и два standalone ACP/provider system-placement запроса. Последние проверяют скомпилированный host probe, а actual transitions — настоящее приложение. Operations повторно прошёл **23 API + 23 actual App** против локальных Jenkins/Kubernetes endpoints; корпоративные стенды этим не проверены.

В resilience driver принудительно завершаются настоящие renderer процессы: после automatic recovery и отменённого shutdown сохранены тот же CLI PID/generation, очередь, composer/attachment/queue-edit и черновик второго окна, promptCount остаётся 1. Actual main uncaught handler останавливает runtime без replay. Early contrast enabled controls — **12.36 dark / 12.94 light**. Снимки: [dark recovery](evidence/renderer-resilience-ui/recovered-dark-desktop.png), [light recovery](evidence/renderer-resilience-ui/recovered-light-desktop.png), [stopped runtime](evidence/renderer-resilience-ui/runtime-stopped-dark-desktop.png).

История неудачных попыток сохранена рядом с отчётами. В первой resilience fixture исправлен canonical temp path; native crash затем наблюдался через bounded WebContents DOM, поскольку старый Playwright Page оставался crashed. Contrast oracle обнаружил настоящий theme-transition flash и остался ≥4.5 после исправления. Roles driver теперь ждёт конкретные active receipt/fingerprint в DOM: backend active и неизменившееся имя роли не доказывают commit renderer.

Первый Windows candidate `5b0b0e9` остановился на unit-проверке capability cache: **364 passed, 1 failed, 51 skipped**. [Сводка и свежий unit-отчёт](evidence/windows-5b0b0e9-failed/summary.json) привязаны к [harness 38585015825](https://github.com/wuller1/gigacode-workbench/actions/runs/38585015825). Live/build шаги этого harness **не запускались**; прежние committed darwin reports в always artifact не считаются Windows evidence. В [широком run 38585015505](https://github.com/wuller1/gigacode-workbench/actions/runs/38585015505) PostgreSQL job прошёл, desktop также остановился на unit. Cache исправлен по содержимому; отчёты теперь очищаются до unit/build. Итоговый Windows pass фиксируется отдельно после повторного candidate.

Следующий Windows candidate `b139f62` подтвердил исправление cache: **367 passed, 51 skipped**, system placement 2, classifier controls 13, Roles 8 и Chat 3. Однако новый драйвер переходов остановился **до первого role assertion**, а resilience шаг был пропущен. [Свежая сводка](evidence/windows-b139f62-failed/summary.json) отделяет эти результаты от прежних macOS reports. В Windows launch два новых драйвера передавали directory path с завершающим `\`; installed Playwright вручную заключает argv в кавычки, не экранируя этот последний separator. Пути нормализованы как в уже проходящих драйверах. Отсутствующий application handle больше не выдаётся за подтверждённый exit; при неопределённом завершении временные данные сохраняются.

В широком Windows run того же candidate PostgreSQL API прошёл, а Data UI остановился на гонке конфликтного теста двух окон: первый штатный autosave успевал сохранить текст до второго вызова с прежним revision. Host корректно отклонял stale update. Вместо временной задержки драйвер теперь удерживает конкретный настоящий IPC save первого окна, даёт второму сохранить через неизменённый host handler, затем освобождает первый и проверяет настоящий CAS conflict, recovery и отдельную копию. Product CAS не обходится и не ослабляется. Эти изменения драйверов требуют повторного Windows прогона.

Candidate `26a857b` прошёл Windows PostgreSQL **44/44** и actual Data UI **25/25**, включая конфликт двух окон. Но отдельный harness остановился на intermittent rename EPERM при восьми одновременных сохранениях одной версии инструкций: **366 passed, 1 failed, 51 skipped**. [Свежий unit и точная ошибка](evidence/windows-26a857b-failed/summary.json) не смешиваются со старыми live reports: live шаги этого harness были пропущены. Причина исправлена coalescing одного in-flight publisher с ожиданием общего подтверждения записи; native FS ошибки не объявляются успешным сохранением.

## Перенос в существующую рабочую оболочку

Начни с [WORK-COMPUTER-BOOTSTRAP](../../WORK-COMPUTER-BOOTSTRAP.md), раздела 4а. Сначала сравни собственные retries, managed agents, journaling и routing с этими изменениями. Сохрани более удачное по конкретным фактам; при несовместимых преимуществах предъяви diff, проверку и один вопрос о варианте. Не заменяй рабочий controller только из-за нового номера версии.

Переноси service/types/MCP/main wiring и renderer contracts вместе: generation, `canResume`, `runtime.stopped`, `app.info.runtimeFailure`, `windowKey`, snapshot feed и draft journal согласованы. Встрой workplace LLM-router через `WorkbenchOptions.routeProfile`; у неизвестного GigaCode не активируй Qwen source evidence по совпадению названий flags. Проверь app restart, смену окон, реальное 429/HTML/400/413 поведение, отсутствие двойных внешних действий и сохранение draft/очереди на рабочем Windows/ВАРМ.

Для ресурса, нужного после handoff, сначала прочитай реальные `ide_tasks`/running и используй host IDE Task/Debug. Сохрани taskId/terminalId/URL и проверь наблюдаемую готовность. Не запускай такой сервер обычным background child текущего CLI. Отсутствующий Terminal MCP не выдумывай; потерянный launch reply требует readback, не второго запуска. Детали и границы live-проверки указаны в контракте переходов.

## Честные границы отказоустойчивости

- Повтор допустим только при известном отсутствии внешнего эффекта либо при реальном idempotency/receipt contract. UNKNOWN требует сверки. Завершение процесса не откатывает уже принятую SQL/cluster/Jenkins/forge операцию.
- Нельзя гарантировать последнюю запись при отключении питания/необратимом отказе носителя. Pending FS promise не притворяется отменённой; lock удерживается, пока её tail не завершится. Saved означает подтверждённый текущим store путь, не аппаратную сертификацию.
- Crash main процесса/OS отличается от пойманного uncaught error и renderer crash. После нового запуска восстановление использует durable state и UNKNOWN fences; автоматический replay операций не разрешается.
- Renderer reload не доказывает сохранение любого непрозрачного native editor buffer. Существующие IDE/DB shutdown preflight и конфликты сохранения сохраняются.
- 400 не имеет одной причины; 413 не всегда равен token limit. Host не редактирует непрозрачную историю CLI и не повторяет write ради смены модели. Полная context compaction, managed DAG/leases/worktree isolation, scoped memory GC и все функции IDE/DataGrip остаются отдельными карточками.
- Роли — инструкции и специализация, не security sandbox всех native CLI tools. Native hidden agents и внешние daemon не получают гарантированный host control автоматически.
- Whole-state JSON snapshots и renderer fanout остаются затратами. Polling/coalescing ограничивают поток запросов; delta journal/paging/virtualization ещё требуют отдельной реализации и измерений на рабочей машине.
- Клиенты Data/Operations, ещё находящиеся внутри подключения, хранятся как promises. Немедленный доступ к wrapper до завершения connect и полный независимый ownership registry остаются следующей работой; deadline всего shutdown не выдаётся за подтверждение закрытия каждого такого соединения.

S8-03/S8-10 не закрываются как весь suite по наличию новых handoff/recovery механизмов. Новые возможности дополняют существующие проверки Jenkins/Kubernetes, IDE и PostgreSQL; корпоративные endpoints этим локальным срезом не подтверждены.
