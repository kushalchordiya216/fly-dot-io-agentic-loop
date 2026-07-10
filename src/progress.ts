import { DatabaseSync } from "node:sqlite"
import { resolve } from "node:path"

const DB_PATH = resolve("progress.db")

let db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH)
    db.exec("PRAGMA journal_mode=WAL")
  }
  return db
}

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

export async function init(): Promise<void> {
  getDb().exec(`
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

export async function seed(challenges: SeedChallenge[]): Promise<void> {
  const d = getDb()
  const stmt = d.prepare(
    `INSERT OR REPLACE INTO challenges (id, url, title, description, dependencies)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const c of challenges) {
    stmt.run(c.id, c.url, c.title, c.description, JSON.stringify(c.dependencies ?? []))
  }
}

export async function get(id: string): Promise<ChallengeRow | null> {
  const row = getDb().prepare("SELECT * FROM challenges WHERE id = ?").get(id) as
    | ChallengeRow
    | undefined
  return row ?? null
}

export async function getByStatus(status: string): Promise<ChallengeRow[]> {
  return getDb()
    .prepare("SELECT * FROM challenges WHERE status = ?")
    .all(status) as unknown as ChallengeRow[]
}

export async function getReady(): Promise<ChallengeRow[]> {
  return getDb()
    .prepare("SELECT * FROM challenges WHERE status = 'pending' ORDER BY id")
    .all() as unknown as ChallengeRow[]
}

export async function update(id: string, partial: Partial<ChallengeRow>): Promise<void> {
  const keys = Object.keys(partial).filter((k) => k !== "id")
  if (keys.length === 0) return

  const setClause = keys.map((k) => `${k} = ?`).join(", ")
  const values = keys.map((k) => (partial as Record<string, unknown>)[k]) as unknown[]
  values.push(id)

  getDb()
    .prepare(`UPDATE challenges SET ${setClause} WHERE id = ?`)
    .run(...values as never[])
}

export async function all(): Promise<ChallengeRow[]> {
  return getDb().prepare("SELECT * FROM challenges ORDER BY id").all() as unknown as ChallengeRow[]
}
