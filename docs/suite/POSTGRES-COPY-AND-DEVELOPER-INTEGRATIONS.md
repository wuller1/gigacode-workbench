# PostgreSQL transfer и ежедневные developer integrations

Уточнение 2026-10-13, приоритетнее прежних широких engine waves. Первый целевой набор — PostgreSQL и совместимые PostgreSQL JDBC источники. Другие engines остаются поздним расширением. Наличие JDBC само по себе не доказывает поддержку PostgreSQL wire COPY, диалекта или metadata: driver/server/version/COPY capabilities проверять отдельно.

## PostgreSQL через MCP и JDBC

Пользовательский и агентский UI работают через корпоративный MCP adapter. JDBC worker на стороне адаптера владеет соединением и транзакцией; для pgjdbc использовать PGConnection.getCopyAPI()/CopyManager. Electron renderer не загружает JVM и не получает credentials. Если корпоративный MCP имеет только execute_sql, это пробел, который нужно закрыть transfer API в адаптере, не маскировать тысячами INSERT и не обходить MCP прямым соединением без согласования.

File handle/stream принадлежит тому хосту, где физически доступен файл. Для удалённого MCP нужен отдельный ограниченный поток/временный upload с jobId, checksum и TTL, а не JSON/base64 всего файла. Верификация пути и cleanup выполняются на обоих концах. Не отправлять данные в LLM.

## Импорт и экспорт

| Формат | Импорт | Экспорт |
|---|---|---|
| CSV | Потоковый parser с encoding/delimiter/header/quote/NULL mapping → COPY FROM STDIN | COPY (query) TO STDOUT CSV или streaming cursor при требуемом преобразовании |
| Excel XLSX | Выбор листа/диапазона, streaming SAX rows → typed mapping → COPY FROM STDIN | Streaming XLSX writer по cursor/bounded row windows; временные файлы с квотой |
| SQL | Отдельный script execution/restore workflow; COPY blocks поддерживать явно, не трактовать произвольный SQL как таблицу | SQL INSERT script или PostgreSQL COPY data script; выбор data-only/schema+data и escaping |

Excel — XLSX в первом этапе; legacy XLS показывать как неподдерживаемый до отдельного adapter. COPY напрямую не читает XLSX и не выполняет произвольный SQL: нужен соответствующий parser/runner. SQL нельзя разбивать на команды через split(';'): dollar-quoted routines, comments, literals и COPY payload требуют корректного парсинга. psql meta-commands допускаются только в явном psql-compatible режиме с контролируемым runner; произвольные shell команды не исполнять как импорт таблицы.

Для табличного импорта PostgreSQL использовать COPY FROM STDIN, не server-side filename/PROGRAM. Preview первых строк, выбор таблицы или создание по проверенной схеме, mapping/проверка типов, preview SQL, затем запуск. Append по умолчанию; replace/upsert — отдельные явно выбранные режимы: staging → validate → merge в транзакции. Identifier quoting по правилам драйвера, значения не конкатенировать в SQL. Не выключать constraints/triggers ради скорости. RLS/unsupported COPY выявлять до старта, предлагать понятную альтернативу без молчаливой смены пути.

При ошибках stop/rollback по умолчанию; пропуск строк только явный режим с отчётом. COPY ON_ERROR/REJECT_LIMIT доступны не во всех версиях и не покрывают все виды ошибок; не обещать skip для constraint/trigger failures. Для контролируемого reject-report использовать staging и проверку. Успешно переданные байты не равны committed rows.

## Большие файлы

- Bounded buffers + backpressure на чтении/парсинге/COPY/записи; ни readFile целиком, ни весь ResultSet в массиве, ни весь workbook в памяти renderer.
- JDBC export cursor: forward-only, проверенный fetchSize и режим транзакции, обеспечивающий streaming именно в выбранном driver. COPY channel не использовать параллельно для других запросов на том же connection.
- Preview ограничен 200 строками и 1 MiB, огромная ячейка обрезается только в preview с отметкой. Actual transfer не теряет значения. Полный подсчёт строк не является обязательным предварительным проходом.
- XLSX shared strings/styles могут потреблять память даже при SAX: disk-backed index/limits; ZIP entries/uncompressed size/ratio проверять. Для writer использовать ограниченные windows/styles, cleanup temp files. Нехватка диска — явная ошибка, а не повреждённый «успешный» файл.
- Excel: при превышении 1 048 576 строк на лист (с учётом заголовка) разбивать по листам/файлам; ограничения числа колонок и длины ячейки не обходить обрезанием молча. BIGINT/decimal с потерей точности записывать текстом; даты/timezone, NULL/empty и формулы имеют явную политику. Формулы не выполнять при импорте; cached formula result помечать как potentially stale.
- CSV: multiline quotes, BOM, CRLF/LF, UTF-8 и выбранные кодировки, NULL vs empty. Spreadsheet-safe escaping — опциональная явно указанная обработка, чтобы не менять исходные данные незаметно.
- SQL export: typed literals/bytea/NULL, qualified identifiers, sequences/identity, transaction compatibility; полный database dump — отдельный pg_dump workflow, не обещание простого INSERT exporter.
- Transfer job в host: id, source fingerprint, target/binding revision, format/mapping hash, bytes read/written, rows parsed/copied/committed/rejected, temp paths, state и receipt. UI показывает этап, bytes/rows, throughput, прогресс по доступному размеру; ETA только при достаточных измерениях.
- Cancel прерывает источник и COPY, rollback подтверждается; ошибка сети при commit → unknown до readback. Не повторять импорт после неизвестного исхода.
- Resume возможен только для специально спроектированного chunked staging с durable chunk ledger и проверкой fingerprint. Для обычной единой COPY-транзакции обещать безопасный restart после rollback, не resume с произвольного byte offset внутри CSV/XLSX.
- Экспорт пишет .partial, атомарно публикует финальное имя после закрытия и проверки. Открытый стабильный snapshot для долгого export объясняет влияние на БД; продолжение потерянного snapshot не выдаётся за консистентный прежний экспорт.

### Проверки первой волны

Реальный PostgreSQL + фактический JDBC/MCP adapter на packaged Windows. CSV 100 MB/1 GB/10 GB, XLSX с большим shared-string набором и экспорт >1 листа; файл больше heap worker; heap usage выходит на плато (начальный бюджет 512 MiB на worker, уточнить измерением), renderer не удерживает transfer data. Проверить cancel, disk-full, повреждённый ZIP, network drop/commit unknown, duplicate start, restart, длинные строки, кириллицу, точные numeric, timezone и semantic round-trip. Логи и итоговый report фиксируют число committed/rejected строк и причины; полный файл не попадает в trace. Скорость оценивать на указанном оборудовании и соединении, не обещать универсальные MB/s.

## Jira-подобный трекер: developer scope

Обязательны: мои/командные задачи, search/JQL-equivalent при capability, saved filters, board/list/backlog/sprints, epic/story/task/bug/subtask, зависимости и связи, приоритет/labels/components/versions, исполнитель/reporter/watchers, descriptions/acceptance criteria, comments/mentions/attachments, activity/history, estimates/time tracking, transitions/resolution/reopen, bulk operations с preview, уведомления/inbox, связь branch/commit/PR/build/deploy, «Взять в работу»/«Продолжить»/handoff, локальные задачи и remote sync/conflicts.

Переходы, required fields, custom fields и permissions читать с сервера, не хардкодить Done/In Progress. Readback после mutation, remote revision/CAS, idempotency; неизвестный исход не повторять вслепую. Assignee change, transition и local session creation могут частично завершиться: показать точный результат и продолжить недостающий шаг. Важные функции не должны исчезать из плана из-за узкого MCP: фиксировать adapter gap. Enterprise portfolio/admin/billing не являются обязательным developer scope.

## Bitbucket-подобный forge: developer scope

Workspace/project/repo selection с project binding; clone с выбором папки/SSH/HTTPS и progress/cancel, submodules/LFS и credentials по capability; fetch/pull/push, branches/tags/worktrees, stage/unstage hunks, commit/amend, stash, merge/rebase/cherry-pick/revert, conflicts и agent diff. Git operations идут через MCP tools, исполняющиеся на нужном filesystem host; удалённый MCP clone не должен выдавать server path за локальный checkout.

PR: создать/редактировать/draft при поддержке, source/target, reviewers, описание/template, linked task, status/checks, files/commits/diff, review очереди «назначено мне/мои PR», inline и общие комментарии, pending review batch, ответы/resolve/reopen threads, suggestions где поддержаны, review tasks, просмотр изменений после предыдущего review, APPROVE и снятие approve, request changes/needs work по capability, decline/reopen, merge strategy/merge checks/очередь при поддержке, delete source branch отдельным действием.

Approve — отдельная операция от merge и комментария. Зафиксировать reviewed commit SHA; если HEAD изменился, пометить review устаревшим и проверить policy сервера, не одобрять незамеченные изменения автоматически. Mapping статусов Cloud/Data Center/корпоративного аналога делать по probe, не по названию кнопки. Inline comment anchors привязаны к версии diff; недоступный anchor сохранять черновиком, не публиковать в случайную строку. Ошибки/429/offline не теряют draft review; readback позволяет избежать повторных комментариев/approve/merge.

## Источники проверки

- https://jdbc.postgresql.org/documentation/publicapi/org/postgresql/copy/CopyManager.html — streaming copyIn/copyOut (API reference, версию сверять с выбранным driver).
- https://www.postgresql.org/docs/current/sql-copy.html — COPY STDIN/STDOUT, formats, errors и ограничения.
- https://poi.apache.org/components/spreadsheet/how-to.html — streaming spreadsheet read/write; конкретную зависимость/version проверять отдельно.
- https://support.atlassian.com/bitbucket-cloud/docs/review-a-pull-request/ — review/approve.
- https://confluence.atlassian.com/bitbucketserver104/reviewing-a-pull-request-1822591062.html — Data Center review и отличия.

Это целевой контракт; не утверждение о наличии подключённых корпоративных серверов или готового transfer engine.
