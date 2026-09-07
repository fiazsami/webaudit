#!/usr/bin/env node
/**
 * Run the model comparison (docs/05 evals, docs/11 M7).
 *
 * Launches Chrome with the built extension, opens the evals page, and runs each
 * model over the labelled policy fixtures. Node cannot drive WebGPU, so a real
 * comparison can only happen in a browser — this is the harness that makes it
 * unattended rather than manual.
 *
 * Headed, not headless: WebGPU on macOS is unreliable without a real window,
 * and the numbers are meant to describe hardware someone actually uses.
 *
 *   pnpm --filter extension build   # with WEBAUDIT_SPIKE=1
 *   node scripts/run-evals.mjs Qwen2.5-0.5B-Instruct-q4f16_1-MLC ...
 */
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(root, "packages/extension/.output/chrome-mv3");
const PORT = 8790;

const models = process.argv.slice(2);
if (models.length === 0) throw new Error("usage: run-evals.mjs <modelId...>");

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".md": "text/markdown",
};
const server = createServer(async (req, res) => {
  try {
    const path = join(
      EXTENSION,
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: process.env.EVALS_PROFILE ?? (await mkdtemp(join(tmpdir(), "evals-"))),
  args: ["--no-first-run", "--no-default-browser-check", "--enable-unsafe-webgpu"],
  protocolTimeout: 60 * 60 * 1000,
});

// Same route as spike S2: Chrome refuses automated navigation to
// chrome-extension:// pages, so the harness is served over localhost with the
// manifest's CSP in a meta tag. See entrypoints/spike-s2/README.md.
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "info" || m.type() === "error") console.error(`  ${m.text()}`);
});
page.on("pageerror", (e) => console.error(`  [page error] ${e.message}`));

await page.goto(`http://localhost:${PORT}/evals.html`, {
  waitUntil: "load",
  timeout: 60_000,
});
await page.waitForFunction("window.__evals !== undefined", { timeout: 60_000 });

const results = [];
for (const modelId of models) {
  results.push(
    await page.evaluate(`window.__evals.runModel(${JSON.stringify(modelId)})`),
  );
}

const run = {
  environment: process.env.EVALS_ENV ?? "unknown hardware",
  startedAt: new Date().toISOString(),
  models: results,
};

const out = process.env.EVALS_OUT ?? join(root, "evals/results/policy-extraction.json");
await writeFile(out, `${JSON.stringify(run, null, 2)}\n`, "utf8");
console.error(`\nwrote ${out}`);

await browser.close();
server.close();
