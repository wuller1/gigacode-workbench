# Канонические контракты и адаптация MCP

## Зачем нужен этот слой

UI, агент и фоновые операции должны обращаться к одной команде независимо от того, реализована она через корпоративный MCP, REST API, CLI или локальный сервис. Канонический adapter скрывает различия транспорта, но не скрывает фактический target, права, версию и неизвестный исход.

Типовой справочник находится в `app/shared/suite-contracts.ts`. Это начало контракта, а не заявление о готовом backend.

## Один путь исполнения

```text
UI / agent tool
    → CommandBus
    → project binding + policy + capability check
    → canonical adapter
    → MCP/API/CLI/native driver
    → normalized result or receipt
    → addressable event + audit evidence
```

У агента нет универсального `call_mcp(name, args)` из основного prompt. Host предоставляет небольшие стабильные инструменты предметной области. Raw MCP inspector остаётся в Settings для адаптации и диагностики.

## Идентичность и область

Каждый запрос содержит `projectId`, `taskId` при наличии, `connectionId`, точный target, actor, `correlationId`, `operationId` и ожидаемую revision. Renderer не выбирает доверенный actor или расширенный scope. Main process строит их из текущего окна, проекта, binding и session ownership.

`ResourceRef` — общий deep link для файла, задачи, browser tab, PR, build, workload, страницы, datasource, query result и artifact. Он всегда содержит `projectId`; удалённый объект также содержит `connectionId`. Одинаковые remote IDs в разных пространствах не смешиваются.

## Discovery и project bindings

При первом подключении host:

1. устанавливает MCP/API transport и читает identity/version;
2. для MCP выполняет `initialize`, `tools/list` и сохраняет input schemas;
3. вычисляет schema hash без credential values;
4. запускает один безопасный read-only canary в выбранной области;
5. предлагает сопоставление tool → canonical capability;
6. создаёт `ProjectBinding` после проверки identity, schema и scope;
7. применяет default `auto_allow_bound` ко всем обнаруженным capabilities, включая mutations, без отдельного per-call MCP permission dialog;
8. при смене schema hash помечает binding stale, обновляет mapping и блокирует только вызов, который уже нельзя корректно сформировать; изменение схемы не создаёт новый approval wizard.

Один connection может иметь несколько bindings: разные проекты, пространства Bitbucket-подобного forge, namespaces, Jenkins folders или knowledge spaces. Один проект может иметь несколько connections одного вида. UI всегда показывает alias и полный target path.

Project binding является централизованной авторизацией выполнения. Сессии и subagents наследуют его policy revision; роль влияет на выбор и проверку инструмента, но не выдаёт и не отнимает права. Explicit connection/capability/environment disable или target rule блокирует новые dispatch. Preview точной цели, SQL/diff/parameters и recovery остаётся частью operation lifecycle и evidence, а не запросом разрешения.

## Query, prepare, execute, reconcile

Чтение возвращает данные вместе с `observedAt`, source revision, cursor, признаком stale и предупреждениями. Большие ответы пагинируются и сохраняются как artifact; они не вставляются целиком в контекст модели.

Изменения проходят четыре состояния:

1. `prepare` заново читает target, проверяет права и создаёт preview/diff.
2. Policy решает, допустимо ли действие в данном проекте и окружении.
3. `execute` использует idempotency key только там, где backend его реально поддерживает.
4. `reconcile` выполняет readback и переводит receipt в `confirmed`, `failed` или `unknown`.

Timeout после POST, DDL, запуска build или apply не означает failed. Такой receipt получает `unknown`; host сначала ищет внешний эффект по request/correlation ID и никогда не повторяет действие вслепую.

## Нормализация ошибок

Adapter различает authentication, permission, validation, conflict, 413, 429, offline, timeout, unsupported и server errors. Ответ может быть JSON, text или HTML от proxy. Перед логированием host:

- ограничивает размер тела;
- удаляет script/style и преобразует HTML в безопасный текст;
- редактирует tokens, cookies, authorization headers, DSN passwords и secret values;
- сохраняет remote request ID и `Retry-After`;
- выставляет `uncertainOutcome`, если запрос мог изменить внешний мир.

400 не повторяется без исправления input. 413 переключает на chunk/artifact/reference или предлагает compact. 429 использует server delay, jitter и общий provider budget. Retry разрешён только для безопасного read либо keyed operation с доказанной семантикой.

## События и потоки

Событие содержит monotonic `seq` для канала, resource revision и адрес проекта/окна. Renderer не фильтрует глобальный поток постфактум: main отправляет событие только владельцу или явным подписчикам. Пропуск `seq` вызывает snapshot reconcile.

Watch, log, query и agent streams имеют AbortSignal, ограниченный buffer и backpressure. После скрытия панели поток может перейти на более редкий режим, но живой operation record не уничтожается.

## Секреты

В state хранится только `secretRef`. Credential provider работает в main process; renderer, model, MCP diagnostics и exports не получают значение. Для Windows использовать OS-backed vault/DPAPI через проверенный abstraction, учитывая границы защиты текущего пользователя. TLS verification не отключается; корпоративный CA, client certificate и proxy задаются как отдельные ссылки/политики.

Export настроек по умолчанию содержит connection type, alias, endpoint hint, binding targets и capability hashes, но исключает credentials, cookies, certificates, kubeconfig tokens и database passwords.

## Агентские инструменты

Поверх adapters публикуются компактные группы:

- `tracker_*`: search/get/create/update/transition/comment/link;
- `forge_*`: repositories/branches/changes/pull_requests/reviews/checks;
- `cluster_*`: contexts/resources/logs/prepare_action/execute/reconcile;
- `ci_*`: jobs/runs/logs/artifacts/prepare_trigger/cancel;
- `knowledge_*`: search/get/draft/prepare_publish;
- `database_*`: datasources/schema/query/prepare_mutation/transactions;
- `browser_*`: tabs/snapshot/action/wait/capture/diagnostics;
- `ide_*`: buffers/diagnostics/symbols/run/test/debug;

Ответ содержит краткую сводку и `ResourceRef`; полный результат остаётся адресным. Передача между subagents идёт через ссылки/evidence и bounded summaries, а не копию всего transcript.

## Проверки adapter

Для каждого adapter обязательны:

- recorded redacted fixture и schema-change test;
- read-only canary на настоящем endpoint;
- project/scope isolation между двумя bindings;
- denial и expired credential;
- JSON/text/HTML errors 400/401/403/413/429/5xx;
- cancellation и reconnect без утечки process/watch;
- timeout до/после отправки mutation;
- reconciliation неизвестного результата;
- отсутствие секретов в state, renderer, logs, prompt и diagnostic export;
- Windows packaged-app test для transport, certificates и path handling.

Capability получает статус `verified` только после реального canary. Отсутствующая операция отображается как `unavailable` с причиной; adapter не имитирует успех.
