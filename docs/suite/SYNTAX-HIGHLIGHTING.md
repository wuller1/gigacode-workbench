# Общая подсветка кода и логов

Статус на 2026-10-13: контракт интерфейса и последующей реализации. Подсветка подключается ко всем кодовым поверхностям Workbench через общий слой; она не подтверждает валидность программы, manifest, SQL-запроса или успешность операции. Макет не закрывает runtime acceptance. Условия согласования прототипа и живые проверки этапов остаются в [DELIVERY-PLAN](DELIVERY-PLAN.md) и [FINAL-PROTOTYPE-SCOPE](FINAL-PROTOTYPE-SCOPE.md).

## Покрытие

| Поверхность | Что подсвечивается |
|---|---|
| Code / IDE / файловый preview | Java, Python, JavaScript/TypeScript, React JSX/TSX, HTML/XML, CSS, JSON, YAML, PowerShell, Bash и другие подтверждённые grammar |
| Data | PostgreSQL/SQL в console, DDL, процедуре/функции, миграции, explain source и preview экспорта SQL |
| OpenShift / Kubernetes | YAML/JSON в resource view, editor, create/apply preview, двухколоночном diff; Istio CRD пользуются тем же слоем |
| Jenkins | Groovy/Jenkinsfile там, где есть source/editor; параметры с JSON/YAML schema; progressive console, отдельные стадии и вывод тестов |
| Review / Git / forge | Полные файлы, diff/hunks, blame, варианты конфликтов и редактируемый результат; языковые токены сохраняются внутри маркировки добавления/удаления |
| Browser / diagnostics | HTTP headers/status, JSON payload, HTML/XML source, JavaScript stacktrace и console output |
| Chat / Knowledge / artifacts | Markdown fences по объявленному языку, raw Markdown editor, версии и сравнение; неизвестный fence безопасно показывается обычным текстом |
| Logs / Output / terminal transcript | Время, severity, key=value, multiline JSON, Java/Python/JS stacktrace и разрешённые ANSI presentation sequences |

Один и тот же язык использует одну палитру во всех пространствах. Это правило охватывает read-only просмотр и редактирование. Обычные описания, комментарии и небольшие поля ввода команды/адреса/имени остаются нативными полями; наличие слова SQL или YAML в тексте само по себе не включает редактор. Вывод введённой команды может иметь подсветку независимо от поля ввода.

Язык определяется из явной schema/MIME/extension/fence и отображается в metadata при необходимости. Отсутствующая grammar, ошибка tokenizer или неподтверждённый формат дают readable plaintext с причиной. Не выбирать дорогой auto-detect среди всех grammar на каждом chunk и не объявлять определение языка результатом проверки синтаксиса. PromQL lexer выделяет текстовые конструкции, но не подтверждает типы выражения, label cardinality или выполнимость запроса.

## Общий визуальный контракт

Выбранная тема — **Monokai**. Код остаётся на фоне `#272822` в светлой и тёмной оболочке. Цвета общие для IDE, запросов, конфигураций, diff и логов: строки жёлтые, числа фиолетовые, функции зелёные, типы голубые, keywords розовые. Для небольшого текста розовый осветлён до `#ff5793`, комментарии — до `#a5a18f`. Системный forced-colors использует Canvas/CanvasText. Расчёт обычных и diff-фонов в `design/review-evidence/syntax-contrast.json` даёт минимум 4,64:1; это не заменяет проверку всех состояний выделения и настоящего редактора.

- Семантические токены: keyword/type, string/regexp, number, property/name, comment, metadata, error, warning, info и diff addition/deletion. Dark/light/high-contrast содержат одинаковые имена токенов; конкретные значения могут различаться.
- Контраст текста каждого токена с фактически отрисованным фоном — не ниже **4.5:1**. Проверять также comments, line numbers, выделение, search match и add/remove background, а не только базовую палитру. Числа сохраняются как evidence, декларация цвета не считается измерением.
- Никакого text-shadow, свечения, gradient glow или светящегося нижнего края. Keyboard focus остаётся чёткой самостоятельной рамкой; цвета ошибок и diff не заменяют текстовые обозначения, `+`/`−`, номера строк и доступные имена.
- Моноширинная гарнитура, tab size, line-height, wrap и горизонтальная прокрутка одинаковы для источника и слоя подсветки. Изменение темы не двигает строки и caret, не сбрасывает selection/scroll.
- Copy, поиск, выделение и навигация работают с исходным текстом модели документа, не с HTML span-разметкой. В screen reader текст читается один раз; декоративный слой editor скрыт через aria-hidden.
- Скрытие, resize, перенос панели и выбор другого окна не создают новый источник данных, повторный stream или другой экземпляр dirty buffer.

## Источник, безопасность и экспорт

Источник истины — DocumentService/ArtifactService либо адресный log stream store. Высветленная HTML-разметка является только производным отображением. Никогда не записывать её назад в документ, не использовать для apply/execute, не собирать экспорт из innerHTML/визуально обрезанного DOM.

Внешний код, HTML error, JSON и логи считаются данными. Перед вставкой в DOM экранировать исходный текст; разрешена только ограниченная span-разметка проверенного tokenizer. Ни HTML из лога, ни Markdown fence, ни XML/JS source не выполняются, не открывают URL и не вызывают privileged IPC. Remote Markdown/HTML renderer имеет собственную sanitization policy; подсветка не заменяет её.

Для логов/диагностики/remote headers секреты редактируются **до индексации, render, model attachment и экспорта**, на границе trusted adapter/store. Оpaque secret refs не раскрываются ради подсветки. Учитывать секрет, разделённый между chunks, multiline JSON и URL query/header; один regex в renderer недостаточен. Индикация redaction видима, но сама скрытая строка не копируется в metadata, hash labels или error message. Политика относится и к производному тексту кода, передаваемому в diagnostics/индекс/публикуемый artifact; штатный локальный editor не изменяет файл на диске автоматически.

«Экспорт без изменения источника» означает: tokenizer не изменяет текст, порядок, переносы, Unicode и диапазон **разрешённого canonical source**. Обязательные redaction/control normalization выполняются отдельно до render/export и имеют собственные policy/version/receipt. Если они применены, экспорт называется sanitized source; он не выдаётся за исходные неретушированные bytes. Для безопасных fixture без секретов экспорт совпадает с исходной строкой, включая содержащиеся в ней ANSI bytes. Copy plain text и export не извлекают цветовые HTML tags.

ANSI для log viewer — только presentation: ограниченный allowlist SGR-цветов/атрибутов, привязанный к доступным semantic tokens. OSC, DCS, clipboard/title/hyperlink команды, перемещение курсора и управление терминалом не исполняются; неизвестные/оборванные управляющие последовательности безопасно скрываются либо представляются текстом по видимой policy. Нельзя передать лог целиком в управляющий terminal emulator. Настоящий PTY имеет отдельный terminal contract, подсветка transcript не создаёт прав на исполнение команд.

## Логи: источник и управление потоком

OpenShift/Kubernetes log target включает connectionId, cluster, namespace, resource UID, pod/container, restart instance, выбранный диапазон и stream generation. Jenkins включает controller connectionId, full job name, queue/build identity, stage при наличии и progressive cursor. UTC/локальная зона времени явно обозначены; severity определяется парсером, а неизвестная строка остаётся текстом без выдуманного уровня.

- Multiline JSON и stacktrace собираются ограниченным stateful parser: continuation сохраняет порядок и исходную позицию. Незавершённый chunk не превращается в финальную ошибку JSON.
- Follow включён только по явному состоянию. Прокрутка пользователя вверх удерживает позицию и показывает количество новых строк; «К последним» возвращает tail. Pause presentation не равен Stop stream или cancel build.
- Поиск/фильтр работают по разрешённому source с диапазоном покрытия: только загруженный сегмент или весь доступный индекс. Severity filter не теряет связанные строки stacktrace; JSON folding не удаляет raw source.
- Размеры очереди chunks, строкового сегмента, pending parser state, индекса и renderer DOM ограничены. Backpressure использует поддержанный transport cursor/pause; если остановить upstream нельзя, данные пишутся в bounded spool с quota либо показывается явный gap/drop receipt. Рост памяти «пока пользователь не откроет окно» запрещён.
- Pause, hidden panel и медленная grammar не снимают эти лимиты. UI показывает источник, cursor/range, stale/reconnecting/partial/gap и потерю доступа отдельно от пустого успешного ответа.
- Export задаёт точный диапазон и target, читает canonical source потоково с тем же redaction policy. Видимый фильтр не меняет экспорт молча: «видимые результаты» и «весь доступный диапазон» различаются.

## Runtime архитектура

Общий SyntaxService принимает sourceRef/revision, language, theme version и видимый диапазон. Он возвращает tokens/ranges, а не выполняемый код и не новую копию истины. Language grammar грузятся локально и лениво; versions/licenses фиксируются. Код не отправляется во внешний сервис ради подсветки.

Tokenization больших документов и логов — в worker с лимитами времени/памяти, cancellation и incremental пересчётом изменённых диапазонов. Сохранять lexer state на chunk boundary: multiline strings/comments, JSON и ANSI могут пересекать границу. Результат worker содержит document/stream identity и revision; запоздавший результат для прошлого проекта, контейнера, окна или версии отбрасывается. Parse failure возвращает plaintext исходного диапазона, не пустое окно и не усечённый текст.

Большие read-only документы, diff и tailing log используют virtualization/windowing. Не копировать весь многогигабайтный лог в React state, DOM, LLM prompt или postMessage на каждый tick. Incremental append пакетируется по frame budget; hidden view не продолжает бесполезный layout. Selection/copy/search/export имеют доступ к source store независимо от виртуализированного DOM. Длинная одиночная строка, бинарные bytes и превышение лимита получают отдельный fallback, не бесконечную работу regex.

Editor опирается на существующий Buffer/DocumentService: undo/redo, IME, selection, CRLF, tabs, dirty state, внешние изменения и сохранение по revision. Для реальной IDE использовать уже выбранный совместимый editor (Monaco — кандидат по плану), его workers и позднее фактический LSP/parser. Цветные токены не заменяют diagnostics/completion/refactoring/LSP и не означают семантически корректный SQL/Groovy/YAML. Overlay textarea макета не переносится в production IDE как готовый движок.

Multi-window/view projections подписаны на общий источник с собственными viewport/follow/selection. Project → Task → Session, documentRef/log target, source revision, connection generation и chunk sequence сохраняются в provenance. Agent attachment ссылается на точный источник/диапазон/редактированную версию, а не на «текущий активный tab». Переключение разговора не переадресует stream/export/search и не смешивает секреты или индексы проектов.

## Что есть в прототипе

В `design/` используется общий [suite-prototype-syntax.js](../../design/suite-prototype-syntax.js) и [CSS токенов](../../design/suite-prototype-syntax.css). Локально закреплён **highlight.js 11.12.0**, BSD-3-Clause: [LICENSE](../../design/vendor/highlightjs/LICENSE), [provenance с hashes](../../design/vendor/highlightjs/provenance.json). Runtime CDN-загрузка не нужна. Первичные источники библиотеки: [официальная сборка](https://highlightjs.org/download), [репозиторий CDN assets](https://github.com/highlightjs/cdn-release); сверены 2026-10-13. При переносе сохранять лицензию/уведомления и проверять exact-version зависимости, а не заменять их непроверенным latest.

`SuiteSyntax.render`, `highlightElement`, `upgradeEditor` обслуживают явно размеченные поверхности и fallback для pre. Textarea остаётся редактируемым источником, поверх/под ним расположен декоративный слой; events, value, scroll и geometry синхронизируются. Read-only diff сохраняет line/add/remove wrappers. Markdown fences используют объявленный язык, JSX/TSX и известные имена имеют aliases. PromQL — небольшой локальный lexer, не semantic parser.

Для строки длиннее **120 000 кодовых единиц JavaScript** прототип пропускает тяжёлую подсветку и показывает полный escaped plaintext, **не обрезая источник**. Неизвестная grammar и ошибка highlight также оставляют полный текст. Это локальная защита макета, а не доказанная стратегия больших runtime-файлов: worker, полноценная virtualization, backpressure, production redaction и durable cross-window stream recovery этим не реализованы.

K8s/Jenkins fixtures содержат timestamp, INFO/WARN/ERROR, multiline JSON, Java stacktrace и ANSI. Они демонстрируют вид и переключения; не доказывают реальные Kubernetes/Jenkins запросы или обработку всех форматов логов. Текущий viewer скрывает ANSI presentation spans и не является terminal emulator. Этот документ не утверждает, что все языки, темы, контрасты и живые сценарии уже протестированы.

## Встраивание в существующие этапы

Это срезы [DELIVERY-PLAN](DELIVERY-PLAN.md), без отдельного параллельного engine или переноса поздней IDE вперёд. Связь со старой шкалой M — в [GIGACODE_UI_DEVELOPMENT_PLAN](../../workbench/docs/GIGACODE_UI_DEVELOPMENT_PLAN.md); её зависимости M12 после M10 не отменяются подсветкой.

| Этап / существующий владелец | Действия | Выдача пользователю |
|---|---|---|
| Этап 0 | Проверить существующий editor/highlighter, лицензии и source ownership; выбрать reuse/repair по одинаковым сценариям | Короткая карта поверхностей, пробелов и подтверждённых вариантов |
| Этап 1; M3.11 | Общие semantic tokens и plain-source renderer; Markdown/GFM fences, code preview, fallback, a11y | Одна читаемая палитра в чате и preview, исходник корректно копируется |
| Этапы 2 / 2D; M6.1–M6.4 | HTTP/JSON/HTML browser detail, artifact source/versions; lazy editor/read-only diff с revision guard | Агентский artifact и network detail открываются без исполнения source |
| Этап 3; M9.1 | Git/PR hunks, blame и conflict editor через общий компонент | Review сохраняет номера/добавления/удаления вместе с языковой подсветкой |
| Этап 4; M6.2 → M12 | Реальный editor/worker, Java/Python/React; LSP и diagnostics отдельными capabilities | Редактирование, undo/IME и save проверены на реальном файле |
| Этап 6; O2/O4/O5/O7, M9.2–M9.4 | Jenkins/K8s logs, YAML/JSON apply previews, Markdown knowledge; cursor, filters, bounded tailing и redaction | Адресный живой лог и manifest с безопасным source export |
| Этап 7 | PostgreSQL console, routines/DDL/migration и SQL export preview | SQL остаётся неизменным при edit/copy/execute/export |
| Этап 9; M10 | Нагрузка, долгие streams, crash/recovery, два окна, Windows scale, contrast и supply-chain evidence | Проверенная сборка с измерениями и честными ограничениями |

Каждый срез выдаётся вместе с изменённым сценарием и evidence. Готовый макет, загруженная grammar или screenshot с цветами не закрывают runtime-карточку.

## Приёмка — сценарии, не отметки pass

| ID | Сценарий и ожидаемое доказательство |
|---|---|
| SYN-01 | Один набор контрольных фрагментов SQL/YAML/JSON/Java/Python/TS/JSX/TSX/Groovy/PowerShell/HTML/HTTP/Markdown fences во всех применимых поверхностях; явный язык либо честный plaintext fallback |
| SYN-02 | Тёмная/светлая/high-contrast темы, обычный/selected/diff/search фон: измеренный контраст ≥4.5:1 для видимых токенов, без glow; keyboard focus и screen reader сохраняются |
| SYN-03 | IME/кириллица/emoji, CRLF, tabs, multiline paste, undo/redo, resize/scroll, programmatic replace и смена темы: source/caret/selection не повреждены, текст не читается дважды |
| SYN-04 | Unknown grammar, malformed source и tokenizer failure: полный plaintext; 120 001 code units в макете не обрезаны, Copy/export не содержат span tags |
| SYN-05 | HTML error, script-like строки, Markdown fence и XML остаются данными; нет DOM execution, навигации или privileged вызовов |
| SYN-06 | Timestamp/timezone, severity, multiline JSON, Java/Python/JS stacktrace; chunks разрезают строку/JSON/token: порядок, continuation и raw positions сохранены |
| SYN-07 | ANSI SGR/OSC/DCS, clipboard/title/hyperlink/cursor sequences и оборванный escape: разрешено только отображение, командных эффектов нет; export следует declared canonical-source policy |
| SYN-08 | Секрет в header/URL/JSON и между chunks не попадает render/index/search/attachment/export. Проверяются готовые файлы экспорта и диагностические receipts, не только скриншот |
| SYN-09 | Tail → scroll вверх → Pause → search/filter → новые chunks → resume: anchor/selection не скачут, счётчик нового корректен, фильтр не теряет stacktrace; память и queues ограничены |
| SYN-10 | Две сессии/два окна, смена connection/container/restart instance/build и поздний worker result: чужой target/revision отвергнут, source export адресный |
| SYN-11 | Большой файл/длинная одиночная строка/медленный renderer: worker cancellation, bounded spool/backpressure, видимый gap при потере и отзывчивый UI; нет молчаливой полной загрузки в prompt/DOM |
| SYN-12 | Copy/export и apply/execute читают ту же разрешённую source revision; diff wrappers/номера строк не потеряны; сравнение источника и экспорта допускает только объявленную redaction policy |
| SYN-13 | Потеря доступа, reconnect/cursor rollover и restart во время stream: partial/stale/unknown видимы, нет двойных chunks, переадресации или ложного успешного пустого результата |

Evidence содержит build/commit, grammar/version, OS/scale/theme, source fixture hash или разрешённую redacted reference, target/revision, конкретные шаги, измерения latency/RSS/CPU/контраста и наблюдаемый результат. Performance budgets фиксируются на выбранной Windows-машине до load gate. Не запускать LLM для выделения токенов; browser fixture pass, реальная интеграция и packaged Windows проверка отмечаются раздельно.
