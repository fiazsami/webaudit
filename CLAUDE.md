# CLAUDE.md — WebAudit

Local-first website auditing agent. A browser extension captures a page snapshot,
sends it to an Electron desktop app over a localhost WebSocket, and a TypeScript
agent runtime produces security findings and a plain-language reading of the
site's terms of service.

This is a research project. The goal is to learn how to build a local agent for a
moderately complex system. Prefer simple, inspectable code over frameworks until a
framework's value is obvious.

## Read these first

- `README.md` — project overview and current status
- `docs/01-architecture.md` — package layout and data flow
- `docs/11-roadmap.md` — milestones; work on the lowest incomplete milestone
- The doc for the subsystem you are touching (`docs/02`–`docs/10`)

## Repository layout

```
packages/core        agent runtime — NO electron, browser, or DOM imports
packages/desktop     Electron app: main (bridge, sqlite), preload, renderer
packages/extension   MV3 extension built with WXT
fixtures/            saved PageSnapshot JSON + policy texts for tests and evals
docs/                design docs (this set)
```

Package manager: pnpm workspaces. Language: TypeScript everywhere, strict mode.

## Hard rules

1. `packages/core` must run in plain Node with no Electron or browser globals.
   Everything in it should be runnable from a CLI against `fixtures/`.
2. All data crossing a boundary (extension → app, app → model, model → app) is
   validated with a zod schema. No `any` at boundaries.
3. Deterministic analyzers never call a model. Model calls only happen in
   `core/providers` via the `ModelProvider` interface.
4. Page content, policy text, and anything fetched from the web is untrusted
   input. It goes into prompts inside clearly delimited data blocks and never
   drives a tool call without passing through a schema-validated step first.
   See `docs/12-threat-model.md`.
5. The agent loop enforces budgets (max steps, max fetches, max tokens, allowed
   domains). Budgets are constructor arguments, not constants buried in code.
6. Every model call is recorded in an `AuditTrace` so runs are reproducible.
7. No telemetry. Nothing leaves the machine except calls to the model provider
   the user explicitly selected, and fetches of policy pages the agent was
   permitted to follow.

## Conventions

- Types live next to their zod schema: `export const FindingSchema = z.object(...)`
  and `export type Finding = z.infer<typeof FindingSchema>`.
- Analyzers export `{ id, run(snapshot, ctx): Promise<Finding[]> }`. See docs/03.
- Tools export `{ name, description, input: ZodSchema, run(input, ctx) }`. See docs/06.
- Tests: vitest. Analyzer tests use fixtures, never the network.
- Prompt evals: promptfoo configs under `packages/core/evals/`.
- Commit messages: `scope: summary` where scope is core/desktop/extension/docs.

## Commands (once scaffolded)

```
pnpm install
pnpm -r build
pnpm --filter core test
pnpm --filter core cli audit fixtures/snapshots/example.json   # run agent on a fixture
pnpm --filter desktop dev
pnpm --filter extension dev                                     # WXT dev server
```

## When unsure

Check `docs/` before inventing a new shape. If a design doc is wrong or missing,
update the doc in the same change as the code.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
