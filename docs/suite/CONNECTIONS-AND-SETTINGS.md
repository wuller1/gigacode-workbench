# Connections and integration settings

## Settings IA

`Settings → Integrations` содержит не одну глобальную форму, а connection registry:

- MCP servers;
- Kubernetes / OpenShift;
- Jenkins;
- Knowledge / корпоративный аналог Confluence;
- Source control / корпоративный аналог Bitbucket;
- Dependency security / Sprut;
- Databases;
- Browser profiles;
- Language toolchains.

Слева список типов, в центре connections выбранного типа, справа details/test/capabilities. Поддерживаются несколько экземпляров каждого типа. Connection можно переименовать, дублировать без credentials, отключить, проверить, назначить проектам и удалить после проверки зависимостей.

## Общая модель

```ts
type ConnectionDefinition = {
  id: string;
  revision: number;
  kind: "mcp" | "kubernetes" | "jenkins" | "knowledge" | "forge" | "dependency-security" | "database";
  name: string;
  enabled: boolean;
  endpoint?: string;
  transport?: "stdio" | "streamable-http" | "sse-legacy" | "native";
  auth: AuthDescriptor;
  tls: TlsDescriptor;
  proxyRef?: string;
  projectScopes: string[];
  tags: string[];
  options: Record<string, unknown>;
  discovered?: {
    identity: string;
    version?: string;
    capabilities: string[];
    schemaHash?: string;
    observedAt: string;
  };
};

type AuthDescriptor =
  | { kind: "none" }
  | { kind: "bearer"; secretRef: string }
  | { kind: "basic"; username: string; secretRef: string }
  | { kind: "api-token"; username?: string; secretRef: string }
  | { kind: "oauth"; accountRef: string }
  | { kind: "client-certificate"; certificateRef: string; keyRef?: string }
  | { kind: "kubeconfig"; contextRef: string }
  | { kind: "external-provider"; providerRef: string };
```

Endpoint проходит URL validation. HTTP разрешён только для loopback; remote integrations требуют HTTPS. Поле «Отключить проверку TLS» отсутствует. Вместо него: system trust, custom CA reference, client certificate reference, SNI/server name и диагностическая проверка chain.

## MCP servers

Форма MCP:

- имя;
- transport: stdio или Streamable HTTP; legacy SSE только для уже существующего подтверждённого сервера;
- command + argv для stdio, без shell interpolation;
- URL для HTTP;
- auth type/secret;
- headers как allowlisted non-secret values + secret header references;
- working directory и ограниченный environment для stdio;
- connect/start timeout, read timeout и concurrency;
- project scopes;
- `Test and discover`.

Discovery выполняет initialize, server identity/protocol version и `tools/list`/resources/prompts, сохраняет names, input schemas, annotations и hashes. UI показывает tool count, last test, latency и schema changes. Не отображать secret headers или полный environment.

Если Jenkins/OpenShift/forge/knowledge/Sprut уже скрыты за MCP, их отдельная connection ссылается на `mcpConnectionId + tool binding`, а не копирует токен. Agent настраивает bindings по реальным schemas через `MCP_PROFILE_SETUP`, но пользователь может видеть и менять mapping.

## Kubernetes и OpenShift

Поддерживается несколько clusters/contexts:

- source: kubeconfig context, service account reference, exec auth provider или MCP binding;
- display name, cluster API identity и environment `dev/test/stage/prod`;
- default namespace/project и allowed namespaces;
- OpenShift capability discovery;
- CA/client certificate references;
- impersonation отсутствует по умолчанию;
- optional read-only mode и action policies;
- health/RBAC test.

Kubeconfig import показывает только contexts/clusters/users metadata; credential material переносится в vault или остаётся во внешнем provider. Не логировать `users[].token`, `client-key-data` и exec output. Несколько contexts одного cluster остаются отдельными identities.

Project binding может задать default connection/namespace, но каждая операция всё равно несёт точный target. Production target видим постоянно.

## Jenkins

Поддерживается несколько controllers:

- base URL;
- username + API token ref или MCP binding;
- TLS/proxy;
- root folder/view filters;
- project/job mappings;
- read-only / allow trigger / allow cancel policies;
- `Test`: X-Jenkins identity/version, current user, API access и видимые folders/jobs.

Token никогда не включается в URL. Для каждого controller хранить собственные cursors/cache/rate limits. Job с одинаковым именем на разных controllers идентифицируется connection ID + full path.

## Knowledge spaces

Несколько connections и spaces/collections:

- base URL или MCP binding;
- auth/secret ref;
- adapter kind/version;
- default space, allowed spaces и root page mappings;
- capabilities search/read/draft/publish/comments/attachments/versioning;
- project → space/root page bindings;
- publish policy.

Space выбирается объектом с immutable remote ID, display name используется только для UI.

## Forge / аналог Bitbucket

Несколько forge connections и workspaces:

- base URL или MCP binding;
- user identity/auth secret ref;
- workspaces/projects с remote IDs;
- repositories and default branches discovery;
- clone transports HTTPS/SSH и credential provider;
- PR/review/approve/merge/check capabilities;
- project → workspace/repository bindings;
- policies: allow push, create PR, publish review, approve, merge;
- default reviewers/target branch как project settings, не global.

Одинаковый repository slug в разных spaces всегда квалифицируется connection/workspace/repository ID.

## Dependency security / Sprut

Поддерживается несколько Sprut/MCP connections для разных контуров:

- base URL либо `mcpConnectionId + tool binding`;
- environment/organization/project scope и allowed repositories;
- read scan/findings/advisory capabilities и, если реально доступны, submit/cancel/status;
- project → connection/remote project bindings;
- baseline/suppression policy и secret references для registry/source metadata;
- schema hash, coverage ecosystems и last successful scan.

Одинаковый repository/project name в разных Sprut connections квалифицируется connection ID + remote ID. Недоступный server или неполный coverage показывается как `unknown/partial`, а не `0 vulnerabilities`. Полный процесс описан в [DEPENDENCY-SECURITY](DEPENDENCY-SECURITY.md).

## Secret vault

- Renderer передаёт secret только в специализированный `secret.set`, который исключён из обычного operation logging.
- Main шифрует через Electron `safeStorage`/корпоративный credential provider и сохраняет только `secretRef`.
- Secret не возвращается после записи; UI показывает `configured`, source и last validation.
- Replace и delete имеют dependency preview.
- Diagnostics, backup, settings export и Git не содержат значения.
- Clipboard paste допустим, reveal/copy сохранённого secret отсутствует.
- На Windows DPAPI не считается защитой от любого процесса того же пользователя; это явно указано в threat model.

## Scope и defaults

Настройки имеют уровни:

1. application connection registry;
2. project bindings/defaults;
3. Task pinned target;
4. operation captured target.

Нижний уровень не меняется от последующей смены default. Settings показывает зависимости: проекты, активные resources, незавершённые operations и schedules. Удаление connection невозможно, пока зависимость не переназначена/закрыта.

## Политика выполнения по умолчанию

После сохранения connection и его привязки к Project действует **Allow all within configured binding**. Все обнаруженные tools/capabilities данного connection, включая mutating и destructive, доступны UI, выбранной Session и её subagents без отдельного окна разрешения на каждый MCP/tool call. Роль и recipe помогают выбрать нужное действие, но не урезают binding и не вызывают повторную авторизацию.

Project binding фиксирует connection, resource/environment scope и policy revision. По умолчанию target rule разрешающий; пользователь может централизованно отключить connection, capability, environment или конкретное правило цели. Такая блокировка применяется к новым dispatch и наследуется всеми сессиями и subagents. Для уже отправленного действия сохраняется result/reconcile; Workbench не показывает временный bypass dialog и не утверждает, что revoke отменил внешний эффект.

Перед действием interface показывает exact connection/space/cluster/database/repository, параметры или diff и ожидаемую проверку. Это рабочая operation card и audit trail, а не approval modal. `established_strict` добавляет dry-run, impact, tests, rollback/readback и evidence как этапы качества. Неизбежные OS/provider login, certificate или credential prompts остаются частью внешнего механизма входа; приложение не дублирует их своим per-call запросом.

## Import/export и миграция

Export содержит definitions, bindings, policies, schema hashes и список необходимых secret slots, но не secrets/cookies/private keys/kubeconfig credentials. Import работает в staging, показывает conflicts и создаёт placeholders `credential required`.

При переносе с существующей реализации агент:

1. читает только metadata/paths/config schemas, не печатает values;
2. предлагает mapping old connection → canonical definition;
3. сохраняет encrypted backup/rollback согласно доступному provider;
4. импортирует definitions и secret refs, когда ref остаётся действительным;
5. просит пользователя ввести только действительно отсутствующие secrets в UI в конце;
6. выполняет read-only test каждой connection;
7. не удаляет старую конфигурацию до verified result.

## Проверки

- две connections одного типа не смешивают cache, auth, scopes или events;
- project binding не позволяет вызвать connection вне scope через IPC/MCP;
- malformed URL, remote HTTP, secret-in-URL и TLS bypass отклонены;
- schema hash change отключает только затронутые bindings;
- settings export/diagnostics/logs не содержат canary secret;
- secret replace во время активной operation не меняет captured auth generation;
- delete показывает и защищает active dependencies;
- import без secrets создаёт понятные placeholders;
- packaged Windows safeStorage roundtrip и restart;
- MCP stdio child завершается без orphan, HTTP reconnect соблюдает backoff;
- все connections доступны клавиатурой и показывают loading/error/stale/verified.
