import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../shared/types";
export type Invoke = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<any>;
export const call: Invoke = async (method, params = {}) => {
  if (!window.workbench)
    throw new Error(
      "Откройте приложение Electron: связь с локальным backend недоступна.",
    );
  try {
    return await window.workbench.invoke(method, params);
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent("workbench-error", { detail: errorText(e) }),
    );
    throw e;
  }
};
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export function useSnapshot() {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState("");
  const running = useRef(false),
    again = useRef(false),
    alive = useRef(true);
  const refresh = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    do {
      again.current = false;
      try {
        const next = await call("state.get");
        if (alive.current) {
          setState((old) =>
            !old || next.revision >= old.revision ? next : old,
          );
          setError("");
        }
      } catch (e) {
        if (alive.current) setError(errorText(e));
      }
    } while (again.current && alive.current);
    running.current = false;
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = window.workbench?.subscribe((e) => {
      if (e.type === "state.changed") void refresh();
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, [refresh]);
  return { state, error, refresh };
}
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      window.dispatchEvent(
        new CustomEvent("workbench-error", {
          detail:
            "Не удалось сохранить локальный черновик или раскладку. Текущий ввод остаётся в окне; освободите место перед закрытием.",
        }),
      );
    }
  }, [key, value]);
  return [value, setValue] as const;
}
export const busy = (status: string) =>
  ["starting", "running", "waiting", "cancelling"].includes(status);
export const statusLabel: Record<string, string> = {
  idle: "Не выполняется",
  starting: "Запускается",
  running: "Работает",
  waiting: "Ожидает",
  cancelling: "Останавливается",
  completed: "Ответ готов",
  failed: "Ошибка",
  unknown: "Исход неизвестен",
};
