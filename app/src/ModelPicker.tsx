import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConfigOption } from "../shared/types";
import { Icon, useLayer } from "./ui";

export function ModelPicker({
  configs,
  model,
  reasoning,
  disabled,
  onSelect,
  onSettings,
  onContext,
  onPrepare,
}: {
  configs: ConfigOption[];
  model: string;
  reasoning: string;
  disabled: boolean;
  onSelect(id: string, value: string): Promise<unknown>;
  onSettings(): void;
  onContext(): void;
  onPrepare?(): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  useLayer(open);
  const modelConfig = configs.find(
    (c) => c.category === "model" || c.id === "model",
  );
  const thought = configs.find(
    (c) => c.category === "thought_level" || /reasoning|thinking/i.test(c.id),
  );
  const label =
    modelConfig?.options.find((o) => o.value === modelConfig.currentValue)
      ?.name ||
    modelConfig?.currentValue ||
    model;
  const depth =
    thought?.options.find((o) => o.value === thought.currentValue)?.name ||
    thought?.currentValue ||
    (configs.length ? "" : reasoning);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useLayoutEffect(() => {
    if (open && button.current && popup.current) {
      const r = button.current.getBoundingClientRect(),
        p = popup.current.getBoundingClientRect();
      setPosition({
        left: Math.max(
          8,
          Math.min(innerWidth - p.width - 8, r.right - p.width),
        ),
        top: Math.max(48, r.top - p.height - 8),
      });
    }
  }, [open, configs.length, query]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !popup.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  async function choose(id: string, value: string) {
    setPending(true);
    try {
      await onSelect(id, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button
        ref={button}
        className="model-picker-trigger"
        aria-label="Модель и рассуждение"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          disabled
            ? "Модель можно изменить после текущего запроса"
            : [label, depth].filter(Boolean).join(" · ")
        }
        disabled={disabled || pending}
        onClick={async () => {
          setQuery("");
          setOpen((v) => !v);
          if (!configs.length && onPrepare) {
            setPending(true);
            setError("");
            try {
              await onPrepare();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setPending(false);
            }
          }
        }}
      >
        <span className="model-name">{label}</span>
        {depth && <span className="model-depth">{depth}</span>}
        <Icon name="chevron-down" size={12} />
      </button>
      {open &&
        createPortal(
          <div
            className="model-picker-popover"
            ref={popup}
            role="dialog"
            aria-label="Настройка модели и рассуждения"
            style={position}
          >
            <input
              ref={search}
              aria-label="Найти модель"
              placeholder="Найти модель…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="model-picker-options">
              {pending && !configs.length && (
                <p className="model-picker-notice">Подключение к CLI…</p>
              )}
              {error && (
                <p className="model-picker-notice" role="alert">
                  {error}
                </p>
              )}
              {!pending && !configs.length && (
                <div className="model-picker-notice">
                  CLI не предоставил список моделей.
                  <button
                    onClick={() => {
                      close();
                      onSettings();
                    }}
                  >
                    Настроить подключение
                  </button>
                </div>
              )}
              {configs.map((config) => {
                const options =
                  config === modelConfig
                    ? config.options.filter((o) =>
                        o.name.toLowerCase().includes(query.toLowerCase()),
                      )
                    : config.options;
                return (
                  <section
                    key={config.id}
                    aria-label={config.name}
                    className={config === thought ? "reasoning-options" : ""}
                  >
                    {config !== modelConfig && (
                      <div className="model-picker-section-label">
                        {config.name}
                      </div>
                    )}
                    <div>
                      {options.map((option) => (
                        <button
                          key={option.value}
                          disabled={pending}
                          aria-pressed={option.value === config.currentValue}
                          title={option.name}
                          onClick={() => void choose(config.id, option.value)}
                        >
                          <span>{option.name}</span>
                          {config !== thought &&
                            option.value === config.currentValue && (
                              <Icon name="check" size={15} />
                            )}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <button
              className="model-picker-context"
              onClick={() => {
                close();
                onContext();
              }}
            >
              Контекст и восстановление
              <Icon name="chevron-right" size={13} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

export function ContextSend({
  used,
  limit,
  estimated,
  busy,
  sending,
  disabled,
  onContext,
  onSend,
}: {
  used?: number;
  limit?: number;
  estimated?: boolean;
  busy: boolean;
  sending: boolean;
  disabled: boolean;
  onContext(): void;
  onSend(): void;
}) {
  const known = used !== undefined && limit !== undefined && limit > 0,
    fill = known ? Math.min(1, Math.max(0, used! / limit!)) : 0;
  const color = !known
    ? "var(--control)"
    : fill >= 0.95
      ? "var(--danger)"
      : fill >= 0.85
        ? "#d2742f"
        : fill >= 0.65
          ? "#b88a39"
          : "#659e79";
  const label = known
    ? `Контекст: ${estimated ? "примерно " : ""}${used!.toLocaleString()} из ${limit!.toLocaleString()} токенов`
    : "CLI не сообщил заполнение контекста";
  return (
    <div
      className="context-send"
      onContextMenu={(e) => {
        e.preventDefault();
        onContext();
      }}
    >
      <button
        className="context-send-ring"
        aria-label={label}
        title={label}
        onClick={onContext}
      >
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle className="context-track" cx="20" cy="20" r="18" />
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={known ? `${fill * 113.097} 113.097` : "3 5"}
            transform="rotate(-90 20 20)"
          />
        </svg>
      </button>
      <button
        className="send-button"
        aria-label={busy ? "Добавить в очередь" : "Отправить"}
        title={
          busy
            ? "В очередь · Ctrl+Enter · ПКМ — контекст"
            : "Отправить · Ctrl+Enter · ПКМ — контекст"
        }
        disabled={sending || disabled}
        onClick={onSend}
      >
        <Icon name={busy ? "plus" : "arrow-up"} size={18} />
      </button>
    </div>
  );
}
