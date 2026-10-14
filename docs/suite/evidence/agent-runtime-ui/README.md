# Actual App: роли, инструкции и редактор профиля

Повторяемая команда из `app`: `node tools/test-roles-ui.mjs` после `npm run build`.

Harness запускает настоящий собранный Electron App, его preload/IPC, persistence и WorkbenchService с локальным ACP fixture process. Использует отдельный WORKBENCH_DATA_DIR и только синтетический проект. Model/provider/corporate MCP отсутствуют; внешний HTTP(S) renderer заблокирован. Данные и процесс удаляются после запуска.

`report.json` содержит восемь наблюдаемых сценариев: prepared без prompt, active после fixture terminal response, retained Analyst вместо ложного Auto, desktop geometry 1000/1440, binding details/fingerprint, clone/save, UTF-8 byte overflow и malformed Unicode через controlled UI. В отчёте есть source/dist SHA-256 и проверка отсутствия дрейфа во время запуска, renderer errors и cleanup. Это не доказательство Windows, native system append, GigaCode или качества ответов реальной модели.

Снимки показывают текущий App:

- `roles-composer-dark-1440.png`: завершённый fixture turn и текущая роль в composer;
- `roles-settings-light-1000.png`: role catalog и раскрытый context binding с честным retained-mode reason.

Попытки сохранены отдельно. Сначала exact accessible-name selector не находил поле «Инструкции», поскольку wrapping label включал начальный текст textarea. После добавления явного aria-label финальный прогон проходит через exact getByLabel, включая clone/save и оба негативных UI-сценария. При последующей компоновке раскрываемого технического reason отказал слишком общий details selector; он уточнён до внешнего binding details. Assertion, запрещавший даже текст «Системное дополнение не подтверждено», заменён проверкой фактически выбранного enum/label Контекст. Это исправления измерителя с сохранением прежних результатов, а не скрытое ослабление проверки. Финальный report отражает свои source/build fingerprints.

Визуальное наблюдение: desktop geometry не переполняется, label текущей роли и binding status читаются. Причина context-only передаётся краткой русской строкой, техническое основание доступно по раскрытию. Это исправление также видно на финальном снимке. Хороший внешний вид всех разделов приложения этим ограниченным срезом не объявляется.

Финальное evidence повторено после последнего build: 8/8 actual App scenarios, 36 source/dist hashes без дрейфа и пустой rendererErrors. Native capture теперь ждёт два requestAnimationFrame: предыдущий успешный функциональный run имел устаревший compositor frame после resize; оба финальных PNG повторно просмотрены и соответствуют desktop-размерам. Это исправление harness/evidence, продуктовый код не менялся.
