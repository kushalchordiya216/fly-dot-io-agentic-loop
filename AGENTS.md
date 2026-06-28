# FlyDotIO — Agentic Problem-Solving Loop

Build an autonomous agent that fetches coding problems, solves them, tests the
solution, iterates until correct, then moves to the next problem. All fully
autonomous, running as a TypeScript process that calls the opencode Zen LLM.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node 24 + tsx |
| Language | TypeScript (strict, ES2022, bundler resolution) |
| LLM Gateway | `@earendil-works/pi-ai` — opencode Zen, deepseek-v4-flash-free |
| Auth | `OPENCODE_API_KEY` in `.env` (gitignored) |
| CLI + PRs | Graphite (`gt`) |
| Host | GitHub (`kushalchordiya216/fly-dot-io-agentic-loop`) |

## Architecture

```
src/
  index.ts          # agent loop: call model → execute tools → repeat
  tools/
    web-fetch.ts    # fetch URL, extract content via Mozilla Readability
    bash.ts         # async process mgmt: spawn / status / kill
    index.ts        # tool registry + dispatcher
```

The loop starts with a user prompt + tool definitions. Each turn:
1. Call `models.complete()` with context + tools
2. Check response for `toolCall` blocks
3. Execute tools, push `toolResult` messages back to context
4. Repeat until no more tool calls → final text output

## Current Progress

### Done
- [x] TypeScript project bootstrapped (tsconfig, tsx runner, strict mode)
- [x] pi-ai integration with opencode Zen provider
- [x] Auth via `OPENCODE_API_KEY` env var (loaded from `.env` via `--env-file`)
- [x] `web_fetch` tool — HTTP GET + Mozilla Readability extraction → markdown/text
- [x] `bash_spawn` — launch command in background, return process ID
- [x] `bash_status` — poll process state + accumulated stdout/stderr
- [x] `bash_kill` — send signal (SIGTERM/SIGKILL/SIGINT/USR1/USR2)
- [x] Process registry with auto-cleanup (reap after 1min, auto-kill orphans on exit)
- [x] Repo created on GitHub, initial commit pushed to `main`

### In Flight
- [ ] **PR #1** (`tools` → `main`): Adds all three tools. PR body is stale
      (says "bash" singular); needs updating to describe the async
      spawn/status/kill trio.
- [ ] **Agent loop entrypoint** (`src/index.ts`) is the original single-call
      example, not yet wired to the tools. Needs rewrite to use the tool
      definitions and loop over tool calls.
- [ ] **Problem fetcher** — no problem source defined yet (LeetCode? Advent of
      Code? custom?). The loop can't run autonomously until this exists.
- [ ] **System prompt** — the agent needs a proper prompt describing the
      problem-solving workflow, iteration limits, coding conventions.

### Blocked
Nothing currently blocked. Next step is to wire the tool loop in
`src/index.ts`.

## Important Artifacts

- **`.env`** (gitignored) — `OPENCODE_API_KEY` for LLM auth
- **`src/tools/bash.ts`** — in-memory `Map<string, ProcessEntry>` tracks all
  background processes across turns. Auto-cleanup every 30s via `setInterval`.
- **PR #1** — https://github.com/kushalchordiya216/fly-dot-io-agentic-loop/pull/1

## Development Workflow

### Graphite (PR stack management)

Use `gt` for all branch and PR operations, never raw `git` for branching:

```
gt create -am "msg"          # create branch, stage all, commit
gt modify -cam "msg"         # add a new commit to current branch
gt submit                    # push current branch, create/update PR
gt ss                        # push all branches in stack
gt sync                      # pull trunk, restack, clean up
gt log / gt ls               # view stack
gt up / gt down              # navigate stack
gt squash                    # squash all commits in current branch into one
```

`main` is the trunk. Every feature/fix gets its own branch off `main` (or off
another branch in a stack). The trunk is never committed to directly.

### Git Hygiene

- **Small commits** — each commit is a single logical change. If it needs
  "and also" in the message, it should be two commits.
- **Descriptive but short messages** — imperative mood, ≤72 chars subject,
  blank line + bullets for context if needed.
- **No WIP commits on shared branches** — squash before submitting.
- **`.env` never committed** — already in `.gitignore`.

### npm Tooling

```
npm start          # node --env-file .env --import tsx/esm src/index.ts
npm run typecheck  # tsc --noEmit
npm run build      # tsc
```

Always run `typecheck` before submitting/committing. Keep `tsc --noEmit`
clean.
