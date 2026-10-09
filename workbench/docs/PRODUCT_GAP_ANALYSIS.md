# Пробелы продукта на полном пользовательском пути

Дата анализа: **2026-10-10**. Это аудит **спецификации**, а не исходников или работающей Windows-сборки пользователя. Ни один пункт ниже не объявлен реализованным или протестированным. Цель — закрыть несколько стыков между уже выбранными функциями, не увеличить каталог возможностей и не отложить D2 до идеального продукта.

Прочитаны текущие контракты Task/панелей, chat-first UI, материалов/вопросов, adaptive todo, lifecycle, observability, runtime bundle, контекста и native migration. Основные сценарии уже описаны значительно лучше, чем пограничные переходы. Главный оставшийся риск — две отдельно корректные подсистемы по-разному понимают «сохранено», «возобновлено», «готово» или «эта задача».

## Как читать выводы

- **solved** — решение достаточно описано; нужен адресный target test, а не новая архитектура. Это не означает implemented/pass.
- **specification_needs_detail** — основа есть; ниже добавляется конкретная семантика или плохой случай.
- **missing_chosen** — отдельный нужный переход не найден в прочитанном корпусе; выбран маленький способ его закрыть.
- **deferred_external** — полезный более широкий сценарий намеренно отложен из-за scope, внешней зависимости или неизвестного CLI API.

Названия owner ниже обозначают ответственность существующего host, не обязательные новые классы/процессы. M/D — уже принятые [этапы разработки](GIGACODE_UI_DEVELOPMENT_PLAN.md) и [поставки](DELIVERY_AND_DOGFOOD_PLAN.md). У каждого пункта есть действие **include/defer** и конкретный negative acceptance; это очередь маленьких изменений по найденному пробелу прототипа, не новый обязательный workflow.

## Пять проверенных маршрутов и что в них уже закрыто

| Маршрут | Уже задано | Где сосредоточить следующую проверку |
|---|---|---|
| Запустить → выбрать проект → отправить первое поручение | Bundled runtime, точный executable, existing repo без setup, Task из сообщения | Empty/error/offline состояния, разные сетевые стеки, отсутствующий root: G01–G03/G15 |
| Работать → переключить окно → уйти → вернуться | Один session owner, очередь, cancel/reconcile, ordered snapshots; автоматический план | Сон/пропущенный хвост, scroll/input ownership, shortcuts: G04/G08/G10/G11 |
| Получить материал → поправить → ответить → продолжить | Immutable версии, CAS, drafts, варианты + свободный ответ, affected-only resume | Реальная файловая read-only/lock ошибка и сохранность draft: G07; не переизобретать ArtifactService |
| Найти прежний результат → экспортировать/удалить/восстановить | Search scope, version refs, архив/корзина/purge, восстановление IDs | Политика выдачи/export, квоты, пустая корзина, backup closure: G01/G05/G06/G09 |
| Получить уведомление → обновить приложение → продолжить | Task routing, stable/candidate, runtime pinning, совместимый rollback | Устаревший action, decrypt failure, compatibility tuple: G12–G14; фоновая/remote работа G16 отдельно |

## 16 решений по конкретным пробелам и рискам

### G01 · Пустой проект, пустая выдача и пустая корзина

**Статус: specification_needs_detail · include.** [CHAT_FIRST_DESIGN §2](CHAT_FIRST_DESIGN.md) задаёт навигацию, [ENTITY_LIFECYCLE §5](ENTITY_LIFECYCLE_AND_EDITING.md) — корзину. Не требуется новый onboarding. Нужны различимые причины пустоты: ещё нет Project; у Project нет Task; фильтр не дал результатов; объект в архиве/корзине; root недоступен. Последнее не выглядит как пустой проект.

**UX/owner/шаг:** sidebar и центр дают одно подходящее действие: «Открыть папку», «Новая задача», «Сбросить фильтр», «Открыть архив»; Trash view — спокойное «Корзина пуста», без активного purge. Непустая «Очистить корзину» использует captured список ID и существующий purge impact/receipt; unresolved/shared объекты не пропадают в общем success. Project registry и lifecycle query возвращают reason/loaded/error отдельно от empty list. **M3/D2–D3:** добавить эти states к существующим views. **Negative gate:** нет Git или tasks — обычная локальная папка открывается без auto-init/setup; ошибка чтения store не выдаётся за ноль задач; empty-trash click не удаляет несвязанные/добавленные позднее данные.

### G02 · Холодный запуск, offline и истёкшая авторизация

**Статус: specification_needs_detail · include.** [BUNDLED_CLI_RUNTIME §3–4](BUNDLED_CLI_RUNTIME.md) и [MODEL_AND_CONTEXT_CONTROLS](MODEL_AND_CONTEXT_CONTROLS.md) уже разделяют runtime/provider/config. Не хватает единой таблицы доступных действий при boot failure: локальные Task/history/drafts открываются независимо от входа в модель; отправка требует именно нужного runtime/provider, а не абстрактного connected badge.

**UX/owner/шаг:** в composer — конкретные «CLI не запускается», «Нужен вход», «Сервис недоступен» и правильное следующее действие; details раскрывают безопасную диагностику. Startup/Connection owner хранит observed layer + failure code + last check, не общий global offline. **M0–M3/D0–D2:** добавить маленький reducer readiness и сохранить draft до попытки send. **Negative gate:** UI запускается без сети; auth 401 не уходит в бесконечный retry; успешный login не пересылает автоматически prompt с неизвестным прежним исходом; история не исчезает из-за provider failure.

### G03 · Proxy и сертификат: браузер работает, CLI не соединяется

**Статус: missing_chosen · include диагностику; defer универсальный корпоративный сетевой wizard.** В изученных правилах есть secrets/connection diagnostics, но не найден отдельный контракт различения Electron browser, CLI/provider и MCP network paths. Изменение browser proxy не доказывает исправление CLI. Electron документирует proxy на объекте Session; это не универсальная настройка дочерних процессов. [Electron Session](https://www.electronjs.org/docs/latest/api/session).

**UX/owner/шаг:** Settings → Connections → выбранное соединение; показать failing layer, endpoint label без credentials, последнюю безопасную пробу и поддержанный путь настройки. Network diagnostics owner не меняет весь env/OS trust store. **M2/D2:** честная причина/действие; нужный proxy adapter **M3/D3 или M9/D10** по фактической среде. **Negative gate:** в контролируемой fixture неверный certificate/proxy auth даёт свой отказ; браузерный success не красит CLI в green. Не обходить TLS-проверку флагом ради зелёной кнопки и не придумывать поддержанный Giga certificate option.

### G04 · Сон ноутбука, смена сети и устаревшее ожидание

**Статус: missing_chosen · include.** Snapshot/reconnect и monotonic domains уже заданы в [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md) и [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md). Недостающий переход — OS resume: connection, pending operation и retry deadline могли измениться независимо. Electron предоставляет suspend/resume events, но само событие не подтверждает здоровье CLI. [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).

**UX/owner/шаг:** после пробуждения краткое «Сверяем состояние» только там, где данные не свежи. Session owner проверяет реальные живые bindings, восстанавливает snapshot/tail и согласует pending effects; новый generation создаётся только при реальном новом соединении. **M2/D2**, небольшой resume handler поверх существующего recovery. **Negative gate:** sleep во время stream, 429 и permission; после resume нет burst повторов, нулевого бюджета, старого approval или повторного MCP write. Удалённый хвост требует fresh snapshot, не fake complete.

### G05 · Диск заполнен: что можно делать дальше

**Статус: specification_needs_detail · include.** [DESKTOP_OBSERVABILITY §3–4](DESKTOP_OBSERVABILITY.md) уже задаёт квоты, dropped counts, partial и запрет обхода durable intent. Пробел — единое пользовательское поведение при отказе **основного storage**, а не только logger. Нельзя одновременно показать «черновик сохранён» и продолжать новые записи, которые невозможно восстановить.

**UX/owner/шаг:** persistent storage banner с типом пострадавших данных и «Сохранить копию / Управление местом». Storage owner возвращает durable receipt или конкретный отказ; admission удерживает операции, требующие persisted intent, но stop действующей работы остаётся доступен best effort. **D2/M2**: failure path; **D3/D11**: удобный quota manager. **Negative gate:** injected disk-full/read-only store во время save/export/journal не создаёт false saved. Не удаляются pinned evidence/Task history для освобождения места; временный RAM draft помечен несохранённым, а copy на другой носитель тоже может отказать.

### G06 · Backup существует, но вся задача из него не восстанавливается

**Статус: specification_needs_detail · include адресное доказательство.** [DELIVERY §3](DELIVERY_AND_DOGFOOD_PLAN.md), [NATIVE_MIGRATION](NATIVE_WORKBENCH_MIGRATION.md) уже требуют backup/clean-dir restore и совместимый rollback. Не объявлять эту функцию отсутствующей. Уточнить **замыкание ссылок**: store/checkpoint + journal boundary + referenced artifact versions + pending ledger + schema/runtime metadata. Копии одной БД недостаточно, если blobs лежат отдельно.

**UX/owner/шаг:** Settings → Data → backup receipt с версией и omissions. Existing storage service создаёт согласованный snapshot/manifest; SQL backend использует подходящий способ snapshot своего драйвера, не произвольное копирование live-файла. Для SQLite существует Online Backup API; это не повод мигрировать на SQLite. [SQLite backup](https://www.sqlite.org/backup.html). **D0–D2:** один восстановленный test Task; **M10/D11:** удобный полный flow. **Negative gate:** missing blob/future schema/incomplete backup не активируются как полноценный store; restore на чистой копии не запускает прежние внешние действия и сохраняет неизвестные исходы.

### G07 · Read-only материал, внешний редактор и dirty buffer

**Статус: solved на уровне контракта · include target test, новую систему не добавлять.** [ARTIFACTS_AND_QUESTIONS §4–5](ARTIFACTS_AND_QUESTIONS.md) уже задаёт EditSession, CAS, внешнюю версию и save-copy; [ENTITY_LIFECYCLE](ENTITY_LIFECYCLE_AND_EDITING.md) отделяет link от bytes. Остаточный риск реализации — реальные Windows locks/permissions и смена файла между preview и Save.

**UX/owner/шаг:** editor показывает «Только чтение» до доступной правки, но повторно проверяет запись при commit; при конфликте сохраняет private draft и предлагает сравнить/копию. Artifact/file owner проверяет current hash/revision, ошибка не уничтожает draft. **M6/D7**, один probe существующего save path. **Negative gate:** файл изменён другим приложением/заблокирован/каталог лишился доступа; старый accepted artifact/evidence не перезаписан. Неподдержанный Office round-trip не объявлен сохранённым.

### G08 · Перенос между окнами без потери ввода и адресата

**Статус: specification_needs_detail для фокуса · include адресную проверку.** Сам ownership уже решён: [PANELS_AND_IDE §7](PANELS_AND_IDE.md) требует одного resource owner, [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md) — ordered subscriptions. Новый SessionService здесь будет ошибкой. Нужно проверить короткий handoff draft/focus вместе с выбранными material/question refs.

**UX/owner/шаг:** «Открыть в другом окне» сохраняет Task/view identity; незаконченный ввод не клонируется как новая отправка. View/Window owner передаёт presentation, authoritative writer остаётся прежним. Browser single-attachment и PTY input ownership сохраняются. **M3/D3**, одно атомарное view handoff либо безопасный отказ. **Negative gate:** окно-получатель падает в середине; два окна повторяют один submission — нет дубля. Два действительно разных input сохраняются и сериализуются, не теряются при dedup. Нет дублированного PTY input, потерянного draft или cancel чужой Task.

### G09 · Поиск и экспорт истории: что именно попало в результат

**Статус: specification_needs_detail · include.** Scoped search/derived index и import/export уже есть в [основном плане M10](GIGACODE_UI_DEVELOPMENT_PLAN.md) и F29/F30 [COMPETITOR_FEATURE_PLAN](COMPETITOR_FEATURE_PLAN.md). Недостающая деталь — search/export snapshot при одновременной работе: hit относится к конкретной версии, а «экспорт задачи» имеет определённый состав.

**UX/owner/шаг:** поиск показывает Project/Task/message/version; фильтры archive/trash явные. Меню Task → Export: readable conversation + optional selected materials/evidence manifest; не native resume promise. Search/export owner захватывает scope/cursor, отмечает исключённое/недоступное и пишет локальный файл. **D3 metadata search; M10/D11 полный export/index**. **Negative gate:** deleted/stale hit не открывает другой текст по прежнему индексу; новая версия во время export не смешана со старой. Secrets/чужой Project исключены; export не публикуется наружу.

### G10 · Клавиатура, терминал, screen reader и вопросы

**Статус: specification_needs_detail · include.** Focus/IME/local shortcuts уже предусмотрены в [CHAT_FIRST_DESIGN](CHAT_FIRST_DESIGN.md), [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md) и [DESIGN_QUALITY](DESIGN_QUALITY.md). Нужна явная таблица dispatch по focus target, иначе одинаковые Esc/Enter/Ctrl+C ломают editor/PTY/approval.

**UX/owner/шаг:** один локальный CommandDispatcher сначала учитывает active control и modal scope. Ctrl+C в PTY адресуется PTY, Enter в multiline question не отправляет prompt, Escape закрывает текущий popover и возвращает focus. Accessible names, порядок tabs и announcement содержательных состояний — в компонентах, без озвучивания каждого token. **M3/D3**, узкая keyboard fixture + actual Windows keyboard/screen-reader smoke. **Negative gate:** combo/IME/terminal selection не вызывают Stop/Approve в фоне; hidden panel не ловит shortcut. Никакой новый global hook. [Electron shortcuts](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts).

### G11 · Большой transcript: поток идёт, пользователь читает старое

**Статус: specification_needs_detail · include.** No-click render tests уже есть, per-Task scroll/draft уже сохраняются в [CHAT_FIRST_DESIGN](CHAT_FIRST_DESIGN.md). Не задано точное поведение follow-tail при больших streaming blocks, изображениях и открытии старой ссылки. UI jank нельзя решать потерей business events.

**UX/owner/шаг:** Transcript view имеет явный follow-tail mode; чтение вверх его отключает и показывает «Новые сообщения», нажатие возвращает вниз. Anchor — stable message/offset, не прежний scrollTop после изменения высоты. UI ограничивает mounted rich blocks/дорогой markdown render и получает ordered batches, полный журнал остаётся у host. **M1/D1 базовый no-click; M3/D3 scroll; M10/D11 большой history**. **Negative gate:** 10k сообщений — предложенная stress fixture, не обещанный лимит продукта: stream в B не меняет место чтения A, lazy image не уводит anchor, search jump переживает обновление. Измерить задержки/память на целевой сборке, не заявлять выдуманный FPS.

### G12 · Credentials: хранение, истечение и ошибки очистки

**Статус: specification_needs_detail · include ограниченную ответственность.** Запрет секретов в prompts/logs/export и bounded redactor уже подробно заданы [DESKTOP_OBSERVABILITY §5](DESKTOP_OBSERVABILITY.md). Пробел — где живёт **собственный** credential приложения, как UI реагирует на locked/unavailable store и как не задеть vendor-owned CLI auth.

**UX/owner/шаг:** Settings → конкретное connection → supported sign-in/replace/revoke; opaque secret ref в конфигурации. Credential owner приложения использует доступный OS-backed storage; native Giga auth остаётся штатному flow, без копирования home/token files. Кандидат Electron safeStorage имеет платформенные ограничения: на Windows DPAPI не защищает от всех приложений того же пользователя; API сверить с установленной версией. [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). **M3/D3**, к моменту собственного credential input. **Negative gate:** decrypt/store failure не даёт plaintext fallback; revoked credential не оживает из backup; error/stack/diagnostic export не содержит fixture secret. Маскировка в UI не заменяет redaction до записи.

### G13 · Уведомление о вопросе, на который уже ответили

**Статус: specification_needs_detail · include.** F28 [COMPETITOR_FEATURE_PLAN](COMPETITOR_FEATURE_PLAN.md) уже задаёт dedup, mute и правильную Task. Не хватает stale action semantics между доставкой OS notification и кликом: Task могли архивировать, вопрос заменить, разрешение отозвать.

**UX/owner/шаг:** notification payload содержит только безопасную ссылку на entity/event/revision; click открывает её текущее состояние, не выполняет старую команду из payload. Question/permission детали — в приложении после проверки. Notification router фокусирует существующее окно или открывает view того же Task, без нового run. **M3/D3**, без нового notification server. **Negative gate:** click после restart/archive/trash, второго ответа и смены question revision; пользователь видит актуальный итог/историю, а не автоматически подтверждает старый запрос. При недоступных OS notifications остаётся unread badge, доставка не считается доказанной.

### G14 · Обновление bundle и миграция данных одновременно

**Статус: solved в архитектуре · include конкретную compatibility fixture; отдельный updater defer.** [BUNDLED_CLI_RUNTIME §5](BUNDLED_CLI_RUNTIME.md) уже задаёт совместное обновление app+CLI, immutable runtime активных процессов и rollback; [DELIVERY §3](DELIVERY_AND_DOGFOOD_PLAN.md) запрещает делить mutable store stable/candidate. Это сильное принятое решение, не отсутствующая функция.

**UX/owner/шаг:** Settings/About показывает фактический tuple app build + adapter/schema + CLI runtime ref; update receipt — какую комбинацию проверили и что осталось старым у живых задач. Runtime resolver/store migration owner валидируют tuple до promotion. **D0–D3 упаковочный smoke; M10/D11 полный путь**. **Negative gate:** новый CLI не объявляет нужный method, migration падает, старая app открывает future schema, hash изменён; прежний stable остаётся доступен, новые события candidate не теряются. Независимый сетевой CLI updater не нужен до доказанной необходимости.

### G15 · Project folder перемещён, диск отключён или выбран похожий путь

**Статус: missing_chosen · include.** [ENTITY_LIFECYCLE §2–3](ENTITY_LIFECYCLE_AND_EDITING.md) отделяет label от root identity, но отдельный unavailable/relink путь не сформулирован. Переименование Project нельзя использовать для незаметной замены фактического рабочего каталога, а reconnect диска не означает, что содержимое прежнее.

**UX/owner/шаг:** строка Project показывает «Папка недоступна» с «Указать расположение / Открыть сохранённую историю». Project/workspace owner сверяет actual canonical path/repository identity и scope перед relink; task bindings захватывают старую workspace revision до безопасного перехода. **M3/D3**, один root health/relink flow; существующие настройки repo не переписываются. **Negative gate:** одинаковые имена папок, другой repo по старому пути, Windows case/alias и временно отключённый drive не перенаправляют pending write. History доступна, dispatch блокирован до подтверждённой рабочей области; никаких auto-clone/setup ради исчезнувшего пути.

### G16 · Продолжение после выхода и синхронизация между машинами

**Статус: deferred_external · defer расширение.** Сохранность Task уже включена в D2, но это не обещание бессмертного CLI после выхода main и не cloud sync. [DESKTOP_STATE_AND_CHROME §5](DESKTOP_STATE_AND_CHROME.md) и [PANELS_AND_IDE](PANELS_AND_IDE.md) уже отделяют окно от owner; M11 допускает будущие remote capabilities.

**UX/owner/шаг сейчас:** при Quit показывать выбранную политику для реальных active operations, их confirmed/pending/unknown; после restart восстанавливать журнал и фактические supported sessions. **M2/D2**, existing lifecycle. **Позже M11/D13:** отдельный запрос на background service/remote synchronization с реальным adapter, account/cost/ownership и проверками. **Negative gate:** закрытое приложение не отображается как продолжающее исполнять, если owner умер; импорт backup на второй машине не запускает старые tools и не копирует secrets. Не строить daemon/cloud для выполнения базовой локальной задачи.

## Что включить раньше, не задерживая D2

До повседневного D2 адресно закрыть **G02/G04/G05** и минимальный восстановленный test Task из **G06**. Это уточнения уже обязательных startup/recovery/durability gates, не новый релиз из шестнадцати функций. Если целевая среда использует proxy/cert, нужен диагностический минимум G03; общая панель администрирования сети не требуется.

В ближайшие D3 slices встроить **G01/G08/G10/G11/G13/G15** и G12 только в области собственных credentials. Проверять соответствующий край при реализации уже заказанных панели/composer/notification, не создавать отдельный большой проект. **G07/G14** в первую очередь нуждаются в выполнении существующего target test и исправлении найденного дефекта, а не переписывании контрактов. Полный history export, quota management и автоматизация backup относятся к D11; простое сохранение и recovery остаются ранними.

Для каждой найденной в прототипе дыры достаточно packet: текущая точка маршрута → существующий owner/files → один observable gap → маленький diff → clean и negative case → actual build/evidence/limitations. Если проверка уже есть и реально проходит на нужной версии, сослаться на неё, не дублировать новый тест ради этого документа.

## Самокритичная граница обещаний

Мы не доказали наличие этих багов в приложении: это риски стыков по документации. **solved** означает «контракт есть», а не «пользователь уже защищён». Ни статичный/интерактивный макет, ни успешный parser/unit test не доказывают живые ACP, PTY/browser, OS shortcuts, disk-full recovery или Windows updater.

Не обещаем hidden Giga hot-switch/pause/fork/delete, точную стоимость/контекст при отсутствующем usage, восстановление неизвестного внешнего эффекта или filesystem isolation одним prompt. Adaptive todo принадлежит агенту и может меняться автоматически; его completed не повышает formal quality gate. Сохранённый ответ не обязательно доставлен, файл не обязательно проверен, screenshot не обязательно соответствует current build.

Не обещаем универсальную совместимость с корпоративными proxy/cert, непрерывную работу без доступной модели/сети, перенос vendor auth на другой компьютер, отмену публикации файловым checkpoint или полноценную IDE по наличию editor. Будущие интеграции проходят свой actual capability probe; указанные Electron `latest` API сверяются с установленной версией. Производственный процесс сертификации и новая инфраструктура не добавляются к личному приложению ради гипотетических рисков.

Этот аудит добавляет **решения на границах уже выбранного продукта**, а не обязательство одновременно внедрить все возможные функции конкурентов. Факт закрытия каждого выбранного gap появится только в receipt соответствующей небольшой поставки.
