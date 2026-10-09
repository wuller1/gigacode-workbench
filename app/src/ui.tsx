import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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

// Only registered modal components trap focus. Task question overlays stay nonmodal.
const modalRoots = new Set<HTMLElement>();
const menuRoots = new Map<HTMLElement, HTMLElement>();
function lastInDocument(elements: HTMLElement[]) {
  return elements
    .filter((element) => element.isConnected)
    .reduce<HTMLElement | undefined>(
      (last, element) =>
        !last ||
        last.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
          ? element
          : last,
      undefined,
    );
}
function topModal() {
  return lastInDocument([...modalRoots]);
}
function topMenu(modal = topModal()) {
  return lastInDocument(
    [...menuRoots.keys()].filter(
      (root) => !modal || modal.contains(menuRoots.get(root)!),
    ),
  );
}
function focusableIn(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert],[aria-hidden="true"]'),
  );
}
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
    previous = useRef<HTMLElement | null>(
      document.activeElement as HTMLElement,
    ),
    lastFocus = useRef<HTMLElement | null>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useLayer(true);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    modalRoots.add(root);
    const focusInside = (last = false) => {
      const menu = topMenu(root);
      const candidates = focusableIn(menu || root);
      const remembered = lastFocus.current;
      const target = last
        ? candidates.at(-1)
        : remembered?.isConnected &&
            root.contains(remembered) &&
            candidates.includes(remembered)
          ? remembered
          : candidates[0];
      (target || root).focus({ preventScroll: true });
    };
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (root.contains(target) || !!topMenu(root)?.contains(target));
    const key = (event: KeyboardEvent) => {
      if (topModal() !== root || event.defaultPrevented || topMenu(root))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const all = focusableIn(root),
          first = all[0],
          last = all.at(-1);
        if (
          !inside(document.activeElement) ||
          !all.includes(document.activeElement as HTMLElement)
        ) {
          event.preventDefault();
          focusInside(event.shiftKey);
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          (last || root).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (first || root).focus();
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (topModal() !== root) return;
      if (!inside(event.target)) focusInside();
      else if (
        event.target instanceof HTMLElement &&
        root.contains(event.target)
      )
        lastFocus.current = event.target;
    };
    // Removing/disabling a focused Restore button may silently move focus to body.
    const observer = new MutationObserver(() => {
      if (
        topModal() === root &&
        (!inside(document.activeElement) ||
          (document.activeElement instanceof HTMLButtonElement &&
            document.activeElement.disabled))
      )
        focusInside();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden"],
    });
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus, true);
    if (topModal() === root) {
      const first = focusableIn(root).find((element) =>
        element.matches("input,textarea,select"),
      );
      if (first) first.focus({ preventScroll: true });
      else focusInside();
    }
    return () => {
      observer.disconnect();
      modalRoots.delete(root);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus, true);
      const remaining = topModal();
      if (
        previous.current?.isConnected &&
        (!remaining || remaining.contains(previous.current))
      )
        previous.current.focus({ preventScroll: true });
      else if (remaining)
        (focusableIn(remaining)[0] || remaining).focus({ preventScroll: true });
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
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
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
  useLayoutEffect(() => {
    if (!open) return;
    const root = popup.current,
      anchor = ref.current;
    if (!root || !anchor) return;
    menuRoots.set(root, anchor);
    const f = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (topMenu() !== root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      } else if (e.key === "Tab") {
        close();
      }
    };
    document.addEventListener("pointerdown", f);
    document.addEventListener("keydown", key, true);
    popup.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", f);
      document.removeEventListener("keydown", key, true);
      menuRoots.delete(root);
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
