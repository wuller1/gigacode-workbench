import type {
  OpsClusterResourceType,
  OpsQueryResult,
} from "../../shared/operations";
import { OpsHttp } from "./http";
import { failure } from "./errors";
const component = (v: unknown, label: string) => {
  if (
    typeof v !== "string" ||
    !v ||
    v.length > 253 ||
    v === "." ||
    v === ".." ||
    !/^[a-zA-Z0-9._-]+$/.test(v)
  )
    throw failure("validation", "Некорректный Kubernetes " + label);
  return encodeURIComponent(v);
};
const bounded = (v: unknown, fallback: number, max: number) => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw failure("validation", "Неверный лимит Kubernetes.");
  return n;
};
function desiredMatches(expected: any, actual: any): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => desiredMatches(v, actual[i]))
    );
  if (expected && typeof expected === "object")
    return (
      !!actual &&
      typeof actual === "object" &&
      Object.entries(expected).every(([k, v]) => desiredMatches(v, actual[k]))
    );
  return expected === actual;
}
function secretMetadata(resource: any) {
  if (!resource || typeof resource !== "object") return resource;
  if (Array.isArray(resource.items))
    return { ...resource, items: resource.items.map(secretMetadata) };
  if (
    resource.kind !== "Secret" ||
    !resource.metadata ||
    typeof resource.metadata !== "object"
  )
    return resource;
  const m = resource.metadata || {};
  return {
    apiVersion: resource.apiVersion,
    kind: "Secret",
    metadata: {
      name: m.name,
      namespace: m.namespace,
      uid: m.uid,
      resourceVersion: m.resourceVersion,
      creationTimestamp: m.creationTimestamp,
      labels: m.labels,
      ...(m.annotations
        ? {
            annotations: Object.fromEntries(
              Object.keys(m.annotations).map((k) => [k, "[hidden]"]),
            ),
          }
        : {}),
    },
    workbenchMetadataOnly: true,
  };
}
export class KubernetesApi {
  private resources: OpsClusterResourceType[] = [];
  constructor(private http: OpsHttp) {}
  private envelope(
    data: any,
    extras: Record<string, unknown> = {},
  ): OpsQueryResult {
    return {
      data: secretMetadata(data),
      observedAt: new Date().toISOString(),
      warnings: [],
      ...extras,
    };
  }
  async discovery() {
    const version = (await this.http.request("version")).value;
    const groups = (await this.http.request("apis")).value;
    if (!Array.isArray(groups?.groups))
      throw failure("protocol", "Kubernetes не вернул API groups.");
    const versions = [
      "v1",
      ...groups.groups
        .slice(0, 100)
        .map((g: any) => g.preferredVersion?.groupVersion)
        .filter((v: any) => typeof v === "string"),
    ];
    const resources: OpsClusterResourceType[] = [],
      unavailable: { groupVersion: string; kind: string }[] = [];
    for (const gv of versions) {
      const group = gv.includes("/") ? gv.split("/")[0] : "",
        v = gv.split("/").at(-1)!;
      try {
        const r = (await this.http.request((group ? "apis/" : "api/") + gv))
          .value;
        for (const item of r.resources || [])
          if (!item.name.includes("/") && Array.isArray(item.verbs))
            resources.push({
              group,
              version: v,
              resource: item.name,
              kind: item.kind,
              namespaced: !!item.namespaced,
              verbs: item.verbs,
            });
      } catch (e: any) {
        if (!["not_found", "forbidden"].includes(e.kind)) throw e;
        unavailable.push({ groupVersion: gv, kind: e.kind });
      }
    }
    this.resources = resources;
    return {
      resources,
      version,
      partial: groups.groups.length > 100 || unavailable.length > 0,
      unavailable,
    };
  }
  async probe() {
    const d = await this.discovery();
    return {
      name: this.resources.some((r) => r.group.endsWith("openshift.io"))
        ? "OpenShift"
        : "Kubernetes",
      version: d.version.gitVersion,
      capabilities: [
        "cluster.discovery",
        "cluster.namespaces",
        "cluster.list",
        "cluster.get",
        "cluster.events",
        "cluster.logs",
        "cluster.watch",
        "cluster.apply",
        "cluster.scale",
        "cluster.restart",
        "cluster.delete",
      ],
      data: d,
    };
  }
  private async target(input: Record<string, any>, named = false) {
    const resource = component(input.resource, "resource"),
      group = input.group ?? "",
      version = input.version ?? "v1";
    if (typeof group !== "string")
      throw failure("validation", "Некорректный Kubernetes group");
    if (group) component(group, "group");
    component(version, "version");
    if (input.namespace !== undefined && input.namespace !== "")
      component(input.namespace, "namespace");
    if (named) component(input.name, "name");
    for (const key of ["uid", "resourceVersion"])
      if (
        input[key] !== undefined &&
        (typeof input[key] !== "string" ||
          !input[key] ||
          input[key].length > 512 ||
          /[\x00-\x1f\x7f]/.test(input[key]))
      )
        throw failure("validation", "Некорректный Kubernetes " + key);
    if (!this.resources.length) await this.discovery();
    const found = this.resources.find(
      (r) =>
        r.resource === input.resource &&
        r.group === group &&
        r.version === version,
    );
    if (!found)
      throw failure(
        "unsupported",
        "Ресурс/API version не обнаружен. Обновите discovery; CRD нельзя угадывать.",
      );
    if (!found.namespaced && input.namespace)
      throw failure(
        "validation",
        "Cluster-scoped resource не имеет namespace. Уберите неоднозначный scope.",
      );
    const path =
      (group ? "apis/" + component(group, "group") + "/" : "api/") +
      component(version, "version") +
      "/" +
      (found.namespaced && input.namespace
        ? "namespaces/" + component(input.namespace, "namespace") + "/"
        : "") +
      resource +
      (named ? "/" + component(input.name, "name") : "");
    if (named && found.namespaced && !input.namespace)
      throw failure("validation", "Укажите точный namespace.");
    return { path, found };
  }
  private assertIdentity(
    value: any,
    input: Record<string, any>,
    found: OpsClusterResourceType,
  ) {
    const m = value?.metadata,
      apiVersion = (found.group ? found.group + "/" : "") + found.version;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.apiVersion !== apiVersion ||
      value.kind !== found.kind ||
      !m ||
      m.name !== input.name ||
      (found.namespaced ? m.namespace !== input.namespace : !!m.namespace) ||
      typeof m.uid !== "string" ||
      !m.uid ||
      m.uid.length > 512 ||
      typeof m.resourceVersion !== "string" ||
      !m.resourceVersion ||
      m.resourceVersion.length > 512
    )
      throw failure(
        "protocol",
        "Kubernetes API вернул объект с другим kind/API/name/namespace либо без UID/resourceVersion. Действие не подготовлено и не отправлено.",
      );
  }
  async query(
    operation: string,
    input: Record<string, any>,
  ): Promise<OpsQueryResult> {
    if (operation === "cluster.discovery") {
      const d = await this.discovery();
      return this.envelope(d, {
        warnings: d.unavailable.map((v) => v.groupVersion + ": " + v.kind),
      });
    }
    if (operation === "cluster.namespaces")
      return this.query("cluster.list", {
        ...input,
        group: "",
        version: "v1",
        resource: "namespaces",
      });
    if (operation === "cluster.events")
      return this.query("cluster.list", {
        ...input,
        group: "",
        version: "v1",
        resource: "events",
      });
    const { path, found } = await this.target(
      input,
      operation === "cluster.get" || operation === "cluster.logs",
    );
    if (operation === "cluster.get") {
      const value = (await this.http.request(path)).value;
      this.assertIdentity(value, input, found);
      return this.envelope(value);
    }
    if (operation === "cluster.logs") {
      if (input.resource !== "pods")
        throw failure(
          "unsupported",
          "Логи доступны только для фактического pod/container.",
        );
      const p = new URLSearchParams({
        tailLines: String(bounded(input.tailLines, 200, 2000)),
        limitBytes: String(256 * 1024),
        timestamps: "true",
      });
      if (input.container) p.set("container", input.container);
      if (input.previous) p.set("previous", "true");
      const r = await this.http.request(path + "/log?" + p, {
        type: "text",
        maximum: 300 * 1024,
      });
      return this.envelope(
        {
          text: r.value,
          hasMore: false,
          truncated: Buffer.byteLength(r.value as string) >= 256 * 1024,
        },
        {
          warnings: [
            "Логи — ограниченный snapshot; follow/exec/port-forward пока не реализованы.",
          ],
        },
      );
    }
    const p = new URLSearchParams();
    if (input.labelSelector)
      p.set("labelSelector", String(input.labelSelector));
    if (input.fieldSelector)
      p.set("fieldSelector", String(input.fieldSelector));
    if (operation === "cluster.watch") {
      p.set("watch", "true");
      p.set(
        "timeoutSeconds",
        String(bounded(input.timeoutSeconds, 5, 15) || 5),
      );
      p.set("allowWatchBookmarks", "true");
      if (input.resourceVersion)
        p.set("resourceVersion", String(input.resourceVersion));
      const r = await this.http.request(path + "?" + p, {
        type: "text",
        headers: { Accept: "application/json" },
        maximum: 2 * 1024 ** 2,
        timeoutMs: 20000,
      });
      const events = [];
      let sourceRevision = input.resourceVersion;
      for (const line of String(r.value).split("\n").filter(Boolean)) {
        let e: any;
        try {
          e = JSON.parse(line);
        } catch {
          throw failure(
            "protocol",
            "Неполное событие Kubernetes watch. Выполните relist.",
          );
        }
        if (e.type === "ERROR")
          throw failure(
            e.object?.code === 410 ? "conflict" : "protocol",
            e.object?.code === 410
              ? "WATCH_EXPIRED: resourceVersion истёк; выполните list и продолжите с новым resourceVersion."
              : "Kubernetes watch вернул ошибку.",
            "notApplied",
            e.object?.code,
          );
        if (!["ADDED", "MODIFIED", "DELETED", "BOOKMARK"].includes(e.type))
          throw failure("protocol", "Неизвестный Kubernetes watch event.");
        sourceRevision = e.object?.metadata?.resourceVersion || sourceRevision;
        if (events.length >= 500)
          throw failure(
            "payload_too_large",
            "Слишком много watch events; выполните relist.",
          );
        events.push({ ...e, object: secretMetadata(e.object) });
      }
      return this.envelope({ events }, { sourceRevision, warnings: [] });
    }
    if (operation !== "cluster.list")
      throw failure("unsupported", "Операция Kubernetes не поддерживается.");
    p.set("limit", String(bounded(input.limit, 100, 500) || 100));
    if (input.cursor) p.set("continue", String(input.cursor));
    const r = (await this.http.request(path + "?" + p)).value;
    if (!Array.isArray(r?.items))
      throw failure("protocol", "Kubernetes не вернул resource list.");
    return this.envelope(r, {
      sourceRevision: r.metadata?.resourceVersion,
      hasMore: !!r.metadata?.continue,
      ...(r.metadata?.continue ? { cursor: r.metadata.continue } : {}),
    });
  }
  private async authorize(
    input: Record<string, any>,
    verb: string,
    subresource?: string,
  ) {
    const result = (
      await this.http.request(
        "apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
        {
          method: "POST",
          dispatched: false,
          body: {
            apiVersion: "authorization.k8s.io/v1",
            kind: "SelfSubjectAccessReview",
            spec: {
              resourceAttributes: {
                group: input.group || "",
                version: input.version || "v1",
                resource: input.resource,
                namespace: input.namespace,
                name: input.name,
                verb,
                ...(subresource ? { subresource } : {}),
              },
            },
          },
        },
      )
    ).value;
    if (result?.status?.allowed !== true)
      throw failure(
        "forbidden",
        "Kubernetes RBAC не разрешает " + verb + " для выбранного target.",
      );
  }
  async prepare(operation: string, input: Record<string, any>) {
    const { path, found } = await this.target(input, true);
    if (found.kind === "Secret")
      throw failure(
        "unsupported",
        "Для Secret доступны только metadata. Редактирование значений требует отдельного защищённого adapter.",
      );
    let current: any;
    try {
      current = (await this.http.request(path)).value;
    } catch (e: any) {
      if (e.kind !== "not_found" || operation !== "cluster.apply") throw e;
    }
    if (current) this.assertIdentity(current, input, found);
    if (input.createOnly === true && current)
      throw failure(
        "conflict",
        "Имя Kubernetes resource уже занято. Создание не изменяет существующий объект.",
      );
    if (input.uid && input.uid !== current?.metadata?.uid)
      throw failure(
        "conflict",
        "UID изменился; объект с этим именем был пересоздан.",
      );
    if (
      input.resourceVersion &&
      String(input.resourceVersion) !== current?.metadata?.resourceVersion
    )
      throw failure(
        "conflict",
        "Resource version изменился. Обновите объект и diff.",
      );
    const captured = {
      ...input,
      uid: current?.metadata?.uid,
      resourceVersion: current?.metadata?.resourceVersion,
    };
    if (operation === "cluster.delete") {
      await this.authorize(input, "delete");
      const body = {
        apiVersion: "v1",
        kind: "DeleteOptions",
        // Kubernetes decodes DELETE options from the body when present; query
        // dryRun alone does not protect this preflight from a real deletion.
        dryRun: ["All"],
        preconditions: {
          uid: captured.uid,
          resourceVersion: captured.resourceVersion,
        },
      };
      const preview = (
        await this.http.request(path + "?dryRun=All", {
          method: "DELETE",
          dispatched: false,
          body,
        })
      ).value;
      return {
        summary: "Удалить " + found.kind + " " + input.name,
        input: captured,
        preview,
      };
    }
    if (operation === "cluster.scale") {
      const replicas = bounded(input.replicas, 0, 100000);
      await this.authorize(input, "update", "scale");
      const scale = (await this.http.request(path + "/scale")).value;
      const body = {
        ...scale,
        metadata: {
          ...scale.metadata,
          resourceVersion: captured.resourceVersion,
        },
        spec: { replicas },
      };
      const preview = (
        await this.http.request(path + "/scale?dryRun=All", {
          method: "PUT",
          dispatched: false,
          body,
        })
      ).value;
      return {
        summary: "Масштабировать " + input.name + " до " + replicas,
        input: { ...captured, replicas },
        preview,
      };
    }
    if (operation === "cluster.restart") {
      if (!["Deployment", "StatefulSet", "DaemonSet"].includes(found.kind))
        throw failure(
          "unsupported",
          "Restart поддержан для Deployment/StatefulSet/DaemonSet.",
        );
      await this.authorize(input, "patch");
      const restartedAt = new Date().toISOString();
      const body = {
        metadata: { resourceVersion: captured.resourceVersion },
        spec: {
          template: {
            metadata: {
              annotations: { "kubectl.kubernetes.io/restartedAt": restartedAt },
            },
          },
        },
      };
      const preview = (
        await this.http.request(path + "?dryRun=All", {
          method: "PATCH",
          dispatched: false,
          headers: { "Content-Type": "application/merge-patch+json" },
          body,
        })
      ).value;
      return {
        summary: "Перезапустить " + input.name,
        input: { ...captured, restartedAt },
        preview,
      };
    }
    if (operation === "cluster.apply") {
      const manifest = structuredClone(input.manifest);
      if (
        !manifest ||
        typeof manifest !== "object" ||
        Array.isArray(manifest) ||
        manifest.kind !== found.kind ||
        manifest.apiVersion !==
          (input.group ? input.group + "/" : "") + (input.version || "v1") ||
        manifest.metadata?.name !== input.name ||
        (found.namespaced && manifest.metadata?.namespace !== input.namespace)
      )
        throw failure(
          "validation",
          "Manifest должен точно совпадать с выбранными API/kind/name/namespace.",
        );
      // GET metadata includes server-owned field ownership. SSA explicitly rejects
      // managedFields; retain captured UID/resourceVersion concurrency checks.
      delete manifest.metadata.managedFields;
      if (current)
        manifest.metadata = {
          ...manifest.metadata,
          uid: captured.uid,
          resourceVersion: captured.resourceVersion,
        };
      else if (manifest.metadata?.uid || manifest.metadata?.resourceVersion)
        throw failure(
          "conflict",
          "Новый объект не должен наследовать UID/resourceVersion чужого объекта.",
        );
      await this.authorize(
        input,
        input.createOnly === true ? "create" : "patch",
      );
      const preview = (
        await this.http.request(
          (input.createOnly === true
            ? path.slice(0, path.lastIndexOf("/"))
            : path) + "?dryRun=All&fieldManager=gigacode-workbench",
          {
            method: input.createOnly === true ? "POST" : "PATCH",
            dispatched: false,
            headers: {
              "Content-Type":
                input.createOnly === true
                  ? "application/json"
                  : "application/apply-patch+yaml",
            },
            body: JSON.stringify(manifest),
          },
        )
      ).value;
      return {
        summary: "Применить " + found.kind + " " + input.name,
        input: { ...captured, manifest },
        preview,
      };
    }
    throw failure("unsupported", "Операция Kubernetes не поддерживается.");
  }
  async execute(operation: string, input: Record<string, any>) {
    const { path, found } = await this.target(input, true);
    let current: any;
    try {
      current = (await this.http.request(path)).value;
    } catch (e: any) {
      if (e.kind !== "not_found" || operation !== "cluster.apply" || input.uid)
        throw e;
    }
    if (current) this.assertIdentity(current, input, found);
    if (input.createOnly === true && current)
      throw failure(
        "conflict",
        "Имя Kubernetes resource занято после preview. Создание не изменяет существующий объект.",
      );
    if (
      current &&
      (current.metadata?.uid !== input.uid ||
        current.metadata?.resourceVersion !== input.resourceVersion)
    )
      throw failure(
        "conflict",
        "Объект изменился после preview; создайте новый prepare.",
      );
    if (!current && input.uid)
      throw failure("conflict", "Подготовленный объект исчез.");
    let result: any;
    if (operation === "cluster.delete")
      result = (
        await this.http.request(path, {
          method: "DELETE",
          body: {
            apiVersion: "v1",
            kind: "DeleteOptions",
            preconditions: {
              uid: input.uid,
              resourceVersion: input.resourceVersion,
            },
          },
        })
      ).value;
    else if (operation === "cluster.apply")
      result = (
        await this.http.request(
          (input.createOnly === true
            ? path.slice(0, path.lastIndexOf("/"))
            : path) + "?fieldManager=gigacode-workbench",
          {
            method: input.createOnly === true ? "POST" : "PATCH",
            headers: {
              "Content-Type":
                input.createOnly === true
                  ? "application/json"
                  : "application/apply-patch+yaml",
            },
            body: JSON.stringify(input.manifest),
          },
        )
      ).value;
    else if (operation === "cluster.restart")
      result = (
        await this.http.request(path, {
          method: "PATCH",
          headers: { "Content-Type": "application/merge-patch+json" },
          body: {
            metadata: { resourceVersion: input.resourceVersion },
            spec: {
              template: {
                metadata: {
                  annotations: {
                    "kubectl.kubernetes.io/restartedAt": input.restartedAt,
                  },
                },
              },
            },
          },
        })
      ).value;
    else if (operation === "cluster.scale") {
      const scale = (await this.http.request(path + "/scale")).value;
      result = (
        await this.http.request(path + "/scale", {
          method: "PUT",
          body: {
            ...scale,
            metadata: {
              ...scale.metadata,
              resourceVersion: input.resourceVersion,
            },
            spec: { replicas: input.replicas },
          },
        })
      ).value;
    } else
      throw failure("unsupported", "Операция Kubernetes не поддерживается.");
    return {
      status: "accepted",
      remoteId: result.metadata?.uid || input.uid,
      data: secretMetadata(result),
    };
  }
  async reconcile(
    operation: string,
    input: Record<string, any>,
    remoteId?: string,
    data?: any,
  ) {
    const { path, found } = await this.target(input, true);
    let current: any;
    try {
      current = (await this.http.request(path)).value;
    } catch (e: any) {
      if (e.kind !== "not_found") throw e;
      return operation === "cluster.delete"
        ? {
            status: "confirmed",
            remoteId,
            data: { deleted: true, uid: input.uid },
          }
        : {
            status: "unknown",
            remoteId,
            data: {
              reason: "Объект отсутствует; исход изменения не подтверждён.",
            },
          };
    }
    this.assertIdentity(current, input, found);
    if (
      (remoteId || input.uid) &&
      current.metadata?.uid !== (remoteId || input.uid)
    )
      return operation === "cluster.delete"
        ? {
            status: "confirmed",
            remoteId,
            data: {
              deleted: true,
              uid: input.uid,
              replacementUid: current.metadata?.uid,
            },
          }
        : {
            status: "unknown",
            remoteId,
            data: {
              reason:
                "Имя принадлежит другому UID; не применять старое действие.",
            },
          };
    if (operation === "cluster.delete")
      return {
        status: current.metadata?.deletionTimestamp ? "running" : "unknown",
        remoteId,
        data: secretMetadata(current),
      };
    if (
      operation === "cluster.scale" &&
      current.spec?.replicas !== input.replicas
    )
      return { status: "unknown", remoteId, data: secretMetadata(current) };
    if (
      operation === "cluster.restart" &&
      current.spec?.template?.metadata?.annotations?.[
        "kubectl.kubernetes.io/restartedAt"
      ] !== input.restartedAt
    )
      return { status: "unknown", remoteId, data: secretMetadata(current) };
    // A resourceVersion change alone never proves our desired mutation. Compare
    // the exact supplied fields, allowing server defaults outside that subset.
    if (operation === "cluster.apply") {
      const desired = {
        ...input.manifest,
        metadata: { ...input.manifest?.metadata },
      };
      delete desired.metadata.resourceVersion;
      delete desired.metadata.uid;
      delete desired.metadata.managedFields;
      delete desired.status;
      if (!desiredMatches(desired, current))
        return {
          status: "unknown",
          remoteId,
          data: {
            reason:
              "Apply desired fields не совпали с текущим объектом; resourceVersion сам по себе не доказывает эффект.",
            current: secretMetadata(current),
          },
        };
    }
    return {
      status: "confirmed",
      remoteId: current.metadata?.uid,
      data: secretMetadata(current),
    };
  }
}
