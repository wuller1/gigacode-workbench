# Повторяемый перенос Desktop → Desktop

`tools/upgrade-workbench.mjs` — самостоятельный Node.js 22+ инструмент для исходников. Источник — новая сборка GigaCode Desktop (исторический GigaCode Workbench), цель — существующий пользовательский Electron-проект. Он **не устанавливает пакет в GigaCode CLI**, не меняет установленный 26.10.6, не запускает глобальные install/config commands и не переносит credentials/MCP bindings/личную память/runtime/installed plugins.

Пользовательская точка входа — [MIGRATE-GIGACODE.md](../../MIGRATE-GIGACODE.md). Рабочий агент выполняет архитектурное сравнение, merges и реальное тестирование; файловый инструмент не способен автоматически доказать, какой вариант поведения лучше.

## API и режимы

```text
node tools/upgrade-workbench.mjs
  --source <git-checkout-or-source.zip>
  --target <existing-desktop-source-root>
  [--mappings <prefix-map.json>]
  [--out <new-plan.json>]
  [--apply --expected-plan-hash <sha256>]
  [--record-adapted <source-path> ... --verification-ref <receipt-or-test-ref>]
```

Без `--apply` разрешено только чтение source/target и, если явно указан `--out`, создание нового UTF-8 плана. Полный путь source/target, mapping, selected source hashes, target hashes, previous receipt hash и metadata hashes входят в детерминированный `planHash`. `--out` использует exclusive create и не затирает прежний план.

Mapping — JSON-массив `{source,target}`. Пустой prefix соответствует корню. Более длинный source prefix выигрывает; точный source файл тоже допустим. Mapping не допускает абсолютных путей, traversal, Windows ADS/reserved names и protected destinations. Target collisions проверяются без учёта регистра на всех ОС, чтобы macOS-план не создал конфликтующую Windows-структуру.

Source directory может быть Git checkout, но Git-метаданные не читаются и Git не требуется. Source ZIP читается встроенным bounded parser; обычный общий release-root prefix автоматически убирается. ZIP64/multi-disk, encrypted entries, symlinks/special entries, case collisions, плохие CRC и traversal отвергаются; такую поддерживаемую большую исходную сборку сначала распаковывают доверенным инструментом вне target.

## Baseline и решения

Receipt хранит **два** hash для каждого принятого source файла: `sourceHash` и `targetHash`, `mode=source_equal|adapted`, mapped target и локальный `sourceBase` для трёхстороннего merge. На source-equal baseline следующий source можно копировать лишь пока текущий target остаётся равным подтверждённым старым source bytes. Существующий target без базы, локально изменённый файл или любой adapted baseline всегда дают `merge_required`; apply его пропускает.

`--record-adapted` требует текущий plan hash, существующую held merge entry и непустой `verification-ref`. Команда **не изменяет** этот target. Она фиксирует его hash и сохраняет настоящий upstream source base. Это подтверждение локального решения агента после тестов; строка verification-ref сама по себе не доказывает, что tests были выполнены.

Удалений нет. Файлы, исчезнувшие из upstream, остаются в target и receipt до отдельного решения пользователя/агента. Неизвестные существующие файлы не становятся импортированными просто из-за одинакового имени. Точное совпадение bytes допускает `unchanged` и безопасное принятие source-equal baseline.

## Запись и восстановление

1. Полный план пересчитывается перед apply и повторно после exclusive tool owner lock. Любое изменение source/target/receipt/metadata/mapping останавливает применение старого hash.
2. Перед каждым файлом повторяются target CAS и source hash. Source bases записываются content-addressed в private folder до принятия новой базы.
3. Перед заменой создаётся durable journal action `prepared`. Старые target bytes перемещаются в уникальный recovery backup, проверяются повторно; новый файл устанавливается exclusive hard link, который не перезапишет внезапно появившийся destination. Если SMB/политика не поддерживает hard links, используется только `COPYFILE_EXCL`, также запрещающий overwrite. Его bytes проверяются до `confirmed` journal action; незавершённая copy остаётся prepared/unknown для сверки с backup.
4. Backup остаётся для диагностики/ручного возврата. Если целевой файл появился или изменился у commit boundary, инструмент сохраняет доступные target/backup, прекращает новые записи и помечает journal `interrupted`. Он не откатывает всё поверх чужих изменений.
5. Metadata/receipt также проходят CAS. Существующие QUICK-UPGRADE notes не перегенерируются. AGENTS pointer добавляется один раз, предыдущие правила сохраняются.

Это **не общая атомарная транзакция и не межпроцессный lock редакторов**. Перед apply требуется остановить target application/агентов и согласовать сохранение открытых файлов. Portable Node API не блокирует произвольные writers, OS permission changes, переименование родительских каталогов или запись через уже открытый другой IDE handle. Проверки до/после и retained backups позволяют обнаружить и разобрать гонку; они не обещают абсолютную защиту от каждого внешнего writer/hardware failure. Небезопасного overwrite fallback нет; если exclusive link/copy недоступны, сохраняются bytes/backup и применение прекращается.

Нормальное завершение освобождает только собственный owner token. Чужой/нечитаемый lock не удаляется. После crash агент сначала проверяет реальный процесс, journal и target hashes; reuse PID/недоступность проверки не доказывают abandoned owner. Interrupted application не повторяется вслепую: подтверждённая часть могла сохраниться, а remaining subset требует нового плана и проверок.

## Границы чтения и исключения

До 20 000 selected files, до 16 MiB на файл, до 256 MiB суммарного source/archive. Directory prefixes фильтруются **до чтения содержимого**, ZIP prefixes — до распаковки файлов. Узкий срез не загружает весь каталог документации/screenshots/IDE в модель или процесс миграции. Inventory/plan не содержит file bodies или значений environment.

Разрешены известные source roots `app/`, `ide/`, `ui-kit/`, `workbench/`, `docs/`, `suite/`, `tools/`, `design/` и несколько root entrypoint/license documents. Всегда исключаются node_modules, generated dist/release/runtime, CLI payloads, local state/history/memory, MCP/local configuration, credential/key/certificate stores, installed plugins, executable/binary distributions и архивы. Локальные corporate plugins/credentials сохраняются в target; инструмент их не копирует в source baseline и не читает protected directories.

Очевидные private-key/API-token/JWT markers в выбранных текстовых source файлах также останавливают план без печати значения. Это дополнительная проверка известных форматов, не универсальный secret scanner: новый public bundle сначала проходит полный отдельный secret audit, а произвольные конфигурационные значения не объявляются безопасными по отсутствию regex match.

`.gigacode-upgrade/` содержит локальные code backups и инструкцию адаптера; её `.gitignore` исключает всё содержимое. Это дополнительная защита, **не разрешение публиковать private snapshots**. Force-add этой папки запрещён рабочими инструкциями. Обычные исходники `.mjs/.ts/.tsx/.ps1` не маскируются.

## Проверки

`node --test tools/test-upgrade-workbench.mjs` использует реальные временные source/target directories и ZIP fixtures: plan-only, create/update, existing better implementation, target-only/both changes, adapted baseline, source/target/receipt/AGENTS CAS, no deletes, excluded credentials/runtime, durable quick notes/pointer, stable idempotence, path/mapping collisions, symlink ancestors, foreign lock, ZIP prefix/CRC/traversal/symlink/case collision. Это файловая приёмка инструмента; target app compilation/UI/CLI fork compatibility проверяются рабочим агентом отдельно.
