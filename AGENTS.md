# FlyDotIO — Agentic Problem-Solving Loop

Build an autonomous agent that fetches coding problems, solves them, tests the
solution, iterates until correct, then moves to the next problem. All fully
autonomous, running as a TypeScript process that calls the opencode Zen LLM.

## Freshness Verification — READ THIS FIRST

**Last updated: 2026-07-05**

This file is self-referential. Every section has a `yyyy-mm-dd` date stamp.
Whenever you start a new session, for every section you intend to use:

1. Read its date stamp.
2. If the stamp is older than 7 days from today, **do not assume it is still
   accurate**. Instead, verify by scanning the relevant code/config, or ask the
   user directly whether the section still holds.

### Self-updating rule

Whenever a major architectural decision is made, a TODO is completed/cancelled,
a feature is shipped, or any section's content becomes stale, **update this
file** — bump the date and reflect the new state. Treat AGENTS.md as a living
document, not a historical record.

---

## Stack

**Last updated: 2026-07-05**

| Layer | Choice |
|-------|--------|
| Runtime | Node 24 + tsx |
| Language | TypeScript (strict, ES2022, bundler resolution) |
| LLM Gateway | `@earendil-works/pi-ai` — opencode Zen, deepseek-v4-flash-free |
| Auth | `OPENCODE_API_KEY` in `.env` (gitignored) |
| CLI + PRs | Graphite (`gt`) |
| Host | GitHub (`kushalchordiya216/fly-dot-io-agentic-loop`) |

## Architecture

**Last updated: 2026-07-05**

```
src/
  index.ts              # agent loop: call model → execute tools → repeat
  prompts.ts            # prompt loader: read + cache + template substitution
  crawl-challenges.ts   # challenge crawler: fetch → LLM extract → save JSON
  subagent.ts           # generic subagent runner (scoped tools, bounded iterations)
  subagent-registry.ts  # Singleton tracking all running subagents (handles, abort, event queues)
  tools/
    web-fetch.ts        # fetch URL, extract content via Mozilla Readability
    bash.ts             # async process mgmt: spawn / status / kill
    file-read.ts        # read file contents (optional line range)
    file-write.ts       # full overwrite — create/replace files
    file-edit.ts        # surgical SEARCH/REPLACE via editkit fuzzyReplace
    file-grep.ts        # search file for pattern with context lines
    file-list.ts        # list directory contents
    index.ts            # tool registry + dispatcher
prompts/
  echo-system.txt       # system prompt for challenge #1
  extract-challenge.txt # LLM prompt: extract {title, description, next_link} from page
```

The orchestrator holds a local `Map<string, SubagentHandle>` — it registers subagents on `startSubagent()`, removes them on `"complete"`, and can enumerate/abort any subset. A potential future tool (`subagent_status`) queries this map.

The loop starts with a user prompt + tool definitions. Each turn:
1. Call `models.complete()` with context + tools
2. Check response for `toolCall` blocks
3. Execute tools, push `toolResult` messages back to context
4. Repeat until no more tool calls → final text output

## Current Progress

**Last updated: 2026-07-10**

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
- [x] **PR #1** (`tools` → `main`): merged
- [x] **PR #2** (`agents-md` → `tools`): merged, AGENTS.md now on `main`
- [x] Stale remote branches (`tools`, `agents-md`) deleted
- [x] **Agent loop wired** — `src/index.ts` now uses the tool definitions and
      loops over `toolCall` blocks, pushing `toolResult` messages back to
      context until the model returns a final text response.
- [x] **Problem source decided** — Fly.io Distributed Systems challenge
      series (fly.io/dist-sys/N/), solved in Go, tested with Maelstrom.
- [x] **PR #3** (`07-05-prompts_add_file-based_prompt_management_with_template_variables` → `main`): merged.
      Prompt management: `prompts/*.txt` + `src/prompts.ts` + template variables + git tracking.
- [x] **PR #4** (`task/file-tools` → `main`): merged.
      File tools: `file_write`, `file_read`, `file_list`, `file_edit` (editkit), `file_grep`.
- [x] **PR #5** (`task/subagent-abstraction` → `main`): merged.
      Subagent abstraction: `src/subagent.ts` with `runSubagent()`, scoped tools, bounded iterations.
- [x] **PR #6** (`task/crawler` → `main`): merged.
      Challenge crawler: `src/crawl-challenges.ts` uses `web_fetch` + LLM extraction → `challenges.json`.
- [x] All stale remote branches and worktrees cleaned up. Only `main` remains.

### In Flight
- [x] **Non-blocking subagent** — `src/subagent.ts` now exports both
      `startSubagent()` (event-driven, returns `{ id, abort }`) and
      `runSubagent()` (backward-compatible Promise wrapper). Abort support
      via `AbortController` wired into pi-ai `models.complete()` signal.

### Blocked
Nothing currently blocked.

## TODO (Next Session)

**Last updated: 2026-07-10**

These are the remaining tasks to get the full end-to-end loop running.

### Layer 2 (Build)

- [ ] **Progress store** — SQLite-backed (`node:sqlite`) CRUD for per-challenge
      status, tags, solution notes, dependency graph. `src/progress.ts`
- [ ] **Maelstrom tool** — tool handle that builds Go code, runs
      `maelstrom test`, returns structured pass/fail. `src/tools/maelstrom.ts`
- [x] **Non-blocking subagent** — refactor `runSubagent` from a blocking
      function call into an event-driven worker that pushes results back to
      the main loop via callbacks/messages, so the orchestrator can fire and
      forget
- [ ] **Subagent registry** — singleton `src/subagent-registry.ts` that
      tracks all running subagents by ID, storing handles and abort fns so
      the orchestrator (and future tools like `subagent_status`) can query or
      cancel them
- [ ] **Outer orchestrator** — rewrite `src/index.ts` to crawl → seed DB →
      loop over ready challenges → dispatch non-blocking subagents → hang
      until results arrive
- [ ] **Solver prompt wiring** — pass challenge data, dependency artifact
      paths into `solver-system.txt` template variables

### Layer 3 (Optimise)

- [ ] **Parallel DAG scheduler** — fan-out subagents for independent challenges
- [ ] **Port pool in MaelstromManager** — avoid port collisions during
      concurrent test runs
- [ ] **Carried summaries** — inject "lessons learned" from completed
      challenges into dependent subagent prompts
- [ ] **Observability** — instrument every subagent run: token counts, turn
      counts, retries, wall-clock latency per challenge, and total cost
      (tokens × model pricing) for the full loop. Expose via structured log
      or `progress.db` columns.

### Layer 4 (Polish)

- [ ] **Solution archiving & evaluation** — archive each successful solution
      (source, prompt, metadata) by model variant. Enable re-running the full
      loop with different model combos to compare success rates, cost, latency.
- [ ] **Multi-model evaluation script** — script to run the full loop across
      many LLM model/providers, aggregate results, and produce a comparison
      report (success rate, cost, latency per challenge per model).
- [ ] **Test result caching** — skip re-testing unchanged binaries
- [ ] **Retry with exponential backoff** — per-subagent retry policy
- [ ] **Progress query UI** — CLI or dashboard over `progress.db`

## Important Artifacts

**Last updated: 2026-07-05**

- **`.env`** (gitignored) — `OPENCODE_API_KEY` for LLM auth
- **`src/tools/bash.ts`** — in-memory `Map<string, ProcessEntry>` tracks all
  background processes across turns. Auto-cleanup every 30s via `setInterval`.
- **`challenges.json`** (gitignored) — generated by `crawlAllChallenges()`, all 14 Fly.io
  Distributed Systems challenges with title, description, link, next_link.
- **`spec.md`** — detailed specs for remaining Layer 2–4 tasks

## Prompt Management

**Last updated: 2026-07-05**

Prompts live in `prompts/*.txt` and are loaded by `src/prompts.ts` via
`get(name, vars?)`.

### File naming
- `kebab-case.txt` (Unix-safe: any character except `/` and `\0`)
- One prompt per file, named by its purpose (e.g. `echo-system.txt` for the
  Challenge #1 Echo system prompt)

### Template variables
- `{{variable_name}}` syntax (`snake_case` convention)
- Variables are replaced with `String.replaceAll()` before the prompt is used
- Calling code passes variables as a `Record<string, string>`:
  ```ts
  get("echo-system", { challenge_url: "https://fly.io/dist-sys/1/" })
  ```

### Version control
- Prompts are tracked in git alongside code — full history, diffs, blame,
  rollback via standard `git log -p prompts/`, `git diff`, `git blame`
- Prompt changes go through the same PR workflow as code changes
- No external tools needed

### Cache
- Prompts are cached in memory after first read
- `reload(name)` and `clear()` available for hot-reload during development

## General Behaviour

**Last updated: 2026-07-05**

When investigating dependencies, libraries, or tools, prefer official docs,
READMEs, or package documentation over reading source code directly. Fetch docs
first; only fall back to source or `node_modules` when docs are insufficient.

## Development Workflow

**Last updated: 2026-07-05**

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

After a PR is merged, delete the remote branch with `gt sync` (interactive) or
`gt branch delete` + `git push origin --delete <branch>`.

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
