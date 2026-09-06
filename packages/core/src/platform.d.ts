/**
 * `URL` and `AbortSignal` are WHATWG web standards present in every runtime we target — browsers,
 * Node, and workers — but TypeScript only ships its type in `lib.dom` and in
 * `@types/node`, neither of which core is allowed to load (CLAUDE.md hard rule
 * 1, enforced by the empty `types` array in tsconfig.json).
 *
 * Declaring the shape here keeps the tsconfig strict while letting core do URL
 * arithmetic. This file is for language-level web standards only. A host API —
 * anything from the DOM, `chrome.*`, or Node — belongs in `Capabilities`
 * instead, never here.
 */

declare class AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly origin: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly host: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
  toString(): string;
}
