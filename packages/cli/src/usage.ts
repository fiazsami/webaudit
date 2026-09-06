/**
 * The CLI is a Node host for `core`: analyzers, the non-model ToS stages, and
 * replay-mode agent runs. It deliberately cannot run live inference — Node has
 * no WebGPU, so the only `ModelProvider` it ever holds is a recording (docs/01).
 */
export const USAGE = `webaudit — local website auditing (Node host)

Usage:
  webaudit audit <snapshot.json> --no-agent [options]

Options:
  --no-agent      Required. Run deterministic analyzers only.
  --json          Emit the AuditResult as JSON instead of a report.
  --out <dir>     Where to write stored audits (default: ./out).
  --no-store      Do not write the result to the store.
  --hsts-preload <path>
                  HSTS preload list from \`pnpm build-hsts-preload\`
                  (default: data/hsts-preload.json if present).
  --verbose       Print progress and debug output to stderr.
  -h, --help      Show this message.

Live inference is not available in this host: Node has no WebGPU. The agent
loop arrives in M6 and is exercised here through recorded traces. See docs/01.
`;
