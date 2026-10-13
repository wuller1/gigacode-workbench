# Prototype review gate

**Status:** `implementation_authorized_by_user`
**Reviewed artifact:** [`design/suite-workspace-prototype.html`](../../design/suite-workspace-prototype.html)  
**Runtime implementation:** authorized by the direct user instruction of 14.10.2026 to implement maximum functionality and proactively improve UI/UX. Earlier prototype-only restrictions below are historical; verification gates remain.

## Historical scope presented for approval

**Историческое указание 13.10.2026, отменено прямым разрешением 14.10.2026:** сначала полный интерактивный макет итогового продукта, затем критика и явное согласование. Записи ниже сохраняют историю решений; действующее разрешение реализации указано в начале файла и в `AGENTS.md`. Не используй прежний gate для повторной остановки уже порученной работы.

- quiet warm light/dark shell, surface hierarchy, density, radii and shadows;
- Project → Task → Session continuity, compact tool activity and automatic read-only role routing;
- composer readback for model, reasoning, role/confidence, branch and context;
- Design `Canvas / UI Kit / Publish`, catalog, repository binding, release review and consumer updates;
- compact Design agent lifecycle and central-policy readback;
- one-question-at-a-time overlay with `N of M`, mutually exclusive suggestions, always-visible custom answer, defer/back and explicit confirmation;
- original Workbench mark and app-icon source preview in the UI kit;
- keyboard focus, reduced motion and responsive behavior at 1024 and 1440 CSS pixels.

## Comparison with the preferred earlier direction

| Property | Over-busy revision | Reviewed direction |
| --- | --- | --- |
| Dark canvas / panel | blue-black `#0b0e12 / #161a20` | warm neutral `#181b19 / #1f2320` |
| Light canvas / panel | cool `#f7f9fb / #ffffff` | warm `#f7f7f5 / #fcfcfa` |
| Primary action | saturated emerald | quiet neutral green `#cdd5ca` dark / `#303b35` light |
| Selection | saturated blue | low-chroma `#2e3c33 / #e7ede6` |
| Controls | mixed 7–12 px radii, strong gradients | 6 px controls, 8–9 px cards, 16 px composer |
| Elevation | large dark shadows and gradient hero | borders first, small composer shadow, shadow only for overlays |
| Header | duplicate model/reasoning/context | project, Task, target and global utilities only |
| Agent detail | competing global and local inspectors | compact local lifecycle in Design; global inspector hidden there |

## Two critique passes

### Pass 1 — structure and continuity

- Removed the duplicate global inspector from Design while keeping its context-aware agent surface.
- Kept Project, Task and Session visible together and updated task/session/role/branch readbacks on project switch.
- Kept Questions as one overlay over chat; there is no Questions workspace or scrollable question stack.
- Removed top model/reasoning duplicates; their requested → actual state lives in the composer.
- Preserved Send and queue outside the horizontally scrollable runtime-detail strip.

### Pass 2 — visual calm and access

- Restored the earlier warm palette and reduced gradients, colored fills and deep shadows.
- Raised composer primary values to at least 11 px; secondary details hide at the narrow breakpoint instead of shrinking to 7 px.
- Made the header mark unboxed and quiet; the larger application-icon source is preview-only pending approval.
- Added `:focus-visible`, arrow-key tabs/radio choices, accessible labels, focus entry and `prefers-reduced-motion` handling.
- At 1024, Design cards collapse before content becomes unreadable; at 1440, gallery and compact agent evidence remain side by side without a second inspector.

## Prototype-only boundary

The HTML, UI-kit token/catalog starter and `ui-kit/brand/` sources are review artifacts. They do not prove runtime behavior, remote publication, accessibility conformance or production readiness. Existing `app/build` and `app/public` brand assets remain unchanged. Packaging assets, native UI behavior and runtime cards may start only after explicit user approval; approval must record the accepted prototype revision and any requested changes.

After approval, implementation still requires live behavior, keyboard/screen-reader, 200% zoom, Windows, visual-regression and known-bad failure evidence. Approval of appearance never waives those gates.

## Composer revision after user review — 13 October 2026

Status remains `awaiting_user_approval`. The previous strip was rejected for clutter and alignment. Removed visible Model/Reasoning/Role/Branch/Context labels, requested/actual microtext and role confidence from the resting composer. Model and reasoning are adjacent value-only controls with chevrons, selected checkmarks, upward menus, keyboard navigation and focus return. Role, branch and context percentage form a quieter secondary group; details remain available on demand. A narrow composer wraps these groups without shrinking text or hiding controls behind horizontal scrolling. Queue count sits outside the control row. Runtime is unchanged. Model names and reasoning levels here are prototype fixtures; implementation must use actual CLI capabilities and confirmed readback.

## Context ring and icon critique — 13 October 2026

The separate context percentage crowded the secondary controls. It now appears as a static capacity arc around Send; no percentage is printed in the composer. Precise token usage is available on hover and keyboard focus and via the button's accessible description. The arc must never rotate like a loading indicator or represent task completion. Runtime requirements: use reported usage/limit, mark estimates, show an empty neutral track with “usage unavailable” for unknown usage, clamp valid fill to 0–100, retain context around Stop during generation, and keep compaction controls in Context details. High usage must have explanatory text in details, not color alone. Send keeps its single action; opening context must not accidentally send a message.

Git now has one branch curve and three balanced nodes; Settings uses a symmetrical eight-tooth silhouette. Both are original 24-unit SVGs with round joins. Updated the UI-kit sources and registered hashes. No production assets were changed.

Observed checks: light/dark rendering, keyboard tooltip, fixed capacity arc with no animation, and 768px shell without horizontal overflow. At 768px the composer ends at x=750 and Send at x=740. Larger and compact layouts retain readable values and the previous warm palette. This remains a prototype and awaits user approval; no claim of live CLI context tracking is made.

## Composer placement and capacity colors

User-requested order: branch at left; automatic profile, model and reasoning together at right, followed by Send. At compact widths the branch occupies the first control row and the right group remains together beneath it. Ring thresholds: below 75% normal green, 75–89% amber, 90% and above red. Unknown usage has an empty track and explicit accessible description; usage is clamped, exact numbers and capacity warning remain available on focus/hover. Thresholds are UI defaults, not a claim about the CLI's actual request-size limit.

## Queue interaction for approval

Composer queue count opens a compact queue above the input. Each pending message offers Send now, Edit and Delete; editing supports Save/Cancel, rejects blank text and preserves the composer draft. Prototype Send now illustrates native steering only and labels its feedback as demonstration. Runtime must capability-check mid-turn steering: unsupported CLI shows an explicit stop-and-send alternative before cancellation, waits for terminal settlement, then dispatches once. Never silently turn Send now into FIFO or replay after an unknown outcome. Editing applies only to undelivered messages with expected-revision checks; captured/dispatched entries are immutable. New behavior remains awaiting prototype approval.

## Итерация общих подключений и парных панелей

См. `UX-MULTIWORKSPACE-AUDIT.md`: строгие замечания, контракт multi-window/shared connections/agent pointer, этапы и проверки. В HTML добавлены парные панели, регулируемый разделитель, перестановка перетаскиванием, открытие отдельного окна-макета, привязки существующих подключений к нескольким проектам и демонстрационный курсор. Это не реализация host/IPC/MCP. Требуется согласование прототипа.

## Компактная навигация и скрытие чата

По запросу пользователя постоянный navigator убран: остаётся узкая полоса переключателей. Списки ресурсов открываются кнопкой папки поверх содержимого, закрываются крестиком, Escape или кликом снаружи. В верхней панели — переключатель «Скрыть/Показать чат». Скрытие расширяет инструмент, возврат восстанавливает пару панелей без пересоздания DOM и потери черновика. Проверено в браузере: черновик сохранился после hide/show; список открывается/закрывается. Runtime обязан сохранять run, draft, selected resource и scroll независимо от видимости. До согласования изменения остаются в HTML-прототипе.

### Переключатели справа

Последнее уточнение пользователя: компактная полоса инструментов находится справа, список ресурсов открывается рядом с ней. Чат скрывается отдельной кнопкой с видимой подписью «Скрыть чат»/«Показать чат» сверху; узкий экран сохраняет accessible label и tooltip. Проверено расположение при ширине 884 px: рабочая область 836 px, полоса справа 48 px. Изменение касается прототипа.

Последнее расположение переключателя чата: вместо логотипа в левом верхнем углу titlebar, только значок, без текстовой подписи. Tooltip/accessible name меняются «Скрыть чат»/«Показать чат». Кнопка исключена из draggable titlebar. Оба переключения проверены в прототипе.

## Переключение разговоров из заголовка

Название над чатом открывает список разговоров текущей задачи с поиском, статусом, отметкой выбранного и созданием разговора. HTML-прототип действительно меняет содержимое; черновик, очередь и прокрутка принадлежат выбранному разговору, переключение проекта изолирует демонстрационные разговоры. Хранение этой демонстрации — в памяти страницы, без обещания восстановления после reload. Проверены поиск SDD, переход туда/обратно, восстановление первого черновика и очереди, создание пустого разговора. Runtime требует persistent IDs project/task/session, subscriptions и единого источника статусов; background run не отменяется выбором другого разговора. Старый navigator не должен быть вторым независимым списком с фиктивным выбором.

## Одна кнопка модели и reasoning

Composer показывает «Mimo 2.6 Flash High» одной неразрывной кнопкой. Выбор модели и глубины — в одном popover; отдельная кнопка reasoning удалена. ResizeObserver скрывает ветку до переполнения строки; если нужно, профиль остаётся значком с tooltip. В широком composer ветка возвращается. Проверены смена модели и глубины в общем меню, длинный DeepSeek 4 Flash High, одинаковая вертикальная позиция модели/High и скрытая ветка в парной компоновке. В runtime варианты reasoning брать из фактических capabilities выбранной модели/CLI; демонстрационные варианты HTML не объявлять поддержкой провайдера. Скрытая ветка остаётся доступной в Source Control.

Отдельная кнопка «Рабочее пространство» удалена по запросу пользователя. Переключатели справа открывают инструмент рядом с чатом, скрытый чат остаётся скрытым. «Поменять стороны» и «Открыть в отдельном окне» перенесены в меню ⋯ заголовка панели. Проверено открытие Browser Lab в паре с чатом без прежней кнопки.

## Локальное сворачивание разговора

Прежний переключатель в titlebar и кнопка Agent/chat справа удалены. Сворачивание — стрелкой в заголовке самого разговора. На его месте остаётся узкая вкладка «Чат», разворачивающая прежнее содержимое. При перестановке сторон вкладка следует стороне чата. Фокус переносится на вкладку после сворачивания, после возврата — в заголовок разговора. Проверено сохранение черновика hide/show и отсутствие chat-button в правой полосе. Это заменяет предыдущие варианты управления видимостью чата.

Последняя правка: боковая вкладка «Чат» удалена. Свернуть — пиктограмма панели с минусом в заголовке разговора. Вернуть — та же пиктограмма с плюсом слева вверху, появляется только при скрытом чате. Проверено hide/restore и исчезновение restore-кнопки после возврата. Этот вариант заменяет полоску из предыдущей итерации.

Окончательное уточнение управления чатом: одна постоянная кнопка в левом верхнем углу titlebar, минус при открытом чате и плюс при скрытом. Обе операции выполняются на одном месте; отдельной restore-кнопки и кнопки в заголовке разговора больше нет. Проверен цикл свернуть/развернуть. Заменяет предыдущие описания расположения.

## Переработка браузерной панели

Две компактные строки: вкладки с мягким выделением активной и адрес/навигация. Убраны отдельная служебная строка browser header, тяжёлая рамка/тень страницы и постоянный DevTools sidebar. Меню ⋯ находится у вкладок. В узкой панели внешнее открытие доступно в ⋯, размер/масштаб — отдельной иконкой. Разворот освобождает место чата; вкладка и содержимое сохраняются. Page UI в HTML остаётся fixture: reload/external navigation не являются живым BrowserService, размер макета не выдаётся за настоящую эмуляцию устройства. Production viewport должен учитывать DPR, высоту, ориентацию и реальную browser capability, как описано в BROWSER.md. Не копировать proprietary assets. Эта итерация требует визуального согласования.

## Лента сообщений и время выполнения

Сверено с прежним `app/src/styles.css`: пользовательское сообщение — спокойный bubble со сдвигом вправо, ответ — текст без отдельной рамки. В suite prototype убраны видимые имена «Вы»/«GigaCode», аватары и дублирующий profile badge; accessible role labels сохранены. Под завершённым ответом — «Выполнено за 1 мин 42 с» (fixture, не результат настоящего запуска). Демонстрационный ответ и статус приведены к завершённому состоянию. Отступы и artifact layout адаптируются к ширине chat container, длинный текст переносится, pre прокручивается отдельно. Проверен узкий split и видимость footer при прокрутке.

Runtime: elapsed вычисляет host из run.started/run.completed, не модель и не timestamp рендера. Длительность включает retries/tools, но не очередь до начала выполнения; ожидание ответа пользователя хранить отдельно и раскрывать в деталях. Только successful terminal run получает «Выполнено за …»; cancelled/error/unknown имеют собственную подпись. Нет достоверного startedAt — не выдумывать время. Persist elapsed/phase transitions для reload/multiwindow; monotonic clock для активного процесса, при восстановлении использовать сохранённые интервалы с указанием приблизительности при потере событий. Формат: секунды, минуты + секунды, часы + минуты. Не суммировать параллельные subagent durations как wall time основного ответа.

## Взять задачу в работу

В прототипе: Tasks → карточка GC-249 → описание/критерии → «Взять в работу» → связанный разговор. Карточка перемещается в In progress; повторное открытие предлагает «Продолжить работу» и переиспользует разговор. Контекст передаётся в разговор, но CLI/Jira не вызываются. Ветка не назначается от прежней задачи, роль показана как auto до анализа. Тесты/терминал прежнего примера не являются доказательством выполнения новой задачи. В production: сначала прочитать tracker capabilities/status transitions и актуальную revision, атомарно назначить себе/перевести в работу по разрешённому workflow, readback, затем идемпотентно создать task-session связь. Partial failure/offline не выдавать за успешный remote переход. Отдельно действие «Начать с агентом» при необходимом разделении назначения пользователю и запуска CLI; исключить двойной запуск при повторном нажатии. Этот сценарий не означает, что уже реализована интеграция Jira.
