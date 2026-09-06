/**
 * The logging capability (docs/01). A host implements it; core only calls it.
 * Kept separate from the rest of `Capabilities` because analyzers receive a
 * logger and nothing else from the outside world (docs/03).
 */
export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

/** Discards everything. Useful in tests that do not assert on logging. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
