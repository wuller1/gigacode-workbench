# Проводник файлов проекта и задачи

Статус: контракт реализации, **не работающий доступ к репозиторию пользователя**. Дата: 2026-10-10. Проводник нужен уже **M3.14/D3**: открыть фактический workspace, найти файл и прочитать его без отдельной IDE. M6 добавляет полноценное редактирование через общие buffers/versions, M12 — языковые функции. Изменение GigaCode CLI не требуется.

Переиспользовать [PanelRegistry/Buffer services](PANELS_AND_IDE.md), [Task/workspace binding](TASK_WORKSPACE.md), [Artifact/EditSession](ARTIFACTS_AND_QUESTIONS.md), [lifecycle](ENTITY_LIFECYCLE_AND_EDITING.md), [settings](SETTINGS_AND_CONFIGURATION.md) и [контекст](CONTEXT_BUDGET.md). FileService ниже — адаптер реального filesystem owner существующего backend, не ещё одна копия файлов/истории в renderer. Дерево, editor и агент работают с согласованными roots/revisions.

## 1. Расположение и root

Кнопка **Файлы** в полосе инструментов открывает dock panel существующего layout. Вверху — понятный Project/Task workspace label, поле поиска по именам и refresh; ниже дерево с раскрытием папок. Preview открывается существующим file viewer рядом с разговором; скрытие/перемещение панели не закрывает buffer, не меняет cwd CLI и не запускает процесс. Состояние раскрытия/выбора хранится по workspace binding, не глобально для всех проектов.

Root берётся из **фактического** current Project/Task workspace/worktree binding: root ID, canonical path, project/task, binding revision, доступ/статус и происхождение. Если Task выполняется в worktree, дерево показывает именно его; repo default checkout можно открыть только явным переключением с понятной подписью. Не выводить root из cwd процесса UI, последнего терминала, названия проекта или содержимого ответа модели.

Если workspace ещё не привязан/удалён/недоступен, показать соответствующее состояние и **Выбрать/восстановить путь**. Не подставлять home, соседний checkout или полный диск. Выбор нового root не запускает repo setup и не перенаправляет уже captured file operations. Несколько разрешённых roots обозначаются отдельно; межпроектный peer link не даёт проводнику автоматически читать весь другой проект.

## 2. Ленивое дерево и быстрый поиск

Backend получает `rootId + rootRevision + relativeDirectory + cursor + limits`, проверяет scope и возвращает ограниченный список names/types/metadata, directory revision и `has_more`. Это внутренний проектируемый контракт, не поля ACP. Не читать всё поддерево на mount и не отправлять содержимое файлов модели при раскрытии папки.

Каталог загружается при раскрытии, крупный список — страницами/виртуализированными строками. Сортировка детерминирована для данного snapshot; изменение каталога инвалидирует cursor или вызывает явный refresh, а не незаметные пропуски/дубли. Первые предлагаемые limits: 200 entries на страницу и 256 KiB/2000 строк текстового preview, что наступит раньше; это настраиваемые стартовые границы, не измеренная производительность. Для UTF-8/другой encoding не обрезать символ посередине без корректного decoder.

Мгновенный фильтр уже загруженных имён помечается **«В загруженном дереве»**. Поиск по workspace запускает bounded/cancellable name query с generation и показывает coverage/`has_more`; старый ответ другого root/query не заменяет новый. Можно использовать существующий metadata index либо проверенный filesystem adapter. Не обещать полный поиск, если индекс неполон. Каждый ввод не вызывает полный рекурсивный обход, Git status или LLM.

Default exclusions скрывают тяжёлые generated/dependency каталоги согласно проектной настройке; их можно показать явно, сохраняя paging. Не обходить `node_modules`, build caches, `.git` internals и вложенные links ради числа найденных файлов. Hidden/ignored indicator не удаляет файлы и не меняет Git ignore. Поиск имён не читает секретное содержимое; переход к содержимому остаётся отдельным scoped read.

Строка показывает собственную file/folder icon, имя, при необходимости компактный Git badge/modified indicator. GitService делает bounded batched status для выбранного repo/worktree и кеширует по revision/invalidation. Отличать staged/unstaged/untracked/conflict; Git unavailable/stale не отображается как clean. Не запускать Git на каждый keypress/row и не выполнять fetch/commit автоматически. Nested repo имеет собственный binding, если поддержан.

## 3. Пути, identity и чужие изменения

Renderer отправляет root/entity refs и относительный путь, не произвольную shell-строку. Backend валидирует каждый read/write/reveal/attachment: root revision, actual target, parent, scope, separators, traversal, link/reparse points. Простого строкового `startsWith(root)` недостаточно. Symlink/junction виден как link; не следовать за пределы разрешённых roots молча, не зациклить обход. При write повторно проверить identity после ожидания/диалога; если adapter не гарантирует безопасную операцию при подмене, вернуть conflict/unsupported, не назвать guard абсолютным sandbox.

Хранить display path отдельно от canonical resource identity и disk revision. Revision для записи опирается на фактически прочитанную базу/hash и доступную платформенную identity, а не только mtime/size. File ID не предполагается вечным после copy/delete/recreate/cross-volume move. Rename, case-only rename и изменения parent обновляют mapping у одного owner; stale callbacks от прежнего binding игнорируются.

На Windows не считать имена всегда case-sensitive и не нормализовать все platform keys без учёта реального filesystem. Проверять reserved names, недопустимые символы, trailing dot/space, Unicode, длинные пути и collision на целевом volume. Не исправлять пользовательское имя тихо. [Microsoft: имена и пути](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). Пробелы/кириллица передаются как данные; filesystem/shell operations не строятся небезопасной конкатенацией.

Watcher coalesces события по root/directory и обновляет только затронутые metadata/open buffers; потеря/переполнение/unknown filename → bounded rescan этой области и явный stale state. Node предупреждает о платформенных различиях `fs.watch`, ограничениях Windows/network shares и возможном отсутствии filename. [Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats). Сопоставить API с Node внутри фактического Electron; актуальная web-doc версия не доказывает availability target.

Fallback — ограниченный polling открытых/видимых областей и root health по policy, с отменой/dispose и видимым режимом наблюдения; не бесконечный scan всего репозитория по таймеру. При foreground/reconnect проверить необходимые revisions. Внешняя запись при clean preview обновляет источник с отметкой; при dirty editor сохраняет draft и создаёт conflict. `refresh` не означает перезагрузку всего приложения и не служит лечением сломанных подписок.

## 4. Просмотр сейчас, редактор отдельно

M3: bounded read-only text/code/Markdown preview, путь/encoding/size, line navigation и **Загрузить ещё** при поддержке. Binary/unsupported/too-large/permission-denied имеют честные состояния; пустой файл отличается от failed read. Copy копирует выбранный реально загруженный текст или путь по явному действию, не скрытый полный файл. HTML/JS открывается как исходник; выполнение — отдельный изолированный [mockup preview](NATIVE_MOCKUP_ARTIFACTS.md), не привилегированная страница UI.

M6: кнопка **Редактировать** подключает existing Buffer/EditSession owner: canonical buffer ID, base disk revision, dirty draft revision, autosave/recovery, CAS save и конфликт base/current/mine. Не создавать второй buffer при открытии файла в другом окне. Внешняя запись/агентский edit не перезаписывают dirty draft. Если target уже имеет работающий editor, сохранить и проверить его сейчас, не отключать ради этапности; базовый проводник не должен ждать внедрения Monaco или LSP.

Live workspace file и immutable ArtifactVersion различаются. **Сохранить материал/версию** создаёт проверенный snapshot через ArtifactService; обычный save обновляет рабочий файл и инвалидирует зависимое evidence. Rename label материала не является rename файла. File rename не переписывает старые artifact snapshots. Общий lifecycle хранит происхождение и перемещение источника; accepted результат не становится актуальным от нового имени.

## 5. Контекстные действия без скрытых последствий

| Действие | Поведение и guard |
|---|---|
| Открыть / показать в файловом менеджере | Внутренний preview — обычное действие; reveal использует backend и повторно проверенный actual path. Default external app не запускается вместо read preview |
| Копировать путь / имя / выбранный текст | Явное clipboard действие; relative/absolute path обозначены. Не отправляет файл агенту и не публикует его |
| Новый файл / папка | Имя проверяется, parent captured; создание без перезаписи существующего. Результат появляется по real receipt, ошибка не оставляет фиктивную строку |
| Переименовать / переместить | Source/base/root + destination/parent проверяются; occupied destination и dirty buffers требуют явного решения. Не переписывать существующий target и не делать implicit Git add/commit. Cross-root/volume move — отдельная поддержка с recovery либо честно unavailable |
| В корзину | Только recoverable operation с реальным storage/receipt; не fallback на permanent unlink при ошибке. Directory scope/descendants и dirty files видны; не удалять project root/worktree/`.git` служебное дерево обычным row action |
| Восстановить | Восстановить bytes и известные metadata в исходный либо явно выбранный разрешённый путь; collision не overwrite. Не выполнять старый prompt, build или Git checkout |

Создание/rename внутри явно выбранного scope уже выражает намерение пользователя, повторное согласование каждого безопасного действия не нужно. Но конфликт, overwrite, cross-root или потеря несохранённого текста нельзя трактовать как разрешённые молча. Для drag-move показать destination/действие; это не тот же drop, что attachment.

Для честного Undo использовать выбранный проверяемый механизм: host-managed recoverable trash с original path, operation ID, bytes/hash и retention либо OS Recycle Bin с его реальными возможностями. Electron `trashItem` переносит в системную корзину, `showItemInFolder` показывает путь; эти методы сами не обещают встроенного app restore receipt/API. [Electron shell](https://www.electronjs.org/docs/latest/api/shell). При OS-only варианте назвать восстановление через системную корзину, а не рисовать неработающий Undo. Task Archive/Trash не удаляет исходники; file trash — отдельная операция.

Filesystem write и journal/database не считать одной атомарной транзакцией. До dispatch сохранить intent/base/target; после — фактический outcome и post-state. Crash после rename/trash до receipt → reconcile old/new paths и identity; не повторить запись вслепую. Один owner сериализует конфликтующие операции, CAS отклоняет stale окно; внешние процессы всё равно могут менять файлы, это учитывается проверкой actual disk state.

## 6. Прикрепление к запросу без загрузки всего проекта

Drop файла в composer или **Добавить в запрос** создаёт existing attachment draft с captured project/task/root, version/hash, выбранным span/форматом, размером и способом доставки. Пользователь видит, что войдёт в запрос: snapshot, fragment или явно live ref. Dispatch проверяет его базу; изменение live source после выбора не подменяет attachment незаметно. Unsupported transport/image capability сохраняет файл, но не объявляет, что модель его прочитала.

Папка по умолчанию добавляет **metadata reference/ограниченный manifest**, не все bytes поддерева. При необходимости агент адресно читает разрешённые файлы по цели Task. Не загружать весь monorepo, ignored dependencies, секреты и все artifacts в prompt по одному drag. Места, где manifest усечён, видны. [CONTEXT_BUDGET](CONTEXT_BUDGET.md) управляет pack; file explorer не становится новым hidden retrieval engine.

При смене Task после drag/click незавершённая операция остаётся адресованной captured Task; новая active вкладка не получает чужой файл. Если root/Task scope изменился до commit/dispatch, сохранить draft и запросить адресное исправление/выбор, не перепривязывать автоматически.

## 7. Пять небольших карточек

| Карточка | Поставка | Условие готовности |
|---|---|---|
| **FE1 — root и дерево** | **M3.14/D3**: actual workspace/worktree, lazy/paged tree, loading/empty/denied/stale, сохраняемое раскрытие | A/B Task показывают свои roots; rename/unavailable root и stale cursor честны; никакого fallback на cwd/home |
| **FE2 — поиск и просмотр** | **M3.14/D3**: bounded name search/filter, read preview, Copy/reveal, cached Git badges | Unicode/large/binary cases; покрытие поиска явно; Git/LLM не вызываются на каждое нажатие; HTML не исполняется |
| **FE3 — синхронизация и attachments** | **M3.14/D3**: coalesced watcher/fallback, attachment manifest, captured targets | External change виден без app reload; dirty draft не теряется; папка не загружает весь контекст; другой Task не получает поздний attachment |
| **FE4 — безопасные file actions** | **M3.14/D3**: new/rename/move/recoverable trash; сложные неподдержанные операции disabled с причиной | No overwrite/path escape; actual receipt/undo mechanism; restart после write не повторяет неизвестный эффект. Нельзя закрыть действие работающей только кнопкой |
| **FE5 — общий editor и evidence** | **M6/D7**, reuse уже имеющегося editor раньше; язык/IDE — **M12/D12** | Один buffer в двух views, CAS conflict/recovery, Artifact snapshots и stale evidence; LSP/debugger не нужны для приёмки M3 дерева/preview |

FE1–FE3 дают ранний полезный срез, FE4 добавляется небольшой проверенной поставкой в том же baseline D3. Не задерживать первую D2 из-за полного редактора/всех вариантов file operations. Каждая недоступная функция обозначена; наличие макетного дерева не закрывает ни одну real filesystem проверку.

## 8. Fault matrix и target-проверка

- **Identity:** два окна, main checkout и worktree с одинаковыми относительными именами; смена Task во время read/rename/drop; late response прежнего root отвергнут. Metadata CAS не отменяет disk identity checks.
- **Paths:** кириллица/пробелы/emoji/длинные пути, case-only rename и collision, reserved Windows names, symlink/junction за root, loop, подмена parent во время операции. Неподдержанная filesystem semantics даёт отказ/ограничение, не успех.
- **Bounds:** пустая папка/файл, paged large directory, incomplete index, denied directory, binary/большой файл, отменённый query; не выполнять full scan на каждый keypress. Зафиксировать actual latency/bytes/syscalls, proposed limits не считать измерением.
- **Concurrency:** внешнее save/delete/recreate, watcher без filename/overflow/network-share failure, два dirty views, save против agent edit, disk full/permission error, crash после rename/trash до journal receipt. Сохранять draft и uncertain outcome до reconcile.
- **Side effects:** имя из недоверенного источника не становится shell command; open не запускает JS; tree/read/attach не меняют Git и не вызывают LLM. Trash error не становится permanent delete; restore не перезаписывает существующий файл.
- **Observer:** clean fixture с реальными file receipts проходит, known-bad wrong-root/overwrite/dirty-loss отвергается, missing root/read receipt возвращает insufficient evidence. Target Windows/actual filesystem/Node-Electron versions проверяются отдельно; здесь они не запускались.

В реализации отчёт содержит source/build/root binding, конкретный сценарий, до/после disk state и ограничения. Не заявлять полноценную IDE или управляемый доступ Giga к файлам по одному UI preview: filesystem host и CLI tools — разные реальные каналы с проверяемыми правами.
