import { afterEach, expect, it, vi } from 'vitest';
import { installFrameClock } from '../../ide/extensions/workbench-bridge/src/frame-clock';
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const callbacks = new Map<number, FrameRequestCallback>(); let next = 0;
  const target = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; },
    cancelAnimationFrame: (id: number) => { callbacks.delete(id); },
    setTimeout: ((fn: () => void, delay: number) => setTimeout(fn, delay)) as unknown as Window['setTimeout'],
    clearTimeout: ((id: number) => clearTimeout(id)) as Window['clearTimeout'],
    performance: { now: () => 500 } as Performance,
  };
  const restore = installFrameClock(target);
  return { target, callbacks, restore };
}
it('hidden Windows native view progresses when Chromium emits no frames', () => {
  const { target, callbacks } = setup(); const callback = vi.fn();
  target.requestAnimationFrame(callback); vi.advanceTimersByTime(50);
  expect(callback).toHaveBeenCalledExactlyOnceWith(500); expect(callbacks.size).toBe(0);
});
it('native frames win without duplicate timer calls', () => {
  const { target, callbacks } = setup(); const callback = vi.fn();
  target.requestAnimationFrame(callback); [...callbacks.values()][0](123); vi.advanceTimersByTime(100);
  expect(callback).toHaveBeenCalledExactlyOnceWith(123);
});
it('cancellation suppresses both clocks and chained callbacks remain independent', () => {
  const { target, callbacks, restore } = setup(); const callback = vi.fn();
  const id = target.requestAnimationFrame(callback); target.cancelAnimationFrame(id); vi.advanceTimersByTime(100);
  expect(callback).not.toHaveBeenCalled(); expect(callbacks.size).toBe(0);
  target.requestAnimationFrame(() => target.requestAnimationFrame(callback)); vi.advanceTimersByTime(50);
  expect(callback).not.toHaveBeenCalled(); vi.advanceTimersByTime(50); expect(callback).toHaveBeenCalledOnce();
  restore();
});
