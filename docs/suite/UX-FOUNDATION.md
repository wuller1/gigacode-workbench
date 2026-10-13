# UX foundation

## Принцип

Workbench должен ощущаться как один спокойный профессиональный инструмент. Пользователь начинает с задачи и меняет рабочее пространство, не теряя проект, Task, selection, agent context и результаты. Плотные инженерные данные доступны быстро, но не конкурируют с основным действием.

Основные ориентиры — привычные паттерны Codex/Claude для чата и IntelliJ/DataGrip для инструментов. Использовать общие принципы навигации и компоновки допустимо; графика, тексты, иконки и точный визуальный облик должны оставаться оригинальными.

## Shell

Актуальная компоновка и приёмка описаны в [WORKSPACE-PANEL-LAYOUT.md](WORKSPACE-PANEL-LAYOUT.md): rail слева, все панели открываются совместно, чат возвращается тонкой полосой слева. Размещение уточнено после прежней схемы ниже: navigator находится только внутри IDE, inspector открывается по запросу, а model/reasoning/роль/ветка/context остаются в composer согласно FINAL-PROTOTYPE-SCOPE.md.

```text
┌ title bar: project / task       command palette       target · status ┐
│ rail │ navigator │ document tabs / primary surface      │ inspector   │
│      │           │                                      │             │
│      │           │                                      │             │
│      │           ├ bottom tabs: problems/output/terminal/results ─────┤
└ status: branch · runtime · connection · context · operations ─────────┘
```

### Activity rail

Порядок по умолчанию: Chat, Code, Browser, Design, Tasks, Operations, Data, Review. Внизу — Settings. Files, Search и Git открываются как быстрые представления соответствующих Code/Review workspace, чтобы rail не превращался в две конкурирующие навигации. Иконки оригинальные, с tooltip и shortcut. Rail 44 px, target минимум 32 × 32 px. Активное пространство определяется цветом, формой и `aria-current`, а не только цветом.

### Navigator

Ширина 240 px, допустимо 200–420 px. Содержит только дерево/список текущего workspace: файлы, browser sessions, task views, cluster resources или database schemas. Верхняя строка — название, фильтр и компактное меню. Navigator скрывается `Ctrl/Cmd+B` и сохраняет ширину отдельно по workspace.

### Primary surface

Один общий tab model для editor, diff, browser, design artboard/prototype, task, resource, document, SQL console, result snapshot и diagram. Вкладка имеет type icon, короткое имя, dirty/running/stale indicator и close. Preview tab заменяется следующим single-click open; double click/pin превращает её в постоянную. Закрытие dirty/running resource даёт конкретный выбор.

### Inspector

Контекстный, скрыт по умолчанию, ширина 300–480 px. Показывает свойства selection, relations, permissions, query parameters, resource metadata или agent evidence. Не дублирует основной экран и не открывается сам без явной пользы. `Ctrl/Cmd+Shift+I` переключает его.

### Bottom area

Problems, Output, Terminal, Tests, Debug, Network, Query results. Высота 180–520 px, сохраняется по project. Новая ошибка добавляет badge; панель не крадёт focus и не раскрывается при каждом событии. Явный запуск query/debug/test может открыть соответствующую вкладку один раз.

### Agent surface

Chat остаётся отдельным workspace и может быть открыт в split. В любой области доступно действие `Ask agent about selection`. Оно передаёт только стабильную ссылку: object ID, project/task, revision и небольшой user-visible summary. Tool calls отображаются компактными operation cards: действие, target, состояние, длительность и `Open result`; полный input/output раскрывается отдельно.

В верхней строке Chat видны Project/Task, status текущей session и компактный переключатель role. Над composer расположена сворачиваемая строка динамического Todo; completed пункты зачёркнуты и приглушены, current выделен и имеет спокойную анимацию. Справа открывается общий inspector с вкладками `Todo`, `Исполнители`, `Artifacts`, `Evidence`. Он заменяет отдельные постоянные панели для каждого вида служебных данных.

В нижней строке composer находятся attachments и scope слева, фактические model/reasoning и context meter по центру, send/stop справа. Меню модели показывает `requested → actual`, availability и effective context; reasoning показывает только значения, подтверждённые runtime. Переполнение context открывает preview сжатия, pinned facts и restore point.

Следующие сообщения отображаются небольшой queue над composer и поддерживают edit/delete/reorder. Действия `Следующим` и `Уточнить текущую работу` различаются; второе доступно только при подтверждённом steering. Pending вопрос появляется как закрываемый/minimizable modal overlay поверх текущего workspace, содержит варианты и свободный ответ и возвращает focus к launcher. Отдельной вкладки вопросов нет.

Session/task navigator показывает running/queued/needs-attention/completed/failed. Rename — inline/context menu, close/archive — иконки с tooltip; отдельные надписи «Перейти», «Переименовать», «Закрыть» в строке не нужны. Служебный обмен между исполнителями скрыт из обычного разговора и доступен только в diagnostic audit.

## Размеры и визуальные токены

| Элемент | Значение |
| --- | --- |
| Title bar | 38 px |
| Activity rail | 44 px |
| Document tab | 36 px, min width 112 px |
| Toolbar control | 30–32 px |
| Dense tree/table row | 28 px |
| Comfortable row | 34 px |
| Form field | 34 px |
| Radius | 6 px controls, 9 px cards, 12 px sheets |
| Spacing base | 4 px; типовые 8/12/16/24 |
| Body | 13 px/1.45; main prose 14 px/1.55 |
| Code | 12.5–13 px; user-configurable |

Цвета используют семантические tokens: canvas, panel, raised, border, text, muted, accent, success, warning, danger, info, selection, focus. В светлой и тёмной теме контраст обычного текста не ниже 4.5:1, крупного — 3:1, focus ring видим на всех поверхностях. Статус всегда сопровождается формой/текстом.

## Навигация и поиск

- `Ctrl/Cmd+K` — command palette с командами, recent objects и настройками.
- `Ctrl/Cmd+P` — quick open файла/символа/Task/resource/table с префиксами.
- `Ctrl/Cmd+Shift+P` — commands only, если пользователь привык к IDE-модели; обе команды могут вести в общий palette с выбранным scope.
- `Ctrl/Cmd+1…8` — workspace.
- `Ctrl/Cmd+W` — закрыть активную вкладку, но никогда приложение.
- `Ctrl/Cmd+J` — bottom area; `Ctrl/Cmd+B` — navigator.
- Back/forward восстанавливают workspace, tab, selection и scroll, не повторяя действие.

Palette показывает точный target и risk. Mutating commands получают suffix `…` и открывают review surface. Недоступная команда остаётся searchable и объясняет требуемую capability.

## Target model

Ошибки инструментов часто возникают не из-за команды, а из-за неверного target. В title/toolbar всегда показывать применимые части:

```text
Project / Task  ·  Git branch  ·  Environment/namespace  ·  DB connection/schema
```

Не показывать всё одновременно. При смене Ops/Data target control становится заметным и остаётся рядом с главным действием. Production, protected namespace, read-only database и detached Git состояния имеют постоянный marker. Переход по deep link проверяет доступность target и сообщает, если revision устарела.

## Состояния

Каждая primary surface обязана иметь:

- skeleton для первой загрузки и локальный progress для обновления;
- empty state с причиной и одним главным действием;
- partial state, когда часть adapters недоступна;
- stale marker с временем последнего успешного read;
- offline/read-only/permission state без исчезновения ранее прочитанных данных;
- error state с краткой причиной, correlation ID и безопасным retry только для идемпотентного read;
- conflict state с base/current/proposed и выбором пользователя;
- success, подтверждённый readback, а не исчезнувший spinner.

Предыдущее содержимое не очищается при refresh. Использовать `aria-busy`, но не блокировать всю область, если обновляется одна карточка.

## Review surface для изменений

Вместо цепочки `Are you sure?` использовать одну review sheet:

1. человекочитаемое действие;
2. точный target и environment;
3. diff/SQL/manifest/parameters;
4. оценка затронутых объектов;
5. validation/preflight;
6. способ проверки и rollback, если применимо;
7. явная кнопка действия с глаголом.

Typed confirmation допускается только для редких необратимых/high-impact действий. После запуска sheet превращается в operation view с progress и external ID; закрытие UI не отменяет внешний процесс.

## Таблицы и большие данные

- sticky headers, column resize/reorder/hide/freeze;
- keyboard cell navigation, range selection и copy с headers;
- virtualization без потери screen reader fallback для видимого диапазона;
- server-side paging/sort/filter там, где полный dataset неизвестен;
- видимая единица измерения и timezone;
- null, empty string, zero и unavailable различаются;
- destructive bulk action показывает количество selection и query scope;
- пользователь может сохранить view, но filter не меняет backend state сам по себе.

## Motion

Анимация объясняет состояние: 120–180 ms для panel/tab, 180–240 ms для sheet. Работающий шаг использует спокойную дугу/пульс, выполненный становится менее контрастным. `prefers-reduced-motion` и setting отключают перемещения и заменяют их мгновенным состоянием. Не использовать бесконечную анимацию как единственный статус.

## Accessibility и локализация

- Полный keyboard path, focus trap только в настоящем modal/sheet, возврат focus к launcher.
- Semantic tree/table/tablist; icon buttons имеют русские labels.
- Zoom 100–200%, Windows text scaling и narrow width 1024 px не скрывают главное действие.
- Сообщения не зашиваются в adapters; UI strings централизуются.
- Даты показываются локально, raw ISO доступен в tooltip/details.
- Console/log/code не читаются screen reader целиком автоматически; пользователь управляет live region.

## UX-проверка

Для каждой карточки сохранить screenshots в светлой и тёмной теме на 1440 × 900 и один narrow сценарий. Проверить:

1. где пользователь понимает текущий target;
2. какое главное действие видно первым;
3. можно ли завершить путь клавиатурой;
4. что происходит при loading/error/stale/conflict;
5. остаётся ли место для основного содержимого;
6. не дублируется ли информация в navigator, surface и inspector;
7. возвращается ли пользователь в исходный Task с evidence.

Отдельно измерять: время до первого полезного содержимого, число действий до типового результата, потерю focus, layout shift, main-thread long tasks и memory при 1/5/20 вкладках. Beauty score модели не является метрикой.

## Общие подключения, панели и окна — уточнение 2026-10-13

Обязательный следующий документ: [строгий аудит и контракты](UX-MULTIWORKSPACE-AUDIT.md).
Общее подключение не означает общую выбранную базу/namespace/транзакцию. При переключении проекта фоновые задачи продолжаются. Browser, Data, IDE и Operations можно держать рядом с чатом и выносить в отдельные окна. Курсор агента отображает реальные наблюдаемые действия, не имитирует активность.
## Приоритет настольного рабочего места

По уточнению пользователя приоритет — desktop. Основные средства ввода: мышь и клавиатура; основной сценарий — одновременная работа с чатом, редактором, браузером и служебными панелями. Проверять удобство частых действий, подсказки, focus, горячие клавиши, изменение размеров и сохранение раскладки. Компактность не должна уменьшать область попадания настолько, что кнопкой трудно пользоваться.

Адаптивность обслуживает узкие панели и уменьшенное окно настольного приложения. Она не должна автоматически заменять desktop-композицию мобильной навигацией или прятать частые команды в многошаговые мастера. При нехватке места вторичные действия доступны в меню, а рабочие области имеют собственную прокрутку. Сплиты и группы вкладок создаются явно и сохраняют свой тип при изменении размеров; правила размещения — WORKSPACE-PANEL-LAYOUT.md.

