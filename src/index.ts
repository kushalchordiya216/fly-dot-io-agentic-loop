import { runSubagent, type SubagentResult } from "./subagent"
import { definitions } from "./tools/index"
import { get } from "./prompts"
import { crawlAllChallenges, type Challenge } from "./crawl-challenges"
import { ProgressStore, type SeedChallenge } from "./progress"

const SOLVER_TOOLS = definitions.filter(
  (t) => t.name !== "progress",
)

function flyLabel(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function toSeed(challenge: Challenge, index: number): SeedChallenge {
  const id = `challenge-${index + 1}`
  return {
    id,
    title: challenge.title || flyLabel(`challenge-${index + 1}`),
    description: challenge.description || "",
    url: challenge.link,
  }
}

async function main() {
  console.error("=== Fly.io Distributed Systems Solver ===")

  console.error("\nCrawling challenges…")
  let challenges: Challenge[]
  try {
    challenges = await crawlAllChallenges("challenges.json")
  } catch (err) {
    console.error("Crawler failed:", err)
    process.exit(1)
  }
  console.error(`Found ${challenges.length} challenges`)

  const store = new ProgressStore("progress.db")
  store.init()
  store.seed(challenges.map(toSeed))

  const results: { id: string; title: string; status: string }[] = []

  while (true) {
    const ready = store.getReady()
    if (ready.length === 0) {
      const all = store.all()
      const pending = all.filter((c) => c.status === "pending" || c.status === "in_progress")
      if (pending.length === 0) break
      console.error(`\nNo ready challenges (${pending.length} pending but blocked by dependencies)`)
      break
    }

    for (const challenge of ready) {
      console.error(`\n--- Solving: ${challenge.title} (${challenge.id}) ---`)

      store.update(challenge.id, { status: "in_progress", attempts: challenge.attempts + 1 })

      const depArtifacts = getDepArtifacts(store, challenge.dependencies)

      const systemPrompt = get("solver-system", {
        challenge_title: challenge.title,
        challenge_url: challenge.url,
        challenge_description: challenge.description,
        dependency_artifacts: depArtifacts,
      })

      const handle = runSubagent({
        systemPrompt,
        tools: SOLVER_TOOLS,
        initialMessage:
          "Solve the Fly.io Distributed Systems challenge described above. Write Go code, build it, run maelstrom tests, and iterate until everything passes.",
        maxSteps: 30,
      })

      let result: SubagentResult
      try {
        result = await handle
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Subagent error: ${msg}`)
        store.update(challenge.id, { status: "failed", last_error: msg })
        results.push({ id: challenge.id, title: challenge.title, status: "failed" })
        continue
      }

      if (result.status === "completed") {
        console.error(`\n✓ ${challenge.title} — PASS`)
        store.update(challenge.id, {
          status: "completed",
          solution_note: result.output,
          completed_at: Math.floor(Date.now() / 1000),
        })
        results.push({ id: challenge.id, title: challenge.title, status: "completed" })
      } else if (result.status === "max_steps_reached") {
        console.error(`\n! ${challenge.title} — max steps reached, marking failed`)
        store.update(challenge.id, {
          status: "failed",
          last_error: `Max steps reached. Partial output: ${result.output.slice(0, 500)}`,
        })
        results.push({ id: challenge.id, title: challenge.title, status: "max_steps" })
      } else {
        console.error(`\n✗ ${challenge.title} — FAILED`)
        store.update(challenge.id, {
          status: "failed",
          last_error: result.output.slice(0, 1000),
        })
        results.push({ id: challenge.id, title: challenge.title, status: "failed" })
      }
    }
  }

  printSummary(results)
}

function getDepArtifacts(store: ProgressStore, deps: string[]): string {
  if (deps.length === 0) return ""
  const lines: string[] = ["## Dependency Artifacts", ""]
  for (const depId of deps) {
    const dep = store.get(depId)
    if (dep && dep.solution_note) {
      lines.push(`### ${dep.title} (${depId})`)
      lines.push(dep.solution_note)
      lines.push("")
    }
  }
  if (lines.length === 2) return ""
  return lines.join("\n")
}

function printSummary(results: { id: string; title: string; status: string }[]): void {
  console.error("\n=== Summary ===")
  const passed = results.filter((r) => r.status === "completed").length
  const failed = results.filter((r) => r.status !== "completed").length
  for (const r of results) {
    const icon = r.status === "completed" ? "✓" : r.status === "max_steps" ? "!" : "✗"
    console.error(`  ${icon} ${r.title} (${r.id}): ${r.status}`)
  }
  console.error(`\n${passed} passed, ${failed} failed out of ${results.length} total`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
