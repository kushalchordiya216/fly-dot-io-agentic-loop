import type { Tool } from "@earendil-works/pi-ai"
import * as webFetch from "./web-fetch.js"
import * as bash from "./bash.js"

interface ToolModule {
  definition: Tool
  handle(args: Record<string, unknown>): Promise<string>
}

const tools: ToolModule[] = [
  { definition: webFetch.definition, handle: webFetch.handle as ToolModule["handle"] },
  { definition: bash.definition, handle: bash.handle as ToolModule["handle"] },
]

export const definitions: Tool[] = tools.map((t) => t.definition)
export const definitionMap = new Map(tools.map((t) => [t.definition.name, t]))

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = definitionMap.get(name)
  if (!tool) return `Error: unknown tool "${name}"`
  try {
    return await tool.handle(args)
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`
  }
}
