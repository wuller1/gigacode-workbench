# Диагностика собственного desktop-приложения: факты от CLI до экрана

Цель — при сбое дать агенту полную **доступную цепочку наблюдаемых фактов**: что отправлено, где принято, что сохранено, какой подписчик обновлён и что реально показал интерфейс. Собираем это локально, без внешней telemetry-платформы и автоматической загрузки данных. «Максимум диагностики» означает подробную корреляцию и доступные исходные свидетельства, а не бесконечный console.log и не весь журнал в контексте модели.

Наблюдаемость начинается в **M0**, IDs/ownership и A/B correlation закрепляются в **M1**, кнопка и drawer диагностики входят в **M3**. Это часть реализации, не украшение после исправления ошибок. Использовать существующие EventStore/OperationLedger и storage из [NATIVE_WORKBENCH_MIGRATION.md](NATIVE_WORKBENCH_MIGRATION.md); не создавать второй controller, не переписывать исправный JSONL store на SQL только ради логов, не модифицировать GigaCode CLI.

Ниже предлагаются внутренние контракты нашего UI. Имена событий/полей не являются новыми ACP methods или обещанием существующих MCP tools. Реальную версию Electron, renderer framework, GigaCode и доступные hooks проверить в репозитории. Здесь составлен план; сборка приложения и фактические логи пользователя не исследованы.

## 1. Шесть связанных потоков событий

| Lane | Что сохранять всегда как структурированные факты | Какие разрывы становится возможно различить |
|---|---|---|
| **CLI / ACP transport** | Spawn/ready/exit; stdin write intent/accepted/error; stdout chunk/framing/parse/dispatch; method, direction, typed request ID, session binding, update kind; stderr отдельно; cancel/permission/retry/outcome; размер и payload ref | CLI не прислал ответ, parser не принял frame, старый generation отклонён, неверно найден session, повторно отправлен запрос |
| **Main / процессы / окна** | App boot/quit, process-instance/OS PID map, window create/focus/hide/close, resource attach/detach, crash/unresponsive, bounded CPU/memory/event-loop samples | Renderer исчез, процесс умер, окно сменило владельца, скрытие панели ошибочно уничтожило ресурс |
| **IPC / delivery** | Channel/type, sender/frame/window, correlation/operation ID, send/receive/ack/reject, sequence, bytes, queue depth; subscription create/dispose и причина | Main получил результат, но событие не доставлено; IPC gap; подписчик закрыт для чужой панели; stale sender продолжает менять состояние |
| **Store / revisions** | Command accepted/rejected, expected/current revision, transaction begin/commit/rollback, event range, persist watermark, snapshot version, writer/queue/latency/errors | Событие принято, но не сохранено; CAS conflict; прямое изменение без revision; UI прочитал старый snapshot |
| **UI / render / наблюдаемый экран** | User action ID без клавиш/ввода, route/task selection, panel binding, state selector revision, mount/unmount, render/commit timings если доступны, layout/visibility, targeted input-to-view measures | Состояние верно в store, но view подписан на другое; render не произошёл; commit есть, но действие перекрыто или показано старое содержимое |
| **Task / journal / evidence** | Task/run/stage/attempt, requirement revision, все tool/effect lifecycle events, permission owner, operation intent/outcome/unknown, check start/end/exit/counts, evidence refs/hash/build | «Ответ получен» выдан за выполненную задачу; потеряно разрешение/результат; pass относится к другой версии; неизвестная операция повторена |

Фиксировать lifecycle **каждого** tool/действия, включая отказ, timeout и отмену. Для streaming каждый frame/update получает sequence; содержимое и повторяющиеся низкоуровневые подробности могут храниться отдельным bounded payload или явно объединённым диапазоном. Нельзя бесследно скрыть важный permission, dispatch, error или terminal outcome ради уменьшения размера журнала.

Сохраняется только то, что собственный adapter действительно наблюдает. Внутренний provider retry или вызов инструмента внутри CLI может быть недоступен: внешний timeout и stderr не доказывают число попыток и скрытые действия. Прямые вызовы host и публичные tool events CLI покрываются полностью в своём наблюдаемом scope; неподдержанный участок отмечать `unknown`/`not_observed`, не реконструировать выдуманный внутренний trace. Не запрашивать и не хранить скрытые рассуждения модели; сохранять действия, входные/выходные контракты и краткие явные решения.

## 2. Единый event envelope и правильное время

Envelope применяется к каждой lane; необязательные поля имеют null с объяснением неизвестного, а не выдуманный ID. Данные процесса/сборки можно хранить один раз и ссылаться на них, сохраняя возможность полного export.

| Поля | Контракт |
|---|---|
| `schema_version`, `event_id`, `kind`, `lane`, `severity` | Версионированное событие с уникальным ID; kind — конкретный переход, а не свободный абзац |
| `wall_utc`, `mono_ns`, `clock_id`, `source_seq` | UTC для человеческого поиска; monotonic для длительности внутри одного clock domain; source_seq строго растёт у emitter. Большой mono_ns сериализуется безопасно, например decimal string |
| `ingest_seq`, `received_wall_utc`, `persisted_through` | Порядок приёма главным writer и подтверждённая граница сохранения. Приём и durable commit — разные события |
| `app_boot_id`, `process_instance_id`, `source`, `os_pid`, `web_contents_id`, `window_id` | Идентичность запуска/источника. PID переиспользуется ОС и не заменяет process_instance_id; неизвестный renderer PID не угадывается |
| `project_id`, `task_id`, `chat_id`, `run_id`, `stage_id`, `attempt_id`, `panel_id` | Собственные объекты UI и workflow, явно связанные с владельцем. Active tab не используется для восстановления адресата уже отправленного действия |
| `connection_id`, `connection_generation`, `session_id`, `request_id`, `request_id_type`, `direction` | Wire identity: JSON-RPC string и number различаются; requestId уникален только в своей connection/generation/direction области |
| `operation_id`, `trace_id`, `span_id`, `parent_span_id`, `caused_by_event_id` | Корреляция от пользовательского намерения до проверки; одна operation может включать несколько запросов и локальных изменений |
| `app_build_id`, `source_revision`, `dirty_fingerprint`, `cli_identity_ref`, `config_revision` | Версия реально запущенной сборки, рабочие изменения и установленный CLI; не только HEAD или версия package.json |
| `state_before_revision`, `state_after_revision`, `outcome`, `duration_ms` | Фактический переход/результат; duration имеет определённые начало/конец. Отсутствие terminal event — unknown, не success |
| `summary`, `payload_ref`, `payload_bytes`, `payload_digest`, `redaction`, `omitted`, `truncated` | Краткий безопасный факт; полный разрешённый payload отдельно. Digest считается от сохранённых санитизированных байтов, не от секретов |
| `observation_kind`, `unknown_fields`, `capture_policy_ref` | observed/derived и источник вывода; какие данные недоступны и почему. Это provenance, не оценка «всё проверено» |

Monotonic clocks разных процессов нельзя напрямую вычитать. Host фиксирует handshake/clock calibration с неопределённостью, а причинность устанавливает через IDs/sequence/ack. `ingest_seq` упорядочивает получение, но не доказывает порядок возникновения событий на разных процессах. Изменение системных часов не должно делать отрицательную длительность. После restart — новый boot/clock domain; не склеивать его как продолжение прежнего без маркера.

Пример диагностической цепочки: `user.action → dispatch.intent → journal.persisted → acp.write → acp.update → store.commit(rev=R) → ipc.sent(seq=S) → ipc.received → selector.observed(R) → view.commit(R) → observation`. У каждого ребра либо свидетельство, либо конкретный пробел. UI log «render started» не закрывает последнее ребро.

## 3. Сначала сохранить факт, затем строить представления

Критические бизнес-события используют действующий append-first journal/OperationLedger: durable intent до внешнего dispatch, terminal outcome после реального ответа, event/state согласованы одной транзакцией/проверенным recovery-протоколом. Диагностический envelope **ссылается** на этот факт и его sequence, не становится вторым источником business state. Если используется SQLite, переиспользовать существующую транзакцию/outbox; если JSONL — использовать текущий append/commit/recovery contract и проверяемый snapshot, без SQL-миграции ради этой задачи.

Запись в JS queue не считать подтверждённой записью на диск. У storage adapter должны быть явные `accepted`, `written`, `durability_confirmed` границы согласно реальным возможностям. Не обещать сохранность хвоста после внезапного выключения, если flush/sync не подтверждён. Для обычных диагностических событий допустим bounded batch; бизнес-порядок и диапазоны внутри batch сохраняются.

Не ставить синхронную тяжёлую запись на каждый render/token. Один writer принимает события, формирует ограниченные batches и отдельные payload refs; фиксирует queue depth, oldest queued age, batch time, bytes, flush error и dropped/coalesced counts. Медленная SQLite-транзакция или диск не должны маскироваться «успешно отправлено в logger».

Если logging storage недоступен, показать diagnostics degraded, сохранить ограниченный emergency buffer и точную последнюю persisted boundary. Нельзя объявлять пропавшие события сохранёнными. Операции, которым business ledger требует durable intent, следуют этому инварианту; logger не даёт обхода. Срочная отмена/остановка уже идущего действия не блокируется бесконечно отказавшим диагностическим sink: зафиксировать best effort и неизвестность записи, сохранив установленный lifecycle-контракт.

Редактор/renderer не пишет authoritative state напрямую. Store instrumentation хранит writer/command/revision и санитизированные changed paths/record digests. В debug checkpoint сверять ожидаемую revision/hash с фактическим snapshot, чтобы обнаружить out-of-band mutation. Snapshot и события не должны самовольно «исправлять» друг друга во время сбора диагностики.

## 4. Подробность, payload и bounded flight recorder

По умолчанию включена полная структурированная история lifecycle/correlation, а не только errors. Два дополнительных режима локальные и ограниченные по времени:

| Режим | Содержимое | Начальные проектные пределы |
|---|---|---|
| `normal` | Все значимые факты шести lanes, исключения, ревизии, outcome, counters; payload преимущественно shape/размер/ref | Append store с rotation; UI/render подробности в ring; без prompts/file contents по умолчанию |
| `debug` | Регистрация подписчиков, подробный IPC/selector path, scoped state frames и timing; разрешённые конфигурационные значения | Выбранная task/window; например 15 минут с видимым временем окончания и возможностью продлить |
| `local_content_debug` | Дополнительно разрешённый текст prompt/ответа/tool input/output и fragments файлов после redaction | Включается явно для нужного scope; не наследуется навсегда и не добавляет внешней отправки. Секреты всё равно исключаются |

Стартовые лимиты **настройки проекта, не стандарт**: ring — последние 5 минут, максимум 20 000 событий или 16 MiB; отдельная event запись — 64 KiB; большой payload — refs на chunks до 1 MiB, максимум 10 MiB на объект до явного изменения бюджета. Persistent diagnostics — 256 MiB rolling segments по 16 MiB и до 7 дней; выбрать первое достигнутое ограничение. Payload и pinned bundles имеют собственные квоты, например 128 и 256 MiB соответственно. Не путать эти диагностические квоты с retention основного business journal/evidence: их архивирование живёт по отдельному принятому контракту.

Вытеснение по ring/retention policy отмечается диапазоном/счётчиком и причиной. Объединение streaming metadata хранит first/last source_seq, count, bytes и соответствующие payload refs; это `coalesced`, а не «все raw events доступны». Потеря из-за перегрузки — `dropped`, с lane/range/count или `count_unknown`, если число не установлено. Для critical events оставить резерв ёмкости; при заполнении резерва явно объявить capture partial/degraded, не молча drop.

Failure pin сохраняет выбранный диапазон до обычной rotation; pinned bundle не исчезает как старый debug log. При исчерпании pinned quota показать отсутствие места и неполноту нового capture, предложить управляемое освобождение старых материалов; не удалять молча зафиксированное доказательство. Сжатие закрытых segments допустимо штатным локальным средством, с hash/manifest до и после распаковки; чтение активного segment не должно ломаться.

Режимы, активный scope, срок, лимиты и ошибки записи видны в diagnostic drawer. Выключение расширенного режима не стирает уже закреплённое свидетельство и не меняет выполнение задачи. Полные дампы heap/crash memory не включать в обычный сбор: они могут содержать данные вне нужной задачи; отдельная целевая процедура нужна только при конкретной необходимости.

## 5. Redaction перед записью, а не перед красивым отчётом

Каждая граница применяет типизированный redactor **до persist/ring/export**. Для конфигурации — allowlist реально полезных значений: versions, transport mode, feature flags, выбранные пределы, launch executable identity и санитизированные args. Не писать environment dump, cookies, authorization headers, access/refresh/API tokens, credentials URL, парольные поля или secret values MCP. Registry хранит refs/идентификаторы подключения, не копию его auth config.

`local_content_debug` разрешает содержание выбранной задачи, но не отменяет исключение секретов. Error message/stack/URL/CLI stderr проходят тот же redactor: исключение часто содержит полный запрос или credential. Нельзя получать «полный контекст» через обход ограничений на скрытые рассуждения, чужие проекты или соседние приложения.

Serializer ограничивает глубину, число полей, длину строки, общий объём и циклические ссылки. При ошибке redactor заменить опасный payload на marker; сохранить event ID, type, size если известен, причину omission и provenance. Не сериализовать исходный объект аварийным fallback без очистки. Ошибка санитизации не превращает исход в success: payload unknown/omitted, capture policy и неполнота видны.

Сохранить redaction report: какие **классы полей** исключены, какими правилами/версией, где truncation, какая область не захвачена. Не хранить удалённые значения в самом отчёте или reverse map. Автоматический redactor не доказывает распознавание любого неизвестного секрета; у произвольного текста и изображений coverage может быть unknown. Такой материал не экспортируется автоматически, а неизвестное указывается явно.

Screenshot/DOM также могут содержать секреты. DOM frame по умолчанию состоит из component/selector IDs, roles, geometry, visibility, selected resource/revisions и redact-safe текста состояния, **без values полей и полного пользовательского текста**. Для изображения замаскировать известные sensitive regions; если безопасный захват данного участка не подтверждён, исключить его и объяснить, не выдавая «полный screenshot».

## 6. Инструментирование UI: не путать state, commit и видимый результат

У каждого relevant view записывать mount/unmount, panel/task binding, subscription ID, observed snapshot revision, последних доставленных sequence, pending update count, visibility/focus и reason disposal. Передача ownership сохраняет generation; поздний callback фиксируется как stale/rejected с исходным адресом, а не только как «событие проигнорировано».

Перехватить renderer `error`/`unhandledrejection`, ошибки preload/main через реальные error boundaries/handlers и logging path; сохранить безопасный stack/source map identity и текущие IDs. Handler диагностики не должен скрывать fatal exception или обещать продолжение повреждённого процесса. В Electron наблюдать `render-process-gone`, `unresponsive`/`responsive`, destroyed и lifecycle окон; фактические поля проверить для установленной версии. [Electron: renderer failure events](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone), [window responsiveness](https://www.electronjs.org/docs/latest/api/browser-window#event-unresponsive)

Если renderer действительно React, scoped `<Profiler>` даёт render duration/commitTime; его overhead и доступность зависят от сборки. Не предполагать React по названию UI и не включать profiling для всего дерева постоянно. В другом framework использовать его реальные lifecycle hooks. **React commit не доказывает paint, отсутствие перекрытий и пригодность действия.** [React Profiler](https://react.dev/reference/react/Profiler)

Поставить собственные marks у user action, IPC receipt, selector update и наблюдения нужного view; вычислять понятные интервалы. User Timing предоставляет marks/measures, но не готовую проверку «пользователь увидел верный ответ». Один requestAnimationFrame или два подряд сами по себе не доказывают, что пиксели уже показаны пользователю. Label результата — ровно измеренный этап, например action-to-commit, а не выдуманный action-to-visible. [W3C User Timing](https://www.w3.org/TR/user-timing/)

Для подозрения на jank нужен ограниченный foreground trace и настоящие input/scroll действия: записать visibility/throttling, display refresh если известен, frame/timing samples и метод. Пауза background timer не называется jank активного UI. Electron `contentTracing` пригоден для целевого временного trace с выбранными категориями; trace включается на известный scope/срок и может быть недоступен для уже прошедшего сбоя. [Electron contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing)

CPU/memory собирает один owner через доступный `app.getAppMetrics()`; интервалы CPU зависят от времени между вызовами и общие для других вызывающих этот API. Записать период/конкурирующий sampler/unknown, не сравнивать несопоставимые числа. Процессные IDs привязать к живым app-owned resources. [Electron app metrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)

## 7. Кнопка «Собрать диагностику»

Кнопка относится к выбранной task/error/window и собирает локальный пакет, не останавливая её. Доступна также через app-owned меню/main command, чтобы зависший renderer не был единственным способом запустить сбор. Не придумывать новый публичный CLI-флаг: это команда нашего host.

1. Создать capture ID и зафиксировать policy/scope, причину, build/revisions, известные IDs и временное окно. Стартовый выбор — последние 5 минут; при конкретном event ID включить его причинных родителей и соседний диапазон. Это предложение, а не жёсткое требование для любого сбоя.
2. **Freeze ring означает закрепить копию диапазона/watermarks, не заморозить app.** Producers продолжают писать в следующий segment. Записать source_seq/ingest_seq high-water marks по lanes; получить flush acknowledgements с timeout, например 2 секунды, и честно отметить недоступный writer/renderer.
3. Сопоставить event/state/ownership revisions, pending operations, delivery acknowledgements, lost/coalesced ranges, resource map и последние безопасные config/metrics. Не исправлять состояние и не повторять операции во время сбора.
4. Получить targeted state frame и, **только если есть работающий разрешённый способ**, DOM/screenshot выбранного собственного окна. Не захватывать весь desktop, другие приложения или соседние окна. Если frontend не отвечает, сохранить доступные main/store факты и указать отсутствие живого кадра.
5. Собрать manifest, timeline, детерминированную summary, refs на payload/stack/trace/frame и report completeness/redaction. Закончить atomic manifest publish после проверки файлов/hashes. Недописанный bundle не называется complete.
6. Показать расположение и результат сбора: complete/partial/failed со списком пропусков. По желанию пользователя bundle можно передать локальному агенту или вручную экспортировать; никакой автоматической внешней отправки.

`webContents.capturePage` снимает страницу данного WebContents; это не гарантированный снимок всего native окна со всеми WebContentsView, overlays и OS chrome. Для составного окна фиксировать source/rect/scale и реально захваченные поверхности отдельно; не представлять DOM screenshot как доказательство native browser-панели. Автоматизация/захват могут быть недоступны: `not_captured` и причина остаются в manifest. [Electron capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts)

`complete` означает, что выполнен **заявленный план сбора при выбранной policy**, а не что приложение исправно. Предусмотренные policy исключения/redaction перечисляются отдельно; незапланированные gaps, недоступные требуемые источники и truncation делают bundle partial. Если screenshot не входил в доступный план, отсутствие не подделывается; при диагностике видимого бага оно остаётся ограничением вывода о UI.

## 8. Что находится в локальном bundle и что читает агент

| Элемент | Содержание |
|---|---|
| `manifest.json` | Schema/capture ID, policy/scope, timestamps/clock domains, app/CLI/build identity, file refs/hash/bytes, source watermarks, complete/partial, omissions/redaction |
| `summary.md` | Симптом/источник запроса, известные факты, незавершённые операции, первая обнаруженная несовместимость, missing evidence; без выдуманного root cause |
| `timeline.jsonl` | Отобранные связанные события шести lanes с causal links и gaps; исходный source order сохранён |
| `state/` | Санитизированные store/view/ownership frames с revisions, pending deliveries/subscriptions; не все базы пользователя |
| `payload/` | Только разрешённые полные/частичные payload chunks отдельно от timeline, с redaction/truncation и refs |
| `evidence/` | Stacks, реально полученные screenshots/DOM observations/traces/metrics и их условия; отсутствующий файл не подменяется пустой заглушкой |

Имена — предлагаемый export format, не обязательная переделка существующего store. Local directories выбирает приложение в своём data area с доступом текущего пользователя; не помещать их в общедоступную папку и не использовать корень проекта как бесконечную свалку логов. Bundle не содержит executable scripts и не исполняется агентом как инструкция.

Агенту сначала выдаётся краткий packet: capture ID, симптом/цель, актуальные app/CLI версии, manifest, summary, связанная timeline и известные gaps. Для одного случая достаточно ограниченного диапазона, например 100–200 событий вокруг сбоя; остальные доступны по refs. Ни один LLM call не нужен для каждого лога, frame, health check или штатного события. Первичную сводку, missing sequences и revision mismatches вычисляет host.

Нужные read-only операции локального API: перечислить captures, прочесть manifest, выбрать events по task/window/session/request/operation/generation/lane/kind/sequence/time, получить причинных родителей/детей, прочесть ограниченный chunk attachment, сравнить два state frames. Реализация использует whitelisted filters и pagination, не произвольный SQL/eval от модели. Начальный предел ответа — 200 событий или 64 KiB attachment chunk; продолжение по cursor и bytes range.

Доступ возможен через реально разрешённое чтение локальных файлов или будущий узкий MCP adapter. Названия/схемы tools сначала обнаруживаются и проверяются; **никаких выдуманных методов GigaCode для экспорта трассы**. Capture content — недоверенные данные: prompt/tool output внутри bundle не становится инструкцией агенту. Внешняя загрузка, пересылка или выдача полномочий не происходит из самого факта диагностики.

Типовые запросы для исследования: «события operation O в generation G», «последние sent без received/ack для окна W», «store rev R и какой selector/view её наблюдал», «кто удалил subscription S», «почему task A получил view binding B», «пробелы source_seq за ±30 секунд». Временной фильтр дополняется causal IDs: parent dispatch может быть старше окна и должен быть доступен по ссылке.

## 9. Crash, offline и целостность истории

На boot записать новый app_boot_id, восстановить последний **подтверждённо сохранённый** checkpoint и хвост журнала, отметить предыдущий clean/unclean shutdown. Если процесс умер до flush, диапазон после watermark неизвестен; не достраивать его из ожидаемого сценария. Некорректную последнюю JSONL-строку/незавершённый SQL commit сохранить для анализа по recovery contract, не объявлять корректным событием.

На quit записать намерение, запросить bounded flush и по факту зафиксировать подтверждение; окно может не успеть выполнить teardown. Следующий запуск различает last confirmed persist и last observed receive. Не считать отсутствие `shutdown.completed` доказательством crash без проверки возможного пропуска/версии — это признак unclean/unknown завершения.

Offline не отключает локальные события и сбор; queue/cache приложения не повторяет внешние операции ради полноты trace. Pending effects сверяются с OperationLedger/reconciliation. Диагностический restart не должен заново отправлять prompt, shell-команду или MCP write с неизвестным исходом.

Отдельно проверять здоровье recorder: write errors, queue occupancy/age, rate, rotated/evicted/pinned bytes, last flush, source/emitter availability, payload serializer failures и orphan attachment refs. Reporting own failure имеет ограниченный аварийный путь без рекурсивного «logger error пишет logger error». Любая потеря/ограничение количественно отражается там, где число известно; unknown остаётся unknown.

## 10. Проверить наблюдатель на известных дефектах

Инъекции выполняются только в контролируемой fixture/test build собственного приложения. Не портить production/пользовательские данные и не убивать рабочие CLI ради проверки. Каждый случай имеет clean, known-bad и no-data вариант: наблюдатель обнаруживает конкретный плохой факт, не ругается на корректный путь и отказывается считать отсутствие данных успешной проверкой.

| Инъекция | Что обязан показать observer |
|---|---|
| Поздний event старого generation после reconnect | Исходные connection/session IDs, stale rejection, отсутствие изменения нового state; если stale применён — mismatch и виновная цепочка |
| Out-of-band store mutation без нужной revision/event | Расхождение checkpoint/record digest и journal expectation; область/время обнаружения. Не «лечить» journal под изменённые данные |
| Ошибочное disposal подписчика B при закрытии A | subscription ID/owner, dispose reason и causal action; update B сохранён, но не доставлен нужному view |
| Drop одного IPC сообщения между инструментированными send/receive | Конкретный source sequence/operation sent без delivery/ack, следующий watermark/gap; не выдавать timeout за доказанный точный участок без этих фактов |
| Намеренный короткий main-thread stall в foreground test view | Input/commit/frame gap или trace по выбранному измерителю с известным visibility; не только субъективное «тормозило» и не screenshot с фиктивным FPS |
| Write/flush failure или заполненная quota | Degraded/partial, last persisted watermark, dropped/omitted ranges, pin outcome; нет ложного complete |
| Secret-like fixture в error/tool payload | Значение отсутствует в event, ring, attachment, stack и summary; redaction marker и provenance сохранены |
| Недоступный renderer/capture tool | Основной bundle доступен из main, UI observation not_captured, вывод о видимом результате ограничен |

Тест синтетического observer доказывает контракт детектора. При исправлении настоящего UI-дефекта всё равно нужны воспроизведение до, проверка после в той же актуальной сборке и видимое evidence по [GIGACODE_UI.md](GIGACODE_UI.md). Структурный валидатор, совпавшие hashes и зелёная timeline не доказывают, что пользователь видит правильный экран.

## 11. Семь небольших карточек реализации

| Карточка | Изменение | Достаточная приёмка |
|---|---|---|
| **O0. Карта и envelope — M0** | Найти текущие owners/storage/hooks; описать envelope, ID/clock domains и capture policy; не менять framework | Одна реальная операция проходит с верной build identity; null/unknown и typed RPC IDs сохраняются |
| **O1. Durable writer и redaction — M0** | Подключить существующий журнал, watermark/batch health; санитизация до ring/persist; quota/rotation/pin | Clean/bad/no-data, flush failure, redactor failure и secret fixture; запись в queue не выдаётся за durable |
| **O2. Transport/IPC/store correlation — M1** | Все границы dispatch/update/store/delivery, ownership/generation, subscriptions и revision | Реальное перекрытие A/B + stale/drop/disposal fixtures; найден конкретный оборванный участок, без смешивания задач |
| **O3. UI recorder — M1/M3** | Errors/rejections, renderer lifecycle, scoped render/commit, view activity и настоящие timing hooks | Правильный store + сломанный view различимы; foreground stall пойман; no-data не pass; overhead измерен на выбранном сценарии |
| **O4. Capture button/bundle — M3** | Freeze selected ring, manifest/summary/timeline/frames, optional реальный screenshot/trace; app menu fallback | Захват с работающим и зависшим renderer; complete/partial честные, pin survives rotation, raw secrets отсутствуют |
| **O5. Read-only agent access — M3** | Bounded filters/pagination/attachment refs, deterministic triage packet, capability discovery для будущего MCP | Агент находит причинную цепочку без загрузки всей базы; доступ не позволяет dispatch/write/прочитать чужой scope |
| **O6. Recovery и проверка детектора — M3** | Crash/unclean quit/offline continuity, negative controls из таблицы, targeted before/after | Last-confirmed state сохранён; неизвестный эффект не повторён; 0 events/пустой evidence не дают pass |

Каждая карточка получает текущие paths/versions, один плохой случай и 2–4 применимых проверки. После работающего фрагмента продолжать следующий; не строить универсальную telemetry-систему до первого полезного trace. Runtime события обрабатывает код, а не вызов модели. Один агентный разбор возникает по реальному сбою/запросу пользователя; routine events не запускают ретроспективу и критиков.

Ready prompt исполнителю: «Реализуй только O# в текущем UI. Сначала укажи фактического владельца события и точку последнего durable commit. Сохрани existing task/session semantics; не меняй CLI, retry policy и repo setup. Включи проверку clean/известный дефект/нет данных для нового детектора. Покажи реальные наблюдения, capture policy, omissions и build. Если live app недоступен — fixture/contract результат отдельно, реальная диагностика incomplete. Не скрывай ошибки логгера и не выдумывай кадр/метрики».

Эта инструкция обеспечивает способ собирать свидетельства, но не утверждает уже достигнутую полноту. В пользовательском приложении recorder, agent adapter, screenshots, timing и crash recovery ещё необходимо реализовать и проверить. Наблюдение причинной цепочки помогает диагнозу; отсутствие обнаруженного события при неполном capture не доказывает отсутствие дефекта.
