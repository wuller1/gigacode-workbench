# Аудит реализации IDE

14.10.2026. Критика выполнялась итерациями с проверкой кода, реальных процессов и UI. Наблюдения: [macOS ARM64](evidence/ide-live-macos.json), [Windows x64](evidence/ide-live-windows.json), [упакованный Windows runtime](evidence/ide-live-windows-packaged.json), [целостность пакета](evidence/bundle-integrity.json). Корпоративный ВАРМ, сертификаты, MCP и GigaCode проверяются отдельно на работе.

## Исправлено по результатам проверки

| Перспектива | Обнаруженный дефект | Исправление и проверка |
| --- | --- | --- |
| Разработчик | Архивы VSIX находились в каталоге, но языковые расширения не запускались | Безопасная распаковка; readiness ждёт plugin host. Проверены 70 расширений и настоящий TypeScript grammar, JDT и Pyright |
| Разработчик | Готовность backend принималась за готовность IDE | Отдельный authenticated startup handshake и ожидание frontend/plugin host; ранний exit и timeout имеют failure state |
| Разработчик | Повтор запроса мог изменить buffer второй раз | Write-ahead operation receipts и сверка содержимого запроса; повтор возвращает receipt, pending требует reconciliation |
| Разработчик | Номер версии мог совпасть после перезапуска | Revision включает lifetime редактора; старый lifetime отвергается даже при совпавшем numeric version |
| Разработчик | Перезапуск терял dirty text и раскладку Theia из-за нового HTTP origin | Черновики и StorageService сохраняются на диске по проекту. Проверены штатный restart, внешний disk edit и принудительный crash backend |
| Разработчик | После crash новая backend instance могла остаться со старой view | Сверяется identity engine; live buffer спасается до замены surface; процессы/view переподключаются |
| Разработчик | Отладчик возвращал пустые threads родительской сессии | Передаются parent/current/thread count; проверен остановленный дочерний DAP со стеком исходного файла |
| Аналитик/QA | `Ran 0 tests; OK` мог выглядеть как успех | Приёмка требует конкретные завершённые test cases. Проверены нативные Python/Java tests, намеренный assertion failure и исправленный rerun |
| Аналитик/QA | Состояние дерева тестов обновлялось одновременно с запуском | Приёмка ждёт завершения refresh и конкретного leaf; API возвращает выбранные пути/профиль и требует readback |
| UI/UX | Дублирующиеся toolbar и две схемы размещения | Скрыта лишняя внешняя IDE toolbar; единое split/group дерево, drag к четырём краям/в центр, native editor groups внутри IDE |
| UI/UX | Чат занимал половину экрана и возвращался с другой шириной | У IDE больше места по умолчанию; скрытие/возврат одной кнопкой, запоминаются сторона и proportion |
| UI/UX | Светлая оболочка оставляла редактор тёмным | Тема вычисляется из настроек/OS signal, а не устаревшего DOM attribute. Проверены theme readback и обе реальные surfaces |
| Аналитик | Большие tool results расходовали контекст | Bounded output, read offset/limit, пагинация тестов/задач, ограниченные previews; полный рефакторинг проверяет пути внутри host |
| Перенос | Локальный Node ABI и глобальные SDK делали сборку зависимой от компьютера | Независимый закреплённый Node, platform VSIX, managed JDK/Maven, hashes, installer staging, Windows workflow |
| Перенос | Старые manifest hashes и acceptance IDs ломали общий checker | Обновлены реальные хеши/PS1 mapping, согласованы ID, проверяется фактическая motion policy, а не декоративный marker |

Дополнительная итерация: реальные React TSX diagnostics → исправление → сборка TypeScript 6 → React DOM render; запрет скрытого saveAll перед агентским запуском; native refactoring preview возвращается как pending, а не applied; opaque revision привязан к жизни document model, включая close/reopen при одинаковом numeric version. Текущий локальный результат: 94 unit/protocol checks, 16 modal/composer/focus cases и 41 live Electron/IDE checks. После frame-clock исправления повторно прошёл базовый live прогон.

Первый Windows CI прошёл установку, legacy PowerShell 5.1, unit/build, Markdown, TypeScript/semantic edits, tasks и Node DAP, затем обнаружил timeout после backend restart. Добавлены backend epoch для layout, свежие интерактивные терминалы вместо чужих process IDs, исключение task terminals из повторного запуска и диагностические artifacts. Эти изменения затем проверены последующими Windows прогонами ниже.

Последующие Windows прогоны подтвердили Java/Spring Maven/JUnit, Python native tests с настоящим assertion failure и исправлением, React TSX compile/render. Логи локализовали timeout до `attached_shell`: Theia ожидала animationFrame до чтения layout. Native-first frame clock с cancellable timer устранил зависание; Windows подтвердил восстановление dirty buffer. Следующий обнаруженный дефект — несовпадение Node `file:///C:/` с Theia `file:///c%3A/` при чтении/удалении конфликтного черновика — исправлен нормализацией через URI. Полный Windows CI после этих исправлений завершился успешно.

UI/UX итерация: объединены model/reasoning, контекст перенесён в цветное кольцо; добавлены прямые Send now/Edit/Delete и inline редактор. Редактируемый текст сохраняется, если строка ушла в работу. Проверены порядок ACP после отмены, запрет unknown, приоритет явного Stop, focus/Escape, узкая desktop панель и статус при OS reduced-motion. UI kit собирается TypeScript 6 и упаковывает CSS/JS/types/LICENSE; весь каталог из 26 требований не объявлен реализованным.

## Границы результата

Это рабочая интеграция полноценного open-source IDE engine, а не сертификат полного совпадения с IntelliJ IDEA Ultimate. Глубокие Spring/JPA/JPQL/ORM inspections, все advanced refactorings, profiler/heap analyzer, точное plugin parity, удалённые SDK/контейнеры и все 151 acceptance unit требуют отдельных сценариев. Реестр [IDE-ULTIMATE-PARITY](IDE-ULTIMATE-PARITY.md) сохраняет незакрытые проверки.

Установленные плагины сообщают об отдельных неподдержанных VS Code activation/API (в частности чужие AI tools и часть Python terminal-shell API); это не маскируется fake capability. Используются собственный agent bridge и проверенные реальные language/test/debug сценарии. Неиспытанные plugin workflows нельзя объявлять работающими автоматически.

Два окна могут работать с разными проектами. Один корень имеет одну живую авторитетную IDE surface с переносом между окнами; одновременные независимые dirty buffers одного файла в двух native surfaces не заявляются. Для Windows штатное завершение дерева предусмотрено; принудительный crash containment потомков и ВАРМ проверяются на целевом окружении отдельно.

Сквозная приёмка chat: три сценария полного приложения (каталог до prompt, inline очередь/приоритет/реальная отмена, различение completed/cancelled). Найдено и исправлено фоновое error toast для новой папки без Git. Metadata сообщений больше не резервирует пустую строку. В Windows UI действия прошли, Playwright screenshot скрытого окна завис; захват заменён на Electron capturePage с проверкой непустого NativeImage, сами UI проверки сохранены.

## Последняя итерация: проверка установленного runtime

Успешный прежний Windows run `38464209601` проверял исходники и создание installer, но не запуск самой упакованной IDE. Следующий run `38466723005` добавил этот запуск и выявил `MODULE_NOT_FOUND`: electron-builder отфильтровал корневой `node_modules` из extraResources. Исправление — parent mapping `runtime/.ide-package` → resources, сохраняющий вложенный `ide/node_modules`. Добавлен regression через настоящий copier electron-builder, а не имитацию фильтра.

Финальный [run 38468996688](https://github.com/wuller1/gigacode-workbench/actions/runs/38468996688), commit `614591890576193854116c5ca9cc850279cbe061`, завершился успешно:

- legacy Windows PowerShell 5.1 suites;
- 94 unit/protocol checks, 2 platform-specific skips; реальные PTY/Sharp;
- 16 Electron modal/composer/focus cases и 3 full-app chat/ACP workflows;
- 40 настоящих IDE/language/build/test/debug/recovery сценариев из исходников;
- ещё 40 таких сценариев из `win-unpacked/GigaCode Workbench.exe`, с независимо упакованными Node, JDK/Maven, plugins и dependencies;
- создание NSIS/portable из уже проверенной папки, packaged Qwen `--version` → 0.25.1, resource/hash probes.

Платный провайдер не использовался: ACP peer локальный, language servers, сборки, тесты и debugger настоящие. Успешная проверка unpacked EXE не означает ручную установку NSIS, проверку автообновления или корпоративного GigaCode. Windows forced hard-crash containment потомков остаётся отдельным непроверенным случаем.

Последнее UX-уточнение пользователя: ориентир IDE — IntelliJ IDEA, сам продукт в Workbench не встраивается. Рабочий GigaCode IDE является форком Community с неизвестными здесь build/plugins; наличие Ultimate-функций не предполагается. [Инструкции](IDE-RUNTIME-HANDOFF.md) сохраняют самостоятельный Theia engine и сравнение с уже написанной пользовательской оболочкой.

## Дополнительная проверка зависимостей

Отдельный npm audit IDE обнаружил предупреждения, которых нет в app dependency tree. Критический unmaintained `decompress` заменён на `@xhmikosr/decompress` 11.1.4 через собственный CommonJS adapter, поскольку Theia требует callable `require('decompress')`, а поддерживаемая библиотека использует ESM. Проверен настоящий Theia VSIX identity/deploy path, а также отклонение escaping symlink/hardlink и записи в соседний каталог. [Первичный advisory](https://github.com/advisories/GHSA-mp2f-45pm-3cg9).

Обновлены DOMPurify, UUID в старых consumers, Mocha diff/serialize dependencies. Для [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) upstream release с исправлением пока нет: добавлена узкая depth guard в три рекурсивных walker. Patch проверяет точные исходные SHA-256, повторное применение и результат; неизвестный исходник останавливает установку. Он применяется при install/build и перед staging. Версия braces не подделывается, поэтому npm audit продолжает показывать предупреждение. Слишком глубокие glob AST теперь дают контролируемый SyntaxError; обычные вложенные шаблоны проходят.

Девять отдельных dependency checks проходят на macOS с независимым Node22. Повторный полный языковой прогон также дал 41/41. [Windows run 38475439677](https://github.com/wuller1/gigacode-workbench/actions/runs/38475439677), commit `0f9d8eb8c22b5d966022b384da8bceb6e5bdf3ec`, прошёл заново: 9 dependency checks, legacy PS5.1, 94 unit/protocol + 2 platform skips, 16 UI, 3 chat, 40 source IDE и 40 packaged IDE сценариев, NSIS/portable, packaged Qwen0.25.1/resources/hashes. Это подтверждение текущего runtime после hardening, а не наследование прежнего pass. Позднее изменены инструкции, evidence и диагностическое логирование отдельной manual ACP-пробы; обычный runtime не менялся.

Точный [audit snapshot](evidence/dependency-audit.json): app — 0; IDE — 22 затронутых dependency nodes, **0 critical, 10 high, 5 moderate, 7 low**. Это три первичных advisory families, а не 22 независимые дыры: braces (локальная mitigation), sprintf-js и @tootallnate/once. Последние два предупреждения остаются открытыми; достижимость по всем callers не доказана. Нельзя писать «все зависимости безопасны», скрывать alerts или запускать `npm audit fix --force`: предлагаемый npm downgrade Theia до 1.4/1.44 не является проверенным исправлением.

Повторный прогон отдельно выявил неработоспособность локального Maven SDK с лишними boot JARs. Установка теперь проверяет реальный Java/Maven launcher/version, переиспользует исправный SDK, а неисправный заменяет из проверенного архива через staging с откатом. Локальный тестовый SDK пересоздан вне синхронизируемого каталога; это не изменение глобального JDK/Maven пользователя.

## Отдельный настоящий Qwen 0.25.1

Free metadata/config probe создал две ACP-сессии Qwen0.25.1 и подтвердил `mode=plan` точным readback. Для этой CLI/model-конфигурации reasoning option не предложена; это не переносится на рабочий GigaCode-форк. [Metadata evidence](evidence/qwen-0.25.1-metadata.json).

Отдельная разрешённая OpenRouter-проверка Qwen3.7 Flash: три прогона по два коротких marker-only prompt, **6 host prompts всего**. Первые два дали несовпадение точного marker в B; диагностический прогон прошёл с перекрытием времени запросов, без чужих marker, tools/permissions или позднего текста. Причина ранних несовпадений не установлена. [Все результаты](evidence/qwen-0.25.1-provider.json) сохранены; это не unconditional provider pass. Manual harness теперь сообщает безопасные счётчики/длины, а не только «marker mismatch». CI и IDE fixtures по-прежнему не вызывают платную модель. Ключ, raw responses и session IDs не публикуются.

## Текущая итерация: сохранение при native Close/Quit

Windows [`50cb8e0`](https://github.com/wuller1/gigacode-workbench/actions/runs/38518306635) прошёл 44 PostgreSQL, 25 source Data UI и 18 Python pipe regressions. Source IDE остановился после 40 успешных сценариев: реальный Untitled buffer содержал ожидаемый текст с Windows CRLF, тогда как fixture требовал LF. Код продукта не менялся; harness теперь явно задаёт `files.eol` только в изолированном профиле и проверяет readback, сохраняя точное сравнение текста. Обнаруженное зависание failed-test cleanup исправляется ограниченными по времени диагностикой и завершением только принадлежащего тесту дерева процессов. [Неудачный прогон](evidence/ide-windows-50cb8e0/provenance.json) сохранён; packaged IDE/Data и установщики в нём не запускались.

После исправления fixture новый macOS прогон прошёл все 45 сценариев. Отдельный [намеренно проваленный запуск](evidence/ide-failed-cleanup-darwin.json) с настоящим несохранённым Untitled сохранил основной отчёт и cleanup, завершился ожидаемым кодом 1; собственные app/engine процессы отсутствовали после завершения. Это проверяет аварийный выход harness на macOS; Windows force-cleanup branch этим не сертифицируется.

Статус — **macOS проверен, Windows ожидается**. Исторические результаты выше не подтверждают последующие правки автоматически. Финальный production build прошёл 116 unit checks, 44 PostgreSQL cases, 25 Data UI, 45 IDE, 16 прежних UI и 3 full-app chat. Параллельный прогон ранее обнаружил несовпадение выбранного результата и ещё доступной страницы grid. После проверки `page.id === resultId` и `page.offset === offset` повторные 25 cases прошли, в том числе под PostgreSQL-нагрузкой. DOM отражает фактическую готовность страницы, тест ждёт ID результата последнего завершённого запроса перед F2. Полный 45-case IDE прогон повторён после последней защиты публикации recovery. Новый Windows source/packaged run требуется отдельно. Прежний Windows pass на commit `396be5b9c5cc071e8cf319f786158df0b0b15bf3` остаётся историческим свидетельством.

Аудит выявил потерю ручной транзакции БД при выходе, ошибочное принятие недоступного status за безопасное состояние и возможность появления нового окна после начала барьера. Добавлены строгая свежая проверка с timeout 5 секунд, отказ при открытых/выполняющихся/неподтверждённых сессиях и запрет новых окон. Это не выполняет Commit или Rollback за пользователя. В IDE отдельная native surface теперь приостанавливается перед снимком; реальные dirty документы и уже принятые bridge mutations проверяются до dispose. Запись recovery подтверждается точным чтением с диска. Ошибка POST отменяет закрытие и возвращает редактор. Повторная проверка epoch/владельца после асинхронных шагов предотвращает позднее закрытие восстановленной view.

Живые проверки используют настоящую командную палитру Theia, ввод Monaco и native `app.quit`: Untitled блокирует выход и остаётся доступным для редактирования; намеренная ошибка recovery POST сохраняет точный текст в живом редакторе без записи исходника; успешный Quit сохраняет точный черновик; новый Electron/Theia восстанавливает его как dirty buffer. При падении только backend живой renderer может передать offline snapshot. Найдена и исправлена гонка поздней публикации после timeout: старая файловая запись могла догнать повторную попытку. Последовательная публикация одного recovery-файла и cancellation token защищают порядок. Два теста с настоящей временной файловой системой и задержанным fsync подтверждают отказ старой публикации после timeout и superseding; полный IDE прогон после исправления прошёл.

Untitled, dirty-файлы вне проекта и документы сверх лимита восстановления требуют явного **Save As** перед выходом. Скрытого saveAll нет. Потеря самого renderer или ОС может оборвать запись последних символов: неподтверждённые последние нажатия не объявляются восстановимыми. Корпоративный ВАРМ и рабочий GigaCode остаются отдельной проверкой. Текущая итерация не закрывает полное соответствие DataGrip/IDEA Ultimate; [аудит Data](evidence/database-ux-audit.json) сохраняет найденные дефекты и границы верификации.

## Дополнительная итерация: результаты тестов и снимки IDE

После исправлений снова прошли 116 unit/protocol, 44 PostgreSQL, 25 Data UI, 45 IDE/language/native recovery и 18 самостоятельных Python pipe regressions. Source SHA-256 текущих Data/IDE reports сверены с файлами. Промежуточные Windows `a922fac` и macOS pipe/capture failures привели к конкретным исправлениям; они отделены от итогового pass. Текущий Windows source/packaged run пока требуется.

Python 2026.4.0 мог завершить run раньше последнего structured FAIL; затем аудит выявил асинхронный decoder после onClose. Версия и полные upstream hashes фиксируются, собственный patch добавляет конечный protocol marker и сохраняет queued callbacks только для unittest. 18 regression cases исполняют фактические pinned adapter/pipe и Python sender; отрицательные контроли воспроизводят дефекты исходного кода. Текущий Electron прогон подтвердил три разных fresh run ID: PASS, намеренный state4 с точной assertion message и исправленный PASS. Output не заменяет результат. [Provenance](evidence/ide-python-results-provenance-darwin.json) сохраняет upstream/patched/helper hashes; initial-marker pass хранится отдельно как исторический снимок. Default pytest/discovery не изменены; их полная совместимость этим циклом не доказывается.

На дополнительном прогоне тестовое окно оказалось свёрнутым; native capture ожидал кадр. Причина самого сворачивания не установлена. Capture теперь явно отклоняет скрытое/свёрнутое окно, ограничен 10 секундами, сверяет видимость/bounds после ожидания и проверяет непустой PNG. Фокус и видимость пользовательского окна не меняются. Живой тест подтвердил быстрый отказ без artifact, восстановил только собственное fixture-окно и получил реальные снимки обеих тем. UUID исключает коллизии имён параллельных снимков.

Data close использует host activityRevision для операций без query job и сверяет approval в serial queue перед Rollback. Реальные tests проверяют сохранность private/public данных после отказа устаревшего подтверждения. Новый запрос в закрытой консоли отклоняется независимо от renderer. Детали переноса и границы native run attribution перечислены в [IDE handoff](IDE-RUNTIME-HANDOFF.md) и [Data handoff](DATABASE-RUNTIME-HANDOFF.md).
