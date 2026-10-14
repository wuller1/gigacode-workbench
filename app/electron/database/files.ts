import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import yauzl, { type ZipFile, type Entry } from "yauzl";
import yazl from "yazl";
import { SaxesParser } from "saxes";
import iconv from "iconv-lite";
import { identifier, literal, qualified } from "../../shared/sql";

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "\\N";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return '"' + text.replaceAll('"', '""') + '"';
}
const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/_x[0-9a-f]{4}_/gi, (s) => "_x005F_" + s.slice(1))
    .replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
      (c) => "_x" + c.charCodeAt(0).toString(16).padStart(4, "0") + "_",
    )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function letters(index: number) {
  let out = "";
  do {
    out = String.fromCharCode(65 + (index % 26)) + out;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return out;
}
/** Inline strings preserve NUMERIC/BIGINT and never create formula cells from user data. */
export async function writeXlsx(
  destination: string,
  fields: string[],
  rows: AsyncIterable<unknown[]>,
  signal: AbortSignal,
  progress: (rows: number, bytes: number) => void,
) {
  if (fields.length > 16384)
    throw new Error("Excel поддерживает до 16384 столбцов");
  const zip = new yazl.ZipFile();
  zip.on("error", (e) => (zip.outputStream as Readable).destroy(e));
  const add = (name: string, text: string) =>
    zip.addBuffer(Buffer.from(text), name);
  add(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  add(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    "xl/workbook.xml",
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Результат" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  async function* sheet() {
    yield '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>';
    let n = 0,
      bytes = 0;
    const rowXml = (row: unknown[]) => {
      n++;
      if (n > 1048576)
        throw new Error(
          "Достигнут лимит Excel 1 048 576 строк. Используйте CSV/SQL или экспорт по частям.",
        );
      return `<row r="${n}">${row.map((v, i) => (v == null ? `<c r="${letters(i)}${n}"/>` : `<c r="${letters(i)}${n}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`)).join("")}</row>`;
    };
    yield rowXml(fields);
    for await (const row of rows) {
      signal.throwIfAborted();
      const text = rowXml(row);
      bytes += Buffer.byteLength(text);
      if (n % 256 === 0) progress(n - 1, bytes);
      yield text;
    }
    progress(n - 1, bytes);
    yield "</sheetData></worksheet>";
  }
  zip.addReadStream(
    Readable.from(sheet(), { objectMode: false, highWaterMark: 64 * 1024 }),
    "xl/worksheets/sheet1.xml",
  );
  zip.end();
  await pipeline(
    zip.outputStream,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    { signal },
  );
}
async function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (e, z) => (e ? reject(e) : resolve(z!)),
    ),
  );
}
async function entries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = [],
      seen = new Set<string>();
    let bytes = 0;
    zip.on("entry", (e) => {
      bytes += e.uncompressedSize;
      if (
        seen.has(e.fileName) ||
        out.length >= 10000 ||
        bytes > 8 * 1024 ** 3 ||
        e.uncompressedSize > 4 * 1024 ** 3
      ) {
        reject(
          new Error(
            "XLSX содержит повторённые entries или превышает лимит распаковки",
          ),
        );
        zip.close();
        return;
      }
      seen.add(e.fileName);
      out.push(e);
      zip.readEntry();
    });
    zip.once("end", () => resolve(out));
    zip.once("error", reject);
    zip.readEntry();
  });
}
async function zipStream(zip: ZipFile, e: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) =>
    zip.openReadStream(e, (error, stream) =>
      error ? reject(error) : resolve(stream!),
    ),
  );
}
const excelText = (value: string) =>
  value.replace(/_x([0-9a-f]{4})_/gi, (_whole, code) =>
    String.fromCharCode(parseInt(code, 16)),
  );
function parser() {
  const p = new SaxesParser({ xmlns: false });
  p.on("doctype", () => {
    throw new Error("DTD в XLSX запрещён");
  });
  return p;
}
const local = (name: string) => name.split(":").at(-1)!;
async function parseEntry(
  zip: ZipFile,
  entry: Entry,
  onOpen: (tag: any) => void,
  signal: AbortSignal,
) {
  if (entry.uncompressedSize > 2 * 1024 ** 2)
    throw new Error("Метаданные XLSX превышают 2 MiB");
  const p = parser(),
    decoder = iconv.getDecoder("utf8");
  p.on("opentag", onOpen);
  for await (const chunk of (await zipStream(zip, entry)) as any) {
    signal.throwIfAborted();
    p.write(decoder.write(chunk));
  }
  p.write(decoder.end() || "");
  p.close();
}
/** Shared strings are indexed on disk; worksheet rows are streamed. No XLSX extraction or formula evaluation. */
export async function* readXlsx(
  file: string,
  temporaryDirectory: string,
  signal: AbortSignal,
  sheetIndex = 0,
): AsyncGenerator<(string | null)[]> {
  const zip = await openZip(file);
  const temp = path.join(
    temporaryDirectory,
    "xlsx-" + randomUUID() + ".sqlite",
  );
  let strings: DatabaseSync | undefined;
  try {
    const all = await entries(zip),
      ss = all.find((e) => e.fileName === "xl/sharedStrings.xml");
    strings = new DatabaseSync(temp);
    strings.exec("CREATE TABLE strings(n INTEGER PRIMARY KEY,value TEXT)");
    if (ss) {
      let n = 0,
        text = "",
        inside = false;
      const p = parser();
      const insert = strings.prepare("INSERT INTO strings VALUES(?,?)");
      p.on("opentag", (t) => {
        if (local(t.name) === "si") text = "";
        if (local(t.name) === "t") inside = true;
      });
      p.on("text", (v) => {
        if (inside) {
          text += v;
          if (text.length > 16 * 1024 ** 2)
            throw new Error("Ячейка XLSX больше 16 MiB");
        }
      });
      p.on("closetag", (t) => {
        if (local(t.name) === "t") inside = false;
        if (local(t.name) === "si") insert.run(n++, excelText(text));
      });
      const stream = await zipStream(zip, ss),
        decoder = iconv.getDecoder("utf8");
      for await (const chunk of stream as any) {
        signal.throwIfAborted();
        p.write(decoder.write(chunk));
      }
      p.write(decoder.end() || "");
      p.close();
    }
    const workbook = all.find((e) => e.fileName === "xl/workbook.xml"),
      rels = all.find((e) => e.fileName === "xl/_rels/workbook.xml.rels");
    if (!workbook || !rels)
      throw new Error("XLSX не содержит workbook relationships");
    const order: string[] = [],
      targets = new Map<string, string>();
    await parseEntry(
      zip,
      workbook,
      (t) => {
        if (local(t.name) === "sheet")
          order.push(String(t.attributes["r:id"] || ""));
      },
      signal,
    );
    await parseEntry(
      zip,
      rels,
      (t) => {
        if (
          local(t.name) !== "Relationship" ||
          !String(t.attributes.Type).endsWith("/worksheet")
        )
          return;
        if (t.attributes.TargetMode === "External")
          throw new Error("Внешний worksheet запрещён");
        const raw = String(t.attributes.Target),
          target = path.posix.normalize(
            raw.startsWith("/") ? raw.slice(1) : path.posix.join("xl", raw),
          );
        if (!target.startsWith("xl/worksheets/") || target.includes("\\"))
          throw new Error("Некорректный путь worksheet");
        targets.set(String(t.attributes.Id), target);
      },
      signal,
    );
    const sheets = order
      .map((id) => all.find((e) => e.fileName === targets.get(id)))
      .filter((e): e is Entry => !!e);
    const sheet = sheets[sheetIndex];
    if (!sheet) throw new Error("Лист XLSX не найден");
    const get = strings.prepare("SELECT value FROM strings WHERE n=?");
    const p = parser();
    let row: (string | null)[] = [],
      index = 0,
      type = "",
      value = "",
      inValue = false,
      queue: (string | null)[][] = [];
    p.on("opentag", (t) => {
      if (local(t.name) === "row") row = [];
      if (local(t.name) === "c") {
        const ref = String(t.attributes.r || "A1");
        let col = 0;
        for (const c of ref.match(/^[A-Z]+/)?.[0] || "A")
          col = col * 26 + c.charCodeAt(0) - 64;
        index = col - 1;
        if (index >= 16384) throw new Error("Неверный столбец XLSX");
        type = String(t.attributes.t || "n");
        value = "";
      }
      if (local(t.name) === "v" || local(t.name) === "t") inValue = true;
    });
    p.on("text", (v) => {
      if (inValue) {
        value += v;
        if (value.length > 16 * 1024 ** 2)
          throw new Error("Ячейка XLSX больше 16 MiB");
      }
    });
    p.on("closetag", (t) => {
      if (local(t.name) === "v" || local(t.name) === "t") inValue = false;
      if (local(t.name) === "c") {
        if (type === "e")
          throw new Error("XLSX содержит ошибку вычисления: " + value);
        row[index] =
          type === "s"
            ? String(get.get(Number(value))?.value ?? "")
            : type === "b"
              ? value === "1"
                ? "true"
                : "false"
              : value === "" && type === "n"
                ? null
                : ["inlineStr", "str"].includes(type)
                  ? excelText(value)
                  : value;
      }
      if (local(t.name) === "row") {
        queue.push(
          Array.from({ length: row.length }, (_, i) => row[i] ?? null),
        );
      }
    });
    const stream = await zipStream(zip, sheet),
      decoder = iconv.getDecoder("utf8");
    for await (const chunk of stream as any) {
      signal.throwIfAborted();
      p.write(decoder.write(chunk));
      const ready = queue;
      queue = [];
      for (const row of ready) yield row;
    }
    p.write(decoder.end() || "");
    p.close();
    for (const row of queue) yield row;
  } finally {
    strings?.close();
    zip.close();
    await fs.rm(temp, { force: true });
  }
}
export async function writeRows(
  destination: string,
  format: "csv" | "sql" | "xlsx",
  fields: string[],
  rows: AsyncIterable<unknown[]>,
  signal: AbortSignal,
  progress: (rows: number, bytes: number) => void,
  table?: string,
  tableSchema?: string,
) {
  if (format === "xlsx")
    return writeXlsx(destination, fields, rows, signal, progress);
  if (format === "sql" && new Set(fields).size !== fields.length)
    throw new Error(
      "SQL экспорт требует уникальные имена столбцов. Задайте SQL aliases перед экспортом.",
    );
  if (format === "sql" && !table)
    throw new Error("Для SQL экспорта укажите целевую таблицу");
  async function* content() {
    let count = 0,
      bytes = 0;
    if (format === "csv") yield fields.map(csvCell).join(",") + "\r\n";
    for await (const row of rows) {
      signal.throwIfAborted();
      const text =
        format === "csv"
          ? row.map(csvCell).join(",") + "\r\n"
          : `INSERT INTO ${tableSchema ? qualified(tableSchema, table!) : identifier(table!)} (${fields.map(identifier).join(",")}) VALUES (${row.map(literal).join(",")});\n`;
      count++;
      bytes += Buffer.byteLength(text);
      if (count % 256 === 0) progress(count, bytes);
      yield text;
    }
    progress(count, bytes);
  }
  await pipeline(
    Readable.from(content(), { objectMode: false, highWaterMark: 64 * 1024 }),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    { signal },
  );
}
export function countingStream(
  progress: (bytes: number) => void,
  inspect?: (chunk: Buffer) => void,
) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      inspect?.(chunk);
      progress(bytes);
      callback(null, chunk);
    },
  });
}
export function decodedFile(file: string, encoding: string) {
  if (
    !["utf8", "utf-8", "windows-1251", "win1251", "utf16le"].includes(encoding)
  )
    throw new Error("Кодировка не поддерживается");
  const unicode = ["utf8", "utf-8", "utf16le"].includes(encoding);
  const fatal = unicode
    ? new TextDecoder(encoding === "utf16le" ? "utf-16le" : "utf-8", {
        fatal: true,
      })
    : undefined;
  const legacy = unicode ? undefined : iconv.getDecoder(encoding);
  return createReadStream(file, { highWaterMark: 64 * 1024 }).compose(
    new Transform({
      transform(chunk, _encoding, cb) {
        try {
          if (!unicode && (chunk as Buffer).includes(0x98))
            throw new Error("Байт 0x98 не определён в Windows-1251");
          const text = fatal
            ? fatal.decode(chunk, { stream: true })
            : legacy!.write(chunk);
          cb(null, Buffer.from(text));
        } catch {
          cb(
            new Error(
              "Файл содержит некорректную последовательность " +
                encoding +
                "; выберите правильную кодировку.",
            ),
          );
        }
      },
      flush(cb) {
        try {
          cb(null, Buffer.from(fatal ? fatal.decode() : legacy!.end() || ""));
        } catch {
          cb(new Error("Незавершённый символ в конце файла"));
        }
      },
    }),
  );
}
