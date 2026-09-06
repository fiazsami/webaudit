import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { audit, buildSnapshot, PageSnapshotSchema } from "core";
import { describe, expect, it } from "vitest";

import { createLinkedomParser, createNodeCapabilities } from "../capabilities/index.js";

const SNAPSHOT_DIR = fileURLToPath(
  new URL("../../../../fixtures/snapshots/", import.meta.url),
);

async function fixtureNames(): Promise<string[]> {
  const names = await readdir(SNAPSHOT_DIR);
  return names.filter((name) => name.endsWith(".json")).sort();
}

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, `file://${SNAPSHOT_DIR}`), "utf8"));
}

const names = await fixtureNames();

describe("snapshot fixtures", () => {
  it("has fixtures to run against", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s validates against PageSnapshot", async (name) => {
    const raw = await loadFixture(name);
    expect(() => PageSnapshotSchema.parse(raw)).not.toThrow();
  });

  it.each(names)("%s produces findings without throwing", async (name) => {
    const raw = await loadFixture(name);
    const snapshot = PageSnapshotSchema.parse(raw);
    const capabilities = createNodeCapabilities();

    const result = await audit(snapshot, { capabilities, noAgent: true });

    expect(result.url).toBe(snapshot.url);
    // Every finding traces back to a real analyzer and a real rule.
    for (const finding of result.findings) {
      expect(finding.id).toBe(
        `${finding.analyzerId}:${finding.ruleId}:${finding.id.split(":")[2] ?? ""}`,
      );
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it("finds nothing on the well-configured baseline", async () => {
    const raw = await loadFixture("baseline_synthetic.json");
    const snapshot = PageSnapshotSchema.parse(raw);
    const result = await audit(snapshot, {
      capabilities: createNodeCapabilities(),
      noAgent: true,
    });

    // A baseline that reports a real problem is a baseline that has stopped
    // being one. Info findings are allowed and expected: analyzers whose inputs
    // this host cannot collect say so rather than staying quiet.
    const real = result.findings.filter((finding) => finding.severity !== "info");
    expect(real).toEqual([]);
  });

  it("says the header checks did not run, rather than staying quiet", async () => {
    const raw = await loadFixture("baseline_synthetic.json");
    const snapshot = PageSnapshotSchema.parse(raw);
    const result = await audit(snapshot, {
      capabilities: createNodeCapabilities(),
      noAgent: true,
    });

    // The CLI has no privileged refetch, so the headers analyzer cannot run.
    // Reporting nothing would read as a clean bill of health.
    const skipped = result.findings.find(
      (finding) => finding.ruleId === "analyzer-skipped",
    );
    expect(skipped?.summary).toContain("headers");
    expect(skipped?.summary).toContain("not passing");
  });

  it("says the cookie flags are unknown, not missing, when they were not read", async () => {
    const raw = await loadFixture("login-form_synthetic.json");
    const snapshot = PageSnapshotSchema.parse(raw);
    const result = await audit(snapshot, {
      capabilities: createNodeCapabilities(),
      noAgent: true,
    });

    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain("cookie-flags-unknown");
    expect(rules).not.toContain("cookie-missing-secure");
  });
});

describe("the snapshot builder under linkedom", () => {
  it("builds a valid snapshot from real HTML", async () => {
    const html = `<!doctype html>
      <html><head><title>Shop</title>
        <meta name="viewport" content="width=device-width">
      </head><body>
        <script src="/static/app.js" defer></script>
        <script src="https://cdn.other.example/x.js"></script>
        <script>console.log(1)</script>
        <form action="/session" method="post" autocomplete="off">
          <input type="email"><input type="password">
        </form>
        <a href="/privacy">Privacy Policy</a>
        <a href="mailto:a@b.example">Mail us</a>
        <p>Hello there.</p>
      </body></html>`;

    const document = createLinkedomParser().parse(html, "https://shop.example/login");
    const snapshot = await buildSnapshot(document, {
      url: "https://shop.example/login",
      capturedAt: "2026-09-06T12:00:00.000Z",
    });

    expect(() => PageSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.title).toBe("Shop");
    expect(snapshot.scripts.map((script) => script.src)).toEqual([
      "https://shop.example/static/app.js",
      "https://cdn.other.example/x.js",
      undefined,
    ]);
    expect(snapshot.forms[0]).toMatchObject({
      action: "https://shop.example/session",
      method: "POST",
      fieldTypes: ["email", "password"],
      hasPasswordField: true,
      autocompleteOff: true,
    });
    // mailto is not a navigable http(s) target and is dropped.
    expect(snapshot.links).toHaveLength(1);
    expect(snapshot.links[0]?.policyHint).toBe("privacy");
    expect(snapshot.metaTags).toEqual({ viewport: "width=device-width" });
    expect(snapshot.textExcerpt).toContain("Hello there.");
  });
});
