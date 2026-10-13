/** Hidden native views on Windows can stop RAF even with backgroundThrottling=false.
 * Keep the native frame clock when it runs; a cancellable timer only wins if it stalls.
 * Theia awaits a frame during startup, so an unattached view must also make progress.
 */
export function installFrameClock(target: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'setTimeout' | 'clearTimeout' | 'performance'>): () => void {
    const nativeRequest = target.requestAnimationFrame.bind(target);
    const nativeCancel = target.cancelAnimationFrame.bind(target);
    let sequence = 0;
    const pending = new Map<number, { native: number; timer: number }>();
    const request = (callback: FrameRequestCallback): number => {
        const id = ++sequence;
        const finish = (time: number) => {
            const frame = pending.get(id);
            if (!frame) return;
            pending.delete(id);
            nativeCancel(frame.native); target.clearTimeout(frame.timer);
            callback(time);
        };
        const frame = { native: nativeRequest(finish), timer: 0 };
        pending.set(id, frame);
        frame.timer = target.setTimeout(() => finish(target.performance.now()), 50);
        return id;
    };
    const cancel = (id: number) => {
        const frame = pending.get(id);
        if (!frame) return;
        pending.delete(id); nativeCancel(frame.native); target.clearTimeout(frame.timer);
    };
    target.requestAnimationFrame = request;
    target.cancelAnimationFrame = cancel;
    return () => {
        for (const id of pending.keys()) cancel(id);
        if (target.requestAnimationFrame === request) target.requestAnimationFrame = nativeRequest;
        if (target.cancelAnimationFrame === cancel) target.cancelAnimationFrame = nativeCancel;
    };
}
