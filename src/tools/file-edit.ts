import { Type, type Tool } from "@earendil-works/pi-ai"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fuzzyReplace } from "editkit"

export const definition: Tool = {
  name: "file_edit",
  description:
    "Apply a surgical SEARCH/REPLACE edit to a file. Given an exact block of existing text (oldString) " +
    "and a replacement (newString), it finds the unique occurrence in the file and replaces it. " +
    "Uses fuzzy matching (indentation-flexible, trailing-whitespace tolerant) so the LLM doesn't need " +
    "to quote whitespace perfectly. Prefer this over file_write for small, targeted changes.",
  parameters: Type.Object({
    path: Type.String({ description: "File path relative to project root" }),
    oldString: Type.String({ description: "Exact block of text in the existing file to replace" }),
    newString: Type.String({ description: "Replacement text" }),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const path = String(args.path ?? "")
  if (!path) return "Error: 'path' is required"
  const oldString = String(args.oldString ?? "")
  if (!oldString) return "Error: 'oldString' is required"
  const newString = String(args.newString ?? "")

  try {
    const absPath = join(process.cwd(), path)
    const original = await readFile(absPath, "utf-8")
    const result = fuzzyReplace(original, oldString, newString)

    if (result.kind === "not-found") {
      return `Error: could not find the specified text in ${path}. Make sure oldString matches the existing content exactly (try including surrounding lines for uniqueness).`
    }
    if (result.kind === "ambiguous") {
      return `Error: found ${result.count} occurrences of oldString in ${path}. Include more surrounding context in oldString to make it unique.`
    }

    await writeFile(absPath, result.text, "utf-8")
    const diff = original.length - result.text.length
    const sign = diff >= 0 ? "-" : "+"
    return `Successfully applied edit to ${path} (${sign}${Math.abs(diff)} bytes, strategy: ${result.strategy})`
  } catch (err) {
    return `Error editing file: ${err instanceof Error ? err.message : String(err)}`
  }
}
