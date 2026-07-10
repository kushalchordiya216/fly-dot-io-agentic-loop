import { Type, type Tool } from "@earendil-works/pi-ai"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { chmod, mkdir, rm, symlink } from "node:fs/promises"
import { homedir, platform, arch } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"

// ── Types ─────────────────────────────────────────────────────────────────

interface TestOptions {
  workload: string
  codeDir: string
  nodeCount?: number
  timeLimit?: number
  rate?: number
  concurrency?: number
  otherFlags?: string[]
}

interface TestResult {
  passed: boolean
  output: string
  diagnostics: string
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

// ── Constants ─────────────────────────────────────────────────────────────

const LOCAL_BIN = join(homedir(), ".local", "bin")
const GO_DIR = join(homedir(), ".local", "go")
const MAELSTROM_DIR = join(homedir(), ".local", "maelstrom")

const GO_PLATFORM = platform() === "darwin" ? "darwin" : "linux"
const GO_ARCH = arch() === "arm64" ? "arm64" : "amd64"
const GO_TAR = `go1.22.5.${GO_PLATFORM}-${GO_ARCH}.tar.gz`
const GO_URL = `https://go.dev/dl/${GO_TAR}`
const MAELSTROM_URL =
  "https://github.com/jepsen-io/maelstrom/releases/latest/download/maelstrom.tar.gz"

const PASS_SIGNAL = /Everything looks good!/i

// ── MaelstromManager ──────────────────────────────────────────────────────

class MaelstromManager {
  private ready = false

  async ensureReady(): Promise<void> {
    if (this.ready) return
    const env = this.buildEnv()
    await this.ensureGo(env)
    await this.ensureJava()
    await this.ensureMaelstrom(env)
    this.ready = true
  }

  async test(opts: TestOptions): Promise<TestResult> {
    await this.ensureReady()

    const binary = `/tmp/flydotio-${randomBytes(4).toString("hex")}`
    const env = this.buildEnv()

    // 1. Build Go binary
    const buildOut = await execCapture("go", ["build", "-o", binary, "."], {
      cwd: resolve(opts.codeDir),
      env,
    })
    if (buildOut.exitCode !== 0) {
      return {
        passed: false,
        output: "",
        diagnostics: `Build failed:\n${buildOut.stderr || buildOut.stdout}`,
      }
    }

    // 2. Run Maelstrom test
    const args = [
      "test",
      "-w", opts.workload,
      "--bin", binary,
      "--node-count", String(opts.nodeCount ?? 1),
      "--time-limit", String(opts.timeLimit ?? 10),
      "--rate", String(opts.rate ?? 1),
      "--concurrency", String(opts.concurrency ?? 1),
      ...(opts.otherFlags ?? []),
    ]

    const testOut = await execCapture("maelstrom", args, {
      env,
      timeout: (opts.timeLimit ?? 10) * 1000 + 30_000,
    })

    const output = [testOut.stdout, testOut.stderr].filter(Boolean).join("\n")
    const passed = PASS_SIGNAL.test(output)
    const diagnostics = passed ? "" : extractDiagnostics(output)

    // 3. Cleanup
    this.cleanup(binary)

    return { passed, output, diagnostics }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildEnv(): Record<string, string> {
    const PATH = [LOCAL_BIN, join(GO_DIR, "bin"), process.env.PATH ?? ""]
      .filter(Boolean)
      .join(":")
    return { ...process.env, PATH } as Record<string, string>
  }

  private async ensureGo(env: Record<string, string>): Promise<void> {
    if (existsSync(join(GO_DIR, "bin", "go"))) return
    const r = await execCapture("go", ["version"], { timeout: 10_000 })
    if (r.exitCode === 0) return

    console.error("Downloading Go...")
    const res = await fetch(GO_URL)
    if (!res.ok) throw new Error(`Go download failed: HTTP ${res.status}`)

    if (existsSync(GO_DIR)) rmSync(GO_DIR, { recursive: true })
    // Tarball has a `go/` prefix, extract to ~/.local/
    await pipeTar(res, join(homedir(), ".local"))

    const goBin = join(GO_DIR, "bin", "go")
    await mkdir(LOCAL_BIN, { recursive: true })
    const linkPath = join(LOCAL_BIN, "go")
    try { await rm(linkPath) } catch { /* may not exist */ }
    await symlink(goBin, linkPath)
  }

  private async ensureJava(): Promise<void> {
    const r = await execCapture("java", ["-version"], { timeout: 10_000 })
    if (r.exitCode === 0) return
    throw new Error(
      "Java (OpenJDK >= 11) is required for Maelstrom.\n" +
        "Install via your package manager:\n" +
        "  macOS: brew install openjdk\n" +
        "  Ubuntu: apt install openjdk-21-jre-headless\n" +
        "  Fedora: dnf install java-21-openjdk-headless",
    )
  }

  private async ensureMaelstrom(env: Record<string, string>): Promise<void> {
    const r = await execCapture("maelstrom", ["--help"], { env, timeout: 10_000 })
    if (r.exitCode === 0) return

    console.error("Downloading Maelstrom...")
    const res = await fetch(MAELSTROM_URL)
    if (!res.ok) throw new Error(`Maelstrom download failed: HTTP ${res.status}`)

    const tmpDir = `/tmp/maelstrom-install-${randomBytes(4).toString("hex")}`
    try {
      await mkdir(tmpDir, { recursive: true })
      await pipeTar(res, tmpDir)

      if (existsSync(MAELSTROM_DIR)) rmSync(MAELSTROM_DIR, { recursive: true })
      await mkdir(MAELSTROM_DIR, { recursive: true })

      const entries = readdirSync(tmpDir)
      // Handle both prefixed (GitHub auto-archive) and flat tarballs
      const sourceDir =
        entries.length === 1 && existsSync(join(tmpDir, entries[0]))
          ? join(tmpDir, entries[0])
          : tmpDir

      for (const entry of readdirSync(sourceDir)) {
        renameSync(join(sourceDir, entry), join(MAELSTROM_DIR, entry))
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }

    const maelstromBin = join(MAELSTROM_DIR, "maelstrom")
    await mkdir(LOCAL_BIN, { recursive: true })
    const linkPath = join(LOCAL_BIN, "maelstrom")
    try { await rm(linkPath) } catch { /* may not exist */ }
    await symlink(maelstromBin, linkPath)
    await chmod(maelstromBin, 0o755)
  }

  private cleanup(binary: string): void {
    try { rmSync(binary, { force: true }) } catch { /* ignore */ }
    // Reap orphaned JVM processes from Maelstrom
    try {
      execFileSync("pkill", ["-f", "maelstrom"], { timeout: 5000 })
    } catch { /* ignore */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function execCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let child: ChildProcess | null = null
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: opts.timeout,
      })
    } catch (err) {
      resolve({ exitCode: -1, stdout: "", stderr: String(err) })
      return
    }

    let stdout = ""
    let stderr = ""
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("close", (code) => resolve({ exitCode: code ?? -1, stdout, stderr }))
    child.on("error", () => resolve({ exitCode: -1, stdout, stderr }))
  })
}

async function pipeTar(response: Response, targetDir: string): Promise<void> {
  const tmpFile = `/tmp/tar-${randomBytes(4).toString("hex")}.tar.gz`
  try {
    writeFileSync(tmpFile, Buffer.from(await response.arrayBuffer()))
    execFileSync("tar", ["-xzf", tmpFile, "-C", targetDir], { stdio: "inherit" })
  } finally {
    rmSync(tmpFile, { force: true })
  }
}

function extractDiagnostics(output: string): string {
  const lines = output.split("\n")
  const errorLines: string[] = []
  let capturing = false
  for (const line of lines) {
    if (/^(Error|ERROR|FATAL|Exception|panic:|Caused by|Stacktrace)/.test(line)) {
      capturing = true
    }
    if (capturing) {
      errorLines.push(line)
      if (errorLines.length > 40) break
      if (line.trim() === "" && errorLines.length > 5) capturing = false
    }
  }
  return errorLines.length > 0 ? errorLines.join("\n") : output.slice(0, 2000)
}

// ── Singleton ─────────────────────────────────────────────────────────────

const manager = new MaelstromManager()

// ── Tool Definition ───────────────────────────────────────────────────────

export const definition: Tool = {
  name: "maelstrom_test",
  description:
    "Build a Go solution and test it with Maelstrom. Returns JSON with passed/output/diagnostics.",
  parameters: Type.Object({
    workload: Type.String({ description: "Workload name: echo, unique-ids, broadcast, etc." }),
    codeDir: Type.String({ description: "Path to Go module root containing go.mod" }),
    nodeCount: Type.Optional(
      Type.Integer({ description: "Number of nodes (default: 1)" }),
    ),
    timeLimit: Type.Optional(
      Type.Integer({ description: "Test time limit in seconds (default: 10)" }),
    ),
    rate: Type.Optional(
      Type.Integer({ description: "Request rate (default: 1)" }),
    ),
    concurrency: Type.Optional(
      Type.Integer({ description: "Concurrency level (default: 1)" }),
    ),
    otherFlags: Type.Optional(
      Type.Array(Type.String(), { description: "Additional workload-specific CLI flags" }),
    ),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const workload = String(args.workload ?? "")
  if (!workload) return errJson("Missing required field: workload")
  const codeDir = String(args.codeDir ?? "")
  if (!codeDir) return errJson("Missing required field: codeDir")

  try {
    const result = await manager.test({
      workload,
      codeDir,
      nodeCount: args.nodeCount ? Number(args.nodeCount) : undefined,
      timeLimit: args.timeLimit ? Number(args.timeLimit) : undefined,
      rate: args.rate ? Number(args.rate) : undefined,
      concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      otherFlags: Array.isArray(args.otherFlags)
        ? (args.otherFlags as string[])
        : undefined,
    })
    return JSON.stringify(result)
  } catch (err) {
    return errJson(err instanceof Error ? err.message : String(err))
  }
}

function errJson(diagnostics: string): string {
  return JSON.stringify({ passed: false, output: "", diagnostics })
}
