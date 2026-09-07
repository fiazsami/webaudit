# Spike S2 — WebLLM in an extension page

The measurement harness for docs/11 spike S2. Kept rather than deleted: it is
the reproducible artifact behind the numbers now in docs/05 §4 and the
cancellation findings in docs/06, and re-running it is how those numbers get
re-checked when WebLLM changes.

```
pnpm --filter extension build     # or WEBAUDIT_SPIKE=1 for the driver route
node scripts/run-spike-s2.mjs Qwen2.5-1.5B-Instruct-q4f16_1-MLC
```

The driver launches Chrome, runs each probe, and writes JSON to `s2-results.json`
(override with `S2_OUT`). `S2_MAIN_THREAD=1` runs the engine on the main thread
instead of in a Web Worker.

## Why it is served over http://localhost

Chrome refuses automated navigation to `chrome-extension://` pages. Every route
was tried: `--load-extension`, the CDP `Extensions.loadUnpacked` domain (which
does load the extension and return its id), browser-initiated
`Target.createTarget`, adding the page to `web_accessible_resources`, and
enabling developer mode in the profile. All still give `ERR_BLOCKED_BY_CLIENT`.

So the driver serves the built output over `http://localhost` and the page
carries the manifest's CSP in a `<meta>` tag. WebGPU, the WASM runtime, and the
model-host `connect-src` are then under identical constraints. What this route
cannot demonstrate is the side panel's own document lifetime — that is the one
part of S2 that needs a human to open the panel.

That difference is not academic. The wrong `connect-src` did not surface as an
error while the engine ran in a Web Worker; it only failed visibly under the
document's own policy on the main thread. Both paths are worth running.

## What it probes

| Probe          | Question                                                          |
| -------------- | ----------------------------------------------------------------- |
| `webgpuInfo`   | Is WebGPU there, and with what limits                             |
| `load`         | Cold load time, VRAM, context window, whether integrity is pinned |
| `schemaRun`    | Does `response_format` honour a real zod schema                   |
| `prefillCurve` | Prefill throughput against prompt size — what chunk sizing needs  |
| `cancelRun`    | Does `interruptGenerate()` work, and is the engine usable after   |
