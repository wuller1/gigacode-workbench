# GigaCode Workbench

Новый срез **0.5.0-preview.1**: отдельные версионированные промпты 14 ролей, сохранение точных инструкций, настоящий system append для изученного Qwen, LLM-router и исправления субагентов/MCP/восстановления. [Полный итеративный аудит](docs/suite/AGENT-HARNESS-AUDIT.md) сохраняет также неудачные эксперименты. Выбранный router прошёл 12/12 синтетических запросов на реальной дешёвой модели; это ограниченная проверка выбора роли. Текущая рабочая версия пользователя — **GigaCode CLI 26.10.6**, совместимость форка подтверждается на месте.

Проверки 0.5: macOS **254 unit/protocol**, Windows **250**, Roles **8/8** и Chat **3/3**. [Windows harness](https://github.com/wuller1/gigacode-workbench/actions/runs/38561912330) и [полный Windows desktop](https://github.com/wuller1/gigacode-workbench/actions/runs/38561912179) успешны, включая source/packaged IDE 44+44, PostgreSQL 44, Data UI 25+25, Jenkins API/UI и NSIS/portable. Skips и границы проверки указаны в аудите.

Предыдущий срез **0.4.0-preview.1**: настоящие панели Jenkins и Kubernetes/OpenShift, общие подключения между проектами, управляемые агентом MCP-инструменты, подсвеченный YAML, запуск/отмена сборок и защищённое выполнение cluster actions. Исправлены гонки настроек/памяти и восстановление отдельных панелей. На macOS прошли **182 unit/protocol, 43 изолированных Electron UI, 23 серверных и 23 actual App сценария**. [Windows 2eb000e](https://github.com/wuller1/gigacode-workbench/actions/runs/38544491920) также прошёл: Jenkins source и packaged — по 11 API + 12 UI; PostgreSQL 44, Data UI 25 + 25, IDE 44 + 44, NSIS/portable и вложенный Qwen 0.25.1. Kubernetes API проверен на macOS; корпоративные подключения и ВАРМ — на месте. [Перенос и настройка](docs/suite/OPERATIONS-RUNTIME-HANDOFF.md) · [аудит и настоящие снимки](docs/suite/OPERATIONS-RUNTIME-AUDIT.md).

Сохранённая приёмка предыдущего IDE/Data среза 0.3: на macOS **116 unit/protocol, 44 PostgreSQL, 25 Data UI, 45 IDE/language/recovery и 18 Python pipe regressions**. [Windows `ed5144c`](https://github.com/wuller1/gigacode-workbench/actions/runs/38521851028) также успешен: **44 PostgreSQL, 25 source + 25 packaged Data UI, 44 source + 44 packaged IDE**, NSIS/portable и вложенный Qwen 0.25.1. Это не проверка нового 0.4. Один crash-containment сценарий выполняется только на POSIX. [Аудит и точные границы IDE](docs/suite/IDE-RUNTIME-AUDIT.md).

Обновление Data workspace: PostgreSQL/MCP консоли, inline grid с клавиатурой, transactions, сохранённая версия routine DDL, компактный metadata inspector, настоящая диаграмма FK, EXPLAIN, потоковые CSV/SQL/XLSX, durable history и защита unknown writes. [Перенос, проверки и открытые DataGrip gaps](docs/suite/DATABASE-RUNTIME-HANDOFF.md). Полное соответствие DataGrip ещё не объявляется.

Обновление 14.10.2026: добавлена рабочая IDE на Theia с Java/Python/frontend расширениями, общими с агентом buffers, семантическими операциями, build/test/debug bridge и восстановлением. Установка, перенос и границы проверки: [IDE-RUNTIME-HANDOFF](docs/suite/IDE-RUNTIME-HANDOFF.md). Полная матрица Ultimate остаётся отдельной пофункциональной приёмкой.

Локальное desktop-приложение для работы с агентом: **проект → задачи → разговоры и роли**. Чат, очередь поручений, файлы, браузер, терминал и материалы задачи находятся в одном рабочем пространстве.

Это ранняя версия приложения, а не готовая реализация всего плана из `workbench/`. Автор проекта — [wuller1](https://github.com/wuller1). Приложение не является официальным продуктом Qwen или GigaCode.

## Текущий этап: рабочая IDE и расширение desktop-приложения

14.10.2026 пользователь разрешил реализацию и самостоятельное улучшение UI/UX. `app/` содержит рабочий desktop runtime; `ide/` — независимый движок Theia с расширениями. Полный Browser/Design/Tracker/Operations/Data suite остаётся планом пофункционального расширения, а [макет](design/suite-workspace-prototype.html) — интерактивным описанием целевого продукта. Демонстрационные внешние системы в макете не являются подключёнными MCP.

## Один файл для рабочего компьютера

Откройте этот репозиторий в GigaCode и попросите агента прочитать [WORK-COMPUTER-BOOTSTRAP.md](WORK-COMPUTER-BOOTSTRAP.md). Файл содержит автономный процесс: перенос обвязки и памяти, проверяемую установку, адаптацию MCP, активацию системного промпта, проверку GigaCode 26.10.6, локальное встраивание CLI без секретов и продолжение существующего GigaCode UI. Повторять требования в чате не нужно.

Для большого обновления с Browser Lab, IDE, Design & Artifacts, Task tracker, OpenShift/Kubernetes/Jenkins/knowledge, Sprut, Data workbench и Git/forge агент затем читает [SUITE-UPGRADE-AGENT.md](SUITE-UPGRADE-AGENT.md). [Карта документов](docs/suite/README.md), [матрица функций](docs/suite/COMPETITOR-CAPABILITY-MATRIX.md), [gap-аудит решений](docs/suite/COMPETITOR-GAP-AUDIT.md) и [машиночитаемый план](suite/implementation-plan.json) позволяют продолжать по одной проверяемой карточке в пределах 256k контекста.

## Что уже реализовано

В `app/` есть Electron + React приложение с настоящими локальными сервисами:

- Проекты, задачи и разговоры, сохранение истории, архивирование и восстановление, поиск, пользовательские профили.
- ACP-подключения к CLI: отдельный процесс на разговор, потоковые ответы, очередь, отмена и явное восстановление после неизвестного результата. Старый запрос при восстановлении автоматически не повторяется.
- Выбор модели и reasoning из реальных параметров CLI. CORE + одна роль добавляются к системным инструкциям изученного Qwen 0.25.1; неизвестный Giga использует явно обозначенный context fallback. Существующий workplace LLM-router подключается через adapter без замены удачной реализации.
- Markdown, сгруппированные вызовы инструментов, план агента, вопросы с вариантами и свободным ответом. Разрешения CLI используют его собственные варианты ответа.
- Перемещаемые панели, несколько браузерных вкладок и терминалов, проводник проекта, базовое редактирование текста и Git status/diff.
- Локальный MCP-сервер для инструментов браузера, снимков экрана, вопросов, плана, материалов и дочерних сессий. Вкладки браузера привязаны к сессии, хранилища сайтов разделены по проектам.
- Регистрация материалов, просмотр текста/Markdown/изображений/HTML, экспорт; базовая память и локальная диагностика.
- IDE на Theia с Java/Python/frontend расширениями, общими buffers, build/test/debug и восстановлением; PostgreSQL workspace с inline grid, routines, EXPLAIN и потоковыми CSV/SQL/XLSX.
- Jenkins: каталог/папки/избранное, параметры, queue/builds/logs, trigger/cancel/stop и readback. Кластеры: discovery, namespaces/resources/CRD, YAML/drafts, events и backend watch (UI использует snapshots), dry-run/apply/create/scale/restart/delete. UI и агент используют один Operations service; чужие corporate MCP требуют проверки настоящих schemas/DTO.

Реализованная команда и документированный продуктовый контракт — разные уровни готовности. Полный suite описан как план автономной миграции, а не выдан за готовый runtime. Окончание ответа модели, макет или наличие кнопки сами по себе не доказывают работу backend.

## Получить код для рабочего компьютера

Клонируйте текущий `main` либо скачайте исходники соответствующего [релиза](https://github.com/wuller1/gigacode-workbench/releases). Откройте код в GigaCode и направьте агента на [WORK-COMPUTER-BOOTSTRAP.md](WORK-COMPUTER-BOOTSTRAP.md). Агент сначала сравнит существующую оболочку с этим кодом и сохранит лучшее; инструкции по переносу IDE находятся в [IDE-RUNTIME-HANDOFF](docs/suite/IDE-RUNTIME-HANDOFF.md). Авторизация, MCP credentials и пользовательская история в исходники не включены. Совместимость рабочего GigaCode 26.10.6 проверяется на месте.

[Снимок настоящего приложения с работающим исполнителем](docs/images/live-workers.jpg) · [Отчёт проверок и оставшиеся ограничения](docs/LIVE_TEST_REPORT.md).

## Быстрый запуск на Windows из исходников

Понадобятся Windows x64, Git и **Node.js 22.19 или новее в ветке 22, либо Node.js 24** с npm. Это минимум текущего приложения; для IDE используется закреплённый Node 22.23.3. Windows PowerShell 5.1 подходит для команд ниже; устанавливать PowerShell 7 не требуется.

Скачайте репозиторий или клонируйте его, откройте PowerShell в корневой папке и выполните:

```powershell
cd app
npm.cmd ci --include=optional
npm.cmd run setup:ide
npm.cmd test
npm.cmd start
```

`npm start` собирает renderer и Electron main/preload, затем открывает desktop-приложение. `npm run dev` запускает только Vite и не заменяет запуск Electron. Установка требует доступа к npm и загрузкам Electron. Не исключайте optional dependencies: среди них находятся платформенные компоненты терминала и обработки изображений.

`setup:ide` отдельно готовит закреплённые Theia, Node, Java/Maven и расширения; глобальные SDK не меняются. Проверка полного чата — `npm run test:chat`, реальной IDE — `npm run test:ide`; Python/Java/React набор — `npm run test:ide:languages`. У проверок чата локальный ACP peer, у IDE настоящие language servers и инструменты; платный провайдер не нужен.

Откройте папку проекта, создайте задачу и разговор. Приложение не запускает настройку существующего репозитория автоматически. Для первого знакомства можно открыть отдельную пустую тестовую папку.

### CLI и доступ к модели

В зависимостях закреплён **официальный `@qwen-code/qwen-code` 0.25.1**, опубликованный 11 октября 2026 года. В режиме разработки он находится в `app/node_modules`; конфигурация упаковки включает его в desktop-сборку. Глобальная установка Qwen не нужна. Локальный entrypoint и Windows packaged probe на commit `0f9d8eb` подтвердили `--version` → 0.25.1. Проверяйте конкретный скачанный артефакт: этот результат не заменяет установку и авторизацию на вашем компьютере и не подтверждает совместимость корпоративного форка GigaCode.

Если Qwen уже настроен, приложение использует доступную этому CLI конфигурацию. Для OpenRouter можно передать переменные только текущему процессу PowerShell. Пример не записывает ключ в репозиторий или в командную историю:

```powershell
$workbenchSecret = Read-Host 'OpenRouter API key' -AsSecureString
$env:OPENAI_API_KEY = ([System.Net.NetworkCredential]::new('', $workbenchSecret)).Password
$env:OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
$env:OPENAI_MODEL = 'qwen/qwen3.7-flash'
try {
    npm start
} finally {
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
    Remove-Variable workbenchSecret -ErrorAction SilentlyContinue
}
```

В настройках приложения для этого подключения задайте поле «Аргументы запуска» как JSON-массив: `["--acp", "--auth-type", "openai"]`. Выберите модель, доступную вашему аккаунту; приведённый ID — пример, а не обещание цены или доступности. Сам ключ не вставляйте в поле аргументов, промпт, профиль, снимок экрана или issue. Переменные окружения доступны запущенному процессу и не являются защищённым хранилищем секретов. Для уже собранного приложения такие переменные также должны быть у процесса, который его запускает; запуск отдельным ярлыком их не наследует от этого окна PowerShell.

Для GigaCode можно собрать **собственный комплект CLI внутри оболочки**, без глобальной установки и без изменения CLI: [импорт и упаковка runtime](docs/BUNDLED_CLI.md). Выбор «Использовать встроенный CLI» хранится как `@bundled`, поэтому portable-приложение не зависит от прежнего временного пути распаковки. Сам корпоративный runtime не публикуется в Git.

**Другой вариант — подключить GigaCode извне:** в настройках можно выбрать установленный пользователем CLI и его реальные ACP-аргументы. Предпочтителен `.js` entrypoint или `.exe`; `.cmd` имеет ограничения на аргументы. GigaCode не поставляется в этом репозитории, его исходники не меняются. Совместимость конкретного форка, параметры reasoning и дополнительные методы нужно проверять на его установленной версии. Сходство с Qwen не заменяет эту проверку.

## Сборка Windows

Из папки `app/`:

```powershell
npm.cmd run dist:win -- --publish never
```

В `app/release/` формируются NSIS installer и portable `.exe`. Сборки сейчас не подписываются; наличие файла не означает завершённую ручную проверку установки. CI собирает **Windows x64** на Windows, а не переносит нативные модули с macOS. `npmRebuild: false` сохранён намеренно: используются платформенные пакеты из lockfile, а CI отдельно проверяет загрузку PTY/Sharp. Если такие пакеты отсутствуют, сборку нужно исправить, а не считать терминал проверенным.

[Windows workflow](.github/workflows/windows.yml) запускает `npm ci`, тесты, build, проверку нативных зависимостей, NSIS/portable packaging, проверку запуска упакованного Qwen с `--version` и самого packaged IDE. Результаты доступны как Actions artifacts после успешного прогона. Платные модели в workflow не вызываются. IDE staging отдельно включает закреплённые Node, Temurin Java 21 с corresponding source и Maven. Python, Git и SDK конкретных проектов настраиваются отдельно.

## Проверки и ограничения

- `npm run test:ui` из `app/` проверяет закрытие диалогов и восстановление фокуса в отдельном Electron без CLI и обращений к модели. Проверка включена и в Windows CI.
- Сохранённые локальные проверки IDE/Data среза 0.3: **116 unit/protocol**, **44 PostgreSQL**, **25 Data UI**, **45 IDE/language/recovery** и **18 Python pipe regressions**. Прежние **16 Electron UI/focus**, **3 full-app chat** и **9 dependency checks** сохранены отдельно. Два unit-теста пропускаются по платформе; 44 live PostgreSQL cases пропускаются без изолированного сервера. Обычные наборы не используют платную модель. [Наблюдения IDE](docs/suite/evidence/ide-live-macos.json), [аудит](docs/suite/IDE-RUNTIME-AUDIT.md). Fixture-проверка протокола не подменяет реальный language server или рабочий GigaCode.
- [Windows CI `ed5144c`](https://github.com/wuller1/gigacode-workbench/actions/runs/38521851028): **116 unit/protocol**, 18 Python pipe, 9 dependency, 16 UI и 3 chat; **44 PostgreSQL, 25 source + 25 packaged Data UI, 44 source + 44 packaged IDE**, legacy PowerShell 5.1, PTY/Sharp, NSIS/portable, packaged Qwen 0.25.1 и resource/hash checks. [Точный отчёт](docs/suite/evidence/windows-ed5144c.json). Прежние [40 + 40 IDE](docs/suite/evidence/ide-windows-0f9d8eb/provenance.json) сохранены как история. Ручная установка и корпоративное окружение проверяются отдельно.
- Настоящий Qwen 0.25.1: [две ACP-сессии и точный config readback](docs/suite/evidence/qwen-0.25.1-metadata.json) прошли. [Три отдельных OpenRouter marker-прогона](docs/suite/evidence/qwen-0.25.1-provider.json), 6 host prompts всего: два несовпадения и один успешный диагностический прогон; unconditional provider pass не заявляется. [Dependency audit](docs/suite/evidence/dependency-audit.json) отдельно сохраняет оставшиеся IDE warnings и применённые защиты.
- Отдельно были выполнены короткие реальные ACP-проверки Qwen 0.25.0 через OpenRouter на macOS: независимые одновременные сессии, отмена одной сессии и чтение/смена reasoning. Приватные credentials, harness и трассы этих запусков в репозиторий не включены.
- В настоящем Electron на macOS проверены browser click/viewport/docking, вопросы, материалы, модель/reasoning, дочерний агент, два окна, архив/восстановление, focus/Escape и завершение PTY. Полные результаты — в [отчёте](docs/LIVE_TEST_REPORT.md). Ручная установка Windows NSIS/portable, GigaCode 26.10.6 и весь roadmap пока не проверены.
- Передача краткого контекста создаёт новую ACP-сессию с host checkpoint. Она не редактирует непрозрачную историю CLI и не является его нативной командой сжатия.
- Изоляция разговоров и областей браузера не является песочницей для всех нативных инструментов CLI. Терминал и агент работают с правами пользователя; выдаваемые CLI разрешения и границы задачи остаются существенными.
- При неизвестном результате сначала сверьте возможные изменения, затем используйте явное восстановление. Повтор запроса не гарантирует отсутствие повторных внешних действий.

Данные приложения сохраняются в локальном Electron `userData`; точный путь показывает информация о приложении. `WORKBENCH_DATA_DIR` позволяет запустить отдельный тестовый экземпляр с другим хранилищем. Он не изолирует настройки самого CLI: для этого Qwen поддерживает собственный `QWEN_HOME`. Не направляйте тестовый экземпляр в данные единственной рабочей копии.

Для агента, который продолжит работу на другом компьютере: начните с [AGENTS.md](AGENTS.md). Для проверки своего форка предусмотрен [отдельный ACP probe](docs/MANUAL_ACP_PROBE.md), по умолчанию без запросов к модели.

## Где искать подробности

| Задача | Документ |
| --- | --- |
| Узнать точный срез реализации, проверки и первый шаг следующего агента | [Implementation status](docs/IMPLEMENTATION_STATUS.md) |
| Проверить live/fixture/Windows результаты и точный commit | [Отчёт проверок](docs/LIVE_TEST_REPORT.md) |
| Понять интерфейс приложения и backend-контракт | [app/CONTRACT.md](app/CONTRACT.md) |
| Использовать исходный пакет ролей и workflows | [workbench/README.md](workbench/README.md) |
| Настроить прежнюю обвязку отдельно | [workbench/START-HERE.md](workbench/START-HERE.md) |
| Продолжить реализацию UI по небольшим этапам | [План разработки](workbench/docs/GIGACODE_UI_DEVELOPMENT_PLAN.md), [delivery checkpoints](workbench/docs/DELIVERY_AND_DOGFOOD_PLAN.md) |
| Перенести максимальный suite с браузером, IDE, макетами, tracker, DevOps/Sprut, БД и forge | [Автономная инструкция](SUITE-UPGRADE-AGENT.md), [карта](docs/suite/README.md), [gap-аудит](docs/suite/COMPETITOR-GAP-AUDIT.md), [карточки](suite/implementation-plan.json) |
| Сопоставить элементы эскиза с требованиями | [UI implementation map](workbench/docs/UI_IMPLEMENTATION_MAP.md) |
| Понять границы нативной миграции | [Native migration](workbench/docs/NATIVE_WORKBENCH_MIGRATION.md) |
| Проверить права на изображения и другие материалы | [Asset rights](workbench/docs/ASSET_RIGHTS.md) |

`workbench/` сохраняет исходные инструкции, профили, шаблоны, планы, текстовые исходники и материализованные PowerShell-скрипты. Его исторические отчёты относятся к тому пакету, а подробные UI-документы включают ещё не реализованные требования. Приложение читает роли и контекст из пакета; это не означает автоматическое выполнение каждого описанного workflow. Материалы с именем `mock-*` — эскизы, а не доказательство работы desktop-приложения.

Собранное приложение включает read-only библиотеку для продолжения собственной разработки: `workbench/`, `docs/suite/`, машиночитаемый план, интерактивный прототип и starter корпоративного UI kit. Агент получает их адресно через `workbench_reference`; произвольные файлы репозитория и зависимости UI kit в эту поверхность не входят.

Собственные материалы репозитория доступны по [Apache License 2.0](LICENSE), кроме файлов с отдельной вложенной лицензией. Сторонние компоненты и сохранённые attribution перечислены отдельно в [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md) и не перелицензируются корневой лицензией.

Сообщая о проблеме, укажите версию приложения/CLI, ОС, шаги и ожидаемый результат. Прикладывайте очищенный диагностический отчёт; не публикуйте ключи, содержимое частных проектов или полные необработанные трассы.
