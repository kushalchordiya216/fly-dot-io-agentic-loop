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
  dependencies: string[]
  completed_at: number | null
}

export interface SeedChallenge {
  id: string
  title: string
  description: string
  url: string
  dependencies?: string[]
}

type DbChallengeRow = Omit<ChallengeRow, "dependencies"> & { dependencies: string }

export class ProgressStore {
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
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        solution_path TEXT,
        tags          TEXT,
        solution_note TEXT,
        completed_at  INTEGER
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS challenge_dependencies (
        challenge_id  TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        dependency_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        PRIMARY KEY (challenge_id, dependency_id),
        CHECK(challenge_id != dependency_id)
      )
    `)
  }

  seed(challenges: SeedChallenge[]): void {
    const insertChallenge = this.db.prepare(
      `INSERT OR REPLACE INTO challenges (id, url, title, description)
       VALUES (?, ?, ?, ?)`,
    )
    const insertDep = this.db.prepare(
      `INSERT OR IGNORE INTO challenge_dependencies (challenge_id, dependency_id)
       VALUES (?, ?)`,
    )
    for (const c of challenges) {
      insertChallenge.run(c.id, c.url, c.title, c.description)
      for (const dep of c.dependencies ?? []) {
        insertDep.run(c.id, dep)
      }
    }
  }

  get(id: string): ChallengeRow | null {
    const row = this.db
      .prepare(`
        SELECT
          c.*,
          CASE
            WHEN COUNT(cd.dependency_id) = 0 THEN '[]'
            ELSE json_group_array(cd.dependency_id)
          END AS dependencies
        FROM challenges c
        LEFT JOIN challenge_dependencies cd ON cd.challenge_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
      `)
      .get(id) as DbChallengeRow | undefined
    return row ? { ...row, dependencies: JSON.parse(row.dependencies) } : null
  }

  getByStatus(status: string): ChallengeRow[] {
    const rows = this.db
      .prepare(`
        SELECT
          c.*,
          CASE
            WHEN COUNT(cd.dependency_id) = 0 THEN '[]'
            ELSE json_group_array(cd.dependency_id)
          END AS dependencies
        FROM challenges c
        LEFT JOIN challenge_dependencies cd ON cd.challenge_id = c.id
        WHERE c.status = ?
        GROUP BY c.id
        ORDER BY c.id
      `)
      .all(status) as DbChallengeRow[]
    return rows.map((r) => ({ ...r, dependencies: JSON.parse(r.dependencies) }))
  }

  getReady(): ChallengeRow[] {
    const rows = this.db
      .prepare(`
        SELECT
          c.*,
          CASE
            WHEN COUNT(cd.dependency_id) = 0 THEN '[]'
            ELSE json_group_array(cd.dependency_id)
          END AS dependencies
        FROM challenges c
        LEFT JOIN challenge_dependencies cd ON cd.challenge_id = c.id
        LEFT JOIN challenges d ON d.id = cd.dependency_id
        WHERE c.status = 'pending'
        GROUP BY c.id
        HAVING
          COUNT(cd.dependency_id) = 0
          OR COUNT(cd.dependency_id) = SUM(CASE WHEN d.status = 'completed' THEN 1 ELSE 0 END)
        ORDER BY c.id
      `)
      .all() as DbChallengeRow[]
    return rows.map((r) => ({ ...r, dependencies: JSON.parse(r.dependencies) }))
  }

  update(id: string, partial: Partial<ChallengeRow>): void {
    const keys = Object.keys(partial).filter((k) => k !== "id" && k !== "dependencies")
    if (keys.length === 0) return

    const setClause = keys.map((k) => `${k} = ?`).join(", ")
    const values = keys.map((k) => (partial as Record<string, unknown>)[k])
    values.push(id)

    this.db
      .prepare(`UPDATE challenges SET ${setClause} WHERE id = ?`)
      .run(...values as never[])
  }

  all(): ChallengeRow[] {
    const rows = this.db
      .prepare(`
        SELECT
          c.*,
          CASE
            WHEN COUNT(cd.dependency_id) = 0 THEN '[]'
            ELSE json_group_array(cd.dependency_id)
          END AS dependencies
        FROM challenges c
        LEFT JOIN challenge_dependencies cd ON cd.challenge_id = c.id
        GROUP BY c.id
        ORDER BY c.id
      `)
      .all() as DbChallengeRow[]
    return rows.map((r) => ({ ...r, dependencies: JSON.parse(r.dependencies) }))
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
