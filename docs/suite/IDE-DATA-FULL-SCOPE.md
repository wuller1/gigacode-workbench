# Полный целевой объём IDE и Data

Уточнение пользователя 2026-10-13: нужны полноценные рабочие места, не облегчённый editor/SQL viewer. Предыдущие ранние этапы не определяют окончательный объём продукта.

Обязательный реестр: [26 групп функций](../../suite/ide-data-coverage.json). IDE дополнительно раскрыта в [151 отдельных сценариях Ultimate](IDE-ULTIMATE-PARITY.md), [исследовании основы и пробелов](IDE-ULTIMATE-RESEARCH.md) и [контрольных fixtures](../../suite/ide-engine-fixtures.json). SQL/Data scope остаётся в этом документе и DATABASE.md; ORM/JPQL/HQL depth отдельно принадлежит S4-06, не заменяется SQL parser. У каждой есть владелец-карточка, проверяемый критерий и пустое evidence до проверки. Сводные группы при реализации разбивать на отдельные capabilities по языку, framework, engine, transport и версии. Нельзя отмечать группу завершённой по одной удачной функции.

## Результат проверки текущего плана

IDE: уже были редактор, LSP, DAP, search, tests и toolchains. Недостаточно раскрывались семантические рефакторинги, framework intelligence, HTTP/API workflow и profiling. Добавлены S4-05/06/07; remote development остаётся S4-04 и входит в итоговую проверку.
Data: уже были transactions/grid/DDL/ERD/explain/import/export. Недостаточно выделены SQL semantic features/offline schemas, data comparison/synchronization, расширенные файловые workflows и vendor-specific tools. Добавлены S7-04/05/06. Backup/restore и другие поздние функции больше не считаются исключёнными из конечного объёма: это отдельная проверяемая волна адаптеров.

## Что означает полнота

Цель — полный заявленный рабочий цикл для Java, Python, React/TypeScript и каждой заявленной СУБД. Не обещать буквальный паритет со всеми выпусками IDEA, PyCharm, WebStorm и DataGrip и их произвольными plugins. Этот аудит расширяет покрытие требований, но не доказывает исчерпывающий список всех функций конкурентов.

Перед реализацией каждой волны агент сверяет текущие официальные capability lists и установленную рабочую реализацию пользователя, дополняет реестр до отдельных проверок. Каждое отличие получает запись: есть/нужно доработать/план/ограничено сервером/не поддержано, основание и обходной путь. Снять функцию из согласованного объёма можно только явно согласовав с пользователем; отсутствие API не повод молча убрать её.

Не выдавать LSP за всю IntelliJ, а MCP execute_sql за DataGrip. Если MCP не поддерживает introspection/streaming/transactions/refactoring/debugging, зафиксировать blocker и предложить расширение корпоративного MCP/adapters. Не переключаться молча на прямое подключение в обход выбранного пользователем MCP-пути. Локальные IDE services и tools публикуются через единый агентский API; пользователь и агент работают с одним состоянием.

Capabilities недоступного сервера остаются в реестре и объясняются в UI; не показывать активную неработающую кнопку и не заявлять полную готовность. Отдельно версии языка/framework/database, лицензии backend-компонентов и Windows packaging. Нельзя получить поддержку закрытых plugins простым встраиванием Monaco.

## Этапы и критерий завершения

IDE: documents/editor → real language/debug/test adapters → semantic refactoring → frameworks/API → profiling → remote/multiwindow/regression.
Data: connections/catalog → SQL/results/transactions → editing/schema/plans → SQL intelligence/offline → compare/files → vendor tools/engine waves.
Ранние рабочие сборки выдаются пользователю, но называться полным IDE/Data объёмом могут только после закрытия реестра для согласованной матрицы стеков/серверов. S9-02 зависит от новых конечных этапов; нельзя закрыть final audit раньше них.

Доказательства: реальный пользовательский сценарий в packaged Windows, результат операции, отсутствие потери данных, error/cancel/recovery, многопроектная изоляция, keyboard/light/dark/scaling, live agent action с видимым пользователю результатом. Тесты только на mocks не закрывают engine/language capability.

## Официальные источники сверки

Проверены 2026-10-13, официальные страницы JetBrains. Это функциональные ориентиры, не разрешение копировать реализацию или ресурсы.

- [IDEA features](https://www.jetbrains.com/idea/features/) — семантические refactorings и общая широта IDE.
- [IDEA profiling](https://www.jetbrains.com/help/idea/profiler-intro.html) — самостоятельный цикл исследования runtime performance.
- [DataGrip feature overview](https://lp.jetbrains.com/datagrip/features-overview/) — широта database workflow.
- [Data editor/viewer](https://www.jetbrains.com/help/datagrip/data-editor-and-viewer.html) — работа с результатами, объектами и файлами.
- [Data comparison](https://www.jetbrains.com/help/datagrip/compare-data.html) — отдельная возможность сравнения данных.
- [Database Explorer](https://www.jetbrains.com/help/datagrip/database-explorer.html) — объектная навигация и schema comparison.
- [Export](https://www.jetbrains.com/help/datagrip/export-data.html) — варианты вывода данных и связанные инструменты.
