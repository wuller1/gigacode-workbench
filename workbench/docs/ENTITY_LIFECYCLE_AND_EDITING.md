# Редактирование, переименование, архив и удаление

Статус на **2026-10-09**: подробный контракт реализации существующего личного Electron UI, не готовая функция и не результат запуска на пользовательском Windows. CLI остаётся неизменённым. Поддержка его catalog/rename/delete проверяется на конкретном runtime **GigaCode 26.9.75**, а не предполагается по новому Qwen.

Пользователь должен управлять проектами, задачами, обсуждениями, вкладками, материалами и настройками прямо там, где с ними работает. Переименование меняет название; редактирование цели меняет версию требований; удаление активной работы требует корректного завершения её lifecycle. Эти действия не должны скрыто сбрасывать историю, запускать новые процессы или обращаться к соседней выбранной задаче.

Основа: [TASK_WORKSPACE](TASK_WORKSPACE.md), [PANELS_AND_IDE](PANELS_AND_IDE.md), [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md), [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md), [SHARED_MEMORY](SHARED_MEMORY.md) и [NATIVE_WORKBENCH_MIGRATION](NATIVE_WORKBENCH_MIGRATION.md). Использовать их services и единственный backend writer. Документ не добавляет второй WorkflowEngine.

## 1. Действия с разным смыслом

| Действие в UI | Что меняется | Что сохраняется |
|---|---|---|
| Переименовать | Пользовательский display label с metadata revision | Stable ID, project/task ownership, sessionId, пути, runtime, цель и результаты |
| Редактировать | Новая версия именно редактируемых данных | Прежняя версия и происхождение; зависимые результаты перепроверяются при смысловом изменении |
| Закрыть представление | Видимость view/layout | Task, discussion, resource binding, drafts и работающий процесс |
| Остановить | Адресная отмена/завершение конкретного runtime | История, артефакты и неизвестные effects; остановка не откат |
| В архив | Организация списка без уничтожения | IDs, данные, статусы и bindings; активность не отменяется сама |
| В корзину | Обратимая lifecycle metadata и исключение из обычных списков/нового dispatch | Снимок объекта, ownership, история, связи и необходимые recovery данные |
| Восстановить | Вернуть прежний объект из архива/корзины | Тот же ID и история; остановленные процессы не возрождаются автоматически |
| Удалить навсегда | Явно выбранные принадлежащие приложению данные после проверки зависимостей | Только объявленные минимальные tombstone/recovery записи; внешние копии не считаются удалёнными |

Archive/trash/purge — отдельная lifecycle metadata, **не значения workflow status**. Готовая задача после restore остаётся completed; cancelled run не становится ready. В черновике нового объекта можно отменить создание, пока нет committed ID/ссылок; это не purge существующей истории.

Для reversible rename/edit/archive/trash не нужны постоянные модальные подтверждения. Использовать Undo и понятное состояние. Для удаления навсегда, реального удаления файлов или завершения ресурса с несохранёнными/неопределёнными результатами показать конкретный состав и последствия перед действием. Уже выданная авторизация действует в своей области; не спрашивать разрешение на каждую техническую операцию.

## 2. Матрица сущностей: что пользователь может менять

В таблице «удалить» по умолчанию означает **в корзину приложения**, если не указано иначе. Для объектов, у которых нет пользовательского смысла отдельного архива, не добавлять кнопку ради симметрии.

| Сущность | Создать / открыть / дублировать | Переименовать / редактировать | Архив / удалить / восстановить |
|---|---|---|---|
| **Project** | Добавить существующий root либо отдельным поручением создать новый; открыть настройки/задачи | Label, description, defaults; root/репозиторий, permissions и browser profile — отдельное проверяемое изменение identity/scope | Архив скрывает project в обычном sidebar; корзина затрагивает выбранный каталог приложения. Репозиторий на диске, remote и глобальные credentials не удаляются |
| **Task** | Новое поручение внутри Project; копия цели/критериев как новая Task с новым ID и ссылкой на оригинал | Title отдельно; goal/scope/requirements/acceptance через versioned edit. Project move — отдельный scoped переход | Архив/корзина/restore с сохранением runs/chats/artifacts; активная работа сначала проходит §6. Дублирование не копирует running workers или полномочия |
| **Discussion / пользовательская «сессия», чат** | Добавить обсуждение существующей Task; открыть историю; ответвить обсуждение от выбранной точки с явной связью | Title, drafts, unsent queued input. Отправленные сообщения — correction/branch, не перезапись истории | Архив/корзина/restore сохраняет связь с Task. Скрытие обсуждения не уничтожает ACP history. Новый branch не повторяет прежние tools |
| **Execution / ACP session binding** | Создать/подключить только через SessionService и проверенный adapter; показать runtime details | Только UI label и поддержанные config changes на безопасной границе; sessionId/generation не редактируются вручную | Disconnect/close/cancel отделены от удаления catalog history. Host tombstone возможен; native deletion только при проверенном API/семантике, отдельно от корзины |
| **Role assignment / managed worker** | Назначить внутри Task; открыть детали/результат; новое независимое назначение только в budget/scope | Label; цель/inputs/role/model редактируются как новая assignment revision, active capture не меняется | Queued cancel без dispatch; active cancel до результата; завершённое назначение можно архивировать/убрать в корзину. Restore не запускает worker снова |
| **Terminal tab** | «+» с обнаруженным shell profile; открыть уже существующий terminal ID | Label; параметры новой PTY отдельно. Изменение descriptor не подменяет shell/cwd/env работающего процесса | Закрыть view, остановить PTY и убрать descriptor — разные действия. Restore descriptor/scrollback не воспроизводит shell input |
| **Browser tab** | «+» в выбранном project browser profile; открыть/закрепить | Пользовательский label override отдельно от page title; URL/navigation — реальное действие. Изменение identity/profile открывает подходящий новый binding | Hide view сохраняет ресурс; явное закрытие tab освобождает его после проверки операций. Restore descriptor не обещает прежний DOM, auth или form state и не повторяет submit |
| **Material / artifact / attachment / source link** | Добавить, импортировать, открыть, экспортировать, создать редактируемый draft | Label/description; draft — edit; accepted artifact — новая immutable версия. Link label отдельно от origin URL | Remove link из Task не удаляет shared bytes. Trash owned draft отдельно от purge blob. Accepted evidence сохраняет provenance; missing/purged не становятся pass |
| **Prompt / role profile** | Открыть source/preview; создать пользовательскую версию/копию с новым ID | Display label и versioned content. Встроенные role IDs не переименовывать; изменение instructions проходит compiler/activation | Archive/disable для новых назначений, затем delete пользовательской версии по зависимостям. Активные и исторические bindings сохраняют snapshots; удалить все полезные роли кнопкой нельзя |
| **Memory entry** | Создать/посмотреть verified/proposed и источники; ограниченный scoped поиск | Key/content/scope/status по existing remember/ReplaceId/retire с ExpectedRevision; label не скрывает изменение факта | Retire выводит из употребления. Trash/hide — поверх статуса; restore не делает retired/stale запись verified. Purge — отдельный явный выбор данных/истории, не обход integrity |
| **Manual todo / checklist item** | Добавить в Task, открыть связанные материалы, назначить display order | Title, note и manual mark по собственному item ID/revision; изменение связанного acceptance — через RequirementService. Срок, если добавлен, — optional metadata, не автоматический reminder | Trash/restore одного item не удаляет execution/evidence и не завершает workflow stage; повторное открытие done item сохраняет историю |
| **Panel / вкладочная группа / сохранённый layout** | Добавить view/group, дублировать представление разрешённого ресурса, сохранить layout | Label/layout/order/pin/follow mode | Закрыть/reset/delete layout меняет только UI. Общий resource не удаляется вместе с последним view без отдельного действия |

Manual todo подробно задаётся [TASK_TODO_PANEL](TASK_TODO_PANEL.md); использовать его canonical items, не создавать второй checklist внутри этой функции. Таблица выше определяет общие lifecycle правила, а не собственные todo statuses.

## 3. Переименование: label отдельно от identity

Rename доступен в контекстном меню строки, меню заголовка и через клавиатуру там, где это привычно. Inline field содержит текущее имя; Enter сохраняет, Escape отменяет. Имена с кириллицей/пробелами корректны; trim и предел длины задаются продуктом, пустое имя отклоняется. Не превращать имя в путь, shell-команду или HTML; одинаковые labels допустимы, если сущности различимы по project/контексту.

Backend принимает entity type/id, expected metadata revision, operationId и новое значение. Сохраняет label+event транзакционно и публикует новую projection всем окнам. UI может показывать optimistic label с pending marker; при conflict не затереть новое название второго окна и не потерять ввод пользователя. Undo — новая компенсирующая команда с проверкой актуальной revision, а не перемотка БД.

Не менять taskId/chatId/ACP sessionId/worker ID, repository path, artifact hash, memory key, profile ID или acceptance от display rename. Metadata revision/sequence отделены от semantic Task/requirement/run revisions; один rename не инвалидирует проверки и не вызывает LLM. Если существующая БД использует общий object revision для CAS, не трактовать каждое его увеличение как изменение требований.

Host label — каноническое имя в нашем UI. Native title синхронизируется только поддержанным adapter с отдельным receipt; ошибка синхронизации не откатывает незаметно локальное имя. Catalog refresh не перезаписывает manual label старым generated title. В details видно «Название в приложении» и, при необходимости, отдельное имя CLI.

## 4. Редактирование цели, сообщений и связанных материалов

Task title — организация списка; goal/scope/acceptance/answer — смысл задачи. Для смысловой правки показать короткий diff и что она затрагивает. Сохранить новую requirement/Task/assignment revision с provenance; invalidation проходит существующие services. Старые acceptance evidence не получают новую revision подстановкой числа. Связанные результаты становятся stale/needs review согласно их зависимостям; новый green badge требует применимой проверки.

Во время active turn редактирование не переписывает captured packet. Backend сохраняет pending delta, останавливает **новый зависимый dispatch**, показывает «Применится после текущего шага» и проверяет возвращённый результат против его исходных revisions. Пользователь может отдельно отменить текущую работу. Для срочного сужения/отзыва разрешений сразу запретить новые host-owned effects; честно показать границу уже отправленных и внутренних CLI действий. Не обещать мгновенно отозвать разрешение уже работающей внешней операции.

Исходное поручение и отправленные сообщения неизменяемы как история. Команда «Изменить отправленное» предлагает понятный выбор:

- **Уточнить здесь:** новый correction event/message с ref на старое, видимая актуальная формулировка и полный source. Если это меняет требование — связанная revision/invalidation.
- **Продолжить от этой точки:** новый discussion branch/binding внутри выбранной Task либо явно новая Task. Сохранить parent ref; последующие реальные effects остаются в исходной истории, не откатываются и не выполняются повторно.

Редактировать draft можно свободно с autosave revision. Unsent queued input редактируется/удаляется только до atomic dispatch claim; если claim уже произошёл, вернуть conflict и предложить correction. Модельный ответ можно аннотировать/пометить ошибочным, но не переписывать его как оригинал. Редактирование UI transcript не меняет скрытую историю CLI; native rewind допустим лишь при отдельно проверенной семантике и не заменяет external rollback.

При material edit различать live file, draft и accepted snapshot. Draft имеет единый buffer owner/revision; две editor views не создают две копии истины. Accepted artifact не перезаписывается: новая версия, diff и новые evidence refs. Rename label не переименовывает файл; команда «Переименовать файл» — отдельная реальная filesystem/Git операция в разрешённом scope с проверкой ссылок. Замена вложения после отправки создаёт новую версию/сообщение, не меняет уже доставленные bytes.

## 5. Архив, корзина, восстановление и удаление навсегда

**Archive** — обратимая организация списка с сохранением ID и истории. По [ARCHIVE_AND_RETENTION](ARCHIVE_AND_RETENTION.md) неактивный объект архивируется сразу. Активная работа остаётся видимой до явной остановки и подтверждённого исхода. Неизвестные эффекты, очередь отправки и ожидающие решения остаются доступны для восстановления; архивирование само не отменяет исполнение. Архив Project меняет видимость контейнера, не переписывает каждый дочерний флаг.

**Trash** содержит entityId/type, прежнее расположение, deletedAt, actor/reason, lifecycle revision, deletion operation, связи и declared retention. Без выбранной пользователем retention policy не удалять содержимое по таймеру. Обычные search/route/admission исключают trash; отдельный Trash view показывает объект, dependencies, status и Restore. Исторические ссылки отображают «В корзине», а не исчезают.

Project/Task удаляются как явно определённый scope, а не recursive delete любого связанного пути. Перед командой backend вычисляет owned descendants и shared references: runs/chats/assignments входят по ownership; общий profile/memory/repository/browser identity автоматически не уничтожается. Новые children после начала deletion не принимаются в этот scope. Не оставлять orphan foreign keys и resource owners.

**Restore** возвращает тот же entity ID и данные. Если родитель в корзине, предложить сначала восстановить родителя либо допустимый reattach с проверкой scope. Конфликт имени не требует нового ID. Требования, cancelled/completed outcomes, failed checks, retired memory и бюджет остаются прежними. Удалённый native runtime/session или завершённую PTY нельзя вернуть обещанием «восстановлено»: восстановлены сведения/descriptor, дальнейший запуск — отдельное действие.

**Purge** — отдельная команда из корзины, не вариант обычной клавиши Delete. План перечисляет принадлежащие приложению payloads/versions, shared refs, препятствия и то, что останется у CLI/на диске/внешнем сервисе. Требуется явный выбор пользователем конкретного необратимого действия. Не удалять данные unresolved операций, пока без них нельзя установить исход; не считать пользовательское желание скрыть карточку доказательством отсутствия эффекта. Shared blobs удаляются только когда это разрешено для всех удерживающих refs/retention rules; наличие trash ref тоже учитывается.

Purge сохраняет минимальный факт намеренного удаления без содержимого, если он нужен для ссылок/integrity. Существующая неизменяемая запись не подменяется новым hash: history reader различает declared purged payload и corruption. Если текущая схема не умеет такую операцию, feature unsupported до migration, а не ручное стирание файлов. Не обещать secure erase всех backups, native histories и удалённых копий. В финальном receipt ясно: удалено локально, что исключено, что неизвестно.

Memory retire, архив Task и purge — разные действия. Завершение/удаление Task не стирает автоматически полезную project memory; её источник/актуальность проверяются отдельно. Удалённый единственный проверяемый source помечает зависимое знание needs_verification, не оставляет необоснованный verified. Сохранённое старое разрешение не даёт полномочий восстановленной/другой Task.

## 6. Удаление активной сущности — наблюдаемая операция

Удаление не выполняется прямым `DELETE` строки renderer. Предлагаемый host-owned deletion operation хранит intent, captured entity/revision, descendant/resource snapshot, phase, blockers и receipt. Его phases — состояние служебной операции, **не второй workflow status**.

1. **Запрос:** проверить выбранные entity ID/owner/revision/authorization, вычислить impact, записать intent. UI показывает точное имя объекта и scope, захваченные в момент команды; смена currentTask после click не меняет цель.
2. **Quiesce:** установить admission hold для удаляемого scope, запретить новые workers/turns/children и новые host-controlled effects; оставить необходимые cancel/reconcile/journal операции. Уже переданные или скрытые CLI effects не объявлять остановленными. Сделать snapshot drafts/owned resources. Queued недоставленные inputs отменить по CAS или сохранить для restore согласно показанному выбору; не переносить их в соседнюю Task.
3. **Остановка активного:** адресные cancel/stop через соответствующих владельцев. Session cancel requested не terminal. Для PTY/браузерной операции/remote job — собственный контракт; generic session cancel не отменяет Jenkins build и не завершает все оболочки.
4. **Сверка:** дождаться подтверждённого terminal/exit либо зафиксировать interrupted_unknown. Не перепослать prompt, не освободить конфликтующий writer и не выдать успешное удаление по timeout. Неизвестный внешний эффект остаётся доступным в recovery.
5. **Коммит корзины:** только после необходимых settle/reconcile проверить scope/revisions снова, транзакционно применить tombstones и resource detach/ownership, сохранить references/journal. Lifecycle operation может завершиться лишь частично; receipt не называет native purge выполненным, если сделана только локальная корзина.
6. **Публикация:** все окна получают tombstone+sequence; открытый view показывает «В корзине — восстановить/открыть recovery». Выбор соседней строки для удобства — локальное UI действие, не изменение captured owner. Старые callbacks не отправляют команды удалённому объекту.

Пока есть unknown, показывать **«Удаление ожидает завершения / требует сверки»** с деталями; можно закрыть представление, сохранив recovery entry. Не вынуждать держать окно открытым. Отмена ещё не завершённого удаления снимает только его hold после проверки состояния; уже остановленные процессы не стартуют заново, ранее revoked permissions не возрождаются.

Нельзя kill общего CLI process при удалении одной multiplex session. Если проверенного адресного close нет, оставить runtime retained до безопасной остановки owner, показав ограничение. Последний view не доказывает отсутствие других subscribers/active jobs. Disposal listeners/PTY/WebContents выполняется их service один раз, с проверкой ownership/generation; renderer unmount не равен dispose ресурса.

## 7. Сохранённые сессии CLI: реальность и fallback

Pinned Qwen `4360b003a087fe9e57f6ffbe7ba48795980b59c3` содержит extension cases [`deleteSession` / `renameSession`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L13918), а также отдельный [`qwen/control/session/close`](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/acpAgent.ts#L12086). Rename обрабатывает live recording отдельно, чтобы последующая запись не вернула старое имя. Это доказательство конкретного upstream, **не стандартного ACP rename/delete и не поддержки GigaCode**.

Перед native catalog action adapter проверяет фактический method/schema, target runtime/workspace, scope, active-session constraints, response semantics и последствия для restore. Не обращаться к private файлам истории и внутренним SessionService классам вместо отсутствующего API. ACP sessionId сам по себе не доказывает нужный runtime root: mapping включает process/runtime/connection/session/workspace. Нельзя угадывать удаляемый каталог по имени чата.

Если native rename/delete отсутствует или unknown, **host label/tombstone полностью работоспособны**. UI честно пишет: «Убрано из приложения; сохранённая история CLI не удалена». Tombstone не даёт следующему catalog refresh бесшумно вернуть запись в Recents; ключ включает runtime/workspace provenance, чтобы не скрыть чужую сессию с совпавшим ID. Явная команда импорта/re-attach учитывает tombstone и просит предметный выбор восстановления, не создаёт дубликат молча.

Soft trash **не вызывает native delete** автоматически: необратимое удаление его истории нарушило бы обещание Restore. Опциональная native cleanup — отдельная часть purge plan с подтверждённым API и receipt. Не повторять неизвестный исход destructive native request вслепую. При отсутствии lookup для reconciliation оставить partial/unknown, не сообщать «удалено везде». Load/resume после restore только при фактической поддержке; прежние actions не replay.

## 8. Ручные todos, profile и другие связанные данные

Использовать ровно три типа из [TASK_TODO_PANEL](TASK_TODO_PANEL.md): planned_work, manual_note, formal_projection. Это не альтернативный список workflow stages. Edit/display reorder/manual mark имеют item revision, history и scope; перестановка строк не меняет Scheduler или DAG. Связь с requirement/check/worker хранится явно. Пользователь может отметить ручной пункт выполненным; это не проверенный check и не evidence исполнения агентом. Удалить manual note с linked result означает убрать заметку, а не стирать реальную работу. Обязательный planned_work нельзя молча вычеркнуть для улучшения счётчика: изменение принятого плана имеет причину/impact, а active/dependent item проходит change/cancel path. Formal stage/check row редактируется через свой canonical service, не произвольной галочкой. Счётчики подтверждённого/оставшегося/ручного берутся из того же контракта и не пересчитываются по числу любых видимых строк.

Переименование пользовательского profile label сохраняет stable profile ID. Редактирование content создаёт новую версию; preview показывает diff и применимость. Старые workers продолжают captured версию, новая активируется по [ROLE_PROMPT_BINDING](ROLE_PROMPT_BINDING.md). Встроенную роль безопаснее отключить для новых назначений/создать пользовательскую вариацию; удаление используемой версии не должно ломать исторический binding или молча переназначать ему другую роль.

Move Task в другой Project — отдельная semantic операция: на safe boundary проверить root mapping, artifact/source refs, memory scope, MCP/browser identity и permissions. Не копировать auth/credentials и verified project facts старого проекта под новый ID. Без доказанного совместимого переноса оставить исходную Task и предложить новый scoped Task с ссылкой. Rename Project не выполняет такой move и не меняет папку на диске.

Операции bulk поддерживать тем же command service: выбранные IDs и revisions, preview существенных последствий, per-item receipts. Частичная ошибка не скрывается общим «Готово». Нельзя выполнять bulk purge текущего поискового результата без сохранённого списка targets; список мог измениться между preview и click.

## 9. Где находятся действия

В sidebar и списках — правый click/клавиатурное контекстное меню; в открытой сущности — одинаковое меню `…` в header. Для Task рядом доступны Edit goal/details; для обсуждения Rename/Archive/Trash; для вкладок Rename/Close view и отдельно Stop/Close resource. Settings не является единственным входом. Слова «Удалить сессию» не используются без уточнения, идёт ли речь о чате приложения, live binding или сохранённой истории CLI.

После rename/edit/archive/trash показать компактный toast с Undo, пока оно применимо. Корзина и архив доступны независимо от toast/срока уведомления. Keyboard focus после операции предсказуем, screen reader получает название/результат, меню закрывается без потери draft. На узком окне действия остаются в header menu. Не вызывать LLM при открытии меню/редактировании имени.

Restore нескольких views не создаёт несколько CLI/PTY/browser экземпляров. Сохранённый layout с tombstoned resource показывает placeholder с Restore/Remove view. Ошибка должна быть конкретной: stale revision, active operation, unknown outcome, shared reference, unsupported native cleanup. Не заменять их общим «Не удалось» без следующего шага.

## 10. Небольшие карточки реализации

| Карточка | Объём | Приёмка |
|---|---|---|
| **EL1 — M3 basic** | Инвентаризировать реальные entity IDs/services; единые label commands/CAS, меню header+context, draft autosave и rename Project/Task/chat/tab | Два окна, кириллица/пробелы, conflict/Undo/restart; rename не меняет binding или requirements |
| **EL2 — M3 basic** | Архив, фильтры, просмотр и восстановление Task/discussion; вид и ресурс независимы | Неактивный объект архивируется сразу; активный ждёт явной остановки и наблюдаемого исхода. Открытие не запускает процесс; IDs и черновики сохраняются |
| **EL3 — M3 basic** | Простая корзина idle объектов, restore и visible placeholder; active delete пока честно недоступен с причиной либо реализован через existing safe stop | Idle trash/restore работает; никакого native purge/удаления repo; active результат не теряется |
| **EL4 — M4 full** | Semantic editor goal/scope/acceptance, sent correction/branch, linked materials/todos и invalidation через native services | Старый green result не переносится на новые требования; queued edit/dispatch race закрыта |
| **EL5 — M4 full** | Deletion intent/quiesce/cancel/reconcile/tombstone, ownership/descendants, restart continuation | Active/unknown deletion не дублирует эффект, sibling Task продолжает, нет orphan ресурсов |
| **EL6 — M4 full** | Profile/memory lifecycle, shared refs, scoped move, bulk receipts, purge plan и подтверждённый optional native adapter | Не теряются snapshots/права/retired statuses; неизвестное CLI cleanup честно partial/unsupported |

Это срезы существующих M3/M4/M5 services, не новая платформа CRUD. Сначала полезные rename/edit draft/archive/idle trash, затем сложное удаление активного runtime. Нельзя отложить все обычные действия до полного native migration; временный adapter всё равно имеет одного writer и явные границы.

## 11. Проверки, которые доказывают корректность

Сначала deterministic service/contract tests с fault injection, затем целевые live сценарии на настоящем Electron/Giga Windows. Здесь они **не выполнялись**. Отчёт содержит build/runtime/config, scenario, actual outcome и разные статусы simulated/live/not_run.

- **Два окна:** rename A одновременно, одно получает conflict; никакой потерянной правки. Delete из окна A после переключения на B действует на захваченный A; stale callback не удаляет B.
- **Без побочных эффектов label:** переименовать Project/Task/chat/terminal/browser/profile display label; ID/path/session/process/hash/requirement остаются прежними, model calls = 0.
- **Редактирование:** менять goal/answer/acceptance при active worker; captured packet неизменен, новый input version виден, stale output не принят. Submitted message сохраняется, correction/branch не повторяет реальные tools.
- **Draft/queue:** edit и dispatch конкурируют; ровно один победитель CAS, после dispatch только correction. Restart сохраняет ввод, вложения и revision.
- **Archive/trash/restore:** завершённые состояния и бюджеты сохраняются, восстановление возвращает прежний ID. Активные/неизвестные эффекты не скрываются. Закрытие вида не останавливает ресурс; восстановление не запускает его.
- **Активное удаление:** cancel A, B продолжает; нет нового prompt для A до settlement. EOF после write даёт pending deletion/unknown, journal/evidence сохранены и replay отсутствует.
- **Crash boundaries:** отдельно остановить host после deletion intent, hold, cancel, terminal и tombstone commit; восстановление завершает/сверяет ту же operation, не создаёт новые targets или двойной dispose.
- **Shared refs:** удалить attachment link и Task; общий material/profile/browser identity/repository не уничтожен. Purge блокируется нужными refs; declared purged payload отличим от случайно отсутствующего.
- **Native capabilities:** при unknown rename/delete работают локальные label/tombstone и точная подпись; catalog refresh не воскрешает запись. Supported native cleanup тестируется отдельно на disposable истории с проверкой workspace target.
- **Manual todo/memory:** manual done не выдаётся за check pass; удаление todo не стирает execution. Restore memory не делает stale/retired запись verified и не возвращает разрешения другой Task.
- **Чистый, ошибочный, пустой контроль:** clean rename/trash/restore сохраняет ожидаемые IDs; known_bad fixture меняет currentTask или повторяет dispose — тест падает; без runtime/evidence результат not_run, не pass.

Для acceptance достаточно целевых проверок влияния; косметическое изменение меню не требует всей production матрицы. Измерять фактическое время локального сохранения/отражения изменения и восстановление после restart; не обещать мгновенный native delete, гарантированное восстановление чужого runtime или отсутствие всех внешних копий.
