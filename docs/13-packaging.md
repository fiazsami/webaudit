# 13 — Building and loading the extension

There is no store listing. The extension is loaded unpacked from source, which
is the right shape for a research project and keeps the "everything runs on your
machine" claim honest — you built the thing you are running.

## Build

```
pnpm install
pnpm -r build
```

That produces `packages/extension/.output/chrome-mv3/`.

Three data sets are optional and downloaded separately. Without them the
analyzers that need them report themselves skipped rather than passing, so a
build with none of them still works — it just knows less.

```
pnpm build-tracker-db      # CC BY-NC-SA 4.0 — non-commercial (docs/10)
pnpm build-library-db      # retire.js advisories, Apache-2.0
pnpm build-hsts-preload    # 740 KB gzipped; optional, see docs/03
```

Run them before `pnpm -r build`: the extension build stages whatever exists into
its own resources.

## Load it

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked**, and choose `packages/extension/.output/chrome-mv3`.

Chrome 137 and later ignore `--load-extension` on the command line, including
outside automation — this was measured, not assumed (docs/11 S3). Loading
through the UI is the only route.

## Use it

Open the side panel from the extension's toolbar button, then:

| Button           | What it does                                                |
| ---------------- | ----------------------------------------------------------- |
| Audit this page  | Deterministic analyzers only. Fast, no model, no download.  |
| Explain findings | Plain-language explanations. First use downloads the model. |
| Read the terms   | Finds and reads the site's policies. Minutes, not seconds.  |
| Full audit       | The agent loop: headers, analyzers, policies, explanations. |

**The first model download is about 1.1 GB** for the default Qwen2.5-1.5B, from
HuggingFace and `raw.githubusercontent.com`. It happens once and is cached by
the browser. Nothing else leaves the machine except fetches of policy pages the
audit was permitted to follow (docs/12).

"Open the workbench" at the bottom of the panel gives history and the trace
view in a full tab.

## Requirements

A Chromium browser with WebGPU. Measured on Chrome 152 on an Apple M4; anything
with working WebGPU and enough VRAM for the model should do.

Firefox 155 has working WebGPU including `shader-f16`, and `pnpm --filter
extension exec wxt build -b firefox` produces an MV2 build with the side panel
mapped to `sidebar_action`. Whether WebLLM runs there is untested — the platform
was measured, the library was not. Try it with `about:debugging` → **This
Firefox** → **Load Temporary Add-on**, choosing the manifest in
`packages/extension/.output/firefox-mv2/`.

## A local page to try it on

```
pnpm serve-fixture
```

Serves a deliberately misconfigured page at `http://localhost:8787/`, so the
tool can be exercised without auditing somebody else's site.
`fixtures/site/README.md` lists what it should find.
