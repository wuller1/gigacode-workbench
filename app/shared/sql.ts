export type SqlStatement = { text: string; start: number; end: number };
/** PostgreSQL lexer: dollar bodies, quoted identifiers, nested comments and E strings. */
export function statements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let start = 0,
    i = 0;
  let quote = "",
    dollar = "",
    block = 0,
    line = false,
    escape = false;
  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const left = raw.search(/\S/);
    if (left >= 0 && raw.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim())
      out.push({ text: raw.trim(), start: start + left, end });
    start = end;
  };
  while (i < sql.length) {
    const c = sql[i],
      n = sql[i + 1];
    if (line) {
      if (c === "\n") line = false;
      i++;
      continue;
    }
    if (block) {
      if (c === "/" && n === "*") {
        block++;
        i += 2;
      } else if (c === "*" && n === "/") {
        block--;
        i += 2;
      } else i++;
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length;
        dollar = "";
      } else i++;
      continue;
    }
    if (quote) {
      if (escape && c === "\\") i += 2;
      else if (c === quote && n === quote) i += 2;
      else {
        if (c === quote) quote = "";
        i++;
      }
      continue;
    }
    if (c === "-" && n === "-") {
      line = true;
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      block = 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      escape =
        c === "'" && /(?:^|[^\w$])[eE]$/.test(sql.slice(Math.max(0, i - 2), i));
      i++;
      continue;
    }
    if (c === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
      if (match) {
        dollar = match[0];
        i += dollar.length;
        continue;
      }
    }
    if (c === ";") {
      i++;
      push(i);
    } else i++;
  }
  if (quote || dollar || block)
    throw new Error("Незакрытая строка, тело функции или комментарий SQL");
  push(sql.length);
  return out;
}
export function statementAt(sql: string, offset: number): string {
  const all = statements(sql);
  return (
    (
      all.find((s) => offset >= s.start && offset <= s.end) ||
      all.find((s) => s.start > offset) ||
      all.at(-1)
    )?.text || ""
  );
}
export function identifier(value: string): string {
  if (!value || value.includes("\0") || BufferByteLength(value) > 63)
    throw new Error("Некорректный идентификатор PostgreSQL");
  return '"' + value.replaceAll('"', '""') + '"';
}
function BufferByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}
export function qualified(schema: string, name: string) {
  return `${identifier(schema)}.${identifier(name)}`;
}
export function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Нечисловое значение");
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (text.includes("\0"))
    throw new Error("NUL не поддерживается PostgreSQL text");
  return "E'" + text.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
}
