import { Type, type Tool } from "@earendil-works/pi-ai"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const definition: Tool = {
  name: "file_read",
  description: "Read the contents of a file. Path is relative to project root.",
  parameters: Type.Object({
    path: Type.String({ description: "File path relative to project root" }),
    offset: Type.Optional(Type.Integer({ description: "Line number to start from (1-indexed)" })),
    limit: Type.Optional(Type.Integer({ description: "Maximum number of lines to read" })),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const path = String(args.path ?? "")
  if (!path) return "Error: 'path' is required"
  try {
    const absPath = join(process.cwd(), path)
    const content = await readFile(absPath, "utf-8")
    if (args.offset || args.limit) {
      const lines = content.split("\n")
      const start = ((args.offset ? Number(args.offset) : 1)) - 1
      const end = args.limit ? start + Number(args.limit) : undefined
      return lines.slice(start, end).join("\n")
    }
    return content
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`
  }
}
