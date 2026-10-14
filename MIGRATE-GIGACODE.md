# Перенеси эту сборку в моё существующее приложение GigaCode

Это основная точка входа рабочего агента для следующего обновления. Источник — **исходники desktop-приложения GigaCode**, историческое имя репозитория — GigaCode Workbench. Цель — уже существующая пользовательская оболочка на рабочем компьютере. **Это не установка обвязки в GigaCode CLI.** Установленный CLI **26.10.6**, его исходники, credentials, MCP bindings, личная память, история, runtime и установленные расширения сохраняются.

Пользователь уже поручил перенос, адаптацию и проверку. Выполни их самостоятельно до рабочего проверенного результата. Не ограничивайся планом и не проси повторить этот документ. Не делай глобальную установку CLI и не запускай старый `install-user.ps1` как обязательную часть обновления приложения.

Практическая карта адаптеров контекста, калибровки, текстового зрения и исполнителей: [FLASH-RUNTIME-ADAPTATION.md](docs/suite/FLASH-RUNTIME-ADAPTATION.md).

## Сначала восстанови рабочий контекст

1. Установи `SourceRoot` — каталог новой сборки с этим файлом; исходники могут быть git checkout или source ZIP. Установи `TargetRoot` — **существующий проект пользовательского приложения**, а не `%USERPROFILE%\.gigacode`, каталог установленного CLI, память или новый пустой проект рядом с ним. Найди его в открытом проекте и прежнем checkpoint; не сканируй весь компьютер.
2. В `TargetRoot` прочитай существующий `AGENTS.md`, `.gigacode-upgrade/QUICK-UPGRADE.md`, `.gigacode-upgrade/receipt.json` и незавершённые `journal-*.json`, если они есть. Локальные инструкции содержат соответствия каталогов, адаптеры и предыдущую проверку. Сохрани пользовательские изменения и более удачные решения других агентов.
3. В новой сборке адресно прочитай `README.md`, `docs/IMPLEMENTATION_STATUS.md` и документы изменяемого среза. Не загружай весь пакет, все логи и историю в контекст. `app/` — работающий desktop runtime, `workbench/` — материалы его процессов/ролей и опциональной legacy установки. Копирование одного `workbench/` не переносит приложение.
4. Составь короткую карту различий: main/preload/renderer/backend, authoritative state, ACP adapter, роли/router, managed workers, error recovery, context supervisor, browser/vision, UI kit, IDE/Data/Operations. Сопоставь реальные точки интеграции; совпадение имени функции не доказывает совместимость.

## Сделай проверяемый план файлов

Нужен существующий Node.js **22+**. Можно использовать уже имеющийся Node вашего приложения; Windows PowerShell **5.1** подходит. Инструмент не требует npm-зависимостей, не устанавливает и не запускает CLI.

Создай mapping JSON **вне новой сборки**, либо используй `.gigacode-upgrade/mappings.json` прошлого переноса. Если целевой проект имеет такой же монорепозиторий, достаточно:

```json
[{ "source": "", "target": "" }]
```

Если исходный `app/` соответствует корню существующего Electron-проекта, начальный вариант:

```json
[
  { "source": "app", "target": "" },
  { "source": "workbench", "target": "workbench" },
  { "source": "ui-kit", "target": "ui-kit" }
]
```

Это пример соответствия каталогов, **не подтверждение архитектурной совместимости**. Для отдельного среза используй более узкие source prefixes или точные файлы. Сначала переноси согласованный контракт целиком: types/service/MCP/main/preload/UI/tests, а не случайный набор отдельных функций. Более длинный source prefix имеет приоритет; пересекающиеся target файлы запрещены.

Пример под Windows PowerShell 5.1; замени пути установленными фактами:

```powershell
$sourceRoot = 'C:\Sources\gigacode-new'
$targetRoot = 'C:\Work\my-gigacode-desktop'
$mappingFile = 'C:\Work\gigacode-mappings.json'
$planFile = 'C:\Work\gigacode-upgrade-plan.json'
node.exe "$sourceRoot\tools\upgrade-workbench.mjs" --source $sourceRoot --target $targetRoot --mappings $mappingFile --out $planFile
if ($LASTEXITCODE -ne 0) { throw 'Migration plan failed; inspect the error without replacing files.' }
$migrationPlan = Get-Content -Raw -Encoding UTF8 $planFile | ConvertFrom-Json
```

В `--source` можно передать полный путь к `gigacode-…-source.zip`; инструмент читает ZIP сам без распаковки в целевой проект. Скрипт запускай из распакованной новой сборки. Plan-only — режим по умолчанию; `--out` создаёт **новый** UTF-8 файл и не перезаписывает старый план.

## Сравни реализации, сохраняя лучшее

План различает:

| Решение          | Действие агента                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `create`         | Новый разрешённый source файл; проверь, нужен ли он в выбранном контракте.                                            |
| `unchanged`      | Точные bytes уже совпадают, повторное копирование не нужно.                                                           |
| `update`         | Target совпадает с прошлым **неадаптированным** source baseline; допустимо обновление с backup/CAS.                   |
| `merge_required` | Существующая реализация без общей базы, локальные правки или адаптированный baseline. Инструмент её **не перепишет**. |

Для `merge_required` сравни **три версии**: `previousSourceBase` из плана/receipt, текущий target, новый source. Source baselines хранятся локально по SHA-256 в `.gigacode-upgrade/source-bases/`. Старые целевые bytes дополнительно сохраняются в `backups/` при замене. Если общей базы нет, явно зафиксируй это и выполни сравнение поведения/контрактов; не сочиняй её по памяти.

Оптимизируй повторный перенос: если `sourceHash === previousSourceHash` и `targetHash === previousTargetHash`, уже проверенная адаптация не изменилась. Сохрани её и переиспользуй прежнюю verification-ссылку; не перечитывай весь файл/историю и не запускай заново весь старый test suite без изменения зависимостей. Статус `merge_required` по-прежнему запрещает инструменту автоматически заменить adapted bytes; это не требование каждый раз заново перепроектировать неизменённый узел.

Доказуемо лучшее локальное решение оставляй и интегрируй недостающую часть нового среза через существующую архитектуру. Не создавай второй store, queue, session controller или retry engine рядом с действующим. Если оба варианта успешно проверены и имеют несовместимые преимущества, покажи конкретный diff, результаты и tradeoff и задай **один предметный вопрос** о варианте. Обычные совместимые улучшения и исправления уже разрешены.

Сохраняй workplace LLM-router и его модельные настройки; роли выбираются автоматически. Source-verified Qwen extensions/flags не включаются для GigaCode 26.10.6 по названию или версии. Сохраняй существующие более полные managed subagents/retries. Нативные скрытые CLI workers не выдавай за полностью управляемых host workers. Native vision здесь недоступна: изображения идут через настроенный текстовый bridge, а executor получает текст и реальные DOM/interaction evidence, сохраняя неопределённость.

## Примени и проверь

1. Сохрани рабочую Git-точку/backup и checkpoint. Останови целевое приложение и других агентов/редакторы, которые могут сохранять эти файлы. Tool lock координирует только этот инструмент; он не блокирует произвольные IDE и writers. Не переноси пользовательские несохранённые изменения в source baseline.
2. Примени тот же план с теми же source/target/mappings. При изменении любого входа сначала получи свежий план; не обходи CAS.

   ```powershell
   node.exe "$sourceRoot\tools\upgrade-workbench.mjs" --source $sourceRoot --target $targetRoot --mappings $mappingFile --apply --expected-plan-hash $migrationPlan.planHash
   if ($LASTEXITCODE -ne 0) { throw 'Migration stopped; reconcile the journal and backups before continuing.' }
   ```

3. Инструмент переносит только безопасные файловые изменения; `merge_required` остаются для ручной адаптации агентом. Он не запускает npm, команды приложения, модельные запросы, CLI, Jenkins/OpenShift или tests и не утверждает, что продукт работает. Выполни ручные merges согласованными группами и подходящие проверки.
4. После ручного merge создай **новый** план, затем запиши адаптированный baseline с настоящей ссылкой на проверку/решение:

   ```powershell
   node.exe "$sourceRoot\tools\upgrade-workbench.mjs" --source $sourceRoot --target $targetRoot --mappings $mappingFile --out 'C:\Work\gigacode-after-merge.json'
   $mergedPlan = Get-Content -Raw -Encoding UTF8 'C:\Work\gigacode-after-merge.json' | ConvertFrom-Json
   node.exe "$sourceRoot\tools\upgrade-workbench.mjs" --source $sourceRoot --target $targetRoot --mappings $mappingFile --apply --expected-plan-hash $mergedPlan.planHash --record-adapted 'app/electron/service.ts' --verification-ref 'local-tests:runtime-upgrade-2026-10-15'
   ```

   `--record-adapted` можно повторять для нескольких файлов. Он не копирует source поверх target; он сохраняет проверенный target hash, upstream base и ссылку на проверку. В следующей сборке этот файл снова остаётся merge boundary, даже если его target bytes не менялись. Не отмечай адаптированным непроверенный или неизвестный результат.

5. Проверяй фактический target: сборку/типы, затронутые unit/protocol, живой Electron UI и настоящие Windows-сценарии. Для runtime — две параллельные сессии/окна, live state без reload, немедленную отправку из очереди, retries и UNKNOWN no-replay, role switching, controlled workers, context reset/large input, bridge vision и светлую/тёмную тему. Не запускай платные большие context probes автоматически и не считай HTTP acceptance доказательством реального контекста модели.
6. Приложение называется **GigaCode**, Windows executable — **GigaCode.exe**. Имена существующих каталогов данных и исторический `workbench/` не переименовывай механически: это может потерять память, settings и recovery. Меняй display/product/executable identity отдельно с тестами совместимости сохранённого data path.

## Сохрани быстрый процесс для следующей сборки

Инструмент создаёт локальные `.gigacode-upgrade/QUICK-UPGRADE.md`, `mappings.json`, `receipt.json`, content-addressed source bases, журналы и backups, а в существующий `AGENTS.md` добавляет короткий указатель **один раз**. Существующие AGENTS-правила и локальные дополнения QUICK-UPGRADE сохраняются. Private folder содержит `.gitignore` с `*`; не публикуй и не force-add её в корпоративный/public Git.

**После успешной адаптации обязательно дополни локальный QUICK-UPGRADE**:

- фактические SourceRoot/TargetRoot, prefix mappings и местоположение receipt;
- какие локальные реализации сохранены и почему, где находятся facade/adapters и authoritative state;
- точные тесты, Windows/CLI adapter evidence, непроверенные границы и способ повторить smoke без paid prompts;
- компактный checkpoint текущей задачи и следующий шаг; ссылки на полные факты вместо копии всей истории;
- правило следующей сессии: пользователь даёт только новый `MIGRATE-GIGACODE.md`, агент сам находит локальную память переноса и выполняет incremental compare/merge/test.

При `interrupted` journal сначала прочитай prepared/confirmed actions и проверь текущие hashes/backups. Миграция не является общей транзакцией всех файлов: подтверждённая часть могла сохраниться. Не выполняй слепой rollback и не перезаписывай появившиеся новые пользовательские файлы. Tool owner lock после нормального завершения удаляется; чужой/нечитаемый lock не обходится. После crash установи, действительно ли прежний PID отсутствует, сохрани журнал и owner-файл и только затем устраняй подтверждённый abandoned lock.

Контракт инструмента и границы: [QUICK-UPGRADE-CONTRACT](docs/suite/QUICK-UPGRADE-CONTRACT.md). Самопроверка: `node tools/test-upgrade-workbench.mjs`.
