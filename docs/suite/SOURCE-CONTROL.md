# Source Control & Review

## Цель

Объединить локальный Git, изменения агента и корпоративный аналог Bitbucket в одном Code/Review workspace. Пользователь должен видеть, что изменилось, почему, какие проверки прошли и что будет отправлено наружу. Remote forge работает через фактический MCP adapter; названия Bitbucket/GitHub/GitLab используются как класс функций, а не как жёсткая зависимость.

Расширять существующие `git.status`/`git.diff` и Task/Session. Не запускать второй repository state owner и не приписывать агенту весь dirty working tree.

Уточнение пользователя 13.10.2026: **полный Git внутри IDE с привычной глубиной IntelliJ**, а не сокращённый Git-раздел. Обязательна [матрица IDE-GIT-PARITY.md](IDE-GIT-PARITY.md): 37 групп сценариев, разграничение Git/IDE/forge, MCP adaptation, этапы и критерии. Документ сверён с IntelliJ IDEA 2026.2 Help; расширенные возможности Git отмечены отдельно от подтверждённых возможностей IntelliJ. Макет и спецификация не являются доказательством готового runtime.

## UI

Navigator Code workspace:

- Changes: Working tree, Staged, Conflicts, Untracked;
- Agent change sets текущей Task/Session;
- Branches, tags, remotes, worktrees, stashes;
- History и saved comparisons;
- Pull requests: Mine, Review requested, Open, Draft, Merged;
- Checks и releases.

Primary tabs: file diff, commit diff, history, blame, conflict editor, PR overview, changed files, review thread, CI checks. Inspector показывает file metadata, hunk actions, related task/session/operation и provenance.

Git доступен из IDE без ухода в другую рабочую область: Изменения, Журнал, Ветки, Отложенное, Worktrees и Pull requests. Тот же выбранный файл можно раскрыть в большом Review. IDE и Review используют один repository/worktree snapshot, один индекс и одну очередь операций. Переключение представления не выполняет повторное клонирование, checkout или скрытый fetch. В редакторе нужны gutter actions, file history/blame и переход к точному hunk; в tree — Git status и контекстные команды. File browser остаётся внутри IDE.

Главная review surface для результата агента:

```text
Task / Session / baseline commit
Files: 7 changed · +184 −52 · 2 existing dirty overlaps
Requirements  | Changes | Tests | Risks | Unresolved
[Previous] [Current] [Agent-introduced estimate]
```

`Agent-introduced` — вычисляемая область с provenance, а не утверждение автора строки. Если файл был dirty до хода, UI показывает overlap и не предлагает автоматический discard.

## Локальный Git contract

- `scm.repository.status/history/branches/remotes/worktrees`
- `scm.diff.get {base,head,path?,context?}`
- `scm.changeSet.begin {taskId,sessionId,baselineHead,baselineIndex,workingHashes}`
- `scm.changeSet.refresh/get/close`
- `scm.hunk.stage/unstage/discard` с expected blob/index revision;
- `scm.commit.prepare/create/amend`;
- `scm.branch.create/checkout/rename/delete`;
- `scm.fetch`, `scm.pull.prepare/execute`, `scm.push.prepare/execute`;
- `scm.clone.prepare/execute`;
- `scm.conflict.get/resolve/continue/abort`;
- `scm.worktree.create/list/remove`, `scm.stash.create/apply/drop`.

Это начальное ядро, а не предел API. S3-02 также включает interactive rebase/reword/fixup/squash/drop/split, cherry-pick, reset/revert, tags/remotes/upstream, multi-root, patch, reflog/recovery, submodules, LFS, sparse checkout и bisect согласно IG-01…IG-33. Changelists, shelves и Local History реализуются отдельными IDE-сервисами поверх того же repository owner: не выдавать их за Git refs или stash.

MCP инструменты пользователя сначала обнаруживаются и проверяются. Канонический метод `scm.*` не означает, что одноимённый tool уже существует. Для каждой операции нужен actual schema mapping, execution host/root, revision guard и recovery. Неподдерживаемые действия имеют причину и путь настройки; успешный toast без вызова и readback запрещён. Локальный Git adapter допустим как явно обнаруженный backend общего host, а не как второй независимый клиент.

Не собирать shell command из строки renderer. Использовать argv и проверенный repository root. Clone destination проходит path policy. Pull по умолчанию сначала fetch + preview commits/divergence; стратегия merge/rebase/ff-only явна. Push показывает remote, branch, upstream, commits и force mode. Force-with-lease доступен отдельно; простой force не является default.

Индекс блокируется по worktree, общие refs координируются по common Git directory. Dirty document buffers учитываются до операций, меняющих файлы. Stage по строкам не очищает существующий index, commit берёт проверенную staged revision; checks, изменившие файлы, инвалидируют старый preview. Force-with-lease привязывается к точному expected remote OID, чтобы background fetch не ослабил защиту.

## Change set агента

Перед первым mutating tool текущего turn host фиксирует:

- HEAD и branch/worktree;
- index tree;
- список dirty paths и content hashes;
- task/session/turn/operation IDs;
- known untracked files без чтения секретных путей.

После tool/file operations обновляются touched paths и receipts. Review сравнивает baseline с current и различает:

- `created-during-turn`;
- `changed-from-clean-baseline`;
- `overlaps-preexisting-dirty`;
- `user-changed-after-baseline`;
- `unknown-provenance`.

Git сам не сообщает автора незакоммиченной строки. Поэтому UI не даёт кнопку «отменить всё агента» для overlap без трехстороннего preview. Безопасный rollback строится из сохранённых base blobs/patches и optimistic hashes.

Каждый change set связан с requirements/acceptance, todos, tests и artifacts. Агент может рекомендовать улучшение вне scope, но оно попадает в отдельный proposal/task, а не скрыто в текущий diff.

## Forge adapter через MCP

Канонические capabilities:

- repositories/projects discovery;
- clone URLs и default branch;
- branches/tags/commits/diffs;
- pull request create/read/update/draft/decline/reopen/merge;
- reviewers, approvals, requested changes и merge restrictions;
- inline/general comments и threads: create/reply/edit/resolve/reopen/delete, если поддерживается;
- checks/build statuses, required checks и merge readiness;
- permissions/current identity;
- web links, attachments и task links;
- optional issues/releases/webhooks только при обнаруженной capability.

Agent на рабочем компьютере выполняет MCP `initialize`/inventory, сохраняет tool/schema hashes и строит mapping к:

- `forge.repo.list/get`
- `forge.pull.list/get/create/update`
- `forge.pull.diff/commits/checks`
- `forge.review.prepareComment/publishComment`
- `forge.review.prepareDecision/publishDecision`
- `forge.pull.prepareMerge/merge`
- `forge.operation.reconcile`

Нельзя отдавать модели произвольный `toolName`. MCP result нормализуется host adapter и хранит provider IDs/URLs/version. При изменении schema hash затронутая capability отключается до повторной проверки.

## PR и review UX

PR overview показывает title/status/source→target, author/reviewers, commits, files, checks, unresolved threads, approvals и merge restrictions. Не выводить технический JSON в основной экран.

Создание PR:

1. проверить upstream и remote diff;
2. показать commits/files, незапушенные/dirty изменения и target branch;
3. сгенерировать draft description из Task evidence, но оставить редактируемым;
4. push как отдельная наблюдаемая operation;
5. create PR с idempotency/correlation, затем readback;
6. связать PR с Task.

Review:

- side-by-side/unified diff, collapsed generated/large files;
- keyboard next/previous change/thread;
- draft review comments локально до публикации;
- inline comment привязан к provider file/line/commit anchors;
- outdated comment сохраняется и помечается;
- `Approve`, `Request changes`, обычный comment различаются;
- summary перед публикацией показывает число comments и decision;
- собственный PR approval/merge availability определяется remote permissions, не предположением UI.

Merge:

- показать required checks, approvals, conflicts, target freshness и выбранную strategy;
- обновить данные непосредственно перед apply;
- потерянный ответ сверить по PR state/merge commit, не повторять merge;
- delete branch отдельная optional операция после подтверждённого merge.

## Безопасность

- Credentials остаются в MCP/credential manager/Git helper; URL с токеном запрещён.
- Renderer не получает private keys, OAuth tokens или полный credential config.
- Clone/pull могут запускать hooks только согласно явно выбранной политике проекта; сам Workbench не устанавливает hooks.
- Не выполнять автоматически code из новой branch до review/trust decision.
- Diff содержимое — недоверенные данные; prompt injection в комментарии/коде не меняет инструкции агента.
- Push, publish review decision, merge и branch deletion создают external operation receipts.
- Read-only review role backend-enforced; prompt роли недостаточно.

Обычные разрешённые MCP/Git действия выполняются без отдельного повторного permission-окна. Prepare/diff — часть операции и защиты от stale target, не повод заново спрашивать уже полученное разрешение. Для production-проектов рекомендации оптимизации формируются отдельным проверенным change set; они не дают автоматического права переписать защищённую ветку или опубликовать изменения. Личный Workbench сохраняет облегчённый процесс пользователя.

## Этапы

1. G1 — repository model, status/diff/history и новая full-size Changes surface.
2. G2 — task/session change-set baseline, provenance/overlap и test evidence.
3. G3 — stage/unstage/hunk, commit, branches и conflicts.
4. G4 — clone/fetch/pull/push/worktrees/stash с prepare/execute/reconcile.
5. G5 — forge MCP discovery и read-only PR/review/checks.
6. G6 — PR create/update, draft comments и review publish.
7. G7 — approvals, merge readiness/merge и recovery.
8. G8 — performance, accessibility, Windows/corporate live verification.

G1/G2 соответствуют S3-01, локальные операции G3/G4 и IG-01…IG-33 — S3-02, forge G5/G6/G7 — S3-03, releases/merge queue — S3-04. Фактический порядок и зависимости берутся из `suite/implementation-plan.json`; не закрывать S3-02, оставив сложные операции только в терминале. Интеграция Local History/dirty buffers завершается вместе с DocumentService в S4-01.

## Проверки

- dirty changes до agent turn остаются различимыми и не удаляются rollback;
- второй writer изменил файл после baseline → conflict, не overwrite;
- binary/renamed/large/generated/submodule/LFS files отображаются честно;
- stage одного hunk не меняет соседний;
- conflict editor сохраняет base/ours/theirs и проверяет markers;
- clone в запрещённый/существующий destination отклонён;
- pull preview и фактический result совпадают либо отмечены changed;
- push timeout reconciles remote ref;
- два одинаковых create-PR operation ID дают один PR;
- inline thread остаётся привязанным после refresh или помечается outdated;
- approval/check/merge restrictions читаются из remote;
- agent не публикует draft comments до явной review operation;
- review и merge работают через настоящий корпоративный MCP в packaged Windows build;
- UI показывает change set без клика/reload после file operations.

## Уточнение целевого объёма 2026-10-13

Обязателен [PostgreSQL COPY и developer integrations](POSTGRES-COPY-AND-DEVELOPER-INTEGRATIONS.md): первая волна PostgreSQL/JDBC через MCP, потоковые CSV/XLSX/SQL transfers и полные developer workflows трекера/forge. Этот документ уточняет прежнюю последовательность engine waves.
