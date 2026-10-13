# Data workspace: аудит полноты и порядок доводки

Дата анализа: **14 октября 2026 года**. Область: PostgreSQL и совместимые JDBC-системы, работа через настроенные MCP-подключения. Это разбор исходного макета перед текущей переработкой; новая кнопка не меняет статус строки автоматически. Сопоставлять с [основным контрактом](DATABASE.md), [описанием демонстрационных путей](../../design/suite-prototype-data-ide-coverage.md) и фактическим `suite-prototype-data-ide.js`.

**Полный паритет DataGrip не достигнут и этим документом не заявляется.** Сейчас проверяется взаимодействие пользователя с макетом. Ни выполнения PostgreSQL, ни потокового COPY, ни JDBC-сессий, ни реального million-row grid этот аудит не подтверждает. Сначала согласовать законченные пути макета; реализацию в `app/` начинать только после общего prototype approval gate.

## Решение для продукта

Рабочая область должна выглядеть как настольный инструмент БД: компактное дерево объектов слева, документы и консоли в центре, результаты у конкретного запуска снизу. Основной сценарий — найти объект, открыть его без потери SQL, выполнить выбранный фрагмент, проверить результат, изменить данные или структуру, сохранить материал задачи. Сервисные возможности доступны рядом, но не занимают постоянную ленту из десятков кнопок.

Используем общепринятые способы работы database IDE: дерево, вкладки, разделители, таблица, контекстные меню, сочетания клавиш. Визуальные компоненты и графика Workbench остаются собственными. Здесь нет утверждения, что общая схема расположения панелей кому-либо запрещена.

Главные действия нельзя оставлять на «доделаем при реализации»: выбор цели, вкладки, режим запуска, работа с результатами, управление транзакцией и большие задания должны быть понятны в согласованном макете. Реализация добавит настоящий transport, SQL engine, drivers, сохранение, объёмы и диагностику. Обнаруженные ограничения MCP могут потребовать уточнить экран, но не молча сократить договорённый функционал.

## Наиболее важные дефекты исходного макета

1. **Выбор таблицы подменяет SQL.** Обработчик `db-object` заменяет текст активной консоли и скрывает дерево. Это разрушает ожидание обычной навигации. Открывать объект отдельной вкладкой или отдельным просмотром; пользовательский draft сохранять.
2. **Консоли разделены только текстом.** `rows`, `pending`, `running`, `transaction` и результат принадлежат общему Data state. Нужны документы, сессии и запуски с отдельными идентификаторами. Иначе пользователь принимает результат другой консоли за свой.
3. **Нет ясной границы запуска.** У «Выполнить» отсутствует полноценный выбор statement/selection/script. Необходимо показывать область запуска; разделять несколько результатов скрипта и сообщения сервера.
4. **План вводит в заблуждение.** В исходном fixture одновременно показаны оценка и фактические миллисекунды без зафиксированного режима ANALYZE; независимые checkbox не образуют взаимоисключающий выбор. Обычный план не должен показывать измеренные метрики.
5. **Поиск результата похож на фильтр всей таблицы.** Сейчас это JavaScript-фильтр fixture. Разделить «Найти в загруженных строках» и серверные WHERE/ORDER BY. Для произвольного SQL изменение запроса — явное действие, без скрытого переписывания.
6. **Миграция открывается не на той цели.** Текст «назначение ИФТ» попадает в консоль текущего подключения с предупреждением. В итоговом UX migration document имеет собственную captured target; исполнение на другой цели блокируется до явного выбора.
7. **Редактирование строк непоследовательно.** Правка ячеек staged, а вставка/удаление fixture применяются сразу. Для пользователя должен быть один changeset: вставки, обновления и удаления видны до отправки; режим Auto/Manual определяет commit после отправки.
8. **Много функций существуют лишь как диалог или текст.** Права, глубокая структура, несколько result sets, развитая работа с типами, инспекции SQL, сравнение данных и большие файлы ещё не закрыты целыми сценариями. Не считать открытие диалога доказательством функциональности.

## Композиция настольного экрана

- **Верхняя полоса:** подключение, database/schema/search path, индикатор связи; справа одно меню настройки/инструментов. Полная цель доступна по наведению. Выполняемый запрос хранит captured target независимо от этого селектора.
- **Навигатор слева:** 224 px по умолчанию, регулируемый и скрываемый. Видимые схемы, поиск, refresh; внутри schema — таблицы, представления, materialized views, routines, sequences, types. В таблице раскрываются columns/indexes/constraints/triggers. Права и административные объекты — дополнительная группа. Это дерево БД, не второй file explorer.
- **Полоса документов:** SQL-консоли, объекты, DDL/routine. Крестик закрытия, индикатор dirty/running, меню rename/duplicate/pin/close others/reopen. Закрытие вкладки не уничтожает неизвестный исход операции.
- **Toolbar SQL:** split-button «Выполнить», форматирование, история. Справа Tx Auto/Manual и при необходимости Commit/Rollback. Лимиты и параметризация в одном меню выполнения. Частые действия имеют tooltip с сочетанием клавиш.
- **Редактор:** MonoKai, изменяемая высота, подсветка исполняемого statement, ошибка с позицией, completion по реальной схеме в реализации. Его нельзя пересоздавать на каждое событие прогресса.
- **Темы кода:** тёмная тема использует Monokai; светлая — светлую companion-палитру с базовым фоном `#fcfcfa`. Это относится ко всем полям ввода и просмотра кода: SQL, DDL/routines, параметризованным примерам, generated SQL, diff, plan JSON, журналам и соседним IDE-панелям. Фон, токены, обычный текст, каретка, выделение, gutter/номера строк, активная строка, ошибки и добавленные/удалённые строки diff переключаются согласованно. Светлая тема не оставляет тёмные островки кода. Контраст проверяется для каждого токена и состояния на фактическом фоне; отдельный расчёт пар не заменяет визуальную проверку каретки/выделения/diff.
- **Результаты:** вкладки `Результат 1`, `Результат 2`, `Вывод`, `План`. Название/статус связаны с запуском. Grid toolbar только refresh, фильтр, changeset, экспорт и меню; пагинация внизу. Работа с объектом даёт `Данные / Структура / DDL / Зависимости`, а не смешивает структуру случайной таблицы с результатом запроса.
- **Вторичные поверхности:** Services/История/Задания/Сравнение/ER по команде, с сохранением состояния и возможностью открыть рядом. Формы импорт/экспорт идут последовательными шагами, не требуют прокрутить всё приложение.
- **Агент:** один общий механизм выбранной сессии; запрос/таблица/план передаются с точной целью и выбранным объёмом. Агент работает теми же операциями и видимыми документами, что пользователь. Служебный прогресс свёрнут, результат и изменения видны.

Предлагаемые размеры — параметры для проверки, а не доказательство качества. Основная проверка: Windows 1440×900 и 1920×1080, масштаб 100/125/150%; дополнительная — панель шириной 620–900 px при чате рядом. На узкой панели дерево можно скрыть вручную; названия и данные не обрезать ради декоративных карточек. Минимальная цель клика у компактных иконок 28×28 px, строки grid 28–30 px; разделитель имеет увеличенную невидимую зону захвата. Проверить значения в реальном Windows/ВАРМ, а не только на браузере macOS.

## Статусы матрицы

**Демо** — есть локальный демонстрационный путь; **Частично** — есть часть пути или известный UX-разрыв; **Нет** — отдельный сценарий ещё не построен. Все строки ниже имеют **runtime: не подтверждён**. Статус относится к исходному макету, прочитанному при аудите. Для закрытия строки записать новые UI evidence, затем отдельно backend/live evidence. Не превращать «запланировано» в «готово».

### Подключения, навигация и документы

| ID | Возможность → путь пользователя | Исходный макет / пробел | Приёмка реализации |
|---|---|---|---|
| DB-01 | Настроить MCP/JDBC → общие настройки → подключение → привязать к проектам | Частично: registry и editable metadata; связи нет | Test/capability probe, driver/server/version, TLS/auth errors, secret reference; неизвестные функции остаются unavailable |
| DB-02 | Переключать несколько подключений/проектов без остановки работы | Частично: captured jobs и connection snapshots; консоли не полностью независимы | Два проекта и два окна, разные цели: query/tx/result не переезжают; rename окружения не меняет identity |
| DB-03 | Выбрать видимые схемы → поиск/checkbox/apply | Демо: сохраняется по connection; каталог fixture | Ключ `connectionId + databaseId`; исчезнувшие/новые schemas, empty selection, одинаковые имена, каталог 10k объектов; фильтр не меняет search_path |
| DB-04 | Глубокое дерево → таблица → columns/indexes/constraints/triggers | Частично: группы объектов и отдельная плоская структура | Lazy children, отмена/ошибка refresh, stale marker, partial introspection; многосоставные ключи и quoted names |
| DB-05 | Найти объект, перейти из SQL к определению/использованиям | Частично: поиск имён только fixture | Поиск с qualified identity; отдельные scopes видимые/все доступные; SQL resolve учитывает schema/search_path |
| DB-06 | Открыть таблицу/view без изменения консоли | Нет корректного пути: выбор перезаписывает текущий SQL | Draft byte-for-byte сохраняется; объект в отдельной вкладке; repeated open переиспользует свою вкладку; дерево не исчезает |
| DB-07 | Создать/переименовать/дублировать/закрыть/pin SQL-консоль | Частично: new/edit/close; не весь lifecycle | Стабильные IDs, восстановление dirty/scroll/caret, close others/reopen, отдельные targets и sessions, crash recovery |
| DB-08 | SQL-файлы проекта и консоли → сохранить/открыть в IDE | Нет полного пути | Одна модель DocumentService; external change conflict; SQL-файл не теряет привязку при переходе в IDE |
| DB-09 | Schema/search_path и read-only → toolbar target | Частично: подпись public | Readback состояния сессии; display filter отдельно от resolution scope; read-only enforced сервером/адаптером, не только цветом |

В качестве поведенческих ориентиров: [query consoles](https://www.jetbrains.com/help/datagrip/query-consoles.html), [Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html), [metadata/introspection](https://www.jetbrains.com/help/datagrip/introspection.html), [connection configuration](https://www.jetbrains.com/help/datagrip/configuring-database-connections.html). Общая модель документа и разделение полномочий в таблице — проектное решение Workbench.

### SQL, сессии, результаты и изменения

| ID | Возможность → путь пользователя | Исходный макет / пробел | Приёмка реализации |
|---|---|---|---|
| DB-10 | Выполнить текущий statement / selection / script → split Run | Частично: один общий запуск | SQL parser корректно различает dollar quotes/comments/PL blocks; точный snapshot и range; script выдаёт ordered results/messages |
| DB-11 | Completion, diagnostics, форматирование, rename SQL symbols | Частично: textarea и консервативный uppercase keywords | Dialect engine плюс каталог; formatter не меняет literals; rename с preview dependencies; неизвестный SQL не «исправлять» эвристикой |
| DB-12 | Параметры SQL → значения/типы → выполнить | Демо form; поиск имён regex | Bind parameters через driver, NULL/array/decimal/date, repeated parameters; `:x` внутри строк/comments не параметр |
| DB-13 | Выполнить параллельно в разных консолях → посмотреть Services | Нет независимого полного пути | Dedicated physical session по умолчанию; общий session только явным выбором; одна tx не протекает в другую |
| DB-14 | Остановить/timeout → проверить исход | Демо delay/cancel; лимиты не исполняются | Cancel acknowledgment, серверный query state, terminal event exactly once; disconnected write остаётся unknown без replay |
| DB-15 | Читать несколько результатов → pin/switch/compare | Частично: один workspace grid | `consoleId/runId/resultId/statementIndex`, independent pages/columns/filters; старый snapshot не выдается за свежий |
| DB-16 | Локальный поиск и серверный WHERE/ORDER BY | Частично: сортировка/поиск fixture на клиенте | Явная область «загруженные строки»; серверный фильтр таблицы параметризован; arbitrary result не переписывается скрытно |
| DB-17 | Выбирать ячейки/строки, copy/paste, hide/reorder/resize columns | Нет полного пути | Keyboard ranges, clipboard quoting, sticky headers, column identity; paste открывает changeset с validation |
| DB-18 | NULL, JSON, arrays, UUID, bytea, big numbers, timestamps → value editor | Частично: simple cell modal и NULL | Lossless BIGINT/NUMERIC, timezone marker, binary streaming, null/empty distinction, raw/formatted view, lazy LOB |
| DB-19 | Добавить/clone/update/delete строки → изменения → SQL preview → submit | Частично: разные правила staged/instant | Единый changeset; PK/unique identity; optimistic conflict; affected rows checked; no-key и joined results read-only с причиной |
| DB-20 | Auto/Manual tx → submit → commit/rollback/savepoint | Частично: два boolean fixture | State none/active/failed/unknown; rollback только submitted tx; local discard отдельно; close dirty asks конкретный выбор без auto-commit |
| DB-21 | Перейти по FK/related rows → соседняя таблица | Нет | Composite FK, NULL, missing reference, permissions; новая object view с явным фильтром и возвратом к источнику |
| DB-22 | Пагинация, count, reload, большой результат | Демо: 5k in-memory rows | Bounded cursor/spool, запрос следующей страницы; unknown count не выдаётся за total; cancel/release; scroll не скачет |
| DB-23 | История/избранные запросы → restore/new console | Частично: session history cards | Target/duration/outcome/query snapshot, search/favourites, persistence/retention; restore никогда не запускает SQL |
| DB-24 | Row/transpose/text/tree view, aggregates, charts | Нет | Работают над выбранным result snapshot; aggregates помечают scope; сохранение настройки view отдельно от данных |

Ориентиры: [data editor](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html), [sessions](https://www.jetbrains.com/help/datagrip/managing-connection-sessions.html), [code editor](https://www.jetbrains.com/help/datagrip/code-editor.html). Здесь важнее целостность данных и предсказуемость, чем число кнопок.

### Структура, планы и обслуживание

| ID | Возможность → путь пользователя | Исходный макет / пробел | Приёмка реализации |
|---|---|---|---|
| DB-25 | Columns/indexes/constraints/defaults/comments/partitioning → Structure | Частично: упрощённая таблица | Metadata не строится из sample rows; создать/править/удалить → актуальный SQL diff → apply → refresh |
| DB-26 | DDL объекта → редактор → diff с сервером | Частично: сокращённый CREATE TABLE для fixture | Правильный kind; identity/generated/defaults/ownership/dependencies; fingerprint guard; missing grants отдельно отмечены |
| DB-27 | Процедура/функция → definition → edit → diff → apply → test | Частично: fixture source/diff → SQL | Overloads, signatures, LANGUAGE, return types, privileges; CALL/SELECT distinction; error line; source changed since open conflict |
| DB-28 | Обычный EXPLAIN → tree/table/raw JSON | Частично: заранее заданные значения | Captured SQL/target/settings, estimated-only metrics, планы без query execution; invalidated когда SQL меняется |
| DB-29 | EXPLAIN ANALYZE → explicit choice → actual/buffers | Частично: settings без корректной модели | Фактическое выполнение ясно до запуска; side effects не маскируются; estimated/actual/loops/io отличаются; no invented timings |
| DB-30 | Compare schemas → выбрать diff → migration preview → target run | Демо diff; target console не зафиксирована | Реальные snapshots, rename vs drop/add, dependency ordering, target fingerprint, nontransactional operations, отмена/reconcile |
| DB-31 | ER/dependencies → открыть объект/related DDL | Демо three-object diagram | Real FK/virtual relations различаются; large graph filtering, fit/search; диаграмма не меняет схему сама |
| DB-32 | Sessions/locks → blocker chain → cancel query / terminate session | Частично: fixture список, terminate disabled | PID plus backend start identity; privileges; refresh interval/pause; cancel query отличается от terminate и его rollback effects |
| DB-33 | Roles/grants/ownership/default privileges → administrative views | Нет | Capability-driven read/write; SQL preview; refresh grants; отсутствие permission не выглядит пустым списком |
| DB-34 | Compare data → ключи/диапазон/columns → diff/export | Нет | Стабильный snapshot или явное отсутствие; lossless equality; bounded comparison; SQL apply отдельный changeset |
| DB-35 | DB maintenance / stats / extensions / routine debugging | Нет; состав ещё требует отдельных UX сценариев | Каждая операция имеет capability и реальный backend test; routine debugging без подходящего server extension нельзя обещать |

Ориентиры: [execution plans](https://www.jetbrains.com/help/datagrip/query-execution-plan.html), [schema comparison](https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html). В Workbench предварительный план и измеряющий запуск должны быть разными действиями, а миграция — документом с закреплённой целью.

### Файлы, большие задания и агент

| ID | Возможность → путь пользователя | Исходный макет / пробел | Приёмка реализации |
|---|---|---|---|
| DB-36 | CSV/TSV → import preview → mapping → COPY job | Демо wizard, файл не читается | Encoding/delimiter/quote/newline/NULL; streaming parse; target columns; malformed rows report; `COPY FROM STDIN`, backpressure |
| DB-37 | Excel → лист/range/header/types → COPY job | Частично: формат выбирается, sheet path не раскрыт | Sheet selection, date/decimal/formula semantics; streaming reader or disk spool; convert typed rows → COPY stream; corrupt/oversized files |
| DB-38 | SQL-файл → run plan → results/errors | Частично: отдельный route описан | Stream/parser-aware script runner; dollar quotes, psql directives detection; no `split(';')`; arbitrary SQL не выдаётся за COPY data |
| DB-39 | Export CSV/XLSX/SQL → scope/format/destination → job | Демо form/job; файла нет | Selection/current page/full result/full table различаются; persistent snapshot; escaping/types; XLSX row limits; partial file not success |
| DB-40 | Долгое задание → progress → background → cancel/report/recovery | Демо timer/unknown-outcome scenario | Bytes/rows measured, throughput/ETA optional; durable job ID; switching project keeps owner; cancel transaction state confirmed |
| DB-41 | Backup/restore pg_dump/pg_restore, copy table/database | Нет полного пути | Отдельные операции от export grid/COPY; tool version discovery; paths on Windows; plans/credentials/log redaction; restore validation |
| DB-42 | Agent writes SQL → user sees draft/run/result/check | Частично: context в composer | Те же documents/operations и result handles; no separate hidden DB workflow; bounded evidence; target pinned; human edits produce conflict |
| DB-43 | Сохранить query/plan/result в Task / artifact | Частично: общий agent context | Immutable query/plan snapshot, result selection/size metadata; huge rows не идут в prompt; ссылка открывает нужный owner |
| DB-44 | TLS/auth/MCP/html error → diagnosis → reconnect | Частично: 413 demo и target checks | HTML как текст; credentials redacted; reconnect не повторяет writes; known SQLSTATE и driver details сохранены; partial result marked |
| DB-45 | Windows/ВАРМ/session restore/accessibility | Нет живого Data runtime evidence | Keyboard focus, screen scale, split/drag, reconnect, sleep/resume, IME; restore сохраняет documents, не выдумывает живую transaction |

Ориентиры: [import](https://www.jetbrains.com/help/datagrip/import-data.html), [export](https://www.jetbrains.com/help/datagrip/export-data.html), [extractors](https://www.jetbrains.com/help/datagrip/data-extractors.html), [PostgreSQL COPY](https://www.postgresql.org/docs/current/sql-copy.html), [pgJDBC parameters](https://jdbc.postgresql.org/documentation/use/). Excel→COPY и границы памяти — наше требование реализации, а не утверждение о внутренней архитектуре DataGrip.

## Инженерные правила, которые определяют UX

### Изоляция без потери скорости

Разделить `ConnectionDefinition → ProjectBinding → DatabaseTarget → SessionLease → Document → Run → ResultHandle`. Два документа могут намеренно использовать одну session, но это видно в селекторе session и transaction state. По умолчанию отдельная консоль получает отдельную session. Background introspection не блокирует interactive query. Tabs и layout не владеют соединением: перестановка панели не делает reconnect.

Каждый запуск сохраняет SQL snapshot, параметры, target, session generation, settings, start/terminal timestamps. Ответы после смены вкладки адресуются исходному run. Вручную изменённый запрос не заменяет исторический SQL результата. Для параллельного запуска agent/human использовать те же owner и conflict checks; агент не должен перетирать редактируемую консоль.

### MCP и JDBC

Сначала снять фактический inventory MCP tools на рабочем компьютере. Связать реальные имена tools с нормализованными операциями из `DATABASE.md`. Не придумывать наличие `COPY`, cursor, transactions или cancel по одному `execute_sql`. Если провайдер stateless, UI не обещает Manual transaction; если нет streaming, крупный импорт недоступен с конкретной причиной. JDBC bridge при необходимости оформляется как отдельный совместимый service/MCP provider с обнаружением driver/runtime, а не как скрытый обход существующей интеграции.

Настройки соединения включают display name, окружение (произвольное), MCP server/binding, database/schema defaults, driver profile и secret reference, TLS/certificates, timeout/cursor settings и capability status. Credentials не копируются между проектами: проекты используют одно definition по ID. Адреса/секреты не уходят в chat или screenshot diagnostics. User policy может разрешать обычные действия без permission modal; реальный конфликт данных, неизвестный исход или выбор Commit/Rollback остаются вопросами о состоянии, а не фиктивной просьбой разрешить MCP.

### COPY и большие файлы

CSV и декодированные Excel rows идут через bounded parser → validation/mapping → COPY stream. Не читать весь файл и не собирать весь dataset в JSON/MCP argument. PostgreSQL `COPY FROM STDIN` передаёт данные через соединение; путь Windows на клиенте нельзя выдавать за путь файла на сервере. SQL script — отдельный parser/runner; его можно маршрутизировать через COPY лишь для явно распознанного supported COPY payload, сохраняя исходную семантику.

Import policy задаёт atomic transaction или явные batches; прогресс различает processed, staged и committed rows. Reconnect после неизвестного исхода не начинает «ещё раз» автоматически. Нужен receipt/ledger и проверка committed effects. Экспорт пишет временный файл, затем finalizes только после корректного завершения; частичный результат доступен отдельно с маркировкой. XLSX при превышении формата предлагает разделение на листы/файлы или CSV до старта. Native COPY capability PostgreSQL не гарантируется одним фактом наличия JDBC у совместимой СУБД.

Для измерения: 100 MB, 1 GB и 10 GB datasets, ограниченный памяти worker, narrow/wide rows, длинные поля, malformed input, slow network, disk full, cancel/reconnect. Целевой предел streaming buffers задаётся конфигурацией (стартовый ориентир 8 MiB); этот предел не равен полному RSS процесса. Отдельно замерить parser, JDBC/JVM, spool, renderer. Не писать «8 MiB памяти» по размеру одного буфера.

## Этапы после аудита

**A. Закончить макет до согласования.** Исправить восемь главных дефектов; показать independent consoles/object tabs, split execution, связанный result, staged changes, корректный Plan. Затем пройти все строки матрицы: для сложных возможностей подготовить полный happy path, empty, error, conflict и cancel. Неподготовленные строки остаются открытыми; общий gate нельзя закрыть на основании одного красивого SQL-экрана.

**B. После согласования — вертикальный live-срез PostgreSQL.** Config/MCP probe → target → session → execute/cancel → bounded grid → close/recovery. Только после доказанной изоляции добавлять parallel agents и shared sessions.

**C. Работа с данными.** Typed values, changesets/optimistic update, manual transactions, multi-result sets, server filtering, row navigation, streaming import/export. Каждый шаг заканчивается действующим сценарием и trace, а не ещё одним пустым toolbar.

**D. Объекты и разработка схемы.** Introspection/DDL/routines, semantic SQL, explain/compare/ER, migrations and privilege views. Сравнить с уже созданным пользователем кодом: если он лучше, показать аргументы и варианты переноса перед заменой.

**E. Полнота и эксплуатация.** Services/locks, backup/restore, advanced viewers/comparisons, capabilities разных JDBC-compatible engines, Windows/ВАРМ polish. Матрица расширяется проверенными возможностями; полный паритет не объявляется до покрытия всех согласованных сценариев и явного списка исключений.

Эти этапы уточняют функциональную последовательность, но не заменяют зависимости в `suite/implementation-plan.json`. В каждую карточку переносить соответствующие DB-ID и evidence; пользователь получает проверяемый рабочий результат после каждого среза.

## Чек-лист проверки и честного статуса

### Проверить на макете до реализации

- [ ] Открыть таблицу из дерева, сохранив отличимый пользовательский SQL и положение курсора; вернуться без потерь.
- [ ] Две консоли с разными текстами и результатами: переключить, закрыть inactive, reopen; никакого подменённого grid.
- [ ] Запустить statement, выделение и script с `;` внутри literal/function body; увидеть точную область запуска или честное ограничение demo parser.
- [ ] Два результата и output одного script, затем новый запуск; старые результаты имеют собственный snapshot.
- [ ] Tree search + schema selection + пустой выбор + cancel: сохранение по connection/database, без изменения search_path.
- [ ] Строка: edit/add/delete → changeset → SQL preview → submit → Manual commit/rollback. Discard local и rollback submitted различаются.
- [ ] Обычный Plan не содержит actual ms; ANALYZE выбирается одним режимом; смена SQL обозначает старый snapshot.
- [ ] WHERE всей таблицы и local find не смешиваются; пагинация показывает реальную область фильтра.
- [ ] Import CSV/Excel/SQL и export selection/full result показывают разные routes и точную цель; отмена имеет конечный статус.
- [ ] Работа в другом project/window не сбрасывает SQL, target, query, background job и transaction.
- [ ] На 1440×900 и 1920×1080 основные действия видны, tooltip/keyboard/focus работают; при split рядом с чатом нет наложений/невидимых крестиков.
- [ ] В тёмной теме код использует Monokai; в светлой все code surfaces имеют светлую companion-палитру (`#fcfcfa`). Проверены фон/токены/каретка/выделение/номера строк/активная строка и diff, включая открытые диалоги, логи и генерируемый SQL. Нет тёмных readonly-вставок в светлом интерфейсе; цвета не являются единственным признаком ошибки или diff.
- [ ] Ошибки и empty state отличаются; новый реальный connection не получает демонстрационные таблицы.

### Проверить на настоящем PostgreSQL/MCP/Windows после согласования

- [ ] SQLSTATE/позиция syntax error, timeout/cancel race, session loss, reconnect, duplicate event, failed tx, unknown write outcome.
- [ ] Две реальные параллельные sessions; `search_path`, temp table и uncommitted data не просачиваются друг в друга.
- [ ] BIGINT/NUMERIC, timestamps/timezones, NULL/empty, JSON/bytea/arrays, quoted identifiers и overloaded routines.
- [ ] Optimistic edit conflict и affectedRows != 1 не приводят к молчаливому успеху; view/join/no-key не имеют ложного edit mode.
- [ ] Streaming 10 GB: actual bytes/rows, memory trace, responsive renderer, cancellation, disk full, no whole-file IPC/prompt.
- [ ] Реальные COPY receipts и rollback: cancel и connection loss не отмечаются «без изменений» без readback.
- [ ] DDL/schema comparison на изменившемся target, concurrent index, permissions, зависимые объекты и запрет stale apply.
- [ ] Manual sessions, sleep/resume, app crash и рестарт: восстановление SQL работает, живые transactions не выдумываются.
- [ ] Всё то же доступно через выбранную агентскую session с видимыми SQL, result и проверкой; secrets/large tables не отправляются модели автоматически.

Для evidence записывать: DB-ID, source revision, OS, provider/driver/server версии, набор данных, действия, ожидаемый/наблюдаемый результат, screenshot/trace/test, ограничения. Этот документ основан на чтении исходников и официальных справочников; сам по себе не является live UI или runtime pass.

## Выполненный проход прототипа · 14 октября 2026

Матрица выше сохраняет исходный аудит. Этот раздел фиксирует последующие изменения и не означает полного паритета с DataGrip.

- SQL консоли, таблицы и определения процедур теперь отдельные документы. Открытие объекта больше не заменяет пользовательский SQL; повторное открытие выбирает существующий документ.
- Результат, SQL запуска, target, параметры, режим транзакции, черновик строк и история принадлежат документу. Переключение во время выполнения не переносит результат в другую вкладку. Смена подключения создаёт отдельную консоль.
- Таблица содержит «Данные / Структура / DDL / Связи». Add/edit/delete собираются в changeset с просмотром SQL; Manual apply и commit/rollback различаются. Результат SQL консоли доступен только для чтения.
- Дерево остаётся слева; редактор и дерево изменяют размеры мышью и клавиатурой. Закрытие последнего документа даёт пустое состояние без автоматически созданной консоли. Нельзя скрыть все столбцы без понятного сообщения.
- EXPLAIN и ANALYZE выбираются одним режимом. Статический учебный план обозначен как пример checkout_retry, не анализ введённого SQL. После изменения SQL предыдущий snapshot обозначается устаревшим.
- Import/export сохраняют формат, настройки, таблицу, документ и target в задании; повтор использует те же настройки. Мастера не читают/пишут реальные файлы. Сравнение схем использует зарегистрированные подключения и проверяет обе цели перед созданием новой консоли миграции.
- В светлой теме SQL, IDE, readonly code, логи и diff используют светлую companion-палитру. Тёмный Monokai сохранён в тёмной теме. Проверенные пары токен/фон: минимум 4.98:1; это не полный аудит WCAG.

Живая проверка в браузере: отличимый SQL сохраняется после открытия orders; запуск в фоне остаётся в своей консоли; Manual на orders не меняет Auto SQL консоли; изменение строки → preview → apply → rollback возвращает исходное значение; экспорт XLSX/current page остаётся привязан к orders; процедура открывается отдельным документом. Проверены изменения размеров мышью и стрелкой, закрытие последнего документа, открытие объекта из пустого состояния и запрет скрыть все столбцы. Светлая тема просмотрена при 1280×720 и 983×924, без внешнего горизонтального overflow. На узкой desktop-панели таблица, код и панель инструментов имеют собственную прокрутку. Ошибок JavaScript в финальном проверенном сценарии не зарегистрировано.

Автоматические доказательства: `design/review-evidence/database-workspace-audit.cjs` и одноимённый JSON с точным числом тестов и hash исходника; соседние regression suites IDE UX, schema filter, SQL formatter, syntax. Визуальные доказательства: `database-workspace-light.png`, `database-light-palette.png`, `database-workspace-dark.png`; контраст — `syntax-theme-contrast.json`.

Ограничения: прототип работает с учебными данными, без PostgreSQL/JDBC/MCP. Динамическая генерация реального плана, полный multistatement result viewer, произвольная структура и DDL, расширенные редакторы типов и bulk grid операции требуют дальнейших согласованных экранов и runtime. Потоковый COPY, реальный XLSX/CSV/SQL export, транзакции сервера, Windows и восстановление после разрыва должны пройти отдельные испытания. UI не подтверждает их работоспособность по учебному сценарию.


## Inline-редактирование и сокращение постоянных полос · 14.10.2026

Обычное изменение значения больше не открывает окно. Щелчок выбирает ячейку, двойной щелчок/F2/Enter начинает ввод. Enter принимает локальный черновик, Escape возвращает прежнее staged-значение, Tab/Shift+Tab переходят между ячейками; стрелки перемещают выбор. `NULL` задаётся явно кнопкой или Ctrl+Alt+N и отличается от пустой строки. Numeric остаётся строкой с точной десятичной записью, bigint проверяется в пределах int64, не преобразуется в неточный JS Number. Ошибка типа показывается непосредственно у поля. Новая строка создаётся в сетке; черновые строки видны и при активном фильтре.

«Применить» отдельно показывает SQL; в Manual далее нужен Commit/Rollback. Preview отклоняется, если изменились документ, цель подключения, режим или черновик. Удалена постоянная нижняя сводка: подключение и режим видны в рабочей строке, metadata файла IDE — в подсказке пути. Сообщения событий закрываются крестиком; закрытие не отменяет транзакцию и не стирает рабочие изменения. Полный [desktop-аудит](DESKTOP-UX-AUDIT.md) разделяет исправленные и остающиеся замечания.
