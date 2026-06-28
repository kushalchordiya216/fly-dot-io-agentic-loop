import { Type, type Tool } from "@earendil-works/pi-ai"
import { spawn } from "node:child_process"

export const definition: Tool = {
  name: "bash",
  description:
    "Execute a shell command. Returns stdout, stderr, and exit code. Use for compiling, testing, or running any command-line tool.",
  parameters: Type.Object({
    command: Type.String({ description: "The shell command to execute" }),
    workdir: Type.Optional(
      Type.String({ description: "Working directory for the command" }),
    ),
    timeout: Type.Optional(
      Type.Integer({ description: "Timeout in milliseconds (default: 30000)" }),
    ),
  }),
}

export interface BashArgs {
  command: string
  workdir?: string
  timeout?: number
}

export async function handle(args: BashArgs): Promise<string> {
  const timeout = args.timeout ?? 30_000
  let timedOut = false

  const child = spawn(args.command, [], {
    shell: true,
    cwd: args.workdir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TERM: "dumb" },
  })

  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // already dead
      }
    }, 2_000)
  }, timeout)

  const stdout: string[] = []
  const stderr: string[] = []

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString()))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()))

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve)
    child.on("error", () => resolve(null))
  })

  clearTimeout(timer)

  const out = stdout.join("")
  const err = stderr.join("")

  const parts: string[] = []

  if (out) parts.push(out)
  if (err) parts.push(`stderr:\n${err}`)
  parts.push(`\n[exit code: ${exitCode ?? "failed to spawn"}]`)

  if (timedOut) {
    parts.push(`[command timed out after ${timeout}ms]`)
  }

  return parts.join("\n")
}
