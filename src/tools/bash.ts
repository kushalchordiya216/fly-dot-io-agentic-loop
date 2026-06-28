import { Type, type Tool } from "@earendil-works/pi-ai"
import { spawn, type ChildProcess } from "node:child_process"

// ── Process Registry ────────────────────────────────────────────────

interface ProcessEntry {
  id: string
  command: string
  pid: number
  startTime: number
  stdout: string[]
  stderr: string[]
  exitCode: number | null
  running: boolean
  child: ChildProcess
}

const processes = new Map<string, ProcessEntry>()
let nextId = 1

const MAX_RUNTIME_MS = 300_000 // auto-kill after 5 minutes
const CLEANUP_AGE_MS = 60_000 // reap completed entries after 1 minute

function cleanupOld(): void {
  const now = Date.now()
  for (const [id, entry] of processes) {
    if (entry.running) {
      if (now - entry.startTime > MAX_RUNTIME_MS) {
        entry.child.kill("SIGKILL")
      }
      continue
    }
    if (entry.exitCode !== null && now - entry.startTime > CLEANUP_AGE_MS) {
      processes.delete(id)
    }
  }
}
setInterval(cleanupOld, 30_000).unref()

// Kill all children on exit
function killAll(): void {
  for (const entry of processes.values()) {
    if (entry.running) {
      try { entry.child.kill("SIGKILL") } catch { /* ignore */ }
    }
  }
}
process.on("exit", killAll)
process.on("SIGINT", () => { killAll(); process.exit(2) })
process.on("SIGTERM", () => { killAll(); process.exit(15) })

// ── Helpers ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`
}

function formatOutput(entry: ProcessEntry): string {
  const out = entry.stdout.join("")
  const err = entry.stderr.join("")
  const status = entry.running ? "running" : `exited (code ${entry.exitCode})`
  const lines: string[] = [
    `[process ${entry.id}] — ${status} — ${formatDuration(Date.now() - entry.startTime)}`,
  ]
  if (out) lines.push(out)
  if (err) lines.push(`stderr:\n${err}`)
  return lines.join("\n")
}

// ── Tool: bash_spawn ────────────────────────────────────────────────

export const spawnDefinition: Tool = {
  name: "bash_spawn",
  description:
    "Start a shell command in the background and return immediately with a process ID. " +
    "Use bash_status to check output, bash_kill to terminate. " +
    "Prefers the command you'd run in a terminal — the shell joins stdout/stderr naturally.",
  parameters: Type.Object({
    command: Type.String({ description: "The shell command to execute" }),
    workdir: Type.Optional(
      Type.String({ description: "Working directory (default: cwd)" }),
    ),
  }),
}

export async function handleSpawn(args: Record<string, unknown>): Promise<string> {
  const command = String(args.command ?? "")
  if (!command) return "Error: 'command' is required"
  const workdir = args.workdir ? String(args.workdir) : undefined
  const id = `p${nextId++}`
  const child = spawn(command, [], {
    shell: true,
    cwd: workdir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TERM: "dumb" },
  })

  const entry: ProcessEntry = {
    id,
    command,
    pid: child.pid ?? 0,
    startTime: Date.now(),
    stdout: [],
    stderr: [],
    exitCode: null,
    running: true,
    child,
  }

  child.stdout.on("data", (chunk: Buffer) => entry.stdout.push(chunk.toString()))
  child.stderr.on("data", (chunk: Buffer) => entry.stderr.push(chunk.toString()))

  child.on("close", (code) => {
    entry.exitCode = code
    entry.running = false
  })
  child.on("error", () => {
    entry.exitCode = -1
    entry.running = false
  })

  processes.set(id, entry)
  return `[process ${id} started] PID ${entry.pid} | command: ${command}`
}

// ── Tool: bash_status ───────────────────────────────────────────────

export const statusDefinition: Tool = {
  name: "bash_status",
  description:
    "Check the status of a background process started with bash_spawn. " +
    "Returns whether it is still running, the exit code (if done), stdout, and stderr.",
  parameters: Type.Object({
    id: Type.String({ description: "Process ID returned by bash_spawn" }),
  }),
}

export async function handleStatus(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id ?? "")
  if (!id) return "Error: 'id' is required for bash_status"
  const entry = processes.get(id)
  if (!entry) return `Error: no process found with id "${id}"`

  if (entry.running) {
    // Trim buffers to bounded size so stale processes don't leak memory
    if (entry.stdout.length > 1000) entry.stdout.splice(0, entry.stdout.length - 1000)
    if (entry.stderr.length > 1000) entry.stderr.splice(0, entry.stderr.length - 1000)
  }

  return formatOutput(entry)
}

// ── Tool: bash_kill ─────────────────────────────────────────────────

export const killDefinition: Tool = {
  name: "bash_kill",
  description:
    "Send a signal to a background process. Defaults to SIGTERM (graceful shutdown). " +
    "Use 'SIGKILL' for forceful termination, 'SIGINT' to simulate Ctrl+C.",
  parameters: Type.Object({
    id: Type.String({ description: "Process ID returned by bash_spawn" }),
    signal: Type.Optional(
      Type.Union(
        [Type.Literal("SIGTERM"), Type.Literal("SIGKILL"), Type.Literal("SIGINT"), Type.Literal("SIGUSR1"), Type.Literal("SIGUSR2")],
        { description: "Signal to send (default: SIGTERM)" },
      ),
    ),
  }),
}

const VALID_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGUSR1", "SIGUSR2"])

export async function handleKill(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id ?? "")
  if (!id) return "Error: 'id' is required for bash_kill"
  const entry = processes.get(id)
  if (!entry) return `Error: no process found with id "${id}"`
  if (!entry.running) return `[process ${id}] already exited with code ${entry.exitCode}`

  const sig = VALID_SIGNALS.has(String(args.signal)) ? String(args.signal) : "SIGTERM"
  try {
    entry.child.kill(sig as NodeJS.Signals)
    return `[process ${id}] ${sig} sent`
  } catch (err) {
    return `Error sending ${sig} to ${id}: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── Bulk export for tools/index.ts ──────────────────────────────────

export interface ToolEntry {
  definition: Tool
  handle(args: Record<string, unknown>): Promise<string>
}

export const tools: ToolEntry[] = [
  { definition: spawnDefinition, handle: handleSpawn },
  { definition: statusDefinition, handle: handleStatus },
  { definition: killDefinition, handle: handleKill },
]
