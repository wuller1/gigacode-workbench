import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DatabaseObject } from "../shared/database";
import { Icon, IconButton, useLayer } from "./ui";
export type DatabaseCatalog = {
  schemas: { name: string }[];
  objects: DatabaseObject[];
  offset?: number;
  total?: number;
  hasMore?: boolean;
};
export function DatabaseExplorer({
  catalog,
  selected,
  onSelected,
  search,
  onSearch,
  system,
  onSystem,
  loading,
  connected,
  busy,
  refresh,
  open,
  offset,
  onOffset,
}: {
  catalog: DatabaseCatalog;
  selected: string[];
  onSelected: (s: string[]) => void;
  search: string;
  onSearch: (s: string) => void;
  system: boolean;
  onSystem: (s: boolean) => void;
  loading: boolean;
  connected: boolean;
  busy: boolean;
  refresh: () => void;
  open: (o: DatabaseObject) => void;
  offset: number;
  onOffset: (n: number) => void;
}) {
  const [show, setShow] = useState(false),
    [schemaSearch, setSchemaSearch] = useState(""),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useLayer(show);
  useEffect(() => {
    if (!show) return;
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setShow(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [show]);
  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (r)
        setPosition({
          left: Math.max(8, Math.min(r.left, window.innerWidth - 286)),
          top: Math.max(
            8,
            Math.min(
              r.bottom + 4,
              window.innerHeight - (popup.current?.offsetHeight || 340) - 8,
            ),
          ),
        });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [show, catalog.schemas.length]);
  const available = new Set(catalog.schemas.map((s) => s.name));
  const schemas = [
    ...new Set([...catalog.schemas.map((s) => s.name), ...selected]),
  ]
    .sort()
    .filter((name) => name.toLowerCase().includes(schemaSearch.toLowerCase()))
    .map((name) => ({ name }));
  return (
    <>
      <div className="db-tree-tools">
        <input
          aria-label="Поиск объекта БД"
          placeholder="Найти объект…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <IconButton
          icon="reload"
          label="Обновить схему"
          disabled={!connected || busy || loading}
          onClick={refresh}
        />
      </div>
      <div
        className="db-schema-picker"
        ref={root}
        onKeyDown={(e) => {
          if (e.key === "Escape" && show) {
            e.preventDefault();
            e.stopPropagation();
            setShow(false);
            trigger.current?.focus();
          }
        }}
      >
        <button
          ref={trigger}
          aria-label="Выбрать видимые схемы"
          aria-expanded={show}
          onClick={() => setShow((v) => !v)}
        >
          <span>Схемы · {selected.length}</span>
          <Icon name="chevron-down" size={13} />
        </button>
        {show &&
          createPortal(
            <div
              ref={popup}
              style={position}
              className="db-schema-popup"
              role="region"
              aria-label="Видимые схемы"
            >
              <input
                autoFocus
                aria-label="Найти схему"
                placeholder="Найти схему…"
                value={schemaSearch}
                onChange={(e) => setSchemaSearch(e.target.value)}
              />
              <div className="db-schema-options">
                {schemas.slice(0, 100).map((s) => (
                  <label key={s.name}>
                    <input
                      type="checkbox"
                      checked={selected.includes(s.name)}
                      disabled={
                        !selected.includes(s.name) && selected.length >= 100
                      }
                      onChange={(e) =>
                        onSelected(
                          e.target.checked
                            ? [...selected, s.name]
                            : selected.filter((n) => n !== s.name),
                        )
                      }
                    />
                    <span
                      title={
                        !available.has(s.name)
                          ? "Схема отсутствует в текущем каталоге"
                          : s.name
                      }
                    >
                      {s.name}
                      {!available.has(s.name) ? " · нет в каталоге" : ""}
                    </span>
                  </label>
                ))}
                {schemas.length > 100 && (
                  <small>Первые 100 схем. Уточните поиск.</small>
                )}
                {!schemas.length && (
                  <small>Нет доступных схем по этому фильтру.</small>
                )}
              </div>
              <label className="db-system-schemas">
                <input
                  type="checkbox"
                  checked={system}
                  onChange={(e) => onSystem(e.target.checked)}
                />
                Системные схемы
              </label>
              <small>Выбор сохраняется для проекта и подключения.</small>
            </div>,
            document.body,
          )}
      </div>
      <div className="db-object-tree" aria-busy={loading}>
        {selected.map((schema) => (
          <details key={schema} className="db-schema-group" open>
            <summary>
              <Icon name="database" size={14} />
              <span>{schema}</span>
            </summary>
            {catalog.objects
              .filter((o) => o.schema === schema)
              .map((o) => (
                <button
                  key={o.kind + o.oid}
                  title={o.schema + "." + o.name}
                  onDoubleClick={() => open(o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "F4") {
                      e.preventDefault();
                      open(o);
                    }
                  }}
                >
                  <Icon
                    name={
                      ["function", "procedure"].includes(o.kind)
                        ? "code"
                        : "database"
                    }
                    size={14}
                  />
                  <span>{o.name}</span>
                  <small>{o.kind}</small>
                </button>
              ))}
          </details>
        ))}
        {!connected && (
          <p className="muted">Подключите консоль, чтобы обновить объекты.</p>
        )}
        {loading && (
          <p className="muted" role="status">
            Обновляю каталог…
          </p>
        )}
        {connected && !loading && !catalog.objects.length && (
          <p className="muted">
            Объекты не найдены. Проверьте поиск и выбранные схемы.
          </p>
        )}
      </div>
      {(!!offset || catalog.hasMore) && (
        <div className="db-catalog-pages">
          <IconButton
            icon="chevron-left"
            label="Предыдущие объекты"
            disabled={!offset || loading}
            onClick={() => onOffset(Math.max(0, offset - 200))}
          />
          <span>
            {offset + 1}–{offset + catalog.objects.length}
            {catalog.total !== undefined ? " из " + catalog.total : ""}
          </span>
          <IconButton
            icon="chevron-right"
            label="Следующие объекты"
            disabled={!catalog.hasMore || loading}
            onClick={() => onOffset(offset + 200)}
          />
        </div>
      )}
    </>
  );
}
