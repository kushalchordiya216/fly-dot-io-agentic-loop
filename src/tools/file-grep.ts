import { Type, type Tool } from "@earendil-works/pi-ai"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const definition: Tool = {
  name: "file_grep",
  description:
    "Search a file for lines matching a pattern, with optional surrounding context lines. " +
    "Pattern can be a plain string (case-insensitive by default) or a regex. " +
    "Returns matching lines prefixed with line numbers. More efficient than reading the whole file " +
    "when you only need to find specific content.",
  parameters: Type.Object({
    pattern: Type.String({ description: "Text or regex pattern to search for" }),
    path: Type.String({ description: "File path relative to project root" }),
    context: Type.Optional(
      Type.Integer({ description: "Number of context lines before and after each match (default: 0)" }),
    ),
    caseSensitive: Type.Optional(
      Type.Boolean({ description: "Whether the search is case-sensitive (default: false)" }),
    ),
  }),
}

function compilePattern(input: string, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? "" : "i"
  try {
    return new RegExp(input, flags)
  } catch {
    const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(escaped, flags)
  }
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const pattern = String(args.pattern ?? "")
  if (!pattern) return "Error: 'pattern' is required"
  const path = String(args.path ?? "")
  if (!path) return "Error: 'path' is required"
  const context = args.context ? Math.max(0, Number(args.context)) : 0
  const caseSensitive = args.caseSensitive === true

  try {
    const absPath = join(process.cwd(), path)
    const content = await readFile(absPath, "utf-8")
    const lines = content.split("\n")
    const regex = compilePattern(pattern, caseSensitive)

    const matchedLines = new Set<number>()
    const contextLines = new Set<number>()

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0
      if (regex.test(lines[i])) {
        matchedLines.add(i)
        for (let c = 1; c <= context; c++) {
          if (i - c >= 0) contextLines.add(i - c)
          if (i + c < lines.length) contextLines.add(i + c)
        }
      }
    }

    const allLines = new Set([...matchedLines, ...contextLines])
    if (allLines.size === 0) {
      return `No matches found for "${pattern}" in ${path}`
    }

    const sorted = [...allLines].sort((a, b) => a - b)
    const output: string[] = []
    let prevLine = -2
    for (const lineIdx of sorted) {
      if (lineIdx > prevLine + 1 && output.length > 0) {
        output.push("──")
      }
      const marker = matchedLines.has(lineIdx) ? ">" : " "
      output.push(`${marker} ${lineIdx + 1}: ${lines[lineIdx]}`)
      prevLine = lineIdx
    }

    return output.join("\n")
  } catch (err) {
    return `Error searching file: ${err instanceof Error ? err.message : String(err)}`
  }
}
