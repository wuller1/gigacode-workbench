# Настройки GigaCode UI: область, применение и сохранность

Дата: **2026-10-10**. Это контракт развития существующего личного UI, не отчёт о реализованных экранах. Начать с уже работающих settings services, storage, selector модели/reasoning, auth и MCP; сохранить их значения и adapter calls. Пользователь подтвердил работающий reasoning. Новое размещение controls не требует переписывать конфигурацию CLI или настраивать репозитории заново.

Настройки открываются из своей кнопки приложения и контекстного меню Project/Task, в одной встроенной поверхности с поиском и ясной областью. Не добавлять второй стандартный Electron menu bar. Поиск ищет названия/описания разрешённых настроек, не содержимое секретов. Открытие панели ничего не запускает и не вызывает модель. Основные настройки доступны уже в **M3**, сохранность и понятные ошибки — раньше, в M2.

## 1. Области, наследование и единый контракт сохранения

| Область | Что ей принадлежит | Что она не меняет |
|---|---|---|
| **Приложение** | Тема, клавиши, системные уведомления, местное хранилище, установленный runtime, доступные подключения и общие defaults | Не перезаписывает конфигурацию каждого репозитория и действующие Task overrides. |
| **Проект** | Defaults новых Tasks: модель/роль, разрешённые ссылки на подключения, browser/terminal profile, контекстные источники и стиль проекта | Не повышает права аккаунтов, не переносит глобальные секреты в Git, не запускает setup существующего проекта. |
| **Задача** | Явные overrides в своей области: предпочтения исполнения, маршрут/роль, view/recovery/context policy | Не изменяет родительский проект, соседние Tasks и уже отправленные turns. |

Каждая настройка имеет definition: устойчивый key, тип/validator, разрешённые scopes, source/default, sensitivity, owner, apply boundary и required capability. Это внутренний registry приложения, **не предложенные имена параметров Giga/ACP**. Несовместимая область не получает ложный editable control: например, у Task нет своего каталога установки приложения. Assignment/model/role overrides и immutable session/turn captures сохраняются существующими execution services, не превращаются в четвёртую глобальную область Settings.

Для inheritable key: поставочный default → app override → project override → task override; явное assignment override, если оно поддержано, относится только к данному исполнителю. Apply scope не расширяет существующую авторизацию. Рядом с полем показывать **эффективное значение**, «Из приложения / проекта / задачи», локальный override и «Сбросить к наследуемому». Reset удаляет override, а не записывает нынешнее значение родителя навечно. Изменение родителя действует на наследующие future captures; закреплённые queue items не переписываются. Удаление global credential или прав — отдельный lifecycle, не Reset.

**Внешняя конфигурация:** прочитанный CLI/project файл сохраняет свой source/path/hash. Если app не владеет его записью, поле read-only с действующим способом открыть источник; оно не дублируется второй независимой копией в app store. Не считать последнее поле JSON более авторитетным без схемы precedence. При конфликте проекта/внешнего файла показать расхождение и затронутый ключ; не молча перезаписывать чужие settings.

Применение проходит один SettingsService/единственный writer:

1. Открыть snapshot с config revision и effective/source map. Изменения находятся в локальном draft, не вызывают setters на каждое нажатие. Безопасный theme preview обратим; Cancel снимает preview, сохраняя более новую подтверждённую конфигурацию другого окна.
2. Проверить тип/диапазон/пути, зависимости ключей, доступные options и scope. Показать changed values, последствия и границу применения; обычные обратимые изменения сохраняются одной кнопкой, без модального согласования каждого поля.
3. Atomic save с operationId и expected revision фиксирует **desired configuration**, историю изменения и apply intentions. Stale CAS даёт сравнение конфликтующих ключей; draft не теряется. Duplicate operationId возвращает прежний receipt.
4. Owner применяет изменение на нужной границе и сообщает ACK/readback с applied revision. «Сохранено» не равно «Применено». UI различает pending, applying, confirmed, failed/uncertain; показывает фактически действующее значение рядом с желаемым при расхождении.
5. Ошибка внешнего setter не откатывается фиктивной записью старого label. Возможен частичный apply: сохранить известное состояние, удержать только зависимые dispatch, предложить исправление/проверенный откат. Старый prompt не повторять ради проверки настройки.

| Граница | Примеры | Ожидаемое поведение |
|---|---|---|
| **Сейчас** | Тема, разрешённые view preferences, фильтр уведомлений | Все соответствующие окна получают revision; draft/focus не теряются. |
| **Следующий turn/admission** | Модель/reasoning, контекстный pack, роль/prompt overlay, quota для нового запуска | Текущие captured settings неизменны; показан pending. Queue policy — [SMART_MESSAGE_QUEUE](SMART_MESSAGE_QUEUE.md). |
| **Новый ресурс/процесс** | Runtime version, launch-time prompt, shell profile, browser partition | Старый ресурс сохраняет свой capture. Явное «Открыть новый»/«Перезапустить после завершения»; не скрытый kill. |

Отзыв доступа — отдельный security intent: запрет новых неразрешённых dispatch действует без ожидания удобного следующего turn; текущие операции останавливаются только доступным механизмом с честным исходом. Старый permission capture не является вечным разрешением. Повышение лимита или смена «автоматически» не предоставляет новые credentials/права.

Config хранится вне immutable bundle. Schema migration проверяется на копии с backup, integrity и понятной версией; неизвестную будущую schema не перезаписывать defaults. История хранит только безопасные значения и credential refs. «Вернуть предыдущую настройку» создаёт новую revision после проверки совместимости; не стирает последующие чужие изменения и не отменяет внешние эффекты. Откат приложения/CLI и откат settings различаются.

## 2. Внешний вид и рабочее место

App: **системная / светлая / тёмная тема**, масштаб и размер текста в поддержанном диапазоне, плотность строк, reduced-motion preference с учётом ОС. Использовать [DESIGN_IMPLEMENTATION_GUIDE](DESIGN_IMPLEMENTATION_GUIDE.md); стартовые design values — проектный выбор, не норматив ОС. Доступность не отключать режимом «компактно»: focus, контраст и читаемость остаются.

Layout хранится отдельно от содержимого Task: именованные раскладки, выбранная раскладка, расположение/размеры/tab groups по [PANELS_AND_IDE](PANELS_AND_IDE.md). Project может выбрать default layout; конкретное окно хранит view state. **Сбросить раскладку** меняет геометрию, не удаляет панели как resources, drafts, PTY или browser tabs. Перед reset достаточно кратко назвать область; Undo полезнее постоянных модальных окон. Дефектный layout даёт безопасную геометрию и сохранённый исходник, не сброс бизнес-данных.

В обычном UI нет настроек «сделать хороший дизайн» или «качество 90%». Корпоративный preset — опциональный project design-contract, не глобальная тема всех задач. Изменение selected/task activity styling не меняет running/unread statuses.

## 3. Модели и reasoning

Сохранить существующий рабочий adapter по [MODEL_AND_REASONING_CONTROLS](MODEL_AND_REASONING_CONTROLS.md). Settings управляет defaults и доступными route refs; текущее model/reasoning управление остаётся рядом с composer. На карточке подключения — понятное имя provider/route, фактически доступные модели, последнее подтверждение и безопасная причина недоступности. Одинаковые labels не объединяют разные endpoints.

Project default предназначен новым Tasks; Task/assignment override виден как локальный. Выбор reasoning использует **существующие реальные values**, а не универсальную лестницу из макета. Default, Off, toggle, fixed, budget и tiers имеют свой фактический смысл. Не придумывать способность модели, окно или цену по её имени. Полный список обновлять по фактическим изменениям/ошибке/Refresh, без LLM и нового inventory каждого хода.

При смене model принять актуальные options, проверить reasoning/media compatibility и подтвердить readback. Desired и actual показываются отдельно, retries уже отправленного turn сохраняют capture. Несовместимый queued intent удерживается с причиной; draft/attachments не удаляются. «Для всех ожидающих» — явное адресное действие. Unsupported новая опция не выключает уже работающий selector.

## 4. CLI, подключения и авторизация

Runtime card показывает установленную **bundled** версию, runtimeRef/hash/путь, совместимость adapter и состояние обновления. Первая поставка обновляет оболочку и CLI вместе по [BUNDLED_CLI_RUNTIME](BUNDLED_CLI_RUNTIME.md). Нет скрытого fallback в глобальный PATH, правки CLI, импортирования private hooks или автоматического updater из неподтверждённого latest. Новый runtime выбирается для новых процессов, живые sessions удерживают прежнюю версию.

App хранит registry подключений; Project/Task выбирают разрешённые refs. **Войти / Проверить соединение / Отключить / Забыть локальные учётные данные** — разные действия. Login идёт через существующий поддержанный flow; credential не вводится в prompt. Безопасная проверка не запускает платную генерацию, запись MCP или сканирование без соответствующего смысла действия. Успешный browser login не доказывает provider/CLI login.

Секреты находятся в существующем credential owner/поддержанном локальном защищённом хранилище; settings содержит opaque reference и статус. Renderer получает только нужную безопасную проекцию, не токены для удобства форм. Не показывать ранее сохранённый secret как обычный текст; новое значение не попадает в logs, diff, clipboard автоматически или export. Потерянный reference требует переподключения, не восстановления секрета из истории. Не обещать защиту от всех процессов того же пользователя.

Отключение запрещает новые обращения выбранного подключения, показывает зависимые Tasks и судьбу активных вызовов; оно не выдаётся за remote revoke без API. Не удалять общий credential, используемый другими проектами, при Reset одного Project. Существующую внешнюю auth/config не копировать в установочный каталог и не менять целиком.

## 5. MCP, роли и инструкции

Раздел **Инструменты и роли** показывает уже подключённые Git/Jenkins/OpenShift/Confluence/Sprut, состояние сервера, реальные tools, effects/scopes, bindings и использование ролями. Sprut — SCA зависимостей по факту пользователя. Inventory переиспользуется по несекретному fingerprint; Refresh и изменение schema/прав обновляют затронутое. Общая карта — [MCP_PROFILE_SETUP](MCP_PROFILE_SETUP.md), не новая независимая конфигурация серверов.

В Settings → **Роли** находится общая библиотека по [CUSTOM_PROFILES](CUSTOM_PROFILES.md): встроенные и пользовательские профили, создать/копировать, помощь агента, preview примера, publish версии, история/архив/restore и безопасный text import/export. Девять bundled профилей остаются неизменными; native custom library развивается в M4.9/D5, её базовое представление — M3.12. Draft не считается установленной или активной ролью.

Для каждой роли: имя/назначение, app/project scope и источник наследования, stable profile ID, source/version/hash, применимые tool bindings, фактически проверенная граница разрешений, custom overlay и preview безопасного manifest. User выбирает default роль проекта; Task/assignment фиксирует конкретную immutable версию и effective hash, включая версионированный project override. Reset убирает override, не переписывает базовую роль и активные bindings. ProfileRegistry/PromptComposer — ответственности существующих CatalogService/InstructionRegistry/PromptAssembler, не параллельные settings stores. Девять профилей не означают девять всегда запущенных агентов; автоматизация использует [ROLE_ROUTING](ROLE_ROUTING.md).

Помощник предлагает существующий профиль, небольшой override либо новый draft по конкретной повторяющейся потребности. Рекомендация не публикует/активирует роль сама; явное поручение создать и применить выполняется в уже разрешённом scope без повторных подтверждений каждого шага. Архив исключает новые назначения, сохраняя captured runs; отсутствующий default показывается unresolved, без тихой замены. Publish сохраняет локальную версию, а применение — отдельный receipt на безопасной границе.

Изменение prompt/overlay сохраняет новую версию; активные runs и worker packets не переписываются. Следующее применение проходит [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md): system append/override, native subagent и обычный context — разные поверхности с реальными свидетельствами. Настройка с названием «Системный prompt» не доказывает system placement. Если нужен новый process, показать границу, не отправлять второй prompt в занятую session.

Tool allowlist/denylist отображает capabilities **и место enforcement**. Изменение предпочтения не разрешает deploy/publish и не превращает prompt-only запрет в sandbox; действующая Task authorization проверяется отдельно. Пустая/непроверенная map не означает «включить все tools». Новый сервер/endpoint не подключается скрыто вместе с ролью.

## 6. Параллельность, recovery и контекст

Раздел **Выполнение** объединяет уже существующие policies: степень автоматизации, ограничения параллельных turns/workers, содержательные attempts, safe transport retry, ожидание/квота и поведение context recovery. Показывать owner и scope лимита: общий provider/account budget охватывает основной агент и workers; у child не появляется отдельный бесплатный бюджет. Значения — стартовые configurable policies из [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md), не свойства модели и не гарантированный SLA.

Личный UI использует `personal_fast` и уже порученную автоматизацию within scope; другие рабочие проекты — `established_strict`. Settings не подменяет Task requirements и не добавляет approval wizard к обычному шагу. Manual role lock, queue pause и cancel различаются. Уменьшение concurrency удерживает **новые** admissions; не убивает уже работающие процессы для достижения числа. Изменение лимита не обнуляет историю attempts/circuit; повышение не запускает заблокированную работу без остальных условий.

Context: budget policy, известные limits/reserves, auto/manual recovery preference, source inclusion defaults и краткие controls по [CONTEXT_CONTROL_AND_ERROR_RECOVERY](CONTEXT_CONTROL_AND_ERROR_RECOVERY.md). Не выдавать 256k за лимит всех aliases, 413 за token overflow или native compaction за нашу новую функцию. Фактическая модель/CLI может самостоятельно сжимать историю; настройка «выключить авто» не обещает управлять скрытым механизмом. Новый handoff сохраняет effects/requirements/budgets, не replay исходного prompt.

Настройки recovery показывают, какие действия могут происходить автоматически в данном scope, и какие требуют действительно нового выбора. Семантические ошибки не получают бессмысленный повтор; unknown write остаётся reconciliation. Не добавлять второй цикл вокруг internal CLI retries и не включать unattended infinite retry.

## 7. Память и источники проекта

Memory settings показывает области app/project, источник, состояние imported/proposed/verified/retired и способ поиска/исправления. По [SHARED_MEMORY](SHARED_MEMORY.md) память живёт вне заменяемого bundle; native store при миграции сохраняет provenance/IDs/conflicts. Опция использовать память влияет на будущий pack, но не удаляет уже отправленный контекст модели.

**Импорт известных источников** предварительно показывает фактические доступные файлы/refs и дубликаты; импорт не делает содержимое проверенной истиной. Нельзя обещать скрытую историю CLI или автоматически прочитать все репозитории. **Не использовать запись / исправить / вывести из употребления / удалить** — разные lifecycle actions с сохранением необходимых зависимостей. Секреты не являются memory entries.

Project sources: существующие инструкции/SDD/design contract/docs map, root identity и разрешённые дополнительные каталоги. Link/relink root — проверяемое изменение identity, а не строка пути для автоматического переноса прав. Settings не устанавливает lint/CI/hooks и не запускает docs-generate существующего репозитория. Ограничение источников не должно молча исключать обязательное принятое требование.

## 8. Браузер, доверие, proxy и сертификаты

Browser profile card показывает собственный persistent profile/partition, проекты использования, сохранение входа, разрешения origin и доступные agent actions. Project выбирает profile ref; Task binding фиксирует фактический ресурс. Изменение default не пересаживает уже открытую вкладку в другой профиль. **Очистить данные сайта** адресуется profile+origin и объясняет logout; это не «сбросить все настройки».

Network diagnostics разделяет **Electron browser**, **CLI/provider** и **MCP**. Показывать source: system/PAC/explicit supported config, безопасный endpoint label, cert/auth/proxy причину и последний probe. Настройка proxy Electron Session не изменяет автоматически сеть дочернего CLI; применять только подтверждённый способ каждого adapter. Источник и применённое значение видны раздельно. [Electron Session](https://www.electronjs.org/docs/latest/api/session).

ACK сохранения proxy не доказывает смену всех старых pooled connections. Adapter учитывает границу новых соединений и проверяет реальный маршрут безопасным способом. Не вызывать `closeAllConnections` как безобидный refresh при Save: Electron предупреждает, что он прервёт выполняющиеся запросы. Такое действие требует явной области/безопасной границы и не отменяет сохранение пользовательского ввода. [Proxy и connections](https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig).

Сертификаты: системное доверие серверу, клиентская mTLS identity и signing extension — разные вещи. Использовать [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md): выбор из фактических кандидатов для origin/profile, безопасные fingerprint refs и Reset решения. Никакого глобального «игнорировать TLS ошибки», копирования чужих cookies/passwords или изменения OS trust store из обычного Save. Не обещать неизвестный Windows/Giga certificate flag. Закрытый ключ/PIN не экспортируются.

Agent browser permissions — origin/resource scope и подтверждённые navigate/read/click/fill/screenshot операции. Настройка «разрешён браузер» не выдаёт blanket внешние writes и не смешивает соседние Tasks. Безопасность page/preload/IPC сохраняется независимо от темы/режима автоматизации.

## 9. Терминал и запуск инструментов

App обнаруживает реальные установленные оболочки; Project задаёт default shell profile/cwd policy, Task может выбрать разрешённый override. Profile содержит существующие executable/argv/env refs и собственную версию; показывать командную строку безопасно, без раскрытия secret env. Windows PowerShell 5.1 не заменяется требованием установить pwsh 7.

Новый default действует **на новую PTY**, не меняет живой процесс. View close/hide не равно terminate. Кнопки «Новый терминал с профилем» и «Остановить этот процесс» имеют разные owners/receipts; вкладки не переиспользуют случайный active cwd другой Task. Историю shell команд не выдавать за историю сообщений агента.

Размер scrollback, font/wrap и copy behavior — presentation preferences с bounded памятью. Изменение лимита не удаляет authoritative transcript/evidence. Не исполнять sample command ради preview settings; shell snippets и env не проходят через небезопасную интерполяцию. Терминальные shortcuts разрешаются по focus/context §10.

## 10. Уведомления и клавиатура

App preferences: показ локальных уведомлений об ответе/ошибке/вопросе, режим только требующее действия, quiet behavior и политика для foreground/background. Project/Task могут только поддержанным явным override сузить шум. In-app activity и незавершённые вопросы остаются доступны даже при mute. Открытый чат не обязан получать системное уведомление на каждый token; завершение worker можно агрегировать до нужного события Task.

Notification action содержит captured Task/assignment/result/question revision. Click открывает соответствующий объект, а не последний активный чат; stale permission не подтверждается и trash/archive не оживляет run. Возможность OS notification и реальный результат разрешения ОС показываются честно. Никаких внешних email/webhooks или регулярных фоновых заданий из галочки «Уведомлять».

Shortcut editor: список команд, поиск, текущая binding/source, conflict explanation, Reset одной команды. Context-aware resolver различает composer, editor, browser, PTY, dialog; горячая клавиша приложения не перехватывает обычный ввод/PTY signal без явно принятого правила. IME composition не отправляет prompt; multiline/Send policy видна. Keyboard move для панелей и выход из menu остаются доступны. Не добавлять OS-global hotkey без отдельной включаемой функции и проверки доступности.

## 11. Данные, журнал, backup и приватность

Storage card показывает фактический data root, free/used либо unknown, объём категорий, schema/version и последний backup/restore receipt. Business Task journal/evidence, artifacts/drafts, debug logs/cache, browser data и credentials — разные категории. Archive/Trash управляются через [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md); скрыть историю не значит удалить файлы, остановить run или освободить все bytes.

Лимиты debug/rotation и временный content capture задаются по [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md). Normal сохраняет значимые lifecycle/correlation факты; расширенный debug имеет scope и срок. Full content — отдельный явно выбранный локальный режим, всё равно без секретов и hidden chain-of-thought. Log retention не удаляет принятую evidence или pinned failure bundle. Превышение квоты/ошибка диска видны; новые write-intents не объявляются сохранёнными при failed persist. Срочная остановка текущего эффекта не блокируется сломанным logger.

**Экспорт настроек** содержит schema, безопасные overrides, source metadata и unresolved connection refs; не secrets, cookies, auth headers, certificate private keys или полный env. Import — preview diff/validate/CAS, без автоматического подключения неизвестного endpoint и без запуска задач. Отсутствующие credential refs показываются как требующие входа. «Сбросить настройки» не очищает архив, память или файлы пользователя; массовый Reset сначала показывает точные категории и сохраняет применимый rollback.

**Backup** сохраняет согласованное замыкание: config/schema, Task store/checkpoint/journal boundary, referenced artifact versions и pending ledger, с manifest/hashes/omissions. Не называть config export полной резервной копией и не копировать произвольно открытую БД. Credentials/browser auth по умолчанию вне переносимого backup; UI прямо показывает это исключение. Privacy-sensitive content не отправляется наружу автоматически.

**Restore** сначала проверяет версию/целостность/refs на staging-копии, затем показывает состав замены и сохраняет прежнее состояние. Не делает union конфликтующих live stores без отдельного merge contract. Activation ожидает безопасной границы owner; restored running записи проходят recovery, не запускают старые внешние действия. Откат кода не открывает несовместимую новую schema как старую. Backup/restore на чистой копии проверяются фактически; базовая сохранность M2 не откладывается до удобного M10 UI.

## 12. Реализация малыми шагами и проверка

| Карточка | Этап и конкретный результат | Адресная приёмка |
|---|---|---|
| **SC0 — существующие владельцы** | M2 prerequisites: inventory нынешних settings paths/services, definition/source map, config revisions, atomic writer и applied acknowledgements | Один безопасный key сохраняется/восстанавливается; failed persist и stale revision не выглядят успехом. Никакого repo setup. |
| **SC1 — единый экран** | M3 basic: встроенная Settings surface, поиск, scope, effective/source, draft/Save/Cancel/Reset и appearance/layout | Два окна, наследование/reset, restart, keyboard, отсутствие потери composer draft. |
| **SC2 — рабочие подключения и controls** | M3 basic: reuse model/reasoning/auth/MCP/runtime/terminal defaults, pending/apply boundary | Выбор уже работающего reasoning, следующий turn, новая PTY, active runtime не заменён; один setter на действие, реальные ACK. |
| **SC3 — углублённые политики** | M4 и соответствующий M5: prompt/profile snapshots, context/memory, shared quotas, scoped network controls только по доступным adapters | Старый turn сохраняет capture; revoke удерживает новое действие; несовместимый value/unknown write не отправляется автоматически. |
| **SC4 — обслуживание данных** | M10: удобные update/rollback, retention/backup/export/import/restore flows над прежними services | Bad schema/missing artifact/credential не активируются молча; clean-copy restore сохраняет refs, не replay effects. |

Не создавать все перечисленные вкладки с неработающими переключателями. Сначала вывести существующие полезные настройки, затем добавлять реальные owners/adapters. Недоступная новая возможность получает конкретную причину; уже работающая функция не выключается из-за неполного исследования. Модель исполнителя читает общую §1 и раздел своей карточки, не весь пакет каждый ход.

Автоматизировать deterministic проверки SettingsService: precedence/reset, type validation, CAS/dedup, migration rollback, redaction/export и pending-versus-confirmed. Добавить отрицательный пример с записью секрета в export, неверной revision либо ACK другого binding: проверка обязана его выявить. Пустой набор настроек допустим для новой области с наследованием; отсутствие owner/ACK не превращается в confirmed.

На целевой сборке вручную или UI automation пройти **затронутый** путь: изменить тему без потери draft; выбрать reasoning при активном ответе; открыть второе окно и получить честный conflict; изменить shell default без перезапуска PTY; проверить безопасный auth/network failure; импортировать settings без secret и восстановить копию данных без запуска старой работы. Не требуется весь набор после исправления подписи. Report содержит build/runtime/config revisions, фактические действия/ACK и failed/not_run/limitations отдельно от pass.

Здесь подготовлен контракт. Живая Windows/GigaCode UI проверка, новые экранные controls, миграции и backup flows в этой работе не реализованы и не объявлены успешно испытанными.
