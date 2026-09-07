// @vitest-environment happy-dom
import { createFinding, type Finding, type FindingInput } from "core";
import { describe, expect, it } from "vitest";

import { renderFindings } from "../render.js";

function finding(overrides: Partial<FindingInput> = {}): Finding {
  return createFinding({
    analyzerId: "transport",
    ruleId: "insecure-protocol",
    severity: "high",
    confidence: "high",
    title: "Page served over HTTP",
    summary: "The page was loaded over an unencrypted connection.",
    evidence: [{ kind: "other", value: "http://example.com/" }],
    ...overrides,
  });
}

function render(findings: Finding[]): HTMLElement {
  const host = document.createElement("div");
  host.append(renderFindings(findings));
  return host;
}

describe("renderFindings", () => {
  it("says something useful when there is nothing to report", () => {
    expect(render([]).textContent).toContain("No findings");
  });

  it("renders one element per finding", () => {
    const host = render([
      finding(),
      finding({ ruleId: "mixed-content", evidence: [{ kind: "script", value: "a" }] }),
    ]);
    expect(host.querySelectorAll(".finding")).toHaveLength(2);
  });

  it("opens critical and high findings without a click", () => {
    const host = render([
      finding({ severity: "critical" }),
      finding({ severity: "low", evidence: [{ kind: "other", value: "b" }] }),
    ]);
    const details = [...host.querySelectorAll("details.finding")];
    expect(details.map((element) => (element as HTMLDetailsElement).open)).toEqual([
      true,
      false,
    ]);
  });

  it("counts findings by severity", () => {
    const host = render([
      finding({ severity: "high" }),
      finding({ severity: "low", evidence: [{ kind: "other", value: "b" }] }),
    ]);
    expect(host.querySelector(".counts")?.textContent).toContain("1 high");
    expect(host.querySelector(".counts")?.textContent).toContain("1 low");
  });

  it("treats page-controlled text as data, never as markup", () => {
    // A site can put anything in its own title, and it reaches a finding's
    // evidence verbatim. It must never become live DOM (docs/12 T1).
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const host = render([
      finding({
        title: hostile,
        summary: hostile,
        evidence: [{ kind: "other", value: hostile, location: hostile }],
      }),
    ]);

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("onerror");
  });

  it("marks a model-written explanation as such", () => {
    const host = render([
      { ...finding(), explanation: "Anyone on the network can read the password." },
    ]);
    const explanation = host.querySelector(".explanation");

    // A reader must be able to tell which sentences a model wrote.
    expect(explanation?.textContent).toContain("Written by the model");
    expect(explanation?.textContent).toContain("read the password");
  });

  it("renders no explanation block when the model did not write one", () => {
    expect(render([finding()]).querySelector(".explanation")).toBeNull();
  });

  it("treats a model-written explanation as text, not markup", () => {
    // The model reads page-controlled evidence, so its output is untrusted too.
    const host = render([
      { ...finding(), explanation: '<img src=x onerror="alert(1)">' },
    ]);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("onerror");
  });

  it("marks reference links so they cannot reach back into the panel", () => {
    const host = render([finding({ references: ["https://example.com/docs"] })]);
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
  });
});
