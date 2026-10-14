# Ручная проверка установленного Qwen / GigaCode

Инструмент: `app/tools/acp-live.manual.ts`, отдельная конфигурация `app/vitest.live.config.ts`. Обычный `npm test` и Windows CI его не включают. Доступна отдельная команда `npm run test:live`; ниже приведён её эквивалент с явным файлом конфигурации. Это проверка транспорта через настоящий `AcpConnection` приложения, а не Electron UI E2E.

## По умолчанию: без prompt к модели

Проверка создаёт две пустые временные папки, два процесса выбранного CLI и по одной ACP-сессии. Она запрашивает `initialize` и `session/new`, показывает фактически полученные agent/version, capability names, configOptions и legacy model metadata. Она **не отправляет `session/prompt`**, пока `WORKBENCH_LIVE_ALLOW_PAID` не равен ровно `1`.

Нужны установленные зависимости приложения (`npm ci --include=optional`) и Node из [README](../README.md). Выберите настоящий путь CLI и аргументы, подтверждённые его `--help`/существующей работающей интеграцией. Актуальная целевая версия — GigaCode **26.10.6**; **26.9.75** в прежних материалах является только историческим baseline. Целевой GigaCode в исходной среде разработки недоступен; этот probe получает свидетельство на рабочем Windows и не предполагает совместимость форка заранее.

В PowerShell из папки `app`:

```powershell
$env:WORKBENCH_LIVE_CLI = (Read-Host 'Полный путь к CLI .js или .exe')
$env:WORKBENCH_LIVE_ARGS_JSON = '["--acp"]'
Remove-Item Env:WORKBENCH_LIVE_ALLOW_PAID -ErrorAction SilentlyContinue
Remove-Item Env:WORKBENCH_LIVE_SET_CONFIG_JSON -ErrorAction SilentlyContinue
npm exec --offline -- vitest run --config vitest.live.config.ts
```

`["--acp"]` — пример для CLI, в котором этот флаг действительно поддержан. При необходимости укажите проверенный `--auth-type` и другие параметры **отдельными элементами JSON**, без shell-интерполяции. Предпочтительнее `.js`/`.exe`: ограничения `.cmd` совпадают с адаптером приложения. Отсутствующий/относительный CLI path или невалидный JSON вызывает отказ; автоматической подстановки другого CLI нет.

Ключи поступают только из уже настроенного окружения/собственной авторизации CLI. Probe не читает `.env`, чужие проекты или credential stores, не печатает окружение/аргументы/сырые кадры, не пишет лог-файл. Не передавайте ключ в CLI args, config value или prompt. Параметры и labels из ответа CLI выводятся после маскирования известных значений секретного окружения; перед внешней публикацией всё равно просмотрите результат на приватные model aliases/другие сведения. Сам CLI может обращаться к сети, писать свою обычную историю и настройки при старте; отсутствие model prompt не обещает абсолютного отсутствия таких эффектов.

## Reasoning: сначала реальные варианты

Найдите в `configOptions` точный `id`, список `options` и `currentValue`. Не предполагайте `reasoning_effort`, `low/high` или capability только по названию модели. Если вариант не предложен в `session/new`, вывод означает именно это; функция может зависеть от модели или версии CLI.

Для явной проверки setter/readback в сессии A можно задать:

```powershell
$env:WORKBENCH_LIVE_SET_CONFIG_JSON = '{"id":"ID_ИЗ_ОТВЕТА","value":"VALUE_ИЗ_ОТВЕТА"}'
npm exec --offline -- vitest run --config vitest.live.config.ts
Remove-Item Env:WORKBENCH_LIVE_SET_CONFIG_JSON
```

Замените обе строки фактически предложенными значениями. Probe откажется отправлять неизвестную пару. Этот режим не вызывает model prompt; он выводит ограниченную текущую проекцию options и отдельно requested/observed value. Большие каталоги ограничены 30 options/100 choices с флагом усечения; строки также ограничены и очищены. Нормализация alias вроде `default` в конкретный tier отображается как `exactMatch:false`, а не скрывается. Полученный readback не доказывает влияние reasoning на реальный inference. Неизвестный setter outcome не нужно автоматически повторять.

## Опционально: два коротких платных prompt

Только после готового handshake и выбора недорогой подходящей модели:

```powershell
$env:WORKBENCH_LIVE_ALLOW_PAID = '1'
try {
    npm exec --offline -- vitest run --config vitest.live.config.ts
} finally {
    Remove-Item Env:WORKBENCH_LIVE_ALLOW_PAID -ErrorAction SilentlyContinue
}
```

За один запуск код отправляет **не более двух host `session/prompt`**, одновременно по двум отдельным соединениям. Каждый запрос требует только собственный короткий случайный marker и запрещает вызовы инструментов/файлов/команд/браузера/субагентов. MCP-серверы в `session/new` не добавляются, permission callbacks отклоняются. Наблюдаемый tool call или слишком длинный ответ вызывает запрос отмены и не считается чистым pass.

Это не sandbox нативных CLI tools. При необходимости используйте подтверждённые именно вашим CLI tool/output/retry limits в его обычных настройках; не переносите флаги Qwen в Giga вслепую. Два host prompt не гарантируют ровно два HTTP-запроса провайдеру: внутренние retries CLI/SDK могут отличаться. Платный режим не включён в CI, нет автоповторов Vitest; новый ручной запуск заново допускает два prompt, поэтому общий бюджет учитывает оператор.

Результат проверяет exact markers, отсутствие чужого marker, `end_turn`, отсутствие tool/permission операций и перекрытие времени жизни двух запросов. Идентичные строки `sessionId` в разных CLI-процессах сами по себе не ошибка: идентификатор владельца — transport connection + sessionId. Ответы модели, raw session IDs и сырые трассы не печатаются. Таймаут после 60 секунд оставляет неизвестный исход; процессы закрываются, автоматического replay нет. Временные тестовые папки удаляются, но это не откат возможных внешних действий CLI.

Диагностика marker mismatch сохраняет только длины, число собственных/чужих marker, первый индекс несовпадения, terminal reason и счётчики tools/permissions. Дополнительное наблюдение 100 мс проверяет поздний текст после terminal response; такой текст считается провалом порядка, а не молча принимается. Случайные marker и ответы не публикуются. Сохраняйте все результаты: один удачный повтор не отменяет предыдущую ошибку и не устанавливает её причину.

## Как следующему агенту использовать результат

1. Сначала выполните только metadata-режим на целевом Windows и сохраните очищенные version/config observations в отчёт задачи. Не объявляйте Windows/Giga проверенным по macOS/Qwen.
2. Если найдено несовпадение, исправьте минимальный adapter path и добавьте локальную fixture regression. Не меняйте сам CLI и не выдумывайте дополнительные ACP методы.
3. Платный режим запускайте только при отдельном разрешении и известном бюджете. После сбоя сначала выясните состояние; не гоняйте тест до случайного зелёного результата.
4. Отдельно проверьте UI: событие доходит без клика, два окна не путают владельца, queue/cancel/recovery сохраняют задачу. Этот probe не закрывает эти UI-критерии, Windows installer, tool execution или native cancellation isolation.

После работы при необходимости удалите только переменные `WORKBENCH_LIVE_*` из текущего окна PowerShell. Probe не меняет глобальное окружение, регистрацию CLI, app settings или production-репозиторий.

## Ролевые системные инструкции: отдельный scope проверки

Основной metadata probe выше не подтверждает system append и LLM-router. Текущий host собирает `CORE.md` + ровно один `profiles/<id>.md` через `app/electron/prompt-binding.ts`, сохраняет immutable manifest/fingerprint и выбирает delivery. `SYSTEM_PROMPT.md` — legacy entrypoint; его не нужно добавлять вторым общим промптом.

Автоматическое включение append ограничено точным allowlisted source **Qwen 0.25.1**, проверенными entrypoint/chunk hashes и известной цепочкой flags/config/ACP. Это source compatibility evidence, не подпись производителя и не проверка GigaCode. Новый Qwen, изменённый пакет, standalone GigaCode и GigaCode 26.10.6 остаются context-only, пока их собственная поверхность не исследована. Не меняйте version/family/evidenceScope, чтобы обойти это ограничение.

На целевом GigaCode агент выполняет последовательно:

1. Устанавливает фактический entrypoint/version/hash и существующие args, project/user overrides и env **имена**, без печати значений секретов.
2. Проверяет `--help` и доступный читаемый source нужной сборки: где объявлен append/override, как args попадают в ACP session config и где собирается native base. Имя Qwen flag либо env из прежней 26.9.75 не доказывают контракт 26.10.6.
3. Если source отсутствует/неподтверждён либо ACP принимает иной surface, сохраняет context-only с точной причиной. Не угадывает `session/setSystemPrompt`, новое ACP поле role и append-file flag; чужой CLI не модифицируется.
4. Если механизм подтверждён, добавляет отдельный narrowly scoped adapter evidence для точной версии/bytes, проверяет fixture regressions, затем ACP initialize/new с этим механизмом. Не переносит Giga identity в Qwen allowlist.
5. Проверяет два отдельных процесса A/B с разными CORE + role snapshots: immutable argv/env/file, разные role hashes, отсутствие глобальной записи/перетекания и корректное session ownership. Успех headless запуска сам по себе не подтверждает ACP.
6. Отдельно проверяет provider request/модельное поведение только в разрешённом безопасном тесте: синтетический context без корпоративных данных, явный budget/endpoint и tool isolation. Model marker/самоотчёт — поведенческое наблюдение, не доказательство system placement. Diagnostic dump base может не включать весь assembled request.

Receipt фиксирует delivery, runtime fingerprint/version, source scope, instruction fingerprint, state и reason. `prepared` означает сформированный план; `active` означает наблюдаемую границу адаптера (для append — startup/session acceptance, для context — correlated terminal turn). Он не обещает model obedience, всю скрытую native инструкцию или технический sandbox. Existing system override/dump и Windows command-line overflow сохраняют явный context fallback; источники нельзя молча обрезать.

### Повторяемые бесплатные Qwen проверки

Из `app`, после установленных зависимостей:

```powershell
node tools/test-prompt-binding-live.mjs
if ($LASTEXITCODE -ne 0) { throw 'Qwen append ACP startup probe failed' }
node tools/test-qwen-router-offline.mjs
if ($LASTEXITCODE -ne 0) { throw 'Qwen offline routing probe failed' }
```

Первый harness использует вложенный allowlisted Qwen, два временных isolated homes и только initialize/new без `session/prompt`. Второй запускает настоящий Qwen headless против собственного loopback fixture вместо внешнего провайдера. Dummy auth и синтетические данные не являются рабочими credentials. Успех подтверждает только описанные Qwen startup/offline scopes; это не Giga/корпоративная среда, не paid model evaluation и не Electron UX-приёмка. Точные результаты конкретной ревизии сохраняются отдельно в [аудите обвязки](suite/AGENT-HARNESS-AUDIT.md).

## Подключение существующего workplace LLM-router

На GigaCode сохраняйте рабочий router пользователя. Точка интеграции — `WorkbenchOptions.routeProfile` в `app/electron/service.ts`, тип `RoleRouter` из `app/electron/role-router.ts`; подключение выполняется в существующей точке создания `WorkbenchService`. Adapter принимает `RoleRoutingInput` + `AbortSignal` и возвращает валидный `{profileId, reason, confidence}` без выполнения самой задачи. Автоматически придуманные Giga headless flags не нужны.

Проверьте контекстное продолжение «теперь реализуй», invalid role, низкую confidence, timeout/abort и изменение task/project/catalog во время pending routing. Очередь и scope сохраняются при отмене/ошибке. Без проверенного adapter неизвестный CLI сохраняет текущий профиль с `roleRouting.source=retained`; это честный ограниченный режим, не готовый LLM-router. Ручной selector ролей и скрытый keyword fallback не заменяют требуемую автоматизацию.

Порядок автономного переноса, сравнения с более удачным workplace кодом и продолжения UI — [WORK-COMPUTER-BOOTSTRAP](../WORK-COMPUTER-BOOTSTRAP.md), раздел 4а.
