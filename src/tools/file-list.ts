import { Type, type Tool } from "@earendil-works/pi-ai"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

export const definition: Tool = {
  name: "file_list",
  description: "List files and directories in a given path.",
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: "Directory path relative to project root (default: '.')" })),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const path = args.path ? String(args.path) : "."
  try {
    const absPath = join(process.cwd(), path)
    const entries = await readdir(absPath, { withFileTypes: true })
    const listing = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name)
    return listing.join("\n")
  } catch (err) {
    return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`
  }
}
