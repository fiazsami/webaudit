import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { audit, MissingRecordingError, PageSnapshotSchema } from "core";
import { describe, expect, it } from "vitest";

import { createNodeCapabilities } from "../capabilities/index.js";
import { loadReplayProvider } from "../replay.js";

/**
 * The M4 definition of done: a recorded session replays green in Node on a
 * machine with no GPU. This test is that claim, and CI is the machine.
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RECORDING = `${ROOT}fixtures/recordings/http-only-explanations.json`;
const SNAPSHOT = `${ROOT}fixtures/snapshots/http-only_synthetic.json`;

async function snapshot() {
  return PageSnapshotSchema.parse(JSON.parse(await readFile(SNAPSHOT, "utf8")));
}

/**
 * Deliberately empty. The tracker and library databases are gitignored
 * downloads, so a recording made with them would replay here and fail in CI —
 * different findings, different prompts, nothing recorded to answer with. The
 * fixture is recorded without them, and so is this.
 */
function databases(): Record<string, never> {
  return {};
}

describe("replaying a recorded model session", () => {
  it("explains findings with no model present", async () => {
    const provider = await loadReplayProvider(RECORDING);
    const result = await audit(await snapshot(), {
      capabilities: createNodeCapabilities({ provider }),
      noAgent: true,
      explain: true,
      ...databases(),
    });

    const explained = result.findings.filter((f) => f.explanation !== undefined);
    expect(explained.length).toBeGreaterThan(0);
    expect(explained[0]?.explanation).toMatch(/In plain terms/);
  });

  it("reproduces the same explanations on every run", async () => {
    const run = async () => {
      const result = await audit(await snapshot(), {
        capabilities: createNodeCapabilities({
          provider: await loadReplayProvider(RECORDING),
        }),
        noAgent: true,
        explain: true,
        ...databases(),
      });
      return result.findings.map((f) => [f.ruleId, f.explanation]);
    };

    expect(await run()).toEqual(await run());
  });

  it("leaves everything except explanation exactly as the analyzers produced it", async () => {
    const options = { noAgent: true as const, ...databases() };
    const plain = await audit(await snapshot(), {
      capabilities: createNodeCapabilities(),
      ...options,
    });
    const explained = await audit(await snapshot(), {
      capabilities: createNodeCapabilities({
        provider: await loadReplayProvider(RECORDING),
      }),
      explain: true,
      ...options,
    });

    // A model may add prose. It may not change a severity, a rule, or evidence.
    expect(explained.findings.map((f) => [f.id, f.ruleId, f.severity])).toEqual(
      plain.findings.map((f) => [f.id, f.ruleId, f.severity]),
    );
  });

  it("refuses a request the recording does not contain", async () => {
    const provider = await loadReplayProvider(RECORDING);

    // A stale recording has to fail the build, not quietly explain nothing.
    await expect(
      provider.complete({
        system: "a prompt that was never recorded",
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 10,
      }),
    ).rejects.toThrow(MissingRecordingError);
  });

  it("still audits when there is no model at all", async () => {
    // explain defaults off, and the Node host's provider throws if touched.
    const result = await audit(await snapshot(), {
      capabilities: createNodeCapabilities(),
      noAgent: true,
      ...databases(),
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.explanation === undefined)).toBe(true);
  });
});
