# Проверки перед первой публикацией

Дата: **10 октября 2026 года**. Приложение 0.1.0, Qwen Code 0.25.0; среда разработки — macOS arm64. Проверены 319 файлов публичного baseline `ce63456abacd1be916c5ae71a960d680f341187f`; адресный повтор по Git index `4e8e612a11a07d1e82f699a45733a50623604a1f` также не выявил отмеченных ниже признаков секретов/личных путей. Это отчёт о конкретных проверках, а не приёмка всего roadmap. Живые Electron-пункты ниже переданы основным агентом, наблюдавшим приложение. Ручная macOS-проверка завершена. Итоговый Windows CI, включая исправление Modal и отдельный Electron regression, прошёл на `de0b6df070e8ff8fec87c3a558f4cfe27597d89f`. Последующее обновление отчёта не меняет код этой сборки.

Статусы: **pass** — указанный результат получен; **not_run** — целевая проверка не выполнена. Старый результат нельзя автоматически переносить на изменённый adapter, сборку или другую ОС.

## Локальные проверки без модели

| Проверка | Результат | Что это подтверждает |
|---|---|---|
| `npm test` в `app/` | **pass: 49 passed, 2 Windows-only skipped** | Текущие unit/fixture сценарии хранения, ACP, очереди, ссылок, host tools и границ сервисов; не реальную модель или Windows |
| `npm run build` | **pass** | TypeScript, renderer и Electron main/preload собираются |
| Полный `npm audit`, включая dev и prod | **pass: 0** по всем severity | На момент прогона база npm не сообщила известных уязвимостей в этом dependency graph; не общий security audit |
| `electron-builder --mac dir` | **pass**, код 0 | Локальная macOS directory-сборка создаётся; подпись и Windows installer этим не проверены |
| Qwen внутри macOS-сборки | **pass: 0.25.0**, код 0 | Реальный bundled `cli.js` из `app.asar.unpacked` запускается упакованным Electron в режиме `ELECTRON_RUN_AS_NODE=1`, без глобального CLI |
| Legacy PowerShell suites | **pass: 85/85** | Controller/journal 35, docs-impact 15, installer 16, memory 19; PowerShell **7.4.20 на macOS**, не Windows 5.1 |
| Legacy Node design checks | **pass: 8/8** и payload integrity | Формат payload и математические функции; настоящий browser DOM collector этим прогоном **не запускался** |
| Installer preflight | **pass: 240 файлов, 9 агентов** | `PlanOnly`, источники только из `workbench/`; приложение/зависимости не включаются при корректном SourceRoot. Установка и глобальное окружение не менялись |
| 12 источников / 12 готовых PowerShell-файлов | **pass** | Обе формы совпадают с SHA-256 из `workbench/scripts.json`, BOM сохранён; полный legacy manifest проверяется [checker](../tools/check-bundle.mjs) |

Первый локальный legacy-прогон дал 84/84; после добавления regression для default SourceRoot установщика основной агент повторил suites: **85/85** на срезе `4e8e612`. PowerShell 5.1-совместимые default expressions обновлены; затем эти suites успешно прошли под настоящим Windows PowerShell 5.1 в указанном ниже CI.

Наборы приложения находятся в [app/tests](../app/tests), legacy — в [workbench/tests](../workbench/tests). Подробности запуска и ограничения переноса — в [implementation status](IMPLEMENTATION_STATUS.md).

## Initial real ACP: отдельный ограниченный прогон

На настоящем Qwen 0.25.0 через OpenRouter на macOS выполнены **6 коротких host prompt dispatches** в безопасных временных проектах. Были получены собственные маркеры независимых сессий, перекрывающиеся запросы, наблюдаемая отмена A при продолжении B и следующий успешный ход после отмены. Проверки адаптера дали **6/6**; это отдельный ранний срез, а не повторная проверка каждого последующего изменения `acp.ts`/`service.ts`.

Чтение доступных конфигураций и установка reasoning выполнялись отдельно без model prompt: для фактически предложенной модели получены варианты low/medium/high, установка low подтверждена readback. Доступность этих вариантов у Qwen не подтверждает тот же контракт GigaCode. Полная оплаченная стоимость и число внутренних HTTP retries здесь не измерены: число host dispatches не равно гарантированному числу запросов провайдеру.

Ключи передавались дочернему процессу через разрешённое окружение; приватные harness, трассы, credential sources и пользовательские данные не входят в репозиторий.

## Публичный manual probe: воспроизводимость без платного запуска

[Отдельный probe](MANUAL_ACP_PROBE.md) использует настоящий adapter приложения, но включается только своей Vitest-конфигурацией. Обычные `npm test` и Windows CI его не подхватывают.

- **pass:** metadata-ветвь на offline ACP fixture — initialize/new, два подключения, ноль host prompts.
- **pass:** setter/readback на fixture — значения берутся из реально возвращённого каталога, ноль host prompts.
- **pass:** marker-ветвь на временном offline fixture — два перекрывающихся host prompts, независимая адресация даже при одинаковой строке session ID в двух процессах. **Вызовов провайдера: 0**.
- **pass:** отдельная строгая TypeScript-проверка probe/config; обычный test discovery исключает `.manual.ts`.

Эти fixtures проверяют сам инструмент воспроизведения. Они не являются дополнительным live Qwen/Giga-прогоном. На рабочем Windows сначала выполнять только metadata-режим; платный режим требует отдельного явного переключателя и бюджета.

## Живой Electron UI: подтверждённые шаги и незавершённые пункты

Текущая серия основного агента использовала app-bundled Qwen и отдельные тестовые данные. Серия завершила лимит **6 ACP prompt dispatches: 5 родительских ходов и 1 дочерний**. Это другая серия, её нельзя смешивать с initial ACP шестью ходами выше. Дополнительных платных запусков для подготовки отчёта не было.

| Сценарий | Наблюдение / статус |
|---|---|
| Настоящий запрос из приложения | **pass:** Qwen вернул ожидаемый короткий `WORKBENCH_OK` через приложение |
| Модель и reasoning | **pass:** Flash → GPT-oss/Medium → Low → Flash; после смены модели не осталось ошибки от устаревшего reasoning |
| Материал и интерактивный browser | **pass:** typed Qwen `record_artifact` metadata → host material chip → статический HTML preview → настоящий browser; кнопка изменила Ready на Clicked |
| MCP-вопрос | **pass:** показан вопрос с вариантами и свободным ответом; текст «Свободный ответ принят» вернулся в Qwen, затем получен final response |
| Размеры и разворачивание browser | **pass:** preset 390 × 844 подтвердился реальными `innerWidth`/`innerHeight`, DPR = 1; после maximize и Escape сохранилось Clicked-состояние |
| Перетаскивание панели | **pass:** настоящий pointer drag перенёс панель справа → вниз → вправо; проверка выполнена через UI, не изменением store вручную |
| Два окна / владение browser tab | **pass:** во втором окне открыта и использована вкладка; после закрытия второго окна она передана первому с сохранённым Clicked-состоянием |
| Промежуточный UI/MCP ход №3 | **Не pass:** модель передала неверные поля `title`/`workspacePath`; CLI завершил повторения через loop protection, host сохранил unknown. После явного recovery и queue resume следующий ход №4 с корректной схемой прошёл. Успех следующего хода не стирает предыдущий исход |
| Дочерний агент | **pass:** родитель один раз вызвал MCP `agent_spawn`; отдельный дочерний Qwen ACP вернул `CHILD_WORKBENCH_OK`. В настоящем worker panel видны completed и результат; появилась вкладка разговора ребёнка. [Снимок живого UI](images/live-workers.jpg) показывает этот узкий результат, а не полный DAG/lease scheduler |
| PTY / terminal shutdown | **pass:** приложение с активным zsh PTY закрыто собственной UI-кнопкой; Electron и wrapper завершились с кодом 0. Ранее наблюдавшийся N-API abort в этом повторе не возник. Это не проверка Windows PowerShell/cmd |
| Архив / восстановление / focus и Escape | **pass:** дочерний разговор архивирован и восстановлен. В Archive открыто вложенное Actions; первый Escape закрыл только меню. После Restore удалившаяся кнопка передала focus на Close; следующий Escape закрыл Archive и вернул focus кнопке Archive |
| Modal regression | **pass: 10/10** проверок независимого реального Electron fixture; negative control со старым кодом упал. Финальная CUA-проверка основного приложения подтвердила вложенное меню, восстановление и возврат focus; новых model prompts не было |

Ручная проверка перечисленных сценариев macOS завершена. Они не закрывают весь roadmap, полную матрицу restart/update или все возможные состояния. Исторические `workbench/assets/previews/*` и изображения `mock-*` являются эскизами; они не используются как evidence перечисленных live-сценариев.

## Windows CI и непроверенные цели

Итоговый успешный [Windows run 37965731926](https://github.com/wuller1/gigacode-workbench/actions/runs/37965731926) относится к commit **`de0b6df070e8ff8fec87c3a558f4cfe27597d89f`** (3 минуты 35 секунд). Предыдущий успешный run `37964308116` относился к `2cb0ceb`; ниже приведены результаты итогового среза. Он выполнен на настоящем Windows runner; результат macOS на него не подставлялся.

| Цель | Статус |
|---|---|
| Windows PowerShell 5.1 | **pass: 85 PowerShell + 8 Node checks**, script/manifest integrity |
| App tests на Windows | **pass: 49 passed, 2 platform-specific skipped, 6 test files**. Пропуски не считаются pass |
| Windows PTY | **pass:** настоящий PTY вернул marker, exit code 0; cleanup завершился и Node вышел естественно |
| Windows Sharp | **pass:** нативный модуль загрузился и выполнил предусмотренную проверку |
| Build / NSIS / portable | **pass:** сборка и упаковка на Windows завершены, Actions artifacts созданы |
| Bundled Qwen | **pass: 0.25.0**, запуск фактического упакованного CLI; глобальный Qwen для этой проверки не требовался |
| Electron Modal/focus после последнего исправления | **pass: 10/10** в отдельном скрытом Electron на Windows, `npm run test:ui`; без CLI и модели |
| Ручная установка/использование Windows NSIS и portable | **not_run:** успешная упаковка и проверки CI не доказывают интерактивную установку, update/rollback и весь UI на рабочем Windows |
| GigaCode 26.9.75 | **not_run:** установленного форка здесь нет. Auth, metadata/config и extensions проверяются отдельным manual probe на рабочем компьютере |

Готовые unsigned Windows-файлы получены из Artifacts указанного run. Постоянная поставка — [preview.1](https://github.com/wuller1/gigacode-workbench/releases/tag/v0.1.0-preview.1). Публикация Release выполнена отдельно от workflow; ручные Windows/Giga ограничения сохраняются.

## Аудит набора публикации

Проверены только **319 файлов Git index** указанного baseline, без `node_modules`, приватных рабочих каталогов и credential stores. В 299 UTF-8 файлах не обнаружены проверенные признаки токенов/private keys/JWT, личных абсолютных home-путей или частных/internal URL. Единственный URL с userinfo оказался намеренным синтетическим тестом редактирования секретов. 70 SVG не содержали проверенных active/external constructs; PNG/JPEG не содержали обнаруженных text/EXIF/XMP метаданных.

Добавленный после baseline `docs/images/live-workers.jpg` отдельно просмотрен: видны только тестовая задача и результат исполнителя; EXIF содержит лишь размеры 2880 × 1840, без GPS, имени владельца, серийного номера или времени съёмки.

Это ограниченный статический аудит опубликованного набора, а не доказательство отсутствия любого возможного секрета или безопасности всего runtime. Новый файл/изменение после baseline требует соответствующей повторной проверки; private test harness остаётся вне публикации.

Финальный повтор статического сканирования: **322 tracked файла, 301 UTF-8**, без совпадений проверенных форматов OpenRouter/GitHub tokens, private keys/JWT и личных home-путей. Источники берутся только из Git; сборочные зависимости и приватные данные в source ZIP не входят. Финальный снимок живого UI повторно просмотрен после исправления Modal.
