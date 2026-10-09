# Браузер агента, снимки и корпоративная идентификация

Исследование первичных источников: **2026-10-09**. Это план для существующего Electron UI, не реализованная интеграция и не результат проверки корпоративной Windows. Electron/Chromium, политики организации, криптопровайдеры и способы авторизации на целевой машине пока неизвестны. GigaCode **26.9.75 остаётся неизменённым**. Требование пользователя: работать во встроенном браузере, управлять страницей, получать screenshots и анализировать поведение, используя доступные пользователю способы входа.

Минимальное реальное управление и screenshot входят **уже в M3**; M7 расширяет диагностику и сценарии. Это уточняет прежнюю границу, где вся automation откладывалась до M7. Общие owners/layout остаются из [PANELS_AND_IDE](PANELS_AND_IDE.md); полномочия — из [MCP_PROFILE_SETUP](MCP_PROFILE_SETUP.md), контекст — из [CONTEXT_BUDGET](CONTEXT_BUDGET.md), Task/run — из [TASK_WORKSPACE](TASK_WORKSPACE.md).

## 1. Что означает «доступ как в других браузерах»

Это несколько независимых возможностей. Успешное открытие сайта в Edge — полезный контрольный пример на той же машине, но не доказательство, что Electron уже получил все его настройки.

| Возможность | Реалистичная цель | Что проверять отдельно |
|---|---|---|
| Доверие серверному TLS | Использовать нормальную проверку цепочки и доступные корпоративные trust roots | Hostname, срок, chain, revocation, корпоративный proxy и фактическая версия Chromium |
| Клиентский сертификат mTLS | Выбрать подходящую личность из кандидатов браузера для конкретного сайта | Private key, issuer/EKU/алгоритм, доступ текущего Windows user, smart card/provider |
| Windows SSO | Разрешённые intranet origins используют поддержанную integrated authentication | NTLM/Negotiate, доменная среда, SPN/политики; delegation не включается автоматически |
| Proxy/PAC/VPN | Соответствовать проверенному сетевому маршруту | System/explicit proxy, PAC, bypass, proxy auth, DNS/VPN |
| Cookies/вход на сайте | Один раз войти в выбранном профиле приложения и сохранять его сессию | Отдельный профиль и cookies Electron, MFA/SSO redirects, срок сессии |
| Password manager/расширение/подпись | Только отдельно подтверждённая интеграция | Chrome/Edge passwords, cookies, profiles, extensions и signing plugins **не импортируются автоматически** |

Не направлять `userData` приложения на рабочий профиль Chrome/Edge, не копировать его SQLite/cookies и не расшифровывать пароли для «совместимости». Основной путь — собственный persistent browser profile и штатный вход. Если сайт зависит от расширения, специфического TLS/криптопровайдера, проверки устройства или политики управляемого браузера, это отдельный compatibility item. Наличие сертификата не добавляет отсутствующий алгоритм или signing plugin.

## 2. Проверенные API: доверие, сертификат и вход

**Windows trust и mTLS различаются.** В текущем Chromium `TrustStoreWin` собирает пользовательские/машинные и policy trust stores; отдельно `ClientCertStoreWin` обращается к `MY`, фильтрует client-auth кандидатов и получает ключ через платформенный путь. Это основание проверять системную интеграцию, не гарантия эквивалентности любой версии Electron и Edge. [Trust store source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cert/internal/trust_store_win.cc), [client certificate source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/ssl/client_cert_store_win.cc). Прочитаны `main` на дату исследования; при реализации сопоставить Chromium revision установленного Electron.

**Проверка серверного сертификата.** `session.setCertificateVerifyProc` позволяет получить результат проверки; `-3` сохраняет решение Chromium, `null` возвращает default verifier. `0` принимает сертификат и отключает Certificate Transparency verification — это не «включить доступ к системным сертификатам». Не добавлять blanket `callback(0)`, `certificate-error → true`, `ignore-certificate-errors` или `ignoreHTTPSErrors`. При ошибке показать домен, код и источник диагностики; устранять подтверждённую причину цепочки/сети, не отключать TLS-проверку. [Session API](https://www.electronjs.org/docs/latest/api/session#sessetcertificateverifyprocproc).

**mTLS selector.** `app` событие `select-client-certificate` предоставляет URL, кандидатов и callback; `preventDefault()` предотвращает автоматический выбор первого. Выбирать запись из полученного списка; отсутствие выбора отменяет передачу сертификата. `webContents` может быть `null` для запросов вне renderer — нельзя приписывать такой challenge активной вкладке. Событие `login` обрабатывает HTTP authentication, содержит `authInfo.isProxy`; это не универсальная форма HTML/MFA. `setClientCertRequestPasswordHandler` в документации помечен **Linux**, не считать его Windows PIN API. [App API](https://www.electronjs.org/docs/latest/api/app#event-select-client-certificate), [login](https://www.electronjs.org/docs/latest/api/app#event-login).

В нашем selector показывать origin и понятную пользователю личность, issuer/срок и локальный fingerprint. Сохранять решение только для `browserProfileId + origin + certificate fingerprint`, с возможностью сброса и повторной проверкой после смены сертификата. Не выбирать случайный `list[0]`. При пустом списке/недоступном ключе объяснить точное наблюдение; «сертификатов нет вообще» из этого не следует. В журнал — opaque cert reference и исход, без PEM, private key, PIN, password и полного персонального subject.

**Smart card.** Windows использует CSP/KSP и драйверы/минидрайверы для доступа к ключам; конкретная карта/алгоритм требует совместимого пути. [Microsoft smart-card architecture](https://learn.microsoft.com/en-us/windows/security/identity-protection/smart-cards/smart-card-architecture). Предпочитать использование ключа через установленный системный provider без экспорта. PIN/MFA вводит пользователь в штатной форме; агент не получает секрет. Наличие записи в selector ещё не доказывает успешную подпись TLS handshake. Ни драйверы, ни trust store автоматически не менять.

**SSO и proxy.** `allowNTLMCredentialsForDomains` задаёт серверы NTLM/Negotiate; применять узкую подтверждённую domain allowlist данного профиля, не `*`. [Session auth API](https://www.electronjs.org/docs/latest/api/session#sesallowntlmcredentialsfordomainsdomains). Delegation имеет отдельную настройку и не нужна по умолчанию. [Electron switches](https://www.electronjs.org/docs/latest/api/command-line-switches#--auth-negotiate-delegate-whitelisturl). `ProxyConfig` поддерживает `system`, `pac_script`, `fixed_servers`, `auto_detect`, `direct`; явный `system` отличается от отсутствия настройки, на которую могут влиять launch flags. [ProxyConfig](https://www.electronjs.org/docs/latest/api/structures/proxy-config). Сначала проверить текущий маршрут, затем при необходимости адресно настроить app session; не переписывать настройки Windows/других браузеров. Proxy credentials вводятся отдельно от сайта и не отправляются модели.

## 3. Профиль браузера и область доступа

В UI пользователь выбирает browser profile проекта: например, «Рабочий», «Тестовый» или временный. Host хранит stable `browserProfileId`, project binding, partition reference, network policy, разрешённые origins и certificate preferences. Название профиля — подпись, не ключ безопасности.

Electron `session.fromPartition` переиспользует session с тем же именем; `persist:` делает её постоянной, без префикса — in-memory. [Session partitions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options). Поэтому session выбирается при создании ресурса; существующую вкладку нельзя незаметно переименовать в другой профиль и объявить cookies изолированными. Смена профиля — новая явно связанная вкладка/ресурс, без уничтожения старого входа.

Project задаёт доступные профили; Task выбирает конкретный browser resource; роль получает только нужные операции и origins. Сертификаты Windows и доменная identity могут быть общими для пользователя ОС: partition разделяет browser storage, **не создаёт отдельную Windows identity и private-key sandbox**. Авторизацию доступа обеспечивает broker и выбор личности, а не строка partition. Для разных проектов отдельные profiles — default; общий профиль возможен по выбранной пользователем связи.

У панели видны профиль, фактический origin, Task binding и индикатор «Агент управляет». «Забрать управление» останавливает новые automation dispatch и даёт завершить/сверить in-flight действие. Обычные разрешённые read/navigation/click/fill внутри задачи не требуют вопроса на каждый шаг. Новая identity/origin, отправка формы с внешним эффектом, download/upload или выход за полномочия оцениваются по уже данному разрешению и конкретному действию. `GET` и название кнопки сами по себе не доказывают отсутствие эффекта.

## 4. M3: минимальное управление настоящей встроенной вкладкой

Использовать существующий BrowserService и PanelRegistry. На совместимом Electron `WebContentsView` — main-owned представление; один WebContents одновременно принадлежит одному такому view. [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view). Move/hide/resize меняют attachment/bounds, не создают новую identity, сессию или повторный запрос.

Подробные tab controls, viewport W/H/ориентация, browser zoom/fit/DPR и единый ручной/агентский adapter определены в [BROWSER_WORKSPACE_CONTROLS](BROWSER_WORKSPACE_CONTROLS.md): BC1–BC3 входят в M3.5/D3, advanced device emulation BC4 — M7/D8. Размеры панели не выдаются за измеренный CSS viewport; actual readback и target generations обязательны. Переименование/× адресуют tabId, адрес открывается Enter без кнопки «Перейти».

Ранний adapter реализует: открыть разрешённый URL/вкладку; получить bounded текст/DOM или accessibility snapshot; нажать/ввести/прокрутить по актуальному target; дождаться конкретного состояния; снять видимую страницу. Названия этих операций — **внутренний контракт**, не обещанные имена MCP/ACP tools. Сначала проверить фактический adapter на простой контролируемой странице, потом на разрешённом корпоративном сайте.

Для screenshot есть `webContents.capturePage`: без rect захватывается видимая страница, не весь прокручиваемый документ и не рабочий стол. `sendInputEvent` требует focus содержащего окна; не обещать ему фоновую automation. [webContents API](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts), [input constraint](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent). Не воровать focus неожиданно у пользователя; при такой зависимости показать ограничение или выбрать проверенный CDP adapter.

M3 не должен закончиться только браузером для ручного просмотра: приёмка — агент через **реальный зарегистрированный tool** открывает свою вкладку, читает состояние, выполняет разрешённое действие, получает screenshot и связывает вывод с наблюдением. Если tool/vision недоступен, capability = absent/unknown и причина; обычный текст «я сделал screenshot» не заменяет артефакт.

## 5. Automation transport без доступа к оболочке и чужим вкладкам

Предпочтительный небольшой spike — backend adapter к конкретному `webContents.debugger` с фиксированным allowlist операций. Electron даёт CDP attach/sendCommand и событие detach; открытие DevTools может разорвать attachment, что нужно обработать. [Debugger API](https://www.electronjs.org/docs/latest/api/debugger). Это не основание передать модели произвольный CDP method, JavaScript, `Target.*` или объект Electron. Read/locate/action реализуются проверенным adapter; page script остаётся недоверенным содержимым.

Playwright — возможная реализация после проверки версий. `connectOverCDP` работает только с Chromium и имеет меньшую полноту, чем native Playwright connection; необычные launch options также влияют на поддержку. [BrowserType](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). `_electron` — experimental API для запуска/проверок Electron и даёт в том числе main evaluation; **не выдавать его целиком агенту в продукте**. [Electron automation](https://playwright.dev/docs/api/class-electron).

Electron поддерживает `remote-debugging-port`; он открывает HTTP debugging endpoint. [Switch documentation](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport). Не включать общий debug port всей оболочки ради M3, не считать localhost аутентификацией. Если внешний адаптер требует endpoint, выделить контролируемый browser runtime либо broker и проверить его поверхность/доступ; он не должен перечислять shell renderer, другие проекты или чувствительные tabs. Встроенный конкретно-targeted adapter обычно позволяет начать без общего endpoint.

Каждый вызов проверяет authority вызывающего agent/role, `projectId/taskId`, выданный tab capability, tab/frame ID, navigation generation, текущий origin и operation scope. Эти поля берутся из доверенной регистрации, не из одного произвольного JSON модели. После навигации/замены ресурса старые selectors/handles недействительны. На tab — один writer действий; параллельные задачи получают отдельные tabs, без общего `activeTab` как адресата in-flight команд. Popups/SSO redirects получают контролируемую связь и собственную проверку origin.

В удалённой странице: Node integration выключена, context isolation/sandbox включены, privileged preload/IPC оболочки отсутствует; сохраняются web security и проверка sender. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security). Текст страницы, DOM и screenshot — evidence, не инструкции на расширение доступа, установку ПО или чтение другой вкладки.

## 6. Как дать инструменты неизменённому GigaCode

Сначала discovery существующего MCP inventory: actual tool names, schemas, transport, screenshots/image return и методы ограничения target. Если имеющийся browser MCP управляет другим браузером, он не становится adapter встроенного WebContents автоматически.

При отсутствии подходящего MCP приложение может реализовать свой узкий browser MCP bridge к BrowserService и подключить его **поддерживаемым этой установкой способом**. Сначала тест discovery/invocation, затем profile bindings с разрешёнными tools; не заявлять настройку готовой только потому, что JSON написан. ACP extension используется лишь при обнаруженном и проверенном capability/контракте форка. Стандартное присутствие ACP само по себе не даёт native browser tool.

CLI subprocess получает только разрешённый канал; bridge связывает подключение с role/task authority и проверяет target на каждой операции. Модель не получает cookie jar, private keys, пароль, browser storage или общую shell authority «для удобства». Узкая browser операция возвращает outcome/evidence refs. При неизвестном результате отправки формы — journal pending + reconciliation; повтор prompt или click после reconnect не выполняется автоматически.

## 7. Screenshots и анализ поведения как evidence

Запись содержит `artifactId/hash`, UTC, project/task/role, browserProfileId, tab/webContents ID, navigation generation, безопасный URL/origin, viewport/DPR/zoom, observed state и связанную operationId. У локального preview — build/source revision, у внешнего сайта — наблюдаемая версия либо unknown. Снимок и DOM получены не атомарно: фиксировать их порядок/время; если навигация между ними изменилась, переснять или отметить несовпадение.

Рецепт проверки: исходное состояние → разрешённое действие → ожидание проверяемого условия → screenshot + минимальный текст/DOM → сравнение с criterion. Screenshot доказывает видимое состояние, но не backend success, отсутствие console errors или все ветки сценария. Ответ API/receipt/фактические данные проверяются отдельно. DOM без изображения не называть визуальным осмотром.

Перед отправкой модели исключать пароли, PIN, auth codes, токены в URL и лишние персональные данные; вход/MFA можно выполнить в ручном takeover без model capture. Нельзя обещать универсальное автоматическое распознавание всех секретов. Screenshot относится только к выбранной разрешённой вкладке, не к экрану со всеми окнами. Политику сохранения raw/redacted evidence определить для проекта; не складывать чувствительные изображения в поставляемый пакет.

В контекст по [CONTEXT_BUDGET](CONTEXT_BUDGET.md) идёт актуальный нужный screenshot/фрагмент и короткий результат; остальные — artifact refs, без base64 в журнале и без снимка после каждого timer tick. Vision и image return должны поддерживаться выбранной моделью через реальный Giga transport. Иначе доступен текстовый анализ и просмотр человеком, но не подтверждённый визуальный анализ моделью.

## 8. M7: расширение после работающего M3

Добавить адресные console/network evidence с очисткой headers/bodies, trace/timeouts, frames/popups, downloads/uploads, многосоставные сценарии и повторяемые regression checks. Проверить auth redirects и session expiry, а не только публичную страницу. Video/full-page capture/performance tracing вводить по конкретной задаче и измеренному overhead. Не создавать второй BrowserService; расширять проверенный adapter.

Карточки реализации: **B0** inventory версий/сети/identity → **B1** выбранный project profile и corporate login probe → **B2** узкий adapter + реальные tool bindings → **B3** действие/screenshot/evidence в M3 → **B4** расширенные M7 сценарии. Для B0/B1 достаточно безопасного чтения и входа в уже разрешённый сайт; не переустанавливать сертификаты/драйверы или браузеры автоматически.

## 9. Проверки на рабочей Windows

Матрица — предлагаемые тесты, **здесь не выполнены**. Прогонять только нужные пользовательские способы входа; неподдержанный кейс отмечать явно.

| Сценарий | Наблюдаемая приёмка |
|---|---|
| Корпоративный TLS | Реальный нужный сайт открывается с обычной проверкой; неправильный hostname/недоверенный тестовый cert не получает blanket bypass |
| mTLS | Selector показывает подходящих кандидатов; выбранный cert действительно принимается сервером; отказ/пустой список понятны; журнал не содержит ключа/секретов |
| Smart card/provider, если используется | Вход с картой/PIN работает на установленном provider; извлечение карты/отмена PIN не зависают и не считаются успехом |
| SSO/proxy/PAC | Реальный intranet и нужные redirects работают; неподходящему домену Windows credentials не делегируются; proxy auth отличён от site auth |
| Профили A/B | У профилей разная browser storage; роль A не управляет tab B; совпадение Windows identity не маскируется как credential isolation |
| Реальный agent tool | Giga обнаруживает разрешённый tool, выполняет одно проверяемое действие и получает настоящий screenshot; артефакт связан с правильной Task/navigation |
| Stale target и reconnect | После навигации, закрытия/move/hide и debugger detach нет клика в старую/чужую вкладку и повторной отправки формы |
| Отрицательная граница | Попытка shell renderer/чужого tab/arbitrary CDP отвергается; страница не вызывает privileged IPC и не расширяет роль инструкциями в DOM |
| Observer | clean подтверждает заданный результат; known_bad ловит неправильный origin/target/state; пустой screenshot/отсутствующая tool выдача — insufficient evidence, не pass |

Отчёт: реальные версии Windows/Electron/Chromium/Giga, profile и способ входа без секретов, сайт/критерий, выполненные действия, результат, evidence refs и unsupported/unknown. Итог «доступны все сертификаты и всё как в Edge» допускается только для конкретного проверенного перечня; универсальную совместимость заранее не обещать.
