import { createReadStream } from "node:fs";
/** Streaming PostgreSQL lexical splitter. Memory is bounded by one 2 MiB statement. */
export async function* sqlFile(
  file: string,
  signal: AbortSignal,
  onBytes?: (bytes: Buffer) => void,
): AsyncGenerator<string> {
  let pending = "",
    text = "",
    quote = "",
    dollar = "",
    block = 0,
    line = false,
    escape = false;
  async function* consume(final: boolean): AsyncGenerator<string> {
    let i = 0;
    while (i < pending.length) {
      signal.throwIfAborted();
      const c = pending[i],
        n = pending[i + 1];
      let take = 1;
      if (line) {
        if (c === "\n") line = false;
      } else if (block) {
        if (!n && !final && (c === "/" || c === "*")) break;
        if (c === "/" && n === "*") {
          block++;
          take = 2;
        } else if (c === "*" && n === "/") {
          block--;
          take = 2;
        }
      } else if (dollar) {
        if (
          i + dollar.length > pending.length &&
          !final &&
          dollar.startsWith(pending.slice(i))
        )
          break;
        if (pending.startsWith(dollar, i)) {
          take = dollar.length;
          dollar = "";
        }
      } else if (quote) {
        if (!n && !final && (c === quote || (escape && c === "\\"))) break;
        if (escape && c === "\\") take = 2;
        else if (c === quote && n === quote) take = 2;
        else if (c === quote) quote = "";
      } else {
        if (!n && !final && ["-", "/", "$"].includes(c)) break;
        if (c === "-" && n === "-") {
          line = true;
          take = 2;
        } else if (c === "/" && n === "*") {
          block = 1;
          take = 2;
        } else if (c === "'" || c === '"') {
          quote = c;
          escape = c === "'" && /(?:^|[^\w$])[eE]$/.test(text.slice(-2));
        } else if (c === "$") {
          const rest = pending.slice(i),
            m = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(rest);
          if (m) {
            dollar = m[0];
            take = dollar.length;
          } else if (!final && /^\$[A-Za-z_][A-Za-z_0-9]*$/.test(rest)) {
            if (rest.length > 256)
              throw new Error("Dollar tag SQL длиннее 256 символов");
            break;
          }
        } else if (c === ";") {
          text += ";";
          i++;
          if (text.trim()) yield text.trim();
          text = "";
          continue;
        }
      }
      text += pending.slice(i, i + take);
      i += take;
      if (text.length > 2 * 1024 ** 2)
        throw new Error(
          "Один statement SQL превышает 2 MiB; разбейте INSERT на меньшие statement или используйте COPY CSV",
        );
    }
    pending = pending.slice(i);
  }
  const stream = createReadStream(file, { highWaterMark: 64 * 1024, signal }),
    decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of stream) {
    onBytes?.(chunk);
    pending += decoder.decode(chunk, { stream: true });
    yield* consume(false);
  }
  pending += decoder.decode();
  yield* consume(true);
  if (quote || dollar || block)
    throw new Error(
      "Незакрытая строка, тело функции или комментарий в SQL-файле",
    );
  if (text.trim()) yield text.trim();
}
export function sqlKeyword(sql: string): string {
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    break;
  }
  return /^[A-Za-z]+/.exec(sql.slice(i))?.[0].toUpperCase() || sql[i] || "";
}
