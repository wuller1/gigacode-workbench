import { contextBridge, ipcRenderer } from "electron";
import type { HostEvent } from "../shared/types";
contextBridge.exposeInMainWorld(
  "workbench",
  Object.freeze({
    windowKey: process.argv
      .find((arg) => arg.startsWith("--workbench-window-key="))
      ?.slice("--workbench-window-key=".length),
    invoke: (method: string, params: Record<string, unknown> = {}) => {
      if (
        typeof method !== "string" ||
        method.length > 100 ||
        !params ||
        typeof params !== "object" ||
        Array.isArray(params)
      )
        return Promise.reject(new Error("Invalid operation"));
      return ipcRenderer.invoke("workbench:invoke", method, params);
    },
    subscribe: (callback: (event: HostEvent) => void) => {
      if (typeof callback !== "function") throw new Error("Callback required");
      const listener = (_event: unknown, event: HostEvent) => callback(event);
      ipcRenderer.on("workbench:event", listener);
      return () => ipcRenderer.removeListener("workbench:event", listener);
    },
  }),
);
