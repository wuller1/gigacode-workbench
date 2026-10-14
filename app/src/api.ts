import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../shared/types";
import { SnapshotFeed } from "./snapshot-feed";
import {
  DraftJournal,
  decodeStored,
  plainRecord,
  readStored,
  type ChatDraft,
  type Decoder,
  type DraftEntry,
} from "./local-state";
export type Invoke = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<any>;
/** Errors are handled by the calling form; no duplicate global error toast. */
export const callHandled: Invoke = async (method, params = {}) => {
  if (!window.workbench)
    throw new Error(
      "Откройте приложение Electron: связь с локальным backend недоступна.",
    );
  return window.workbench.invoke(method, params);
};
export const call: Invoke = async (method, params = {}) => {
  if (!window.workbench)
    throw new Error(
      "Откройте приложение Electron: связь с локальным backend недоступна.",
    );
  try {
    return await callHandled(method, params);
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
  const feed = useRef<SnapshotFeed | undefined>(undefined);
  const refresh = useCallback(
    () => feed.current?.refresh() ?? Promise.resolve(),
    [],
  );
  useEffect(() => {
    const controller = new SnapshotFeed({
      read: () =>
        window.workbench
          ? window.workbench.invoke("state.get")
          : Promise.reject(new Error("bridge unavailable")),
      onState: setState,
      onError: setError,
      visible: () => document.visibilityState !== "hidden",
    });
    feed.current = controller;
    const off = window.workbench?.subscribe((e) => {
      if (["state.changed", "runtime.stopped"].includes(e.type))
        controller.invalidate();
    });
    const focus = () => {
      void controller.refresh();
    };
    window.addEventListener("focus", focus);
    const visibility = () => {
      if (document.visibilityState !== "hidden") focus();
    };
    document.addEventListener("visibilitychange", visibility);
    void controller.start();
    return () => {
      controller.stop();
      if (feed.current === controller) feed.current = undefined;
      off?.();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  return { state, error, refresh };
}
function storageWarning() {
  window.dispatchEvent(
    new CustomEvent("workbench-error", {
      detail:
        "Не удалось записать локальный черновик или раскладку. Текущий ввод остаётся в окне; сохранение после сбоя не подтверждено.",
    }),
  );
}
export function useStored<T>(
  key: string,
  initial: T,
  options?: { windowScoped?: boolean; decode?: Decoder<T> },
) {
  const scoped = options?.windowScoped
    ? `${key}.window.${window.workbench?.windowKey || "primary"}`
    : key;
  const decoder =
    options?.decode ??
    ((value: unknown, fallback: T) => decodeStored(key, value, fallback));
  const [value, updateValue] = useState<T>(() =>
    readStored(
      localStorage,
      scoped,
      readStored(localStorage, key, initial, decoder),
      decoder,
    ),
  );
  const ref = useRef(value);
  const activeKey = useRef(scoped);
  if (activeKey.current !== scoped) {
    activeKey.current = scoped;
    ref.current = readStored(localStorage, scoped, initial, decoder);
  }
  const setValue = useCallback(
    (next: T | ((old: T) => T)) => {
      let resolved =
        typeof next === "function"
          ? (next as (old: T) => T)(ref.current)
          : next;
      if (
        !options?.windowScoped &&
        plainRecord(initial) &&
        !Object.keys(initial).length &&
        plainRecord(ref.current) &&
        plainRecord(resolved)
      ) {
        const latest = readStored(localStorage, scoped, initial, decoder);
        if (plainRecord(latest)) {
          const merged: Record<string, unknown> = { ...latest };
          for (const id of new Set([
            ...Object.keys(ref.current),
            ...Object.keys(resolved),
          ]))
            if (
              JSON.stringify(ref.current[id]) !== JSON.stringify(resolved[id])
            ) {
              if (id in resolved) merged[id] = resolved[id];
              else delete merged[id];
            }
          resolved = merged as T;
        }
      }
      // Journal before React schedules a paint; persistence does not depend on a
      // passive effect surviving a renderer crash or a quick window change.
      ref.current = resolved;
      try {
        localStorage.setItem(scoped, JSON.stringify(resolved));
        if (options?.windowScoped)
          localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        storageWarning();
      }
      updateValue(resolved);
    },
    [scoped, options?.windowScoped],
  );
  return [ref.current, setValue] as const;
}
export function useDraftJournal() {
  const journal = useRef<DraftJournal | undefined>(undefined);
  if (!journal.current)
    journal.current = new DraftJournal(
      localStorage,
      window.workbench?.windowKey || "primary",
    );
  const [drafts, setValue] = useState<Record<string, ChatDraft>>(() => {
    try {
      journal.current!.migrateLegacy();
    } catch {
      queueMicrotask(storageWarning);
    }
    return journal.current!.own();
  });
  const ref = useRef(drafts);
  const [, changed] = useState(0);
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key?.startsWith("workbench.draft.")) {
        journal.current!.invalidateForeign();
        changed((value) => value + 1);
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);
  const setDrafts = useCallback(
    (
      next:
        | Record<string, ChatDraft>
        | ((old: Record<string, ChatDraft>) => Record<string, ChatDraft>),
    ) => {
      const resolved = typeof next === "function" ? next(ref.current) : next;
      for (const [id, value] of Object.entries(resolved))
        if (JSON.stringify(value) !== JSON.stringify(ref.current[id]))
          try {
            journal.current!.write(id, value);
          } catch {
            storageWarning();
          }
      ref.current = resolved;
      setValue(resolved);
    },
    [],
  );
  const restore = useCallback((id: string, source: DraftEntry) => {
    try {
      const value = journal.current!.restore(id, source);
      ref.current = { ...ref.current, [id]: value };
      setValue(ref.current);
    } catch {
      storageWarning();
    }
  }, []);
  return {
    drafts,
    setDrafts,
    read: (id: string) => journal.current!.read(id),
    foreign: (id: string) => journal.current!.foreign(id),
    restore,
  };
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
