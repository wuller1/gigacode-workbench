# Браузер: вкладки, размер страницы и управление агентом

Контракт для существующего Electron UI, исследование официальной документации **2026-10-10**. Это план реализации, а не подтверждение работы браузера в пользовательской сборке. GigaCode CLI остаётся неизменённым. Использовать существующие BrowserService, BrowserPanelAdapter, PanelRegistry, Settings и operation ledger из [PANELS_AND_IDE](PANELS_AND_IDE.md) и [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md), без второго браузерного движка/реестра вкладок.

M3.5/D3 включает настоящий удобный браузер, настройки viewport и минимальное управление агентом со screenshot. M7/D8 добавляет проверенную имитацию устройства и расширенную диагностику; базовые controls не откладываются до него. Собственный визуальный стиль — [DESIGN_IMPLEMENTATION_GUIDE](DESIGN_IMPLEMENTATION_GUIDE.md), права/вход — прежний browser contract.

## 1. Компактный привычный UI

Сверху browser-панели — ряд вкладок и **+**. Вкладка показывает безопасный page title либо пользовательский label, маленький favicon при наличии, loading/error и крестик **×** собственной библиотеки иконок. Фавикон/название — недоверенные данные страницы; они не являются свидетельством безопасного сайта. Длинная подпись обрезается визуально, полный текст доступен по запросу и для assistive UI.

Закрытие — × на самой вкладке. Переименование — double-click по label, **F2** при фокусе на вкладке или контекстное меню «Переименовать»; Enter сохраняет, Escape отменяет. Меню также содержит «Закрыть». Команда всегда захватывает **конкретный tabId**, даже если вкладка не выбрана. Не добавлять постоянные текстовые кнопки «Переименовать / Закрыть» внизу панели. F2 не перехватывается у editor/PTY/поля адреса. Новый label не меняет URL, профиль, tabId или page title источника.

Под вкладками: **назад / вперёд / reload ↔ stop**, адресная строка, компактные controls viewport/zoom и меню дополнительных действий. Адрес открывается по **Enter**, кнопка «Перейти» не нужна. Back/forward доступны по реальной истории. Reload и Stop различаются по фактической загрузке; stop navigation не означает отмену agent turn или уже отправленной формы. При редактировании URL живое обновление title/history не затирает ввод; Escape возвращает текущий подтверждённый URL.

Адрес отображает actual URL после redirects, отдельно от введённого desired. Security/details показывает наблюдаемый origin, профиль и конкретную TLS/auth информацию; не рисовать зелёное «доверено» по favicon или самому префиксу https. Ошибка страницы остаётся внутри вкладки с адресной причиной/retry; не превращается в завершённую задачу агента.

Иконка **«Открыть во внешнем браузере»** рядом с адресом открывает текущий **подтверждённый URL**, не неотправленный ввод адресной строки. Host получает captured tabId/navigation generation через безопасный IPC, сам читает URL, разбирает его и допускает http/https без embedded credentials. Внешнее открытие выполняется через реальный `shell.openExternal` в default browser; Promise подтверждает исход вызова, не загрузку сайта. [Electron shell](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options). `file:`, `javascript:`, `data:` и произвольные custom schemes не запускаются скрыто. При пустом/неподдержанном URL control объясняет причину. Внутренняя вкладка/история/размеры сохраняются; cookies, client certificate choice и login profile наружу не переносятся. Агент использует такую операцию только при реальном tool/capability и действующем scope; открытая внешняя страница не становится автоматически управляемой.

Иконка **«Развернуть браузер»** заполняет всю рабочую область приложения под его chrome. Это временный layout mode, не новая вкладка/окно и не OS fullscreen. Сохранить прежние panel/group/bounds и вернуть их по той же кнопке или Escape; промежуточный popover/редактирование сначала обрабатывает собственный Escape. Tabs, URL, page state и ресурсы других панелей сохраняются, CLI/PTY не останавливаются. Adaptive viewport получает новые actual bounds; fixed CSS viewport остаётся фиксированным, меняется только допустимое отображение/fit. Если layout был изменён другим окном, восстановить валидное размещение с учётом revision, не затереть новый layout целиком.

**Полный экран окна** — отдельная команда WindowService, например F11 по принятой shortcut policy: меняется конкретный BrowserWindow, а не только browser panel. Использовать поддержанные `setFullScreen`/`isFullScreen` и события фактического входа/выхода; на macOS переход асинхронен. [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winsetfullscreenflag). Requested не равно actual; выход восстанавливает предыдущий режим и layout, без reload. HTML fullscreen, запрошенный самой web page, имеет отдельную permission/origin policy и события, не выдаёт странице управление всем приложением. F11 не добавляет OS-global hotkey и не перехватывает контекст с иной явной binding.

Основная компактная строка размеров: **Адаптивный / preset**, `W × H CSS px`, смена ориентации, **Масштаб страницы 100%**. Дополнительное раскрытие: **Вписать превью**, фактические измерения и поздние device-настройки. При узкой панели controls уходят в доступный popover, не забирают большую часть высоты страницы. Выбор пресета/размера не вызывает LLM.

Скрытие browser-панели оставляет вкладку живой. Закрытие browser-tab — отдельная команда владельцу ресурса: проверить несохранённую форму, активное действие/download и принятый lifecycle, затем dispose либо показать конкретное препятствие. Не спрашивать каждый обычный close пустой вкладки; не применять принудительное закрытие как способ скрыть pending effect. Browser tab × и layout panel hide — разные действия. Restore descriptor не повторяет формы/POST и не обещает вернуть прежний живой DOM.

## 2. Пять величин, которые нельзя смешивать

| Что видит пользователь | Канонический смысл и владелец |
|---|---|
| **Размер страницы, W × H CSS px** | Желаемый layout viewport страницы. BrowserService хранит intent; browser adapter измеряет actual `innerWidth/innerHeight` и доступную layout/visual viewport информацию. Размер окна приложения не равен этому размеру. |
| **Размер панели** | Место под native content view без tab bar/address/controls. LayoutService сообщает geometry; BrowserPanelAdapter преобразует координаты и применяет bounds. Не подменяет настройку виртуального устройства. |
| **Масштаб страницы** | Browser zoom, влияющий на отображение и фактический viewport. Сохраняется отдельно, имеет actual readback и проверенную область действия. Это не масштаб интерфейса всего приложения. |
| **Вписать превью** | Только отображение большого заданного viewport в доступном месте. Контент продолжает рассчитываться для заданных CSS-размеров; если adapter не умеет это делать с корректным input mapping, Fit недоступен с причиной. Нельзя незаметно уменьшить layout width. |
| **DPR / разрешение изображения / экран** | DPR — наблюдаемое отношение pixels к CSS px; screenshot имеет собственную измеренную pixel width/height. Физический/виртуальный Display ОС, emulated screen и размер capture — разные данные; выбор viewport не меняет разрешение монитора. |

`innerWidth` включает полосу прокрутки, если она есть; для содержимого без неё хранить отдельный `documentElement.clientWidth`, не объявлять эту разницу ошибкой настройки. [MDN: innerWidth](https://developer.mozilla.org/en-US/docs/Web/API/Window/innerWidth). Page zoom меняет `devicePixelRatio`; pinch zoom имеет другую семантику. Поэтому DPR не вычислять из одной настройки Windows и не считать неизменным после zoom. [MDN: devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio).

В UI слово **«Разрешение»** без единиц не использовать: «Страница 390 × 844 CSS px», «Снимок 780 × 1688 px» — разные поля. Последние числа здесь только пример, не гарантированная формула capture. Размер изображения брать из полученного артефакта; OS scaling/DPR/zoom/fit не перемножать вслепую. Не требовать от пользователя настраивать DPR для обычной проверки responsive layout.

## 3. Проверенные поверхности и зависимость от версии

Это факты текущих официальных docs; target adapter сверяет их с **установленным** Electron/Chromium, а не обновляет приложение вслепую:

| Поверхность | Установленный факт |
|---|---|
| Native View | `setBounds`/`getBounds` управляют геометрией относительно parent. Это не CSS transform контейнера. [View](https://www.electronjs.org/docs/latest/api/view#viewsetboundsbounds-options) |
| WebContentsView | Main-owned view для WebContents; один экземпляр WebContents не отображается одновременно в двух таких views. [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) |
| Browser metrics | `enableDeviceEmulation` имеет `viewSize`, `screenPosition`, `screenSize`, `deviceScaleFactor`, `scale`; `disableDeviceEmulation` отменяет этот override. [API](https://www.electronjs.org/docs/latest/api/web-contents#contentsenabledeviceemulationparameters) |
| Zoom | `setZoomFactor`/`getZoomFactor`; default policy может связывать same-origin страницы. `setZoomMode('isolated')`/`getZoomMode` отмечены как добавленные в **Electron 44**. [API](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoommodemode) |
| Navigation и capture | Текущие docs направляют history controls к `navigationHistory`; `capturePage` без rect снимает видимую страницу. `sendInputEvent` требует focus окна. [webContents](https://www.electronjs.org/docs/latest/api/web-contents) |
| Display | `scaleFactor` относится к output device, `workArea` задан в DIP; display бывает виртуальным. [Display](https://www.electronjs.org/docs/latest/api/structures/display) |
| Расширенная эмуляция | CDP описывает device metrics, touch и user-agent overrides; tip-of-tree не является схемой любого установленного Chromium. [Официальный Emulation domain](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/) |

Инженерное следствие: выбрать **одного** владельца viewport overrides. Не применять одновременно Electron emulation и несогласованный CDP metrics override от другого automation клиента. Существующий проверенный adapter сохраняется; при расширении фиксируются mechanism/version, доступные команды, границы и результаты canary.

## 4. Размеры, ориентация, zoom и Reset

**Адаптивный** — default: actual viewport следует свободному пространству вкладки с учётом реального zoom. **Фиксированный** — заданные W/H. Стартовые собственные presets: 390×844, 768×1024, 1280×800, 1440×900 CSS px плюс Custom. Это удобные product values, не официальные характеристики iPhone/другого устройства и не полный responsive coverage.

W/H — конечные положительные целые в безопасном product range, например 240–4096 на сторону как стартовая ограничиваемая policy. Нулевой/отрицательный/NaN/слишком большой ввод даёт адресную ошибку; не менять молча requested на другое число. Поля применяются одним действием Enter/выбором пресета; drag-resize coalesce-ится владельцем, без dispatch на каждый render. Фактический clamp/неподдержанный размер отображается рядом с requested, не как exact success.

**Ориентация** в M3 меняет W↔H; квадрат остаётся квадратом. Это проверка геометрии, не обещание мобильного touch, датчиков, экранной клавиатуры, user agent или `screen.orientation`. Advanced preset M7 отдельно задаёт поддерживаемые свойства и показывает, какие действительно применились.

Fixed viewport должен реально менять измерения страницы и media-query поведение. Когда он больше панели, использовать доказанную adapter-схему metrics + fit, увеличить/move панель или показать честно обрезанный viewport с доступной навигацией. Сам по себе `setBounds` маленького прямоугольника не доказывает 1440 CSS px внутри него. Нельзя выдать статическую картинку за интерактивный browser. В режиме fit координаты/DOM targets должны соответствовать той же живой странице; внешний CSS scale native view не считать работающей реализацией.

**Zoom**: UI предлагает поддержанные значения, например 75/90/100/110/125/150/200%, и actual значение. Target probe проверяет две same-origin вкладки: при поддержке isolated mode применить его и проверить readback/соседнюю вкладку. На старом runtime не обещать tab-local zoom/reset; показать обнаруженный origin scope либо оставить неподдержанный per-tab вариант недоступным. Не разделять profile/cookies молча ради обхода и не путать fit scale с browser zoom. Выбранные product значения не меняют допустимую схему API.

**Сбросить размер** → adaptive desktop viewport, clear только собственных metrics overrides. **Масштаб 100%** → отдельно browser zoom reset с фактической областью действия. **Сбросить эмуляцию** M7 → восстановить сохранённую baseline конфигурацию этого ресурса: metrics, DPR override, touch/UA overrides, visual scale, затем readback. Не сбрасывать cookies/auth или настройки другой вкладки. Если reset частично не подтверждён, UI показывает partial/unknown и последующие действия не используют старые размеры как истину.

После docking/размера окна/смены дисплея/OS scale обновить bounds и actual measurements. Fixed W/H не должны превращаться в adaptive от простого сужения панели. Header, tabs и overlay не покрываются native page. Geometry обновляется после события/следующего layout frame без необходимости двигать мышью или делать ещё один клик; details показывают viewport revision/time наблюдения.

## 5. Один контракт ручного и агентского управления

Внутренние host DTO, **не новые поля ACP**:

```text
BrowserTarget = projectId, taskId, browserProfileId, tabId, resourceGeneration
BrowserObservation = target, navigationGeneration, viewportRevision, observedAt
  actualUrlRef, origin, pageTitle, canGoBack, canGoForward, loading/error
  requestedViewport, actualLayoutViewport, visualViewport?, clientArea?
  browserZoom, zoomScope, fitScale, observedDpr, emulationManifestRef?
BrowserCommand = operationId, target, expectedNavigationGeneration
  expectedViewportRevision?, controlRevision, action, validatedArguments
  actor(user|agent), authorizationRef
```

BrowserService — единственный writer. Task/tab ownership и поколения берутся из доверенной регистрации; модель не получает доступ по одному присланному ей tabId. `navigationGeneration` инвалидирует document targets, `viewportRevision` — геометрические observations; fragment/SPA navigation тоже обновляет актуальную URL/state проекцию по реальным событиям. Late callback старого ресурса не меняет выбранную вкладку нового окна.

Все полезные controls доступны агенту через **реальные** narrow operations существующего browser adapter: list/read собственных tabs, open/navigate/history/reload/stop, rename/close с lifecycle, read/set viewport/orientation/zoom/reset, permitted locate/click/fill/scroll/wait/screenshot. Имена здесь описывают операции; точные MCP tool names/schema необходимо обнаружить или реально реализовать и зарегистрировать. Не объявлять `browser.setViewport` или ACP extension существующим только потому, что его имя удобно.

Порядок одной automation операции: проверить captured target/authorisation/revisions → сохранить intent → выполнить разрешённый adapter call → получить actual observation/receipt → опубликовать UI projection. Setter success без измерения не доказывает нужный viewport. Если был dispatch, но ответ потерян, сначала read/reconcile; повтор неизвестной формы/закрытия/навигации не маскировать как безобидный retry. Ordinary read/resize внутри уже разрешённой задачи не требует отдельного modal.

При ручном изменении controls host увеличивает control revision и приостанавливает зависимую queued automation. «Забрать управление» прекращает новые agent dispatch; уже отправленное действие сверяется, не считается отменённым по нажатию. Старый click по координатам после resize отклоняется/требует нового observation. Пользователь не борется с бесконечным возвратом агента к прошлой ширине. Возврат агенту сохраняет текущие размеры и явный новый контекст; выбранная другая Task не становится адресатом прежней команды.

Bridge reuse определяется [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md): actual MCP discovery, connection binding и target isolation. Если инструмента нет, показывать конкретное unsupported/unknown, можно оставить ручное управление и доступный screenshot; не заявлять завершённую agent automation. Страница не получает Node/привилегированный preload/общий IPC. Навигация, submit, download/upload, popups и auth следуют уже существующей effects policy; не вводить blanket новое разрешение через профиль или «режим дизайнера».

## 6. Что агент получает для responsive проверки

Не пересылать весь browser state после каждого события. В task packet — актуальный минимальный observation, критерий и refs последнего screenshot/DOM. Остальные события остаются локально по [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md). Снимок берётся с разрешённой вкладки приложения, не с рабочего стола ОС; чувствительный вход/MFA проходит без model capture.

Screenshot manifest содержит artifact/hash, Task/tab/generations, app build и страницу/build если известны, UTC/sequence, actual CSS viewport, observed DPR/zoom/fit, реальные pixel dimensions, scroll position и bounded состояние. DOM и screenshot имеют отдельные timestamps; навигация между ними означает несовпадение, а не единый доказанный кадр. Маскировка/отсутствующий участок отмечаются явно.

Рецепт: выбрать relevant preset → подтвердить actual viewport → проверить конкретный элемент/overflow/действие → screenshot + bounded DOM/receipt → изменить размер/ориентацию → повторить затронутый сценарий. Обычно достаточно двух нужных размеров и одного плохого случая; не гонять всю матрицу устройств для текста кнопки. Скриншот макета не доказывает работоспособность настоящей страницы, а успешный click не доказывает backend save.

Console/network/timing доступны только если adapter действительно наблюдает их; показывать capture interval, missing/omitted и redaction. Сетевой trace не равен «все запросы страницы учтены», DOM read не равен визуальному осмотру. Advanced mobile emulation не доказывает реальный Safari/iOS, физическую клавиатуру, производительность устройства или hardware DPI.

## 7. Карточки реализации

| Карточка | Этап | Малый реализуемый результат и проверка |
|---|---|---|
| **BC1 — настоящие browser controls** | M3.5/D3 | Reuse tabs/navigation: +, title/favicon, ×, double-click/F2/context rename, Enter address без Go; external-open и panel maximize/restore, отдельный window fullscreen. History/loading/error реальные. Close/rename невыбранной вкладки адресует её ID; panel hide сохраняет ресурс; новый title не затирает custom label. Draft URL не отправляется наружу, запрещённая схема не исполняется; maximize/restore сохраняет ресурс и fixed viewport, OS fullscreen имеет actual receipt. |
| **BC2 — viewport и измерения** | M3.5/D3 после geometry adapter | Adaptive/fixed W/H, presets, swap, zoom, fit при поддержке, раздельный reset. Один изменённый CSS breakpoint наблюдается в живой странице; две same-origin tabs выявляют scope zoom; смена размеров/окон обновляется без дополнительного input. |
| **BC3 — агент управляет тем же браузером** | M3.5/D3 после минимального MCP bridge | Actual discovery→read target→set viewport→readback→permitted action→screenshot artifact. User takeover и stale navigation/viewport предотвращают действие по старой геометрии. CLI не патчится, fake tool call не принимается за выполнение. |
| **BC4 — подтверждённая device emulation** | M7/D8 | Выбранный adapter расширяется DPR/screen/touch/UA/orientation и адресным network/timing capture. Каждый knob имеет applied manifest/границы/readback; reset действительно возвращает baseline. Неподдержанный knob не изменяет остальные и не выдаётся за полноценный телефон. |

Автоматизировать pure проверки target/revision/CAS, валидации размеров, orientation swap, apply/reset manifest, URL/label state и late callback. Known_bad: неправильный tabId, потерянная generation или fabricated actual viewport должны приводить к отказу/unknown, а не pass. Empty screenshot/недоступный adapter — недостаточно evidence.

На целевом Electron провести адресный live сценарий: две tabs → переименование невыбранной → Enter URL → history/reload/stop → fixed desktop и narrow viewport → реальная кнопка/форма тестовой страницы → rotate → screenshot/readback → docking/OS 150% или 200% если доступно → reset. Проверить отсутствие наложения native content на controls и отсутствие требования двигать мышью для обновления. Если CI не имеет такого display, явно not_run и отдельно доступные проверки. Вторая часть — одно реальное агентское действие через установленный Giga/MCP adapter на той же странице/build.

Для последних controls проверить отдельно: изменить адрес без Enter и открыть наружу — открывается committed URL выбранной вкладки; custom scheme отклоняется; ошибка shell call не скрывает внутреннюю страницу. Развернуть/вернуть панель в adaptive и fixed режимах — прежние tabs/forms/другие ресурсы живы; F11 показывает реальное состояние окна, а page fullscreen не подменяет этот режим. Если внешний браузер недоступен автоматизации, receipt запуска не называть доказанной загрузкой/управлением сайтом.

План тестирования здесь не выполнен. Отчёт реализации разделяет unit, actual Electron и actual Giga/tool delivery, фиксирует точные runtime versions и ограничения. После правки label не требуется повторять весь browser/certification набор.

## 8. Поручение небольшой модели

```text
Реализуй только BC<n>. Сначала найди существующие BrowserService,
PanelRegistry, automation adapter и версии Electron/Chromium.
Сохрани реальные tabs, вход и права. Измерь текущую геометрию.
Не смешивай CSS viewport, panel bounds, browser zoom, fit и DPR.
Привяжи команды к tabId+generations, UI — к actual observation.
Покажи один полезный живой сценарий и один отказ stale target.
Не меняй CLI и не выдумывай MCP/ACP методы. Отметь not_run честно.
```

Читать нужную карточку и связанный раздел, не весь browser/security/reference corpus на каждый шаг.
