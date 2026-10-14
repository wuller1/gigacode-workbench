# Jenkins и Kubernetes/OpenShift: перенос рабочего среза

Этот документ относится к коду `app/`, а не к демонстрационным системам HTML-макета. Новые панели используют прежние проекты, разговоры, docking, IPC и MCP host. Чужой GigaCode/Qwen CLI не модифицируется. Полное соответствие OpenShift Console и всем Jenkins plugins здесь не заявлено.

## Сначала сравнить с рабочей реализацией

На рабочем компьютере уже есть доработки других агентов. Прочитайте `SUITE-UPGRADE-AGENT.md`, сохраните текущие изменения и составьте адресное сравнение: owner состояния подключения, контракты MCP, scope проекта, история операций, UI и реальные тесты. Для каждого решения выберите reuse/repair/replace с доказательством. Если рабочее решение удобнее или функциональнее, объясните конкретные преимущества пользователю и согласуйте выбор; не заменяйте его массовым копированием этого репозитория. Никогда не переносите credentials, локальные данные или тестовые endpoints.

## Открытие и настройка

В левой панели приложения есть отдельные инструменты Jenkins и Kubernetes/OpenShift. Их можно открыть одновременно, перетаскивать за вкладку, делить на группы и менять размеры. Закрытие вкладки не отменяет удалённую сборку. Кнопка помощи из инструмента добавляет выбранную цель в черновик текущего чата, сохраняя написанный текст; сама сообщение не отправляет.

В тесной desktop-панели детали занимают доступную область; «Вернуться к списку ресурсов» возвращает прежний выбор и черновик. Кнопка видов ресурсов показывает временную навигацию, не меняя сохранённое предпочтение. Разворачивание dock-группы даёт полную ширину; после возврата split и текст сохраняются. Не заменять это мобильными отдельными страницами при переносе.

В Настройки → Jenkins и кластеры создайте подключение:

1. Укажите понятное имя, любое название стенда и тип Jenkins/Kubernetes/OpenShift. ДЕВ и ИФТ — примеры подписей, не фиксированные идентификаторы.
2. Выберите транспорт. «Встроенный MCP bridge» означает настоящий REST API через отдельный локальный stdio MCP worker. «Внешний MCP» означает фактический stdio либо Streamable HTTP endpoint вашего MCP-сервера, а не URL веб-консоли.
3. Для встроенного Jenkins укажите базовый URL, username и API token. Для встроенного кластера — URL API server и Bearer token. При необходимости задайте PEM CA. TLS проверяется; кнопки отключения проверки нет. HTTP разрешён только на loopback.
4. Для stdio задайте executable и массив argv без shell interpolation. Секрет передаётся через выделенную переменную окружения; для HTTP — через настраиваемый header/prefix. Не помещайте токен в URL или argv.
5. Отметьте проекты, использующие подключение. Один connection ID, vault и избранное переиспользуются между ними; target и операции всё равно закреплены за конкретным проектом.
6. Сохраните и выполните «Проверить и обнаружить». Видимые возможности должны следовать реальному inventory. Для внешнего MCP назначьте точные tools и adapter DTO, описанные ниже.

Main шифрует secret через Electron safeStorage. Ciphertext хранится в private `operations/state.json` и его backup; public DTO возвращает только `credentialConfigured`. Это системная защита шифрования, а не отдельная запись token в Credential Manager. Если защищённое хранилище недоступно, сохранение секрета отклоняется; plaintext fallback не используется. Private state не включать в Git/export. Выданный другой моделью текст не является способом авторизации.

## Jenkins

Каталог открывает root и папки с каноническими полными путями. Поиск обходит вложенные папки постранично; одинаковые имена в разных папках остаются разными jobs. Избранное личное, хранится в Workbench и не меняет Jenkins configuration. Отключённые jobs и containers видны, но не выдаются за runnable builds.

Карточка job читает реальные определения параметров. В текущем bridge поддержаны string/text/boolean/choice; password/credentials/plugin-specific types требуют защищённого adapter, их defaults не раскрываются. Запуск сохраняет prepared input и durable receipt, связывает реальный queueId с build number и результатом. Cancel очереди и Stop назначенной сборки — разные операции. Логи читаются ограниченными страницами; opaque cursors нужно передавать без преобразования в число. Jenkins raw log offsets включают ConsoleNotes и не равны длине видимого текста.

Bounded catalog: до 20 000 наблюдённых jobs, 2 000 папок, глубина 32, до 12 API reads на страницу, TTL5минут и 8MiB данных на один каталог. Ограничение, недоступная вложенная папка и незавершённый обход показаны явно; это не пустой/полный результат. Continuation повторяется без перехода к следующей странице; Refresh начинает новое наблюдение. Каталог живой, не transactional snapshot Jenkins.

JUnit/stage/artifact API подключаются по фактической доступности. Отсутствие plugin API — unsupported, а не «нет ошибок». Список artifacts сам по себе не означает реализованное скачивание, архивирование или полный Pipeline graph.

Встроенный bridge объявляет наличие read-адаптеров `ci.tests`/`ci.stages`; доступность самих JUnit/Pipeline endpoints проверяется отдельным запросом выбранной сборки.404 показывается как unsupported. Это не утверждение об установленных plugins всего controller. Очередь ограничена 1000 элементами; превышение даёт явную ошибку, без молчаливого обрезания. Queue receipt должен совпасть с точным base context подключения, а подтверждение — с фактическими queue/task/build IDs.

## Kubernetes/OpenShift

Discovery определяет реальные API groups/resources/verbs. Навигация группирует Workloads, Pods, сеть, конфигурацию, доступы, storage, CRD и Service Mesh. EnvoyFilter и DestinationRule доступны при фактической регистрации соответствующих CRD. Отсутствие CRD, запрещённая API group и пустой список — разные состояния. Если RBAC запрещает каталог namespaces, можно ввести точный разрешённый namespace.

Ресурс открывается в одном рабочем пространстве: список, подсвеченный YAML, events и ограниченный snapshot pod/container logs. Черновик закреплён за project/connection/target/API/namespace/name/UID и не заменяется фоновым обновлением. Сохранение между окнами использует общий исключительный Web Lock и проверку версии. При конфликте текст другого окна не перезаписывается; поздний ввод остаётся в своём buffer. Если Web Locks недоступны, приложение сохраняет текст в памяти и блокирует закрытие до явного разрешения проблемы, без неатомарного fallback. Удалённая версия изменилась — сохраните копию и явно обновите baseline. Secret показывает только metadata; значения, annotations и last-applied contents не передаются UI/агенту и не сохраняются. Встроенный worker получает полный API response и очищает его до передачи; metadata-only HTTP negotiation пока отсутствует.

Кнопка «Создать» открывает inline YAML-редактор для фактически обнаруженного API/kind, namespace и имени. Начальный шаблон содержит только идентификацию; обязательные поля проверяет серверный dry-run. Create использует атомарный POST: если имя уже занято или объект появился после preview, 409 сохраняет существующий ресурс.

Apply, scale, restart и delete проходят одинаковый pipeline: фактический target → RBAC → server-side dry-run → immutable preview → одно выполнение → readback. UID и resourceVersion защищают от переименованных/пересозданных или изменившихся объектов. Подтверждённый Apply означает совпадение заданных полей с сервером; один лишь рост resourceVersion ничего не доказывает. Server-side apply conflicts не обходятся автоматическим force.

Backend `cluster.watch` использует resourceVersion и ограниченные интервалы; истёкший cursor требует relist. Текущий UI обновляет read snapshots, отдельный watch UI ещё не реализован. Read-only наблюдение известных принятых операций выполняет host, поэтому скрытие панели не останавливает сверку. Принятая правка Deployment не равна успешному rollout всех pods: для этого нужна отдельная проверка фактических контроллеров.

## Один путь UI и агента

Host предоставляет `ops_snapshot`, `ops_query`, `ops_prepare`, `ops_execute`, `ops_reconcile`, `ops_reveal`. Агент сначала читает snapshot; host запоминает target/auth generation отдельно для каждой сессии и не доверяет придуманным connection IDs или переданному моделью project scope. После retarget в другом окне старая команда отклоняется до сетевого запроса. Агент может показать конкретный инструмент в своём окне.

Renderer использует те же `ops.*` IPC методы и DTO из `app/shared/operations.ts`; network clients и credentials остаются вне renderer. Ответы, YAML, логи и описания jobs — недоверенные данные, не инструкции. Полные логи/manifest исключены из обычных snapshots. Явный `ops_query`/`ops_prepare` может вернуть manifest или preview/input в контекст модели; общий JSON ограничен 4MiB, preview — 1MiB. Это не token-aware budget.

Ответы инструментов ограничены размером, но это ещё не адаптивный token budget для 256k моделей. Jenkins log page может содержать до 256KiB; UI удаляет служебные ConsoleNotes, а host log DTO пока может сохранять их. Агент должен читать адресные страницы и сохранять ссылки на результаты, а не повторно загружать всю историю. Дальнейшее сокращение host payload и выгрузка больших ответов в материалы остаются отдельной работой.

`ops.prepare` не исполняет операцию. `ops.execute` повторного prepared ID возвращает сохранённый receipt. Если ответ после отправки потерян, состояние unknown блокирует повтор той же цели даже с новым operation ID. Сначала read-only reconciliation. Перезапуск приложения не превращает unknown в разрешение повторить POST. Операции другого target могут продолжаться.

Если Jenkins не вернул queue ID, результат может остаться unknown: автоматическое сопоставление по похожей последней сборке и manual resolve/unblock UI пока отсутствуют. Не редактировать journal ради снятия fence и не выдавать этот случай за автоматически восстанавливаемый.

Если token истёк во время такой операции, в настройках можно заменить только credential того же неизменного подключения. Host пересоздаёт клиент, увеличивает auth generation и инвалидирует прежние prepared actions. Read-only сверка использует новый token, сохраняя исходную auth generation в receipt и отдельно фиксируя последнюю использованную. Смена адреса, bindings, включённости или удаление подключения с незавершённым эффектом блокируются. Обновление token не снимает unknown fence и не повторяет запись.

## Адаптация корпоративного MCP

Названия tools не угадывать. Прочитайте настоящий `tools/list`, входные JSON schemas и примеры ответов. Настройте точные bindings для `ci.*`/`cluster.*` и lifecycle `probe`, `prepare`, `execute`, `reconcile`. Direct action binding возможен, но не заменяет обязательные preflight и reconciliation. Ajv проверяет аргументы по фактической schema; изменившаяся schema инвалидирует подготовленное действие.

Внешний tool должен возвращать DTO Workbench, включая bounded `OpsQueryResult` и фактический receipt. Если корпоративный сервер использует другую форму, напишите небольшой adapter, а не объявляйте совместимость из-за похожего имени. HTML ошибки 400/401/403/413/429 и страницы входа не считаются корректными JSON/логами. Retry-After соблюдается для чтения; неизвестные записи не повторяются автоматически.

`adapterStatus: inventory_only` подтверждает лишь обнаружение точных tools/bindings/schema, а не совместимость DTO или live корпоративного сервера. Отдельно проверьте read/prepare/no-side-effect/execute/readback и ошибочные ответы на тестовой цели.

## Карта совместного переноса

Переносите вертикальный путь одной цепочкой, сверяя существующих владельцев: `app/shared/operations.ts` → `app/electron/operations/*` → main lifecycle/IPC и host tools в `main.ts`/`mcp.ts` → provider bundle в `build-electron.mjs` → `JenkinsPanel.tsx`, `ClusterPanel.tsx`, `OperationsSettings.tsx`, `ops-ui.tsx`, `operations.css` → lazy panels/Settings/App/Workspace/docking. Локальная ToolBoundary сохраняет соседние инструменты при сбое. Добавьте pinned `yaml` и соответствующий lockfile/license; не копируйте `node_modules`, `runtime`, test homes или private state.

После адаптации запускайте адресные Operations unit/gateway/catalog tests, UI review/settings/boundary набор и настоящий isolated live run. Для Windows проверьте source и packaged provider отдельно; один изменённый renderer без main/MCP/bundle integration не является переносом.

## Проверки и честные границы

`npm test` проверяет wrapper, protocol/fault fixtures и каталог. `npm run test:ui` включает реальные Electron settings concurrency/memory проверки. `npm run test:operations` запускает отдельные настоящие Jenkins и native Kubernetes API с TLS/RBAC; он не обращается к рабочим стендам и не вызывает платные модели. `--jenkins-only` предназначен также для Windows. Test assets закреплены в `app/tools/ops-test-assets.mjs`; Jenkins требует Java21+, задаваемую через `WORKBENCH_OPS_TEST_JAVA`, если managed JDK не установлен. Для непредусмотренной платформы envtest задайте `WORKBENCH_ENVTEST_BIN` с подходящими test binaries.

Native envtest не содержит kubelet и controller-manager: успешный API тест не подтверждает реальные Running pods, exec, port-forward, rollout или OpenShift-specific controllers. Эти сценарии проверять отдельно на тестовом рабочем стенде через настоящий корпоративный MCP. mTLS/client certificate, kubeconfig exec-auth/OIDC, полный Pipeline graph/manual gates, Jenkinsfile/config editing, cluster exec/port-forward, полный OpenShift Console, history retention/export и полный audit корпоративного TLS не объявляются завершёнными этим срезом.

Текущие отчёты и фактические screenshots перечисляются в `OPERATIONS-RUNTIME-AUDIT.md`. Не заменяйте их утверждением модели «всё работает».
