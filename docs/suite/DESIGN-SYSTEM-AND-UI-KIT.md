# Corporate design system and UI kit

## Цель и честная граница

Workbench должен дать команде не только разовые макеты, но и расширяемое начало корпоративной дизайн-системы: токены, компоненты, оригинальные иконки, экранные шаблоны, правила качества, публикацию и обновление потребителей. Исходники живут в отдельном корпоративном Git/Bitbucket-совместимом репозитории и доступны другим разработчикам через версионированный пакет и каталог.

Практический reference starter находится в [`ui-kit/`](../../ui-kit/README.md). Это исходная заготовка, а не заявление о готовой production-библиотеке: реализованы несколько React/TypeScript reference-компонентов, остальные компоненты имеют проверяемые контракты и state matrix. До реальной публикации организация должна выполнить brand/legal/security review, настроить forge, package registry, владельцев, CI, подпись и consumer fixtures.

Starter не содержит Sber, Plasma/SDDS, vendor/competitor assets, логотипов, чужих screenshots или font binaries. Все SVG в нём оригинальные и имеют provenance registry с хешами. Корпоративный стиль строится из одобренных семантических токенов и собственной геометрии; похожая функциональная компоновка чужого инструмента не даёт права копировать его pixels, paths, иллюстрации или бренд.

## Визуальное направление и mark

Базовое направление возвращает спокойную тёплую иерархию раннего прототипа: dark canvas/panel `#181b19 / #1f2320`, light `#f7f7f5 / #fcfcfa`, низкохроматическое выделение, 6 px controls, 8–9 px cards, 16 px composer и тени только там, где нужна реальная elevation. Синий и status colors объясняют состояние, но не окрашивают весь shell. Model/reasoning/context не дублируются в header; их actual readback живёт в нижней строке composer, где основные значения не меньше 11 px.

Оригинальный Workbench mark находится в `ui-kit/brand/`: горизонтальная рабочая поверхность, две опоры и центральная W-связь дают узнаваемый силуэт, который не выглядит как обычная omega/lowercase `w`. Для 16–24 px есть отдельная optical geometry, для 512 px — app-icon source. В chrome mark остаётся unboxed, одноцветным и 16–18 px; нельзя добавлять яркий квадрат, gradient или glow. Mark и app icon показаны только в прототипе и имеют статус `awaiting_user_approval`; production assets не заменяются до явного одобрения и brand/trademark review.

Иконки обозначают действие, а не общий признак «здесь есть ИИ». В верхней панели список `plan` открывает «План и исполнители», указатель `pointer` — управление браузером (в макете демонстрационный диалог). Иконка `agent` остаётся для роли/исполнителя. Разные действия не получают одинаковый робот; у каждой кнопки без текста есть согласованные tooltip и доступное имя. Оригинальные SVG `plan` и `pointer` сохранены в UI kit и его provenance registry.

## Код и логи как общий системный компонент

Контракт [SYNTAX-HIGHLIGHTING](SYNTAX-HIGHLIGHTING.md) обязателен для code editors, read-only preview, Markdown fences, diff и логов всех пространств. Библиотека предоставляет одинаковые semantic token names для dark/light/high-contrast, измеряемый контраст текста не ниже 4.5:1 на фактическом фоне и чёткий keyboard focus без свечения. `CodeView`, `CodeEditor` и `LogView` разделяют source/provenance и theme tokens; подсветка не заменяет parser/LSP, не исполняет source и не изменяет Copy/export. Нативные небольшие поля команд/адресов остаются обычными полями. Overlay textarea и локальный highlight.js в макете — демонстрационный компонент, а не готовая production IDE.

## Компоновка панелей

Общая компоновка регулируется [WORKSPACE-PANEL-LAYOUT.md](WORKSPACE-PANEL-LAYOUT.md): rail слева, независимые рабочие поверхности, drag за заголовок, resize, восстановление чата тонкой полосой и отдельное состояние временного разворачивания. Это единый компонент layout, а не собственный splitter каждого инструмента.

## Вопросы агента как системный компонент

`Question` — compact non-modal overlay над текущей Task/Session, а не отдельная panel. Он показывает ровно один durable queue head, `N of M`, pending count, один prompt, взаимоисключающие suggestions и всегда видимый `Свой вариант` с textarea. Ответ не уходит от одиночного выбора: отдельная Confirm/Send активируется только для валидного suggestion или непустого custom text. После receipt открывается следующий вопрос; после последнего overlay исчезает. Back/defer сохраняют draft и origin, стрелки перемещают выбор, `Ctrl/Cmd+Enter` подтверждает, Escape/close возвращают focus и не выбирают recommended default. Карточка должна помещаться при 1024 px/200% без внутреннего scroll и не превращаться в stack.

## Слои

```text
approved foundations
  └─ primitive tokens: palette / spacing / type / radius / motion
      └─ semantic themes: light / dark / high contrast
          └─ component contracts: API / states / keyboard / a11y
              └─ compositions: forms / tables / agent / review / operations
                  └─ screen templates: shell / task / data / publish
                      └─ consumer applications with pinned versions
```

Приложение использует semantic token names. Palette token не должен попадать в product component напрямую. Тема содержит одинаковый набор semantic paths; отсутствие alias — ошибка сборки. High-contrast — самостоятельная измеряемая тема, а не CSS-фильтр.

### Стартовый каталог

- foundations: цвет, spacing, size, typography, radius, border, motion;
- actions: Button, IconButton;
- inputs: TextField, Select/Combobox, Checkbox, Switch;
- navigation: Tabs, ActivityRail, CommandPalette, ResourceTree;
- data/feedback: DataTable, EmptyState, StatusBadge, Progress, Toast;
- overlays: Dialog, non-modal Question, Sheet;
- agent: SessionPicker, ContextMeter, adaptive TodoPlan, ActionLifecycle, EvidenceList;
- enterprise: TargetPicker, ConnectionCard, ReviewSheet, AuditTrail, RepositoryPublication;
- templates: application shell, task detail, data workspace, review/execute, design library, agent-assisted publication.

Реальный статус каждой сущности берётся из `registry/components.json`: `specified` не показывается как готовая библиотека, `reference-source` означает проверяемый skeleton, а `candidate`/`stable` появляются только после quality gate.

## Component gallery и inspector

Design workspace получает вкладки `Canvas`, `UI Kit`, `Publish`, а не новое глобальное workspace. `UI Kit` показывает:

- поиск/фильтр по component, token, icon и template;
- theme, viewport, density, locale, long-text и reduced-motion controls;
- все declared variants и state matrix;
- runnable fixture, props/slots/events и semantic tokens;
- keyboard path, accessibility notes и quantitative checks;
- исходник, tests, owner, version, deprecation и consumer usage;
- provenance/license/hash для asset;
- создание Task или change proposal из найденного пробела.

Gallery виртуализирует большие каталоги, но сохраняет доступный DOM для видимого элемента. Fixture изолирован от privileged Electron/Node/MCP API. Состояния `loading/empty/partial/stale/offline/permission/error/conflict/success` демонстрируются детерминированными данными; production backend state не используется как story.

## Repository binding

```text
UiKitRepositoryBinding
  project / connection / forge workspace / repository / default branch
  package registry / package name / catalog artifact
  protected branches / owner groups / required checks
  enabled capabilities / centrally disabled capabilities
  secret refs (opaque; never sent to renderer or model)
```

После настроенной project binding действует `allow-bound-capabilities`: обычные read/write/branch/PR/check/package-read действия не показывают отдельный MCP permission modal на каждый вызов. Service account всё равно имеет минимальные серверные права. Администратор может централизованно отключить connection или capability. `force-push`, удаление tag/package и подобные операции выключены по умолчанию; protected branch, review и release environment остаются обязательными организационными границами.

Реальные URL, credentials и tenant IDs не попадают в starter. Settings проверяет connection/schema/capabilities, затем сохраняет только binding и secret references. Project switch меняет repository/package/consumer targets вместе с остальным контекстом.

## Изменение и review

1. Пользователь или агент создаёт proposal, связанный с Task и текущей версией каталога.
2. Preview показывает component/token/icon/template diff, затронутые fixtures и потребителей, SemVer recommendation и migration need.
3. Agent создаёт branch/commit/PR через bound forge adapter.
4. Design-system и accessibility owners проверяют behavior, states, tokens, provenance и migration. Security owner подключается при зависимости, URL/HTML, persistence или privileged integration.
5. CI строит gallery и проверяет catalog, types, unit/interaction, keyboard, a11y, visual matrix, quantitative metrics, consumer fixtures, dependencies/licenses/secrets, package contents и provenance.
6. Result содержит remote PR/check IDs; Verify читает фактический remote revision/check state обратно.
7. Evidence сохраняет commit, diff, review, tests, screenshots/diffs, provenance и consumer compatibility как immutable refs.

Visual baseline меняется только внутри review исходного PR. Кнопка «принять baseline», скрывающая неизвестную регрессию, quality gate не проходит.

## Context-aware agent surface

Вкладка Design/Kit содержит компактный agent surface:

- active Session с role/model/reasoning и привязанным Task;
- текущий selection как typed reference: component/token/icon/template/version;
- точный repository/branch/package/channel target;
- lifecycle `proposal → preview → execute → result → verify → evidence`;
- summary/diff/checks/remote IDs и открытие полного evidence;
- queue/steer и вопрос пользователю через общий overlay;
- central-policy status и объяснение отключённой capability.

Agent surface не является вторым чатом и не создаёт отдельное workspace. Он использует общую session/operation architecture. Переключение вкладки или окна не теряет running operation; после restart UI восстанавливается из persisted operation record. `success` появляется только после readback tag/package digest/registry metadata, а неизвестный remote outcome сначала reconcile, затем retry.

В нижней строке общего composer всегда остаются компактные адресные сведения: requested → actual model, requested → actual reasoning, заполнение/лимит context, AI-selected role с confidence/reason/pending handoff, Git branch/worktree и Send/Stop. На узкой ширине сведения прокручиваются внутри своей полосы, а attachment, queue и Send/Stop остаются видимыми. Role — read-only: router выбирает его из запроса, purpose/stack проекта, Task, выбранного workspace resource, предыдущей роли и ожидаемого результата. Человек направляет работу обычным сообщением, но ручного role picker нет. Смена роли происходит на безопасной границе операции, сохраняет Task/Todo/context/artifacts/evidence и не расширяет permissions.

## Release и distribution

SemVer описывает совместимость, channel — степень готовности:

- `canary`: approved PR commit для изолированной проверки;
- `next`: exact digest проходит named consumer fixtures и migration rehearsal;
- `stable`: тот же digest получает release approval, signature/provenance и становится рекомендуемым.

Channel не переписывает lockfile приложения. Потребитель pin-ит exact version или организационно разрешённый bounded range. Workbench показывает installed → available, compatibility, breaking/deprecated/security changes, migration steps и affected projects. Обновление создаётся отдельным reviewable PR потребителя; агент не обновляет production consumers молча.

Release bundle содержит package, token outputs, icon registry, catalog metadata, changelog, migration, commit/tag, checksums, SPDX/CycloneDX SBOM, signature/attestation, visual-baseline ID, test evidence и owners/review. Promotion переносит один и тот же immutable digest, не пересобирает source.

## CI quality matrix

| Gate | Что доказывает |
| --- | --- |
| Catalog | JSON shape, уникальные IDs, source refs, все SVG зарегистрированы и hash совпадает |
| Type/unit | public API компилируется, controlled states и serialization работают |
| Interaction | mouse/keyboard/focus/async cancellation и focus return |
| Accessibility | automated audit + manual keyboard + выбранная screen-reader matrix |
| Visual | light/dark/high-contrast, 320/768/1024/1440/1920, long text, zoom, reduced motion |
| Metrics | contrast, target ≥ policy, overflow, layout shift, render budget |
| Consumer fixtures | representative Java/React host surfaces собираются и проходят critical paths |
| Supply chain | vulnerable versions/Sprut, license, secrets, package allowlist, SBOM, signature/provenance |

Автоматический accessibility scanner не заменяет keyboard/screen-reader проверку. Screenshot pass не заменяет behavior. Beauty score модели не является quality metric.

## Performance и совместимость

- bundle budgets задаются на entry point; icon imports tree-shake и не грузят весь каталог;
- CSS не содержит product-specific layout и работает при Windows text scaling/zoom 200%;
- DataGrid/Tree/Palette используют virtualization только с корректным visible accessibility fallback;
- motion 120–240 ms объясняет state и выключается `prefers-reduced-motion`;
- поддерживаемые browsers/frameworks/runtimes публикуются как release metadata;
- removal следует deprecation window и migration path;
- 200+ компонентов/fixtures не должны блокировать renderer: thumbnails/lazy fixtures/workers/isolated preview.

## Transport-neutral операции

```text
uiKit.repository.bind/get/verify
uiKit.catalog.list/get/search
uiKit.tokenSet.get/compare
uiKit.component.get/renderFixture/audit
uiKit.icon.get/verifyProvenance
uiKit.template.get/createDraft
uiKit.change.propose/preview
uiKit.review.get/create/comment/approve
uiKit.release.prepare/publish/reconcile/promote/yank
uiKit.consumer.list/checkCompatibility/createUpdate
uiKit.evidence.get/export
```

Mutation идёт через общий persisted operation lifecycle, expected revision/fingerprint и idempotency key. Adapter возвращает normalised refs и remote IDs, а не vendor-specific objects в UI.

## Проверяемые требования

- **UIK-01:** core + light/dark/high-contrast DTCG sources имеют одинаковые semantic paths; unresolved alias останавливает CI.
- **UIK-02:** component catalog показывает реальный maturity/status; specified component не маркируется ready/stable.
- **UIK-03:** gallery воспроизводит declared variants/states/viewports/themes и связывает fixture с source/tests/version.
- **UIK-04:** каждый icon/asset имеет origin/license/hash; scan не находит незарегистрированных или vendor/Sber/competitor assets.
- **UIK-05:** 1024/1440 и 200% zoom сохраняют selection, главное действие и agent lifecycle без горизонтального page overflow.
- **UIK-06:** binding работает с несколькими forge/package spaces, хранит secret refs вне repository/renderer/model и разрешает central capability disable.
- **UIK-07:** publish требует protected review/check policy, immutable digest, changelog/migration, SBOM, signature/provenance и readback verification.
- **UIK-08:** canary → next → stable продвигает тот же digest; production lockfile не меняется по channel автоматически.
- **UIK-09:** consumer view показывает pinned/available/compatibility и создаёт reviewable update PR с migration/tests.
- **UIK-10:** Design/Kit agent surface восстанавливает active session/operation и явно проходит proposal/preview/execute/result/verify/evidence.
- **UIK-11:** bound normal capabilities не создают per-call permission modals; centrally disabled capability остаётся видимой с причиной.
- **UIK-12:** reference source проходит type/catalog checks; stable promotion дополнительно требует unit/interaction/a11y/visual/metrics/consumer/supply-chain evidence.
- **UIK-13:** composer bottom row различает requested/actual model и reasoning, показывает context, AI-selected role и branch; при 1024 px Send/Stop не уходит за пределы области.
- **UIK-14:** role router объясняет факторы/confidence и pending safe-boundary handoff, не имеет manual selector, сохраняет Task/Todo/context/artifacts/evidence и не меняет capabilities.

## Рекомендуемое разбиение реализации

1. Repository binding, catalog store и token compiler/validator.
2. Gallery/inspector для tokens/components/icons/templates и honest maturity.
3. Original icon pipeline, provenance/license/hash gate и safe preview.
4. Component fixtures, state matrix, themes/viewports and quantitative audit.
5. PR/review/check integration и common agent operation lifecycle.
6. Package build, channels, SBOM/signing/provenance and immutable promotion.
7. Consumer inventory, compatibility fixtures, update PR and migration evidence.
8. Performance/accessibility/Windows hardening and organization adoption analytics.

## Выделение элементов · 13.10.2026

Выбранная вкладка получает ровную фоновую заливку и контрастный текст. Верхний и нижний края выглядят одинаково: без светлой полоски, inset-shadow, свечения и тени выбранной плашки. Это общее правило для OpenShift/K8s, Jenkins, трекера, Git/review, документации, IDE/Data, Browser Inspector и Design. Несохранённая ячейка сохраняет фоновую маркировку и отдельное состояние изменений без светлого нижнего края. Keyboard focus остаётся отдельной чёткой рамкой при навигации клавиатурой; тени плавающих окон не относятся к выделению вкладки.
