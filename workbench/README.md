# Профили и pipelines для GigaCode

Пакет для работы в GigaCode CLI и для подключения к собственной оболочке. Включает системный промпт, 14 профилей, 29 маршрутов работы, измеримые правила качества дизайна, журнал и восстановление, нативную команду `/workbench` и локальный контроллер этапов. Целевая версия пользователя — 26.10.6 на другом компьютере. Перед настройкой прочитай фактическую версию выбранного CLI и его справку; ожидаемый номер не заменяет runtime evidence.

**Начните с [START-HERE.md](START-HERE.md).** Агент выполняет самонастройку, сохраняет контекст продолжения, затем сам предлагает перейти к GigaCode UI с готовым первым шагом. После принятия предложения использует имеющиеся пути и результаты, не требует повторно объяснять требования. Версия пакета — 1.3.0.

Начните с последовательного режима: GigaCode исполняет текущий этап, контроллер сохраняет прогресс. Для этого не требуется новая оболочка или headless API. Нативные возможности сверены с публичной документацией; GigaCode 26.10.6 здесь не запускался. Ранее исследовалась совместимость для целевой 26.9.75; те сведения и прежний RUNBOOK не доказывают работу новой сборки.

Ваши существующие репозитории уже настроены: повторять `repo-setup`, массовую установку или генерацию всей документации не требуется. В прежней обвязке есть глобальные правила, запрещающие сокращать проверки и повторное чтение. При подключении замените конфликтующие правила процесса, предварительно сохранив исходные файлы; предметные правила проекта сохраните. Что сохранить и изменить — в [аудите прежней обвязки](docs/BOOTSTRAP_AUDIT.md). Общий onboarding предназначен только для явно запрошенной настройки нового проекта. Изучение существующего проекта не требует его перенастройки.

Если самонастройка уже выполнена и работа над UI поручена, агент продолжает [START-GIGACODE-UI.md](START-GIGACODE-UI.md) из сохранённой карточки. Внутри — задание на исправление параллельных сессий, план развития без изменения CLI, исследованные open-source компоненты и короткие инструкции для Flash-моделей.

## Самонастройка GigaCode

Почтовая поставка содержит Markdown, JSON, TXT и отдельно разрешённую вами графику: собственные SVG-иконки и PNG-лист для просмотра. В SVG нет скриптов и внешних загрузок. Исходники PowerShell находятся в `source/*.txt`; исполняемых файлов и готовых `.ps1` в архиве нет. На целевом компьютере GigaCode сам создаёт рабочие `.ps1` по явной карте `scripts.json`. Код не выполняется при распаковке.

1. Распакуйте пакет в рабочий каталог на компьютере с Windows PowerShell 5.1 и откройте там GigaCode.
2. Дайте ему запрос:

```text
Прочитай @gigacode-workbench/START-HERE.md и выполни самонастройку. Сохрани полезные знания из прежней обвязки, адаптируй существующие MCP к профилям и проверь результат. Мои существующие репозитории уже настроены: повторно их не настраивай. После настройки сам предложи начать работу над моим GigaCode UI по готовому плану и сохрани контекст продолжения после перезапуска.
```

Если открыт сам каталог пакета, путь начинается с `@START-HERE.md`. Если синтаксис `@` не поддерживается, попросите прочитать файл по его фактическому пути. Инструкция включает резервное копирование, план с проверкой исходных версий, установку, перенос знаний, MCP и локальную проверку. Новую сессию после смены системного промпта нужно открыть явно: настройка файлов сама по себе не меняет уже запущенную модель. Перед этим агент сохраняет пути, результаты и следующий шаг по [POST_SETUP_HANDOFF](docs/POST_SETUP_HANDOFF.md).

Для ручной подготовки из каталога пакета создайте `.ps1` из первого текстового источника и выполните его:

```powershell
Copy-Item -LiteralPath .\source\prepare-scripts.txt -Destination .\prepare-scripts.ps1
powershell -NoProfile -File .\prepare-scripts.ps1
powershell -NoProfile -File .\workbench.ps1 validate
powershell -NoProfile -File .\tests\run-tests.ps1
```

Подготовка создаёт только перечисленные в `scripts.json` рабочие файлы внутри пакета, проверяет SHA-256 и отказывается перезаписывать отличающиеся файлы. Она не меняет настройки GigaCode или репозитория. Установку выполняет отдельный `install-user.ps1` по сверяемому плану. Никакого автоматического обхода execution policy нет.

Python и дополнительные модули PowerShell для работы не нужны. Для анализа изменений документации нужен Git; Node необязателен и используется только для тестов браузерного JavaScript. Контроллер использует встроенный текст C# через Add-Type, поэтому проверяется доступность обычного FullLanguage режима PowerShell; готовые DLL не поставляются.

Для постоянного контекста можно добавить содержимое `adapters/gigacode/GIGACODE.fragment.md` в проектный `GIGACODE.md`, сохранив предметные правила проекта и устранив конфликтующие старые правила процесса. Это подключает SYSTEM_PROMPT.md как контекст проекта. В переданной вами обвязке уже используется `GIGACODE_SYSTEM_MD` для замены главного системного промпта; её RUNBOOK фиксирует работоспособность механизма. Это историческое локальное свидетельство прежней обвязки для 26.9.75; оно не подтверждает контракт или работоспособность целевой 26.10.6. Здесь runtime GigaCode не проверялся. Подробнее — [в матрице совместимости](docs/GIGACODE_COMPATIBILITY.md). Распаковка и подготовка файлов не меняют переменные окружения. Опциональный шаг самонастройки устанавливает пользовательский GIGACODE_SYSTEM_MD только после подтверждения механизма на фактической сборке и по проверенному плану; при неизвестной поддержке используется явный context-only путь. Активная сессия требует перезапуска для изменения launch-конфигурации.

Для пробного запуска с заменой системного промпта в отдельном окне PowerShell из корня проекта можно назначить путь только этому процессу, без `setx`:

```powershell
$env:GIGACODE_SYSTEM_MD = (Resolve-Path .\gigacode-workbench\SYSTEM_PROMPT.md).Path
gigacode
```

Перед этим сохраните исходный промпт и проверьте, что при замене не теряются необходимые служебные инструкции вашей сборки. Проверяйте фактическую загрузку и работу инструментов по матрице совместимости, а поведение — по PROMPT_EVALUATION.md. Не импортируйте второй раз полный SYSTEM_PROMPT через GIGACODE.md, если он уже подтверждённо используется как system message. Для следующего этапа в той же сессии доступны сокращённые режимы prompt из CONTROLLER.md.

Опциональные определения 14 встроенных субагентов лежат в `adapters/gigacode/agents/`. Они наследуют инструменты родителя: до автоматического делегирования настройте реальные bindings и централизованную policy. Для базового режима копировать их не требуется.

## Первый запрос

В GigaCode:

```text
/workbench Начни с профиля аналитика. Хочу проработать новую функцию: <описание>. Изучи текущий проект, затем проведи меня через уточнение требований. Реализацию начни только когда она будет входить в моё поручение и будет достаточно данных.
```

Если нативная команда недоступна:

```text
@gigacode-workbench/BOOTSTRAP.md
Прочитай этот файл и действуй по нему. Задача: <описание>. Выбери подходящий pipeline и сохраняй прогресс в work/gigacode/feature-001.
```

Текст в угловых скобках заменяется вашей задачей. Никакие настройки серверов, токены и реальные задачи не зашиты в пакет.

## Что открыть

Это адресный каталог, не список обязательного чтения. Первый запуск следует START-HERE, первая диагностика UI — короткому D0/M0–M2 из START-GIGACODE-UI; остальные документы открываются перед соответствующим срезом работы.

| Файл | Назначение |
|---|---|
| [START-HERE.md](START-HERE.md) | Единый запуск: настройка → проверка → предложение начать UI → продолжение |
| [docs/POST_SETUP_HANDOFF.md](docs/POST_SETUP_HANDOFF.md) | Сохранение путей, результатов, принятой задачи и первого шага после перезапуска |
| [START-GIGACODE-UI.md](START-GIGACODE-UI.md) | Готовое поручение для разработки существующего UI |
| [docs/GIGACODE_UI_DEVELOPMENT_PLAN.md](docs/GIGACODE_UI_DEVELOPMENT_PLAN.md) | Пошаговый план полного функционала без изменения CLI |
| [docs/REQUIREMENTS_COVERAGE.md](docs/REQUIREMENTS_COVERAGE.md) | Потребности пользователя → канонические контракты → M/D и gates; неизвестное на целевой установке |
| [docs/PRODUCT_GAP_ANALYSIS.md](docs/PRODUCT_GAP_ANALYSIS.md) | Стыки полного пользовательского пути и небольшие адресные решения; это аудит спецификации, не реализованные функции |
| [docs/UI_IMPLEMENTATION_MAP.md](docs/UI_IMPLEMENTATION_MAP.md) | Адресная карта экранов и controls → services, этапы и проверки; читать по текущему UI-срезу |
| [docs/FILE_EXPLORER.md](docs/FILE_EXPLORER.md) | Проводник фактического workspace/worktree: дерево, поиск и просмотр уже в M3; общий editor — M6, язык/IDE — M12 |
| [docs/CUSTOM_PROFILES.md](docs/CUSTOM_PROFILES.md) | Собственные профили: создать/клонировать draft, получить рекомендацию агента, проверить версию и фактическую активацию; bundled каталог содержит 14 профилей |
| [docs/SELF_OPTIMIZING_SCRIPT_LIBRARY.md](docs/SELF_OPTIMIZING_SCRIPT_LIBRARY.md) | Повторное использование скриптов и измеряемое улучшение проверенных версий с откатом; правила доступны сейчас, native registry — M4 |
| [docs/ARCHIVE_AND_RETENTION.md](docs/ARCHIVE_AND_RETENTION.md) | Архив Task/сессий с поиском, просмотром и восстановлением уже в M3; retention/backup расширяются в M10 |
| [docs/SETTINGS_AND_CONFIGURATION.md](docs/SETTINGS_AND_CONFIGURATION.md) | Единые настройки: scope, наследование, фактическое применение и сохранение работающих model/reasoning controls; основа M2, UI M3 |
| [docs/NATIVE_WORKBENCH_MIGRATION.md](docs/NATIVE_WORKBENCH_MIGRATION.md) | Нативный перенос всей обвязки плюс новые функции UI |
| [docs/PARALLEL_SESSIONS_FIX.md](docs/PARALLEL_SESSIONS_FIX.md) | Диагностика и исправление независимых чатов |
| [docs/QWEN_BASELINE.md](docs/QWEN_BASELINE.md) | Проверенный upstream и границы совместимости fork |
| [docs/OPEN_SOURCE_RESEARCH.md](docs/OPEN_SOURCE_RESEARCH.md) | Исходники, лицензии, компоненты и шаги переноса |
| [docs/FLASH_MODEL_EXECUTION.md](docs/FLASH_MODEL_EXECUTION.md) | Малые задачи, валидаторы и промпты исполнителей |
| [docs/DESIGN_IMPLEMENTATION_GUIDE.md](docs/DESIGN_IMPLEMENTATION_GUIDE.md) | Подробные токены, размеры, компоненты и задания для слабых моделей |
| [docs/CHAT_FIRST_DESIGN.md](docs/CHAT_FIRST_DESIGN.md) | Текущее размещение UI: проекты и задачи слева, разговор в центре, composer и инструменты по запросу |
| [docs/UI_PREVIEW_GUIDE.md](docs/UI_PREVIEW_GUIDE.md) | Собственные PNG-экраны: разговор, план, документ, очередь, контекст и темы |
| [docs/ITERATION_AUDIT.md](docs/ITERATION_AUDIT.md) | Итерации аудита, найденные исправления и пределы проверок макета |
| [docs/DAILY_WORK_REFINEMENTS.md](docs/DAILY_WORK_REFINEMENTS.md) | Последние улучшения: вернуться к изменениям, разобрать ошибку, открыть результат и отложить полезную рекомендацию в задачу |
| [docs/TRANSCRIPT_AND_MARKDOWN.md](docs/TRANSCRIPT_AND_MARKDOWN.md) | Компактные группы инструментов, честные статусы/Copy и нормальный Markdown/GFM уже в M3 |
| [docs/COMPETITOR_FEATURE_PLAN.md](docs/COMPETITOR_FEATURE_PLAN.md) | Адресные идеи и функциональные референсы; предложения не становятся обязательным scope автоматически |
| [docs/GRAPHICS_AND_MOTION.md](docs/GRAPHICS_AND_MOTION.md) | Выбранные иконки, графика и точные правила анимации состояний |
| [docs/ASSET_RIGHTS.md](docs/ASSET_RIGHTS.md) | Происхождение материалов, лицензии и обязательные уведомления |
| [docs/ICON_LIBRARY.md](docs/ICON_LIBRARY.md) | 34 собственные SVG-иконки и правила подключения |
| [assets/icons-preview.png](assets/icons-preview.png) | Общий лист иконок; отдельные SVG находятся в assets/icons |
| [docs/PROCESS_ADAPTATION.md](docs/PROCESS_ADAPTATION.md) | Перенос полезных существующих процессов всех ролей; аналитик пишет brief, SDD, DOCX, сценарии |
| [docs/MODEL_AND_CONTEXT_CONTROLS.md](docs/MODEL_AND_CONTEXT_CONTROLS.md) | Выбор модели/reasoning и честный расход контекста через проверенные capabilities |
| [docs/MODEL_AND_REASONING_CONTROLS.md](docs/MODEL_AND_REASONING_CONTROLS.md) | Сохранить уже работающий reasoning-selector и разместить рядом с моделью; точные values/calls взять из действующего UI |
| [docs/IDE_PLATFORM_DECISION.md](docs/IDE_PLATFORM_DECISION.md) | IntelliJ Platform: лицензии, отдельная IDE/bridge и варианты позднего IDE-этапа |
| [docs/CONTEXT_BUDGET.md](docs/CONTEXT_BUDGET.md) | Рабочий контекст для окна около 256k, адресное чтение и восстановление |
| [docs/CONTEXT_CONTROL_AND_ERROR_RECOVERY.md](docs/CONTEXT_CONTROL_AND_ERROR_RECOVERY.md) | Управление контекстом, ручная компрессия и безопасное восстановление после 400/413 или смены модели |
| [docs/ROLE_ROUTING.md](docs/ROLE_ROUTING.md) | Автоматические переходы и рекомендации ролей внутри задачи |
| [docs/ROLE_PROMPT_BINDING.md](docs/ROLE_PROMPT_BINDING.md) | База, project policy, роль и Task packet; проверяемая доставка инструкций без вымышленного system override |
| [docs/MANAGED_SUBAGENTS.md](docs/MANAGED_SUBAGENTS.md) | Управляемые исполнители: очередь, отмена, retries, квоты, ownership, recovery и приёмка результата |
| [docs/SMART_MESSAGE_QUEUE.md](docs/SMART_MESSAGE_QUEUE.md) | Ввод во время работы, очередь/редактирование/приоритет, pinned настройки и безопасная доставка без дублирования prompt |
| [docs/SESSION_COLLABORATION.md](docs/SESSION_COLLABORATION.md) | Автоматический фоновый обмен между сессиями и связанными frontend/backend проектами; пользователь видит прогресс/результат/блокер, техническая переписка — только в диагностике |
| [docs/DELIVERY_AND_DOGFOOD_PLAN.md](docs/DELIVERY_AND_DOGFOOD_PLAN.md) | Контрольные точки с выдачей рабочих сборок пользователю |
| [docs/DESKTOP_STATE_AND_CHROME.md](docs/DESKTOP_STATE_AND_CHROME.md) | Обновление состояния без кликов/reload и собственные кнопки окна |
| [docs/DESKTOP_OBSERVABILITY.md](docs/DESKTOP_OBSERVABILITY.md) | Подробное локальное логирование и пакет диагностики |
| [docs/BUNDLED_CLI_RUNTIME.md](docs/BUNDLED_CLI_RUNTIME.md) | Поставка своего фиксированного CLI вместе с desktop-приложением |
| [docs/AGENT_BROWSER_AND_IDENTITY.md](docs/AGENT_BROWSER_AND_IDENTITY.md) | Управление браузером агентом, скриншоты, сертификаты и корпоративный вход |
| [docs/BROWSER_WORKSPACE_CONTROLS.md](docs/BROWSER_WORKSPACE_CONTROLS.md) | Browser chrome и viewport/zoom с actual DPR/resolution readback: URL/tabs и agent set/read/capture уже M3, advanced emulation M7 |
| [docs/CORPORATE_DESIGN_REFERENCES.md](docs/CORPORATE_DESIGN_REFERENCES.md) | Дополнительные корпоративные референсы и лицензированный Plasma preset |
| [docs/TASK_WORKSPACE.md](docs/TASK_WORKSPACE.md) | Работа с задачей: контекст, план, обсуждения, изменения и доказательства |
| [docs/ENTITY_LIFECYCLE_AND_EDITING.md](docs/ENTITY_LIFECYCLE_AND_EDITING.md) | Создание, изменение, архив, корзина и восстановление сущностей; исходная CLI history не удаляется скрыто |
| [docs/TASK_TODO_PANEL.md](docs/TASK_TODO_PANEL.md) | Агент сам ведёт и перестраивает план; выполненное/оставшееся/блокеры, без второго workflow engine и обязательных ручных галочек |
| [docs/TASK_ACTIVITY_INDICATORS.md](docs/TASK_ACTIVITY_INDICATORS.md) | Анимация текущего шага и состояния задач слева; активность, выбор, непрочитанное и проверенное завершение различаются |
| [docs/ARTIFACTS_AND_QUESTIONS.md](docs/ARTIFACTS_AND_QUESTIONS.md) | Материалы задачи и Task-bound overlay вопросов поверх разговора: варианты/свободный ответ, inline-вход, сохранение черновика при сворачивании; без отдельной Question panel |
| [docs/NATIVE_MOCKUP_ARTIFACTS.md](docs/NATIVE_MOCKUP_ARTIFACTS.md) | Giga создаёт интерактивный UI-макет прямо в оболочке: preview, screenshots, замечания и версии; обязательный результат M6 |
| [docs/PANELS_AND_IDE.md](docs/PANELS_AND_IDE.md) | Настраиваемые панели сразу; возможности IDE на позднем этапе |
| [docs/UI_REFERENCES.md](docs/UI_REFERENCES.md) | Дизайн рабочего инструмента и измеримые цели |
| [docs/ZIDAO_PROCESS_TRANSFER.md](docs/ZIDAO_PROCESS_TRANSFER.md) | Перенос принципов работы и удержания контекста |
| [docs/MAIN_WORK_PROCESS.md](docs/MAIN_WORK_PROCESS.md) | Принципы Zidao, адаптированные к основной работе |
| [docs/CHANGE_SAFETY.md](docs/CHANGE_SAFETY.md) | Границы изменений рабочего кода и строгая приёмка |
| [SETUP-AGENT.md](SETUP-AGENT.md) | Самонастройка, миграция знаний и адаптация MCP |
| [docs/SHARED_MEMORY.md](docs/SHARED_MEMORY.md) | Общая память с источниками, областью действия и историей |
| [docs/MCP_PROFILE_SETUP.md](docs/MCP_PROFILE_SETUP.md) | Подбор реальных MCP-инструментов для профилей |
| [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md) | Помощник и конструктивный критик: факты, качество, соблюдение ТЗ/SDD, журнал |
| [BOOTSTRAP.md](BOOTSTRAP.md) | Пошаговые инструкции агенту для первого запуска |
| [docs/PIPELINES.md](docs/PIPELINES.md) | 29 сценариев и их этапы |
| [docs/ADAPTIVE_EXECUTION.md](docs/ADAPTIVE_EXECUTION.md) | Короткие, обычные и углублённые маршруты по риску |
| [docs/DOCUMENTATION_AND_RETROSPECTIVE.md](docs/DOCUMENTATION_AND_RETROSPECTIVE.md) | Обновление документации по влиянию и ретроспектива по событиям |
| [docs/DOCS_IMPACT_TOOL.md](docs/DOCS_IMPACT_TOOL.md) | Быстрый анализ затронутых документов по Git diff |
| [docs/PROJECT_SETUP.md](docs/PROJECT_SETUP.md) | Универсальная настройка только новых проектов |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Проектирование полноценной оболочки |
| [docs/CONTROLLER.md](docs/CONTROLLER.md) | Команды, состояния и границы локального контроллера |
| [docs/MCP_PROTOCOL.md](docs/MCP_PROTOCOL.md) | Привязка Git, Jenkins, OpenShift, Confluence и Sprut |
| [docs/GIGACODE_COMPATIBILITY.md](docs/GIGACODE_COMPATIBILITY.md) | Подтверждённые нативные форматы и проверка версии |
| [docs/BOOTSTRAP_AUDIT.md](docs/BOOTSTRAP_AUDIT.md) | Расходы прежней обвязки, полезные механизмы и границы миграции |
| [docs/DESIGN_QUALITY.md](docs/DESIGN_QUALITY.md) | Проектирование, измерения, визуальное ревью и поддержание качества |
| [docs/DESIGN_PROCESS_SOURCE.md](docs/DESIGN_PROCESS_SOURCE.md) | Процессные правила из Zidao без переноса внешнего вида |
| [docs/JOURNAL.md](docs/JOURNAL.md) | Журнал шагов, checkpoints и восстановление |
| [docs/PROMPT_EVALUATION.md](docs/PROMPT_EVALUATION.md) | Приёмка поведения на реальной модели и версии GigaCode |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Выполненные локальные проверки и границы проверки |
| `profiles/` | Инструкции 14 встроенных профилей |
| `workflows/` | Машиночитаемые определения маршрутов в формате этого пакета |
| `templates/` | SDD, дизайн-контракт, передача работы, вопросы, дефекты, релиз, инцидент |
| `config/` | Примеры настроек проекта, привязок и разрешений |

## Реальные границы готовности

Контроллер реализует локальные последовательные переходы, паузы, возвраты, ограничение попыток, проверку файлов, журнал событий и защиту от устаревших отчётов. Он не является автономным orchestrator и не ограничивает инструменты GigaCode. Проверка содержания, Git-версий, полномочий и реальных внешних операций остаётся задачей host и используемых средств проверки.

Автоматический перехват каждого tool call требует интеграции транспорта; в интерактивном режиме агент явно вызывает record.

JSON из `workflows/` не является встроенным форматом GigaCode. Его читает `workbench.ps1`. Нативные команды/агенты находятся отдельно в `adapters/gigacode/`.

Перед production интеграцией требуется прочитать фактическую версию и проверить возможности целевого GigaCode 26.10.6, заполнить реальные bindings и полномочия, а затем пройти приёмочные сценарии из `docs/ARCHITECTURE.md`. Назначение Sprut подтверждено пользователем: поиск уязвимых версий библиотек. Точные имена и схемы его MCP-инструментов устанавливаются самонастройкой по фактической среде.
