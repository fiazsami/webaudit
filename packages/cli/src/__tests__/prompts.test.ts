import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ORCHESTRATOR_PROMPT } from "core";
import { describe, expect, it } from "vitest";

/**
 * The orchestrator prompt lives in a `.md` file so it can be reviewed as prose
 * (docs/06), and a generated module carries it into core, which cannot read
 * files. These checks live here because this is the host that can.
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("the generated orchestrator prompt", () => {
  it("still matches the markdown it came from", () => {
    // Fails the build if someone edits the .md and forgets `pnpm build-prompts`,
    // or edits the generated file directly.
    execFileSync("node", [`${ROOT}scripts/build-prompts.mjs`, "--check"], {
      stdio: "pipe",
    });
  });

  it("is byte-for-byte the markdown file", async () => {
    const markdown = await readFile(
      `${ROOT}packages/core/src/agent/prompts/orchestrator.md`,
      "utf8",
    );
    expect(ORCHESTRATOR_PROMPT).toBe(markdown);
  });
});
