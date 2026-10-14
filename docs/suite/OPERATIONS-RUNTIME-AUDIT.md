# Operations: итеративный аудит реализации

Срез `app/` 0.4.0-preview.1. **macOS:182 unit/protocol, 43 изолированных Electron UI, 23 настоящих серверных и 23 actual App сценария прошли. Windows нового среза ещё проверяется.** Здесь отделены доказанные дефекты, исправления, тестовые стенды и незавершённый объём. Этот документ не является заявлением полного соответствия OpenShift Console/Jenkins UI.

## Проверяемые уровни

- Обвязка: настоящий WorkbenchService/AtomicStore, транспорт ACP с изолированным peer, настоящие Electron Settings/Composer. Платные модели и корпоративные credentials не используются.
- Fault/protocol: HTTP HTML400/401/403/413/429, таймауты/обрыв после POST, изменившаяся MCP schema, задержанные ответы и конкуренция окон. Эти случаи явно не называются корпоративным live MCP.
- Backend live: закреплённый Jenkins2.580.1 с включёнными authentication/CSRF, реальные Folder/FreeStyle jobs и API token; два отдельных controllers. Native etcd3.6.8 + kube-apiserver1.36.2, собственные TLS CA/tokens/RBAC/CRD и отдельные порты.
- UI live: собранное приложение Electron, настоящий main/renderer/IPC/MCP и указанные тестовые серверы. Визуальная оценка screenshots проводится отдельно от существования элементов в DOM.
- Windows: собственный CI и его артефакты; результат предыдущей версии 0.3 не выдаётся за проверку нового кода.

Test servers не используют существующий JENKINS_HOME, kubeconfig, пользовательские clusters или рабочие deployments. Cleanup отслеживает конкретные test-owned PID и descendants. Raw homes и credentials не публикуются. WAR/plugins/envtest остаются за пределами исходного и desktop-пакета.

## Найденные и исправляемые дефекты

| Наблюдение | Причина / изменение | Проверка |
| --- | --- | --- |
| Ошибка записи журнала обрывала дальнейшие независимые ACP события | Общий отклонённый promise poisoning; цепочка восстанавливается без повторения неизвестного prompt | Backend regression, старый код как отрицательный контроль |
| Настройки затирали изменения из другого окна или поздний ввод пользователя | Сохранение только изменённых полей, rebase нетронутых, защита late ack | Семь настоящих Electron Settings сценариев |
| Полная запись памяти теряла параллельное дополнение | Обязательный SHA-256 CAS для replacement, атомарный remember | Backend + Electron conflict/reload |
| Jenkins progressiveText отклонял обычные логи или неправильно продолжал чтение | ConsoleNotes/CRLF raw offsets не равны видимым UTF-8 bytes; bounded redacted spool и непрозрачные страницы | Реальный Jenkins и fixture Unicode/offset/credential cases |
| Поиск Jenkins видел лишь текущую страницу/папку | Bounded paged BFS по каноническим полным путям; повторяемые TTL cursors и явная неполнота | Более 1000 jobs, nested denied folders, cursor retry/expiry |
| Поздний ответ вытесненного каталога восстанавливал orphan cursor | Проверка живого scan перед публикацией и sweep истёкших страниц | Управляемый held-read regression |
| Потерянный ответ POST разрешал повтор с новым ID | Durable unknown receipt блокирует ту же цель; только read-only reconciliation | Обрыв после принятого запроса, restart, zero extra POST |
| Ошибка записи receipt после успешного POST оставляла вечный dispatching | Orphan dispatch переходит в persisted unknown до сверки; сохранённый intent не повторяется | Инъекция journal EIO после фактического POST |
| Старая команда могла попасть на retarget connection в другом окне | Захваченные target/auth guards проверяются до outbound; отдельный cache сессии в host MCP | Настоящий HTTP host gateway + scope/stale tests |
| Kubernetes watch возвращал 406 | Accept должен соответствовать JSON watch | Native API watch + events/resourceVersion |
| Обычный YAML из GET не применялся | metadata.managedFields не допускается в SSA; удаление серверного поля из request | Native dry-run/apply;409 чужого владельца остаётся конфликтом |
| **DELETE предпросмотр действительно удалял тестовый ConfigMap** | DELETE с DeleteOptions body требует `dryRun:['All']` внутри body; query-only недостаточен | Прямой GET с тем же UID после prepare обязателен;404 только после execute |
| Create после preview мог изменить объект, созданный другим процессом | Отдельный createOnly и атомарный POST коллекции; гонка имени даёт 409 | Native create/race и zero overwrite |
| Parameterized Jenkins job без введённых значений выбирала неправильный endpoint | Признак реальной parameter schema сохраняется; defaults вызываются через buildWithParameters | Реальный controller и fixture |
| API secret мог превратиться в `[redacted]` внутри выполняемых данных | Secret-bearing mutation отклоняется до подготовки вместо изменения payload | Zero POST и неизменённые данные |
| Поздний Reveal A затирал выбранный B | Nonce + interaction epoch + target guards; ручная навигация инвалидирует pending reveal | Actual App с задержанным read через собственный forwarding proxy |
| Create same-name в другом namespace переиспользовал чужой черновик | Полная namespace/name identity в React и persisted draft keys | Два настоящих namespace и возврат к исходному draft без POST |
| Accepted Apply не обновлялся после host confirmation | Review следует persisted receipt; baseline обновляется только по совпавшему серверному RV и точному отправленному тексту | Actual App Apply + позднее редактирование |
| Первое открытие Jenkins без выбранной цели роняло renderer | Явная проверка наличия selected/connection перед сравнением; equal undefined не является guard | Настоящий начальный render без project/connection/discovery |
| Ошибка одного инструмента скрывала всё рабочее пространство | Локальная ToolBoundary, retry только своей панели; другие разговоры/инструменты живы | Изолированный Electron crash/retry с сохранённым sibling draft и timer |
| StrictMode effect replay оставлял prepare lock навсегда | Один pending read-only prepare с корректным mounted delivery; execute не повторяется | Изолированный dev-React Electron regression |
| localStorage check/write не был атомарным между окнами | Общее исключительное Web Lock на полный draft key; async flush/close barrier | Два Electron окна, конкурентный CAS и сохранённые конфликтующие buffers |
| Истёкший token нельзя было заменить до завершения unknown-операции | Credential-only rotation разрешена для того же target; старые prepared invalid, read-only сверка использует новую auth generation с сохранением исходной | Настоящий stdio MCP + HTTP: accepted PATCH/обрыв →401 → rotation → readback, без повторного PATCH |
| Jenkins detail показывал завершённую сборку, а строка каталога — старую и queued | Строка обновляется фактическим ci.job выбранной цели и адресно по изменившимся receipts; обход всего каталога не повторяется на каждом tick | Финальный actual App прогон проверяет номер, результат и снятие queue state |
| Служебный ConsoleNote отображался как длинный закодированный текст | Инкрементальное удаление полного envelope, включая границы страниц; raw upstream cursor не меняется | Chunk-boundary regression + настоящий Jenkins log с сохранением обычных строк |
| YAML и действия обрезались в двух desktop-панелях | При недостатке ширины детали занимают рабочую область с возвратом к сохранённому списку; навигация временно сворачивается, предпочтения не меняются | Actual App при 1440/1024, bounds редактора/Apply и maximize/restore с точным draft |
| Завершение сохранения старой панели могло сбросить новый выбор | После async persistence навигация сверяет lifetime исходной view, target и актуальный ввод | Controlled Electron regression с задержанным сохранением и сменой ресурса/подключения |
| Kubernetes name `..` нормализовался URL-парсером к другому ресурсу | Строгая проверка частей API-пути и соответствия возвращённой identity выбранному discovery target до capture/prepare | Zero wrong-scope outbound regression и прямой GET namespace/ConfigMap после отклонённого prepare |
| Same-origin Jenkins Location мог относиться к другому base context, а чужой queue/build — ошибочно подтверждаться | Exact context path для queue receipt и сверка queue/task/build association; несовпадение не подтверждает эффект | Два context paths на одном HTTP origin и ответы с чужими queue/build IDs |
| Вкладки Jenkins tests/stages никогда не вызывали встроенный read adapter | Probe объявляет доступность адаптера; наличие удалённого plugin API проверяется для конкретной сборки | Present/404 HTTP cases и actual Electron с настоящими 404 endpoints |
| Очередь Jenkins более 1000 элементов молча обрезалась | Явная ошибка превышения поддержанного объёма вместо частичного результата, выданного за полный | Bounded queue regression |
| Большой HTML ответ 429/403 терял статус и Retry-After | Non-2xx классифицируется по HTTP status/headers до чтения тела; тело отменяется без буферизации | Настоящие HTTP oversized/chunked429/403/500 и oversized200; прежний код проваливает negative control |

Предварительные неудачные прогоны сохраняются как failed evidence. Исправление в исходнике не переводит строку в live verified само по себе: нужен свежий успешный прогон, совпадающие source hashes и чистый cleanup.

## Текущие доказательства

После Operations integration на той же сборке повторно прошли [чат 3, PostgreSQL 44 и Data UI 25](evidence/operations-macos/regressions.json). Данные и внешний вид БД проверялись с настоящим изолированным PostgreSQL; это не snapshot-only проверка.

[Сводная проверка](evidence/operations-macos/verification.json), [native API23](evidence/operations-macos/native.json), [actual App23](evidence/operations-macos/desktop.json), [изолированный UI43](evidence/operations-macos/isolated-ui.json), [StrictMode/Web Locks/late-navigation14](evidence/operations-macos/review-ui.json). Финальный прогон 14.10.2026 09:24:09–09:25:38 UTC завершился с нулём renderer errors;26 исходников и 15 compiled artifacts сверены после выполнения, дрейфа нет. Все test-owned процессы закрыты. Платные модели не вызывались.

Настоящие снимки: Jenkins [dark](evidence/operations-macos/operations-jenkins-dark-darwin.png) / [light](evidence/operations-macos/operations-jenkins-light-darwin.png); Kubernetes [dark](evidence/operations-macos/operations-cluster-dark-darwin.png) / [light](evidence/operations-macos/operations-cluster-light-darwin.png); [1024px, две панели](evidence/operations-macos/operations-split-1024-dark-darwin.png). Это собранное приложение с живыми тестовыми API, не HTML-макет.

Первый реальный render crash сохранён отдельно: [failed report](evidence/operations-iterations/first-render/report.json), [снимок](evidence/operations-iterations/first-render/failure.png). Поздние остановки из-за изменившегося layout были ошибками селекторов harness: существующий объект дополнительно проверялся прямым API GET. Проверки уточнялись к видимому detail и конкретной причине unsupported, без ослабления backend/target/receipt assertions. Старые положительные результаты не переносились на изменённый код.

## UX критерии

Одна компактная строка выбора подключения, без повторного заголовка и постоянного нижнего статуса. Jenkins: каталог и inline параметры/сборка/логи; Cluster: сворачиваемая навигация, таблица, подсвеченный YAML и inline action review. Панели используют прежний docking; текущая задача и черновик чата сохраняются. Цвета общие с приложением, light editor не остаётся чёрным. Состояния empty/forbidden/offline/partial/unknown/conflict различаются.

Проверяются настольные размеры и узкие split-панели, keyboard focus, hover labels, размеры разделителей, видимость основной команды, сохранение прокрутки/выбора и отсутствие сплошной ленты технических сообщений. Фоновая операция продолжает сверку без открытой панели. Системное отключение CSS motion не заменяет индикацию занятости: используется существующий единый frame clock, с уважением явной настройки приложения.

Визуальная критика исправила чрезмерно узкий Jenkins detail, устаревшую строку master и трёхколоночный overflow кластера. При тесном desktop split детали временно занимают панель с возвратом к прежнему списку; предпочитаемые размеры восстанавливаются при расширении. При 1024px некоторые toolbar controls переносятся на вторую строку, сохраняя действия доступными; maximization и скрытие project sidebar дают больше места. Персональные рабочие размеры/ВАРМ ещё требуют проверки на месте.

## Ещё не подтверждено

Рабочие Windows/ВАРМ, корпоративные MCP schemas/auth/CA, реальные OpenShift-specific controllers, kubelet/Running pods/log delivery/exec/port-forward и успешные rollouts. Native envtest проверяет API, не весь cluster. Полные Pipeline graph/Jenkinsfile/config/manual gates, history retention/export, kubeconfig exec-auth/OIDC/mTLS и полный OpenShift Console остаются адресными продолжениями. Инструкция переноса: [OPERATIONS-RUNTIME-HANDOFF.md](OPERATIONS-RUNTIME-HANDOFF.md).
