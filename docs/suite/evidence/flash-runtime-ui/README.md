# Flash runtime acceptance evidence

`report.json` is the latest **actual built Electron application** run on the recorded platform. Its `status`, source hashes, exact assertion groups, pixel hashes, and cleanup result are authoritative. Failed iterations remain under `attempts/`; a passing native registry probe does not make a failed application run pass.

Run from the repository root after freezing and building the application:

```text
npm --prefix app run build
node app/tools/test-flash-runtime-ui.mjs
node app/tools/test-managed-qwen-policy.mjs
```

The application driver owns its temporary data directory, project files, ACP subprocesses, local stdio MCP bridge, and fake credential. It edits the actual queue, delegates through the actual UI, checks real child processes and terminal acknowledgements, verifies dependency/write-scope admission, exercises human reconciliation and fresh followup, tests predispatch HTML 429 retry, configures the text vision bridge, and checks context rotation with a real ACP usage event. Light/dark captures cover desktop widths 1024 and 1440. Visible settings controls are checked for centre interception; intentionally scrolled-out controls are excluded. Source and built-asset hashes must remain unchanged throughout a successful run.

The MCP vision fixture receives actual PNG bytes and returns deterministic **text**. This verifies image transport, exact-byte/query cache binding, schema rejection, compare-and-swap settings, and secret redaction. It does not verify the visual understanding or design judgement of Qwen 3.6 Flash. No corporate service, real provider, paid model, Windows host, certificate store, or workplace GigaCode fork is exercised by this driver. `--baseline` skips context groups and explicitly reports `partial-baseline`, never `passed` for the full suite.

`managed-qwen-readonly.json` separately records unmodified Qwen 0.25.1 ACP initialize/session-new and its native tool registry. The owned loopback provider rejects any request and its count must remain zero. The reviewed per-executor exclusions remove the native `Agent` registry entry. `CreateSubSession` is absent in this probe's baseline, so no observed removal is claimed for it. Unknown GigaCode forks require their own reviewed capability evidence; no speculative flag or CLI patch is applied.

These receipts establish the listed protocol/UI assertions only. They do not certify that every failure is recoverable, that arbitrary native tool side effects are isolated, or that a layout is aesthetically good. Human readback in this driver is justified by its owned fixture having no external write implementation; real remote effects require their own receipts and reconciliation.

`--diagnostic-continue` collects independent later assertion groups after a failure so one frozen build can reveal more defects. Every failed group retains its error and pixel capture, the process exits unsuccessfully, and the overall receipt stays `failed`. Default final acceptance remains fail-fast; diagnostics never turn a failing group into a pass.
