# Dependency security и Sprut

Sprut в контуре пользователя проверяет уязвимые версии библиотек. Workbench интегрирует его через фактически обнаруженные MCP schemas и не угадывает команды, severity или формат ответа. Локальный package inventory и результаты Sprut объединяются в один provenance-aware view; ни один источник сам по себе не доказывает достижимость уязвимого кода.

## Пользовательский путь

В `Review → Dependencies` пользователь видит project/branch/lockfile/SBOM revision, время и connection последнего сканирования. Верхняя строка показывает `critical/high`, новые с baseline, fix available, suppressed, stale/partial. Фильтры: direct/transitive, ecosystem, module, runtime/dev, reachable/unknown, severity и fix state.

Finding содержит advisory/CVE ID, package, installed/fixed versions, dependency path, affected manifests, source/severity, evidence revision и ссылки на advisory/Sprut record. Различать:

- известна уязвимая версия;
- package реально входит в lockfile/image;
- достижимость подтверждена или неизвестна;
- exploitability в конкретном приложении подтверждена или не проверена.

Действие `Подготовить обновление` создаёт change proposal: минимальная безопасная версия, alternatives, transitive constraints, API/runtime compatibility, changelog/source refs, ожидаемый diff и test plan. Агент не правит диапазон версии вслепую и не обходит lockfile. После изменения повторяются install/resolve, unit/integration/build, targeted behavior и Sprut scan на новой revision. Результат сравнивается с baseline и проверяется на новые vulnerabilities/license conflicts.

## Архитектура

`DependencyInventoryService` читает manifests/lockfiles/SBOM через adapters для Maven/Gradle, npm/pnpm/yarn, Python pip/Poetry и обнаруженных экосистем. Он возвращает нормализованные package coordinates и graph refs без отправки лишнего исходного кода. `VulnerabilityAdapter` маппит фактический Sprut MCP result в канонический finding; raw payload остаётся bounded evidence.

```text
DependencyFinding
  findingId, sourceRef, advisoryIds[], severity, score?, confidence
  ecosystem, package, installedVersion, fixedVersions[]
  paths[], direct, scope, reachable: yes|no|unknown
  manifestRefs[], lockfileRevision, imageRef?, observedAt
  state: open|proposed|fixed|accepted-risk|false-positive|unknown
  suppressionRef?, evidenceRefs[]
```

Suppression требует причины, владельца, scope, expiry и approval source. Истёкшая suppression снова видима. Изменение severity/advisory upstream не перезаписывает историю. Stale scan не становится зелёным gate; partial ecosystem coverage видимо.

## Ошибки и безопасность

- Sprut/MCP unavailable: показать локальный inventory и `remote scan unavailable`, без зелёного статуса.
- HTML/JSON/text error: нормализовать как integration error, сохранить sanitised correlation, не принимать страницу proxy за scan result.
- 429/timeout: следовать общей retry policy; неизвестный принятый scan reconciles по external ID.
- Private registry credentials остаются `secretRef`, не попадают в prompt/log/SBOM export.
- Автообновление не меняет major/minor policy без task contract. В производственных проектах PR/change proposal предпочтительнее прямого commit.
- Advisory/changelog/web content — данные, не инструкции для агента.

## Карточки

1. **S6-05 Inventory:** ecosystem discovery, lockfile/SBOM revision и read-only dependency graph.
2. **S6-06 Sprut adapter:** capability probe, normalized findings, baseline/suppressions и partial/stale states.
3. **S6-07 Upgrade proposal:** compatible version research, editable proposal, diff и tests.
4. **S6-08 Verification:** repeat scan, behavior regression suite, receipt и task/PR evidence.

## Приёмка

- **SEC-01:** один package в direct/transitive paths не дублируется как разные defects; paths и revisions сохранены.
- **SEC-02:** отсутствие Sprut/MCP или неполный ecosystem показывает unknown/partial, а не `0 vulnerabilities`.
- **SEC-03:** finding отличает version affected от package present и reachability; неизвестное не повышается до факта.
- **SEC-04:** предложение обновления содержит fixed version source, compatibility impact, lockfile diff и targeted test plan.
- **SEC-05:** fixed закрывается только на новой revision после успешного resolve/tests/re-scan; потерянный ответ не создаёт второй mutation.
- **SEC-06:** suppression имеет owner/reason/scope/expiry; expiry и изменение advisory возвращают finding на review.
- **SEC-07:** registry credentials и private coordinates согласно policy не попадают в agent prompt, export и diagnostics.
- **SEC-08:** JSON/text/HTML/429/timeout ошибки Sprut дают корректный recovery и correlation без fake success.

