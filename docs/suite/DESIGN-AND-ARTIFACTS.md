# Design & Artifacts: полный цикл макета

## Цель

Workbench должен позволять агенту и пользователю пройти путь `описание → варианты → интерактивный макет → проверка → решение → реализация → визуальная приёмка` внутри одной Task. Макет является версионируемым материалом с измеримыми свойствами и связью с кодом. Простая HTML-страница, screenshot или картинка без состояний и проверки не считаются завершённым макетом.

Интерфейс берёт полезные принципы из Figma/Penpot Dev Mode, Storybook и browser trace tools, но использует собственные иконки, layout и assets. Не копировать screenshots, фирменную графику, закрытый код или trade dress конкурентов.

## Виды материалов

```ts
type ArtifactKind =
  | "design-brief"
  | "flow-map"
  | "wireframe"
  | "interactive-prototype"
  | "component-spec"
  | "design-tokens"
  | "vector-asset"
  | "image"
  | "browser-capture"
  | "visual-diff"
  | "test-trace"
  | "document"
  | "dataset"
  | "build-output";
```

Version содержит immutable source snapshot/hash, generated previews, provenance, parent version, Task/author/session, viewport matrix, review status и evidence. Draft редактируется отдельно; публикация создаёт новую версию. Удаление ссылки не уничтожает общий blob, пока он используется другой версией.

## Пространство Design

### Navigator

- Brief и решения;
- Pages, flows и states;
- responsive artboards;
- components, variants и component states;
- tokens/themes;
- assets с происхождением и лицензией;
- versions, review comments и ready-for-development queue;
- linked implementation files/stories/tests.

### Canvas

Первый реализуемый canvas — безопасный кодовый прототип HTML/CSS/JS, отрисованный BrowserService в непривилегированном partition. Он даёт агенту реальную интерактивность и точный перенос в React. Векторный слой можно добавить позднее через собственный scene graph или проверенный OSS editor; отсутствие векторного редактора не маскируется.

Canvas поддерживает:

- несколько artboards рядом и presets desktop/tablet/mobile;
- zoom/pan, rulers, guides, grids и snapping;
- layers/outline и focus выбранного элемента;
- light/dark/high-contrast/theme modes;
- состояния default/hover/focus/active/disabled/loading/error/empty;
- текстовые/data scenarios, в том числе длинные строки и локализация;
- selection dimensions, spacing, typography, color и token refs;
- prototype links, overlays, transitions и keyboard paths;
- side-by-side/overlay/slider сравнение версий;
- comments/annotations, resolve/reopen и привязка к координате/element ref;
- fullscreen preview и открыть в Browser Lab.

Canvas не загружает app preload. Generated HTML получает строгий CSP, sandboxed frame/WebContentsView, запрещённый Node, ограниченные navigation/popups и отдельный origin. Remote assets не подгружаются молча.

### Inspector и handoff

Inspector показывает:

- semantic element/component name и variant;
- box model, constraints, grid/flex properties;
- token-backed color/typography/spacing/radius/shadow/motion;
- interaction/keyboard/focus order;
- accessible name/role/states и contrast;
- assets и export presets;
- linked React component/file/story/test;
- change since approved version;
- generated CSS/React hint только как reference, с пометкой source version.

Статусы: Draft → Review → Changes requested → Approved → Ready for development → Implemented → Verified. Они не определяются ответом модели; переход подтверждается review/evidence rules Task.

## Агентский pipeline создания макета

1. **Разбор задачи.** Сформировать design brief: пользователи, top jobs, data/states, constraints, brand/tokens, target viewports и acceptance. Отметить неизвестное.
2. **Критика brief.** Найти противоречия, отсутствующие состояния, риск перегрузки и доступности. Для существенной развилки показать короткий вопрос поверх workspace; свободный ответ всегда доступен.
3. **Информационная архитектура.** Flow map, screen inventory и state matrix до декоративной отрисовки.
4. **Варианты.** Сделать 2–3 осмысленно разных направления только для спорного решения. Не генерировать вариации ради количества.
5. **Выбор и детализация.** Зафиксировать решение и причины; собрать responsive interactive prototype из собственных компонентов/tokens.
6. **Автоматический audit.** Запустить геометрию, contrast, keyboard/accessibility, responsive overflow, interaction и visual checks.
7. **Живая проверка.** Агент реально управляет prototype в Browser Lab, делает снимки и trace. Успех по DOM existence запрещён.
8. **Review.** Пользователь комментирует прямо на artboard; агент исправляет в новой version, сохраняя diff.
9. **Handoff.** Создать implementation package: brief, flows, states, tokens, assets, measurements, interactions и acceptance links.
10. **Проверка реализации.** Открыть живое приложение рядом с approved version, выполнить screenshot overlay/diff и behavioral scenario; расхождения превращаются в review items.

Маленькая правка может начать с шага 5, если brief/states уже существуют. Router выбирает глубину по риску и неопределённости, а не всегда запускает полный процесс.

## Проверка дизайна по числам

Design Quality panel разделяет автоматические факты, heuristics и ручные решения. Итоговый score не скрывает отдельные failures.

### Автоматически измеряемое

- WCAG contrast для текста и UI-графики по применимому уровню;
- minimum target size и расстояние между interactive targets;
- font size/line-height/line length, обрезание и overlap;
- spacing/token deviations и alignment residuals;
- grid/edge consistency и число уникальных случайных значений;
- focus visibility/order, keyboard reachability и modal trap;
- accessible name/role, duplicate IDs, heading hierarchy и landmark coverage;
- overflow при width 320/360/390/768/1024/1440/1920 и zoom 200%;
- content stress: 0/1/many, long text, error, loading, offline и permission states;
- motion duration и reduced-motion alternative;
- screenshot pixel/structural difference по стабильной test environment;
- performance budgets живой реализации: layout shift, responsiveness и render-blocking только после реального измерения.

### Heuristics с объяснением

- hierarchy: один очевидный primary action, различимые section levels;
- density: количество competing controls и текста в viewport;
- consistency: одинаковая задача имеет один pattern;
- progressive disclosure: редко используемые детали не занимают основной поток;
- target clarity: окружение/connection/risk видны перед действием;
- recovery: cancel/undo/retry/return location;
- cognitive path: число действий от Task до результата;
- empty/error copy даёт следующий шаг;
- icon-only controls имеют tooltip и accessible name.

Thresholds настраиваются design-system profile и типом приложения. Агент не «чинит score» ухудшением UX; каждое исключение сохраняет rationale.

## Tokens, components и собственная графика

Tokens хранятся в открытом JSON-представлении, совместимом по смыслу с W3C Design Tokens Community Group format. Themes и modes не дублируют компоненты. Component version содержит props/variants/states, token dependencies, accessibility contract, responsive behavior, story/test links и migration notes.

Assets registry требует:

- `origin: original | generated | user-provided | oss`;
- source/ref, author/tool, createdAt и content hash;
- license/SPDX и attribution для OSS;
- запрет на использование непроверенного найденного изображения;
- generated prompt/seed/model metadata, если доступны;
- SVG sanitizer и raster metadata stripping;
- light/dark variants и export sizes.

Иконки Workbench рисуются как собственный единый SVG-набор: общий grid, stroke, corner language, optical alignment и states. Сберовский стиль используется как абстрактные корпоративные принципы и разрешённые пользователем assets; торговые знаки и закрытые design-system resources не встраиваются без проверенного права.

## Интеграция с кодом и Storybook-подобный режим

- Component gallery со states/props/themes/viewports;
- stories как executable fixtures проекта, а не копия production state;
- interaction tests, keyboard paths, accessibility audit и visual baseline;
- связь design component ↔ implementation component ↔ story ↔ tests;
- change notification при изменении approved token/component;
- открытие исходника/diagnostic/diff из inspector;
- генерация implementation task с перечисленными states и acceptance;
- визуальные baselines разделены по browser/platform/font environment.

Storybook можно запускать как внешний project tool и открывать в Browser Lab. Его runtime не нужно копировать внутрь приложения; Workbench хранит adapter и evidence.

## Контракты

```text
artifact.list/get/createDraft/updateDraft/publish/archive/restore
artifact.version.list/compare/approve
artifact.comment.list/add/resolve/reopen
design.brief.get/update/critique
design.pages/list/components/list/tokens/get
design.viewport.set/design.theme.set/design.state.set
design.prototype.open/run/stop
design.inspect {artifactId, versionId, elementRef}
design.audit.run {artifactId, versionId, profiles[]}
design.audit.result {runId}
design.capture {versionId, viewports[], states[]}
design.compare {baselineVersionId, actualRef, mode}
design.handoff.create {versionId, targetStack}
design.linkImplementation {componentRef, codeRef, storyRef?, testRefs?}
```

Агент получает outline, selected component, tokens, audit findings и bounded screenshots. Весь DOM/source/bitmap не помещается в prompt: большие данные остаются artifact refs.

## Этапы

1. Версионированный artifact store, safe preview и gallery.
2. Design brief/flow/state matrix и agent creation pipeline.
3. Responsive code-prototype canvas, versions/comments/compare.
4. Token/component registry, themes/states и inspector.
5. Browser-driven interaction/capture/a11y/geometry audit.
6. Handoff package и links в Task/IDE.
7. Implementation visual/behavior compare и review loop.
8. Story/component adapter и visual baselines.
9. Векторное редактирование только после выбора scene graph/OSS и license review.

## Приёмка

- **DSN-01:** агент из Task создаёт brief, state matrix и runnable prototype; после перезапуска все версии/links доступны.
- **DSN-02:** preview не имеет Node/preload/privileged IPC и не выходит из разрешённой навигации.
- **DSN-03:** artboards 320–1920px, light/dark и long/error/loading states проверяются одной matrix run.
- **DSN-04:** комментарий привязан к version/element; новая версия не уничтожает историю и resolved state.
- **DSN-05:** compare показывает baseline/actual/diff и не принимает новую baseline без явного review action.
- **DSN-06:** contrast/focus/keyboard/overflow/target-size failures воспроизводимы и ведут к точному element ref.
- **DSN-07:** handoff содержит tokens, states, interactions, assets/provenance и implementation acceptance без скрытого remote dependency.
- **DSN-08:** живое приложение проверяется рядом с approved design; screenshot success без behavioral scenario не закрывает Task.
- **DSN-09:** каждый asset имеет provenance/license; repository scan не находит скопированных vendor icons/screenshots.
- **DSN-10:** 200 artboards/versions и крупные screenshots не блокируют renderer благодаря thumbnails/virtualization/lazy loading.

## Полезные открытые ориентиры

- [Penpot user guide](https://help.penpot.dev/user-guide/) — layers, components, variants, tokens, prototypes и inspect; изучать patterns, код переносить только после отдельного license review.
- [Figma Dev Mode guide](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode) — version compare, annotations и design-to-code handoff как функциональный ориентир.
- [Storybook UI testing](https://storybook.js.org/docs/8/writing-tests) — component, visual и accessibility testing.
- [Playwright trace viewer](https://playwright.dev/docs/trace-viewer) и [visual comparisons](https://playwright.dev/docs/test-snapshots) — воспроизводимые traces и screenshot diff.

Эти ссылки описывают идеи и проверяемые возможности. Пакет не содержит их screenshots, логотипы или закрытые assets.
