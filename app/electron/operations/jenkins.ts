import type {
  OpsJenkinsJob,
  OpsJenkinsParameter,
  OpsQueryResult,
  OpsValue,
} from "../../shared/operations";
import { JenkinsCatalog } from "./catalog";
import { JenkinsLogs } from "./jenkins-logs";
import { OpsHttp } from "./http";
import { failure } from "./errors";
const jobFields =
  "name,fullName,url,_class,color,buildable,disabled,inQueue,lastBuild[number,result,building,timestamp,duration]";
function jobId(input: Record<string, any>): string {
  const id = input.jobId ?? input.fullName;
  const ambiguous = (part: string) => {
    let decoded = part;
    for (let i = 0; i < 3; i++) {
      if (
        decoded.trim() === "." ||
        decoded.trim() === ".." ||
        decoded.includes("\\") ||
        /^[a-z][a-z0-9+.-]*:/i.test(decoded)
      )
        return true;
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return false;
  };
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 2000 ||
    id.split("/").some((part: string) => !part || ambiguous(part)) ||
    /[\\?#\x00-\x1f\x7f]/.test(id)
  )
    throw failure("validation", "Нужен канонический полный путь Jenkins job.");
  return id;
}
const route = (id: string) =>
  id
    .split("/")
    .map((part) => "job/" + encodeURIComponent(part))
    .join("/") + "/";
function integer(value: unknown, fallback: number, maximum = 500): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > maximum
  )
    throw failure("validation", "Неверный числовой параметр Jenkins.");
  return Number(value);
}
function parameter(p: any): OpsJenkinsParameter {
  const type = String(p.type || p._class?.split(".").at(-1) || "unknown");
  const supported =
    /^(StringParameterDefinition|TextParameterDefinition|BooleanParameterDefinition|ChoiceParameterDefinition)$/.test(
      type,
    );
  return {
    name: String(p.name || ""),
    type,
    description: String(p.description || "").slice(0, 4000),
    supported,
    ...(!/password|secret|credential/i.test(type) &&
    p.defaultParameterValue?.value !== undefined
      ? { defaultValue: p.defaultParameterValue.value }
      : {}),
    ...(Array.isArray(p.choices)
      ? { choices: p.choices.map(String).slice(0, 1000) }
      : {}),
  };
}
function job(raw: any, parent = ""): OpsJenkinsJob {
  if (!raw || typeof raw.name !== "string")
    throw failure("protocol", "Некорректная Jenkins job.");
  const fullName = raw.fullName || (parent ? parent + "/" : "") + raw.name;
  try {
    jobId({ jobId: fullName });
  } catch {
    throw failure("protocol", "Jenkins вернул некорректный полный путь job.");
  }
  if (parent && fullName !== parent + "/" + raw.name)
    throw failure(
      "protocol",
      "Jenkins вернул job за пределами выбранной папки.",
    );
  const kind = String(raw._class || "unknown");
  const folder = /Folder|MultiBranchProject|OrganizationFolder/.test(kind);
  return {
    id: fullName,
    fullName,
    name: raw.name,
    url: String(raw.url || ""),
    kind,
    folder,
    runnable: !folder && raw.buildable !== false && !raw.disabled,
    disabled: !!raw.disabled,
    inQueue: !!raw.inQueue,
    building: /_anime$/.test(raw.color || ""),
    ...(raw.lastBuild ? { lastBuild: raw.lastBuild } : {}),
  };
}
export class JenkinsApi {
  private catalog: JenkinsCatalog;
  private logPages: JenkinsLogs;
  constructor(private http: OpsHttp) {
    this.logPages = new JenkinsLogs(http);
    this.catalog = new JenkinsCatalog(async (folder, offset, limit) => {
      const tree = `jobs[${jobFields}]{${offset},${offset + limit + 1}}`;
      const response = await this.http.request(
        (folder ? route(folder) : "") +
          "api/json?tree=" +
          encodeURIComponent(tree),
      );
      if (
        !Array.isArray(response.value?.jobs) ||
        response.value.jobs.length > limit + 1
      )
        throw failure(
          "protocol",
          "Jenkins не вернул ограниченную страницу jobs catalog.",
        );
      return response.value.jobs.map((raw: any) => job(raw, folder));
    });
  }
  async dispose() {
    await this.logPages.dispose();
  }
  private envelope(
    data: any,
    extras: Record<string, unknown> = {},
  ): OpsQueryResult {
    return {
      data,
      observedAt: new Date().toISOString(),
      warnings: [],
      ...extras,
    };
  }
  async probe() {
    const r = await this.http.request("api/json?tree=nodeName,mode");
    return {
      name: "Jenkins",
      version: r.headers["x-jenkins"],
      capabilities: [
        "ci.jobs",
        "ci.job",
        "ci.queue",
        "ci.run",
        "ci.logs",
        "ci.tests",
        "ci.stages",
        "ci.artifacts",
        "ci.trigger",
        "ci.queueCancel",
        "ci.stop",
      ],
      data: r.value,
    };
  }
  async query(
    operation: string,
    input: Record<string, any>,
  ): Promise<OpsQueryResult<any>> {
    if (operation === "ci.jobs") {
      const folder = input.folder ? jobId({ jobId: input.folder }) : "";
      return this.catalog.query({ ...input, folder });
    }
    if (operation === "ci.queue") {
      const r = await this.http.request(
        "queue/api/json?tree=items[id,why,blocked,buildable,cancelled,inQueueSince,task[name,fullName,url],executable[number,url]]",
      );
      if (!Array.isArray(r.value?.items))
        throw failure("protocol", "Jenkins не вернул queue.");
      if (r.value.items.length > 1000)
        throw failure(
          "payload_too_large",
          "Очередь Jenkins превышает1000 элементов. Полный список не помещается в текущий предел; ответ не усечён молча.",
        );
      return this.envelope({ items: r.value.items });
    }
    if (operation === "ci.job") {
      const id = jobId(input);
      const r = await this.http.request(
        route(id) +
          "api/json?tree=" +
          encodeURIComponent(
            jobFields +
              ",description,property[parameterDefinitions[name,type,_class,description,choices,defaultParameterValue[value]]],builds[number,url,result,building,timestamp,duration,queueId]{0,20}",
          ),
      );
      const parameters = (r.value.property || [])
        .flatMap((p: any) => p.parameterDefinitions || [])
        .map(parameter);
      if (job(r.value).fullName !== id)
        throw failure(
          "protocol",
          "Jenkins вернул другую canonical job identity; ответ не применяется.",
        );
      return this.envelope({
        ...job(r.value),
        parameters,
        builds: r.value.builds || [],
        description: String(r.value.description || "").slice(0, 8000),
      });
    }
    if (operation === "ci.run" && input.queueId !== undefined) {
      const id = integer(input.queueId, 0, Number.MAX_SAFE_INTEGER);
      const r = await this.http.request(`queue/item/${id}/api/json`);
      return this.envelope(r.value);
    }
    const id = jobId(input),
      number =
        input.number === undefined
          ? "lastBuild"
          : String(integer(input.number, 0, Number.MAX_SAFE_INTEGER));
    if (number === "0")
      throw failure("validation", "Jenkins build number начинается с1.");
    const build = route(id) + number + "/";
    if (operation === "ci.run") {
      const r = await this.http.request(
        build +
          "api/json?tree=number,url,result,building,timestamp,duration,queueId,estimatedDuration,description",
      );
      return this.envelope(r.value);
    }
    if (operation === "ci.logs") {
      const actual =
        number === "lastBuild"
          ? String(
              ((await this.query("ci.run", { jobId: id })).data as any)?.number,
            )
          : number;
      if (!/^\d+$/.test(actual) || Number(actual) < 1)
        throw failure(
          "protocol",
          "Jenkins не вернул фактический build number для логов.",
        );
      return this.envelope(
        await this.logPages.read(
          id + ":" + actual,
          route(id) + actual + "/",
          input.cursor === undefined ? undefined : String(input.cursor),
        ),
      );
    }
    if (operation === "ci.artifacts") {
      const r = await this.http.request(
        build + "api/json?tree=artifacts[fileName,relativePath,displayPath]",
      );
      return this.envelope({ artifacts: r.value.artifacts || [] });
    }
    if (operation === "ci.tests" || operation === "ci.stages") {
      try {
        const r = await this.http.request(
          build +
            (operation === "ci.tests"
              ? "testReport/api/json"
              : "wfapi/describe"),
        );
        return this.envelope(r.value);
      } catch (e: any) {
        if (e.kind === "not_found")
          throw failure(
            "unsupported",
            operation === "ci.tests"
              ? "JUnit/test-report API этой сборки недоступен."
              : "Pipeline stage API/plugin не обнаружен.",
          );
        throw e;
      }
    }
    throw failure("unsupported", "Операция Jenkins не поддерживается.");
  }
  async prepare(operation: string, input: Record<string, any>) {
    if (operation === "ci.trigger") {
      const info: any = (await this.query("ci.job", input)).data;
      if (!info.runnable)
        throw failure(
          "forbidden",
          "Job отключена или не допускает сборку; папки и multibranch parent не являются runnable jobs.",
        );
      const parameters = input.parameters || {};
      if (typeof parameters !== "object" || Array.isArray(parameters))
        throw failure("validation", "Нужен объект параметров Jenkins.");
      for (const [name, value] of Object.entries(parameters)) {
        const p = info.parameters.find(
          (p: OpsJenkinsParameter) => p.name === name,
        );
        if (!p || !p.supported)
          throw failure(
            "unsupported",
            "Параметр Jenkins не поддерживается: " + name,
          );
        if (
          /Boolean/.test(p.type)
            ? typeof value !== "boolean"
            : typeof value !== "string"
        )
          throw failure("validation", "Неверный тип параметра: " + name);
        if (p.choices && !p.choices.includes(value))
          throw failure("validation", "Недопустимое значение choice: " + name);
      }
      return {
        summary: "Запустить " + info.fullName,
        preview: { jobId: info.fullName, parameters },
        input: {
          jobId: info.fullName,
          parameters,
          parameterized: info.parameters.length > 0,
        },
      };
    }
    if (operation === "ci.queueCancel") {
      const queueId = integer(input.queueId, 0, Number.MAX_SAFE_INTEGER);
      if (!queueId) throw failure("validation", "Нужен queue item ID.");
      const q: any = (await this.query("ci.run", { queueId })).data;
      if (q.executable)
        throw failure(
          "conflict",
          "Queue item уже стал сборкой. Остановите фактический build number.",
        );
      return {
        summary: "Отменить очередь #" + queueId,
        preview: q,
        input: { queueId },
      };
    }
    if (operation === "ci.stop") {
      const run: any = (await this.query("ci.run", input)).data;
      if (!run.building) throw failure("conflict", "Сборка уже завершена.");
      return {
        summary: "Остановить " + jobId(input) + " #" + run.number,
        preview: run,
        input: { jobId: jobId(input), number: run.number },
      };
    }
    throw failure("unsupported", "Операция Jenkins не поддерживается.");
  }
  private async post(path: string, body?: string) {
    let headers: Record<string, string> = {};
    try {
      const crumb = await this.http.request("crumbIssuer/api/json");
      if (
        typeof crumb.value?.crumbRequestField === "string" &&
        typeof crumb.value?.crumb === "string"
      )
        headers[crumb.value.crumbRequestField] = crumb.value.crumb;
    } catch (e: any) {
      if (!["not_found", "forbidden"].includes(e.kind)) throw e;
    }
    return this.http.request(path, {
      method: "POST",
      body,
      type: "empty",
      headers: {
        ...headers,
        ...(body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      acceptRedirect: true,
    });
  }
  async execute(operation: string, input: Record<string, any>) {
    if (operation === "ci.trigger") {
      const id = jobId(input),
        parameters = input.parameters || {};
      const body = new URLSearchParams(
        Object.entries(parameters).map(([k, v]) => [k, String(v)]),
      ).toString();
      const r = await this.post(
        route(id) +
          (input.parameterized || Object.keys(parameters).length
            ? "buildWithParameters"
            : "build"),
        body || undefined,
      );
      const location = r.headers.location;
      const url = location
        ? new URL(location, this.http.base.href.replace(/\/$/, "") + "/")
        : undefined;
      const queuePrefix =
        this.http.base.pathname.replace(/\/$/, "") + "/queue/item/";
      const match =
        url?.origin === this.http.base.origin &&
        !url.search &&
        !url.hash &&
        url.pathname.startsWith(queuePrefix) &&
        /^(\d+)\/?$/.exec(url.pathname.slice(queuePrefix.length));
      if (!match)
        throw failure(
          "protocol",
          "Jenkins принял запрос без подтверждённого queue item. Не повторяйте запуск; сверьте очередь и builds.",
          "unknown",
        );
      return {
        status: "accepted",
        remoteId: match[1],
        data: { jobId: id, queueId: Number(match[1]) },
      };
    }
    if (operation === "ci.queueCancel") {
      await this.post(
        "queue/cancelItem?id=" +
          integer(input.queueId, 0, Number.MAX_SAFE_INTEGER),
      );
      return {
        status: "accepted",
        remoteId: String(input.queueId),
        data: { queueId: input.queueId },
      };
    }
    if (operation === "ci.stop") {
      await this.post(
        route(jobId(input)) +
          integer(input.number, 0, Number.MAX_SAFE_INTEGER) +
          "/stop",
      );
      return {
        status: "accepted",
        remoteId: String(input.number),
        data: { jobId: jobId(input), number: input.number },
      };
    }
    throw failure("unsupported", "Операция Jenkins не поддерживается.");
  }
  async reconcile(
    operation: string,
    input: Record<string, any>,
    remoteId?: string,
    data?: any,
  ) {
    if (operation === "ci.trigger" || operation === "ci.queueCancel") {
      const queueId = remoteId || data?.queueId;
      if (!queueId)
        return {
          status: "unknown",
          data: {
            reason:
              "Queue receipt потерян. Проверьте queue/job builds; автоматический повтор отключён.",
          },
        };
      try {
        const q: any = (
          await this.query("ci.run", { queueId: Number(queueId) })
        ).data;
        if (
          q.id !== Number(queueId) ||
          (input.jobId &&
            q.task?.fullName !== undefined &&
            q.task.fullName !== input.jobId)
        )
          return {
            status: "unknown",
            remoteId: String(queueId),
            data: {
              reason:
                "Queue item/job identity не совпадает с captured receipt; повтор запрещён.",
            },
          };
        if (q.cancelled) return { status: "cancelled", data: q };
        if (q.executable) {
          const run: any = (
            await this.query("ci.run", {
              jobId: input.jobId || q.task?.fullName,
              number: q.executable.number,
            })
          ).data;
          if (
            run.number !== q.executable.number ||
            String(run.queueId) !== String(queueId)
          )
            return {
              status: "unknown",
              remoteId: String(queueId),
              data: {
                reason:
                  "Build number/queueId не подтверждают связь с captured queue; повтор запрещён.",
              },
            };
          if (operation === "ci.queueCancel")
            return {
              status: "failed",
              remoteId: String(queueId),
              data: {
                queueId: Number(queueId),
                ...run,
                reason:
                  "Queue item стал сборкой; отмена очереди не остановила build.",
              },
            };
          return {
            status: run.building ? "running" : "confirmed",
            remoteId: String(queueId),
            data: { queueId: Number(queueId), ...run },
          };
        }
        return { status: "accepted", remoteId: String(queueId), data: q };
      } catch (e: any) {
        if (e.kind !== "not_found") throw e;
        if (operation === "ci.queueCancel")
          return {
            status: "unknown",
            data: {
              queueId: Number(queueId),
              reason:
                "Queue item больше не доступен; отсутствие не доказывает отмену.",
            },
          };
        const info: any = (await this.query("ci.job", input)).data;
        const found = info.builds.find(
          (b: any) => String(b.queueId) === String(queueId),
        );
        if (found)
          return {
            status: found.building ? "running" : "confirmed",
            remoteId: String(queueId),
            data: { queueId: Number(queueId), ...found },
          };
        return {
          status: "unknown",
          remoteId: String(queueId),
          data: {
            reason:
              "Queue item истёк; соответствующий queueId отсутствует в ограниченной истории builds.",
          },
        };
      }
    }
    if (operation === "ci.stop") {
      const run: any = (await this.query("ci.run", input)).data;
      return {
        status: run.building ? "running" : "confirmed",
        data: run,
        remoteId: String(run.number),
      };
    }
    throw failure("unsupported", "Сверка Jenkins не поддерживается.");
  }
}
