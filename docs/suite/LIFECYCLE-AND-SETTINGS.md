# Lifecycle, архив и Settings

## Project, Task и Session

CRUD не прячется в текстовых кнопках. У выбранного объекта есть context menu и command palette: Rename, Duplicate where applicable, Move, Archive, Restore, Delete. Rename также доступен по `F2` и double click title; Escape отменяет, Enter сохраняет, conflict не теряет введённое. Close tab — иконка с label/tooltip, middle click и `Ctrl/Cmd+W`; переход выполняется click по строке, отдельной надписи «Перейти» нет.

Archive — обратимое состояние с отдельным view и фильтрами Project/Task/Session, причиной, датой, parent project и restore. Архивированный Task не стартует новые runs, но сохраняет artifacts/evidence. Delete доступен после impact preview, retention и backup policy; Project delete перечисляет Tasks, working directories, bindings и незавершённые operations. Не удалять внешние repo/build/deployment/page автоматически.

Session list показывает status, role, actual model/reasoning, Task, branch/worktree, last activity и unread/needs-attention. Доступны rename, archive/restore, duplicate context into a new session, stop и open. Duplicate создаёт новый binding из verified Task packet, а не копирует скрыто весь provider transcript.

## Settings information architecture

Settings открывается из нижней части activity rail или palette как обычная вкладка с back/forward и search:

1. **General:** language, theme/system, density, motion, startup/restore and update channel.
2. **Appearance & Layout:** tokens, font/zoom, tab behavior, docking presets, reset per workspace/project.
3. **Agent:** default role, role catalog/custom profiles, model/reasoning defaults and actual capabilities, queue/steering, Todo, subagent limits.
4. **Context & Memory:** effective budgets, compaction thresholds, pinned facts, import/export preview, retention.
5. **Projects & Tasks:** default folders, archive/retention, tracker workflows, naming and evidence gates.
6. **Integrations:** MCP/API/CLI/native connections, project/environment bindings, capabilities, health and credential refs.
7. **Browser:** profiles, certificate/auth policy, downloads, permissions, proxy, external browser and viewport presets.
8. **Code & Terminal:** editor/LSP/DAP, shells, toolchains, trusted commands and environment references.
9. **Git & Forge:** identities, spaces, remotes, PR defaults and protected branch behavior.
10. **Operations & Data:** clusters/namespaces, Jenkins, knowledge spaces, database drivers, read-only defaults and timeouts.
11. **Security & Privacy:** permissions, secret provider, diagnostic redaction, artifact provenance and dependency/Sprut policy.
12. **Logs & Diagnostics:** live levels/categories, correlation search, export preview, storage size and retention.
13. **About & Runtime:** app/CLI/runtime versions and hashes, update status, licenses/SBOM and compatibility evidence.

Каждый setting показывает scope (`app`, `project`, `environment`, `task/session`), effective value и источник. Project override можно reset. Изменение, требующее restart/new session, не имитирует немедленное применение. Search находит недоступные capabilities и объясняет, что подключить.

## Connections и несколько пространств

Connection catalog хранит alias, kind, endpoint identity, auth method as secretRef, capabilities/schema hash, health и resource/environment scope. Один тип может иметь много instances: clusters, OpenShift, Jenkins, knowledge, Sprut, forge spaces и databases. Project binding выбирает defaults по environment и по умолчанию авторизует все обнаруженные capabilities connection для UI, Session и subagents без per-call MCP permission dialog. Явные central disables/target rules могут сузить новые dispatch. Runtime resolver использует task pin → selected environment → project default → last confirmed → sole verified; при неоднозначности показывает picker цели, а не окно разрешения.

Picker группирует по environment и connection kind, показывает полный target, health/stale, permissions и `production/protected/read-only`. Он поддерживает pin to Task и set project default как отдельные действия. Никакая карточка не переключает пространство из-за совпавшего display name.

Credential add/edit/test выполняется в main process/OS provider. Renderer получает masked metadata. `Test connection` — read-only canary и capability discovery; project binding, а не canary, задаёт effective `auto_allow_bound` policy. Export settings исключает secrets и machine-specific paths, если пользователь явно не включил sanitized mapping.

## Окна, панели и desktop chrome

Electron menu bar скрыта; доступные пункты File/Edit/View/Window/Help находятся в command palette и app menu внутри title bar. Title bar содержит drag region, а interactive controls исключены из неё. Minimize/maximize/restore/close имеют оригинальные SVG, Windows hit targets и accessible labels. Close учитывает running/dirty/unknown operations и предлагает точные варианты.

Любая dockable panel открывается через правый tool stripe/commands, перетаскивается drag handle в зоны left/right/bottom/center, меняет размер splitter, объединяется во вкладки и скрывается. Несколько терминалов и browser tabs — resources внутри workspace. Layout versioned per project/workspace/window и восстанавливает только существующие resource refs.

## Diagnostics

Логи структурированы: timestamp, level, category, window/project/task/session/resource, operation/correlation, state transition, duration/result. По умолчанию подробное локальное логирование включено для app/ACP/browser/state, но raw prompt, response, page body, DB rows, tokens, cookies, headers и credentials не пишутся. Пользователь может временно включить bounded payload capture с видимым таймером и redaction preview.

Diagnostic bundle содержит manifest/version, settings sans secrets, capability snapshot, state/event timeline, normalized errors, recent performance counters и выбранные screenshots/traces. Перед export показывается список и redaction. Агент получает адресные refs и поиск по correlation, а не весь лог в контекст.

## Приёмка

- **LFC-01:** rename/archive/restore Project, Task и Session доступны mouse/keyboard, сохраняют IDs/links и переживают reload.
- **LFC-02:** delete preview перечисляет локальный impact, running/unknown effects и retention; внешние объекты не удаляются неявно.
- **LFC-03:** Settings search показывает effective value/source/scope; restart/new-session requirement честно отражается.
- **LFC-04:** несколько connections одного типа различимы по alias/full target/environment, а project binding восстанавливается без silent production fallback.
- **LFC-05:** credential secret не появляется в renderer/state/log/export/prompt; canary не выдаётся за mutate verification.
- **LFC-06:** custom title bar сохраняет drag/double-click/system actions и keyboard accessibility на Windows.
- **LFC-07:** panel drag/dock/resize/hide и layout restore не перезапускают живые resources и не возвращают удалённую вкладку.
- **LFC-08:** diagnostics восстанавливает correlation chain и state transitions, проходит redaction known-bad fixture и остаётся bounded.

