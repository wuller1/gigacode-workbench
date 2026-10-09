# Настраиваемые панели сейчас, языковые возможности IDE позже

**В M3 нужны работающие панели:** правый вертикальный rail инструментов, несколько browser/terminal вкладок, добавление/скрытие, перенос drag-and-drop, resize, tab groups и сохранённая раскладка. Это часть ближайшего рабочего интерфейса. Базовые agent browser actions/screenshots нужны сразу; расширенная автоматизация развивается в M7. Языковые возможности Java/Python/React составляют отдельный **M12 после M10**; необязательные расширения M11 не блокируют M12. Не откладывать настройку панелей до появления IDE и не выдавать syntax highlighting за полноценную IDE.

Документ задаёт реализацию внутри существующего UI/Node backend/Electron main; не устанавливает второй controller и не меняет GigaCode CLI. Actual repository/stack здесь не исследован: названия сервисов ниже — обязанности, которые надо сопоставить с текущими файлами. Используй [TASK_WORKSPACE.md](TASK_WORKSPACE.md), [план UI](GIGACODE_UI_DEVELOPMENT_PLAN.md), [визуальную спецификацию](DESIGN_IMPLEMENTATION_GUIDE.md) и [правила прав на материалы](ASSET_RIGHTS.md). Режим личного приложения — `personal_fast`: один работающий фрагмент, адресная проверка, без переписывания заготовки и настройки всего репозитория.

## 1. Сначала проверить существующий стек и выбрать адаптер

Прочитать manifest/lockfile, Electron version, entrypoints main/preload/renderer, текущие layout/editor/terminal зависимости, способ хранения состояния и тестовый запуск. Найти уже существующего владельца CLI/PTY/browser. Результат — короткая карта «обязанность → текущий файл → что добавить»; неизвестный framework не называть React по привычке. Существующие настройки проекта не перегенерировать.

**Кандидат для layout — свободное ядро Dockview**, если короткий probe в текущем стеке подтверждает совместимость. Официально есть framework bindings и JavaScript-вариант; точный пакет выбрать после проверки manifest. Базовые панели/группы, drag-and-drop, resize и сериализация соответствуют задаче; один layout adapter отделяет библиотеку от domain resources. Если работающая заготовка уже предоставляет эти возможности, расширить её вместо обязательной замены. [Dockview: introduction](https://dockview.dev/docs/overview/introduction/), [core concepts](https://dockview.dev/docs/core/overview/)

**Не считать весь репозиторий Dockview лицензированным MIT.** На дату проверки 2026-10-09 core и перечисленные framework packages имеют MIT, а `dockview-enterprise` — proprietary commercial license. Авторитетен LICENSE конкретного выбранного package/version; сохранить требуемые notices, проверить вложенное по ASSET_RIGHTS. Enterprise не подключать и его реализацию не копировать без подходящего разрешения. [Распределение лицензий](https://github.com/dockview/dockview/blob/master/LICENCE.md)

Готовые расширенные keyboard docking/keymap — отдельная enterprise-функция текущего Dockview. Core предоставляет программную навигацию фокуса; для нашего бесплатного варианта спроектировать собственные простые команды «Переместить…», «Следующая группа» и resize controls через доступные публичные core API. Это самостоятельная реализация меню, а не обход лицензирования enterprise. Перед coding сверить signatures именно установленной версии. [Dockview: focus navigation](https://dockview.dev/docs/advanced/focus-navigation/)

Не принимать browser popout из демонстрации библиотеки за готовый Electron multiwindow lifecycle. Возможность открыть второе окно не доказывает сохранность ресурса, focus, IPC и ownership; это проверяется в нашей оболочке.

## 2. Один реестр панелей, отдельные владельцы ресурсов

`PanelRegistry` хранит **представления**. Он не владеет процессом модели, shell, содержимым файла и browser cookies. `LayoutService` меняет геометрию и размещение. Существующие Session/Terminal/Browser/Buffer services владеют ресурсами и переживают mount/unmount renderer-компонентов. Не запускать процесс в constructor/useEffect панели без обращения к единственному владельцу с защитой от повторного создания.

Предлагаемый контракт native UI; это не поля legacy `state.json`, JSON ACP или settings GigaCode:

| Поле/связь | Значение и правило |
|---|---|
| `panelId` | Стабильный неизменяемый ID экземпляра представления. Перенос и скрытие не создают новый ID |
| `type` | Разрешённый тип: task-workspace, browser, terminal, file, diff, evidence, tools. Тип привязан к зарегистрированному renderer/adapter, не к строке исполняемого кода |
| `contentRef` | Неизменяемая ссылка на ресурс/логический slot; не копия всего содержимого. Для follow-task — стабильная ссылка на task slot, а текущий resolved resource хранится отдельно |
| `binding` | `follow-task` с областью окна либо `pinned` с конкретным task/project/resource. Изменение binding — явная операция; уже отправленное действие сохраняет captured target |
| `capabilities` | Возможности представления: move/resize/hide/split/attach и т. п. Это не выдача прав MCP, shell или внешней записи |
| `viewStateRef` | Scroll, selection, выбранная вкладка/материал, нужный focus-return. Dirty buffers/drafts живут у владельцев данных, не внутри layout blob |
| `windowId`, `groupId` | Текущее размещение. Перенос меняет их через LayoutService с revision, не идентичность ресурса |
| `resourceId`, generation | Разрешённый результат contentRef; реальные IDs CLI session/PTY/webContents/buffer живут у соответствующего сервиса. Generation защищает от поздних callbacks прежнего attachment |

TaskWorkspace — один подчинённый потребитель общего реестра, не отдельный dock manager. Его «Обсуждение/План/Изменения/Проверки» — виды той же задачи; материалы могут быть открыты рядом. Закреплённая панель показывает свою задачу, даже если пользователь выбрал другую. Follow-task разрешает смену проекции, но не перенос draft, pending permission и уже отправленных команд в новый task.

У файла есть канонический buffer ID и URI, dirty revision, last-known disk revision и edit history. Два вида одного файла не создают две независимые копии текста без причины. Внешнее изменение диска при dirty buffer даёт обнаруженный конфликт и сравнение, не молчаливую перезапись. Буферы с несохранённым текстом и пользовательские черновики не уничтожаются удалением панели из grid.

## 3. Что означают команды пользователя

| Команда | Выполнить | Не делать как побочный эффект |
|---|---|---|
| Добавить панель | Создать/показать представление выбранного поддержанного типа; новый ресурс — только если пользователь выбрал именно новый ресурс | Не создавать второй PTY/CLI session при повторном открытии существующей панели |
| Скрыть | Убрать представление, сохранить ID/binding/view state; сделать доступным через «Панели» | Не останавливать CLI, PTY или browser и не терять draft |
| Переместить / объединить во вкладки | Изменить layout, сохранить resource attachment и идентичность; восстановить focus | Не повторять команды и запросы, не перенаправлять stdout текущему случайному окну |
| Изменить размер | Ограничить bounds и уведомить renderer/активного владельца размера | Не пересоздавать editor, PTY или WebContents ради resize |
| Закрыть представление | Удалить view после сохранения его необходимых данных; освободить только view/listeners | Не считать dispose компонента разрешением завершить общий ресурс |
| Завершить ресурс | Отдельное явно названное действие через владельца; учитывать действующее разрешение и несохранённые данные | Не прятать эту операцию под крестиком layout без понятного контракта |
| Сбросить раскладку | По явному действию пользователя восстановить стартовое размещение | Не удалять проекты, историю, browser profile, cookies, задачи, buffers и сохранённые результаты |

Не спрашивать подтверждение обычного hide/move/resize. Отдельный выбор нужен только когда конкретное действие действительно теряет несохранённые данные или завершает работу и такой исход ещё не разрешён. Закрытие окна подчиняется существующей явно понятной политике приложения: перенос ресурса к живому владельцу либо реальное завершение при выходе, но не забытый orphan process.

## 4. Docking, клавиатура и восстановление

Справа постоянно доступен компактный вертикальный tool-window rail: Browser, Terminal, Materials, Checks и другие реально реализованные типы по необходимости. Это общий приём организации инструментов, знакомый по IDE, с **собственными** иконками/геометрией из ICON_LIBRARY; assets и branding IntelliJ IDEA не переносить. Кнопка открывает/фокусирует последнюю панель данного типа в сохранённых dock/group/tab, а повторное действие скрывает её только по явно выбранному UI-контракту. При нескольких экземплярах доступны список вкладок/экземпляров и отдельное «+» для нового ресурса. Rail не запускает заново ранее скрытый PTY/browser.

Drag начинается за header/tab handle. Выделение текста в editor, ввод в terminal, перетаскивание внутри browser или textarea не перестраивает приложение. Показывать только допустимые drop zones **во время drag**: справа/слева/снизу доступной группы — split, центр — tab group; previews отражают фактическую ширину. После drop/Escape зоны и пустые placeholders исчезают. Постоянные кнопки «Справа»/«Снизу» и пустые зарезервированные колонки не нужны. Узкое окно предлагает перенос в группу, а не недостижимую колонку шириной 80 px. Rail остаётся доступным, overflow инструментов — через доступное меню/прокрутку, не за пределами окна. Размеры/минимумы взять из DESIGN_IMPLEMENTATION_GUIDE.

Обязательная keyboard-альтернатива: контекстное/обычное меню панели → «Переместить…» → существующая группа или новая область → результат и focus. Команды расположения живут в меню, не постоянной полосе кнопок. Для resize дать управляемый с клавиатуры separator/команду с известным шагом и границами. Escape отменяет перенос, не отменяет задачу. Не назначать глобальные сочетания поверх editor/terminal без проверки текущих bindings. Rail имеет доступные имена и focus; «Добавить панель» доступно без drag.

Сохранять versioned layout envelope в существующем локальном store: schema version, layout adapter/package version, window/layout ID, revision, деревья групп/размеров, panel refs, видимые/скрытые panel IDs, active tab/panel и last dock/group для каждого tool-window типа. Пользователь может именовать несколько layouts и выбрать один. Изменения можно сохранять с коротким debounce после движения, но одна успешная запись представляет законченную непротиворечивую раскладку.

У Dockview есть `toJSON`/`fromJSON` и событие изменения layout; это данные геометрии, а не разрешённый источник процессов и команд. Обернуть сериализацию своим envelope и validator. Не передавать неизвестный blob напрямую в fromJSON до проверки и не сохранять стартовый пустой layout поверх старого, пока restore ещё идёт. [Dockview: saving state](https://dockview.dev/docs/core/state/save/)

В validator проверить разрешённые component types, уникальность panel/group IDs, ссылки registry, конечные неотрицательные размеры, отсутствие циклов, совместимость schema и разумные пределы. Начальные **проектные** пределы: 32 панели, 16 групп, глубина 8, layout blob 256 KiB; они настраиваются по реальной потребности, не нормы библиотеки. Нельзя размещать raw HTML, executable callbacks, shell commands, prompts или credentials в layout.

При неизвестной schema/повреждении сохранить исходный blob как ограниченный recovery artifact; использовать последний валидный layout или стартовое размещение с коротким пояснением. Данные задач/буферов не сбрасывать. Неизвестный тип панели заменить безопасной строкой «Панель недоступна» с возможностью убрать её. Окна за исчезнувшим монитором и размеры после 100/150/200% scale вернуть в доступную область. Восстановление layout не перезапускает прежние shell commands/ACP prompts.

Single writer/CAS для layout revision предотвращает стирание изменений другого окна. Renderer отправляет намерение с конкретным panel/window ID, host применяет его к текущей версии. Поздний save закрытого окна не перезаписывает новую раскладку. Ошибка записи не объявляется «сохранено»; последняя рабочая копия остаётся доступной.

## 5. Базовый browser в M3: native view требует отдельного адаптера

Кандидат для удалённой страницы — `WebContentsView` при поддержке установленной версией Electron. Это native `View` в main process, **не DOM-узел внутри Dockview**. Один `WebContents` может отображаться лишь в одном `WebContentsView` одновременно. Не обещать два живых вида одного экземпляра страницы простым клонированием панели. [Electron: WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)

Предлагаемый `BrowserPanelAdapter` соединяет DOM placeholder/header и нативный content view. UI измеряет прямоугольник **содержимого без toolbar/tab bar**, передаёт bounds + panel/window/generation. Main проверяет владельца и границы, переводит их в координаты parent View и применяет актуальный прямоугольник. Изменения resize, scroll контейнера, tab activation, docking, zoom и DPI требуют синхронизации; `devicePixelRatio` нельзя механически умножать дважды. Проверить систему CSS px/zoom/native logical units на настоящем Electron.

CSS z-index/overflow/transform родительской карточки не являются контрактом геометрии и clipping native view. Browser content должен исключать title bar, tabs, composer, modal и зоны переноса. При показе drag overlay/menu/modal поверх browser выбери проверенную стратегию: временно скрыть/отсоединить native view, оставив нейтральный placeholder, затем вернуть тот же живой ресурс; либо управлять порядком native views. Не полагаться на то, что DOM overlay всегда будет сверху. `View` предоставляет bounds, child ordering и visibility; подтвердить поведение версии/платформы. [Electron: View](https://www.electronjs.org/docs/latest/api/view)

Hide/tab switch меняет attachment/visibility, не уничтожает страницу. Перенос в другое окно — одна операция владельца: detach от прежнего parent, attach к новому, новый attachment generation и bounds; rollback при отказе. Старый renderer больше не меняет bounds ресурса. Если конкретная версия не позволяет нужный перенос, сначала сделать честный поддержанный путь в рамках окна и явно обозначить ограничение; не подменять перенос reload страницы без предупреждения о потере состояния.

Resource owner закрывает WebContents только когда его больше не нужно сохранять по принятой lifecycle-политике. Для BaseWindow дочерние WebContentsView не уничтожаются автоматически при закрытии окна; забытая явная очистка создаёт утечку. Проверять orphan contents и listeners после повторного открытия/закрытия. [Electron: BaseWindow resource management](https://www.electronjs.org/docs/latest/api/base-window#resource-management)

Минимальная browser-панель: address + back/forward/reload/stop loading, заголовок/текущий origin, loading/error, перейти в выбранный URL, показать страницу и сохранить безопасную ссылку. History кнопки следуют настоящему состоянию navigation. В M3 также нужен минимальный реальный agent adapter: открыть/прочитать/нажать/заполнить в разрешённой вкладке, сделать screenshot и привязать его к наблюдаемому состоянию Task. Расширенная диагностика/preview orchestration остаются M7. Конкретный bridge к неизменяемому CLI, сертификаты, авторизация и проверки — [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md).

Точный UX и размер страницы задаёт [BROWSER_WORKSPACE_CONTROLS](BROWSER_WORKSPACE_CONTROLS.md): Enter в адресе без кнопки «Перейти», × на tab, double-click/F2/context rename; M3.5 BC1–BC3 включают viewport W/H/presets/orientation, zoom/fit с actual readback и реальный agent bridge. Panel bounds, CSS viewport, DPR и resolution capture различаются; M7 BC4 добавляет только подтверждённую device emulation. Не повторять геометрию в отдельном browser layout engine.

Под «несколькими браузерами» здесь понимаются **несколько browser panels/tab groups и самостоятельных вкладок** внутри приложения: у каждой tabId, WebContents/resource ID, navigation generation и явная project/Task binding. «+» создаёт новую вкладку, выбор существующей лишь активирует её; вкладки перетаскиваются между группами без reload/spawn существующей страницы. Это не обещание нескольких полноценных Chrome engines, отдельных установок Chrome/Edge или импорта их profiles.

Удалённая страница не получает Node, общий preload с полномочиями приложения или универсальный IPC. Явно задать изоляцию/sandbox и проверку sender/frame для доверенного app IPC; разрешения сайта, popups/downloads и внешние схемы обрабатываются узко и по реальным действиям. URL из текста агента сам по себе не разрешает внешний переход/действие. Не отключать webSecurity для удобства. [Electron: security](https://www.electronjs.org/docs/latest/tutorial/security)

Browser profile отделён от app UI session через именованную partition. `persist:` означает постоянную Electron session; без префикса — memory session. Выбор постоянного профиля должен быть явным/существующим, а не случайной общей default session. Cookies/auth принадлежат browser session, не журналу или layout. [Electron: session partitions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)

Несколько вкладок могут разделять **явно выбранный разрешённый** browser profile/partition; независимые Tasks не получают общий login молча. Project/Task ownership действия сохраняется даже при разрешённом общем profile. Перенос/выбор вкладки не меняет captured target уже отправленного agent action; скрытый или pinned tab не становится «активным браузером всех задач».

В layout можно сохранять refs и проверенные публичные web URLs без credentials/token-bearing query/fragment; секретные/неопределённые ссылки не сохранять как публичные. Известный авторизованный browser profile может сохранять собственную сессию, но её содержимое не экспортируется в layout/memory. После restart восстановить вкладки лениво при выборе либо по существующей пользовательской политике; не повторять формы, POST, downloads или внешние записи для «возврата состояния».

## 6. Terminal и инструменты в M3

При наличии существующего terminal сохранить его. Для нового терминала рассмотреть `@xterm/xterm` как frontend terminal renderer и `node-pty` как отдельный PTY backend; это разные роли. Проверить package versions/licenses, Electron ABI/сборку native dependency и реальную Windows shell пользователя, не предполагать наличие bash. Нельзя принять напечатанный текст в div за интерактивный terminal. [xterm.js](https://github.com/xtermjs/xterm.js), [node-pty](https://github.com/microsoft/node-pty)

Terminal содержит несколько вкладок: «+» открывает новую PTY с выбранным shell profile, рядом меню выбора доступных оболочек; можно переименовать вкладку, переключить или перетащить её в другую группу. Пользователь сообщил Windows PowerShell 5.1 — проверить его реальный executable/версию и сделать доступным, **не требовать pwsh 7**. cmd.exe, Git Bash, WSL и прочие варианты показывать лишь после фактического обнаружения/проверки, не устанавливать автоматически. Shell profile хранит id/label, проверенный absolute executable, argv, разрешённый cwd и env policy/refs; не строку произвольной команды и не секреты в layout. Новый выбор оболочки действует на новую вкладку, не подменяет запущенный процесс старой.

PTY владеет backend: стабильный terminal ID, cwd, процесс, bounded output buffer, exit status, input owner и size owner. Панель подключается к потоку. Hide/move/remount не spawn; resize посылается после фактического изменения rows/cols активного view, а не при каждом rerender. Одна PTY в двух окнах имеет одного input/size owner; дополнительный наблюдатель явно read-only или получает ownership через явный переход, а не гонку «последний resize победил».

Каждая terminal tab привязана к своему terminal ID, Project/Task и shell profile; input направляется captured terminal ID, не общему currentTerminal. При переключении Task показывать соответствующие вкладки либо явные pinned refs, не переносить процесс/cwd/ввод между задачами. Скрытие всей группы сохраняет запущенные PTY и последнюю активную вкладку. Явное «Завершить процесс» отличается от hide; завершённый terminal показывает exit и не возрождается автоматически.

Для перезапуска приложения сохранить только безопасные descriptor refs и UI state; завершённый процесс не объявлять живым. Replay видимого scrollback не отправляется shell как input. Новый процесс/повтор команды — отдельное действие. Output может содержать секреты: не копировать весь transcript в shared memory/layout; хранение/экспорт определяется действующим scope. Внешняя команда из terminal или agent action проходит обычные разрешения; видимость панели не даёт новых прав.

Tools/evidence/file/diff панели читают существующие typed resources. Tool row ведёт к реальному результату и task/run; панель не создаёт дублирующий execution engine. Для file/diff сначала достаточно существующего viewer с действительными base/target revision и источником. Полный editor/языковой backend не является обязательной зависимостью M3.

## 7. Несколько окон: layout меняется, работа остаётся у владельца

Окна — представления, а не независимые копии SessionService. Каждый dispatch/cancel/permission захватывает task/session/process/request/generation до отправки. Смена focus и перенос панели не меняют адрес in-flight операции. Детальная модель — [PARALLEL_SESSIONS_FIX.md](PARALLEL_SESSIONS_FIX.md).

Для browser действует ограничение единственного живого attachment одного WebContents. Для terminal — отдельное input/size ownership. Для file buffer допустимы несколько editor views одного owner, но изменения применяются через единую revision; для draft — прежний task owner. Не копировать все виды по умолчанию при открытии второго окна и не запускать скрытую background работу повторно.

Проверить исчезновение окна во время переноса: результат либо старый attachment, либо новый с единым владельцем; не два и не потерянный ресурс. Renderer crash не доказывает остановку backend. После восстановления показать фактическое состояние/reconnect/unknown; отсутствие данных не заменять completed. Завершённые внешние действия не повторяются ради восстановления UI.

## 8. Карточки ближайшей реализации M3

Исполнитель получает **одну карточку**, текущие файлы и 2–4 её проверки. Карточки не создают новые обязательные stages controller; это последовательные инженерные изменения. Уже выполненную часть сверить и пропустить, а не реализовывать повторно.

### P0. Probe и карта владельцев

- **Вход:** текущий manifest/lockfile, запуск приложения, main/preload/renderer, существующие layout/terminal/browser/store.
- **Сделать:** назвать реальные версии и файлы; проверить небольшой mount/resize/restore выбранного core adapter в существующей оболочке; зафиксировать package license и нужные API. Не менять framework.
- **Приёмка:** исходный app запускается; probe подтверждает нужные операции или точное ограничение. Framework/API unknown не закрывается догадкой.
- **Результат:** краткая карта реализации и выбранная зависимость/сохранённое решение; без генерации нового repo setup.

### P1. PanelRegistry и ресурсы

- **Вход:** P0, фактические владельцы ресурсов и TaskWorkspace refs.
- **Сделать:** stable panelId/contentRef, type allowlist, binding, view state; отделить create resource от attach view; idempotent открытие существующей панели.
- **Приёмка:** hide/show и двойное открытие не увеличивают число CLI/PTY/browser ресурсов; pinned view не следует другой задаче; исходный draft сохранён.
- **Результат:** typed registry/adapter boundary и минимальные meaningful tests идентичности; одна реальная панель.

### P2. Добавление/скрытие и task views

- **Вход:** P1 и текущие discussion/plan/change/check data sources.
- **Сделать:** постоянный правый rail с собственными Browser/Terminal/Materials/Checks иконками, открыть/фокусировать/скрыть нужный тип и восстановить last dock/tab group; доступный список экземпляров/«+». Connected views одной задачи, без декоративных пустых функций; разговор/composer остаются одним контекстом.
- **Приёмка:** рабочая задача и draft переживают скрытие; список скрытых панелей восстанавливает ту же панель; close view не отправляет cancel.
- **Результат:** live-проход открыть → скрыть → вернуть с идентичностью и видимым результатом.

### P3. Move/resize/tab groups и клавиатура

- **Вход:** P2, geometry tokens и публичные core APIs установленного adapter.
- **Сделать:** header/tab drag handles, drop zones только при переносе, группы/min bounds и context-menu/keyboard fallback; без постоянных «Справа/Снизу». Сохранить focus и scroll.
- **Приёмка:** drag из текста не перестраивает UI; перенос между группами не теряет содержимое; keyboard-путь работает; rail и инструменты достижимы на узком viewport, drop placeholders исчезают после Escape/drop.
- **Результат:** короткая live-запись обоих способов с действующей задачей. Наличие библиотечного demo не считается проверкой нашего UI.

### P4. Сохранение layouts и recovery

- **Вход:** P3, store/CAS и текущая схема panel registry.
- **Сделать:** versioned envelope, validator/limits, atomic save, named layout, last-known-good restore, explicit reset только размещения; защитить restore от раннего empty save.
- **Приёмка:** restart сохраняет размещение; malformed/future schema безопасно восстанавливает вид без потери task/draft; stale save второго окна не затирает новое; reset не удаляет ресурсы.
- **Результат:** clean/bad/empty проверки нового validator плюс targeted live restart на своей сборке.

### P5. Настоящий browser panel

- **Вход:** P1–P4, Electron version, реализованный BrowserPanelAdapter и scoped browser session.
- **Сделать:** несколько самостоятельных browser tabs/panels, «+»/выбор/перенос между группами, navigation controls, native geometry/visibility/ownership, generation, разрешённый profile reuse; базовый agent adapter/screenshots.
- **Приёмка:** две реальные вкладки сохраняют tab/resource IDs и состояние при drag/hide/reopen; popup/menu/drop overlay доступен; content не перекрывает toolbar. Target другой Task/stale navigation отвергнут; view не клонирует live WebContents.
- **Результат:** live Electron evidence, а не iframe/mock. Затронутые Windows scale/zoom случаи фиксируются; непроверенное остаётся not_run.

### P6. Настоящий terminal panel

- **Вход:** P1–P4, существующий terminal либо подтверждённые xterm/PTY версии и ОС.
- **Сделать:** несколько PTY tabs со stable IDs, «+» и меню проверенных shell profiles, русскоязычный ввод/IME, bounded buffer, input/size ownership, ясные exit/error; отдельные hide view и stop process.
- **Приёмка:** две terminal tabs выполняют различимые безопасные команды, PowerShell 5.1 доступен после probe; при наличии второго shell его выбор проверен, отсутствие не маскируется pwsh 7. Drag/hide/reopen не меняет process IDs и не отправляет input соседней Task; restore не запускает прошлые команды.
- **Результат:** видимый terminal и IDs/exit evidence; не запускать prod/deploy commands ради теста.

### P7. Files/tools/evidence и две независимые задачи

- **Вход:** P2–P6 и действующие Artifact/Evidence/Session services.
- **Сделать:** открыть real file/diff/tool result по ref, связать с правильной задачей; закрепление и follow-task; переиспользовать viewers вместо добавления IDE.
- **Приёмка:** A/B работают с реальным перекрытием, перенос панели A не меняет B; файл/лог/permission остаётся у своего task; live результат соответствует сохранённому ref/revision.
- **Результат:** целевые before/after свидетельства, актуальный build и раздельные unit/contract/live outcomes.

### P8. Окна и финальный проход по своей раскладке

- **Вход:** работающие панели и текущий window lifecycle; перенос между окнами — только если реализован и поддержан.
- **Сделать:** проверить закрытие/падение renderer и restore, resource ownership, переключение named layouts и границы экрана; исправить именно обнаруженный дефект.
- **Приёмка:** одновременно две terminal tabs и две browser tabs: drag в right/left/bottom/tab group, hide→rail reopen, возврат фокуса/scroll/draft и прежних process/resource IDs; keyboard fallback и узкий rail работают. После restart восстанавливаются refs/layout/active tabs, умершие процессы не объявляются живыми. Нет wrong-Task actions, orphan WebContents/listeners или потерянного buffer; ограничения второго окна видны.
- **Результат:** принятая личная раскладка с реальными проверками; не обещание, что все возможные layouts протестированы.

## 9. M12: Java/Python/React IDE как отдельное развитие

После M10 использовать уже работающие панели/ресурсы. Если в M6 появился редактор, расширить его. **Monaco — кандидат редактора, не готовая IDE и не VS Code extension host**: модели/URI, providers и editor views различаются; произвольные VS Code extensions не начинают работать от подключения Monaco. Проверить bundling/workers/CSP и публичный API закреплённой версии, не приватные внутренности. [Monaco README и MIT license](https://github.com/microsoft/monaco-editor)

| Слой | Что реализовать | Что ещё не доказано его появлением |
|---|---|---|
| File buffers/editor | Open/save, dirty/revision/conflict, encoding/EOL по проекту, undo/redo, view state и resize | Наличие completion, project diagnostics, сборки или debugger |
| Language services | LSP/TS service adapter, document version, cancel/stale response, roots и environments | Полная совместимость IDE/VS Code plugins |
| Project diagnostics | Ошибки из реального проекта со scope/source/version; отработка добавления/удаления файлов | Успешная сборка и runtime поведение |
| Run/test | Явные существующие команды проекта, process owner, output/exit, cancel | Debugger и право исполнять произвольный внешний код |
| DAP/debugging | Отдельный adapter, launch/attach, breakpoints/stack/variables и lifecycle | Универсальная отладка всех языков или лицензия на любой debug adapter |

Для Java выбрать **Eclipse JDT Language Server**: его текущий README указывает Java 21 минимум для запуска сервера и EPL-2.0. При реализации перепроверить требования выбранного release, проверить локальный runtime, отдельный project JDK и Maven/Gradle model. Runtime LSP и target JDK проекта — разные настройки. Не устанавливать JDK и не менять build files существующего проекта автоматически. [JDT LS: требования и лицензия](https://github.com/eclipse-jdtls/eclipse.jdt.ls)

Для Python выбрать **Pyright** как исходный кандидат открытого анализатора/language server; его лицензия MIT. Проверить transport/entrypoint установленного package, выбранный interpreter/venv и реальные imports проекта. Это не Pylance: не переносить бинарники/extension другого продукта и не предполагать одинаковые функции/условия. Formatter, test runner и debugger подключаются отдельными проверенными компонентами, по реальной потребности. [Pyright license](https://github.com/microsoft/pyright/blob/main/LICENSE.txt), [реализация server](https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/server.ts)

Для React использовать TypeScript/JavaScript language service с настоящими TS/JS/TSX/JSX файлами, `tsconfig`/`jsconfig`, package types и resolution из рабочего проекта. Встроенной раскраски Monaco и пары искусственных extra libs недостаточно для project-wide imports/diagnostics. Если нужен host TypeScript service, сделать его адаптером с доступом к разрешённому filesystem snapshot; не подменять зависимости пользователя придуманными declarations. JSX-настройки берутся из проекта. [TypeScript: JSX](https://www.typescriptlang.org/docs/handbook/jsx.html)

LSP completion/diagnostic относится к URI + document version + project/environment; поздний ответ старого файла не накладывается на новый. Контекст языка не меняется из-за выбранного чата. Rename/code action показывает реальные затронутые файлы, сохраняет dirty/conflict правила и применяется в действующем scope. Анализ проекта не должен запускать неизвестные build hooks и менять конфигурацию ради красивого демо.

## 10. Малые карточки M12

| Карточка | Конкретный результат | Минимальная содержательная приёмка |
|---|---|---|
| I1. Buffer + editor | Один файл открыт в существующей panel system, сохранение и конфликт диска работают | Unsaved edit переживает dock/hide; внешняя правка не затёрта; save в правильный файл и URI |
| I2. Service bridge | Один выбранный язык: initialize/capabilities, document sync, versions, diagnostics | Известная ошибка появляется/исчезает при правке; старый ответ отклонён; падение сервера даёт unavailable, не чистую диагностику |
| I3. Java | JDT LS видит настоящий небольшой проект и правильный JDK | Межфайловый переход/import, реальная ошибка типа, изменение файла; failure missing runtime честно виден |
| I4. Python | Pyright видит выбранный venv и модули проекта | Правильный import и заведомо отсутствующий различаются; type error найден; смена environment инвалидирует нужный результат |
| I5. React/TS | Service разрешает реальные .tsx/.ts зависимости проекта | Ошибка props/import обнаружена, переход ведёт в нужный файл; неизвестные module types не скрываются фиктивными any |
| I6. Project diagnostics/run/test | Реальные scoped diagnostics и существующая команда теста/сборки | Положительный и плохой случаи; ненулевое покрытие, правильные cwd/env, exit и версия; broken build не pass |
| I7. Debugger отдельно | Один выбранный DAP adapter с проверенной лицензией и жизненным циклом | Настоящий breakpoint/stack/continue/stop; no orphan process и различение launch/attach. [DAP overview](https://microsoft.github.io/debug-adapter-protocol/overview.html) |

I3/I4/I5 — отдельные вертикальные фрагменты; не требовать одновременную поддержку всех языков, прежде чем пользователь получит полезный редактор. Не копировать VS Code целиком и не обещать поддержку Marketplace extensions. Выбранные library/server/adapter версии и notices фиксируются один раз; условия пересматриваются при изменении зависимости или способа применения.

## 11. Короткое задание для Flash-модели

```text
Выполни только [P#/I#] для существующего GigaCode UI, personal_fast.
Файлы и версии: [актуальная карта]; действующая архитектура/owner: [ссылки].
Сохрани: panelId/contentRef, task/resource binding, drafts/dirty buffers и уже работающие процессы.
Разрешённый diff: [конкретные компоненты/adapter]. CLI и repo setup не менять.
Прочитай только раздел [N] PANELS_AND_IDE и нужный API/лицензию закреплённой версии.
Сначала назови фактический источник состояния и плохой случай; затем план максимум 4 действий.
Реализуй узкий проход. Выполни назначенные 2–4 случая на настоящем build, где live обязателен.
Верни: diff/поведение, версии и права, measured evidence, fail/unknown, следующий шаг.
Нет реального Electron/resource: contract/fixture проверен, live incomplete; готовность не выдумывать.
```

Память и отчёт содержат refs/решения/ограничения, не весь код, browser session или terminal transcript. Не запускать отдельного critic на каждый resize; независимый проход нужен при существенном новом layout/lifecycle или по выбранному workflow. В этом документе исследованы официальные источники и задан план: Dockview, browser/PTY интеграция, IDE и восстановление в приложении пользователя здесь не реализованы и не протестированы.

## Выбор модели и поздняя IDE-платформа

Базовые controls модели/reasoning и доступного/неизвестного контекста включить в M3 по [MODEL_AND_CONTEXT_CONTROLS](MODEL_AND_CONTEXT_CONTROLS.md). Это конфигурация той же Task/session; не отправлять неподтверждённые параметры форку CLI. Для позднего M12 рассмотреть [IDE_PLATFORM_DECISION](IDE_PLATFORM_DECISION.md): текущая Electron-архитектура сохраняется, использование открытых IntelliJ компонентов или bridge оценивается отдельно по функциям, лицензиям и стоимости поддержки. Наличие бесплатных функций в готовой IDE не устанавливает лицензию их исходников.
