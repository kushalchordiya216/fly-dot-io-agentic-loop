import type { Tool } from "@earendil-works/pi-ai"
import * as webFetch from "./web-fetch"
import * as fileWrite from "./file-write"
import * as fileRead from "./file-read"
import * as fileList from "./file-list"
import * as fileEdit from "./file-edit"
import * as fileGrep from "./file-grep"
import * as maelstrom from "./maelstrom"
import * as progress from "../progress"
import { tools as bashTools } from "./bash"

const allTools = [
  { definition: webFetch.definition, handle: webFetch.handle },
  { definition: fileWrite.definition, handle: fileWrite.handle },
  { definition: fileRead.definition, handle: fileRead.handle },
  { definition: fileList.definition, handle: fileList.handle },
  { definition: fileEdit.definition, handle: fileEdit.handle },
  { definition: fileGrep.definition, handle: fileGrep.handle },
  { definition: maelstrom.definition, handle: maelstrom.handle },
  { definition: progress.definition, handle: progress.handle },
  ...bashTools,
]

export const definitions: Tool[] = allTools.map((t) => t.definition)

const handlerMap = new Map<string, (args: Record<string, unknown>) => Promise<string>>()
for (const t of allTools) handlerMap.set(t.definition.name, t.handle)

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const handler = handlerMap.get(name)
  if (!handler) return `Error: unknown tool "${name}"`
  try {
    return await handler(args)
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`
  }
}
