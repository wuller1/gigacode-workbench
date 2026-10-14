import { Agent, fetch } from "undici";
import type { OpsConnection } from "../../shared/operations";
import { trustedCAs } from "../database/tls";
import { OpsFailure, failure, normalizeError, redact } from "./errors";
export function checkedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw failure("validation", "Нужен корректный URL подключения.");
  }
  if (url.username || url.password || url.hash || url.search)
    throw failure(
      "validation",
      "URL подключения не должен содержать credentials, query или fragment.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw failure(
      "validation",
      "Operations требует HTTPS; HTTP допустим только для loopback.",
    );
  return url;
}
export class OpsHttp {
  private agent: Agent;
  readonly base: URL;
  constructor(
    readonly connection: OpsConnection,
    private secret?: string,
  ) {
    this.base = checkedUrl(connection.url || "");
    this.agent = new Agent({
      connect: { ca: trustedCAs(connection.ca), rejectUnauthorized: true },
    });
  }
  redactionPatterns(): string[] {
    return [
      ...new Set(
        [
          this.secret,
          this.secret && this.connection.username
            ? this.connection.username + ":" + this.secret
            : undefined,
        ]
          .filter((v): v is string => !!v)
          .flatMap((v) => [
            v,
            encodeURIComponent(v),
            Buffer.from(v).toString("base64"),
          ]),
      ),
    ].sort((a, b) => b.length - a.length);
  }
  redactText(text: string): string {
    for (const pattern of this.redactionPatterns())
      text = text.split(pattern).join("[redacted]");
    return redact(text);
  }
  async request(
    route: string,
    options: {
      method?: string;
      body?: unknown;
      type?: "json" | "text" | "empty";
      headers?: Record<string, string>;
      maximum?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
      dispatched?: boolean;
      acceptRedirect?: boolean;
      truncateText?: boolean;
      textSink?: (chunk: Uint8Array) => Promise<void>;
    } = {},
  ): Promise<any> {
    const method = options.method || "GET",
      dispatched = options.dispatched ?? !["GET", "HEAD"].includes(method);
    if (
      typeof route !== "string" ||
      /^[a-z][a-z0-9+.-]*:/i.test(route) ||
      route.startsWith("//") ||
      /[\\#\x00-\x1f\x7f]/.test(route)
    )
      throw failure(
        "validation",
        "Operations API route должен оставаться внутри выбранного target.",
      );
    const relative = route.replace(/^\//, ""),
      path = relative.split("?", 1)[0];
    if (path.includes("//"))
      throw failure(
        "validation",
        "Operations API route содержит неоднозначные разделители.",
      );
    const url = new URL(this.base.href.replace(/\/$/, "") + "/" + relative);
    if (
      url.origin !== this.base.origin ||
      url.pathname !== this.base.pathname.replace(/\/$/, "") + "/" + path
    )
      throw failure(
        "validation",
        "URL normalization изменила Operations target. Запрос не отправлен.",
      );
    const headers: Record<string, string> = {
      Accept: options.type === "text" ? "text/plain" : "application/json",
      ...options.headers,
    };
    if (this.secret) {
      if (this.connection.kind === "jenkins" && this.connection.username)
        headers.Authorization =
          "Basic " +
          Buffer.from(this.connection.username + ":" + this.secret).toString(
            "base64",
          );
      else
        headers[this.connection.secretHeader || "Authorization"] =
          (this.connection.secretPrefix ?? "Bearer ") + this.secret;
    }
    if (options.body !== undefined)
      headers["Content-Type"] ||= "application/json";
    try {
      const timeout = AbortSignal.timeout(options.timeoutMs || 15000);
      const response = await fetch(url, {
        method,
        body:
          options.body === undefined
            ? undefined
            : typeof options.body === "string"
              ? options.body
              : JSON.stringify(options.body),
        headers,
        dispatcher: this.agent,
        redirect: "manual",
        signal: options.signal
          ? AbortSignal.any([options.signal, timeout])
          : timeout,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (
          options.acceptRedirect &&
          location &&
          new URL(location, url).origin === this.base.origin
        )
          return {
            value: null,
            headers: Object.fromEntries(response.headers),
            status: response.status,
          };
        throw failure(
          "protocol",
          "Operations получил redirect. Укажите конечный адрес; credentials не пересылаются на другую цель.",
          dispatched ? "unknown" : "notApplied",
          response.status,
        );
      }
      const status = response.status;
      if (!response.ok) {
        // Status and Retry-After are authoritative even for an oversized, chunked
        // or invalid-UTF8 gateway body. Never buffer or expose an error document.
        await response.body?.cancel().catch(() => {});
        const kind =
          status === 401
            ? "unauthenticated"
            : status === 403
              ? "forbidden"
              : status === 404
                ? "not_found"
                : status === 409 || status === 410
                  ? "conflict"
                  : status === 413
                    ? "payload_too_large"
                    : status === 429
                      ? "rate_limited"
                      : status === 400 || status === 422
                        ? "validation"
                        : "protocol";
        const retry = response.headers.get("retry-after"),
          retryAfterMs = retry
            ? /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Math.max(0, Date.parse(retry) - Date.now())
            : undefined;
        throw new OpsFailure({
          kind,
          status,
          outcome:
            status < 500 ? "notApplied" : dispatched ? "unknown" : "notApplied",
          message: `Operations HTTP ${status}: ${kind}. ${/text\/html/i.test(response.headers.get("content-type") || "") ? "Сервер вернул HTML, а не API-ответ." : "Проверьте target, credentials и права доступа."}`,
          ...(Number.isFinite(retryAfterMs)
            ? { retryAfterMs: Math.min(retryAfterMs!, 3600000) }
            : {}),
        });
      }
      const maximum = options.maximum || 4 * 1024 ** 2;
      if (
        response.ok &&
        options.textSink &&
        /text\/html/i.test(response.headers.get("content-type") || "")
      ) {
        await response.body?.cancel();
        throw failure(
          "protocol",
          "Вместо логов получен HTML. Проверьте API и вход.",
        );
      }
      if (
        !options.truncateText &&
        Number(response.headers.get("content-length")) > maximum
      ) {
        await response.body?.cancel();
        throw failure(
          "payload_too_large",
          "Ответ Operations превышает предел. Уменьшите страницу.",
          dispatched ? "unknown" : "notApplied",
          response.status,
        );
      }
      const chunks: Uint8Array[] = [];
      let size = 0,
        truncated = false;
      for await (const chunk of response.body || []) {
        if (size + chunk.byteLength > maximum) {
          if (options.truncateText && options.type === "text" && response.ok) {
            chunks.push(chunk.subarray(0, maximum - size));
            size = maximum;
            truncated = true;
            break;
          }
          throw failure(
            "payload_too_large",
            "Ответ Operations превышает предел. Уменьшите страницу.",
            dispatched ? "unknown" : "notApplied",
            response.status,
          );
        }
        size += chunk.byteLength;
        if (options.textSink && response.ok) await options.textSink(chunk);
        else chunks.push(chunk);
      }
      if (options.textSink && response.ok)
        return {
          value: null,
          bytes: size,
          headers: Object.fromEntries(response.headers),
          status: response.status,
        };
      let body: string;
      try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
          { stream: truncated },
        );
      } catch {
        throw failure(
          "protocol",
          "API вернул некорректный UTF-8.",
          dispatched ? "unknown" : "notApplied",
        );
      }
      if (options.type === "empty")
        return {
          value: null,
          headers: Object.fromEntries(response.headers),
          status,
        };
      if (options.type === "text") {
        if (
          /text\/html/i.test(response.headers.get("content-type") || "") ||
          /^\s*<!doctype html/i.test(body)
        )
          throw failure(
            "protocol",
            "Вместо логов получен HTML. Проверьте API и вход.",
            dispatched ? "unknown" : "notApplied",
          );
        return {
          value: this.redactText(body),
          bytes: Buffer.byteLength(body),
          truncated,
          headers: Object.fromEntries(response.headers),
          status,
        };
      }
      let value: any;
      try {
        value = body ? JSON.parse(body) : null;
      } catch {
        throw failure(
          "protocol",
          "Operations вернул не JSON. HTML страницы входа не являются пустым каталогом.",
          dispatched ? "unknown" : "notApplied",
        );
      }
      return { value, headers: Object.fromEntries(response.headers), status };
    } catch (error) {
      if (error instanceof OpsFailure) throw error;
      throw new OpsFailure(normalizeError(error, dispatched));
    }
  }
  async close() {
    await this.agent.close();
  }
}
