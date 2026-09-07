/**
 * Drives spike S2 (docs/11): launches Chrome with the built extension loaded, opens the
 * spike page (an extension page, so it inherits the manifest CSP), and runs the
 * probes over CDP.
 *
 * Headed, not headless: WebGPU on macOS is unreliable without a real window,
 * and the point is to measure the hardware the tool will actually run on.
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXTENSION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/extension/.output/chrome-mv3",
);

const models = process.argv.slice(2);
// Zero models is a valid dry run: extension loads, page runs, WebGPU probed.

const userDataDir = await mkdtemp(join(tmpdir(), "s2-chrome-"));

const PORT = 8788;
const root = EXTENSION;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
};
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));
console.error(`serving ${root} on http://localhost:${PORT}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir,
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    // Chrome 137+ ignores --load-extension under automation unless this is
    // turned back off. Without it the extension silently never loads and every
    // navigation to its pages is ERR_BLOCKED_BY_CLIENT.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  protocolTimeout: 30 * 60 * 1000,
});

// Chrome refuses automated navigation to chrome-extension:// pages by every
// route tried (--load-extension, CDP Extensions.loadUnpacked, browser-initiated
// Target.createTarget, web_accessible_resources, developer mode in the
// profile). So the harness is served over http://localhost from the same built
// output, carrying the manifest's CSP in a meta tag. WebGPU, WASM and the
// weight-CDN connect-src are then under identical constraints; what this route
// cannot demonstrate is the side panel's own document lifetime.
const spikeUrl = `http://localhost:${PORT}/spike-s2.html`;

const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "info" || m.type() === "error")
    console.error(`  [page] ${m.text()}`);
});
page.on("pageerror", (e) => console.error(`  [page error] ${e.message}`));

await page.goto(spikeUrl, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction("window.__s2 !== undefined", { timeout: 60_000 });

const results = { chrome: await browser.version(), harness: spikeUrl, models: {} };

results.webgpu = await page.evaluate("window.__s2.webgpuInfo()");
console.error("webgpu:", JSON.stringify(results.webgpu));

for (const modelId of models) {
  console.error(`\n=== ${modelId} ===`);
  const entry = {};
  try {
    const inWorker = process.env.S2_MAIN_THREAD !== "1";
    entry.load = await page.evaluate(
      `window.__s2.load(${JSON.stringify(modelId)}, ${String(inWorker)})`,
    );
    console.error("load:", JSON.stringify(entry.load));

    entry.schema = await page.evaluate("window.__s2.schemaRun()");
    console.error(
      "schema ok:",
      entry.schema.ok,
      "| decode tok/s:",
      entry.schema.decodeTokensPerSec,
    );

    // Prefill before cancel: an interrupt that leaves the engine wedged would
    // otherwise silently poison the throughput numbers, which is exactly what
    // happened on the first run.
    entry.prefill = await page.evaluate("window.__s2.prefillCurve([256, 1024, 2048])");
    console.error("prefill:", JSON.stringify(entry.prefill));

    entry.cancel = await page.evaluate("window.__s2.cancelRun()");
    console.error("cancel:", JSON.stringify(entry.cancel));

    // If nothing short of a fresh engine recovers from an interrupt, that is
    // the workaround, and its cost is the reload time.
    if (entry.cancel && entry.cancel.engineUsableAfterReload === false) {
      const started = Date.now();
      entry.recreate = await page.evaluate(
        `window.__s2.load(${JSON.stringify(modelId)}, ${String(inWorker)})`,
      );
      const check = await page.evaluate("window.__s2.schemaRun()");
      entry.recreate.recoveredMs = Date.now() - started;
      entry.recreate.usable = check.ok;
      console.error(
        "recreate engine:",
        JSON.stringify({ ms: entry.recreate.recoveredMs, usable: check.ok }),
      );
    }
  } catch (error) {
    entry.error = String(error);
    console.error("FAILED:", entry.error);
  }
  results.models[modelId] = entry;
  await page.evaluate("window.__s2.unload()").catch(() => {});
}

await writeFile(
  process.env.S2_OUT ?? "s2-results.json",
  JSON.stringify(results, null, 2),
);
console.error("\nwrote results");
await browser.close();
server.close();
