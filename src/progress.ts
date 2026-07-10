import { Type, type Tool } from "@earendil-works/pi-ai"
import { DatabaseSync } from "node:sqlite"
import { resolve } from "node:path"

const stores = new Map<string, ProgressStore>()

export interface ChallengeRow {
  id: string
  url: string
  title: string
  description: string
  status: string
  attempts: number
  last_error: string | null
  solution_path: string | null
  tags: string | null
  solution_note: string | null
  dependencies: string
  completed_at: number | null
}

export interface SeedChallenge {
  id: string
  title: string
  description: string
  url: string
  dependencies?: string[]
}

class ProgressStore {
  private db: DatabaseSync

  constructor(dbPath: string) {
    const fullPath = resolve(dbPath)
    this.db = new DatabaseSync(fullPath)
    this.db.exec("PRAGMA journal_mode=WAL")
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS challenges (
        id            TEXT PRIMARY KEY,
        url           TEXT NOT NULL,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        solution_path TEXT,
        tags          TEXT,
        solution_note TEXT,
        dependencies  TEXT NOT NULL DEFAULT '[]',
        completed_at  INTEGER
      )
    `)
  }

  seed(challenges: SeedChallenge[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO challenges (id, url, title, description, dependencies)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const c of challenges) {
      stmt.run(c.id, c.url, c.title, c.description, JSON.stringify(c.dependencies ?? []))
    }
  }

  get(id: string): ChallengeRow | null {
    const row = this.db.prepare("SELECT * FROM challenges WHERE id = ?").get(id) as
      | ChallengeRow
      | undefined
    return row ?? null
  }

  getByStatus(status: string): ChallengeRow[] {
    return this.db
      .prepare("SELECT * FROM challenges WHERE status = ?")
      .all(status) as unknown as ChallengeRow[]
  }

  getReady(): ChallengeRow[] {
    return this.db
      .prepare("SELECT * FROM challenges WHERE status = 'pending' ORDER BY id")
      .all() as unknown as ChallengeRow[]
  }

  update(id: string, partial: Partial<ChallengeRow>): void {
    const keys = Object.keys(partial).filter((k) => k !== "id")
    if (keys.length === 0) return

    const setClause = keys.map((k) => `${k} = ?`).join(", ")
    const values = keys.map((k) => (partial as Record<string, unknown>)[k])
    values.push(id)

    this.db
      .prepare(`UPDATE challenges SET ${setClause} WHERE id = ?`)
      .run(...values as never[])
  }

  all(): ChallengeRow[] {
    return this.db.prepare("SELECT * FROM challenges ORDER BY id").all() as unknown as ChallengeRow[]
  }
}

function getStore(dbPath: string): ProgressStore {
  const key = resolve(dbPath)
  let store = stores.get(key)
  if (!store) {
    store = new ProgressStore(dbPath)
    stores.set(key, store)
  }
  return store
}

export const definition: Tool = {
  name: "progress",
  description:
    "SQLite-backed progress store for tracking challenge status. Supports init, seed, get, getByStatus, getReady, update, and all actions.",
  parameters: Type.Object({
    action: Type.Union(
      [
        Type.Literal("init"),
        Type.Literal("seed"),
        Type.Literal("get"),
        Type.Literal("getByStatus"),
        Type.Literal("getReady"),
        Type.Literal("update"),
        Type.Literal("all"),
      ],
      { description: "The operation to perform" },
    ),
    dbPath: Type.Optional(
      Type.String({ description: "Database file path (default: progress.db)" }),
    ),
    id: Type.Optional(Type.String({ description: "Challenge ID (for get/update)" })),
    status: Type.Optional(Type.String({ description: "Status filter (for getByStatus)" })),
    challenges: Type.Optional(
      Type.String({
        description:
          "JSON string of SeedChallenge array (for seed): [{id, title, description, url, dependencies?}]",
      }),
    ),
    data: Type.Optional(
      Type.String({
        description:
          "JSON string of partial ChallengeRow (for update): {status, attempts, last_error, ...}",
      }),
    ),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action ?? "")
  const dbPath = args.dbPath ? String(args.dbPath) : "progress.db"

  try {
    const store = getStore(dbPath)

    switch (action) {
      case "init": {
        store.init()
        return JSON.stringify({ ok: true, dbPath })
      }

      case "seed": {
        if (!args.challenges) return 'Error: "challenges" (JSON array) is required for seed action'
        const challenges: SeedChallenge[] = JSON.parse(String(args.challenges))
        store.seed(challenges)
        return JSON.stringify({ ok: true, count: challenges.length })
      }

      case "get": {
        if (!args.id) return 'Error: "id" is required for get action'
        const row = store.get(String(args.id))
        if (!row) return JSON.stringify({ ok: true, row: null })
        return JSON.stringify({ ok: true, row })
      }

      case "getByStatus": {
        if (!args.status) return 'Error: "status" is required for getByStatus action'
        const rows = store.getByStatus(String(args.status))
        return JSON.stringify({ ok: true, count: rows.length, rows })
      }

      case "getReady": {
        const rows = store.getReady()
        return JSON.stringify({ ok: true, count: rows.length, rows })
      }

      case "update": {
        if (!args.id) return 'Error: "id" is required for update action'
        if (!args.data) return 'Error: "data" (JSON object) is required for update action'
        const partial: Partial<ChallengeRow> = JSON.parse(String(args.data))
        store.update(String(args.id), partial)
        return JSON.stringify({ ok: true })
      }

      case "all": {
        const rows = store.all()
        return JSON.stringify({ ok: true, count: rows.length, rows })
      }

      default:
        return `Error: unknown action "${action}"`
    }
  } catch (err) {
    return `Error executing progress.${action}: ${err instanceof Error ? err.message : String(err)}`
  }
}
