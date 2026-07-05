import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts")

const cache = new Map<string, string>()

export interface PromptVars {
  [key: string]: string
}

export function get(name: string, vars?: PromptVars): string {
  if (!cache.has(name)) {
    const path = join(PROMPTS_DIR, `${name}.txt`)
    cache.set(name, readFileSync(path, "utf-8"))
  }

  let text = cache.get(name)!

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{{${key}}}`, value)
    }
  }

  return text
}

export function reload(name: string): void {
  cache.delete(name)
}

export function clear(): void {
  cache.clear()
}
