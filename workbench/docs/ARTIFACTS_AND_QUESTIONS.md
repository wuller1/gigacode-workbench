# Материалы и вопросы прямо в задаче

Статус: **контракт реализации, не готовая функция**. Приложение пользователя здесь не запущено. Работать в существующем GigaCode UI, `personal_fast`; использовать один Task writer, Artifact/Requirement/Evidence services и текущий SessionService. GigaCode CLI не изменять, его структурированные events/capabilities проверять на установленной версии.

В разговоре пользователь получает настоящий материал, который можно открыть, прочитать, изменить, сохранить новой версией и экспортировать поддержанным способом. **Вопрос открывается поверх разговора**, предлагает понятные варианты **и всегда допускает свободный текст**. Отдельная панель вопросов и значок Questions в правом rail не нужны. Материалы, ответы, решения и проверки сохраняются в той же Task, а не в несвязанных диалогах или файлах с потерянным происхождением.

Основные контракты: [TASK_WORKSPACE](TASK_WORKSPACE.md), [редактирование и lifecycle](ENTITY_LIFECYCLE_AND_EDITING.md), [панели](PANELS_AND_IDE.md), [контекст](CONTEXT_BUDGET.md). Это детализация F05/F13/F26 [конкурентного плана](COMPETITOR_FEATURE_PLAN.md), без новых ролей и workflows.

## 1. Размещение и короткий пользовательский путь

**Материал:** агент закончил brief → в его сообщении появилась компактная карточка «Описание поведения · Markdown · v2» → «Открыть» показывает dock panel → пользователь исправляет абзац → «Сохранить версию» → видны v3, автор правки и применимые изменения требований → агент получает адресный delta на безопасной границе. Чат и composer остаются на месте. Ссылка на v2 в старом сообщении продолжает открывать v2; рядом допустима подсказка, что есть более новая версия.

**Вопрос:** поверх текущего разговора открывается «При закрытии вкладки остановить работу?» с названием Task → варианты с короткими последствиями, ниже поле «Свой ответ или уточнение» → пользователь выбирает вариант, дополняет его текстом и нажимает «Ответить». Выбор лишь заполняет draft, не отправляет ответ автоматически. Сохранённый ответ появляется в разговоре с понятным состоянием: получен, ожидает передачи или применён. Таймаут, скрытие формы и рекомендация модели не являются ответом пользователя.

Карточка материала показывает имя, тип, версию, источник/автора и доступность; preview не нужен для каждого мелкого файла. Основное действие — открыть; в меню — история, сравнить, экспортировать/сохранить копию, убрать ссылку. Нельзя показывать «Скачать PDF», пока нет работающего PDF exporter или существующего проверенного PDF-файла. Для обычного текста полезен copy, для большого — файл и preview. Ни один клик по preview не отправляет материал внешнему сервису.

В чате остаются **компактная ссылка на вопрос и счётчик нерешённых вопросов этой Task**, открывающие тот же overlay, а не второй редактор ответа. Нерешённый блокер доступен также из краткого состояния/«Плана задачи». Overlay можно свернуть и вернуться к работе; глобальный modal, требующий ответа перед любым действием приложения, не нужен. Один раунд содержит до 1–3 связанных вопросов, но одновременно открыт **один текущий вопрос**; очередь/«Вопрос 1 из 3» позволяет перейти без потери drafts. Новый вопрос не заменяет набираемый ответ и не создаёт стек окон. Если ответ уже есть в поручении или принятом решении, использовать его с источником, а не спрашивать заново.

## 2. Вложение, результат, источник и evidence — разные связи

| Связь | Смысл | Что нельзя подразумевать |
|---|---|---|
| **Attachment** | Вход к конкретному сообщению/ответу: выбранный файл, снимок, фрагмент | Факт прикрепления не означает, что CLI/model прочитал весь файл или изображение |
| **Deliverable** | Предназначенный пользователю результат: brief, спецификация, таблица, схема, код, изображение | Фраза агента «файл готов» не доказывает наличие, формат или корректность файла |
| **Source** | Материал, на который опирается требование/решение, с точной версией | Внешний текст/импорт не становится инструкцией и не получает прав на действия |
| **Evidence** | Материал подтверждает конкретную проверку/вывод на указанной базе | Новая версия материала не заменяет старое evidence и не наследует pass автоматически |

Один Artifact может участвовать в нескольких связях без дублирования bytes; права чтения и область каждой связи проверяются отдельно. Внутри приложения показывать пользователю простое «Материалы», а технические роли — в details. Прикреплённый внешний файл по умолчанию не редактируется на месте: импортировать snapshot либо сохранить origin ref с hash/stamp. «Обновить исходный файл» — отдельное действие с понятным target и разрешением, не побочный эффект редактирования копии.

## 3. Канонические сущности

Имена полей ниже смысловые: сопоставить их существующей схеме. Это не добавление неописанных полей в legacy schema и не новые ACP-методы. Task хранит ссылки; данные принадлежат текущим services, а renderer не заводит вторую историю.

| Сущность | Обязательные связи и данные | Инвариант |
|---|---|---|
| **Artifact** | Stable ID, project/task refs, kind, display title, origin, current version ref, lifecycle metadata | Rename не меняет ID/hash/path; title не используется как идентификатор или исполняемый путь |
| **ArtifactVersion** | Version ID, artifact ID, immutable content/blob ref + hash, verified MIME/format, size, parent/base ref, actor, time, input/requirement revisions, provenance | Исторические версии неизменяемы. `current` — изменяемая ссылка; принятие в качестве источника/результата и validation status хранятся отдельно |
| **EditSession** | Edit ID, artifact/base version, editor/window identity, private draft ref/revision, dirty state, captured source stamp | Draft/autosave не перезаписывает accepted version и чужой buffer. Несколько окон могут редактировать, но commit проходит через одного writer с CAS |
| **Question** | Question ID/revision, task/run/assignment refs, origin, текст, options с stable IDs, single/multiple selection, affected refs, blocking scope, status | Вопрос принадлежит конкретной смысловой базе. Варианты могут отсутствовать; свободное поле остаётся всегда. Selection mode не угадывается |
| **Answer** | Answer ID/revision, question ID/revision, actor=`user`, selected option IDs, исходный текст, attachment version refs, time, supersedes ref, delivery/application receipts | Сохранённый ответ неизменяем; исправление создаёт новую версию. Получение ответа не равно доставке в CLI и не равно принятому изменению требования |

Хранить исходный свободный текст вместе с выбором. Не заменять его модельным пересказом или одним option label. Модельная рекомендация — отдельный proposal с model/source, никогда `actor=user`. Если вопрос разрешён уже существующим принятым ответом, записать `resolved_by_source` со ссылкой на него, а не сочинять новое пользовательское сообщение/submit. Question answer и tool permission approval — разные типы: ответ о желаемом поведении продукта сам по себе не разрешает deployment или внешнюю запись.

Очередь Question остаётся в host-owned Task/QuestionService. Открытый question ID, свёрнутость, focus origin и view state относятся к Task+окну; answer draft — к question ID/revision и автору/окну по существующему контракту. Presentation state не создаёт новый вопрос и не меняет blocking status.

### 3.1. Durable Question Queue

Для каждой пары `(taskId, sessionId)` host хранит одну упорядоченную durable queue и допускает не более одной записи `active`. В окне показывается только `active` выбранной Task/Session; переключение Task или Session не меняет head, порядок или адрес доставки. Вторая копия приложения читает тот же head, а не открывает следующий вопрос. Минимальная запись содержит:

```ts
type QuestionRequest = {
  questionId: string;
  revision: number;
  projectId: string;
  taskId: string;
  sessionId: string;
  origin: {
    assignmentId?: string;
    attemptId?: string;
    generation: number;
    turnId?: string;
    callbackRef: string;
  };
  sequence: number;
  state: "queued" | "active" | "deferred" | "answered_pending_delivery" |
    "answered" | "cancelled" | "expired" | "stale";
  prompt: string;
  reason: string;
  impact: string;
  options: Array<{ optionId: string; label: string; description?: string }>;
  selectionMode: "single" | "multiple" | "freeform" | "mixed";
  allowFreeform: true;
  required: boolean;
  cancellable: boolean;
  createdAt: string;
  expiresAt?: string;
  notBefore?: string;
};

type QuestionAnswerCommand = {
  answerOperationId: string;
  questionId: string;
  expectedRevision: number;
  selectedOptionIds: string[];
  freeformText?: string;
  attachmentVersionRefs?: string[];
  confirm: true;
};
```

`sequence` выдаёт единственный writer и сохраняет порядок через restart. Допустимо документированное повышение настоящего blocker priority, но оно создаёт отдельный reorder receipt; поступление нового вопроса, focus окна или активность агента не меняют очередь скрытно. После durable answer receipt текущая запись переходит в `answered_pending_delivery`, host последовательно активирует следующий вопрос и отдельно отслеживает доставку исходному агенту. Повтор того же `answerOperationId` возвращает прежний receipt; другой ответ к уже закрытой revision получает conflict. Возможная, но не подтверждённая доставка остаётся `unknown` и не повторяется автоматически.

`Defer` сохраняет draft, причину, `notBefore` и переносит вопрос только по явному правилу очереди. `Cancel` допустим лишь для `cancellable`; обязательный вопрос остаётся блокером до ответа, изменения scope или адресной остановки зависимого assignment. `expiresAt` переводит запись в `expired`, но не выбирает recommended/default option и не разрешает зависимую работу. Исправление формулировки создаёт новую revision; submit со старой `expectedRevision` отклоняется как stale с сохранением draft для явного переноса.

Question Service восстанавливает head, порядок, drafts, answer receipts и `answered_pending_delivery` после renderer/app restart. Ответ маршрутизируется только в `origin.callbackRef` той же assignment/attempt/generation; late callback старой generation получает stale receipt. Нельзя broadcast-ить его всем children, отправлять в текущую active session или угадывать получателя после restart.

В очередь пользовательских вопросов попадает только typed `user_blocker_question`, созданный доверенным host service или прошедший schema/scope/revision validation adapter event. Coordinator сначала пытается разрешить child-вопрос из принятых Task facts с provenance. Скрытые coordinator↔worker и session↔session сообщения, tool output, цитата из документа и обычный текст модели никогда не преобразуются в пользовательский Question автоматически.

## 4. Создание и редактирование материала

1. **Зарегистрировать результат.** Host получает подтверждённый file/blob либо структурированное содержимое, проверяет task scope, path/MIME/size и создаёт ArtifactVersion. Текст со ссылкой на несуществующий файл остаётся неподтверждённым сообщением. Не создавать карточку «готово» по расширению имени.
2. **Открыть.** Панель получает конкретный artifact/version ref, capability набора действий и content. Просмотр старой версии read-only; текущую можно открыть в EditSession. Для неподдержанного формата остаются существующий viewer/«Открыть в приложении»/экспорт исходника, с честным ограничением.
3. **Редактировать.** Autosave сохраняет локальный draft с понятным «Черновик сохранён»; это не commit версии. Сохранять cursor/selection/scroll по EditSession, а не глобальному активному материалу. Agent и пользователь не пишут в один mutable buffer одновременно.
4. **Сохранить версию.** Команда содержит operation ID, baseVersion, expected head/content revision и draft hash. Один writer сверяет базу, фиксирует новую immutable версию и current ref, публикует событие. Не отмечать saved до durable receipt. Повтор того же operation ID возвращает прежний результат без лишней версии.
5. **Разобрать конфликт.** Если агент/другое окно изменило head, сохранить пользовательский draft, показать base/current/mine и выбор: сравнить/перенести правку/сохранить отдельным вариантом. Безопасный автоматический merge возможен только для доказанно независимых текстовых изменений; конфликт не скрывать. «Поверх» — явное действие с просмотром последствий и актуальной базой.
6. **Применить смысловой delta.** Для уже принятого источника требований использовать тот же Requirement/Decision change path, что при изменении Task. В пределах существующей авторизации применять однозначный delta без повторных вопросов; обновить requirement revision и зависимые checks. Если source mapping/смысл неоднозначен, новая версия сохранена, но имеет `needs_review` и не выдается за принятый источник. Состояния «сохранено» и «принято» видны отдельно.

Изменение display title не инвалидирует содержание. Изменение принятого criterion/контракта делает затронутые результаты stale; переиспользовать старые можно только после проверки применимости. Agent result, пришедший по старой базе, сохранить как вариант с его provenance; не заменять им более новую пользовательскую версию. Независимые требования не теряются при новом SDD delta.

**История:** список version/author/time/change summary, сравнение выбранных текстовых версий, открытие и создание новой версии из старой. «Восстановить v2» создаёт новый current snapshot со ссылкой на v2 и проходит тот же impact path; не перематывает audit, внешние действия и verification states. Удаление ссылки/корзина/purge следуют [ENTITY_LIFECYCLE_AND_EDITING](ENTITY_LIFECYCLE_AND_EDITING.md); bytes, на которые ссылается evidence, не исчезают незаметно.

## 5. Форматы: что реально умеет adapter

Не вводить общий флаг «поддерживает документы». Каждому формату отдельно объявить `view`, `edit`, `diff`, `export` и ограничения **проверенного adapter/version**. Если библиотека ещё не подключена, соответствующая возможность unavailable; viewer не подразумевает exporter.

| Формат | Первый полезный путь | Последующие возможности и границы |
|---|---|---|
| **Markdown / plain text** | M3/D3: реальный локальный файл, читать/copy/save original, небольшой текстовый ответ/brief. Raw source доступен | M6/D7: редактор + preview + version/diff; Markdown sanitization, безопасные links. Сохранять кодировку/line endings по выбранной политике |
| **Code/config** | Read-only file и diff с path/revision; «прикрепить выделение» | Monaco либо имеющийся editor, CAS save. «Сохранить в material» и «применить к рабочему repo» различаются; последнее — проверяемая запись/ChangeSet, не действие preview |
| **Таблица / CSV** | Реальные typed columns/rows либо исходный CSV с явно выбранными delimiter/encoding; bounded preview | Tabular editor с cell validation и version; XLSX через настоящий adapter. Формулы/текст, даты/числа и multiple sheets не смешивать. Не обещать round-trip чужих macros/charts/features, если adapter их теряет |
| **Диаграмма** | Редактируемый текст Mermaid либо supported scene format + preview | Экспорт SVG/PNG только при реальном renderer; source остаётся доступен. Diagram image без scene/source не выдаётся за редактируемую схему |
| **Изображение** | Viewer, zoom, размеры и original file; actual screenshot/generation provenance | Annotation/edit только при подключённом editor. Crop/annotation создаёт версию; licensed assets по [ASSET_RIGHTS](ASSET_RIGHTS.md). Vision delivery и просмотр человеком — отдельные capabilities |
| **DOCX** | Открыть/сохранить существующий исходник; extract text помечен неполным относительно layout | Генерация/редактирование только через выбранный DOCX adapter. После export проверить parse/open и representative rendering: таблицы, переносы, кириллица, изображения; plain text с `.docx` недопустим |
| **XLSX** | Исходник и ограниченный preview через реально подключённый parser | Typed export с проверкой sheets/cells/formulas и повторным чтением. Не выдавать CSV за XLSX; неподдержанное содержимое исходника не затирать silently |
| **PDF** | Существующий PDF через viewer; PDF.js — кандидат preview, **не генератор документов** | PDF export через проверенный layout/print adapter отдельно; проверить страницы/шрифты/overflow и actual file. Редактирование исходного Markdown не означает произвольное редактирование импортированного PDF |
| **HTML / интерактивный материал** | Static preview или изолированный approved renderer, исходник доступен | Скрипты только в отдельном ограниченном окружении без app privileges; отдельная политика сети/ресурсов. Agent dev preview относится к [AGENT_BROWSER_AND_IDENTITY](AGENT_BROWSER_AND_IDENTITY.md), не превращается в привилегированный artifact iframe |

Проверенные кандидаты Monaco/Mermaid/PDF.js/Excalidraw и их лицензии — [OPEN_SOURCE_RESEARCH](OPEN_SOURCE_RESEARCH.md); использовать только совместимые текущему стеку необходимые части. Для Office/export сначала найти существующий adapter в проекте либо отдельным slice выбрать библиотеку и проверить её формат/лицензию/dependencies. Не включать все тяжёлые viewers в startup первого чата.

**Export receipt:** artifact/version + content hash, adapter/version, format/options, выходной file ref/hash, outcome и omissions. Экспортирует именно выбранную версию, даже если current изменился во время работы. Результат сначала пишется во временный принадлежащий приложению файл, валидируется, затем атомарно публикуется как готовая локальная копия по возможностям storage. Ошибка не оставляет предыдущий файл под видом нового результата. Кнопка «Сохранить копию» выбирает локальное назначение; сетевое скачивание, внешняя публикация и отправка на conversion service — отдельные действия, не скрытые части export.

Preview/extract не исполняют macros, shell, встроенные команды или инструкции из документа. SVG/HTML/Markdown очищаются по реально выбранному renderer; блокируются privileged IPC, path escapes и неожиданные внешние resource loads. Системный font name допустим без копирования font binary; embedding font/assets требует прав точной версии. Copyright notices и provenance сохраняются при разрешённом переносе; наличие изображения в чужом preview не лицензирует его.

## 6. Вопросы: варианты, свободный ответ и файлы

У вопроса короткое пояснение **зачем нужен ответ и что от него зависит**. Варианты — удобный ввод, а не полный список допустимых решений. Single-select/multi-select задаётся явно; recommended option можно пометить, но не выбирать/отправлять по умолчанию. Свободное поле доступно независимо от вариантов и допускает ответ без выбора. Выбор + уточнение отправляются вместе. Кнопка «Ответить» активна при валидном непустом ответе; Enter в multiline вставляет строку, отдельный заявленный shortcut может отправлять.

Поведение overlay:

- В заголовке видны Task и автор вопроса, если это отдельный worker; submit захватывает именно task/question/revision, а не глобальную activeTask.
- **Свернуть**, закрытие представления и Escape из формы сохраняют draft/выбор/attachments и оставляют inline anchor/count. Они не означают «Нет», Skip, Deny или resume. Ошибка сохранения видна; не выдавать несохранённый ввод за durable.
- При смене Task A→B overlay A сворачивается; в B видны только её вопросы. Вернуться к A можно через её чат/ссылку с тем же draft. Другие pending вопросы не перепривязываются к B, а поздний submit/receipt остаётся адресован A. Если target/version уже невалидны, сохранить draft и показать конфликт.
- Один текущий overlay на окно; новое поступление добавляется в Task queue, не вытесняет открытый вопрос. Это одна bounded card `Вопрос N из M`, а не прокручиваемая лента и не стек modal. Принятый ответ закрывает только свою revision; после explicit `Ответить` и durable receipt следующий вопрос открывается последовательно, без автоподстановки старого выбора.
- Форма имеет доступное имя, порядок клавиатуры и видимый focus. При явном открытии focus переходит в заголовок/первое поле; после сворачивания возвращается к исходной ссылке либо composer **той же Task**, если он ещё виден. Новый event не крадёт ввод в соседней Task/PTY. Не заявлять `aria-modal=true`, пока остальное приложение доступно.

**Обязательный permission callback не маскировать обычным вопросом.** Он сохраняет тип, исходный request/binding/generation, только реально предложенные permission options и свой lifecycle. Его нельзя удовлетворить свободным текстом generic Question или рекомендованным choice. Сворачивание permission UI не разрешает зависимый tool; отдельное заметное действие ожидания остаётся доступным. Если требуется показать его поверх уже открытого вопроса, сначала сохранить/свернуть тот draft, не создавать modal storm и не менять очередь ответов.

Добавить file/image к ответу можно, когда host принимает этот формат. Рядом показать, что реально получит агент: оригинал по supported transport, текстовый extract, выбранный фрагмент или только ref. Если модель/CLI не поддерживает изображение, файл можно сохранить для человека как материал, но нельзя написать «агент увидел изображение». Нет подходящего file channel/extractor — сохранить текстовый ответ и показать ограничение; не терять draft и не заменять неизвестное содержимое догадкой.

«Не знаю / нужно исследовать» и `Ответить позже` могут быть явными действиями. Они не подставляют рекомендованный вариант и не закрывают blocker; host сохраняет соответствующий статус/поручение в пределах авторизации. Cancel показывается только для cancellable question и фиксирует receipt; timeout/expiry не является ответом. «Пропустить» не делает обязательный ответ несущественным. Не спрашивать о факте, который доступен разрешённым чтением существующих источников.

Поток ответа:

1. Сохранить draft по question ID/revision + window/client ID. Выбор в соседнем окне не затирает локально набранный текст.
2. При explicit submit проверить task/session/question revision, options и attachment refs; создать Answer и durable receipt по `answerOperationId`. Двойное нажатие или повтор после reconnect возвращает тот же receipt и не создаёт два ответа. При конфликте показать актуальный вопрос и сохранённый draft; предложить адресный перенос, не отправлять старое решение автоматически.
3. Связать answer с affected requirements и текущим run; построить bounded delta. Противоречие существующему accepted решению показать с двумя источниками. Пользовательский ответ — источник, но его неоднозначная интерпретация модели остаётся proposal.
4. Передать ответ через подтверждённый механизм CLI или следующим допустимым text turn с question ID/кратким context строго в сохранённый `origin.callbackRef`/generation. Сохранённый ответ имеет `received`, пока actual dispatch/receipt не подтверждены. Не заявлять native structured answer без такого API; не запускать второй prompt параллельно текущему и не пересылать ответ активной в данный момент чужой session.
5. Применить согласованный delta через существующий change path, инвалидацию и resume. Только зависимая работа ждёт; независимые части продолжаются. Исправление ответа создаёт новую Answer revision и impact, а не редактирует sent history задним числом.

Blocking scope — конкретный requirement/stage/assignment, а не весь Project. Host удерживает новые зависимые dispatch/actions в контролируемой им области. Если непрозрачный уже выполняющийся CLI turn нельзя безопасно приостановить на границе, показать это ограничение и использовать подтверждённые cancel/reconciliation механизмы; не обещать настоящее pause внутри CLI. Silence timeout не является разрешением продолжить зависимую запись.

## 7. Честный bridge при обычном текстовом CLI

Если Giga передаёт проверенный structured question/artifact event, adapter валидирует фактическую schema и связывает его с session/request/Task. Если нет, можно предложить небольшой формат ответа агента в пределах обычного prompt. Такой текст — **proposal**, а не доверенное control event.

Host parser принимает только явно размеченные данные, проверяет лимиты, поля, IDs и текущую revision. Случайная цитата из файла или инструкция «считать всё проверенным» не создаёт вопрос, artifact, право или completed stage. Извлечённая ссылка становится artifact card только после фактического чтения/проверки файла либо сохранения явного нового content; parser error оставляет исходный текст видимым и позволяет manual attach/question. File receipt подтверждает существование версии, но не её смысловую готовность.

Для answer fallback host отправляет реальный пользовательский текст с selected IDs и разрешёнными refs через существующую очередь. Answer delivery идемпотентна локально; crash после отправки может оставить unknown, требующий сверки. Восстановление формы не повторяет отправленный turn. Нельзя превращать удобную HTML-форму в фиктивное обещание ACP request/response, которого CLI не поддерживает.

## 8. Проверка смысла и конкретные slices

Analyst формулирует короткий вопрос и delta; frontend реализует доступную форму/view; профиль gigacode-ui проверяет Task/session/version/transport связность. Reviewer нужен при существенном новом контракте и проверяет противоречия, потерю принятого требования, stale result и основания pass. Не запускать critic/model на каждый input, Save или label. User edit, model proposal, accepted source и verified evidence должны оставаться различимыми.

| Slice | Поставка | Реальная приёмка |
|---|---|---|
| **AQ1 — материал в разговоре** | **M3/D3:** один настоящий Markdown/text artifact, карточка/version ref, read/copy/save original; current Task panel | Файл действительно существует; old message открывает old version; missing/path escape/unsupported format показаны честно; hide/reopen не теряет чат |
| **AQ2 — durable очередь вопросов** | **M3/D3:** Task/Session-bound ordered queue, один active overlay над разговором, Question/Answer refs, сохранённый draft, choices+free text, defer/cancel/expiry, inline reopen/count, addressable bridge и receipts | Реальный ответ дошёл exact origin assignment/attempt/generation либо явно pending/unknown/unsupported. Free-text-only, choice+text, explicit confirm, sequential advance, minimize/Escape/reopen, очередь без стека/scroll list, Task switch, double submit, другое окно, stale revision, hidden peer traffic и restart проверены |
| **AQ3 — authoritative semantics** | **M4/D4–D5:** requirement/decision delta, affected-only blocker/resume, source mapping и stale checks | Противоречивый/исправленный ответ не теряет accepted требования; A ждёт, независимая B продолжает; неизвестный native pause не заявлен работающим |
| **AQ4 — edit/version/history** | **M6/D7:** EditSession, autosave draft, CAS commit, diff/history; начать с Markdown/text/code | User edit против concurrent agent/window сохраняет обе версии; duplicate Save не плодит versions; dirty restart/reopen и stale evidence проверены |
| **AQ5 — форматы и export по одному** | **M6/D7:** нужный table/diagram/image viewer, затем выбранный Office/PDF exporter отдельными карточками | Actual output правильного формата открывается/читается обратно; Unicode/layout/invalid input, selected version during export и unsupported feature проверены. Не закрывать весь набор по одному успешному Markdown |

Для runtime UI gate указать build/source/CLI версии, task/session, входные refs и снимок/DOM фактического состояния по доступному инструменту. Unit test парсера не подтверждает живую доставку ответа или сохранение из editor. Нет runtime — `not_run`; исходное ожидаемое/фактическое различие сохраняется, а не объявляется исправленным.

```text
В существующем GigaCode UI реализуй только AQ__ из ARTIFACTS_AND_QUESTIONS, personal_fast.
Найди фактические Task/Artifact/Question writer, storage и CLI adapter; переиспользуй их.
Материал имеет реальную immutable версию; пользовательский draft сохраняется отдельно, Save — CAS.
Вопрос — Task-bound overlay поверх разговора, без отдельной панели/rail icon; всегда есть свободный ответ.
Выбор не отправляется сам; сворачивание/Escape сохраняют draft и inline ссылку. Received/delivered/applied различны.
Не выдумывай native ACP question/artifact API. Text parser даёт proposal, host проверяет refs и receipts.
Сделай один видимый путь в текущем чате и один подходящий отрицательный случай: concurrent edit,
stale answer, missing file или unsupported export. Проверь live на той же сборке, если меняется UI/runtime.
Верни изменённое поведение, revision, actual evidence и remaining/not_run; не запускай весь каталог.
```

В следующий task packet передавать нужную AQ-карточку, актуальные version/question refs, разрешённую область и критерий. Полные документы/истории не дублировать во всех prompts; оригиналы доступны адресным чтением.

## Интерактивные макеты — обязательный вид артефакта

Giga создаёт макет доступными file tools, оболочка регистрирует immutable версию и открывает её в изолированном preview. Пользователь взаимодействует с макетом, оставляет свободное замечание или annotation; агент получает ссылку на точную версию, проверяет DOM/скриншот доступным adapter и выпускает v2. Это обязательный результат M6/D7 по [NATIVE_MOCKUP_ARTIFACTS](NATIVE_MOCKUP_ARTIFACTS.md), без ожидания IDE/M8 и без модификации CLI. Использовать те же Artifact/EditSession/CAS/Queue/Panel services, не отдельную систему документов.
