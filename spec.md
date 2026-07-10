# Specifications

## Progress Store

**File**: `src/progress.ts`

**Backend**: Node 24 built-in `node:sqlite`. Stored at `progress.db` (tracked in git).

### Schema

```sql
CREATE TABLE challenges (
  id            TEXT PRIMARY KEY,         -- "1", "2", "3a", etc.
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | passed | failed
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  solution_path TEXT,                     -- directory containing the Go module
  tags          TEXT,                     -- JSON array: ["gossip", "broadcast", "fault-tolerance"]
  solution_note TEXT,                     -- one-liner summary of the approach used
  dependencies  TEXT NOT NULL DEFAULT '[]', -- JSON array of challenge IDs this depends on
  completed_at  INTEGER
);
```

### Query API

```typescript
// Returns a Promise-based interface backed by the SQLite db.

init(): Promise<void>
  // Create/verify DB schema on startup. Idempotent.

seed(challenges: Challenge[]): Promise<void>
  // Populate from challenges.json on first run. Upserts by id.

get(id: string): Promise<ChallengeRow | null>

getByStatus(status: string): Promise<ChallengeRow[]>

getReady(): Promise<ChallengeRow[]>
  // SELECT * FROM challenges WHERE status = 'pending'
  // AND id NOT IN (requires a join/subquery on dependencies,
  // but for now sequential: just returns next pending)

update(id: string, partial: Partial<ChallengeRow>): Promise<void>

all(): Promise<ChallengeRow[]>
```

### Git tracking

`progress.db` is committed alongside code. Each completed challenge updates the
file, so solution history is visible in the git log.

---

## Maelstrom Tool

**File**: `src/tools/maelstrom.ts`

### MaelstromManager (in-process singleton)

```typescript
class MaelstromManager {
  // Called once on first use. Probes for go/java/maelstrom.
  // If anything is missing, downloads and installs to a known path.
  async ensureReady(): Promise<void>

  // Build the Go module at codeDir, run maelstrom test, parse result.
  async test(opts: TestOptions): Promise<TestResult>
}
```

### Install behaviour

- Probe: `go version`, `java -version`, `maelstrom --help`
- If Go missing: download from golang.org, extract to `~/.local/go`, symlink
- If Java missing: detect via `java -version`, error with install instructions
  (Maelstrom needs OpenJDK ≥ 11)
- If Maelstrom missing: download from GitHub releases, extract to `~/.local/bin/maelstrom`
- Results cached in-memory so `ensureReady()` is a no-op on subsequent calls

### Test steps

1. Build: `go build -o /tmp/flydotio-XXXX <codeDir>`
2. Run: `maelstrom test -w <workload> --bin /tmp/flydotio-XXXX [flags...]`
3. Parse stdout/stderr:
   - Contains `Everything looks good!` → `{ passed: true, output, diagnostics: "" }`
   - Otherwise → `{ passed: false, output, diagnostics: "<extracted error context>" }`
4. Cleanup: remove temp binary, reap orphaned JVM processes after 30s timeout

### Tool definition

```typescript
maelstrom_test({
  workload: string       // "echo", "unique-ids", "broadcast", etc.
  codeDir: string        // path to Go module root (has go.mod + .go files)
  nodeCount?: number     // default 1
  timeLimit?: number     // default 10 (seconds)
  rate?: number          // default 1
  concurrency?: number   // default 1
  otherFlags?: string[]  // workload-specific flags like --availability-total
})
→ { passed: boolean, output: string, diagnostics: string }
```

---

## Non-blocking Subagent

**File**: `src/subagent.ts`

### Problem

`runSubagent()` is currently a blocking function call — the outer loop calls it
and waits for the full solve cycle before continuing. This prevents the
orchestrator from firing off multiple subagents concurrently and handling
results as they arrive.

### Design

`runSubagent` is refactored into an event-driven worker:

```typescript
type SubagentEvent =
  | { type: "progress"; message: string; iteration: number }
  | { type: "complete"; result: SubagentResult };

function startSubagent(
  opts: SubagentOptions,
  onEvent: (event: SubagentEvent) => void,
): { id: string; abort(): void };
```

- The orchestrator calls `startSubagent()` which returns immediately with a
  handle (ID + abort function).
- The subagent runs its LLM+tool loop asynchronously, pushing events via the
  callback as it progresses.
- The orchestrator registers a callback that handles `"complete"` events:
  writes to progress.db, fires the next ready challenge, etc.
- The orchestrator then goes idle (or handles other ready challenges) until
  events arrive.
- Implementation: the LLM completion calls are still async, but the loop is
  driven by a `while` inside a microtask or spawned as an async task that the
  orchestrator does not `await` — results are delivered via the callback.

### Abort support

The returned `abort()` function lets the orchestrator cancel a subagent
mid-flight (e.g. if a dependency fails or a global timeout is hit).

---

## Outer Orchestrator

**File**: `src/index.ts`

### Flow

```
startup:
  1. init progress DB
  2. if challenges table is empty, seed from challenges.json
  3. init MaelstromManager (install check, may take time)

loop:
  4. ready = getReady()
     - sequential mode: first challenge with status "pending"
  5. if no ready challenges → log summary table, exit 0
  6. for each ready challenge:
     a. update(id, { status: "in_progress" })
     b. startSubagent({ ... }, (event) => {
          if (event.type === "complete") {
            if (result.success) { update(id, { status: "passed", ... }) }
            else                { update(id, { status: "failed", ... }) }
            go to 4   // check for next ready challenge
          }
        })
  7. hang — stay alive until events arrive / all subagents finish
```

### Template variables for solver prompt

- `{{challenge_title}}` — from challenges.json
- `{{challenge_description}}` — from challenges.json
- `{{dependency_solution_path}}` — solution_path of the previous challenge
  in the chain, or empty string for the first challenge

---

## Solver Prompt (`prompts/solver-system.txt`)

Already written. Covers:

- Persona: veteran Go distributed-systems engineer
- Workflow: understand → implement → test → fix → repeat
- Tooling: auto-setup if mentioned, assume ready otherwise
- Success: `Everything looks good!` signal from Maelstrom
- Output: test output + distributed-systems concepts + follow-up resources
  (CMU/MIT/Harvard lectures, Jepsen, DDIA, etc.)

No changes needed to the prompt itself — just wire the template variables in
the orchestrator.

---

## Future Optimizations (Layer 3 & 4)

### Parallel DAG scheduler
- Read dependency graph from `progress.db`
- Fan-out `runSubagent` for challenges whose deps are all `passed`
- Accumulate results, abort remaining on failure (optional)

### Port pool
- Track which ports are in use within MaelstromManager
- Assign unique ports per test invocation
- Release on test completion or timeout

### Carried summaries
- After a challenge passes, ask the subagent for a short summary
- Inject into dependent challenge prompts as `{{dependency_summary}}`

### Test result caching
- Hash the source directory contents
- Skip re-test if binary hash matches last known passing run

### Retry with exponential backoff
- On subagent failure, re-dispatch with increasing maxSteps
- Cap at 3 retries

### Observability
- Instrument every subagent run with:
  - Token counts (input + output per LLM call, total per subagent)
  - Turn counts (iterations of the LLM+tool loop)
  - Retries (if the subagent restarts due to failure)
  - Wall-clock latency per challenge
  - **Total cost** — compute cost per subagent run (tokens × model pricing)
    and accumulate for the full loop. Expose final cost in summary output.
- Store metrics alongside progress in `progress.db` (additional columns or a
  separate `subagent_runs` table keyed by challenge_id + run_id)
- Expose via structured log lines at the end of each subagent run, queryable
  later

### Solution archiving & evaluation
- After a successful solve, archive:
  - Source code of the solution
  - Full prompt(s) used
  - Metadata: model variant, token counts, cost, latency, turn count, date
- Directory structure:
  ```
  archive/
    <model-name>/
      <challenge-id>/
        solution/
        prompt.txt
        metadata.json
  ```

### Multi-model evaluation script
- Script that runs the full loop across many LLM model/provider combinations:
  1. Accept a config file listing model combos (modelID + providerID per
     challenge, or one model for the whole loop)
  2. For each combo: clean `progress.db`, run orchestrator, archive results
  3. Aggregate results into a comparison report:
     - Success rate per challenge per model
     - Total cost per model (tokens × pricing)
     - Average latency per challenge per model
     - Total wall-clock time for full loop per model
  4. Output as JSON + markdown table for easy comparison

### Progress query UI
- CLI command to read and display `progress.db` state
- Optional web dashboard
