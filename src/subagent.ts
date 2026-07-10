import { randomUUID } from "node:crypto"
import { createModels } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import type { Context, ToolCall, Tool, Api, Model } from "@earendil-works/pi-ai"
import { executeTool } from "./tools/index.js"

export interface SubagentOptions {
  systemPrompt: string
  tools: Tool[]
  initialMessage?: string
  maxSteps?: number
  allowChildSubagents?: boolean
  model?: Model<Api>
}

export interface SubagentResult {
  status: "completed" | "failed" | "max_steps_reached"
  output: string
  summary: string
  toolCallsMade: number
  errors: string[]
}

export type SubagentEvent =
  | { type: "progress"; message: string; iteration: number }
  | { type: "complete"; result: SubagentResult };

export interface SubagentHandle {
  id: string
  abort(): void
}

export function startSubagent(
  options: SubagentOptions,
  onEvent: (event: SubagentEvent) => void,
): SubagentHandle {
  const id = `subagent-${randomUUID()}`
  const abortController = new AbortController()

  const {
    systemPrompt,
    tools,
    initialMessage = "Go ahead and start the task.",
    maxSteps = 20,
    model: modelOverride,
  } = options

  const allowedToolNames = new Set(tools.map((t) => t.name))

  const run = async () => {
    try {
      const models = createModels()
      models.setProvider(opencodeProvider())

      const model = modelOverride ?? models.getModel("opencode", "deepseek-v4-flash-free")!
      if (!model) {
        onEvent({
          type: "complete",
          result: {
            status: "failed",
            output: "",
            summary: "Model not found",
            toolCallsMade: 0,
            errors: ["Model not found: opencode/deepseek-v4-flash-free"],
          },
        })
        return
      }

      const context: Context = {
        systemPrompt,
        messages: [{ role: "user", content: initialMessage, timestamp: Date.now() }],
        tools,
      }

      let response = await models.complete(model, context, { signal: abortController.signal })
      context.messages.push(response)

      const errors: string[] = []
      let toolCallsMade = 0
      let steps = 0

      while (response.stopReason === "toolUse" && steps < maxSteps) {
        if (abortController.signal.aborted) break

        const toolCalls = response.content.filter((b): b is ToolCall => b.type === "toolCall")
        for (const call of toolCalls) {
          if (abortController.signal.aborted) break

          if (!allowedToolNames.has(call.name)) {
            context.messages.push({
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: "text", text: `Error: tool "${call.name}" is not available to this subagent` }],
              isError: true,
              timestamp: Date.now(),
            })
            errors.push(`Blocked call to disallowed tool "${call.name}"`)
            continue
          }

          toolCallsMade++
          const result = await executeTool(call.name, call.arguments)
          if (result.startsWith("Error")) {
            errors.push(result)
          }
          context.messages.push({
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: [{ type: "text", text: result }],
            isError: result.startsWith("Error"),
            timestamp: Date.now(),
          })
        }

        if (abortController.signal.aborted) break

        steps++
        response = await models.complete(model, context, { signal: abortController.signal })
        context.messages.push(response)
      }

      if (abortController.signal.aborted) {
        onEvent({
          type: "complete",
          result: {
            status: "failed",
            output: "Subagent was aborted",
            summary: "Subagent was aborted",
            toolCallsMade,
            errors: [...errors, "Subagent aborted"],
          },
        })
        return
      }

      let status: SubagentResult["status"]
      let output = ""

      if (response.stopReason === "toolUse") {
        status = "max_steps_reached"
        const forceContext: Context = {
          systemPrompt:
            systemPrompt +
            "\n\nYou have reached the maximum number of tool-call iterations. Please provide a summary of what you have accomplished so far and any partial results.",
          messages: [
            ...context.messages,
            { role: "user", content: "Please summarize your work so far.", timestamp: Date.now() },
          ],
          tools,
        }
        const forceResponse = await models.complete(model, forceContext)
        for (const block of forceResponse.content) {
          if (block.type === "text") {
            output = block.text
          }
        }
      } else if (response.stopReason === "error" || response.stopReason === "aborted") {
        status = "failed"
        output = response.errorMessage ?? "Unknown error"
        if (response.errorMessage) errors.push(response.errorMessage)
      } else {
        status = "completed"
        for (const block of response.content) {
          if (block.type === "text") {
            output = block.text
          }
        }
      }

      onEvent({
        type: "complete",
        result: {
          status,
          output,
          summary: output.slice(0, 200),
          toolCallsMade,
          errors,
        },
      })
    } catch (err) {
      if (abortController.signal.aborted) {
        onEvent({
          type: "complete",
          result: {
            status: "failed",
            output: "Subagent was aborted",
            summary: "Subagent was aborted",
            toolCallsMade: 0,
            errors: ["Subagent aborted"],
          },
        })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      onEvent({
        type: "complete",
        result: {
          status: "failed",
          output: message,
          summary: message.slice(0, 200),
          toolCallsMade: 0,
          errors: [message],
        },
      })
    }
  }

  run()

  return { id, abort: () => abortController.abort() }
}

export async function runSubagent(options: SubagentOptions): Promise<SubagentResult> {
  return new Promise((resolve) => {
    startSubagent(options, (event) => {
      if (event.type === "complete") {
        resolve(event.result)
      }
    })
  })
}
