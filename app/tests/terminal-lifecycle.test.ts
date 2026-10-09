import { afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("@lydell/node-pty", () => native);
import { TerminalService } from "../electron/terminal";

function fixture(emit = vi.fn()) {
  let data: ((value: string) => void) | undefined;
  let exit: ((value: { exitCode: number }) => void) | undefined;
  const child = {
    pid: 12345,
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn((fn) => {
      data = fn;
      return {
        dispose: vi.fn(() => {
          data = undefined;
        }),
      };
    }),
    onExit: vi.fn((fn) => {
      exit = fn;
      return {
        dispose: vi.fn(() => {
          exit = undefined;
        }),
      };
    }),
  };
  native.spawn.mockReturnValue(child);
  const service = new TerminalService(emit, () => ({
    id: "project",
    name: "Project",
    path: process.cwd(),
    createdAt: "",
  }));
  return {
    service,
    child,
    emit,
    data: (text: string) => data?.(text),
    exit: () => exit?.({ exitCode: 0 }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("terminal lifetime ownership", () => {
  it("awaits actual exit on dispose and suppresses late data / closed-window events", async () => {
    const x = fixture();
    await x.service.invoke("terminal.create", { projectId: "project" });
    x.data("before");
    const closing = x.service.dispose();
    let resolved = false;
    void closing.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(x.child.kill).toHaveBeenCalledTimes(1);
    x.data("after");
    expect(x.emit).toHaveBeenCalledTimes(1);
    await expect(
      x.service.invoke("terminal.create", { projectId: "project" }),
    ).rejects.toThrow("завершаются");
    expect(x.service.dispose()).toBe(closing);
    x.exit();
    expect(await closing).toEqual({ unconfirmed: [] });
    expect(x.emit).toHaveBeenCalledTimes(1);
  });
  it("holds explicit close until exit, rejects writes, and handles repeated close once", async () => {
    const x = fixture();
    const terminal = (await x.service.invoke("terminal.create", {
      projectId: "project",
    })) as { id: string };
    const a = x.service.invoke("terminal.close", { id: terminal.id });
    const b = x.service.invoke("terminal.close", { id: terminal.id });
    await expect(
      x.service.invoke("terminal.write", { id: terminal.id, data: "late" }),
    ).rejects.toThrow("завершается");
    expect(x.child.kill).toHaveBeenCalledTimes(1);
    expect(await x.service.invoke("terminal.list", {})).toHaveLength(1);
    x.exit();
    await Promise.all([a, b]);
    expect(await x.service.invoke("terminal.list", {})).toEqual([]);
    expect(
      x.emit.mock.calls.filter(([event]) => event.type === "terminal.exit"),
    ).toHaveLength(1);
  });
  it("does not throw renderer callback failures through the native emitter", async () => {
    const x = fixture(
      vi.fn(() => {
        throw new Error("webContents is destroyed");
      }),
    );
    await x.service.invoke("terminal.create", { projectId: "project" });
    expect(() => x.data("output")).not.toThrow();
    expect(() => x.exit()).not.toThrow();
    expect(await x.service.dispose()).toEqual({ unconfirmed: [] });
  });
  it.skipIf(process.platform !== "win32")(
    "releases a naturally exited Windows PTY after its callback and awaits cleanup on dispose",
    async () => {
      const x = fixture();
      await x.service.invoke("terminal.create", { projectId: "project" });
      x.exit();
      expect(x.child.kill).not.toHaveBeenCalled();
      expect(await x.service.invoke("terminal.list", {})).toEqual([]);
      const disposal = x.service.dispose();
      expect(await disposal).toEqual({ unconfirmed: [] });
      expect(x.child.kill).toHaveBeenCalledTimes(1);
      expect(x.child.kill).toHaveBeenCalledWith();
      await x.service.dispose();
      expect(x.child.kill).toHaveBeenCalledTimes(1);
    },
  );
  it.skipIf(process.platform !== "win32")(
    "reports failed native handle cleanup instead of confirming disposal",
    async () => {
      const x = fixture();
      const terminal = (await x.service.invoke("terminal.create", {
        projectId: "project",
      })) as { id: string };
      x.child.kill.mockImplementation(() => {
        throw new Error("native cleanup failed");
      });
      x.exit();
      expect(await x.service.dispose()).toEqual({ unconfirmed: [terminal.id] });
      expect(x.child.kill).toHaveBeenCalledTimes(1);
    },
  );
  it.skipIf(process.platform === "win32")(
    "escalates once on POSIX and reports unobserved exit without a false event",
    async () => {
      vi.useFakeTimers();
      const x = fixture();
      const terminal = (await x.service.invoke("terminal.create", {
        projectId: "project",
      })) as { id: string };
      const closing = x.service.dispose();
      await vi.advanceTimersByTimeAsync(1500);
      expect(x.child.kill.mock.calls).toEqual([[], ["SIGKILL"]]);
      await vi.advanceTimersByTimeAsync(1501);
      expect(await closing).toEqual({ unconfirmed: [terminal.id] });
      expect(x.emit).not.toHaveBeenCalled();
      x.exit();
      expect(x.emit).not.toHaveBeenCalled();
    },
  );
});
