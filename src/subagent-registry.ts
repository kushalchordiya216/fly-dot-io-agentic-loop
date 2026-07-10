import { randomUUID } from "node:crypto"
import type { SubagentHandle, SubagentEvent, SubagentResult } from "./subagent"

interface RegistryEntry {
  id: string
  handle: SubagentHandle
  label: string
  startTime: number
  status: "running" | "completed" | "failed" | "max_steps_reached"
  result: SubagentResult | null
  events: SubagentEvent[]
}

const entries = new Map<string, RegistryEntry>()

const CLEANUP_INTERVAL = 60_000
const MAX_AGE = 5 * 60_000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, entry] of entries) {
      if (entry.status !== "running" && now - entry.startTime > MAX_AGE) {
        entries.delete(id)
      }
    }
  }, CLEANUP_INTERVAL)
}

export function register(
  handle: SubagentHandle,
  label: string,
): { onEvent: (event: SubagentEvent) => void; entry: RegistryEntry } {
  startCleanup()

  const entry: RegistryEntry = {
    id: handle.id,
    handle,
    label,
    startTime: Date.now(),
    status: "running",
    result: null,
    events: [],
  }
  entries.set(handle.id, entry)

  const onEvent = (event: SubagentEvent): void => {
    entry.events.push(event)
    if (event.type === "complete") {
      entry.status = event.result.status
      entry.result = event.result
    }
  }

  return { onEvent, entry }
}

export function get(id: string): RegistryEntry | null {
  return entries.get(id) ?? null
}

export function list(): RegistryEntry[] {
  return Array.from(entries.values())
}

export function abort(id: string): boolean {
  const entry = entries.get(id)
  if (!entry) return false
  entry.handle.abort()
  return true
}

export function abortAll(): number {
  let count = 0
  for (const [id, entry] of entries) {
    if (entry.status === "running") {
      entry.handle.abort()
      count++
    }
  }
  return count
}

export function cleanup(): number {
  const now = Date.now()
  let count = 0
  for (const [id, entry] of entries) {
    if (entry.status !== "running" && now - entry.startTime > MAX_AGE) {
      entries.delete(id)
      count++
    }
  }
  if (entries.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  return count
}

export function waitForComplete(id: string, timeoutMs = 300_000): Promise<RegistryEntry> {
  return new Promise((resolve, reject) => {
    const entry = entries.get(id)
    if (!entry) {
      reject(new Error(`Subagent "${id}" not found`))
      return
    }
    if (entry.status !== "running") {
      resolve(entry)
      return
    }

    const check = (event: SubagentEvent): void => {
      if (event.type === "complete") {
        clearTimeout(timer)
        resolve(entries.get(id)!)
      }
    }

    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for subagent "${id}" after ${timeoutMs}ms`))
    }, timeoutMs)

    const originalPush = entry.events.push.bind(entry.events)
    entry.events.push = (...items: SubagentEvent[]) => {
      for (const item of items) check(item)
      return originalPush(...items)
    }
  })
}
