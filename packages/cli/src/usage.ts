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
  --library-db <path>
                  Vulnerable-library database from \`pnpm build-library-db\`
                  (default: data/library-db.json if present).
  --tracker-db <path>
                  Tracker database from \`pnpm build-tracker-db\`
                  (default: data/tracker-db.json if present).
  --replay <path> A recorded model session (docs/04). The only way this
                  host gets a model: Node has no WebGPU.
  --explain       Have the model write each finding's explanation.
                  Requires --replay here.
  --terms         Fetch and read the site's policy pages (docs/05).
                  Requires --replay here.
  --verbose       Print progress and debug output to stderr.
  -h, --help      Show this message.

Live inference is not available in this host: Node has no WebGPU. The agent
loop arrives in M6 and is exercised here through recorded traces. See docs/01.
`;
