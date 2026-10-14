# Аудит инструкций и специализации ролей

Дата: 14.10.2026. Область: CORE, legacy SYSTEM_PROMPT entrypoint, 14 встроенных overlays, routing/capability metadata и согласованность связанных контрактов. Это аудит текстов и статических связей. Он не подтверждает качество ответов модели, запуск native append, полноту host logging или совместимость рабочего GigaCode 26.10.6; прежний target26.9.75 — исторический baseline.

## Первая критика → исправления

| Найденное | Последствие | Исправление |
|---|---|---|
| CORE отсылал к большому SYSTEM_PROMPT, legacy full context передавал оба; роли повторяли общие правила | Расход контекста, противоречивые копии, неоправданно длинный старт | CORE — единая общая политика; SYSTEM_PROMPT — короткий legacy/bootstrap entrypoint; native compiler получает CORE + один overlay |
| Роли 3–18 KB с повторяющимися gate/process пояснениями | Слабой модели сложнее выделить нужный алгоритм; маленькие задачи превращаются в полный цикл | Каждый overlay задаёт предметный процесс/критику/результат; quick/standard/deep и safety вынесены в CORE |
| Stage-команды result-template/record/submit звучали обязательными в любом окружении | Native App мог пытаться вызвать отсутствующий PowerShell controller | Протокол явно ограничен реально установленным legacy controller; App использует фактические services |
| «Host выделяет независимые копии» звучало как реализованная гарантия | Возможная ложная уверенность в изоляции | Сначала проверить существующую изоляцию/ownership; инструкция не заменяет runtime enforcement |
| Каталог/роль могли читаться как permission allowlist | Риск дрейфа эффективной project policy при переключении | Роль выбирает контекст/процесс; central bindings/scope сохраняются. QA может создавать test fixtures в порученном объёме; это не новое разрешение |
| Новые шаблоны и рабочие девять ролей недостаточно явно различались | Миграция могла навязать дополнительные роли или заменить удачный LLM router | Машиночитаемый migration contract: сохранить workplace9 + LLM router, пять дополнительных templates не активировать импортом |
| Reviewer/автор и повторное чтение отчёта смешивались по смыслу | Видимость независимой проверки без независимого исполнения | Reviewer проверяет требования/исходники отдельно; relabel автора не считается независимостью |

## Вторая критика → уточнения

1. **Короткий SYSTEM_PROMPT нельзя считать самодостаточным дампом полной политики.** Entry point прямо требует актуальный CORE, только если host ещё не передал его целиком. Недоступность CORE — видимый пробел. Компилятор не должен повторно включать entrypoint. Legacy controller пока действительно передаёт его с CORE: это сохранённая совместимость, а не новая runtime-оптимизация.
2. **Сокращение может удалить доменную глубину.** Overlays сохраняют специализированные проверки: analyst пишет материал и критикует полноту; spec формализует contracts/transitions; backend — Java/Spring/Maven, Python/Node по фактическому стеку; database — routine privileges/search_path, EXPLAIN ANALYZE effect, COPY/large-file integrity; devops — Jenkins job identity, namespace/CRD/RBAC/stale revisions; UI — настоящие переходы/desktop/focus/overflow; diagnostics — различающие гипотезы; GigaCode UI — ACP ownership/parallel overlap/CAS/unknown/retry.
3. **Автоматизация не должна порождать лишние вызовы.** Router сохраняет достаточную текущую роль; panel/tab focus, preview и retry не требуют нового LLM-routing. Common prompt compilation — deterministic, не LLM. Дополнительное review и все специалисты не обязательны для quick.
4. **Журнал каждого действия не должен требовать рекурсивных tool/LLM вызовов.** Raw tool trace использует фактический host capture; semantic events группируют независимые чтения. При отсутствии capture полнота явно ограничивается. Checkpoint хранит результат/решения/источники, не скрытые рассуждения.
5. **Профиль не доказывает доступные capabilities.** Тексты не обещают Giga native hot switch, sandbox, скрытое дерево CLI agents, resume, полную browser/IDE parity или автоматический enforcement.
6. **Факты не означают запрет думать.** Общие знания разрешены как источник гипотез и вариантов; значимые для реализации утверждения проверяются. Сохранённые evidence используются по версиям, а не перечитываются бесконечно.
7. **Role routing metadata — контракт, не работающий LLM router.** Поле runtime_implemented_in_reference_controller остаётся false. Local keyword fallback не приравнивается к пользовательскому workplace LLM router. Конкретный App runtime подтверждается отдельными тестами его реализации.

## Размеры и статическая проверка

На baseline `f9594c7` сумма UTF-8 размеров CORE + SYSTEM_PROMPT + 14 overlays составляла **172 759 bytes**; после правок — **82 745 bytes** (−52,1%). Это размер всех текстов, не требование загружать каталог и не измерение provider tokens. Максимальный CORE + один overlay: **38 026 → 22 574 bytes** (около −40,6%). Точный token overhead зависит от tokenizer и native CLI layers и здесь не измерялся.

Выполнено:

- `git diff --check -- workbench`: успешно.
- JSON parse routing/capabilities: успешно; catalog ровно 14 IDs, workplace9 и additional5 дают тот же набор; прямые scoped `docs/*.md` references в CORE/entrypoint/overlays существуют.
- `node tools/check-bundle.mjs`: suite checks успешны (71 cards, 226 acceptance IDs, 14 roles, 29 workflows); полный bundle на этой промежуточной ревизии возвращал **18 hash mismatches** изменённых файлов. Это ожидаемо устаревший manifest, который требуется пересобрать после финальной интеграции; ошибку не выдаём за pass. При финальной интеграции manifest пересчитан: `check-bundle` прошёл240/240 manifest entries,12scripts,14roles,29workflows; полный runtime-аудит и точная provenance находятся в `docs/suite/AGENT-HARNESS-AUDIT.md` корня репозитория.

Изменения не затрагивают CLI source, app runtime, workflows/stage checks, production gates или разрешения рабочего компьютера. QA repo.write добавлен в историческое allowed_potential поле как discovery hint для порученного test code, без расширения effective binding.

## Что ещё должен доказать runtime

- CORE/overlay действительно переданы один раз, receipt соответствует source hashes и верной role/session generation.
- Verified native append сохраняет native CLI behavior; context-only честно показан, если append недоступен.
- A/B процессы с разными ролями не изменяют общий env/file и друг друга; переключение busy/unknown не обходит recovery.
- Пользовательский LLM router сохранён при миграции, роли выбираются по request/project/task/stage, а не ручным selector/keywords без обозначения fallback.
- Журнал captures все поддержанные фактические события и честно отмечает пробелы; compaction/restart восстанавливает принятые факты, scope и pending без replay.

## Оценка качества моделей без выдуманных обещаний

Перед объявлением «новая обвязка умнее» сравнить старые и новые инструкции на одинаковых реальных задачах и runtime/model/reasoning settings. Подходящий небольшой набор: ясная микроправка; противоречивый brief; SDD с частичным успехом/повторами; Spring transaction defect; PostgreSQL routine/migration; desktop stale state/parallel sessions; Jenkins unknown trigger; review ошибочного «всё проверено».

Для каждого сравнения: принятые требования и независимый oracle; фактический результат; неподтверждённые утверждения; найденные/пропущенные defects; правильность tool targets; user questions; время и input/output tokens при доступности; recovery после прерывания. Не полагаться только на самооценку модели или субъективный единый балл. Архитектура здесь предпочтительна по устройству, но сравнительное превосходство моделей **не измерено**.
