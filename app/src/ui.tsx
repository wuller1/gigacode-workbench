import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { call, statusLabel } from "./api";
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="icon"
      style={{
        width: size,
        height: size,
        maskImage: `url(./icons/${name}.svg)`,
        WebkitMaskImage: `url(./icons/${name}.svg)`,
      }}
    />
  );
}
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  className = "",
  children,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`icon-button ${className}`}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span
      className={`status status-${status}`}
      title={statusLabel[status] || status}
      aria-label={statusLabel[status] || status}
    >
      {status === "running" || status === "starting" ? (
        <span className="working-arc" />
      ) : (
        <Icon
          size={15}
          name={
            status === "completed"
              ? "check"
              : status === "failed"
                ? "warning"
                : status === "unknown"
                  ? "unknown"
                  : status === "waiting"
                    ? "clock"
                    : status === "cancelling"
                      ? "stop"
                      : "chat"
          }
        />
      )}
    </span>
  );
}
const LayerContext = createContext({
  covered: false,
  change: (_id: string, _show: boolean) => {},
});
export function LayerProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const changeRef = useRef((id: string, show: boolean) =>
    setIds((old) => {
      if (old.has(id) === show) return old;
      const next = new Set(old);
      if (show) next.add(id);
      else next.delete(id);
      return next;
    }),
  );
  return (
    <LayerContext.Provider
      value={{ covered: ids.size > 0, change: changeRef.current }}
    >
      {children}
    </LayerContext.Provider>
  );
}
export function useLayer(show: boolean) {
  const id = useId(),
    { change } = useContext(LayerContext);
  useEffect(() => {
    change(id, show);
    return () => change(id, false);
  }, [id, show, change]);
}
export const useCovered = () => useContext(LayerContext).covered;
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    previous = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useLayer(true);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    const first =
      ref.current?.querySelector<HTMLElement>(
        "input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
      ) || ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]');
    first?.focus();
    return () => {
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const all = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ) || [],
            );
            const first = all[0],
              last = all[all.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label="Закрыть" onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export function Menu({
  items,
  label = "Действия",
  icon = "more",
}: {
  items: MenuItem[];
  label?: string;
  icon?: string;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null);
  useLayer(open);
  const close = () => {
    setOpen(false);
    ref.current?.querySelector("button")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const f = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", f);
    document.addEventListener("keydown", key);
    popup.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", f);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="menu-wrap">
      <IconButton
        icon={icon}
        label={label}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          if (r)
            setPosition({
              top: Math.max(
                8,
                Math.min(
                  r.bottom + 3,
                  window.innerHeight - items.length * 36 - 18,
                ),
              ),
              right: Math.max(
                8,
                Math.min(window.innerWidth - r.right, window.innerWidth - 240),
              ),
            });
          setOpen((x) => !x);
        }}
      />
      {open &&
        createPortal(
          <div
            ref={popup}
            className="menu-popover"
            style={{
              position: "fixed",
              top: position.top,
              right: position.right,
            }}
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const rows = Array.from(
                  popup.current?.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ) || [],
                );
                const i = rows.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                rows[
                  (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) %
                    rows.length
                ]?.focus();
              }
            }}
          >
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                className={it.danger ? "danger" : ""}
                onClick={() => {
                  close();
                  it.action();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href)
                  void call("external.open", { url: href }).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <pre>{children}</pre>
              <button
                className="code-copy"
                title="Скопировать код"
                onClick={(e) => {
                  const text =
                    e.currentTarget.parentElement?.querySelector("pre")
                      ?.textContent || "";
                  void call("clipboard.write", { text }).catch(() => {});
                }}
              >
                <Icon name="copy" size={14} />
              </button>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
interface DialogRequest {
  title: string;
  message?: string;
  value?: string;
  multiline?: boolean;
  confirm?: boolean;
  resolve: (v: string | null) => void;
}
const DialogContext = createContext<
  (
    title: string,
    options?: Omit<DialogRequest, "title" | "resolve">,
  ) => Promise<string | null>
>(async () => null);
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogRequest>();
  const [value, setValue] = useState("");
  const ask = (
    title: string,
    options: Omit<DialogRequest, "title" | "resolve"> = {},
  ) =>
    new Promise<string | null>((resolve) => {
      setValue(options.value || "");
      setDialog({ title, ...options, resolve });
    });
  const finish = (result: string | null) => {
    dialog?.resolve(result);
    setDialog(undefined);
  };
  return (
    <DialogContext.Provider value={ask}>
      {children}
      {dialog && (
        <Modal title={dialog.title} onClose={() => finish(null)}>
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              finish(dialog.confirm ? "yes" : value);
            }}
          >
            {dialog.message && <p>{dialog.message}</p>}
            {!dialog.confirm &&
              (dialog.multiline ? (
                <textarea
                  autoFocus
                  rows={6}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-label={dialog.title}
                />
              ) : (
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-label={dialog.title}
                />
              ))}
            <footer>
              <button type="button" onClick={() => finish(null)}>
                Отмена
              </button>
              <button
                className="primary"
                type="submit"
                disabled={!dialog.confirm && !value.trim()}
              >
                {dialog.confirm ? "Подтвердить" : "Сохранить"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}
export const useAsk = () => useContext(DialogContext);
export function Empty({
  icon = "chat",
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
