# Аудит flash-runtime 0.7

Цель: управляемый desktop поверх неизменённого CLI, короткий рабочий контекст, сохраняемый ход задачи и наблюдаемые проверки при отсутствии native vision. Это не обещание полного окна конкретной модели, идеального дизайна или восстановления после любой возможной ошибки.

## Реализованные границы

| Требование | Реализация и предел |
| --- | --- |
| Flash без тяжёлого процесса для мелких задач | CORE quick/standard/deep, одна активная роль, адресные recipes/история, короткие пакеты исполнителей. Реальное качество рассуждений корпоративных моделей проверяется на месте. |
| Цикл 227414 → 203202 | Structured usage + conservative host estimate, ранняя смена owned executor на чистой границе, bounded recovery packet; два бесполезных host renewal удерживают очередь. Внутренний native цикл распознаётся/прерывается только для изученного Qwen при notices и фактическом usage; неизвестный Giga требует telemetry/adapter. |
| Наблюдение контекста | Точный reviewed Qwen read-only reader, ACP usage, workplace contextUsage adapter; оценка байтов отдельно от фактического tokenizer. Скрытый native контекст недоступен без реальных показаний. |
| Проверка удержания | Опциональный изолированный callback, случайные значения в пяти местах, предварительная верхняя цена всей серии, durable dispatch/receipt, запрет повторов UNKNOWN. В desktop платный транспорт автоматически не подключён. |
| Отсутствие зрения | Host MCP не отдаёт inline images. Настроенный bridge получает настоящий PNG и возвращает текст. Native tools стороннего CLI контролируются только его фактическими возможностями; инструкции запрещают выдавать текст за собственное зрение. |
| Дизайн | 56 компонентов/вариантов, 14 desktop recipes, 37 собственных SVG; состояния, inline data edit, keyboard/focus, измеримый DOM audit и актуальные screenshot descriptions. Метрики и библиотека не гарантируют эстетическое качество любой генерации. |
| Управляемые исполнители | Один AtomicStore/controller, отдельные processes/generations, DAG, write/context reservations, lifecycle, bounded retries, checkpoint, human reconciliation. Writer leases — координация, не filesystem sandbox. |
| Восстановление UNKNOWN | Конкретный assistantMessageId связывает human attestation с сохранённым receipt. История не перекрашивается. Старые команды не повторяются автоматически. |
| Межпроектная работа | Directed links, durable inbox, causal parent/hops, dedup, revoke и отдельная делегация. Reference note не становится новым разрешением. |
| Очередь | Видимое «Отправить сейчас», редактирование и удаление. Cancel/ack предшествует новому prompt; UNKNOWN не обходится. |
| Миграция | Desktop source → существующий Desktop, план/CAS/backup/journal, сохранение адаптаций, private QUICK-UPGRADE и source bases. CLI/credentials/runtime/history не копируются. |
| Название | GigaCode / GigaCode.exe; appId и прежние каталоги данных сохраняют совместимость. |

## Исправления по результатам независимых и живых проверок

- Сверка освобождала metadata fence, но оставляла session lifecycle заблокированным. Теперь подтверждённо остановленный исполнитель получает чистую paused boundary; Retry и свежий Followup имеют разные условия.
- Исторический unresolved tool блокировал новое поручение после сверки. Теперь exemption связан с точным host ledger ID; сам старый tool/outcome остаётся в истории.
- Первый запуск менял runtime fingerprint после calibration и терял применимость результата. Бесплатная подготовка закрепляет runtime до paid probe.
- Поздний ответ настроек мог выглядеть как успех после ошибки backend. Формы используют throwing invoke, подтверждают receipts, сохраняют draft и проверяют CAS.
- Placeholder изображения только в имени JSON-поля проходил предварительную проверку. Проверяются actual leaf values и наличие настоящих PNG bytes после mapping; отрицательный контроль обязан отклониться до discovery/tool call.
- Отмена была недоступна ожидающим/приостановленным исполнителям. Панель использует реальные managed phases и сохраняет неотправленный ввод.
- Небольшая успешная recall probe ошибочно уменьшала рабочее окно до своего размера. Успешное принятие и sampled recall теперь только нижние наблюдённые границы.
- После ручного восстановления сохранялся marker старой проверки overhead. Новое поколение заново оценивает уменьшение нагрузки и не наследует вечное удержание.
- Canonical HTML title/h1 «429 Too Many Requests» не распознавался без буквального HTTP/status. Теперь reason phrase проверяется в heading, произвольные body/script числа не запускают retry; после dispatch остаётся UNKNOWN.
- Метка маршрута сбрасывала учёт истории без нового CLI. Теперь same-generation offset/wrappers сохраняются; прежнее фактическое давление переносится как оценка до нового actual usage. Настоящее новое поколение сбрасывает её.
- Windows case aliases обходили защищённые migration paths, а PowerShell UTF-8 BOM не читался. Добавлены сравнения без регистра и строгий UTF-8 decoder с BOM support.

## Как проверять результат

Источники фактов: [actual Electron report](evidence/flash-runtime-ui/report.json), [unit report](evidence/flash-runtime-ui/unit-local.json), [native Qwen read-only](evidence/flash-runtime-ui/managed-qwen-readonly.json), [UI kit gallery](../../ui-kit/evidence/desktop/report.json). Читайте status, source hashes, платформу, cases и cleanup; наличие файла само по себе не означает pass. Failed iterations сохранены отдельно. Локальная приёмка: 529 passed / 46 skipped; полный actual Electron 16/16; migration 26/26; UI kit 20/20 desktop + 4/4 contracts.

**Native Windows, candidate `63b923f`:** [agent harness](https://github.com/wuller1/gigacode-workbench/actions/runs/38619290397) и [полный desktop](https://github.com/wuller1/gigacode-workbench/actions/runs/38619290374) завершились успешно. Unit **524 passed / 0 failed / 51 skipped**; actual flash Electron **16/16**, роли **8/8**, переходы **6/6**, renderer resilience **8/8**, native Qwen read-only **2/2**, desktop migration **26/26**. Источники: [harness provenance](evidence/windows-63b923f/harness/harness-provenance.json), [migration step](evidence/windows-63b923f/harness/migration-win32.json), [desktop provenance](evidence/windows-63b923f/desktop/desktop-provenance.json). ZIP artifacts проверены по GitHub digest и CRC; reports сохраняются исходными bytes. Полный Windows run включает source/packaged IDE/Data/Jenkins, PowerShell 5.1, native PTY/Sharp, NSIS/portable и имя GigaCode.exe/вложенные ресурсы. UI kit gallery остаётся отдельной macOS-проверкой, не приёмкой всех экранов приложения.

Первый Windows candidate `8b40c31` дал два test-fixture отказа: удаление временного Qwen-каталога до закрытия Windows handles и сравнение canonical Windows path с raw path. Исправления сохраняют исходные оракулы; повтор на `63b923f` прошёл. Same-generation route accounting исправлен отдельно до финального прогона. Финальная публикация добавляет docs/evidence к этому runtime candidate.

Из корня:

```text
npm --prefix app test
npm --prefix app run build
node app/tools/test-flash-runtime-ui.mjs
node app/tools/test-managed-qwen-policy.mjs
node --test tools/test-upgrade-workbench.mjs
node tools/check-bundle.mjs
npm --prefix ui-kit run typecheck
npm --prefix ui-kit run typecheck:examples
npm --prefix ui-kit test
npm --prefix ui-kit run check:catalog
npm --prefix ui-kit run test:desktop
```

`--diagnostic-continue` сохраняет **failed** result и помогает собрать независимые замечания за один прогон. Итоговая приёмка выполняется обычным полным запуском без этого флага. Owned protocol peers проверяют поведение оболочки, не интеллект модели; реальные GigaCode 26.10.6, корпоративные gateway/certificates и Qwen 3.6 Flash bridge остаются отдельной рабочей проверкой. Практические точки адаптации: [FLASH-RUNTIME-ADAPTATION.md](FLASH-RUNTIME-ADAPTATION.md).
