# Git внутри IDE: полный целевой объём

Дата сверки: 13 октября 2026. Основа сравнения — официальная документация IntelliJ IDEA 2026.2 Help. Это **спецификация конечного продукта и макета**, а не заявление о готовом Git backend. До согласования полного макета новые runtime-функции не реализуются. Состояние карточек S3-01…S3-04 остаётся `planned`.

Требование пользователя — выполнять ежедневную и сложную работу с Git прямо в IDE, с полнотой привычного Git-интерфейса IntelliJ. Нельзя сократить его до кнопок commit/push или отправлять пользователя в терминал для каждого сложного действия. Терминал остаётся дополнительным входом; внешние изменения тоже отражаются в IDE.

## Что переносим из IntelliJ, а что проектируем дополнительно

Официальная документация подтверждает частичные коммиты, staging, операции с ветками, исследование истории, редактирование коммитов, разрешение конфликтов, shelves, patches и Local History. Это ориентиры сценариев, а не заимствование кода, графики или названий скрытых API. [Git tutorial](https://www.jetbrains.com/help/idea/working-with-git-tutorial.html), [commit/staging](https://www.jetbrains.com/help/idea/commit-and-push-changes.html), [history](https://www.jetbrains.com/help/idea/investigate-changes.html).

В IntelliJ 2026.2 документирован отдельный интерфейс worktrees; на странице указана поддержка проектов с одним репозиторием. Для нашего проекта multi-root и параллельные агенты требуют собственного явного контракта. Нельзя предполагать, что любые комбинации нескольких корней уже решены библиотекой редактора. [Worktrees в IntelliJ](https://www.jetbrains.com/help/idea/use-git-worktrees.html).

Bisect, reflog, sparse checkout и расширенное управление LFS ниже включены **как наш полный Git scope**. Здесь не утверждается, что у IntelliJ есть встроенный GUI для каждого такого действия. Платные, сторонние или не связанные с Git плагины не входят автоматически в обещание «как IntelliJ»; каждое обнаруженное полезное дополнение получает отдельный сценарий и источник.

## Один интерфейс, один репозиторий

В IDE доступны компактный Git-инструмент, ветка/worktree в строке состояния, контекстные действия файла и маркеры изменений в редакторе. Основные разделы: **Изменения**, **Журнал**, **Ветки**, **Отложенное**, **Worktrees**, **Pull requests**. Редкие операции находятся в контекстном меню выбранного объекта и в поиске команд. Не добавлять в постоянную панель ряд из двадцати команд.

Рабочая область Review — дополнительный большой вид тех же изменений и PR, а не второй Git-клиент с собственной копией состояния. Переход IDE → Review сохраняет repository/worktree, выбранный файл, comparison и task change set. Проводник файлов существует только в IDE; список changed files не является вторым project explorer.

`RepositoryStore` принадлежит host и имеет стабильные `repositoryId`, `commonGitDirId`, `worktreeId` и `snapshotRevision`. Windows пути канонизируются с учётом реального файлового пути и регистра. Окна IDE, Review, диффы, агент и MCP получают один versioned snapshot. Один writer на индекс конкретного worktree; операции с общими refs дополнительно координируются по `commonGitDirId`. Обновление после действий, файловых событий, focus/reconnect и внешнего Git происходит без клика и без перезагрузки страницы.

Несколько Git roots показываются отдельными группами. Режим «для всех корней» явно перечисляет цели и результаты: Git не предоставляет общую атомарную транзакцию на несколько репозиториев. Успех одного и ошибка другого — `partial`, а не общий success. Для параллельных агентов предпочтительны разные worktrees; два исполнителя в одном индексе получают очередь и fencing token, а не гонку за `index.lock`.

## Матрица возможностей и владельцев

Обозначения: **Git** — состояние и операции реального Git через проверенный adapter; **IDE** — собственные сервисы Workbench; **Forge** — корпоративный MCP, возможность подтверждается inventory. Все строки — обязательный целевой объём. Наличие экрана или fixture-сценария не закрывает runtime-строку.

| ID | Сценарий и видимый результат | Владелец | Карточка |
|---|---|---|---|
| IG-01 | Открыть/инициализировать/клонировать репозиторий; выбрать root, путь и worktree; обнаружить nested roots и submodules; каталог не перезаписывается | Git + IDE | S3-01, S3-02 |
| IG-02 | Working tree, index, untracked, ignored, conflicts; добавление, удаление, переименование, mode change, symlink; дерево/плоский список и поиск | Git | S3-01 |
| IG-03 | Unified/side-by-side diff, номера строк, подсветка синтаксиса, word diff, перенос строк, whitespace policy, переход между изменениями/файлами, сравнение HEAD/index/disk/buffer | Git + DocumentService | S3-01 |
| IG-04 | Stage/unstage файла, hunk и выбранных строк; раздельно staged и unstaged изменения одного файла; редактируемый index preview для сложного разделения | Git | S3-02 |
| IG-05 | Маркеры изменений в gutter: посмотреть base, перейти к diff, stage/unstage/rollback выделенного изменения; маркировка staged не совпадает с unstaged | Git + IDE | S3-02 |
| IG-06 | Именованные changelists: создать, переименовать, описание, active, переместить файлы/фрагменты, связать с задачей; переключение вида не теряет index | IDE | S3-02 |
| IG-07 | Commit, commit & push, amend; message history/template, author, sign-off, подпись; точный состав commit и результат hooks/checks | Git + IDE | S3-02 |
| IG-08 | Pre-commit проверки: tests, format, inspections, TODO, Sprut по capabilities; изменение файла проверкой инвалидирует подготовленный diff | IDE + Git hooks | S3-02 |
| IG-09 | Журнал с графом, поиск hash/message, фильтры root/branch/author/date/path, merge-коммиты и parents; пагинация и сохранённые виды | Git + IDE | S3-01 |
| IG-10 | История файла/диапазона, blame и переход к commit/предыдущей версии, история переименования; открытие repo snapshot на commit без checkout | Git + IDE | S3-01, S3-02 |
| IG-11 | Сравнить commits, branches, tag, working tree; явно выбрать направление и двух-/трёхточечную семантику; взять файл/часть из выбранной ревизии | Git | S3-02 |
| IG-12 | Ветки local/remote, поиск/favorites/recent, создать от commit/tag/branch, checkout, rename, upstream, delete, восстановить локальную ветку по сохранённому ref | Git + IDE | S3-02 |
| IG-13 | Checkout с dirty buffers/working tree: показать мешающие файлы, сохранить в stash/shelf и восстановить, обработать конфликт; не терять редакторский draft | Git + DocumentService | S3-02 |
| IG-14 | Fetch, pull/update с merge/rebase/ff-only, divergence и incoming/outgoing; явный prune; сетевой progress/cancel/recovery | Git | S3-02 |
| IG-15 | Push выбранных refs и tags, upstream/remote/target, push до выбранного commit; rejected/auth/offline; force-with-lease с конкретным expected remote OID | Git | S3-02 |
| IG-16 | Remotes: список, fetch URL/push URL, добавить/переименовать/изменить/удалить, выбрать default; credential reference и certificate errors | Git + ConnectionRegistry | S3-02 |
| IG-17 | Merge с ff/no-ff/squash выбором; rebase/onto; cherry-pick одного или нескольких commits; preview, continue/skip/abort по допустимому состоянию | Git | S3-02 |
| IG-18 | Interactive rebase: reorder, reword, edit, squash, fixup, drop; split/extract changes; preview новой истории и восстановление после перезапуска | Git + IDE | S3-02 |
| IG-19 | Конфликты: base/ours/theirs + result, принять сторону/оба/вручную, auto non-conflicting, next unresolved, save/reopen; rename/delete/binary/submodule конфликты | Git + DocumentService | S3-02 |
| IG-20 | Revert commit/range или выбранных изменений; undo последнего commit; reset soft/mixed/hard/keep; discard отдельно от unstage; preview влияния на refs/index/files | Git | S3-02 |
| IG-21 | Stash: list/diff/create с сообщением и выбором untracked/index, apply/pop/drop/branch, conflicts; исчезновение stash только после подтверждённого результата | Git | S3-02 |
| IG-22 | Shelf: сохранить выбранные изменения с base blobs, copy или убрать из working tree, preview, restore частично, reapply, rename/delete и восстановление по retention | IDE | S3-02 |
| IG-23 | Patch import/export/copy, выбор base/path mapping, dry-run, reverse и three-way при применимости; binary/path traversal/encoding диагностика | Git + IDE | S3-02 |
| IG-24 | Local History без commit: версия, label, diff, восстановление удалённого файла/фрагмента; retention/size/exclusions и recover draft после crash | DocumentService | S3-02 + S4-01 |
| IG-25 | Tags lightweight/annotated/signed: list/create/compare/checkout/push/delete; release — отдельная сущность forge | Git | S3-02 |
| IG-26 | Worktrees list/create/open/move/lock/unlock/remove/prune/repair; dirty/busy защита; общая история и раздельный index/HEAD/буферы, связь с агентом | Git + IDE | S3-02 |
| IG-27 | Submodules status, init/update/sync, рекурсивный preview, отдельный root, pinned commit и dirty state; изменения gitlink отдельно от файлов submodule | Git | S3-02 |
| IG-28 | LFS status, pointers vs загруженные objects, track/untrack patterns, fetch/pull/push и locks по серверной capability; progress и недоступный object | Git LFS adapter | S3-02 |
| IG-29 | Sparse checkout patterns/cone, preview затронутых путей, apply/reapply/disable; partial/shallow clone, shallow boundary, deepen/unshallow | Git | S3-02 |
| IG-30 | Bisect: good/bad/skip/reset, шаги и reproduction log, optional проверенная test command в изолированном worktree; неизвестный результат не good | Git + TestService | S3-02 |
| IG-31 | Reflog: локальные перемещения refs, поиск/сравнение, восстановить ветку от OID; fsck/maintenance как отдельные наблюдаемые диагностики, не скрытый cleanup | Git | S3-02 |
| IG-32 | `.gitignore`/`.git/info/exclude`/global ignore и `.gitattributes`: редактирование со scope, объяснение ignore rule, LF/CRLF/encoding/filter diff; clean только после preview конкретных untracked/ignored paths | Git + IDE | S3-02 |
| IG-33 | Git settings: executable/host/version, repo/global identity, signing/helper, hooks, diff/merge, update strategy, protected refs, auto-fetch, retention | Git + Settings | S3-02 |
| IG-34 | Task/session/turn change set: baseline, overlaps с чужими изменениями, tests/evidence, выбор agent changes и честная unknown provenance | IDE + Git | S3-01 |
| IG-35 | Forge spaces/repositories/PR: список, search/filter, checkout в worktree, create/draft/edit/close/reopen, reviewers, links и attachments по capabilities | Forge | S3-03 |
| IG-36 | Code review: inline/general comments, draft review, threads, outdated anchors, resolve/reopen, approve/request changes, checks и merge restrictions | Forge | S3-03 |
| IG-37 | Merge strategy/auto-merge/merge queue, releases/changelog/tags, remote readback, idempotency и unknown-outcome reconciliation | Forge + Git | S3-03, S3-04 |

Состав строк IG-04…08 опирается на описанные IntelliJ частичные commits, index и проверки; IG-12…13 — на работу с ветками; IG-17…20 — на историю и конфликты. Наши правила восстановления и общего владельца состояния добавлены для многооконной оболочки и агентов. [Commit](https://www.jetbrains.com/help/idea/commit-and-push-changes.html), [branches](https://www.jetbrains.com/help/idea/manage-branches.html), [merge/rebase](https://www.jetbrains.com/help/idea/apply-changes-from-one-branch-to-another.html), [edit history](https://www.jetbrains.com/help/idea/edit-project-history.html), [undo/reset](https://www.jetbrains.com/help/idea/undo-changes.html), [conflicts](https://www.jetbrains.com/help/idea/resolve-conflicts.html).

## Важные различия, которые нельзя скрыть за одной кнопкой

**Index** — реальное содержимое будущего Git commit. **Changelist** — метаданные группировки незакоммиченных изменений в IDE. Переместить изменение в changelist не означает stage. В режиме группировки commit сначала строит проверенный preview из выбранных фрагментов; нельзя очищать или перезаписывать чужой index. Режимы staging/changelists сохраняют своё состояние при переключении. [Changelists](https://www.jetbrains.com/help/idea/managing-changelists.html), [Git add](https://git-scm.com/docs/git-add).

**Stash** хранится Git и доступен внешним инструментам. **Shelf** — собственный набор patches/base blobs с метаданными IDE. **Local History** — локальные снимки редакторских/файловых изменений, включая ещё не закоммиченные. **Task checkpoint** хранит ход агентской работы и ссылки на evidence. Они имеют разные сроки хранения и не заменяют друг друга. Удаление задачи не удаляет stash или работу пользователя. [Shelve/stash](https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html), [Local History](https://www.jetbrains.com/help/idea/local-history.html), [patches](https://www.jetbrains.com/help/idea/using-patches.html).

**Unstage** не удаляет изменения из working tree. **Discard/restore** может заменить файл. **Reset** перемещает текущий ref и по режиму меняет index/working tree. **Revert** создаёт обратное изменение с сохранением истории. В диалоге reset должны быть три столбца: HEAD, index, files — с конкретным действием над каждым. При rebase названия ours/theirs объясняются через branch/commit IDs: «моё/их» без точных ревизий может ввести в заблуждение. [Undo changes](https://www.jetbrains.com/help/idea/undo-changes.html), [Git rebase](https://git-scm.com/docs/git-rebase).

**Sign-off** — строка в сообщении commit; **signature** — криптографическая подпись. Показать оба значения раздельно. Проверенный статус подписи берётся из Git, а не из наличия флажка. Repo config, global config и provider account также различаются. [Commit options](https://git-scm.com/docs/git-commit).

## Контракт адаптации через MCP

Пользователь уже имеет собственный Git MCP. Первое действие агента на рабочем компьютере — инвентаризация его actual tools, schemas и режимов исполнения: где физически расположен репозиторий, какие операции локальные, какие remote и какие только read-only. Канонические имена ниже — **наши целевые методы**, а не выдуманные существующие MCP tools.

Каждая capability хранит `supported`, `backend`, `serverId`, `tool/schemaHash`, `executionHostId`, `rootScope`, `canCancel`, `supportsExpectedRevision`, `reconcileStrategy` и причину ограничения. UI показывает неподдерживаемую операцию с конкретным способом настройки. Отсутствие `scm.rebase` в inventory нельзя заменить успешным toast. Если MCP не даёт нужную семантику, принимающий агент добавляет typed MCP adapter или уже существующий локальный host bridge; произвольный `execute_shell` из renderer не является реализацией capability.

Расширить существующий `GitService` следующими группами, не создавать параллельный store:

```text
scm.capabilities / repository.discover / repository.snapshot / repository.watch
scm.diff / stage.prepare / stage.apply / index.compare
scm.commit.prepare / commit.execute / commit.reconcile
scm.branch.* / remote.* / tag.* / fetch.* / pull.* / push.*
scm.history.query / history.file / history.selection / blame / revision.tree
scm.merge.* / rebase.prepare|execute|continue|skip|abort / cherryPick.*
scm.conflict.list|load|saveResult|markResolved / reset.* / revert.*
scm.stash.* / worktree.* / submodule.* / lfs.* / sparse.*
scm.patch.* / bisect.* / reflog.* / config.inspect|prepare|apply
ide.changelist.* / shelf.* / localHistory.*
forge.capabilities / repository.* / pull.* / review.* / checks.* / release.*
```

Для mutating request обязательны `operationId`, target IDs, expected HEAD/index/ref/blob revisions и lease/fencing token. `prepare` фиксирует конкретные refs и paths; `execute` повторно проверяет их. Операция над общим ref не привязана только к display branch name. Remote ref и refspec не строятся из непроверенной пользовательской строки. Path parameters отделяются от options; не доверять output, содержащему escape sequences, HTML или instructions.

Status и diff должны поддерживать NUL-safe paths, renames, staged/unstaged пары, binary/gitlink и очень большие файлы. Не парсить локализованный human-readable вывод по пробелам. Не загружать весь log/diff в renderer или prompt: cursor pagination, лимит bytes, отмена, explicit truncated state и адресная загрузка контекста.

## Dirty buffers, риски и восстановление

Перед checkout, reset, rebase, discard и применением patch host сверяет незаписанные DocumentService buffers, disk hashes и index. Пользователь видит конкретные файлы и варианты save/snapshot/cancel; диск не заменяется под открытым dirty buffer. После операции все windows получают одну revision, diagnostics и tabs сверяются с новой файловой системой. Событие переключения проекта не переключает ветку работающего агента.

Для личного Workbench обычные разрешённые Git/MCP операции не должны вызывать отдельное повторное permission-окно. Preview destructive/remote действия — часть предметного workflow, его можно объединить с самой командой. Действия, ранее явно разрешённые пользователем в выбранном scope, не согласуются заново. Защита от stale target/dirty overlap остаётся техническим инвариантом. Для производственного проекта auto-оптимизация не даёт права менять production branch: агент предлагает change set, запускает требуемые проверки и соблюдает установленную policy публикации/merge.

При timeout после commit/push/reset/merge сначала сверить HEAD/index/remote refs/PR state с receipt. Повторять операцию вслепую нельзя. После crash хранить stage sequencer: executing/conflicted/paused/unknown, base refs, remaining commits, draft resolution, backup refs. Показать «Продолжить», «Отменить», «Сверить результат» только если это допустимо реальным Git state. `Abort` не обещает откат внешнего push.

Force-with-lease использует конкретный expected OID, а не только обновляемый фоновым fetch tracking ref. Background fetch не должен ослабить проверку. Удаление worktree проверяет dirty/untracked, активных исполнителей и открытые buffers. Reflog — локальная ограниченная по retention история refs, а не гарантированная вечная резервная копия файлов. [Git push](https://git-scm.com/docs/git-push), [Git worktree](https://git-scm.com/docs/git-worktree), [Git reflog](https://git-scm.com/docs/git-reflog).

## Поставка без смены порядка карточек

1. **S3-01**: общий repository snapshot/store; IDE Changes/Log/Diff и Review отражают один статус; agent baseline/provenance. Проверить два окна и внешний writer.
2. **S3-02**: вертикальные подэтапы: index/commit → branches/sync → conflicts/history editing → stash/shelf/patch/recovery → worktrees/multi-root → submodule/LFS/sparse/bisect/config. Каждый подэтап получает живой сценарий, fixtures ошибок и readback. Local History использует уже введённый DocumentService; полная редакторская связка проверяется после S4-01.
3. **S3-03**: реальный корпоративный forge MCP, несколько spaces, PR/review/approve/merge; UI остаётся внутри IDE с большим видом Review.
4. **S3-04**: releases, changelog, merge queue по remote capabilities. Не закрывать недоступную capability снимком макета.

Карточки и зависимости в `suite/implementation-plan.json` остаются источником порядка. Этот документ расширяет acceptance S3-02 и связанные сценарии, но не объявляет более поздние зависимости уже готовыми. Если существующая реализация пользователя лучше нового варианта, сначала сравнить обе на одинаковом сценарии; сохранить текущую, предложить проверяемые варианты и получить выбор перед несовместимой заменой.

## Обязательная проверка полноты

Фиксировать по каждой строке IG: `prototype scenario`, `capability mapping`, `runtime test`, `Windows evidence`, `limitations`. У строки может быть отдельный статус `not supported by configured adapter`; это не `passed` и не снятие требования.

- Частичный stage/commit оставляет несвязанные изменения и ранее staged содержимое неизменными, включая overlapping hunks одного файла; external stage отражается без reload.
- Редакторский draft не теряется при checkout/reset/conflict; второго writer замечают по revision, а не по таймеру.
- Commit checks, которые изменили текст, возвращают к актуальному preview. Test result относится к фактически проверенной ревизии, не к будущему commit.
- Graph/history/blame корректны на merge, rename, deleted path, shallow boundary; directory snapshot read-only и не меняет рабочую ветку.
- Rebase с reorder/fixup/edit, merge, cherry-pick и stash conflict переживают restart; ours/theirs подписаны точными refs; marker-free result сам по себе не доказывает корректность кода.
- Reset four modes, revert, discard, unstage дают разные ожидаемые HEAD/index/files; отмена сохраняет внешние изменения либо выдаёт конфликт.
- Два worktree не делят index; удаление busy/dirty отклоняется с объяснением. Multi-root partial failure не маскируется под success.
- Submodule dirty/gitlink, LFS missing object/lock, sparse paths и shallow history показаны честно. Исполнение bisect test использует выбранный worktree и bounded process.
- Push rejected, remote advanced после preview, disconnected/auth/HTML error и unknown outcome имеют воспроизводимый recovery; ни один не приводит к неявному force.
- Windows paths с пробелами, кириллицей, длинными именами, CRLF/BOM, case-only rename; бинарные файлы, 100 000 commits и большой diff не блокируют UI.
- IDE и Review синхронны после agent edit, terminal Git, MCP mutation и второго окна. Закрыть панель не значит отменить Git operation.
- Forge anchors/version/reviewer permissions совпадают с сервером; approval и successful local merge не подменяют remote merge readiness.

Расширенные операции опираются на первичные спецификации Git: [submodule](https://git-scm.com/docs/git-submodule), [sparse checkout](https://git-scm.com/docs/git-sparse-checkout), [bisect](https://git-scm.com/docs/git-bisect) и [Git LFS](https://git-lfs.com/). Для корпоративного forge окончательные схемы и ограничения берутся из MCP на рабочем компьютере, а не из документации чужого сервера.
