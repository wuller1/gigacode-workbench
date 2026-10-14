import { useEffect, useId, useRef, useState } from "react";
import { Icon, IconButton } from "./ui";
import { SqlEditor } from "./SqlEditor";
import "./database-structure.css";

type Section = "columns" | "constraints" | "indexes" | "triggers";
type MetadataRow = Record<string, unknown>;
const sections: { id: Section; label: string; title: string }[] = [
  { id: "columns", label: "Столбцы", title: "Столбцы и их свойства" },
  {
    id: "constraints",
    label: "Ключи",
    title: "Ключи и ограничения PostgreSQL",
  },
  { id: "indexes", label: "Индексы", title: "Индексы PostgreSQL" },
  { id: "triggers", label: "Триггеры", title: "Пользовательские триггеры" },
];
const pageSize = 200;
const definitionLimit = 64 * 1024;
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const preview = (value: unknown, limit = 4096) => {
  const valueText = text(value);
  return valueText.length > limit ? valueText.slice(0, limit) + "…" : valueText;
};
const constraintTypes: Record<string, string> = {
  p: "Первичный ключ",
  f: "Внешний ключ",
  u: "Уникальное",
  c: "CHECK",
  x: "EXCLUDE",
  n: "NOT NULL",
  t: "Constraint trigger",
};
const required = (value: unknown) =>
  value === true || ["true", "t", "1"].includes(text(value))
    ? "Да"
    : value === false || ["false", "f", "0"].includes(text(value))
      ? "—"
      : "Не получено";
const generation = (column: MetadataRow) => {
  const identity = text(column.identity);
  if (identity)
    return identity === "a"
      ? "Identity ALWAYS"
      : identity === "d"
        ? "Identity BY DEFAULT"
        : "Identity · " + identity;
  const generated = text(column.generated);
  return generated === "s"
    ? "Generated STORED"
    : generated === "v"
      ? "Generated VIRTUAL"
      : generated
        ? "Generated · " + generated
        : "—";
};

/** Displays only the catalog metadata returned by the selected table's provider. */
export function DatabaseStructure({
  definition,
}: {
  definition: Record<string, any> | undefined;
}) {
  const [section, setSection] = useState<Section>("columns"),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState<string>(),
    [copied, setCopied] = useState<string>(),
    [error, setError] = useState("");
  const id = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]),
    copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    setSearch("");
    setOffset(0);
    setExpanded(undefined);
    setCopied(undefined);
    setError("");
  }, [definition?.oid]);
  const rowsFor = (key: Section): MetadataRow[] | undefined =>
    Array.isArray(definition?.[key])
      ? definition[key].filter((row: unknown) => row && typeof row === "object")
      : undefined;
  const received = rowsFor(section),
    needle = search.trim().toLocaleLowerCase("ru-RU"),
    rows = (received || []).filter((row) =>
      [row.name, row.type, row.comment, row.definition, row.default].some(
        (value) => text(value).toLocaleLowerCase("ru-RU").includes(needle),
      ),
    ),
    safeOffset = Math.min(
      offset,
      Math.max(0, Math.ceil(rows.length / pageSize) - 1) * pageSize,
    ),
    visibleRows = rows.slice(safeOffset, safeOffset + pageSize);
  const select = (next: Section) => {
    setSection(next);
    setOffset(0);
    setExpanded(undefined);
    setCopied(undefined);
    setError("");
  };
  const copy = async (value: string, key: string) => {
    setError("");
    if (
      value.length > definitionLimit ||
      new TextEncoder().encode(value).byteLength > definitionLimit
    ) {
      setError(
        "Определение больше 64 КиБ. Копирование фрагмента вместо полного SQL запрещено.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(undefined), 1800);
    } catch {
      setError(
        "Не удалось записать SQL в буфер обмена. Разверните определение и скопируйте нужный текст вручную.",
      );
    }
  };
  return (
    <section className="db-structure" aria-label="Структура объекта БД">
      <div className="db-structure-toolbar">
        <div
          role="tablist"
          aria-label="Метаданные таблицы"
          className="db-structure-tabs"
        >
          {sections.map((item, index) => (
            <button
              key={item.id}
              id={id + "-" + item.id}
              ref={(button) => {
                buttons.current[index] = button;
              }}
              role="tab"
              aria-selected={section === item.id}
              aria-controls={id + "-content"}
              tabIndex={section === item.id ? 0 : -1}
              title={item.title}
              onClick={() => select(item.id)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sections.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          sections.length) %
                        sections.length;
                select(sections[next].id);
                buttons.current[next]?.focus();
              }}
            >
              {item.label}
              <span className="db-structure-count">
                {rowsFor(item.id)?.length ?? "—"}
              </span>
            </button>
          ))}
        </div>
        <input
          aria-label="Поиск в структуре БД"
          placeholder="Найти в структуре…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
            setExpanded(undefined);
          }}
        />
      </div>
      {definition?.comment && (
        <p className="db-structure-comment" title={preview(definition.comment)}>
          {preview(definition.comment)}
        </p>
      )}
      {error && (
        <div className="db-structure-feedback" role="alert">
          <span>{error}</span>
          <IconButton
            icon="close"
            label="Скрыть сообщение структуры"
            onClick={() => setError("")}
          />
        </div>
      )}
      <div
        className="db-structure-scroll"
        role="tabpanel"
        id={id + "-content"}
        aria-labelledby={id + "-" + section}
        tabIndex={0}
      >
        {!definition ? (
          <p className="db-structure-empty" role="status">
            Получаю структуру объекта…
          </p>
        ) : !received ? (
          <p className="db-structure-empty">
            Провайдер не вернул этот раздел метаданных.
          </p>
        ) : !rows.length ? (
          <p className="db-structure-empty">
            {needle
              ? "По этому фильтру ничего не найдено."
              : {
                  columns: "Столбцов нет.",
                  constraints: "Ключей и ограничений нет.",
                  indexes: "Индексов нет.",
                  triggers: "Пользовательских триггеров нет.",
                }[section]}
          </p>
        ) : section === "columns" ? (
          <table className="db-structure-table" aria-label="Столбцы таблицы">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Столбец</th>
                <th scope="col">Тип</th>
                <th scope="col">NOT NULL</th>
                <th scope="col">Default / выражение</th>
                <th scope="col">Генерация</th>
                <th scope="col">Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((column, index) => (
                <tr
                  key={text(column.ordinal) + ":" + text(column.name) + index}
                >
                  <td className="db-structure-ordinal">
                    {text(column.ordinal) || safeOffset + index + 1}
                  </td>
                  <th scope="row" title={preview(column.name)}>
                    {preview(column.name)}
                  </th>
                  <td title={preview(column.type)}>
                    <code>{preview(column.type) || "Не получен"}</code>
                  </td>
                  <td>{required(column.required)}</td>
                  <td title={preview(column.default)}>
                    <code>
                      {column.default === null || column.default === undefined
                        ? "—"
                        : preview(column.default)}
                    </code>
                  </td>
                  <td>{generation(column)}</td>
                  <td
                    className="db-structure-comment-cell"
                    title={preview(column.comment)}
                  >
                    {preview(column.comment) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table
            className="db-structure-table"
            aria-label={sections.find((item) => item.id === section)!.title}
          >
            <thead>
              <tr>
                <th scope="col">Имя</th>
                {section === "constraints" && <th scope="col">Тип</th>}
                <th scope="col">Определение PostgreSQL</th>
                {section === "constraints" && (
                  <th
                    scope="col"
                    title="OID связанной таблицы, полученный от PostgreSQL"
                  >
                    Цель · OID
                  </th>
                )}
                <th scope="col" className="db-structure-actions">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const key =
                    section + ":" + text(row.name) + ":" + (safeOffset + index),
                  value = text(row.definition),
                  open = expanded === key;
                return (
                  <MetadataDefinitionRow
                    key={key}
                    row={row}
                    section={section}
                    definition={value}
                    expanded={open}
                    copied={copied === key}
                    toggle={() => setExpanded(open ? undefined : key)}
                    copy={() => void copy(value, key)}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > pageSize && (
        <div className="db-structure-pagination">
          <span>
            {safeOffset + 1}–{Math.min(rows.length, safeOffset + pageSize)} из{" "}
            {rows.length}
          </span>
          <IconButton
            icon="chevron-left"
            label="Предыдущие элементы структуры"
            disabled={!safeOffset}
            onClick={() => {
              setOffset(safeOffset - pageSize);
              setExpanded(undefined);
            }}
          />
          <IconButton
            icon="chevron-right"
            label="Следующие элементы структуры"
            disabled={safeOffset + pageSize >= rows.length}
            onClick={() => {
              setOffset(safeOffset + pageSize);
              setExpanded(undefined);
            }}
          />
        </div>
      )}
      <span className="db-structure-live" role="status" aria-live="polite">
        {copied ? "Определение скопировано" : ""}
      </span>
    </section>
  );
}

function MetadataDefinitionRow({
  row,
  section,
  definition,
  expanded,
  copied,
  toggle,
  copy,
}: {
  row: MetadataRow;
  section: Section;
  definition: string;
  expanded: boolean;
  copied: boolean;
  toggle: () => void;
  copy: () => void;
}) {
  const id = useId(),
    name = text(row.name),
    oversized = definition.length > definitionLimit,
    copyOversized =
      oversized ||
      new TextEncoder().encode(definition).byteLength > definitionLimit;
  return (
    <>
      <tr>
        <th scope="row">
          <button
            className="db-structure-expand"
            aria-expanded={expanded}
            aria-controls={id}
            disabled={!definition}
            onClick={toggle}
            title={
              expanded
                ? "Скрыть определение " + name
                : "Показать определение " + name
            }
          >
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={14}
            />
            <span>{preview(name) || "Без имени"}</span>
          </button>
        </th>
        {section === "constraints" && (
          <td>
            {constraintTypes[text(row.type)] || text(row.type) || "Не получен"}
          </td>
        )}
        <td title={preview(definition)}>
          <code>{preview(definition) || "Не получено"}</code>
        </td>
        {section === "constraints" && (
          <td className="db-structure-oid">
            {text(row.target) && text(row.target) !== "0"
              ? text(row.target)
              : "—"}
          </td>
        )}
        <td className="db-structure-actions">
          <IconButton
            icon={copied ? "check" : "copy"}
            label={
              copyOversized
                ? "Полное определение больше 64 КиБ · копирование недоступно"
                : (copied ? "Скопировано: " : "Копировать определение ") + name
            }
            disabled={!definition || copyOversized}
            onClick={copy}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="db-structure-definition-row">
          <td colSpan={section === "constraints" ? 5 : 3}>
            <div
              id={id}
              className="db-structure-definition"
              aria-label={"Определение " + name}
            >
              <SqlEditor
                value={definition.slice(0, definitionLimit)}
                readOnly
                onChange={() => {}}
                onRun={() => {}}
              />
            </div>
            {oversized && (
              <p className="db-structure-definition-note">
                Показаны первые {definitionLimit.toLocaleString("ru-RU")}{" "}
                символов. Полное определение больше лимита; копирование
                фрагмента отключено.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
