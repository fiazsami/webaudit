#!/usr/bin/env node
import { USAGE } from "./usage.js";

/** Argument parsing and the audit command land in M1 (docs/11). */
function main(argv: readonly string[]): number {
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  process.stderr.write(`webaudit: not implemented yet: ${command}\n\n${USAGE}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
