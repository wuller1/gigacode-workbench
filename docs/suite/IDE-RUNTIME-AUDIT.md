# Аудит реализации IDE

14.10.2026. Критика выполнялась итерациями с проверкой кода, реальных процессов и UI. Итоговые наблюдения: [live evidence](evidence/ide-live-macos.json), [целостность пакета](evidence/bundle-integrity.json). Отчёт относится к macOS ARM64; Windows/ВАРМ и корпоративные подключения не подменяются этим прогоном.

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

Дополнительная итерация: реальные React TSX diagnostics → исправление → сборка TypeScript 6 → React DOM render; запрет скрытого saveAll перед агентским запуском; native refactoring preview возвращается как pending, а не applied; opaque revision привязан к жизни document model, включая close/reopen при одинаковом numeric version. Текущий локальный результат: 93 unit/protocol checks, 16 modal/composer/focus cases и 41 live Electron/IDE checks. После frame-clock исправления повторно прошёл базовый live прогон.

Первый Windows CI прошёл установку, legacy PowerShell 5.1, unit/build, Markdown, TypeScript/semantic edits, tasks и Node DAP, затем обнаружил timeout после backend restart. Добавлены backend epoch для layout, свежие интерактивные терминалы вместо чужих process IDs, исключение task terminals из повторного запуска и диагностические artifacts. Подтверждение исправления на Windows ожидается отдельно.

Последующие Windows прогоны подтвердили Java/Spring Maven/JUnit, Python native tests с настоящим assertion failure и исправлением, React TSX compile/render. Логи локализовали timeout до `attached_shell`: Theia ожидала animationFrame до чтения layout. Native-first frame clock с cancellable timer устранил зависание; Windows подтвердил восстановление dirty buffer. Следующий обнаруженный дефект — несовпадение Node `file:///C:/` с Theia `file:///c%3A/` при чтении/удалении конфликтного черновика — исправлен нормализацией через URI. Полный CI повторяется после этой правки.

UI/UX итерация: объединены model/reasoning, контекст перенесён в цветное кольцо; добавлены прямые Send now/Edit/Delete и inline редактор. Редактируемый текст сохраняется, если строка ушла в работу. Проверены порядок ACP после отмены, запрет unknown, приоритет явного Stop, focus/Escape, узкая desktop панель и статус при OS reduced-motion. UI kit собирается TypeScript 6 и упаковывает CSS/JS/types/LICENSE; весь каталог из 26 требований не объявлен реализованным.

## Границы результата

Это рабочая интеграция полноценного open-source IDE engine, а не сертификат полного совпадения с IntelliJ IDEA Ultimate. Глубокие Spring/JPA/JPQL/ORM inspections, все advanced refactorings, profiler/heap analyzer, точное plugin parity, удалённые SDK/контейнеры и все 151 acceptance unit требуют отдельных сценариев. Реестр [IDE-ULTIMATE-PARITY](IDE-ULTIMATE-PARITY.md) сохраняет незакрытые проверки.

Установленные плагины сообщают об отдельных неподдержанных VS Code activation/API (в частности чужие AI tools и часть Python terminal-shell API); это не маскируется fake capability. Используются собственный agent bridge и проверенные реальные language/test/debug сценарии. Неиспытанные plugin workflows нельзя объявлять работающими автоматически.

Два окна могут работать с разными проектами. Один корень имеет одну живую авторитетную IDE surface с переносом между окнами; одновременные независимые dirty buffers одного файла в двух native surfaces не заявляются. Для Windows штатное завершение дерева предусмотрено; принудительный crash containment потомков и ВАРМ проверяются на целевом окружении отдельно.

Сквозная приёмка chat: три сценария полного приложения (каталог до prompt, inline очередь/приоритет/реальная отмена, различение completed/cancelled). Найдено и исправлено фоновое error toast для новой папки без Git. Metadata сообщений больше не резервирует пустую строку. В Windows UI действия прошли, Playwright screenshot скрытого окна завис; захват заменён на Electron capturePage с проверкой непустого NativeImage, сами UI проверки сохранены.
