# Data workspace

## Цель и границы

Актуальная критика UX, матрица 45 рабочих сценариев и критерии приёмки: [DATABASE-UX-REVIEW](DATABASE-UX-REVIEW.md). Интерфейс согласуется в интерактивном макете до разработки runtime.

Data workspace должен закрывать ежедневный цикл разработчика на уровне зрелого database IDE: найти объект, понять схему, выполнить и объяснить запрос, безопасно изменить данные, сравнить схемы, импортировать или выгрузить данные, увидеть блокировки и сохранить результат в Task. Это самостоятельная часть GigaCode Workbench, связанная с Project, Task, environments, Git, artifacts и агентом.

«Аналог DataGrip» здесь означает полноту рабочего процесса и качество UX. Реализация и визуальные материалы Workbench создаются самостоятельно. DataGrip служит функциональным ориентиром: изучаем поведение и общепринятые паттерны database IDE, не переносим его проприетарный код и ресурсы. Первая версия не обещает одинаковую поддержку всех СУБД: каждая функция включается только по фактически обнаруженной capability и проверенному driver adapter.

## Связь с Project и environment

Definitions connections живут в общем registry из [CONNECTIONS-AND-SETTINGS](CONNECTIONS-AND-SETTINGS.md), а Project хранит только bindings и defaults:

```ts
type ProjectDatabaseBinding = {
  id: string;
  projectId: string;
  connectionId: string;
  environmentId?: string;
  allowedDatabases?: string[];
  allowedSchemas?: string[];
  defaultDatabase?: string;
  defaultSchema?: string;
  accessMode: "read-only" | "read-write";
  displayName: string;
  tags: string[];
};

type DatabaseTarget = {
  projectId: string;
  bindingId: string;
  connectionId: string;
  environmentId?: string;
  database?: string;
  schema?: string;
  capabilityRevision: string;
};
```

Navigator показывает только bindings текущего Project, сначала pinned/recent, затем environment groups `LOCAL / DEV / TEST / STAGE / PROD`. Одинаковое имя базы всегда квалифицируется connection и environment. Production и read-only target имеют постоянный текстовый marker в toolbar, вкладке console и result grid.

Active target сохраняется по ключу `window + project + workspace + panelInstance`. Смена Project восстанавливает его собственные connections, consoles, selections и layout. Уже открытая console остаётся привязанной к captured `DatabaseTarget`: смена общего default никогда не перенаправляет выполняемый SQL на другую базу. Перенос console на другой target — отдельная команда с preview диалекта, параметров и transaction state.

Task может ссылаться на query, result snapshot, schema diff, explain plan или operation receipt. По умолчанию в Task сохраняется ссылка и краткий итог, а не весь набор строк. Большие или чувствительные данные прикрепляются только явным artifact action.

## Поддерживаемые adapters

Сделать единый `DatabaseAdapter`, но выпускать engines по проверяемым волнам:

1. PostgreSQL и совместимые варианты, MySQL/MariaDB, SQLite — базовые adapters.
2. Microsoft SQL Server и Oracle — после packaged Windows tests, проверки auth/TLS и ограничений driver/runtime.
3. ClickHouse, DB2 и другие — только отдельными adapters с собственным capability manifest и live fixtures.
4. MCP database provider — равноправный transport, если реальный сервер даёт нужные narrow tools. Он не маскируется под direct driver и может иметь меньший набор функций.

`engineFamily`, `engineVersion`, `driverName`, `driverVersion`, `transport` и schema hash обнаруживаются при connection test. UI не показывает неподтверждённую функцию. Например, session termination, transactional DDL, server-side cursor, execution-plan metrics и RETURNING не считаются универсальными.

## Архитектура процессов

```text
Renderer
  Data workspace / Monaco SQL / virtual grids / ERD
          │ typed IPC: handles, pages, operations
          ▼
Electron main
  DatabaseService · scope/policy · result registry · audit receipts
          │ MessagePort / bounded messages
          ▼
utilityProcess driver host
  adapter · pool · physical sessions · cursors · cancellation · spool
          │
          ├── direct database driver
          └── normalized MCP database binding
```

Правила реализации:

- Renderer не загружает database drivers, не получает credentials и не открывает sockets.
- `DatabaseService` в main — единственный владелец connections, logical sessions, result handles, operations и project scope checks.
- Native/binary drivers и блокирующий SQLite выполняются в `utilityProcess`, а не в renderer/main event loop.
- Минимальная изоляция — отдельный driver host на security domain/connection generation. Crash Oracle/SQLite driver не должен останавливать UI или sessions другой connection.
- Credential передаётся worker только через приватный IPC после запуска, никогда через argv, environment или log; после открытия pool worker хранит его только в памяти.
- Query rows не попадают в глобальный AppState. Driver host stream-ит metadata и pages в bounded result store; renderer запрашивает видимый диапазон.
- Для большого результата допустим временный spool с user-only ACL, quota и lifecycle cleanup. Он не попадает в backup, diagnostics, Git или общую память. Persisted result создаётся только как явный artifact.
- У каждого request есть `operationId`, deadline, cancellation token и monotonic event sequence. Backpressure ограничивает объём незапрошенных rows.
- Driver host имеет heartbeat, memory/CPU limits, graceful drain и forced termination. После crash текущие sessions получают `CONNECTION_LOST`; transaction state становится `unknown`, пока не подтверждён reconnect/readback.
- Скрытие/перемещение панели не закрывает connection, result или transaction. Закрытие console с активной transaction показывает конкретные `Commit / Rollback / Keep open`; timeout не подменяется успешным rollback.

Connection pool ограничивается per connection policy. Interactive console получает session lease; metadata/search и read-only preview используют отдельный short-lived pool. Долгая query не должна блокировать catalog refresh. Prepared statements, cursors и transactions никогда не переезжают между physical sessions.

## Каноническая модель

```ts
type DbObjectKind =
  | "database" | "schema" | "table" | "view" | "materialized-view"
  | "column" | "index" | "constraint" | "sequence" | "routine"
  | "trigger" | "type" | "user" | "role";

type DbObjectRef = {
  target: DatabaseTarget;
  kind: DbObjectKind;
  stableId?: string;
  qualifiedName: string[];
  revision?: string;
};

type DatabaseCapabilities = {
  revision: string;
  engineFamily: string;
  engineVersion?: string;
  dialect: string;
  features: Record<string, "available" | "unavailable" | "unknown">;
  limits: { maxParameters?: number; maxIdentifierLength?: number };
  discoveredAt: string;
};

type SessionLease = {
  leaseId: string;
  target: DatabaseTarget;
  owner: { windowId: string; taskId?: string; consoleId: string };
  generation: number;
  transaction: "none" | "active" | "failed" | "unknown";
  readOnly: boolean;
};

type QueryRequest = {
  operationId: string;
  leaseId: string;
  sql: string;
  mode: "statement" | "selection" | "script";
  parameters: { name?: string; position?: number; type?: string; value: unknown }[];
  maxRows?: number;
  pageSize: number;
  timeoutMs?: number;
  expectedSessionGeneration: number;
};

type ResultColumn = {
  name: string;
  label: string;
  databaseType: string;
  canonicalType: "string" | "integer" | "decimal" | "boolean" | "date" |
    "time" | "timestamp" | "json" | "binary" | "uuid" | "unknown";
  nullable?: boolean;
  precision?: number;
  scale?: number;
};

type QueryResultHandle = {
  resultId: string;
  operationId: string;
  columns: ResultColumn[];
  statementIndex: number;
  rowCount?: number;
  truncated: boolean;
  hasMore: boolean;
  affectedRows?: number;
  elapsedMs: number;
  expiresAt?: string;
};

type ResultPage = {
  resultId: string;
  offset: number;
  rows: unknown[][];
  nextOffset?: number;
  complete: boolean;
};
```

Числа `BIGINT`/`DECIMAL` не преобразуются молча в JavaScript `number`; сохраняются как lossless string/typed value. Date/time/timestamp передают raw value, database timezone и display timezone. `NULL`, empty string, zero, binary и unavailable имеют разные renderers.

## Канонические операции

```text
database.connection.test/capabilities
database.session.open/status/close
database.transaction.begin/commit/rollback/savepoint
database.catalog.children/get/search/ddl/dependencies/refresh
database.query.describe/execute/cancel
database.result.page/value/download/release
database.data.read/preparePatch/applyPatch/reconcile
database.schema.snapshot/diff/prepareApply/apply/reconcile
database.explain.prepare/run/get
database.import.preview/start/status/cancel
database.export.prepare/start/status/cancel
database.monitor.sessions/locks
database.monitor.prepareCancel/cancel/prepareTerminate/terminate
database.history.list/get/delete/clear
```

Events адресуются точным `targetWindowId`, `projectId`, `connectionId`, `leaseId/resultId` и содержат `sequence`. Основные события: `query.started`, `query.columns`, `query.pageAvailable`, `query.notice`, `query.progress`, `query.completed`, `query.failed`, `query.cancelled`, `session.stateChanged`, `catalog.invalidated`. События одной connection не broadcast-ятся во все окна.

Ошибки нормализуются, не теряя vendor code/state:

```ts
type DatabaseError = {
  code:
    | "AUTH_FAILED" | "TLS_FAILED" | "PERMISSION_DENIED" | "NOT_FOUND"
    | "SYNTAX_ERROR" | "CONSTRAINT_VIOLATION" | "DEADLOCK"
    | "LOCK_TIMEOUT" | "QUERY_TIMEOUT" | "CONNECTION_LOST"
    | "STALE_REVISION" | "TRANSACTION_UNKNOWN" | "UNSUPPORTED"
    | "RESULT_EXPIRED" | "USER_ACTION_REQUIRED" | "UNKNOWN";
  message: string;
  retryable: boolean;
  vendor?: { code?: string; sqlState?: string; detail?: string };
  correlationId: string;
};
```

Если MCP/proxy вернул HTML вместо JSON, ответ сохраняется только как bounded sanitized diagnostic, определяется по content type и первым bytes и превращается в нормальную ошибку. UI не печатает HTML как SQL error и не исполняет его.

## Explorer и поиск

Database navigator загружает дерево лениво:

```text
Connection / database
  Schemas
    Tables / Views / Routines / Types / Sequences
      Columns / Keys / Indexes / Triggers / Dependencies
```

- Expansion запрашивает только детей текущего узла с cursor/paging.
- Filter работает локально по загруженному, global object search — через catalog adapter.
- Object details содержит columns, keys, indexes, DDL, dependencies, privileges и статистику только при доступной capability.
- Refresh узла не очищает старое содержимое до ответа и помечает stale age.
- Смена database/schema selection не меняет active console без явного rebind.
- Favourites, aliases и manual grouping являются локальными view settings и не переименовывают remote objects.
- Контекстные команды строятся из capabilities и permissions. Недоступная функция объясняет причину.

Metadata cache индексируется `connection generation + database + schema + object stable ID/revision`; TTL настраивается. DDL или external invalidation сбрасывает затронутую ветку, а не весь registry.

## SQL console и editor

Использовать общий Monaco/DocumentService из [IDE](IDE.md), добавив dialect adapter. Console — полноценный document с connection pin, session lease и transaction indicator.

Обязательные функции:

- несколько consoles, split groups, preview/pinned tabs и восстановление после restart без автоматического reconnect/execute;
- dialect-aware highlighting, completion, formatting, navigation к object и diagnostics;
- выполнение current statement, selection или script; statement boundaries определяет dialect parser, а не только `;`;
- named/positional parameters с типом и безопасным binding; history значений выключена для secret-like parameters;
- несколько result sets, server notices/warnings, affected rows и generated keys;
- autocommit/manual transaction, savepoints и видимый failed/unknown state;
- query timeout, max rows, fetch size, cancellation и elapsed/progress;
- favourites, snippets и saved `.sql` files внутри проекта;
- attach selected SQL/error/plan/result summary to Task или agent chat;
- background execution как operation с badge; закрытие tab не теряет состояние.

SQL parser/classifier помогает UX, но не является security boundary: dialect constructs, stored procedures и dynamic SQL не позволяют гарантированно определить side effects. Настоящий read-only обеспечивается отдельными credentials/roles, read-only transaction где доступно и backend policy. Manual console не показывает подтверждение для каждого обычного запроса; high-impact action и SQL агента показываются inline с точным target, impact и recovery. При `auto_allow_bound` это наблюдаемая операция без отдельного permission modal.

## Results grid

Grid должен поддерживать:

- virtualization по строкам и столбцам, sticky headers, resize/reorder/hide/freeze;
- keyboard cell/range navigation, copy с/без headers и безопасный paste;
- server-side paging/cursor, visible-range fetch и явный `truncated`;
- local filter/sort только для уже загруженного диапазона с понятной меткой; server query rewrite — отдельная команда с preview;
- type renderers для numbers, temporal values, JSON, arrays, UUID, geometry preview, binary/LOB;
- null/empty/zero markers, timezone и unit labels;
- column statistics/grouping только для текущего набора с обозначением scope;
- FK navigation к related rows с параметризованным query;
- pin result, compare results и detach in split;
- export visible selection, page или complete result с точным scope.

Large LOB не загружается автоматически. Cell показывает type/size и даёт bounded preview/download. Result page и LOB endpoint проверяют project/window ownership. После release/expiry UI сохраняет columns/query summary и предлагает rerun, а не показывает пустой успешный результат.

Для UI рассмотреть [Glide Data Grid](https://github.com/glideapps/glide-data-grid) или `react-data-grid` после отдельного prototype/accessibility/performance сравнения. Выбор библиотеки не должен диктовать domain model.

## Data editor

Редактирование таблицы строится как change set:

```ts
type RowIdentity = {
  keyColumns: string[];
  originalValues: unknown[];
  rowVersion?: unknown;
  fingerprint?: string;
};

type DataPatch = {
  patchId: string;
  object: DbObjectRef;
  baseCatalogRevision?: string;
  changes: Array<
    | { kind: "insert"; values: Record<string, unknown> }
    | { kind: "update"; identity: RowIdentity; values: Record<string, unknown> }
    | { kind: "delete"; identity: RowIdentity }
  >;
};
```

- Редактирование разрешено, когда adapter может построить устойчивый predicate: primary key, unique key или vendor row identifier.
- Без устойчивой identity grid read-only. Режим all-columns predicate допускается только как отдельная expert option с предупреждением и expected affected row count.
- Изменения остаются pending в grid. `Review changes` показывает target, строки, generated parameterized SQL, defaults/NULL, FK/constraint warnings и transaction plan.
- Update/delete включает original key/version/fingerprint. `affectedRows = 0` означает stale row, `> 1` — conflict; автоматический success запрещён.
- Batch применяет изменения в transaction, если engine это поддерживает; partial/non-transactional result отображает результат каждой строки и reconciliation.
- Generated/default values читаются обратно, если это надёжно поддерживается; иначе row refresh.
- Paste/import в data grid сначала проходит type validation и preview.
- Undo до apply локальный; после commit — новая compensating proposal, а не обещание универсального rollback.

## Schema snapshot, diff и migrations

Snapshot содержит engine/version, target, capturedAt, identifiers, columns, types/defaults, keys, indexes, constraints, routines/triggers и capability gaps. Raw catalog metadata остаётся доступной для диагностики, но diff работает по normalized dialect model.

Schema compare поддерживает:

- database/schema/object → snapshot/current target;
- added/removed/changed objects и dependency order;
- ignore rules для owners, storage, comments и environment-specific properties;
- DDL preview по шагам с destructive/data-loss/locking markers;
- rename suggestions только как предложения: similarity не доказывает rename;
- export migration script в проект, связь с Task/Git review;
- preflight и apply только после fresh target revision/capabilities;
- receipt и post-apply readback.

Transactional DDL, online index, implicit commits и rollback различаются между engines. Review показывает фактическую поддержку. Schema apply не обещает атомарность, если driver/server её не гарантирует. Для командной разработки приоритет — создать versioned migration для Flyway/Liquibase/проектного механизма и отправить её через Git; direct production DDL не является стандартным путём.

## ER diagram

ERD строится из реальных tables/views, primary/foreign keys и comments. Inferred relations по совпадению имён выключены по умолчанию и всегда помечены пунктиром/`inferred`.

- scope: selection, schema или несколько выбранных schemas;
- search, zoom, overview, collapse columns, keys-only/full modes;
- auto-layout в worker и ручной layout;
- переход diagram → object/data/DDL и обратно;
- relationship inspector с source/target columns и constraint name;
- сохранение layout отдельно от database metadata;
- export в собственный SVG/PNG/PDF artifact без сторонней графики/брендинга;
- diff overlay для schema changes.

Для рёбер/узлов можно проверить MIT core [React Flow](https://xyflow.com/open-source), но прежде измерить крупные schemas и keyboard accessibility. Для тысяч объектов нужен level-of-detail/virtualization; нельзя рендерить весь enterprise catalog одной сценой.

## EXPLAIN и анализ запросов

`Explain` и `Execute with analysis` — разные команды. Первая не выполняет DML; вторая может реально выполнить запрос и отдельно предупреждает о side effects, locks и нагрузке.

- сохранять raw vendor plan и normalized tree;
- показывать estimated/actual rows, cost, time, loops, buffers/waits только когда они есть;
- critical path, largest divergence и expensive nodes являются подсказками, не диагнозом;
- сравнение двух plans учитывает engine/version/settings/query fingerprint;
- переход plan node → source fragment/object/index;
- план можно приложить к Task без параметров и result rows;
- agent получает bounded normalized summary и raw-plan artifact reference, а не огромный JSON в prompt.

Не подменять vendor semantics общей шкалой cost. Красный цвет сам по себе не означает ошибку; UI обязан объяснять metric и scope.

## Import и export

Минимальные форматы: CSV/TSV, JSON/JSONL и SQL для поддерживаемых объектов. XLSX/Parquet добавляются только после выбора библиотек и проверки лицензии/памяти.

Import wizard:

1. source/encoding/delimiter/quote/header preview;
2. target table или create-table proposal;
3. column mapping, types, null/default rules и locale/timezone;
4. validation sample и error policy;
5. batch/transaction strategy и impact summary;
6. streaming execution, progress, rejects artifact и receipt;
7. count/sample readback.

Export wizard фиксирует source scope: selected cells/rows, loaded page, full query или object. Показывает ordering guarantee, truncation, columns, encoding, timezone, NULL representation, masking policy и destination. Полный result повторно выполняется только с явной меткой и captured parameters/target.

Все операции streaming, cancellable и quota-aware. Импорт/экспорт не загружает файл целиком в renderer. Output path проходит workspace/path policy; существующий файл заменяется atomic action. Resume допустим только для adapter/format, где offset и transaction semantics подтверждены.

## Query history, sessions и locks

Query history хранит target identity, query fingerprint/text согласно policy, start/end/status, elapsed, row/affected counts, error class, Task/session и result/artifact refs. Parameter values по умолчанию не хранятся. Для connection можно отключить history или открыть private console. Query text тоже может содержать secret/PII, поэтому history не попадает в общую memory, telemetry или diagnostics; retention и очистка настраиваются.

History поддерживает search/filter, rerun with target check, favourites, compare timing/plan и delete/clear. Rerun всегда показывает stale/missing target и не выбирает другой connection по имени.

Sessions/locks view доступен по capabilities и permissions:

- current sessions, user/app/client, state, transaction age, current query preview;
- lock graph/blocking chain и wait type;
- собственная session отмечена и защищена от случайного termination;
- cancel query и terminate session имеют prepare/execute/readback;
- production/high-impact operation показывает target, owner/query age, affected chain и permission;
- timeout после terminate даёт `unknown` с refresh/reconcile, не повторный blind call.

Monitoring не превращается в полноценный DBA observability продукт на первом этапе. Metrics, которые engine/permissions не предоставляют, показываются unavailable.

## Agent и MCP adaptation

Agent получает узкие canonical tools, а не raw driver, arbitrary MCP tool name или универсальный shell. При подключении MCP host выполняет initialize/discovery, сохраняет tool/input schema hashes и строит mapping:

```text
canonical operation
  → project/role policy
  → validated target/resource refs
  → adapter binding to discovered MCP schema
  → normalized result/error/receipt
```

Schema hash change отключает только затронутые mappings до повторной проверки. Agent на рабочем компьютере читает фактические schemas и донастраивает mapping; он не угадывает названия tools.

Agent functions:

- искать objects и читать bounded metadata/DDL;
- создавать/редактировать `.sql` и migration files;
- выполнять read-only query с row/byte/time limits;
- предлагать explain, data patch, schema diff или migration;
- анализировать выбранные rows/plan/error через stable artifact reference;
- прикладывать evidence к Task;
- рекомендовать Data workspace, когда запрос или ошибка относятся к БД.

Для контекста 256k передавать schema digest и результаты catalog search, а не весь catalog. Rows выдаются страницами; binary/LOB остаются artifacts. Comments, names и cell text считаются недоверенными данными и не могут менять системные инструкции агента.

Agent-generated `INSERT/UPDATE/DELETE/DDL`, import, session termination и complete-result export всегда создают подготовленную inline operation с точным captured target, SQL/diff, impact, transaction mode и recovery. При стандартной политике `auto_allow_bound` разрешённая project binding операция автоматически проходит execute, affected-row/readback и evidence stages без отдельного permission modal. Это не означает исполнение SQL из обычного текста ответа: CommandBus принимает только типизированную prepared operation. Явный центральный запрет или target rule делает действие недоступным; backend всегда применяет limits, scope, transaction и reconcile gates.

## UX Data workspace

```text
┌ Project / Task     STAGE · PostgreSQL · app_db/public     Read-only ┐
│ rail │ Data navigator │ SQL console / table / ERD          │ details │
│      │ connections    │                                     │         │
│      │ schemas        ├ Results · Plan · Output · Sessions ──────────┤
└ branch · transaction · 240/1000 rows · 184 ms · connection health ───┘
```

- Data icon в rail открывает последний Data resource Project.
- Navigator: connections/environments, schemas/objects, favourites и history; connection manager открывается отдельно в Settings.
- Primary tabs общие с Workbench: console, object details, table data, schema diff, ERD, explain plan и result snapshot.
- Inspector показывает object metadata, row details, privileges, query parameters или operation evidence.
- Bottom tabs: Results, Plan, Output, Sessions/Locks; они не раскрываются при каждом notice.
- Connection/target selector рядом с Run, а не спрятан в status bar. Run disabled с объяснением, пока target/session не готовы.
- `Ctrl/Cmd+Enter` выполняет current statement; selection имеет приоритет, но UI подсвечивает фактический scope до запуска. `Shift+Enter` выбирается настройкой и не зашивается глобально.
- Active transaction, stale metadata, truncated result, read-only и production различаются текстом/формой, а не только цветом.
- Back/forward восстанавливает object/tab/selection/scroll без повторного query.
- `Ask agent about selection` передаёт видимую выборку и scope summary; пользователь видит, что именно будет приложено.

Loading/error/stale/conflict states соответствуют [UX-FOUNDATION](UX-FOUNDATION.md). Refresh не очищает прежние rows. Focus остаётся в editor/grid, status обновляется без layout shift. Все основные пути доступны клавиатурой, включая grid, tabs, navigator, parameter dialog и review sheet.

## Безопасность и сохранность данных

- Credentials, SSH keys, client certificates и tokens находятся в vault/external provider; renderer видит только `secretRef/configured`.
- Remote TLS validation обязательна. Custom CA/client certificate поддерживаются; bypass проверки сертификата отсутствует.
- Direct driver/MCP connection ограничена project scopes и captured target. IPC повторно проверяет scope, даже если button был hidden.
- Read-only label не является защитой без database role/transaction/backend enforcement.
- SQL, DDL, plans, comments, errors и cell values считаются недоверенными. HTML не рендерится без sanitization; ссылки не открываются автоматически.
- Query/result/exports могут содержать PII и secrets: content не попадает в logs, crash report, common memory, analytics или clipboard history приложения.
- Logs содержат operation ID, target IDs, duration, counts и vendor error class, но не SQL/parameters/rows по умолчанию. Debug capture требует явного bounded opt-in и redaction preview.
- Parameterized APIs обязательны для data editor/FK navigation/service queries. Пользовательский raw SQL остаётся raw SQL, но никогда не собирается shell interpolation.
- Driver package/install/update проходит allowlisted manifest, checksum/SBOM/license review; agent не скачивает случайный driver во время query.
- Mutation receipt фиксирует target generation, actor, operation, SQL hash/patch summary, start/end, result и readback; secret values исключаются.
- Сохранение результатов, export и импорт obey path/size quotas. Symlink/reparse-point escape и UNC policy проверяются в backend, особенно на Windows.

## Этапы реализации

1. **D1 — foundation:** canonical types, DatabaseService, driver-host protocol, project bindings, connection test/capability inspector, targeted events и secret-safe logging.
2. **D2 — PostgreSQL read-only vertical slice:** catalog tree/search/DDL, SQL console, parameter binding, cancellation, bounded result paging и packaged Windows connection.
3. **D3 — production-grade editor/results:** Monaco dialect services, multi-result, history, grid virtualization/copy/filter, LOB handling, artifacts и crash recovery.
4. **D4 — transactions/data editor:** leases, autocommit/manual state, savepoints, optimistic row patches, review/apply/reconcile.
5. **D5 — engine adapters:** MySQL/MariaDB, SQLite, SQL Server, Oracle по одному, с capability fixtures и live matrix до объявления поддержки.
6. **D6 — import/export:** CSV/TSV/JSON/SQL streaming, mapping, validation, rejects, progress/cancel и result exports.
7. **D7 — schema tools:** snapshots, normalized diff, migration script, dependency/destructive analysis и guarded apply.
8. **D8 — ERD и EXPLAIN:** scalable diagram, plan adapters, plan compare и Task evidence.
9. **D9 — sessions/locks:** monitor, blocking graph, cancel/terminate prepare-execute-readback.
10. **D10 — MCP и agent tools:** real schema discovery/bindings, bounded context, proposals/receipts, role policies и weak-model evals.
11. **D11 — hardening:** performance/quotas, accessibility, history privacy, driver lifecycle, dependency/SBOM/security audit.
12. **D12 — Windows/corporate acceptance:** packaged app, proxy/custom CA/client certificate, direct and real MCP paths, crash/restart/update/migration evidence.

Каждый этап завершается рабочим vertical slice, screenshots светлой/тёмной темы, automated tests и live evidence. Следующий adapter не начинается ценой недоделанной transaction/cancellation/data-fidelity модели предыдущего.

## Проверки и критерии приёмки

### Contract и isolation

- две connections одинакового engine не смешивают credentials, catalog cache, events, result handles или active target;
- смена Project/окна восстанавливает свой target и не переводит открытую console на первый connection;
- renderer не может вызвать binding вне Project scope или прочитать чужой result ID;
- duplicate operation ID не дублирует mutation; uncertain outcome проходит reconcile;
- driver-host crash оставляет UI живым, закрывает leases и показывает transaction `unknown/lost` честно;
- close/hide/move панели не отменяет query; явный Cancel отменяет её либо сообщает, что connection пришлось закрыть;
- HTML/oversized/malformed MCP response нормализуется и не исполняется/не зависает.

### Data fidelity

- `BIGINT`, high-precision decimal, Unicode/emoji/кириллица, NULL/empty, NaN/Infinity где допустимо;
- date/time/timestamp with/without timezone, DST boundary и Windows locale;
- UUID, JSON/JSONB, arrays/enums, binary/BLOB/CLOB и multiline text;
- duplicate column labels, 200+ columns, generated/default/identity values;
- one/multiple result sets, warnings/notices и affected rows;
- CSV encodings/delimiters/quotes/newlines/formula-like cells и malformed rows;
- round-trip export/import сравнивает semantic values, а не только число строк.

### Query и editing

- execute current/selection/script выбирает правильный dialect statement и никогда не выполняет скрытый соседний statement;
- parameters не интерполируются строкой; secret-like value не попадает history/log;
- cancel/timeout/network drop/server restart дают правильный state и не повторяют mutation;
- active/failed transaction переживает UI refresh и не объявляется committed без server result;
- stale row update/delete даёт conflict; update без stable identity остаётся read-only;
- batch partial failure показывает каждую применённую/неприменённую строку;
- result paging 1M rows удерживает renderer responsive и соблюдает memory/quota;
- complete export честно сообщает повторное выполнение и target/parameters.

### Schema, plans и monitoring

- identifier case/quotes, cross-schema FK, composite keys, views/routines и unsupported objects;
- schema diff стабилен на повторном snapshot и не выдаёт rename как факт;
- generated DDL соответствует dialect, dependencies и captured revision; non-transactional DDL не обещает rollback;
- ERD с 500/2000 objects остаётся управляемым или требует меньший scope до render;
- EXPLAIN не выполняет query; ANALYZE clearly executes и отражает side effects/locks;
- plan metric не показывается, если vendor её не дал;
- cancel/terminate чужой session проверяет permission и readback; timeout остаётся unknown.

### Live matrix

Проверять не только mocks. Для каждого объявленного adapter нужен real server fixture и минимум один настоящий корпоративный/MCP сценарий, если этот transport заявлен.

| Область | Обязательные варианты |
| --- | --- |
| OS | packaged Windows x64; development Windows; macOS/Linux для regressions |
| Path | пробелы, кириллица, длинный path, разрешённый UNC и запрещённый escape |
| Engines | PostgreSQL; MySQL и MariaDB отдельно; SQLite file; SQL Server; Oracle после включения adapter |
| Network | latency, Retry-After/429 через MCP, disconnect mid-page, proxy, DNS failure, server restart |
| TLS/auth | system CA, custom CA, client certificate, expired/wrong host, rotated secret |
| Load | 1/5/20 consoles, 1M-row paged result, 200 columns, 1000 catalog objects, large LOB |
| UI | 1440×900 и 1024 width, 100–200% zoom, dark/light, keyboard-only, reduced motion |

На Windows дополнительно проверить utility-process cleanup без orphan, safeStorage/credential provider restart, native driver packaging/updates, PowerShell 5.1 рабочую среду, corporate proxy/CA и восстановление после app crash. Acceptance evidence содержит screen recording/screenshot, operation IDs, driver/server versions и sanitized logs. Фраза агента «всё работает» без наблюдаемого результата тестом не считается.

## Open source и лицензии

Возможная реализация должна пройти отдельный dependency review перед добавлением в package:

- [node-postgres](https://github.com/brianc/node-postgres) — MIT, основной кандидат PostgreSQL; использовать driver API, включая parameter binding/cancellation, а не писать протокол вручную. Официальная модель protocol/cursors описана в [PostgreSQL Frontend/Backend Protocol](https://www.postgresql.org/docs/current/protocol.html).
- [mysql2](https://github.com/sidorares/node-mysql2) — MIT, кандидат MySQL/MariaDB; проверить реальное различие двух engines и prepared-statement behavior.
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — MIT и native module; запускать в utility process и собирать/тестировать именно под Electron ABI/Windows.
- [Tedious](https://github.com/tediousjs/tedious) — MIT/community-supported implementation TDS, на которую ссылается [Microsoft Node.js driver guide](https://learn.microsoft.com/sql/connect/node-js/node-js-driver-for-sql-server/). Отсутствие коммерческой поддержки нужно учитывать в risk register.
- [node-oracledb](https://github.com/oracle/node-oracledb) — UPL-1.0/Apache-2.0 dual license; Thin и Thick capabilities различаются. Optional Oracle Client/Instant Client имеет собственные условия и не должен автоматически включаться в дистрибутив без проверки redistribution.
- [Glide Data Grid](https://github.com/glideapps/glide-data-grid) и [React Flow core](https://xyflow.com/open-source) — MIT candidates для grid/ERD; accessibility, canvas behavior, bundle size и performance всё равно проверяются прототипом.
- [DBeaver Community](https://github.com/dbeaver/dbeaver) и [CloudBeaver Community](https://github.com/dbeaver/cloudbeaver) — Apache-2.0 references. Их можно изучать или переиспользовать только с сохранением license/NOTICE и проверкой transitive modules; нельзя копировать enterprise/proprietary части, брендинг или assets.

Перед фиксацией версии сохранить license text, NOTICE, source URL, version/hash, SBOM и результаты vulnerability scan. Лицензия репозитория не гарантирует, что все подключаемые database client binaries, plugins, icons, docs или enterprise modules имеют те же условия.

## Честные ограничения

- Полный parity с DataGrip/DBeaver для всех engines — многолетний объём. План ориентирован на глубокие vertical slices, а не список неработающих кнопок.
- Universal SQL parser, schema diff и query classifier не бывают полностью точными для vendor extensions. Capability gaps и неизвестность должны быть видимы.
- Database read-only, rollback и cancellation нельзя гарантировать только UI. Их обеспечивает server/credential/driver, а Workbench отражает подтверждённый результат.
- ERD строится из доступной metadata; отсутствующий FK нельзя выдавать за доказанную связь.
- Session monitoring, plans, backups/restores и DBA actions зависят от permissions и engine. Backup/restore/native tools не входят в ранние этапы и требуют отдельного design/security/licensing решения.
- MCP может не давать streaming, transactions или stable row identity. В таком случае UI сокращает возможности и не имитирует direct driver.
- Сохранённые query/results могут содержать чувствительные данные. Пользователь управляет retention/export, а common agent memory их не поглощает автоматически.

## Расширение конечного объёма

[IDE-DATA-FULL-SCOPE.md](IDE-DATA-FULL-SCOPE.md) и `suite/ide-data-coverage.json` дополняют прежний контракт. S7-04/05/06 включают SQL intelligence/offline schemas, data compare/sync, файловые workflows и vendor tools. Ранее отложенные backup/restore/admin capabilities входят в поздний целевой объём, с отдельными проверками доступного MCP и серверов. Базовая SQL-консоль не закрывает Data workspace.

## Уточнение целевого объёма 2026-10-13

Обязателен [PostgreSQL COPY и developer integrations](POSTGRES-COPY-AND-DEVELOPER-INTEGRATIONS.md): первая волна PostgreSQL/JDBC через MCP, потоковые CSV/XLSX/SQL transfers и полные developer workflows трекера/forge. Этот документ уточняет прежнюю последовательность engine waves.
## Панель SQL — уточнение 2026-10-13

В согласуемом макете верхняя строка редактора содержит запуск/остановку, кнопку форматирования SQL и режим транзакции. Отдельная кнопка Explain убрана: она только повторяла переход во вкладку «План». Просмотр и параметры плана доступны во вкладке «План»; её открытие в настоящем приложении не должно молча выполнять EXPLAIN ANALYZE.

По уточнению пользователя форматирование возвращено рядом с «Выполнить»: кнопка `</>` имеет подсказку при наведении «Форматировать SQL» и такое же доступное имя для клавиатуры и screen reader. В макете предусмотрен предпросмотр базового преобразования ключевых слов в верхний регистр; литералы, quoted identifiers и комментарии не изменяются. Применение проверяет, что открыта исходная консоль и её SQL не изменился. Это не полноценный PostgreSQL formatter: отступы, переносы и dialect-aware formatting остаются отдельной реализацией приложения.

## Видимые схемы в дереве БД

В заголовке дерева объектов находится выбор схем со счётчиком выбранных. Окно поддерживает поиск по имени, независимые отметки, выбор всех найденных и снятие выбора. Поиск не снимает отметки с невидимых строк. «Применить» сохраняет выбор; закрытие и отмена оставляют прежний. Можно скрыть все схемы: пустое состояние содержит кнопку возврата к выбору.

Настройки видимости сохраняются локально по стабильному ID подключения и восстанавливаются при возвращении и перезапуске. Общее подключение использует один выбор между проектами. Системные схемы по умолчанию скрыты. После явного выбора новые схемы не добавляются в него автоматически; временное отсутствие схемы в каталоге не стирает сохранённое имя. Фильтр меняет только дерево: текущая SQL-консоль, результат, транзакция, задания и search_path не меняются.

В макете список схем демонстрационный: public содержит существующие объекты fixture, для остальных явно показано отсутствие загруженных объектов. Реальное приложение получает каталог и признак системной схемы через MCP/JDBC в контексте выбранной БД; хранит предпочтения по connection ID + database ID, не адресам/паролям. Доступность схем определяется сервером, а не этим фильтром. Если каталог не загружен, выбор недоступен.

Проверки: 23 проверки контроллера хранения и изоляции прошли. В живом макете проверены поиск public, выбор только найденной схемы, скрытие остальных, отдельный выбор для ИФТ и восстановление фильтра ДЕВ. Скриншот: `design/review-evidence/schema-filter.png`.

