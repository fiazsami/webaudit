import { describe, expect, it, vi } from "vitest";

import { snapshotWith } from "../../analyzers/__tests__/snapshot-factory.js";
import type { Capabilities, ProgressEvent } from "../../capabilities.js";
import { silentLogger } from "../../logger.js";
import { audit } from "../run.js";
import { AuditResultSchema } from "../schema.js";

/**
 * A Capabilities stand-in with only the members M1 uses. The rest throw when
 * touched, so a test fails loudly rather than quietly exercising a stub.
 */
function testCapabilities(overrides: Partial<Capabilities> = {}): {
  capabilities: Capabilities;
  events: ProgressEvent[];
} {
  const events: ProgressEvent[] = [];
  let tick = 1_000;

  const unavailable = (name: string): never => {
    throw new Error(`capability not available in this test: ${name}`);
  };

  const capabilities: Capabilities = {
    logger: silentLogger,
    clock: {
      now: () => {
        tick += 5;
        return tick;
      },
    },
    progress: {
      emit: (event: ProgressEvent) => {
        events.push(event);
      },
    },
    get http() {
      return unavailable("http");
    },
    get store() {
      return unavailable("store");
    },
    get provider() {
      return unavailable("provider");
    },
    get dom() {
      return unavailable("dom");
    },
    ...overrides,
  };

  return { capabilities, events };
}

describe("audit", () => {
  it("returns a result that validates against the schema", async () => {
    const { capabilities } = testCapabilities();
    const result = await audit(snapshotWith(), { capabilities, noAgent: true });

    expect(() => AuditResultSchema.parse(result)).not.toThrow();
    expect(result.finishedAt).toBeGreaterThan(result.startedAt);
  });

  it("refuses the agent mode that does not exist yet", async () => {
    const { capabilities } = testCapabilities();
    await expect(audit(snapshotWith(), { capabilities })).rejects.toThrow(/M6/);
  });

  it("validates the snapshot even when a host claims it is well formed", async () => {
    const { capabilities } = testCapabilities();
    const malformed = { ...snapshotWith(), url: "not-a-url" };

    await expect(audit(malformed, { capabilities, noAgent: true })).rejects.toThrow();
  });

  it("runs the analyzers it is given and reports their findings", async () => {
    const { capabilities } = testCapabilities();
    const result = await audit(
      snapshotWith({ protocol: "http:", url: "http://x.example/" }),
      { capabilities, noAgent: true },
    );

    expect(result.findings.map((finding) => finding.ruleId)).toContain(
      "insecure-protocol",
    );
  });

  it("reads the clock only through the capability", async () => {
    const now = vi.fn(() => 1_700_000_000_000);
    const { capabilities } = testCapabilities({ clock: { now } });

    const result = await audit(snapshotWith(), { capabilities, noAgent: true });

    expect(now).toHaveBeenCalled();
    expect(result.startedAt).toBe(1_700_000_000_000);
  });

  it("gives the same audit the same id", async () => {
    const fixed = { clock: { now: () => 1_700_000_000_000 } };
    const first = await audit(snapshotWith(), {
      capabilities: testCapabilities(fixed).capabilities,
      noAgent: true,
    });
    const second = await audit(snapshotWith(), {
      capabilities: testCapabilities(fixed).capabilities,
      noAgent: true,
    });

    expect(first.auditId).toBe(second.auditId);
  });

  it("emits progress for the UI to follow", async () => {
    const { capabilities, events } = testCapabilities();
    await audit(snapshotWith(), { capabilities, noAgent: true });

    expect(events.map((event) => event.stage)).toEqual(["analyzers", "analyzers"]);
  });
});
