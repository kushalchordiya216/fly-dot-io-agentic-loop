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
  subagent.ts           # generic subagent runner (scoped tools, bounded iterations)
  crawl-challenges.ts   # sequential challenge crawler (JSON per page)
  tools/
    web-fetch.ts        # fetch URL, extract content via Mozilla Readability
    bash.ts             # async process mgmt: spawn / status / kill
    file-read.ts        # read file contents (optional line range)
    file-write.ts       # write/overwrite file with content
    file-list.ts        # list directory contents
    index.ts            # tool registry + dispatcher
prompts/
  echo-system.txt       # example: system prompt for challenge #1
```

The loop starts with a user prompt + tool definitions. Each turn:
1. Call `models.complete()` with context + tools
2. Check response for `toolCall` blocks
3. Execute tools, push `toolResult` messages back to context
4. Repeat until no more tool calls → final text output

## Current Progress

**Last updated: 2026-07-05**

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
- [x] **File tools** — `file_write`, `file_read`, `file_list` built and
      registered in tool registry. PR #4 (`task/file-tools`).
- [x] **Subagent abstraction** — `src/subagent.ts` with generic
      `runSubagent()`: scoped tools, bounded iterations, model override,
      structured result. PR #5 (`task/subagent-abstraction`).
- [x] **Challenge crawler** — `src/crawl-challenges.ts` sequentially
      crawls pages, prints JSON `{ title, description, link, next_link }`.
      PR #6 (`task/crawler`).

### Blocked
Nothing currently blocked.

## Architectural TODOs (Next Session)

**Last updated: 2026-07-05**

### Layer 2 — Depends on Layer 1 (file tools, subagent abstraction, crawler)

#### Test tool / test subagent
- [ ] **Dedicated test primitive** — whose only job is to test a given
      challenge's implemented solution and return a structured result:
      `{ result: "pass" | "fail", message: "<why>" }`.
      Open question: is this a **tool** the subagent calls (simpler, stays
      in-process), or a **separate subagent** (more isolated, can retry
      independently)? Lean toward tool for now.
- [ ] **Maelstrom wrapper** — wrap `maelstrom test -w <workload> --bin ...`
      so the test primitive doesn't need raw bash. Parses the
      `Everything looks good!` success signal and extracts failure context
      from stderr/logs.

#### Solver subagent
- [ ] **Per-challenge solver** — an instance of the generic subagent with
      a scoped system prompt for a given challenge and access to web_fetch,
      file tools, bash, and test tool. Runs solve → test → fix → repeat
      with bounded iterations before reporting failure.

#### Progress tracker subagent
- [ ] **Post-hoc knowledge capture** — after a solver finishes a challenge,
      a separate subagent reads the generated code and outputs, then writes
      a structured markdown file (problem overview, approach, key insights,
      resources, follow-ups). Built on the generic subagent abstraction.

### Layer 3 — Depends on Layer 2

#### Outer scheduler / DAG orchestrator
- [ ] **Fetch all challenges** — use the crawler to collect all challenge
      metadata and build a dependency DAG.
- [ ] **Scheduler** — fire off solver subagents for tasks whose dependencies
      are complete. Track in-flight vs. done vs. failed. Bounded retries.

### Cross-cutting concerns

#### Context management
- [ ] **Fresh context per subagent** — each subagent gets a clean LLM
      context (bounded, no cross-challenge bleed).
- [ ] **Carried summary** (optional) — after a challenge passes, ask the
      solver subagent for a short "lessons learned" that the orchestrator
      can inject into dependent challenges' prompts.

#### Environment bootstrap
- [ ] **Maelstrom + Go install check** — the main loop's prompt should
      include instructions to detect whether Maelstrom, OpenJDK, and Go
      are installed, and install them if missing via the bash tool.

#### System prompt
- [ ] **Proper workflow prompt** — the agent needs a prompt describing the
      problem-solving workflow, iteration limits, coding conventions.
      Current `prompts/echo-system.txt` is a minimal one-off for the demo.

## Important Artifacts

**Last updated: 2026-07-05**

- **`.env`** (gitignored) — `OPENCODE_API_KEY` for LLM auth
- **`src/tools/bash.ts`** — in-memory `Map<string, ProcessEntry>` tracks all
  background processes across turns. Auto-cleanup every 30s via `setInterval`.

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
