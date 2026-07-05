import type { Tool } from "@earendil-works/pi-ai"
import * as webFetch from "./web-fetch.js"
import * as fileWrite from "./file-write.js"
import * as fileRead from "./file-read.js"
import * as fileList from "./file-list.js"
import { tools as bashTools } from "./bash.js"

const allTools = [
  { definition: webFetch.definition, handle: webFetch.handle },
  { definition: fileWrite.definition, handle: fileWrite.handle },
  { definition: fileRead.definition, handle: fileRead.handle },
  { definition: fileList.definition, handle: fileList.handle },
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
