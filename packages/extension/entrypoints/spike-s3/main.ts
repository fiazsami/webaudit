/**
 * The offscreen document under test in spike S3 (docs/11).
 *
 * Three questions: is WebGPU available here at all, does it stay available, and
 * does Chrome close this document when it goes idle. The last one is the reason
 * the spike exists — an offscreen document that Chrome reclaims mid-audit is
 * worse than the side panel, which at least dies visibly when the user closes
 * it (docs/08).
 *
 * It reports by messaging the background worker rather than rendering, because
 * nothing ever looks at an offscreen document.
 */

interface Report {
  at: number;
  gpu: { available: boolean; vendor?: string; architecture?: string; error?: string };
  aliveMs: number;
}

const startedAt = Date.now();

async function probe(): Promise<Report> {
  const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
  if (gpu === undefined) {
    return {
      at: Date.now(),
      gpu: { available: false, error: "navigator.gpu is undefined" },
      aliveMs: Date.now() - startedAt,
    };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      return {
        at: Date.now(),
        gpu: { available: false, error: "requestAdapter returned null" },
        aliveMs: Date.now() - startedAt,
      };
    }
    const info = adapter.info as unknown as {
      vendor?: string;
      architecture?: string;
    };
    return {
      at: Date.now(),
      gpu: {
        available: true,
        ...(info.vendor === undefined ? {} : { vendor: info.vendor }),
        ...(info.architecture === undefined ? {} : { architecture: info.architecture }),
      },
      aliveMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      at: Date.now(),
      gpu: { available: false, error: String(error) },
      aliveMs: Date.now() - startedAt,
    };
  }
}

async function report(kind: string): Promise<void> {
  await browser.runtime
    .sendMessage({ id: "s3", type: "s3.report", payload: { kind, ...(await probe()) } })
    .catch(() => undefined);
}

void report("created");

// A heartbeat, so the background worker can tell "still alive" from "closed".
// Deliberately silent otherwise: any timer at all may itself keep the document
// from being reclaimed, which is one of the things worth finding out.
setInterval(() => {
  void report("heartbeat");
}, 5_000);
