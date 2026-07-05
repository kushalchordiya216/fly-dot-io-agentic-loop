import { Type, type Tool } from "@earendil-works/pi-ai"
import { writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"

export const definition: Tool = {
  name: "file_write",
  description: "Write content to a file (creates or overwrites). Path is relative to project root.",
  parameters: Type.Object({
    path: Type.String({ description: "File path relative to project root" }),
    content: Type.String({ description: "File content to write" }),
  }),
}

export async function handle(args: Record<string, unknown>): Promise<string> {
  const path = String(args.path ?? "")
  if (!path) return "Error: 'path' is required"
  const content = String(args.content ?? "")
  try {
    const absPath = join(process.cwd(), path)
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, content, "utf-8")
    return `Successfully wrote ${path} (${content.length} bytes)`
  } catch (err) {
    return `Error writing file: ${err instanceof Error ? err.message : String(err)}`
  }
}
