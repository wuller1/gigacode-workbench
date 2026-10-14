# Рабочий Data workspace: перенос и продолжение

Срез 14.10.2026, приложение 0.3.0-preview.1. Это рабочий код PostgreSQL workspace, а не сертификат полного соответствия DataGrip. IDE остаётся на Theia; собственные Data-сервисы общие для UI и агента. На рабочем компьютере сначала сравнить существующие реализации и сохранить более удачные по правилам `SUITE-UPGRADE-AGENT.md`. Не заменять рабочий LLM-router пользователя локальным keyword fallback этого репозитория.

## Что уже работает

- Настройки → Подключения БД: несколько общих подключений, произвольные названия окружений, привязка одного подключения к нескольким проектам. Секрет хранится отдельно через Electron safeStorage; открытый fallback запрещён. Смена адреса/параметров сервера инвалидирует прежнюю target-привязку документа; его SQL и сохранённые результаты остаются доступны. Для нового сервера создать новую консоль/копию SQL.
- Встроенный отдельный stdio MCP-процесс с `pg` и отдельной физической сессией на консоль. Корпоративные stdio/HTTPS MCP подключаются через фактический inventory и `bindings`, без догадок об именах tools.
- PostgreSQL SQL editor: CodeMirror, Monokai в тёмной теме и самостоятельная светлая палитра, форматирование, Ctrl+Enter, statement/script/selection, несколько результатов, реальные позиции ошибок. Сохранение SQL проверяет revision; конфликт между окнами сохраняет отдельный recovery draft.
- Auto/manual transactions, Begin/Commit/Rollback, savepoint/rollback-to; состояние приходит от PostgreSQL ReadyForQuery. `COMMIT`, на который сервер ответил `ROLLBACK`, не выдаётся за подтверждение записи.
- Catalog: сохранённый выбор нескольких схем, системные схемы по запросу, поиск/постраничная выдача на сервере, таблицы/представления, materialized views, sequences, functions/procedures; описание columns/constraints/indexes/triggers/dependencies. Дерево скрывается и меняет размер; таблица открывается самостоятельным документом.
- Серверные фильтры/сортировка/постраничное чтение таблиц. Inline cell edits, NULL/DEFAULT, новые и удалённые строки, staged changeset. Сверка `tableoid/ctid/xmin` откатывает весь changeset при конфликте. Generated и identity ALWAYS не редактируются; произвольные SELECT/join/views не притворяются автоматически изменяемыми.
- Редактирование functions/procedures через отдельный Apply DDL: проверка исходного SHA-256, одна CREATE OR REPLACE, savepoint/transaction, чтение фактически применённого объекта до Commit. Смена сигнатуры/имени не выдаётся за обновление исходного OID. Конкурентное внешнее DDL не блокируется универсальным CAS: нужна повторная сверка.
- EXPLAIN JSON tree; оценки стоимости и фактическое ANALYZE-время различаются. ANALYZE действительно выполняет SQL и требует подходящего окружения/транзакции.
- Sessions/locks/roles/extensions, cancel/terminate по реальным PostgreSQL permissions.
- Streaming CSV → COPY FROM STDIN; XLSX → bounded OpenXML parser → COPY; SQL → incremental PostgreSQL lexer → statements в одной transaction/savepoint. Ошибка, изменение исходного файла или отмена дают rollback, если соединение позволяет подтвердить исход. Неизвестный исход остаётся unknown.
- Экспорт CSV/SQL/XLSX из полученного результата либо полный поток таблицы. Полный экспорт таблицы явно отличается от текущей страницы и не наследует её фильтр. Произвольный SQL не выполняется повторно ради экспорта. Существующий файл назначения не перезаписывается.
- BIGINT/NUMERIC/date/time/JSON/bytea сохраняются текстом без JavaScript rounding; NULL и пустая строка различаются. В XLSX значения пока экспортируются строковыми cells для сохранения точности.
- SQLite spool, журнал операций и исходный SQL/параметры/target с SHA-256; page и history читаются порциями. История и локальные результаты доступны без новой PostgreSQL-сессии. Агентский preview ограничен; усечённые cells не используются как полное значение для записи.
- Реальный потерянный ответ COMMIT (autocommit changeset и ручной Commit): write-ahead intent сохраняется host до RPC; unknown changeset блокирует повтор, изменение подключения и удаление консоли до сверки. Перезапуск не снимает блокировку. Агентская сверка требует завершённых проверок на том же подключении после исходной операции, note и evidence job IDs. Наличие job само по себе не доказывает смысл сверки: агент обязан проверить ключи/значения/эффекты, а не писать «всё работает».

## Владельцы кода

| Код | Ответственность |
|---|---|
| `app/electron/database/service.ts` | Единственный host owner: vault, target binding, консоли/revisions, project scope, pending writes, clients |
| `engine.ts`, `provider.ts` | PostgreSQL sessions, операции, spool/receipts, отдельный stdio MCP |
| `client.ts`, `http.ts`, `response.ts`, `tls.ts` | MCP discovery, schema/response validation, bounded transport, TLS trust |
| `files.ts`, `sql-file.ts` | Потоковые CSV/SQL/XLSX, ограничения parser, отмена |
| `query-stream.ts`, `wire-limit.ts` | Завершение cursor после потери socket; ограничение PostgreSQL message до буферизации |
| `app/shared/database.ts`, `sql.ts` | Общие DTO и lexer |
| `app/src/DatabasePanel.tsx` | Data workspace, documents, tree, editor/grid/transfers |
| `DatabaseSettings.tsx`, `DatabaseHistory.tsx`, `DatabaseEffect.tsx` | Настройка, история, сверка неизвестного исхода |
| `SqlEditor.tsx`, `SqlPlan.tsx`, `database.css` | Редактор, план, desktop styles |
| `app/electron/mcp.ts`, `main.ts` | Общий UI/agent dispatch, адресные project scopes и выбор файлов |

Операционный журнал сохраняет исходный payload query/changes/Commit/file операции до dispatch, scoped console ID, hash и receipt. Запрос, записанный как accepted/done, отдельно сверяется с terminal jobStatus; потерянный ответ не становится успехом. Журнал читается порциями из UI и MCP даже после сверки unknown. Schema selection ограничивает metadata/introspection и не меняет серверный search_path или целевую БД SQL. Референс принципа — [DataGrip metadata/introspection](https://www.jetbrains.com/help/datagrip/introspection.html); UI/код собственные.

Data — обычная панель общего docking tree, доступная рядом с IDE/чатом/браузером. Не создавать второй владелец подключения или отдельную «агентскую БД», которую пользователь не видит. MCP вызовы привязаны к console ID/project, а не к текущему фокусу окна.

## Настройка на Windows

1. Сначала `WORK-COMPUTER-BOOTSTRAP.md`, затем `IDE-RUNTIME-HANDOFF.md` и этот документ. Требуется Node 22.19+ (рекомендуется закреплённый runtime), Git и доступ к пакетам; IDE setup описан отдельно. Для работы Data клиенту не нужен локальный PostgreSQL server.
2. В `app/` выполнить `npm ci --include=optional`, `npm run build`, `npm start`. Сборка создаёт `dist-electron/database-provider.cjs`; в Windows package он входит вместе с основным кодом. CLI/GigaCode не модифицируются.
3. Создать подключение в UI. Для встроенного MCP указать host/port/database/user, пароль отдельным полем, SSL и при необходимости PEM CA. Для HTTPS указать URL без credentials, отдельный token, реальное имя credential header и prefix. Для stdio — executable и JSON-массив args, отдельное имя token environment variable. Не писать секреты в args/bindings/prompt/Git.
4. Сохранить → Проверить подключение/inventory. Встроенный probe действительно открывает и закрывает PostgreSQL-сессию; remote probe проверяет доступный MCP inventory. Сам факт listTools не доказывает выполнение операций БД.
5. Для корпоративного MCP сопоставить `operation → exact tool name`. Адаптер должен принимать поля Data DTO и возвращать `{value: ...}` либо совместимое structuredContent. Если существующий server имеет другую схему, написать тонкий адаптер и проверить его на собственном тестовом ресурсе. Не выдавать наличие произвольного SQL tool за готовую поддержку session, transactions, cancel, COPY и локальных file paths.
6. Привязать profile к нужным проектам. Открыть Базы данных, создать SQL-консоль, подключиться, выполнить адресную проверку. Новая консоль имеет отдельную физическую сессию; переключение вкладки не переносит транзакцию.

TLS проверяется всегда. Node default/system roots плюс явно заданный CA используются без `rejectUnauthorized:false`. Hardware client cert/mTLS, proxy, корпоративный SSO и чужой JDBC driver не считаются поддержанными без отдельного адаптера/пробы.

## MCP surface

Host tools: `database_snapshot`, `database_console_create/open/read/update`, `database_history_load`, `database_job_read`, `database_operation_list/read`, `database_execute`, `database_page`, `database_catalog`, `database_describe`, `database_table`, `database_changes`, `database_routine_apply`, `database_transaction`, `database_import/export`, `database_admin`, `database_cancel`, `database_disconnect`, `database_effect_read/resolve`, `database_reveal`.

Каждая mutating операция получает уникальный operationId, который не меняется из-за retry. Изменение payload требует нового ID только после установленного исхода прежней операции. Provider receipt записывается до dispatch и не разрешает replay pending. Это защита повторения конкретной операции, а не универсальная SQL exactly-once транзакция. `database_effect_*` сейчас обслуживает staged table changes и ручной Commit; unknown arbitrary SQL/import/routine остаются jobs со статусом unknown и требуют отдельной сверки без автоматического повтора.

На рабочем MCP отсутствие отдельной операции — конкретный unsupported. UI/агент должны объяснить недостающий adapter, а не показывать фиктивный успех. File import/export через host agent разрешён внутри project root; пользовательский native file chooser может выбрать другой файл. Remote MCP не видит автоматически файловую систему клиента: upload/streaming adapter проектируется отдельно.

## Проверки и ограничения объёма

Из `app/`:

```text
npm test
npm run build
node tools/test-database-live.mjs
node tools/test-database-live.mjs --ui
node tools/test-database-live.mjs --ui --packaged
```

Harness требует PostgreSQL binaries (`WORKBENCH_PG_BIN`, `PGBIN` либо обнаруженный путь). Он создаёт собственный временный cluster с random credentials и loopback port, не подключается к рабочей БД/службе и удаляет свой cluster после теста. Последняя команда требует готовый `release/win-unpacked`.

На macOS/Node 22.23.3 прошли 35 live engine/file/MCP сценариев: 100k result rows, 72.9 MB CSV/300k COPY rows, ~128 MiB export с 512 KiB cells, отмена, malformed/UTF-8/file-change rollback, TLS/schema validation, stale row/DDL, two independent sessions, TCP COMMIT response loss, restart/offline/target protection. 15 живых Electron сценариев сохраняют отдельный отчёт и screenshots. Отдельный настоящий stdio worker обработал и экспортировал ~128 MiB при old-space cap 64 MiB / semi-space 4 MiB; измеренный JS heap peak ~34 MiB (RSS отдельно в отчёте). Это стресс-проверка с более тесным бюджетом, не обещание такой же RAM для всего desktop/IDE. Первый Windows run на `5ab9db6` выявил тайм-аут small-row spool; новый код объединяет строки и прогресс в одну FULL SQLite фиксацию и сохраняет byte limit batch. Результат повторного Windows run проверяется отдельно. Точные версии, measured heap, names и source SHA-256 находятся в `evidence/database-runtime-*.json`. Windows CI проверяет исходники и упакованный EXE отдельно; до успешного run не переносить macOS pass на Windows.

Текущие пределы: 4 jobs и 32 физических sessions на подключение, 2 GiB spool, 8 MiB PostgreSQL message, 3 MiB UI page, SQL/params до 2 MiB, до 1000 staged rows; context preview значительно меньше. Большое значение ограничивается до буферизации драйвером; потерянная session получает unknown. Это не проверка файлов 10 GB и не замена chunked LOB editor. Очистка результатов доступна адресно, а автоматическая retention/архивная политика ещё нужна.

## Оставшиеся волны

1. Дальнейшее глубокое компактное дерево columns/keys/indexes/types, offline catalog и refresh revisions; typed cell/JSON/XML/LOB/FK navigation, clipboard/bulk editing, shared-source file association.
2. Полный schema/data diff с key mapping/duplicate handling, preview/versioned migration и apply receipt, ER diagrams, полноценные DDL/permissions/partition/policy tools. Текущий table DDL частичный, не backup.
3. SQL language services: semantic references/refactoring, injections, dialect corpus, offline DDL schemas; существующий CodeMirror completion/format не равен семантическому SQL engine DataGrip.
4. Больше import/export adapters, numeric/date Excel typing, preview/mapping/type inference, upload для remote MCP, большие XLSX/LOB stress cases, backup/restore и JDBC helper для несовместимых с PostgreSQL wire протоколом СУБД.
5. По отдельным IDEA Ultimate строкам — ORM/JPQL, framework-aware navigation/inspections и остальные `suite/ide-ultimate-parity.json` gaps. Наличие расширения не закрывает сценарий.

Сначала продолжить текущий IDE/Data объём. Пользователь отложил новые поручения: затем оптимизировать его девять профилей и существующий LLM-router (каталог сохранён в `suite/implementation-plan.json/requestedFollowUps`), затем/в том же следующем согласованном срезе Task tracker и Knowledge base. Не считать локальный fallback router заменой его уже работающей LLM-маршрутизации. Самокритика и полезные рекомендации обязательны для каждого автора; отдельный reviewer не запускается на любую мелочь.
