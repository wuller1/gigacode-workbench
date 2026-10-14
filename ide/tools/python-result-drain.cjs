// SPDX-License-Identifier: Apache-2.0
// The Python process and its result pipe have independent event queues. Process
// exit is not EOF for the structured result stream and must not cancel it.
// POSIX FIFO readers do not reliably emit EOF in the upstream Node adapter.
// The pinned Python sender therefore writes a final protocol barrier after all
// test and coverage messages, on the same ordered stream.
"use strict";
const OUTCOMES = new Set([
    "success", "failure", "error", "skipped", "expected-failure",
    "unexpected-success", "subtest-success", "subtest-failure",
]);
function createResultDrain({ closed, expectedIds, isCancelled, cancelPipe,
    reportIncomplete, timeoutMs = 6000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const expected = [...new Set(expectedIds || [])], observed = new Set();
    let completion, markComplete, completed = false;
    const barrier = new Promise(resolve => { markComplete = resolve; });
    return {
        observe(payload) {
            if (payload?.workbench_run_complete === 1) {
                completed = true; markComplete(); return true;
            }
            if (!payload || typeof payload !== "object" || !payload.result
                || typeof payload.result !== "object" || "coverage" in payload) return;
            for (const [id, result] of Object.entries(payload.result)) {
                if (!result || !OUTCOMES.has(result.outcome)) continue;
                observed.add(id);
                // A subtest has its own result ID and the requested parent ID.
                if (typeof result.test === "string") observed.add(result.test);
            }
        },
        finish() {
            return completion ||= (async () => {
                let timer;
                try {
                    await Promise.race([
                        barrier,
                        // A reader's close event can precede JSONRPC's queued
                        // async decoder callbacks. Only cancellation may finish
                        // immediately; normal close still needs the barrier.
                        Promise.resolve(closed).then(() => isCancelled() || completed ? undefined : barrier),
                        new Promise((_, reject) => {
                            timer = setTimer(() => reject(new Error(
                                "WORKBENCH_RESULT_PIPE_INCOMPLETE: Python exited but its structured result completion barrier did not arrive within " + timeoutMs + " ms.")), timeoutMs);
                        }),
                    ]);
                    if (isCancelled()) return { cancelled: true };
                    const missing = expected.filter(id => !observed.has(id));
                    if (missing.length) {
                        const error = new Error("WORKBENCH_RESULT_PIPE_INCOMPLETE: " + missing.length + " requested Python tests have no terminal structured result.");
                        error.missingIds = missing;
                        throw error;
                    }
                    return { drained: true };
                } catch (error) {
                    if (!isCancelled()) {
                        const incomplete = error instanceof Error ? error : new Error(String(error));
                        if (!incomplete.message.startsWith("WORKBENCH_RESULT_PIPE_INCOMPLETE:"))
                            incomplete.message = "WORKBENCH_RESULT_PIPE_INCOMPLETE: " + incomplete.message;
                        reportIncomplete(incomplete, incomplete.missingIds || expected);
                        throw incomplete;
                    }
                    return { cancelled: true };
                } finally {
                    clearTimer(timer);
                    cancelPipe();
                }
            })();
        },
    };
}
module.exports = { createResultDrain };
