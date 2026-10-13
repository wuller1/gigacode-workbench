# Browser Lab

Статус 13.10.2026: целевой контракт после согласования полного макета. Демонстрационные cookies, пароли и сетевые запросы в `design/` не являются доступом к настоящему браузерному профилю. Расширения ниже не объявляются реализованными в `app/`.

## Основа

Разделение личного браузера и браузера агента обязательно: [SEPARATE-AGENT-BROWSER](SEPARATE-AGENT-BROWSER.md). Это отдельные пространства вкладок и управления поверх одного BrowserService. Показ агентской панели не меняет личные вкладки, адрес и клавиатурный фокус. Закрытие панели не останавливает выполнение.

Расширять существующий `app/electron/browser.ts` и `BrowserPanel`. Уже работающие `WebContentsView`, project partitions, session ownership, bounds, tabs, navigation, inspect/click/fill, screenshots и viewport controls остаются одним владельцем. Не добавлять Playwright/WebView рядом как второй браузер без отдельного adapter use case.

## Пользовательский интерфейс

Browser workspace состоит из:

- navigator: browser profiles, tab groups, saved test recipes и captures;
- document tabs: настоящие browser tabs с favicon/title/loading/error;
- toolbar: back/forward/reload/stop, address, star bookmark, profile/identity, viewport, zoom, external open, capture, `…`;
- optional split: страница + DevTools surface;
- bottom tabs: Console, Network, Problems, Recorder;
- inspector: selected DOM node, request, console item или capture metadata.

Address bar принимает URL или поисковый запрос только при явно выбранном search provider. TLS/certificate/permission status виден рядом с адресом. Browser errors отображаются в surface и не превращаются в пустой белый экран.

В меню `…` находятся «Инструменты разработчика», «Закладки», «Пароли», «Данные сайта», история и загрузки. Частые действия не требуют перехода в общие настройки. Звезда у адреса добавляет текущую страницу либо открывает редактирование существующей закладки; её состояние следует за фактическими URL и профилем. Клавиатурные действия: `Ctrl+L`, `Ctrl+D`, `Ctrl+Shift+B`, `Ctrl+Shift+Delete`, `F12`; на macOS применять соответствующий Command modifier. Все меню и диалоги закрываются Esc и видимой кнопкой, возвращая фокус инициатору. На узкой панели вторичные команды уходят в `…`, адрес и управление вкладками остаются доступными.

## Browser profiles и корпоративная identity

Ввести `BrowserProfile`:

```ts
type BrowserProfile = {
  id: string;
  name: string;
  engine: "electron" | "external-connector";
  partition?: string;
  persistent: boolean;
  proxyRef?: string;
  certificatePolicy: "system-prompt" | "remember-host-choice" | "external";
  permissionPolicyId: string;
  credentialVaultRef?: string;
};
```

Проект связывается с `profileId`; имя профиля не является ключом partition. Общий профиль можно привязать к нескольким проектам, изолированный профиль — только к одному. Переключение проекта не создаёт новый профиль и не переносит cookies. По умолчанию операции агента внутри настроенного профиля выполняются без повторных окон разрешений; решения для web permissions хранятся в одной политике с origin/capability scope. Системные запросы ОС или обязательный выбор корпоративной identity не имитировать и не скрывать. Настройки приложения и панель браузера редактируют одни записи.

`electron` использует persistent project/profile partition, системное доверенное хранилище сертификатов и Electron certificate events. Никогда не отключать TLS verification. При `select-client-certificate` показать hostname, issuer/subject/expiry и запомнить только fingerprint выбора для host/profile; private key не извлекается.

Доступ к существующим cookies/сертификатам другого браузера нельзя обещать через копирование его профиля. Для корпоративной identity предусмотреть `external-connector`: Edge/Chrome extension + native messaging или подтверждённый корпоративный browser MCP, который управляет уже авторизованной вкладкой. Adapter возвращает capabilities (`readDom`, `act`, `capture`, `network`, `certIdentity`) и сохраняет browser/tab ID. Запуск отдельного Chrome с remote debugging не выдавать за доступ к обычному профилю; современный Chrome может требовать отдельный user-data-dir.

## Tab и navigation identity

Каждая вкладка имеет `tabId`, `profileId`, `projectId`, optional `taskId/sessionId`, `navigationId`, `documentRevision`, `createdAt`, `lastActiveAt`. Любая automation команда содержит ожидаемые `navigationId` и `documentRevision`; stale target отклоняется и возвращает новый snapshot.

При redirect/new window/download/backend navigation обновлять revision и отправлять адресное event. `window.open` по политике открывает новую управляемую вкладку или блокируется с понятным action; remote page никогда не получает preload приложения.

### Первый обязательный regression slice

Наблюдавшаяся проблема «другое окно создаёт лишние вкладки, активная вкладка теряется и открывается первая» закрывается до расширения DevTools. Инварианты:

- main отправляет tab event только owner window или явному subscriber;
- backend проверяет owner для **каждой** tab operation, а не только bounds/activate;
- state хранит стабильный `orderedTabIds` и `activeTabId` отдельно для `window + project + group`;
- обычный title/loading event не меняет active и порядок;
- явные create/activate/reuse становятся active и renderer принимает эту server revision;
- старый async list response не перезаписывает более новый event/snapshot;
- hide/show, drag, maximize, modal, workspace/project switch не меняют active;
- закрытие фоновой вкладки не меняет active; закрытие active выбирает правую соседнюю, затем левую;
- `requestId` дедуплицирует неизвестный исход create; `reuseKey` переиспользует один artifact preview;
- transfer между окнами переносит ownership, ordered state и dedupe keys атомарно;
- после restart persisted metadata восстанавливается без обещания восстановить неподтверждённый живой процесс.

Тестовая матрица: два окна одного проекта, два проекта в одном окне, фоновые navigation events, artifact open дважды, потерянный create response, transfer, close каждого положения, out-of-order refresh, panel hide/move/maximize и живой Electron сценарий без промежуточного click/reload. Mock service test является только первым уровнем; критерий `BRW-08` закрывается отдельным packaged Windows run.

## DevTools surfaces

Использовать `webContents.debugger`/Chrome DevTools Protocol как internal adapter, а не давать renderer произвольный CDP.

Для полноценного ручного дебага открыть настоящие Chromium DevTools выбранной вкладки: `openDevTools`, `closeDevTools`, `inspectElement`. Встроенная панель через `setDevToolsWebContents` получает собственный `WebContentsView`, который владелец создаёт и уничтожает отдельно. Пользователь выбирает док справа/снизу или отдельное окно; раскладка и ширина запоминаются. Там доступны Sources с breakpoints/step/watch, Elements, Console, Network, Application и Performance в пределах версии Chromium. Наши компактные Console/Network остаются быстрым представлением тех же событий, а не заменой полного дебаггера. [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents/).

Один `BrowserDebugBroker` владеет CDP на `tabId`: opening/attached/detached/recovering, причины завершения и bounded command queue. Electron документирует отсоединение `webContents.debugger` при открытии DevTools. Поэтому перед ручным дебагом агент заканчивает безопасный текущий шаг и отображает «Управление у пользователя»; после закрытия DevTools broker повторно подключается, восстанавливает подписки и запрашивает свежую revision. Не запускать конкурентные attach/retry циклы и не повторять команды изменения страницы после неизвестного исхода. Одновременное управление допускается лишь после отдельного live доказательства поддержки в используемой версии. [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger).

### Console

- structured level/source/text/timestamp/stack/repeat count;
- group/collapse, filter, preserve log option;
- evaluation только по явному действию и с пометкой page context;
- object previews ограничены по depth/size.

### Network

- request/response summary, timing, status, initiator, mime, transfer size;
- filters и waterfall;
- sanitized headers/body preview с redaction и size limits;
- preserve log, HAR export с review/redaction;
- resend/edit request считается внешним действием и требует review.

### Elements/accessibility

- DOM/AX tree snapshot, stable backend/node references в пределах navigation revision;
- hover/highlight, selector copy, computed box/accessible name/role;
- редактирование DOM только как временный page action, не как изменение source;
- cross-origin iframe явно показывает границу доступности.

### Sources и performance

В собственном компактном inspector начать с loaded resources, source preview, errors и performance markers; полный дебаг предоставляют встроенные DevTools выше. Trace recipe может сохранить navigation timings, console errors, failed requests, layout shifts и screenshots. Breakpoint pause не считается зависанием браузера: отображать paused, источник и действие продолжения; таймауты агента не должны перезагружать страницу за пользователя.

## Cookies, кэш и данные сайтов

«Данные сайта» открывает текущий профиль и домен, показывает cookies (name/domain/path/expires/SameSite/Secure/HttpOnly), site storage и размер кэша при доступной оценке. Значения auth cookies скрыты в общем списке и исключены из агентского snapshot. Действия: удалить отдельную cookie, cookies сайта, данные сайта, HTTP-кэш профиля или выбранные категории всего профиля. Область и последствия выводятся в том же диалоге до действия; второго модального подтверждения не нужно. Пароли и закладки не включаются в обычную очистку cookies/кэша.

API для runtime: `session.cookies.get/remove/changed/flushStore` обслуживают cookie manager; идентификатор строки включает domain/path/name и partition key, если он поддержан. После удаления перечитать cookies: ограничения адаптера не должны удалять одноимённые записи за пределами выбранного target. [Electron Cookies](https://www.electronjs.org/docs/latest/api/cookies).

`getCacheSize`/`clearCache` работают с HTTP-кэшем сессии; `clearStorageData` — с указанными storage; `clearData({dataTypes, origins})` поддерживает более полную очистку. Важно: cookies через `clearData` с origin удаляются на уровне registrable domain, включая его поддомены. UI явно показывает эту область. HTTP-кэш профиля нельзя подписывать «кэш только текущей вкладки». Поддержку конкретных опций сверять с закреплённой версией, без молчаливого fallback на очистку всех профилей. [Electron 44.7.0 Session](https://github.com/electron/electron/blob/v44.7.0/docs/api/session.md).

Наш контракт `ClearBrowserDataRequest` фиксирует `requestId`, `profileId`, `origin?`, категории, рассчитанную область и revision до выполнения. Переключение вкладки или проекта не меняет эту цель. Результат содержит completed/failed по категориям; при частичной ошибке не писать «Всё очищено». Не показывать фиктивный выбор «за час», пока adapter не умеет корректно фильтровать каждую выбранную категорию по времени. Активная страница может немедленно создать cookies заново — это показывается как новое событие, а не отмена очистки. Service worker и Cache Storage управляются отдельно от HTTP-кэша.

## Пароли и автозаполнение

Реализовать собственный `BrowserCredentialService` поверх системного шифрования. Наличие Chromium в Electron само по себе не является контрактом на Chrome Password Manager, Google Sync или чтение паролей установленного Edge. Для внешнего браузера использовать его подтверждённый connector и его password UX; не извлекать его vault.

В продукте нужны: сохранить после ввода, обновить существующую запись, несколько логинов сайта, поиск, добавить вручную, изменить, удалить, «не предлагать для сайта» и включение автозаполнения. Небольшая карточка у адреса предлагает «Сохранить / Сейчас нет / Никогда» один раз для кандидата входа; событие submit само по себе не объявлять успешной авторизацией. В макете используются только демонстрационные записи, без ввода и сохранения настоящего секрета.

Vault хранит `credentialId`, `profileId`, точный HTTPS origin, login metadata, ciphertext, timestamps, revision и режим автозаполнения. Использовать main-process `safeStorage.isAsyncEncryptionAvailable/encryptStringAsync/decryptStringAsync`; API сверено с закреплённым Electron 44.7.0. Windows DPAPI защищает данные от другого пользователя, но не гарантирует изоляцию от процессов того же пользователя. Недоступное шифрование и небезопасный fallback не заменять plaintext-сохранением. [Electron 44.7.0 safeStorage](https://github.com/electron/electron/blob/v44.7.0/docs/api/safe-storage.md).

Автозаполнение проверяет profile, origin, frame origin, navigation revision и ожидаемое поле непосредственно перед вставкой. Cross-origin iframe, смена origin, HTTP-страница или неоднозначные логины не получают автоматическую подстановку. Локальные тестовые HTTP endpoints требуют отдельной явной настройки профиля, не ослабления всех сайтов. Form helper допускает только ограниченный credential IPC с проверкой sender/frame; удалённая страница не получает `decrypt`, произвольный IPC или доступ к файлам. Сам секрет неизбежно доступен сайту при заполнении — не обещать защиту от самого целевого сайта.

Agent API получает `credentialRef` и результат `filled/needs-user-input/stale/unavailable`; пароль не возвращается модели. Логи, trace/HAR, screenshots чувствительных форм, DOM values, clipboard diagnostics, crash attachments, синхронизация проекта и экспорт пакета не содержат секрет. Поля password очищаются при закрытии карточки; renderer не хранит их в localStorage. Автоматическая отправка формы отделена от заполнения. Для Basic/Proxy auth использовать отдельный origin/realm record, для client certificate — fingerprint; не смешивать эти identity.

## Закладки, история и восстановление

Закладки — собственные записи `bookmarkId/profileId/folderId/title/url/order/revision`, с необязательной привязкой к проекту. Общая папка доступна между проектами; учётные данные и cookies с ней не передаются. Поддержать папки, поиск, rename/edit/delete, drag ordering, закреплённую панель и импорт/экспорт стандартного HTML-файла закладок. Импорт сначала даёт preview количества, дубликатов и отклонённых адресов; HTML разбирается как данные без выполнения. Разрешить обычные http/https URL, остальные схемы проходят явную продуктовую политику; `javascript:` не запускается.

**Панель закладок** располагается сразу под адресной строкой и видна по умолчанию. Одна компактная строка: быстрые ссылки, папки с выпадающим списком и `»` для элементов, которые не поместились по ширине. Широкое название сокращается, полный адрес и название доступны по наведению; панель не переносит ссылки на несколько строк и не сужает адресное поле. Из меню панели доступны добавление текущей страницы, управление и скрытие; возврат — через меню браузера либо `Ctrl/Cmd+Shift+B`. Видимость сохраняется, размер пересчитывается при перетаскивании/resize панели. Меню доступны с клавиатуры и закрываются Escape/кликом снаружи.

В личном и агентском браузерах один компонент панели использует разные bookmark stores. Просмотр агентского браузера не импортирует личные закладки. Переход по закладке в агентском surface доступен после передачи управления пользователю; наблюдение не меняет running target. При смене проекта/владельца открытое меню закрывается, устаревшие действия не применяются к новому scope. Редактирование через менеджер или звезду сразу отражается в панели; второго несвязанного списка нет. В текущем макете папка «Рабочие» выводится быстрыми ссылками, остальные папки — выпадающими группами; production-модель использует устойчивый root folder ID, не локализованное имя.

Открытие закладки использует текущую вкладку; отдельная команда и middle-click — новую. Если пользователь выбирает уже открытую страницу того же профиля из поиска вкладок, активировать её, не создавать копию. Query/fragment сохранять, поскольку это может быть часть маршрута приложения. Название закладки не меняется от фонового title event сайта без явного обновления.

История содержит URL/title/time/profile, поиск, удаление и повторное открытие; данные приватного профиля не попадают в постоянную историю. «Вернуть закрытую вкладку» сохраняет URL, профиль и порядок, но не обещает восстановить неотправленную форму или POST. Закладки и история не используются как способ переносить SSO между профилями.

## Automation contract

Команды высокого уровня:

- `browser.snapshot` — URL/title/navigation/viewport + bounded AX/DOM summary;
- `browser.query` — найти элементы по role/name/text/test id/CSS в указанном frame;
- `browser.action` — click/fill/select/check/key/scroll/hover/upload с element ref и revision;
- `browser.wait` — navigation, element, text, network idle с timeout;
- `browser.capture` — viewport/full page/element с metadata;
- `browser.recipe.run` — шаги с per-step evidence, stop-on-failure и cancel;
- `browser.console.list`, `browser.network.list`, `browser.trace.start/stop`.

Возвращать компактный типизированный результат. Не отправлять модели весь DOM, screenshot base64, HAR или console buffer. Большие данные сохраняются artifact/evidence и читаются адресно.

Uploads, downloads, clipboard, geolocation, notifications, camera/microphone и auth prompts имеют отдельные policies. Agent action не наследует разрешение, данное пользователем другой вкладке/задаче.

## Responsive и визуальная проверка

Viewport controls задают CSS width/height, orientation, zoom, optional DPR/mobile/touch/UA только при подтверждённой capability. Всегда показывать requested и actual. Presets: responsive, phone 390 × 844, tablet 768 × 1024, desktop 1280 × 800; пользовательские 240–3840.

Capture metadata: build/ref, tab/navigation, URL, viewport/DPR/zoom/theme, timestamp, task/session, recipe step. Визуальное сравнение хранит baseline отдельно, показывает overlay/diff и не принимает любое pixel difference за дефект.

## Downloads и файлы

Полный маршрут агента **скачать → просмотреть → отредактировать → проверить → выдать материал** описан в [BROWSER-FILES.md](BROWSER-FILES.md): ownership, native download, resume/recovery, HTML-ошибки, большие файлы, форматы, версии и приёмка. Download manager показывает имя, источник, инициатора, размер/progress, destination, hash и scan только при реальной capability. Sprut для уязвимостей библиотек не объявляется файловым антивирусом.

По умолчанию сохранять в controlled download directory без повторных окон разрешений в разрешённой задаче. Просмотр не перехватывает личный браузер; текст редактируется рабочей копией через общий DocumentService IDE с diff/conflicts, исходник сохраняется. PDF/office/image adapters явно сообщают возможности редактирования; unsupported не выдаётся за успех. Перенос в проект/другой проект — отдельная scoped operation. Не открывать исполняемые файлы автоматически. Настоящий маршрут принимается по S2-01 вместе с S4-01/S4-02, а базовое скачивание не ждёт полной IDE.

## Этапы

Источником порядка остаётся `suite/implementation-plan.json`. Ниже — расширение содержания существующих карточек, а не параллельный план или изменение их статуса. До общего prototype approval разрешены только макет и проверки его интеракций.

1. **S2-00** после S0-01: сначала подтвердить ownership вкладок, active state и отсутствие дублей в живом Windows/Electron сценарии. Текущее `implemented_pending_live` не равно принятому результату.
2. **S2-01** после S2-00 и S1-02: profiles/identity, downloads/permissions, persistent bookmarks/history; затем cookie/storage cleanup и отдельный OS-encrypted vault с autofill. Все эти срезы используют один профильный registry и один BrowserPanel. В конце — реальные корпоративные certificate/SSO checks; external connector включать по фактическим capabilities.
3. **S2-02** после S2-01: debug broker, встроенные DevTools и компактные Console/Network, AX/DOM refs, typed actions/waits/screenshots. Проверить переход agent → manual debugging → agent без потери вкладки и повторного внешнего действия.
4. **S2-03** после S2-02: recipes, trace review, HAR redaction и повторяемая диагностика, связанная с задачей и build.
5. **S8-09**, только после её остальных зависимостей: общие команды агента для закладок, выбранных browser data и diagnostics. Credential fill передаёт лишь reference. Нельзя закрывать эту карточку на основании только Browser.

## Проверки

- две project partitions не видят cookies/local storage друг друга;
- remote page не вызывает app IPC и не читает filesystem;
- redirect между query и action вызывает stale target, а не click на новый документ;
- browser view корректно hide/move/maximize/close и не остаётся поверх modal;
- console/network buffers имеют limits и redaction;
- certificate choice проверен на Windows test endpoint без экспорта private key;
- download cancel/restart и filename collision не перезаписывают файл;
- recipe на реальном приложении находит дефект, capture связан с точным build и повтор после исправления проходит;
- external connector подтверждает фактическую identity/capabilities, а не только открытие страницы.

Дополнительная приёмка полноценного браузера:

- DevTools ставит breakpoint на локальном fixture-приложении, показывает scope/stack, делает step/resume; Network/Console относятся к выбранной вкладке, а закрытие DevTools восстанавливает агентский broker;
- очистка только HTTP-кэша не удаляет cookies, пароль и закладки; очистка сайта отражает точную domain scope; соседний изолированный профиль остаётся нетронутым;
- удалить cookie с одинаковым именем и разными path/domain; сверить фактический остаток, частичную ошибку и повторный cookie от открытой страницы;
- открыть диалог очистки, переключить проект, выполнить — target остаётся первоначальным и видимым; повтор requestId не запускает вторую очистку;
- пароль сохраняется после restart Windows, обновляется без дубля, не читается другим профилем; unavailable vault, неверный origin, iframe и navigation race дают честный отказ заполнения;
- поиск секрета-канарейки в renderer storage, logs, trace/HAR, screenshots, project export и агентском ответе не находит совпадений; настоящий секрет в fixture не использовать;
- закладки add/edit/delete/folders/import/export работают после restart и между связанными проектами; malformed HTML и опасные URL отклоняются; повторное открытие существующей вкладки не создаёт лишнюю;
- ширины 360/768/1280, светлая/тёмная тема, клавиатура/Esc/возврат фокуса, перенос/сворачивание панели не меняют active tab или выбранный профиль;
- browser prototype проверки отдельно маркируются fixture; критерии vault/CDP/certificates принимаются только на настоящем Electron, целевая ОС — Windows.
