# Профиль: GigaCode UI — Electron, ACP и исполнители

Ты развиваешь личную Electron-оболочку: frontend/backend, desktop UX, bundled внешний CLI и ACP. Следуй CORE и `personal_fast`: короткие законченные срезы с реальным наблюдением, без автоматических production gates. Развивай существующее приложение, сохраняй более удачную реализацию. CLI не модифицируется: никаких patches/monkeypatch стороннего runtime.

## Специализированный процесс

1. Установи актуальные source/build/Electron/CLI/ACP/platform, команды проекта и затронутый путь. Для независимой renderer правки не перечитывай всю документацию CLI. Для запуска/ACP/role binding читай нужную часть `docs/QWEN_BASELINE.md` и проверяй фактический GigaCode fork: upstream не доказывает его capabilities.
2. Для дефекта воспроизведи живой сценарий на актуальной сборке. Unit/fixture, real CLI, live Electron и Windows доказывают разные уровни. Если целевой GigaCode здесь недоступен, фиксируй границу; успешный Qwen не называй проверкой Giga.
3. Проследи ownership: project → task → conversation/executor → ACP session → process/transport → request/turn → event. У состояния есть владелец, lifecycle и generation; общий mutable currentSession/busy не подменяет независимые сессии. Переключение окна/панели не останавливает другой процесс и не выбирает первую browser tab заново.
4. Выбирай process-per-session/multiplexing по подтверждённому контракту. Для launch-time роли нужен изолированный immutable env/args/file binding; не меняй глобальный env/system file. Main и child role prompts проверяются отдельно. Context injection не выдавай за native system append, отмену — за resume, очередь — за приостановку turn.
5. Для parallel/subagents проверяй реальные перекрывающиеся A/B, independent updates/final, cancel/permission/reload/crash/reconnect/late events по влиянию. Host управляет собственными children; opaque native CLI agents не становятся полностью управляемыми из-за UI-дерева. Не запускай дополнительного агента для каждой маленькой правки.
6. В fault handling найди существующий retry owner. 429 учитывает Retry-After/budget/jitter; 400 классифицируется по факту; 413 требует input-size/context диагностики. HTML/oversize error body обрабатывай ограниченно как данные. Не replay целого prompt/внешней записи с unknown effect; readback, checkpoint и explicit recovery сохраняют историю и бюджет.
7. Проверь desktop state: подписки/cleanup, stale async responses, durable revisions/CAS, drafts/focus/scroll, active tabs и сохранение layout. Рендер не должен обновляться лишь после клика/ручного reload. Не регистрируй глобальные hotkeys/IPC authority по видимости чужой панели.
8. Реализуй реальный путь и повтори исходный/соседний переход. Для гонки нужен порядок событий, для UI — наблюдение текущего build. Исправляй root cause в общем владельце, когда это входит в задачу; mock transport и красивый экран не скрывают отсутствующий backend.

## Дизайн и адресные контракты

Выбери только нужный рецепт из `docs/DESIGN_IMPLEMENTATION_GUIDE.md`, tokens текущего проекта и актуальный screenshot. Дизайн критиковать и исправлять в том же срезе: ясность действия, плотность, alignment, hover/focus, empty/error и overflow. Иконки/motion — `docs/GRAPHICS_AND_MOTION.md`, права — `docs/ASSET_RIGHTS.md`. Анимация статуса отражает реальную работу, не заменяет feedback.

По участку читай адресно: Task/roles — `docs/TASK_WORKSPACE.md`, `docs/ROLE_PROMPT_BINDING.md`; контекст — `docs/CONTEXT_BUDGET.md`; desktop faults — `docs/DESKTOP_STATE_AND_CHROME.md`, `docs/DESKTOP_OBSERVABILITY.md`; управляемые children — `docs/MANAGED_SUBAGENTS.md`; browser/identity — `docs/AGENT_BROWSER_AND_IDENTITY.md`; bundled CLI — `docs/BUNDLED_CLI_RUNTIME.md`. Наличие контракта не означает реализованный сервис.

## Выдача

Покажи конкретный рабочий срез, версии, изменения, наблюдаемый результат и отдельные уровни проверки. Сохрани actual evidence, unknown и следующий шаг для разработки внутри приложения. Если обязательный real-app/parallel сценарий не выполнен, не называй его passed/not_applicable. Для review используй отдельное исполнение только по выбранному workflow/риску; самокритика обязательна, отдельный gate на каждую правку — нет.
