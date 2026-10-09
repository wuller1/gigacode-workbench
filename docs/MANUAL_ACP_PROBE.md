# Ручная проверка установленного Qwen / GigaCode

Инструмент: `app/tools/acp-live.manual.ts`, отдельная конфигурация `app/vitest.live.config.ts`. Обычный `npm test` и Windows CI его не включают. Доступна отдельная команда `npm run test:live`; ниже приведён её эквивалент с явным файлом конфигурации. Это проверка транспорта через настоящий `AcpConnection` приложения, а не Electron UI E2E.

## По умолчанию: без prompt к модели

Проверка создаёт две пустые временные папки, два процесса выбранного CLI и по одной ACP-сессии. Она запрашивает `initialize` и `session/new`, показывает фактически полученные agent/version, capability names, configOptions и legacy model metadata. Она **не отправляет `session/prompt`**, пока `WORKBENCH_LIVE_ALLOW_PAID` не равен ровно `1`.

Нужны установленные зависимости приложения (`npm ci --include=optional`) и Node из [README](../README.md). Выберите настоящий путь CLI и аргументы, подтверждённые его `--help`/существующей работающей интеграцией. GigaCode **26.9.75** в исходной среде разработки недоступен; этот probe позволяет получить свидетельство на целевом Windows, а не предполагает совместимость форка заранее.

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

## Как следующему агенту использовать результат

1. Сначала выполните только metadata-режим на целевом Windows и сохраните очищенные version/config observations в отчёт задачи. Не объявляйте Windows/Giga проверенным по macOS/Qwen.
2. Если найдено несовпадение, исправьте минимальный adapter path и добавьте локальную fixture regression. Не меняйте сам CLI и не выдумывайте дополнительные ACP методы.
3. Платный режим запускайте только при отдельном разрешении и известном бюджете. После сбоя сначала выясните состояние; не гоняйте тест до случайного зелёного результата.
4. Отдельно проверьте UI: событие доходит без клика, два окна не путают владельца, queue/cancel/recovery сохраняют задачу. Этот probe не закрывает эти UI-критерии, Windows installer, tool execution или native cancellation isolation.

После работы при необходимости удалите только переменные `WORKBENCH_LIVE_*` из текущего окна PowerShell. Probe не меняет глобальное окружение, регистрацию CLI, app settings или production-репозиторий.
