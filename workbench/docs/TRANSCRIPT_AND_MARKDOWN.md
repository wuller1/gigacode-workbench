# Компактная лента инструментов и нормальный Markdown

Дата: **2026-10-10**. Контракт реализации личного Electron UI, не готовый renderer и не отчёт о проверке пользовательского приложения. Сначала изучить фактические framework, store, transcript components и parser в прототипе. GigaCode CLI не менять. Возможности Qwen в закреплённом commit `4360b003a087fe9e57f6ffbe7ba48795980b59c3` не считать доказательством wire schema GigaCode 26.9.75.

Разговор остаётся главным содержимым. Обычные действия агента занимают компактные строки с раскрытием; Markdown читается как документ. Пользователь может узнать, какая команда выполнялась и чем закончилась, без потока раскрытого технического вывода. Связанные правила: [CHAT_FIRST_DESIGN](CHAT_FIRST_DESIGN.md), [DESIGN_IMPLEMENTATION_GUIDE](DESIGN_IMPLEMENTATION_GUIDE.md), [DESKTOP_STATE_AND_CHROME](DESKTOP_STATE_AND_CHROME.md), [DESKTOP_OBSERVABILITY](DESKTOP_OBSERVABILITY.md), [SMART_MESSAGE_QUEUE](SMART_MESSAGE_QUEUE.md), [PANELS_AND_IDE](PANELS_AND_IDE.md).

## 1. Лента: текст, действия и результат

| Элемент | Вид по умолчанию | Раскрытие |
|---|---|---|
| Сообщение пользователя/агента | Обычный читаемый Markdown, без рамки вокруг каждого абзаца | Copy message/source, ссылки на материал и версии по необходимости |
| Последовательная группа tool calls | Одна строка: icon, короткий смысл, число вызовов, фактический статус | Исходные вызовы в порядке событий, затем details конкретного вызова |
| Одиночная команда/инструмент | Компактная строка с названием и статусом | Аргументы/command, scope/cwd, доступный вывод, outcome, timing |
| Ошибка, approval, блокирующий вопрос | Видимое краткое сообщение и конкретное действие | Детали/evidence без обязательного открытия всей группы |
| Артефакт/изменение | Краткая ссылка с реальным type/ref/revision | Существующая panel/viewer; не дублировать большой файл в ленте |

Группировать только **соседние tool rows одного turn/исполнителя**, не перескакивая через содержательное сообщение, approval, вопрос или значимый результат. Не объединять события разных Task, workers или generations. Внутри группы порядок и причинная связь остаются видимыми; параллельные вызовы имеют собственные строки.

Пример корректной строки: «Инструменты · 3 вызова · 2 завершены, 1 выполняется». «Прочитал 3 файла» допустимо лишь когда известны три подтверждённых чтения нужных источников; три вызова поиска не равны трём прочитанным файлам. «Проверки пройдены» нельзя вывести из exit 0 произвольной команды. Название формируется из известных tool kind/title/path, без LLM-суммаризации каждого события. Неизвестный инструмент называется фактическим именем, а не придуманным действием.

Группы свёрнуты по умолчанию; раскрытие сохраняется по stable group/tool ID. Новые chunks не сворачивают пользовательский выбор и не открывают автоматически всю историю. Ошибка/approval остаётся видимой строкой или счётчиком с конкретным текстом даже в свёрнутой группе. Pending permission получает доступное действие сверху текущей активности; его нельзя спрятать за «ещё 25 инструментов». При чтении старой истории показать ненавязчивый переход к требующему внимания событию, не украсть scroll/focus.

## 2. Данные и честные статусы инструментов

В pinned Qwen emitter публикует tool start/update и metadata: [tool-call-emitter.ts:113](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/emitters/tool-call-emitter.ts#L113), [result:224](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/cli/src/acp-integration/session/emitters/tool-call-emitter.ts#L224). Формирование `tool_call`/`tool_call_update`, toolCallId, status, title/kind/locations, rawInput/rawOutput происходит в [transcript-replay.ts:733](https://github.com/QwenLM/qwen-code/blob/4360b003a087fe9e57f6ffbe7ba48795980b59c3/packages/acp-bridge/src/transcript-replay.ts#L733). Timing/provenance могут присутствовать в `_meta`; они не обязательны у форка.

Adapter принимает **реальные структурированные события**, а не распознаёт успешность по фразе модели. Host-owned команды имеют собственный проверенный receipt. Tool message, stderr CLI и окончательный ответ агента — разные источники. У каждого поля хранить provenance и availability; отсутствующий exitCode не превращается в 0, неизвестная длительность — в «0 мс».

Внутренняя projection хранит project/task, binding+generation, turn, toolCallId, optional parent/worker ID, source event identity, observed sequence, input/output versions/refs, wire status, host outcome, время и truncation flags. ToolCallId не глобально уникален. Повтор history replay не создаёт второй вызов; app-local sequence не приписывается ACP. Если upstream не даёт стабильный replay ID, использовать проверенный session/load mapping, не дедуплицировать по одинаковому тексту команды.

Tool update обновляет существующую строку. Отсутствующие поля update не очищают ранее известные; append delta и replacement snapshot различаются по фактическому adapter contract. Если update пришёл без start, создать строку с отметкой «Начало не наблюдалось», не синтезировать время/аргументы. Late event старой generation не завершает новый вызов. Повторный terminal с несовместимым outcome — диагностический конфликт, не «последняя запись победила».

| Состояние наблюдения | UI |
|---|---|
| Tool объявлен/готовится | «Готовится»; ещё не выполнен |
| Выполняется | Сдержанный индикатор, доступный elapsed только по известному началу |
| Ждёт разрешения | Видимый адресный approval; это не обычная пауза вывода |
| Подтверждён terminal success | «Завершён»; quality gate отдельно |
| Ошибка | Краткая причина с доступными details, без скрытия всей строки |
| Отмена запрошена | «Останавливается» до настоящего исхода |
| Подтверждённая отмена | «Отменён», с доступным частичным выводом |
| Transport потерян / outcome не установлен | «Результат неизвестен» и reconcile, не success/cancelled по timeout |

Групповой статус вычисляется из дочерних: отдельно числа running/waiting/failed/unknown/completed. При нескольких состояниях показывать существенное, не один зелёный badge. Не суммировать длительности параллельных команд как wall-clock группы; если показывается elapsed интервала, подписать его. Не скрывать неизвестные outcomes за завершившимся assistant turn. Правила отмены/повторов остаются у [MANAGED_SUBAGENTS](MANAGED_SUBAGENTS.md), не у renderer.

Native todo/plan update направляется в [TASK_TODO_PANEL](TASK_TODO_PANEL.md), а не дублируется десятками раскрытых «записал todo» строк. Лёгкая связь с исходным событием сохраняется. Ни renderer, ни checkbox в Markdown не объявляют formal check пройденным.

## 3. Команда и вывод: раскрывать по запросу

У command row виден короткий заголовок, status и при наличии duration. Details содержат исходный command/argv в читаемом виде, подтверждённые cwd/shell/target, start/end или elapsed, exit code/signal и stdin только если он безопасно сохранён и относится к этому вызову. Не реконструировать «точную shell-команду» из произвольного descriptive title. Массив argv показывать без опасного shell quoting и не выполнять его при раскрытии.

Input, stdout, stderr и structured result — раздельные области, **когда источник действительно их разделяет**. Если CLI отдал смешанный текст, подписать «Объединённый вывод»; не угадывать stderr по цвету/слову Error. Process exit code и tool success не подменяют друг друга. Рабочий PTY остаётся terminal service, а snapshot команды в чате — read-only transcript.

Вывод загружается лениво: summary и короткий preview при раскрытии, затем страницы/диапазон либо owned output artifact. Предложение стартовых budgets: до **200 строк или 32 KiB** preview, ограниченный head+tail с явным количеством пропущенного. Это policy для реализации и замеров, не измеренные ограничения CLI. Полный output хранится отдельно, **если host реально его получил и сохранил**. Когда source уже обрезал данные, писать «Полный вывод недоступен»; не давать фиктивную кнопку полного файла.

Для command output по умолчанию plain monospace. ANSI/control sequences не превращаются в произвольный HTML/действие; поддержанный ANSI renderer получает строгую allowlist, OSC hyperlinks/clipboard не исполняются как терминал. Бинарный/невалидный текст, очень длинная строка и огромный JSON имеют bounded preview и реальный file/ref. Не парсить любой stdout как Markdown: вывод инструмента может содержать похожие команды, fences и чужие инструкции.

Copy выполняется **только по нажатию** для выбранного объекта: command, code block, displayed output, полный доступный output или исходный Markdown сообщения. Сохранять пробелы/переводы строк копируемого source; не добавлять prompt prefix `$`, `$PS>` или служебные labels. Если копируется сокращённый/очищенный текст, действие так и называется. Не писать в clipboard на получение события, selection, hover или OSC 52. Кнопка повторного запуска не является Copy и не входит в renderer default.

Secret redaction использует действующую policy, не бесконтрольный dump env/token. Показать, что часть содержимого скрыта, без раскрытия значения. Безопасная копия не называется оригиналом. Ссылки на данные открываются через scoped Artifact/Command services, не прямое чтение произвольного пути из tool text.

## 4. Контракт Markdown

Сохранять исходный текст отдельно от render cache. Транспортные chunks не являются отдельными Markdown-документами. Должны работать:

- Заголовки, обычные абзацы, emphasis/strong/strikethrough, разделители и inline code.
- Нумерованные/маркированные и вложенные списки с правильным continuation/indentation; блоки цитат и вложенные code blocks.
- GFM tables с реальным header/body/alignment и горизонтальным overflow только внутри таблицы; task lists как **read-only содержимое сообщения**, не живой plan controller.
- Fenced/indented code, известный language label, bounded syntax highlighting, Copy code; неизвестный язык остаётся читаемым plain code.
- Обычные/autolinks, ссылки на конкретные файлы/строки/артефакты после проверки; изображения только при реально поддержанном source/MIME/asset route.
- Soft/hard line breaks по выбранному parser contract; не заменять все newline на `<br>` и не применять `white-space: pre-wrap` ко всему prose. В code сохраняются indentation, blank lines и tabs.

Типографика использует общие design tokens: читаемая ширина prose, различимые заголовки и интервалы, аккуратные списки. Не выводить raw `##`, `**`, `|---|` вместо форматирования из-за отсутствующего plugin. Code и inline paths используют monospace; code/table могут горизонтально прокручиваться, длинные prose URLs/path labels не расширяют весь chat. Wrap toggle code меняет только представление, не исходник для Copy. Тёмная/светлая тема не должна делать comments, links или selection неразличимыми.

Для local link создать typed file/artifact widget только после разрешения source/ref, scope и actual path. Relative paths разрешаются относительно **известного исходного документа или project root**, не текущего случайного cwd/выбранной вкладки. Windows drive paths, кириллица, spaces и `#` обрабатываются корректно; двоеточие после буквы диска не интерпретируется как произвольный URI protocol. Line/column suffix разбирается только по выбранному формату ссылки; не делить любой путь по каждому двоеточию. UNC/network roots и traversal не получают доступ автоматически. Неверная ссылка остаётся понятным текстом/ошибкой, не кнопкой исполнения.

Images сохраняют alt, aspect ratio/размерное место и ссылку на source; loading/failure/unsupported различаются. Не подменять реальный screenshot похожей картинкой. Сообщение со screenshot связано с task/browser capture evidence, если оно существует. Удалённые images загружаются только через фактическую разрешённую media policy; рендер Markdown сам по себе не добавляет credentials или доступ к чужому browser profile. Заимствованный asset сохраняет source/license по [ASSET_RIGHTS](ASSET_RIGHTS.md).

## 5. Renderer и проверенные компоненты

Первым использовать уже установленный renderer, если он проходит контракт выше. Не менять framework ради Markdown. Для **существующего React приложения** возможен следующий набор; проверены официальные README и LICENSE на дату документа, но версии не установлены в прототипе:

| Компонент | Назначение и граница | Первичный источник / лицензия |
|---|---|---|
| react-markdown | AST → React components; собственные renderers code/link/image. Это не готовый transcript/store/streaming scheduler | [README](https://github.com/remarkjs/react-markdown), [MIT](https://raw.githubusercontent.com/remarkjs/react-markdown/main/license) |
| remark-gfm | GFM parsing: tables, tasklists, strikethrough, autolinks/footnotes. Не добавляет CSS и не является HTML sanitizer | [README](https://github.com/remarkjs/remark-gfm), [MIT](https://raw.githubusercontent.com/remarkjs/remark-gfm/main/license) |
| rehype-sanitize | Allowlist sanitation HAST с явной schema; учитывать plugin order и generated IDs/classes | [README](https://github.com/rehypejs/rehype-sanitize), [MIT](https://raw.githubusercontent.com/rehypejs/rehype-sanitize/main/license) |
| rehype-highlight, если нет подходящего текущего highlighter | Syntax highlighting code blocks; подключать ограниченный набор языков и не подсвечивать весь огромный output на каждый chunk | [README](https://github.com/rehypejs/rehype-highlight), [MIT](https://raw.githubusercontent.com/rehypejs/rehype-highlight/main/license) |

До adoption записать выбранные package versions/lockfile, совместимость с текущим renderer/Electron bundler и dependency licenses, выполнить маленький spike на fixtures. README ветки main не является обещанием API установленной версии. Сохранить нужные notices в приложении; не добавлять внешние CDN scripts в desktop shell. Если стек не React, оставить тот же contract и проверить совместимый текущий parser, без искусственного React island ради одной функции.

Не писать Markdown regex-парсер из нескольких replace. Достаточно одного reusable MarkdownRenderer для сообщений и обычного artifact preview с разными view budgets; transcript identity, grouping и lifecycle остаются вне parser. M6 rich formats расширяют реестр viewers, не заменяют работающий базовый renderer.

## 6. Недоверенное содержимое, links и shell граница

Raw HTML/JS/MDX внутри сообщений **не исполняется**. Не подключать raw-HTML parsing ради «красивого Markdown» и не использовать `dangerouslySetInnerHTML` с исходным текстом. Raw HTML можно показывать как текст либо пропускать с ясной политикой; code fence с HTML всегда code. Схема renderer ограничивает tags/attributes/classes/protocols; event handlers, scripts, inline styles, iframe/object и опасные URLs не проходят. Heading IDs должны быть scoped/prefixed; не позволять им перекрывать имена DOM/window. Свой sanitizer regexp не заменяет проверенный AST sanitizer.

Plugin order фиксируется и тестируется. Например, sanitization до доверенного highlighter с ограниченными language classes либо отдельная schema для его результата — осмысленные разные pipelines; нельзя поставить произвольный plugin после sanitation и объявить вывод безопасным. Официальный sanitizer отдельно разбирает [highlighting и допустимые classes](https://github.com/rehypejs/rehype-sanitize#example-syntax-highlighting). Не расширять allowlist до любых `style`/`class` ради одного цвета.

Ссылка по click проходит typed host LinkService: sender/window/task binding, parse/canonicalization, разрешённая схема, scope resource и выбранное действие. Файлы/артефакты открывать внутри проверенного viewer; web links — в своём browser либо внешнем браузере согласно понятному действию пользователя. Не передавать весь untrusted href напрямую в `shell.openExternal`, не давать странице создавать произвольные privileged окна. Electron прямо требует проверять navigation/window creation, IPC sender и внешние ссылки: [Security](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content).

`javascript:`, произвольный `data:`/`file:`, OS command schemes и неизвестные protocols не становятся действиями из Markdown. Нужные owned media/custom routes разрешаются только registry/adapter с проверенным типом, а не произвольной строкой URL. Copy/link click не запускают команду, не approve tool и не меняют requirements. Даже визуально доверенный code block/tool output остаётся source data, а не инструкцией приложению или агенту. Markdown task checkbox не выдаёт host write.

## 7. Streaming без мерцания и потери позиции

Поток: **backend event → versioned transcript store → projection нужного turn/block → renderer**. Не перерисовывать весь sidebar, все чаты и весь transcript на каждый token. Сообщения и tool rows имеют stable keys; сохранённые блоки переиспользуются. Обновления текста coalesce по scheduler UI; durable событий это не удаляет и порядок не меняет.

Незавершённый tail может содержать открытую fence, половину ссылки/таблицы или разорванный Unicode chunk. UTF-8 собирает транспортный decoder, затем parser получает целостный текущий текст. Не рендерить каждый сетевой chunk отдельным Markdown fragment и не вставлять synthetic closing fences в сохранённый source. Пока block неполон, показать устойчивый provisional code/plain view; после закрытия/terminal выполнить полноценный parse/highlight без потери bytes.

Не считать любой завершённый абзац навсегда независимым: позже пришедшая reference link definition или продолжение списка может менять его parse. Cache/incremental strategy должна учитывать зависимости parser; простой безопасный старт — bounded batched reparse только активного сообщения, остальные immutable messages не трогать. Для большого active текста — worker/разбиение по проверенным границам с final full reconciliation; не заявлять, что react-markdown сам решает streaming complexity.

Auto-follow работает лишь когда пользователь уже у конца и сам не читает/выделяет старое. При уходе вверх фиксировать anchor row ID+offset, показывать «Новые сообщения ↓». Поздняя загрузка изображения, открытие tool group и resize code block сохраняют anchor. Selection/keyboard focus не сбрасываются от нового token или group count. При явном переходе к концу снова включить follow.

Виртуализация хранит stable row IDs, measured heights и overscan. Focused/selected content не размонтировать неожиданно; при длинном выделении можно временно удержать диапазон или дать отдельный viewer/copy source. Поиск по истории использует index/store, не только текущие DOM rows. Screen-reader live announcements пакетные: начало/важное состояние/окончание, не каждый token и каждая строка stdout. Не отправлять все скрытые rows в `aria-live`.

## 8. Размеры, Windows и проверка производительности

Реальные пределы выбрать после baseline на целевом Windows. Начальные **проектные** fixtures/budgets: transcript из **5000 событий**, отдельный command output **120000 символов**, длинные Windows paths, code/table шире окна; bounded preview из §3. Это тестовая нагрузка и policy, не заявленная ёмкость Giga или измеренная производительность приложения.

Хранить большие outputs/attachments по refs, не включать все payloads в каждый store snapshot или IPC broadcast. Parser/highlighter budget ограничивает работу на один update; при превышении отображать plain/bounded preview с возможностью открыть реальные данные. Не терять final/error/permission events ради throttling. Новый event должен появляться без спасительного click/reload и без polling-модели.

Записать local event receive → projection apply → render commit latency, p50/p95, максимальную UI задержку, объём DOM/retained cache и память при длительном stream. Отделять время модели/сети от local rendering. Численные pass thresholds назначить после baseline и зафиксировать до сравнения; не объявлять «60 fps» или кратное ускорение по одному screenshot. Background/minimized throttling и foreground responsiveness — разные измерения.

## 9. Малые карточки M3 → M6

| Карточка | Изменение | Приёмка |
|---|---|---|
| **TM1 · M3 basic** | Нормализованный transcript store/tool IDs и compact single rows + соседние groups; status/error/approval отдельно | Start/update/result одной операции не дублируются; error/unknown видны, callback адресный |
| **TM2 · M3 basic** | Команда + lazy output details, bounded preview, точный Copy, source metadata | Stdout/stderr только по факту; truncation/unknown честные; раскрытие не выполняет команду |
| **TM3 · M3 basic** | MarkdownRenderer текущего стека, GFM, code/link/image components и sanitizer policy | Все fixtures форматируются; HTML/опасная ссылка не исполняется, Copy сохраняет содержимое |
| **TM4 · M3 basic** | Batched active-message streaming, anchors/selection, virtualization, клавиатура | 5000 events и 120k output доступны без click/reload и потери focus; метрики actual |
| **TM5 · M6 rich delta** | Shared ArtifactRegistry/viewers, большие файлы, actual diagrams/media/PDF по capability | Реальный ref/hash/source, единый renderer для MD, unsupported видим; никакой имитации export |

Каждая карточка меняет только нужный слой существующего UI; не ждать IDE, нового движка или полной миграции всех services ради обычных tool rows и Markdown. M6 расширяет уже полезный M3, не откладывает читабельные ответы и code blocks на поздний этап.

## 10. Приёмочные сценарии

Это набор targeted tests и live-проверок, **здесь они не выполнялись**. Record версии приложения/CLI/parser/plugins, fixture IDs, результаты и ограничения. Simulated transport отдельно от live Giga.

- **Tool lifecycle:** start → multiple updates → terminal, result без start, duplicate replay, late generation, cancelled/unknown, один failed среди completed. Группа не скрывает проблему и не удваивает calls.
- **Commands:** multiline input, раздельный/объединённый output, exit nonzero/unknown, timeout после возможного write, 120k chars, строка без newline, бинарный output, redacted fragment. Copy каждого объекта сравнивается с его declared source, не с обрезанным DOM.
- **Markdown:** nested lists, numbered continuation, tables с escaped pipes/inline code, task lists, blockquotes, fenced code с backticks внутри, tabs/CRLF/blank lines, Unicode, long links и относительные paths. Сравнить rendering полного текста и того же текста разными chunk boundaries.
- **Open stream:** незакрытая fence/ссылка/таблица, reference definitions позже, UTF-8 split, отмена посередине; текст не исчезает, partial content не объявлен завершённым документом.
- **Navigation/assets:** существующая/отсутствующая local file link, wrong-Task ref, `../` escape, Windows drive/UNC, опасный protocol, HTML/script/attribute injection, image loading/error/unsupported. Ни model invocation, ни shell execute от обычного render/click.
- **Доступность:** Tab/Shift+Tab, Enter/Space раскрывают row; Copy не раскрывает/сворачивает родителя случайным bubbling; aria-expanded/status понятны; focus/selection сохраняются; нет token-by-token screen-reader flood.
- **Два окна/две Task:** stream A не дописывает B; shared store replay не создаёт второй call; hide/reopen/restart сохраняет раскрытие/scroll по правильному binding и не выполняет tools заново.
- **Нагрузка:** 5000 событий, активный stream и lazy output; foreground без ввода 10 секунд — подтверждённые события продолжают отражаться. Затем keyboard/scroll/selection, чтение вверх и переход к новым. Baseline/p95 измерены, не придуманы.
- **Clean / known_bad / empty:** корректная группа/Markdown проходит; fixture с ошибочно скрытым failed child, wrong generation или executable HTML должен провалить проверку; отсутствие tool events/runtime не становится успехом «пустой ленты».

Лента — наблюдаемое представление действий и содержания. Она не заменяет evidence, не добавляет скрытые инструменты, не показывает внутренние рассуждения модели и не меняет смысл выполненной операции ради компактности.
