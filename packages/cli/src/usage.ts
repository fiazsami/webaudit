/**
 * The CLI is a Node host for `core`: analyzers, the non-model ToS stages, and
 * replay-mode agent runs. It deliberately cannot run live inference — Node has
 * no WebGPU, so the only `ModelProvider` it ever holds is `RecordingProvider`
 * (docs/01).
 */
export const USAGE = `webaudit — local website auditing (Node host)

Usage:
  webaudit audit <snapshot.json> [--no-agent]

Commands:
  audit    Run analyzers over a saved PageSnapshot. With a recorded trace,
           replays the agent loop; otherwise pass --no-agent.

Live inference is not available in this host. See docs/01.
`;
