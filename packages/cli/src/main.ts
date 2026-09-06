#!/usr/bin/env node
import { parseArgs } from "node:util";

import { runAuditCommand } from "./commands/audit.js";
import { USAGE } from "./usage.js";

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command !== "audit") {
    process.stderr.write(`webaudit: unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const { values, positionals } = parseArgs({
    args: [...argv.slice(1)],
    allowPositionals: true,
    options: {
      "no-agent": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "no-store": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      out: { type: "string" },
      "hsts-preload": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const snapshotPath = positionals[0];
  if (snapshotPath === undefined) {
    process.stderr.write(`webaudit: audit needs a snapshot path\n\n${USAGE}`);
    return 1;
  }

  await runAuditCommand({
    snapshotPath,
    noAgent: values["no-agent"],
    json: values.json,
    noStore: values["no-store"],
    verbose: values.verbose,
    ...(values.out === undefined ? {} : { outDir: values.out }),
    ...(values["hsts-preload"] === undefined
      ? {}
      : { hstsPreloadPath: values["hsts-preload"] }),
  });

  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `webaudit: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
