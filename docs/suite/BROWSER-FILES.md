# Загрузки, просмотр и редактирование файлов браузера

Статус 13.10.2026: целевой контракт и сценарии интерактивного макета. Настоящие загрузки, дисковые файлы и форматы документов проверяются после согласования полного прототипа. Этот документ не объявляет их реализованными в `app/`.

Дополняет [Browser Lab](BROWSER.md), [отдельный браузер агента](SEPARATE-AGENT-BROWSER.md) и [DocumentService IDE](IDE.md). Использовать существующие BrowserService, DocumentService, Task/Artifact registry и журнал операций. До переноса сравнить с уже работающим кодом пользователя; более удачную реализацию не заменять без аргументированного сравнения.

## 1. Рабочий маршрут и UI

Агент может скачать документ в своём браузере, открыть полученный файл, адресно прочитать его, отредактировать поддерживаемый формат, проверить результат и показать пользователю исходник и изменённую версию. Это один маршрут задачи, без ручного переноса файла между несвязанными окнами.

1. Нажатие ссылки/кнопки скачивания создаёт одну запись **«Загрузки»** в текущем browser workspace. Прогресс виден на компактной кнопке toolbar и в раскрываемом списке; активность не переключает личную вкладку и не забирает фокус.
2. Строка показывает имя, источник, инициатора, размер/полученные байты, состояние и доступные действия: пауза, продолжить, отмена. При неизвестном размере — байты и неопределённый индикатор, без придуманного процента. Закрытие списка или панели не отменяет скачивание.
3. По готовому файлу доступны **«Открыть»**, **«Редактировать»**, **«Добавить к задаче»**, **«Сохранить копию…»**, меню происхождения/исходника. Открыть повторно означает выбрать существующее представление по `fileId`, а не плодить browser tabs.
4. Поддерживаемый текст открывается в IDE сразу как рабочая копия. У изображений, PDF и документов — viewer/редактор своего типа. Пользователь видит, что именно умеет adapter, до начала редактирования. Нет ложной универсальной кнопки для неизвестного формата.
5. Агентская правка видна в том же документе с состояниями «Редактирует», «Проверяет», «Сохранено» и сравнением версий. Пользователь может забрать редактирование. Скрытые служебные операции не засоряют чат: итог содержит материал и краткое описание изменений.
6. Отредактированная копия становится версией материала задачи со ссылкой на исходник и источник. Сохранение в репозиторий — выбранное пользователем/задачей действие; скачанный файл не становится исходным кодом проекта автоматически. Обратная загрузка на сайт — отдельная операция, не скрытый эффект Save.

Список загрузок относится к Browser Lab, а файловый проводник по-прежнему находится только в IDE. Фильтр «Текущая задача / Все доступные загрузки проекта» не смешивает личный и агентский profile scopes. Ошибка имеет конкретное действие: войти на сайт, освободить место, повторить подтверждённую безопасную загрузку, открыть диагностический текст. Esc/кнопка закрытия работают в каждом popover/диалоге с возвратом фокуса.

Нормальные скачивание, чтение и редактирование внутри уже разрешённой задачи выполняются по умолчанию без повторных MCP-окон разрешений. Это не выдаёт веб-странице права запускать программы, менять чужие файлы или переносить данные в другой проект. Обязательные OS/SSO/MFA и серверные ограничения остаются фактическими ограничениями, а не имитируются успешным ответом.

## 2. Владелец и данные

Предлагаемые host DTO; это не обещание готовых методов GigaCode/ACP:

```ts
type DownloadRecord = {
  downloadId: string; operationId: string; requestId: string;
  projectId: string; taskId?: string; sessionId?: string; executorId?: string;
  workspaceId: string; profileId: string; tabId?: string;
  ownerKind: "user" | "agent"; runId?: string;
  initiatingNavigationId?: string; initiatingFrameRef?: string;
  initiatingOrigin?: string; displaySource: string; sourceSecretRef?: string;
  suggestedName: string; safeName: string; storageRef: string;
  state: "queued" | "transferring" | "paused" | "interrupted" |
    "verifying" | "ready" | "failed" | "cancelled" | "reconciling";
  receivedBytes: number; totalBytes?: number;
  canResume: boolean; failureCode?: string;
  httpStatus?: number; declaredMime?: string; detectedKind?: string;
  revision: number; fileId?: string; createdAt: string; updatedAt: string;
};
type ManagedFile = {
  fileId: string; projectId: string; sourceDownloadId: string;
  originalRef: string; workingRef?: string; contentHash: string;
  sizeBytes: number; mime: string; encoding?: string;
  version: number; documentId?: string; artifactId?: string;
  capabilities: { preview: boolean; readRanges: boolean; edit: boolean;
    compare: boolean; export: boolean; reason?: string };
};
```

Actor, project, session, executor и доступ к profile host выводит из доверенной сессии вызова. Модель не назначает себе владельца через строковый `actor`. Имена проекта/вкладки/файла не являются ID. Переключение проекта/задачи/UI не меняет сохранённый target операции. Новая правка, просмотр, экспорт и удаление повторно проверяют право на `fileId`; общая browser identity сама по себе не разрешает чтение файлов всех проектов.

`downloadId` сохраняется при восстановлении той же передачи. Новый осознанный запрос того же URL получает новый ID: один URL не гарантирует один контент. Повтор `requestId` возвращает существующую операцию. `fileId` создаётся после успешной проверки и остаётся стабильным при переименовании/перемещении внутри managed storage. У рабочего документа своя последовательность версий; исходник остаётся неизменным.

Cross-project передача — явная команда с исходным `fileId`, целевым project/task и подтверждённым контекстом назначения. Она создаёт scoped reference/копию и запись происхождения; смена активного проекта или одинаковый URL не являются переносом. Межсессионная координация передаёт reference с проверкой scope, не произвольный абсолютный путь.

## 3. Получение и надёжное завершение

Один DownloadService в main подписывается на `session` каждого BrowserProfile. В `will-download` связать `DownloadItem` с ожидающей browser operation и реальным инициатором, зарегистрировать событие до возврата управления. Не перехватывать native download через новый `fetch`/CLI: иначе теряются origin, cookies, сертификаты и семантика авторизованного POST. Сохранять в выделенный абсолютный `.part` путь через `setSavePath`; это позволяет использовать известную папку без Save dialog. Из API использовать `updated`, `done`, received/total bytes, pause/cancel и фактический `canResume`. [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item).

Для явного URL предпочитать origin-aware путь через исходный webContents, с проверкой разрешённого target; `session.downloadURL` не выполняет проверки происхождения страницы. При восстановлении `createInterruptedDownload` не предоставляет webContents: owner/tab/profile берутся только из сохранённой записи, а не из текущей активной вкладки. Связанные секретные URL хранить отдельно от публичных метаданных. [Electron Session](https://www.electronjs.org/docs/latest/api/session).

Конкретная корреляция download event с operation обязана быть доказана тестами iframe, redirects и параллельных запросов. Один только URL, время или активная вкладка недостаточны. Использовать trusted tab registry + frame/navigation + download intent; неоднозначное unsolicited событие не приписывать агенту автоматически. В текущем закреплённом Electron 44.7.0 доступны новые сведения инициатора; при изменении версии проверить capabilities, не рассчитывать молча на latest API.

Порядок завершения:

1. Зарезервировать storage directory и имя без перезаписи существующих файлов; записать durable intent/receipt.
2. Передавать bytes на диск средствами download engine; progress events коалесцировать, terminal events не терять. Не хранить полный файл в renderer, IPC или model context.
3. `done:completed` означает окончание транспорта. Перевести в `verifying`, проверить доступность/размер, bounded type detection, контракт ожидаемого ответа; потоково посчитать hash. Проверка scanner отдельна и возможна только при реальной capability. Sprut для уязвимых версий библиотек не объявлять файловым антивирусом.
4. Подготовить оригинал в managed directory, затем атомарно переименовать `.part` на том же volume с запретом overwrite. После durable file/metadata commit опубликовать `ready` + `fileId`. Если ОС/файловая система не обеспечивает выбранную атомарность, использовать recoverable journal; не объявлять гарантию без проверки.
5. После crash сверить журнал, `.part`, final file, размер и hash. Доделать незавершённую регистрацию, а не скачивать второй раз. Отсутствующий файл имеет понятное состояние и путь восстановления, не зелёную запись.

Безопасное имя формируется из basename, а не серверного пути. Удалять separators/control characters; отклонять traversal, drive/UNC/ADS, Windows reserved device names, trailing dot/space и слишком длинный путь. Сопоставлять Windows collision без учёта регистра, учитывать занятый родительский файл и reparse/symlink escape; оригинальный предложенный заголовок показывать только как текст. При коллизии выделять новую уникальную копию, никогда не overwrite по заголовку сервера.

### Пауза, resume, retry и отмена

При ошибке сначала сверить receipt/state, затем выбрать доступную команду. Не повторять кнопку создания отчёта, POST или одноразовый signed link после неизвестного исхода. `cancel` отменяет передачу, но не отменяет уже созданный на сервере отчёт. Закрытие browser pane или переключение проекта передачу не отменяет. Закрытие исходной вкладки не должно терять owner уже начатой загрузки.

Resume включается только при фактической поддержке. Electron указывает, что для продолжения нужны range и оба валидатора `Last-Modified`/`ETag`; иначе `resume()` может начать скачивание заново. Это показывается как «Скачать заново», а не скрытое продолжение. Сохранить validators/offset/ожидаемую длину и доступный источник в private metadata, после restart сверить их перед восстановлением. [Electron resume](https://www.electronjs.org/docs/latest/api/download-item#downloaditemresume).

Для собственного streaming adapter `206` и `Content-Range` проверяются против offset/total/validator; ответ `200` на Range не дописывать к `.part`. Смена ETag, `416` и истёкшая авторизация требуют reconciliation, не склеивания разных версий. `If-Range` позволяет отличить тот же ресурс от полного нового ответа. [MDN: range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

Transient retry имеет лимит, backoff/jitter и уважает Retry-After, когда статус достоверно получен. Auth/denied/unsupported/content mismatch не лечатся циклом retry. Отмена сохраняет terminal receipt до очистки `.part`; явное «Удалить» отличается от «Убрать из списка». Cleanup не удаляет открытый dirty document, закреплённый материал или единственную версию результата.

## 4. HTML-ошибки, форматы и безопасный просмотр

Имя `.xlsx` и MIME `application/octet-stream` не доказывают тип. Сверять заявленный тип, signature, bounded content inspection и ожидаемый формат; generic MIME допустим после проверки контента. ZIP signature сама по себе не доказывает DOCX/XLSX: проверить структуру контейнера без бесконтрольной распаковки. DownloadItem не предоставляет универсального поля HTTP status: получать доступный status/headers через существующий Network broker, коррелируя requestId/frame/tab/navigation. `webRequest.onHeadersReceived` содержит statusCode и headers; не устанавливать второй конфликтующий listener мимо broker. [Electron WebRequest](https://www.electronjs.org/docs/latest/api/web-request).

`400/401/403/413/429/5xx`, HTML login с `200`, proxy error и неожиданный redirect не становятся успешным документом. Показывать краткую причину, статус когда известен, sanitised origin и ограниченный plain-text excerpt; сохранять диагностическое тело отдельно с лимитом и redaction. Не исполнять HTML ошибки. Когда HTTP status неизвестен, писать «Статус ответа недоступен», а не выдумывать 200; заявлять только проверенные bytes/type. Легитимное скачивание HTML разрешено как текст/изолированный preview, не блокируется только по расширению.

Viewer работает в отделённом origin/partition без app preload, Node API и браузерной авторизации. По умолчанию — без внешней сети, автоматической навигации, форм, popup, скриптов, макросов, launch action и доступа к соседним файлам. HTML/SVG сначала как текст либо санитизированный/raster preview; выполнение интерактивного artifact — отдельный явно обозначенный режим и capability. URL/файловые ссылки проверяет host. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

| Формат | Просмотр и адресное чтение | Редактирование и проверка |
|---|---|---|
| UTF-текст, код, JSON/YAML/XML, Markdown, SQL | Подсветка; строки/диапазоны, поиск с лимитами; явная кодировка и перевод строк | Общий DocumentService + IDE; diff, version/CAS, формат/синтаксис, сохранение копии |
| CSV/TSV | Виртуальная таблица, схема/encoding/delimiter, выборка; без полного parse в renderer | Data adapter: staged cell/row changes, streaming export, row-level conflicts; original preserved |
| PDF | Страницы, text extraction/OCR по capability, page images для vision, поиск | Annotation/page operations или conversion только если поддержаны; не обещать произвольный lossless layout-edit |
| DOCX/XLSX | Документ/лист через зарегистрированный adapter; paginated/region reads | Format-aware adapter с объявленной поддержкой структуры; новая версия + повторное открытие/рендер. При потере формул/стилей/макросов не тихая конверсия |
| PNG/JPEG/WebP, SVG | Размеры/metadata, thumbnails/tiles; SVG без скриптов | Image adapter: операции по capability; SVG source в IDE. Vision чтение не равно наличию image-edit tool |
| Архив/прочий binary | Metadata и безопасный список entries при поддержке | Нет hex/text-правок под видом универсального редактора. Ограниченная распаковка в новую папку, traversal/symlink/expansion limits; внешнее приложение только отдельным действием |

Capability возвращает provider/version, операции, ограничения размера/формата, supported export и причину unavailable. UI не показывает «Редактирование выполнено», если создан только текстовый пересказ PDF. Модель без vision получает extract/structure, а не обещание визуальной проверки. Сохранённый файл повторно открывается adapter-ом; semantic/visual checks привязаны к конкретному hash/version.

## 5. Редактирование, наблюдение и управление

Первое редактирование создаёт рабочую копию исходника и `documentId`; для текста один DocumentService обслуживает браузерный viewer, IDE, агентские edits и все окна. `applyEdits` содержит `expectedVersion`, `clientEditId`, ranges и изменения; Save — базовый disk hash/mtime и новую version. Переключение активной IDE-вкладки не меняет адресуемый файл. Повтор requestId возвращает receipt прежнего результата.

User и agent не держат конкурирующие независимые buffers. Короткая edit lease закрепляет исполнителя за documentId; takeover увеличивает revision и отменяет новые agent edits. In-flight эффект сверяется. Одного lease недостаточно: внешнее изменение/несохранённый пользовательский текст вызывает CAS/conflict с diff/сохранением обеих версий. Merge требует актуальной базы; переход UI и простой read не перехватывают lease. Для binary adapter действует такой же version guard на весь документ.

`Save` сохраняет рабочую версию. `Save as`/«В проект» проверяет destination scope/collision и сохраняет source link; `Export` создаёт файл выбранного формата и receipt. Исходная загрузка сохраняется до явного удаления в рамках retention policy. Undo/restore относится к версии материала и не повторяет скачивание. Настройки задают download directory, лимит места/retention, auto-preview, adapter preferences и правила хранения личного/агентского пространства; credentials остаются в профильном vault.

Видимый прогресс содержит реальные этапы/bytes/rows/pages и автора, а не мысли модели. Логи: operationId, ownership, timestamps, state transitions, errors, file versions/hash, adapter и validation evidence. Не логировать cookies, authorization, passwords, подписанные URL, сырые тела документов или полный prompt. URL query/fragment по умолчанию скрыты; сырой URL при необходимости для resume хранится в private encrypted record с ограниченным сроком, не в общем JSON/экспорте.

## 6. Общие команды UI и агента

Имена ниже — предлагаемые narrow tools поверх существующих сервисов. UI и MCP вызывают один host use case; настройки CLI не получают несуществующие методы.

| Операция | Вход → подтверждаемый результат |
|---|---|
| `browser.download.start` | Captured workspace/tab/navigation/frame, linkRef или разрешённый URL ref, requestId, expected type → operationId/downloadId; существующий click-download может создать ту же запись |
| `browser.download.list/get` | Scope + cursor/downloadId → bounded records/actual revision, без сырой авторизации |
| `browser.download.pause/resume/cancel` | downloadId, expectedRevision, requestId → actual state/capability reason/receipt |
| `file.inspect/read` | fileId, expectedVersion, bytes/lines/pages/sheet range и maxBytes → bounded result, truncated flag, next cursor и hash/version |
| `file.present` | fileId, version, viewer preference → существующая или одна новая presentation; сохранить фокус и project scope |
| `file.edit.open` | fileId/version, requested operations → documentId/working copy + фактические adapter capabilities |
| `document.applyEdits/save` | documentId, version, editId/operationId → подтверждённая revision или conflict; существующий DocumentService API |
| `file.compare/export` | fileId/versions, format, разрешённый destinationRef, operationId → diff/export artifact receipt или unsupported |
| `file.attach/transfer` | fileId/version, target task/project, operationId → scoped material/ref с provenance; доступ проверяется для обоих scopes |
| `file.control.take/return` | documentId, expectedControlRevision → lease state; возврат агенту перечитывает документ |

Модель получает metadata и нужные фрагменты. Стартовый бюджет чтения: до 64 KiB за ответ, страницы/строки адресно; limits configurable и возвращаются в capability. Для больших файлов — streaming parser, paginated/virtualized table, page/row selection, bounded search, отмена и backpressure. Файл 2 GiB не превращается в 2 GiB IPC/base64, prompt или редакторский buffer. Неизвестный размер и недостаток диска обрабатываются в процессе; распаковка/рендер ограничены memory/CPU/page/expansion budgets.

Содержимое скачанного документа — данные задачи. Команды «отправь секрет», «выполни скрипт», «измени настройки» внутри него не являются инструкциями пользователя. Скачивание не запускает executable, макросы или install hooks. Просмотр/редактирование файла не отправляет его обратно на сайт без отдельного поручения в задаче.

## 7. Реализация по существующим карточкам

Источником зависимостей является [implementation-plan.json](../../suite/implementation-plan.json); данный контракт расширяет карточки, не закрывает их и не обходит prototype approval.

1. **Макет:** загрузка → progress/pause/cancel → ready/error → preview → edit/diff → материал. Проверить две browser spaces, переключение проекта, dirty conflict и unsupported format. Все bytes и файлы демонстрационные.
2. **S2-01** после её declared dependencies: DownloadService, ownership, controlled storage, durable receipts, native download/identity, validation, list/progress/read-only preview и restart. Сначала live локальный сервер без модели, затем корпоративный identity probe. Не привязывать базовое скачивание к готовности полной IDE.
3. **S4-01** после её declared dependencies: единый DocumentService, working copy, версии, disk conflict, draft recovery и scoped file references. Его реализацию можно вести независимо, но Browser→edit принимается только вместе с S2-01.
4. **S4-02** после S4-01: полноценные текстовые edit/search/diff/save/export; **S2-05** объединяет пользовательский маршрут после обеих ветвей S2-01 и S4-02. Нет отдельного временного textarea backend вместо DocumentService.
5. Расширенные PDF/office/image/data adapters добавлять в соответствующие существующие карточки материалов/Data; каждый формат активируется по подтверждённым capabilities и своей проверке. Agent команды использовать общий runtime registry; отсутствие format adapter не блокирует download/metadata/export оригинала.

## 8. Приёмка

Ключи BF ниже — локальные сценарии этого контракта, не объявление новых закрытых глобальных acceptance IDs. Evidence разделять на prototype fixture, contract/unit, live Electron и packaged Windows/ВАРМ.

| Сценарий | Что должно быть доказано |
|---|---|
| BF-01 Ownership | Два проекта, user/agent profiles и два исполнителя скачивают одно имя; bytes/receipts/файлы доступны только правильным scopes. Общая identity не смешивает файлы |
| BF-02 Identity | Авторизованный redirect/POST/download из iframe использует исходный профиль/инициатор. Cookies/сертификат не копируются в отдельный fetch, signed URL не попадает в лог |
| BF-03 Жизненный цикл | Hide/move/project switch/закрытие исходного tab не отменяет начатую загрузку и не меняет личную вкладку. Pause/resume/cancel отражают реальные состояния |
| BF-04 Восстановление | Потерянный start/save response, crash до/после rename, restart без WebContents: одна операция, reconciliation, нет повторного POST и ложного ready |
| BF-05 Range | Успешный 206, нет range, смена ETag, 200 вместо 206, 416, истёкший signed URL: нет склейки/тихой потери bytes; restart обозначен |
| BF-06 Имена/диск | `../`, UNC, ADS, CON, case collision, одинаковые имена параллельно, reparse escape, file-as-parent, длинный Windows path, ENOSPC, locked file: нет overwrite/escape |
| BF-07 Ответ | HTML400/413/429/500, HTML200 login, redirect loop, корректный octet-stream PDF, поддельный XLSX: тип/ошибка честные; HTML не исполняется |
| BF-08 Preview | PDF/image/text/CSV поддерживаются только реальным adapter; SVG/HTML script, archive bomb/path, unsupported binary не получает app IPC, сеть или запуск |
| BF-09 Большие данные | 2 GiB streaming fixture и неизвестный размер: UI отзывчив; peak memory bounded относительно chunk/cache, отмена работает; model/IPC payload остаётся в лимите |
| BF-10 Правки | Агент редактирует рабочую копию, пользователь видит diff; исходник неизменён. Dirty buffer, external write, takeover, повтор save и два окна дают version conflict вместо overwrite |
| BF-11 Материал | Attach, Save as, экспорт и повторное открытие используют один fileId/version; cross-project перенос явный; stale dialog не сохраняет в новый активный проект |
| BF-12 Секреты | Канарейки cookies/auth/query/документа не обнаруживаются в обычных логах, renderer state dump, export metadata, agent replies; проверяется private storage boundary |
| BF-13 Доступность | Keyboard/Esc/focus return, 360/768/1280, две темы, несколько панелей, пользователь печатает во время progress: нет focus steal, overflow или popup на каждый разрешённый вызов |
| BF-14 Честная готовность | Transport completed не равно ready до verification; scanner unavailable не равно clean; unsupported format не равно edited; evidence ссылается на hash/version |

Сначала испытать локальный HTTP fixture со статусами, auth, redirect, Range, большим потоковым телом и повреждёнными форматами. Затем live Electron file lifecycle и Windows filesystem/certificate/ВАРМ. Только успешное прохождение этих уровней позволяет заявить работающий маршрут; один макет или ответ агента этого не доказывает.

## Ограничения текущего макета

Внешняя сеть и native DownloadService ещё не подключены. Файлы здесь — явно обозначенные локальные примеры: текст можно просмотреть/изменить и экспортировать, PDF показывает только метаданные, 2 ГБ — ограниченный фрагмент без больших аллокаций. Передача в IDE создаёт независимую копию, повторное открытие её же версии не затирает правки; единый DocumentService будет реализован в S4-01/S2-05. Поручение в чате допускается только в исходном разговоре; явный перенос доступа в иной разговор относится к runtime. Прямые действия агента с реальными скачанными файлами этим HTML не подтверждены.
