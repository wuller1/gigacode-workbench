# Бесшовный процесс разработчика

## Три уровня контекста

1. **Project** отвечает «над каким продуктом я работаю»: локальные roots, repositories, tracker project, forge workspaces, CI, knowledge, environments, databases и browser profiles.
2. **Task** отвечает «какой результат я делаю»: требования, роли/сессии, branch/change set, evidence, checks, deployments, queries и artifacts.
3. **Workspace** отвечает «какой инструмент нужен сейчас»: Chat, Code, Browser, Design, Tasks, Operations, Data или Review.

Смена workspace не создаёт новую задачу и не обнуляет роль/контекст. Смена Task сохраняет открытые resources, но активирует связанные с новой Task. Смена Project полностью изолирует lists/tabs/targets и восстанавливает его последнее состояние.

## Project context

```ts
type ProjectContext = {
  projectId: string;
  roots: { id: string; path: string; role: "primary" | "frontend" | "backend" | "infra" }[];
  repositories: { localRootId: string; forgeConnectionId?: string; remoteRepositoryId?: string }[];
  tracker?: { mode: "local" | "remote"; connectionId?: string; remoteProjectId?: string };
  knowledge: { connectionId: string; spaceId: string; rootPageId?: string }[];
  ci: { connectionId: string; folder?: string; jobPatterns?: string[] }[];
  dependencySecurity: { connectionId: string; remoteProjectId?: string; baselineId?: string }[];
  environments: EnvironmentContext[];
  databaseIds: string[];
  browserProfileIds: string[];
  defaults: { workspace?: string; environmentId?: string; databaseId?: string };
};

type EnvironmentContext = {
  id: string;
  name: string;
  kind: "local" | "dev" | "test" | "stage" | "prod";
  clusterConnectionId?: string;
  namespace?: string;
  jenkinsConnectionId?: string;
  dependencySecurityConnectionId?: string;
  databaseIds: string[];
  browserProfileId?: string;
};
```

Environment context — удобный набор связанных targets, но не скрытая массовая смена. Каждая operation всё равно захватывает конкретные IDs/revisions. Production всегда помечен текстом и цветом.

## Два разных значения «пространства»

Чтобы интерфейс не путал пользователя:

- **Workspace** — режим инструмента внутри приложения: Code, Browser, Design, Tasks, Operations, Data или Review;
- **Remote space** — область внешней системы: forge workspace, knowledge space, Jenkins folder, cluster/namespace или database/schema.

Workspace выбирается постоянной activity rail. Remote space выбирается в navigator/target bar текущего workspace и всегда ограничивается Project bindings. Их нельзя помещать в один общий dropdown: это смешивает «что я делаю» с «где именно» и повышает риск неверного target.

### Как выбирается target

Resolver использует только подтверждённые bindings и следующий порядок:

1. target, явно закреплённый в Task;
2. target выбранного Environment внутри Project;
3. project default для данного workspace;
4. последний подтверждённый target этого `window + project + workspace`;
5. один доступный verified binding;
6. quick picker, если вариантов несколько или binding stale.

Production, destructive capability и изменившийся schema hash никогда не выбираются молча по recent. Выбор target меняет только текущий workspace/Task scope; он не запускает операцию. Toolbar показывает короткий alias, а tooltip/review — полный connection path.

### Быстрый picker remote spaces

`Ctrl/Cmd+Shift+T` открывает общий target picker с секциями текущего workspace. Строка содержит environment, connection alias, remote path, health/stale и permission. Recent и pinned идут первыми; поиск работает по alias/path, но одинаковые названия всегда сопровождаются connection badge. Действия рядом: pin, проверить подключение, открыть настройки и привязать к Task.

Из Settings пользователь создаёт reusable connection один раз. В Project settings он выбирает только нужные remote spaces и defaults. Task может закрепить более узкий target без создания дубликата credentials. Так несколько Kubernetes/OpenShift/Jenkins/forge/knowledge/database instances остаются бесшовными в работе и явно разделёнными при действиях.

## Переключение

### Project switcher

Project switcher находится в левом верхнем углу и открывается `Ctrl/Cmd+Shift+O`. Он показывает recent/pinned projects, активные tasks/operations и путь. Поиск fuzzy, поддерживает клавиатуру. Выбор:

- сохраняет current project view state;
- активирует last workspace/Task выбранного проекта;
- восстанавливает tabs/layout/selections;
- не переносит browser/database/terminal resources между проектами;
- не закрывает фоновые operations, а показывает их status badge.

Отдельная кнопка открывает проект в новом окне. Это предпочтительный путь для одновременной активной работы в двух проектах.

### Workspace rail

Rail всегда на одном месте. Hover показывает shortcut и status badge, right click — open split/new window. `Ctrl/Cmd+1…6` мгновенно переключает workspace. Центральные document tabs общие: diff, task, browser capture, YAML и SQL result можно открыть рядом с кодом, даже если navigator сменился.

### Task switcher

В title bar рядом с Project. Показывает recent/current/suggested tasks и состояние сессий. Новая роль создаёт session внутри Task. «Перейти к результату» открывает workspace/object и записывает return location. Back возвращает к исходному разговору/файлу.

## Project home

При открытии проекта показывать спокойную страницу продолжения, а не дашборд из десятков виджетов:

- текущая/последняя Task и незавершённый шаг;
- dirty/branch/change-set summary;
- работающие agent sessions;
- failing checks/operations, требующие действия;
- до пяти recent resources;
- primary action `Продолжить`.

Статусы Jenkins/cluster/database загружаются по потребности и не блокируют первый экран. Пользователь может pin максимум несколько карточек.

## Эффективный feature flow

1. Создать/открыть Task, требования и acceptance.
2. Analyst/spec session уточняет пробелы; решения остаются в Task/knowledge draft.
3. Developer session создаёт branch/worktree/change set и открывает IDE.
4. Run/test results появляются в Task и Problems без ручного копирования.
5. Если меняется UI, Design создаёт/обновляет brief, states и интерактивный prototype; решение получает version и review.
6. Browser recipe проверяет prototype или живой UI; screenshot/console/network evidence связывается с design version и change set.
7. Agent предлагает открыть Review; пользователь видит diff, overlaps и tests.
8. Push/create PR через Source Control; review/checks обновляются адресно.
9. Jenkins run связывается с commit/PR; при сбое переход ведёт в нужный log/test.
10. Operations открывает deployment/rollout/pod logs в environment Task.
11. Data workspace использует datasource того же environment; query/result закрепляется как evidence.
12. Acceptance gate сравнивает реализацию с approved design/requirements и закрывает Task только после заданных checks/readback.

Все шаги доступны отдельно. Workbench не заставляет проходить полный процесс для маленькой правки.

## Интеллектуальные рекомендации

Agent/router может предложить ненавязчивый action chip:

- «Требования неполны — открыть Аналитика»;
- «Есть изменения — открыть Review»;
- «Сборка упала — открыть Jenkins log»;
- «Rollout не завершён — открыть Operations»;
- «Нужна проверка UI — открыть Browser recipe».

Рекомендация содержит причину и ожидаемый результат. Она не меняет workspace автоматически во время ввода/selection и не создаёт новую session без поручения. Пользователь может отключить тип рекомендации.

## Несколько привязок одного типа

Project context хранит массивы connections. В navigator типовые groups:

```text
Operations
  DEV · Cluster East / team-a
  STAGE · Cluster Central / app-stage
  PROD · Cluster Central / app-prod
CI
  Jenkins Main / folder/app
  Jenkins Legacy / folder/migration
Source control
  Corp Forge / workspace-a / backend
  Corp Forge / workspace-a / frontend
Knowledge
  Product / APP
  Architecture / ADR
Data
  DEV PostgreSQL
  STAGE PostgreSQL (read-only)
```

Recent/pinned targets выше полного дерева. У каждого resource path всегда есть connection badge; одинаковые названия не смешиваются.

## Сохранение состояния

View state key: `window + project + workspace + panelInstance`. Resource state живёт отдельно и имеет owner/lease. Сохранять:

- last workspace/Task;
- active/ordered document tabs;
- active browser tab per window/project и browser group;
- navigator expansion/filter;
- editor selection/scroll/splits;
- bottom/inspector visibility and size;
- selected environment/data source.

Не сохранять как «живое»: transaction, process, PTY ownership, debug session или browser automation ref. После restart они показывают stopped/lost/unknown и восстанавливаются только подтверждённым способом.

## Cross-links

Любой значимый объект имеет `ResourceRef {kind,id,connectionId?,revision?,projectId,taskId?}`. Links используются в chat cards, Task activity, breadcrumbs, notifications и history. Открытие проверяет scope и актуальность; stale ref предлагает refresh, а не молча открывает другой объект.

## Метрики процесса

- время Project open → useful surface;
- Task → changed file/failed check/target log не более двух переходов;
- число ручных копирований URL/ID между workspaces;
- доля потерянных selections/active tabs после switch;
- restore correctness после restart;
- ошибочные operations по неверному environment/connection;
- время от agent result до понятного diff/evidence;
- keyboard completion rate для основных сценариев.

Оптимизация считается полезной, если сокращает шаги без скрытия target, риска или результата.
