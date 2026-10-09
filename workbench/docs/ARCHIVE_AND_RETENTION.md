# Архив проектов, задач и обсуждений

Дата: **2026-10-10**. Это контракт реализации пользовательского Electron UI; target-код/Windows здесь не запускались. Архив — доступная история с понятным восстановлением, а не исчезновение строки из sidebar. CLI не меняется, история CLI не удаляется и не редактируется через приватные файлы.

Контракт уточняет выбранную продуктовую policy [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md): **неактивную сущность архивировать сразу; активную — только после явно выбранной остановки и наблюдаемого завершения либо сверки исхода**. Archive сам не посылает скрытый cancel и не маскирует продолжающуюся работу. Общие [Task](TASK_WORKSPACE.md), [очередь](SMART_MESSAGE_QUEUE.md), [workers](MANAGED_SUBAGENTS.md), [обмен сессий](SESSION_COLLABORATION.md) и [журнал](JOURNAL.md) сохраняют своих владельцев. Новый workflow engine не нужен.

## 1. Что видит пользователь

**«Архив»** доступен из левой навигации и поиска команд. Внутри — отдельные представления **Архив** и **Корзина** с явными названиями; это не один список со случайным значком часов. Архив открывается без запуска модели, CLI или repo setup.

Верхняя строка содержит поиск, фильтр Project и тип **Все / Проекты / Задачи / Обсуждения**. По умолчанию сохраняется последний выбранный пользователем scope; на первом открытии — текущий Project, если он есть, иначе все доступные локальные проекты. Scope виден и сбрасывается одним действием. Фильтры: собственный архив или скрыто архивным родителем, дата архивирования, исход задачи, наличие непросмотренного результата; сортировки «недавно архивировано»/«последняя активность»/«название».

Строка показывает имя, тип, Project → Task breadcrumb, время архивирования и последний известный outcome. Отдельно видны missing root/material и recovery hold, если они обнаружились позднее. Архивирование не присваивает результату completed/pass. Раскрытие строки показывает историю; меню — **Открыть историю**, **Восстановить**, **Экспортировать**, отдельно **В корзину**. Bulk actions работают по выбранным stable IDs, а не по меняющемуся поисковому запросу.

Пустые состояния различаются: «Архив пуст», «Нет результатов с этими фильтрами», «Источник недоступен», «Не удалось загрузить». Сбросить фильтры можно без потери поисковой строки. Большие списки используют bounded pagination и stable cursor; библиотека/renderer выбираются из существующего stack. Поиск не сканирует весь репозиторий или node_modules.

**Обычная inactive архивация — одно действие**, затем краткое уведомление с Undo. Без модального подтверждения, объяснения причин или обязательной формы. Undo — команда Restore того же ID с новым receipt; она не отменяет реальные внешние действия и не запускает остановленные процессы. Пользователь не обязан отвечать на повторные permission-вопросы для этой обратимой операции.

## 2. Область архива и сохранённые связи

| Сущность | Что архивируется | Что сохраняется и что не меняется |
|---|---|---|
| **Project** | Его собственная lifecycle metadata скрывает контейнер из обычной навигации | Root/repo identity, Tasks, discussions, runs и история остаются. Собственные archived/trash flags детей не переписываются каскадом. Репозиторий, remote, credentials и browser profiles не удаляются |
| **Task** | Метаданные задачи и исключение её scope из нового dispatch | Goal/scope/requirements revisions, решения/вопросы/ответы, plan и история replan, chats, role assignments, outcomes, artifacts/версии, checks/evidence, pending/recovery refs и queue payloads |
| **Обсуждение / пользовательская «сессия»** | Логический discussion в конкретной Task | Stable discussion ID, captured authors/settings, draft, transcript, links и provenance прежних ACP bindings. Task и соседние discussions сохраняют самостоятельный lifecycle |
| **ACP execution binding** | Не отдельный вид archive сущности | Его runtime/session/generation/close outcome остаются историческими refs. Архив UI не является native CLI archive/delete/close и не обещает восстановить тот же живой процесс |

Выражение `own archived OR ancestor archived` — правило **видимости/admission**, не новый execution status. Task/run status, plan status, unread и lifecycle хранятся раздельно. Archive Project не превращает каждую Task в independently archived; после Restore Project дети возвращаются в прежнем составе, а отдельно архивированные/trashed остаются такими.

Связанные журналы и материалы не копируются целиком при каждом archive. Сохраняются immutable refs, версии/hashes и ownership; object store и действующая retention policy обеспечивают доступность принадлежащих приложению bytes. Ссылка на live файл не становится snapshot от архивации: явно показывать «live path / snapshot / missing». Если для сохранения результата нужен snapshot, создать его существующим ArtifactService до commit, с receipt, а не обещать, что удалённый внешний файл всегда доступен.

## 3. Просмотр архива без изменения работы

История открывается в существующем Task workspace с заметной меткой **«Архив · только просмотр»**. Доступны сообщения/GFM, tool groups, plan/replan, критерии и их реальные outcomes, решения, вопросы/сохранённые ответы, versions/diffs материалов, worker results и ссылки на logs/evidence. Lazy details читают только нужный фрагмент и указанную версию. Draft виден как сохранённый draft, а не отправленное сообщение.

Composer и действия, запускающие работу или меняющие смысл задачи, недоступны с ясным действием **Восстановить для продолжения**. Просмотр/copy/search/export/layout/scroll не запускает agent turn, tool, dev server, PTY или auto peer reply. Открытие immutable материала не меняет его. Исполняемый preview макета не стартует автоматически при просмотре архива: сначала безопасное read-only представление/сохранённый screenshot; отдельный просмотр sandbox preview использует действующую preview policy без производственных прав.

Разрешены организационные команды Restore/Trash/Export через lifecycle service, с обновлением проекции. Сохранение seen cursor и presentation preferences не переписывает исторический контент. Любая UI-ссылка остаётся связанной с исходным entity/version, даже если сейчас выбрана другая Task. Удалённая/недоступная ссылка показывает честный missing/unavailable, не пустой «проверенный» материал.

## 4. Активная работа, очередь, workers и peer messages

| Состояние при запросе Archive | Нужное поведение |
|---|---|
| Нет active execution и нет неизвестных эффектов | Проверить scope/revisions, поставить admission barrier и архивировать одной короткой командой |
| Только unsent queued items/draft | Атомарно сохранить payloads/captured settings, поставить существующий queue hold `archived scope`, архивировать. Пользователю видно количество удержанных сообщений. Нечего cancel: запрос ещё не выполнялся; очередь не удаляется |
| Starting/running/waiting_retry/waiting_permission | Обычная Archive не выполняется скрыто. Показать конкретную активность и действия **Остановить и архивировать** / **Вернуться к работе**. Первое — явное поручение stop+archive, а не постоянный permission-dialog для inactive объектов |
| Cancel_requested | Показать «Останавливаем перед архивированием»; сохранять intent, принимать updates. Cancel notification не равен terminal |
| Interrupted_unknown/reconciling или pending effect без установленного исхода | Оставить сущность доступной для recovery. Предложить **Проверить исход**; не прятать её в архиве по timeout и не повторять неизвестную запись |
| Обязательный managed child/координатор ещё активен | Рассчитать принадлежащие scope executions, явно остановить их по выбранной stop+archive команде и дождаться их исходов. Root terminal не означает, что child завершён. Соседние Tasks и чужие workspaces не останавливаются |
| Queued worker ещё не запущен | Сохранить assignment и его dispatch intent под hold. Не создавать процесс ради получения terminal. Restore сам не запускает worker |
| Peer message к archive/archiving получателю | Retain допустимого message и held inbox/delivery receipt либо адресный reject согласно link policy; **не auto-wakeup**. Sender видит причину без раскрытия закрытых payloads. Restore не пересылает сообщение автоматически |

На выбранной границе архивирования запрещается **новый** dispatch по всей подчинённой области. При peer отправке проверяются и sender, и recipient scopes; архивированный sender не начинает новые auto-replies. Уже dispatched входящее/исходящее сообщение не стирается, его outcome/received results принимаются адресно как история. Межпроектный peer не принадлежит source Task: его нельзя принудительно остановить только ради архива отправителя. Отправленный запрос, чей обязательный результат ещё неизвестен, остаётся явной dependency/recovery причиной, а не автоматически closed.

Запрос **Остановить и архивировать** использует существующие Session/Worker owners и M2 cancel/recovery. Не kill общего CLI process из-за одной multiplex session; не убивать чужой терминал/внешний Jenkins job. Если нужный stop не поддержан либо outcome неизвестен, показать точный blocker. Остановка не откатывает уже сделанные изменения. Pending permission callback завершается только через его фактический контракт; архив не нажимает Approve за пользователя.

Resource view не равен execution: скрытие browser/terminal панелей само не требует kill. Активная **принадлежащая scope операция**, необходимая для завершения задачи, должна иметь установленный исход; сохранённые descriptors/idle PTY и read-only views не выдаются за running agent. Resource owner сообщает actual inventory и применяет отдельную явную close/stop policy; архив не эвристически убивает всё по cwd.

## 5. Одна durable команда и защита от гонок

В существующем writer команда Archive захватывает `operationId`, entity type/ID, parent/project identity, expected lifecycle revision, scope snapshot и выбранный режим inactive либо stop-then-archive. Это **предлагаемые host поля**, не ACP schema. Task/requirement/run revision, attempt_id и journal sequence не подменяются lifecycle revision.

1. Проверить доступ/identity/expected revision и вернуть прежний receipt для повторного operationId. Вычислить принадлежащие descendants, shared refs и активные admissions; не обходить весь filesystem.
2. В короткой транзакции сохранить intent и admission hold с generation/fencing. Claim нового prompt/worker/peer delivery проверяет этот же барьер. Если claim уже случился, это active execution, а не потерянный queued item. Новый child после snapshot не обходит scope barrier.
3. Для inactive scope — той же логической транзакцией записать archive metadata/event, preserved queue holds и обновить lifecycle revision. Для active — сохранить `stop pending` как статус **операции архивирования**, выполнить адресные stop вне database lock, ждать/сверять outcomes. Не удерживать transaction во время сети/CLI.
4. Перед окончательным commit повторно проверить barrier/generation, descendant outcomes и registry effects. По умолчанию commit archive только когда нет active managed execution и неизвестного обязательного effect. Stale result/новый child не переписывает старый scope snapshot молча.
5. Commit archive event + hierarchy visibility/projection revision, с архивным временем/actor/reason при наличии; derived search index обновляется из события. Если index отстал, чтение проверяет canonical metadata и показывает актуальный статус.
6. Подписчики применяют event по sequence. Crash между stop и archive восстанавливает intent/receipts, не шлёт stop/prompt вслепую. Отмена intent снимает только его собственный hold после CAS/reconcile; ранее остановленная работа сама не возобновляется.

Для Project обычно один container flag и ancestor admission check достаточны — не менять тысячи child flags ради фильтра. При bulk archive unrelated объектов отдавать per-item receipts: completed/held/conflict с причиной. Частичный успех не называется «всё архивировано». Existing single writer/lock/CAS остаются владельцем; renderer не пишет store напрямую, второй archive database не появляется.

Неустранимый поздний terminal/update после commit сверяется по execution/generation и сохраняется в прежний журнал. Он не создаёт новый turn и не снимает archive. Если обнаружена действительная незавершённая работа, поднять видимый recovery incident/activity вне обычного фильтра и запретить дальнейший dispatch; не скрывать ошибку под архивным badge.

## 6. Восстановление: те же IDs, честное продолжение

Restore — короткая CAS-команда по сохранённому entity ID и lifecycle revision. Она не создаёт дубликат, не меняет название для обхода collision и не «перезапускает» completed/cancelled run. Восстанавливаются связи/metadata и обычная видимость; сохранившиеся budgets, decisions, approvals scope, failed/stale evidence и retained queue остаются с прежним смыслом. Сохранённое историческое permission не превращается в новое безусловное разрешение.

| Случай | Действие UI и результат |
|---|---|
| Parent активен | Restore того же объекта, уведомление/Undo; без повторной формы |
| Task/session скрыта только архивным parent | Показать причину и **Восстановить Project/Task**. Не создавать бессмысленный новый child archived flag |
| У child свой archive flag и parent тоже archived | **Восстановить вместе с родителями** с коротким указанием затрагиваемых ancestors либо сохранить parent archived и только снять собственный flag. Во втором случае явно: «Останется скрыто архивом Project»; не обещать появление в активном списке |
| Parent в корзине | Сначала восстановить его по lifecycle contract; допустимый reattach — отдельное выбранное действие с scope/ref проверками. Не переселять в случайный текущий Project |
| Parent отсутствует/purged | Показать retained history и broken relationship; предложить только проверяемый reattach/import path, сохраняя исходные IDs/provenance. Не выдумывать исходного parent |
| Совпало display name | Сохранить оба stable IDs, уточнить breadcrumb; rename опционален, не причина создавать новый ID |

**Restore не Resume.** После восстановления удержанная очередь показывает **Продолжить с сохранённой очередью**; перед dispatch сверить actual scope, requirements, model/role capture, refs и неизвестные effects. Не повторять уже dispatched messages. Stale items остаются held с объяснением; исходный текст доступен для правки/нового correction. Peer autowakeup не включается от одного просмотра или restore.

Если repo/root недоступен, read-only история и принадлежащие приложению snapshots остаются доступны. Запуск/запись блокируются; **Указать расположение** проверяет canonical path/repo identity и permissions. Никаких auto-clone/setup, подстановки папки по похожему имени или молчаливого переноса pending writes.

Для CLI продолжения проверить actual bundled runtime/version, workspace и доступный load/resume. Host transcript не гарантирует наличие прежней CLI history. При поддержанном restore сохранить старые receipts и новый binding/generation; при отсутствии — **новое обсуждение с кратким контекстом** в той же Task по проверенному handoff. Это новый turn с новым execution identity, не повтор исходного запроса и не восстановление прежнего живого процесса.

## 7. Retention, корзина, export и backup — разные действия

- **Archive** по умолчанию бессрочный и обратимый. Возраст архива не является разрешением удалить его. Никакого auto-purge/auto-archive по таймеру без явно выбранной policy.
- **Trash** — отдельное обратимое исключение из обычных списков и dispatch; сохраняет данные для Restore. Переместить архивный объект в корзину не означает удалить repo, CLI history или shared bytes. При Restore из trash сохранить прежнее archived состояние, если пользователь явно не выбрал также вернуть в активный список.
- **Retention** задаётся отдельно для принадлежащих приложению данных: raw diagnostic payloads/cache/attachments/history и т. п. Показывать область, срок, exclusions, приблизительный объём по фактическому inventory и последствия. Не превращать один срок логов в срок удаления Task/artifacts/evidence. Неизмеренный размер — unknown.
- **Purge** — отдельный проверяемый plan из корзины или принятой retention policy: owned/shared refs, действующие dependency/pending/backup refs, выбранный snapshot targets, dry-run и затем receipt каждого результата. Без нужных данных об ownership удаление блокируется. Pending/accepted evidence и integrity-зависимые journal blobs не удаляются как «cache»; сохранить требуемую проверяемость либо заранее показать, какая возможность перестанет быть доступной, и не оставлять ложный green pass.
- **Export** создаёт локальную читабельную копию выбранной версии/среза с manifest и exclusions. Он не меняет archive, не является backup и не обещает native CLI resume. Scope/cursor фиксируются, чтобы изменение в другом окне не смешало версии. Внешняя публикация отдельно от export.
- **Backup** сохраняет проверяемый набор store/blob/schema/runtime metadata для восстановления приложения. Он не равен экспорту Markdown и не является runtime snapshot живых процессов. Restore backup сначала на копии/candidate; secrets и CLI auth следуют своим policies. Удаление текущей копии не объявлять удалением уже экспортированных файлов/backup.

Shared artifact blob удаляется только после проверки всех ссылок, в том числе archived Tasks. Нельзя удалить файл, который нужен для integrity-проверки сохраняемого sealed journal, и затем незаметно пересчитать его hash или объявить проверку ненужной. Purge использует явно поддержанный формат хранения/удаления всей выбранной области; если такой контракт ещё не реализован, history/evidence purge недоступен, basic archive продолжает работать. Missing или намеренно удалённый payload получает явный tombstone/ограничение; ссылка не переиспользуется для другого объекта. Изменение retention не переписывает old operation outcomes и не выдаёт архивированную задачу за completed.

## 8. Малые карточки и поэтапная поставка

| Карточка | Этап и маленький результат | Минимальная проверка |
|---|---|---|
| **AR1 — архив как рабочий экран** | **M3.9/M3.13 / D3**: Project scope/type/search/sort, read-only history, separate Archive/Trash, empty/error states; existing index и views | Открыть архивную Task из другого выбранного проекта без смешения; найти имя/источник; открыть plan/artifact/log ref без model call. Wrong scope и missing material видны |
| **AR2 — inactive archive/restore** | **M3.9/M3.13 / D3**: CAS metadata/event, Undo, exact IDs и parent cases; не ждёт retention M10 | Inactive archive одним действием без modal; restore/restart сохраняют IDs/history/drafts; Project restore не снимает own child archives; trash не purge |
| **AR3 — активность перед архивом** | **M3.9/M3.13 / D3**, prerequisite наблюдаемых **M2 cancel/recovery**: visible active guard, явный stop-then-archive, retained queue и safe commit | Cancel_requested/unknown не даёт архивный успех; queued-only payload остаётся held; terminal→commit с реальным receipt. До поддержки сложного scope честный blocker, не ложное «готово» |
| **AR4 — hierarchy/worker/peer races** | **M4.2/M4.7/M4.8 / D4–D5**, будущие M5 workers используют тот же барьер: durable intent, descendants/claim fencing, restart/bulk и scoped delivery | Race archive↔enqueue/dispatch/child start/peer receive, stale CAS и crash между stop/commit; соседний scope работает, required pending child не спрятан. M5 не создаёт отдельный archive controller |
| **AR5 — retention и перенос** | **M10 / D11**: opt-in policy/dry-run, dependency-safe purge, bounded full-history index/export и проверяемый backup/restore | Shared blob retained, выбранная policy не затрагивает чужой scope, partial purge честен; export consistency и restore backup на отдельной копии. Basic archive UI AR1–AR3 не откладывается до этого этапа |

Для проверки использовать маленький fixture набор Project A/B, archived parent, independently archived child, trashed sibling, missing root, один running turn, unsent queue, неизвестный effect и peer message. Fixtures помечать явно; они проверяют переходы своего host кода, а не live Giga. Положительный путь нужен вместе с отрицательным: валидный inactive restore действительно работает, обычная работа не блокируется лишними approvals.

## 9. Приёмка и отчёт

Готовность ближайшего среза: пользователь находит архив, читает прежний результат и материалы, восстанавливает тот же объект и видит, можно ли продолжить. Фильтры/поиск/навигация не теряют keyboard focus; длинные русские имена и узкое окно пригодны. Быстрый просмотр не читает весь журнал и не вызывает модель. Задержки/объёмы измеряются на target; численные «гарантии скорости» здесь не заявлены.

Known-bad проверки: active архивируется без terminal; queue исчезает; restore создаёт новый ID; parent restore поднимает own-archived детей; peer отправляется archived получателю; missing repo перенаправляет запись; старый outcome становится green после restore; purge уничтожает shared evidence. Каждый такой случай должен давать наблюдаемый отказ/hold, не успех.

Отчёт содержит source/build/OS/CLI versions, проверенный AR-срез, inputs/IDs/revisions, реальный event/receipt и ограничения. Работа mock/archive overlay отдельно от target runtime. Сохранять результат через существующие Task/evidence и [delivery checkpoints](DELIVERY_AND_DOGFOOD_PLAN.md); этот документ и UI badge не заменяют проверку.
