# Создание живых макетов внутри GigaCode UI

Статус: контракт реализации, **не готовый генератор и не подтверждение запуска GigaCode на Windows**. Дата: 2026-10-10. Пользователь создаёт макет разговором с агентом, открывает его прямо в приложении, проверяет поведение, оставляет замечания и получает новую версию. HTML/CSS/JS и компоненты пишет неизменённый GigaCode CLI через реально доступные file tools. Host отвечает за версии, preview, изоляцию, связь с Task и проверяемые результаты.

Переиспользовать [Artifact/EditSession](ARTIFACTS_AND_QUESTIONS.md), [Task](TASK_WORKSPACE.md), [PanelRegistry](PANELS_AND_IDE.md), [BrowserService и MCP bridge](AGENT_BROWSER_AND_IDENTITY.md), [очередь](SMART_MESSAGE_QUEUE.md), [дизайн-процесс](DESIGN_IMPLEMENTATION_GUIDE.md) и [бюджет контекста](CONTEXT_BUDGET.md). Не создавать второй registry материалов, браузерный backend или workflow engine. Это развитие M3 bindings и M6 artifacts; первый работающий preview нельзя откладывать до M8 canvas/variants.

## 1. Минимальный пользовательский цикл

1. В текущей Task пользователь пишет «Сделай макет экрана …». Агент использует принятые требования, текущую роль и выбранные источники; при достаточной ясности начинает, без обязательного wizard.
2. Агент создаёт один работающий экран с нужными состояниями в разрешённой области проекта. Host подтверждает файлы и показывает карточку **«Макет · v1»** с действиями **Открыть**, **Исходники**, **История**.
3. Preview открывается рядом с разговором. Внутри работают запланированные локальные взаимодействия; сверху доступны viewport, тема и именованное состояние. Fixture-данные явно отличаются от реального backend.
4. Пользователь нажимает элементы, оставляет обычный комментарий или отмечает область/элемент. **Отправить замечания** добавляет сообщение в ту же Task с точными artifact/version refs; во время занятого turn оно следует общей очереди.
5. Агент меняет отдельный draft на базе v1, открывает/проверяет результат и сохраняет v2. Старые замечания и screenshots продолжают относиться к v1; новая версия не наследует старый pass.
6. Пользователь сравнивает v1/v2, выбирает вариант, редактирует код или экспортирует выбранную версию. Принятый макет становится источником реализации через существующий requirement/decision flow, а не автоматически готовым production UI.

Нет обязательной генерации картинки или внешнего design SaaS. Первый полезный результат — исполняемый локальный прототип и видимые ограничения. В собственной оболочке скрытый spinner заменяется фактическими состояниями: файлы созданы → версия сохранена → preview загружен/ошибка → проверки выполнены/не выполнены.

## 2. Как агент создаёт файлы без выдуманных инструментов

Сначала capability inventory установленного bundled CLI: доступные workspace read/write/edit и фактические MCP schemas/allowlists. Использовать существующие инструменты Giga, если они есть. Не объявлять `create_mockup`, `open_artifact` или native ACP browser API уже установленными только потому, что такие имена удобны в плане.

Первый вариант — обычные файлы в выделенном Task draft directory: entry HTML + CSS + JS + разрешённые локальные assets. Для проекта с готовым frontend stack можно использовать его компоненты и существующий preview/build recipe; не переводить проект на React ради макета. Агент получает root, разрешённые пути и base version. Публикация в production-код/замена исходников проекта не является побочным эффектом генерации прототипа.

После file receipt host проверяет canonical path, symlink/reparse escape, scope, MIME/размер и комплектность, затем регистрирует snapshot. Если нет structured artifact event, допустим явный ответ с manifest как **proposal**, который host сверяет с реальными файлами; случайная ссылка в prose/логе не запускает preview. Watcher может обнаруживать изменения, но debounce не доказывает завершённую запись: нужны final manifest/commit intent и согласованные hashes, иначе версия остаётся draft/incomplete.

Если нужного file channel нет, показать ограничение и разрешить сохранение предложенного кода в Artifact editor пользователем. Отдельный host MCP для registration/preview — возможная реализация, которую сначала создают, тестируют, регистрируют и проверяют для выбранной роли. Текст промпта не устанавливает MCP и не даёт дополнительных прав.

Сборка компонентного прототипа — отдельная наблюдаемая backend operation с root, фиксированным проверенным recipe, deadline и output receipt. Renderer не запускает shell. Не выполнять присланный HTML как Node, не запускать произвольные package lifecycle scripts или установку зависимостей по одному preview click. Для раннего MVP достаточно HTML/CSS/JS без build step; для existing project использовать уже разрешённый tooling в его scope.

## 3. Одна схема Artifact, реальные версии и редактирование

| Запись/связь | Данные и инвариант |
|---|---|
| Artifact `kind=mockup` | Существующий stable ID, project/task, title, origin, current version и lifecycle; rename не меняет identity |
| ArtifactVersion | Immutable manifest: entrypoint, file IDs/relative paths, hashes/MIME/size, parent/base, creator/run/turn, requirement revision, tokens/theme/state recipe, assets provenance и build recipe/result refs |
| EditSession | Existing private draft + baseVersion/expected head + draft revision; autosave не меняет accepted version. Два окна/агент не перезаписывают один mutable buffer |
| Preview binding | Artifact/version либо явно помеченный draft revision, browser tab/view ID, connection generation, entry origin, viewport/theme/state, network profile и resource owner |
| Evidence | Screenshot/DOM/geometry/interaction receipts с точной version/draft hash, build fingerprint, viewport/DPR/zoom/theme/state, time и limitations; capture не является acceptance сам по себе |
| Annotation | Artifact/version, screenshot hash или target anchor, координатная система/viewport, исходный текст/автор и delivery refs. Это обычные комментарии ArtifactService, не отдельная база |

Прототип может быть интерактивным без возможности редактировать canonical source из самого preview. Код изменяется в общей EditSession; **Сохранить версию** проходит CAS и content hashing. При stale base сохранить обе стороны и предложить compare/merge/fork. **Создать вариант** создаёт новый Artifact с `derived_from` точной версии; это не новая Task автоматически.

Live preview draft разрешён: label **«Черновик»**, bounded refresh, сохранённый scroll/state по возможности, новый preview generation при смене bytes. Проверка draft не становится проверкой v2, пока его hash не совпал с committed snapshot. Обычный dev server/HMR с изменяемыми файлами не выдаётся за воспроизводимую immutable версию; для evidence фиксировать actual build/content snapshot либо отмечать coverage gap. Старый event не обновляет новую version.

Export выбирает конкретную версию: исходные HTML/CSS/JS/assets, код компонента в его настоящем формате, screenshot PNG; другие форматы — только при существующем exporter. Include manifest/provenance и необходимые license notices. Export не исполняет код, не устанавливает пакет и не меняет рабочий проект. Перенос принятого варианта в проект — отдельный Task шаг с контрактами и проверками.

## 4. Изолированный preview, которому не принадлежит приложение

Electron предоставляет `WebContentsView` с собственным `webContents` и `webPreferences`; это подходящий host для отдельного preview, если версия приложения его поддерживает. [Официальный WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view). Использовать existing BrowserService/PanelRegistry и владение ресурсами; не создавать новый BrowserWindow/CLI process для каждого раскрытия карточки. При detach/move менять только attachment и связанные listeners; preview/server остаются у resource owner. Освобождать их после явного закрытия ресурса по lifecycle policy; dirty draft сохраняется.

Базовые настройки preview: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`; **без preload основного UI** и без его IPC/секретов. Electron рекомендует изоляцию, sandbox, ограничение navigation/windows, permission handlers и CSP для недоверенного содержимого. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security). Это требования к реальной конфигурации и тестам, не гарантия безопасности от одного атрибута.

Предлагаемая host policy для generated preview: отдельный ephemeral session/profile без app/corporate cookies; network off по умолчанию, локальные version assets через ограниченный origin/protocol с проверенным path resolver. HTML/JS может менять собственную страницу, но не получает `require`, filesystem, process, app IPC, произвольный `file://`, shell, доступ к соседним артефактам или certificate/auth selection. Не отключать CSP/TLS/webSecurity ради удобства preview; локальный JS разрешать через конкретные bundled файлы/nonce-compatible recipe, а не произвольный remote script.

Navigation, redirects, popups, subframes, downloads, permissions и сетевые запросы проверяются host по назначению preview. `setWindowOpenHandler` может запрещать новые окна; `will-navigate` не покрывает все способы загрузки, поэтому ограничения применяются и к собственному `loadURL`/network policy. [webContents API](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler). Внешняя ссылка идёт через existing checked LinkService и явный пользовательский жест, не автоматический `shell.openExternal` из кода макета.

Для необходимых корпоративных assets пользователь один раз выбирает узкий разрешённый профиль/origin по [browser identity contract](AGENT_BROWSER_AND_IDENTITY.md). Это отдельный preview binding; generated code не получает автоматически все сертификаты, SSO/cookies и полномочия основного браузера. Предпочитать утверждённые локальные asset snapshots. Не превращать каждый клик в набор permission dialogs, но и не расширять профиль молча. Для macro-изменения профиля показать понятный scope.

## 5. Агент смотрит именно этот макет

Existing BrowserService registry связывает `previewId → project/task/artifact/version/view/generation`. Agent automation получает разрешение только на этот named preview; не на chrome оболочки, произвольные другие вкладки, закрытые корпоративные страницы или текущий фокус ОС. MCP tools должны реально существовать и быть обнаружены/проверены. Если их нет, host может сделать собственную кнопку screenshot, но не обещает агенту способность кликать до реализации bridge.

Минимум automation: открыть зарегистрированный preview, прочитать bounded DOM/accessibility/geometry snapshot, выполнить ограниченное действие над найденным элементом, сделать screenshot. Формы/fixture-buttons внутри автономного preview не равны внешней записи; переход в реальный сервис требует его обычного authorization scope. Не передавать агенту универсальный app IPC или произвольный host-code execution ради DOM inspection. Содержимое preview остаётся недоверенными данными, а не инструкциями для управляющего агента.

`webContents.capturePage` возвращает снимок видимой страницы/заданной области; это не автоматический снимок всего desktop или всей длинной страницы. [capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts). Capture receipt фиксирует loaded version, viewport, zoom/DPR, theme/state и актуальную generation; проверить загрузку локальных fonts/assets, readiness и отсутствие видимого error, а не считать один timeout доказательством готовности. Неудачный/пустой capture сохраняется как ошибка, а не «скриншот проверен».

Для просмотра снимка моделью нужна фактическая image capability и реальная доставка изображения. При её отсутствии сохранить screenshot для пользователя, DOM measurements — отдельно; агент не заявляет визуальную проверку по имени PNG. Geometry может выявить clipping/overlap/overflow, но не заменяет человеческую оценку композиции и не доказывает исправность Electron title bar, IPC, focus, resize, multiple windows или native menus. Их проверяют в настоящем приложении по [desktop contract](DESKTOP_STATE_AND_CHROME.md).

## 6. Темы, состояния, замечания и простой design recipe

Preview toolbar: **viewport**, **светлая/тёмная/системная тема**, **состояние**, **обновить**, **снимок**, **исходники**; меню — история/сравнить/вариант/export. Controls относятся к выбранному preview, не глобально к приложению. Неподдержанный theme/state обозначается честно; переключатель не должен просто менять label. Набор viewports берётся из задачи; для desktop сначала основной рабочий и минимально поддерживаемый размер, без обязательной mobile-матрицы.

Выделение области хранит screenshot coordinates + capture viewport/scroll/scale, element anchor — stable `data-*` ID/selector с boundary и snippet для проверки. Anchor не считается надёжным после изменения DOM; на v2 комментарий остаётся у v1, перенос предлагается с проверкой, а неоднозначный перенос виден. Текстовый комментарий доступен всегда, без требования попасть мышью в элемент. Отправка создаёт один queue item с comment IDs/baseVersion; double-click/restart не дублирует сообщение. Отправленное замечание не редактирует прошлый turn задним числом.

Для слабой модели перед каждой итерацией выдавать bounded recipe: **один экран → цель пользователя → основной сценарий → layout/иерархия → tokens → 2–4 релевантных состояния → критерии → файлы/разрешённая область → конкретная база версии**. Значения spacing/type/color брать из принятого проекта/design decision и записать в один token source; не генерировать новые произвольные значения для каждого элемента. Не переносить внешний вид Zidao. Использовать собственные [иконки](ICON_LIBRARY.md) и проверенные [asset rights](ASSET_RIGHTS.md); сторонние изображения/шрифты — с источником и условиями, без неизвестных remote imports.

Сначала каркас и основной сценарий, затем реальные relevant empty/loading/error/long-content states и keyboard focus. Fixture-данные, fake latency и mock action обозначены; прототип не заявляет реальную интеграцию, пока её нет. После каждого существенного визуального изменения: actual screenshot → конкретная критика структуры/плохой случай → точечная правка → повторная проверка затронутого сценария. Не переписывать весь макет из-за одного замечания и не запускать большую команду агентов на размер иконки.

В pack следующей итерации идут baseVersion, комментарии/delta, выбранные tokens, актуальные screenshots и нужные source spans. Полный журнал/все варианты/весь MCP каталог туда не копируются. Сохранённый screenshot старой версии — источник сравнения, не текущее evidence. Утверждение «стало лучше» требует наблюдения, не только ответа генератора.

## 7. Маленькие поставки вместо зависимости от целой IDE

| Карточка | Реализовать | Проверить до следующего шага |
|---|---|---|
| **NM0 — M3 binding** | Existing file→ArtifactVersion card→обычный viewer; scoped path/hash и real receipt | Missing file/path escape не получает карточку «готово»; old message открывает old version. Это фундамент, не обещание живого preview уже в M3 |
| **NM1 — приоритетный M6.5/D7, минимальный полный цикл** | Один HTML/CSS/JS mockup через реальные file tools, isolated preview, одно локальное взаимодействие, screenshot, свободный comment→queued delta→v2 | Агент действительно создал файлы; v1/v2 immutable; preview работает; image delivery/visual inspection подтверждены либо ограничение видно. Не ждать Monaco/canvas/full IDE |
| **NM2 — M6.2/M6.4 edit/fork/export** | Existing EditSession с простым text/code editor, CAS save, history/compare, fork, export выбранной версии | User/agent/two-window конфликт не теряет draft; old evidence не restamp; exported source совпадает по manifest |
| **NM3 — M6.5/D7 проверка макета** | Named-preview agent actions, viewport/theme/state recipe, DOM/geometry + actual screenshots, anchored comments | Действия и receipts принадлежат тому же Task/version; качество проверено в заявленных состояниях; ограничение native Electron QA видно |

Номер M6.5 сохраняет нумерацию основного плана, но не означает ожидания всех M6 viewers/exporters: первый узкий цикл NM1 строится на M6.1 registry сразу после готовности M3 binding. M8 добавляет развитые варианты/canvas/сравнение концепций поверх работающего цикла, а не впервые возможность Giga создать макет. Код редактора/renderer брать из существующего stack; готовые компоненты изучать по [OPEN_SOURCE_RESEARCH](OPEN_SOURCE_RESEARCH.md), без копирования чужого backend целиком.

## 8. Приёмка, границы доказательств и доставка

- **Clean:** создать настоящий интерактивный v1, выполнить сценарий, сохранить screenshot, отправить замечание, получить v2 и открыть обе версии после restart. Никакой LLM call на обычное раскрытие карточки/истории.
- **Known-bad:** intentional overflow, missing asset, broken interaction и console error обнаруживаются соответствующим проверяющим; красивый screenshot не закрывает failed interaction. **Empty:** нет файлов/DOM/image delivery/test run → insufficient evidence, не pass.
- **Isolation:** попытки получить Node/app IPC, чужой artifact path, непредусмотренный network origin, popup/download и корпоративные credentials не проходят; normal local prototype JS продолжает работать. Проверить на actual target Electron version, не только по конфигурационному тексту.
- **Races:** save в двух окнах, agent result по старой базе, HMR во время capture, переключение Task перед ответом, close/reopen preview и late event не смешивают versions/адресатов; грязный draft остаётся доступен.
- **UX:** keyboard focus и доступные имена controls, long labels, две темы если они входят в scope, два требуемых viewport и annotations на правильной версии; refresh не используется как лечение потери state. Измерения геометрии сохраняют единицы/viewport, screenshot не называется проверкой всего Electron UX.
- **Доставка:** текущий почтовый пакет содержит документы/текстовые recipes и разрешённую графику; **HTML/JS/executables в него не добавляются**. Giga материализует runtime prototype на целевом компьютере в разрешённой области. Пользовательский последующий export исходников — отдельное действие приложения, не изменение состава этого пакета.

Результат этого документа — план функции. До actual CLI/browser integration и выполненного цикла NM1 нельзя заявлять, что Giga уже умеет создавать, открывать и визуально проверять native mockup artifacts в пользовательской оболочке.
