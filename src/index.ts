import { createModels, type Models, type Model, type Context, type ToolCall, type Api } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import { definitions, executeTool } from "./tools/index.js"
import { get } from "./prompts.js"

export async function runLoop(
  context: Context,
  models: Models,
  model: Model<Api>,
): Promise<string> {
  let response = await models.complete(model, context)
  context.messages.push(response)

  while (response.stopReason === "toolUse") {
    const toolCalls = response.content.filter((b): b is ToolCall => b.type === "toolCall")
    for (const call of toolCalls) {
      const result = await executeTool(call.name, call.arguments)
      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result }],
        isError: result.startsWith("Error"),
        timestamp: Date.now(),
      })
    }
    response = await models.complete(model, context)
    context.messages.push(response)
  }

  const textBlocks = response.content.filter((b): b is { type: "text"; text: string } => b.type === "text")
  return textBlocks.map((b) => b.text).join("\n")
}

async function main() {
  const models = createModels()
  models.setProvider(opencodeProvider())

  const model = models.getModel("opencode", "deepseek-v4-flash-free")!
  if (!model) {
    console.error("Model not found")
    process.exit(1)
  }

  const context: Context = {
    systemPrompt: get("echo-system", {
      challenge_url: "https://fly.io/dist-sys/1/",
    }),
    messages: [
      { role: "user", content: "Go ahead and start the task.", timestamp: Date.now() },
    ],
    tools: definitions,
  }

  const output = await runLoop(context, models, model)
  console.log(output)
}

main().catch((err) => {
  console.error("Loop failed:", err)
  process.exit(1)
})
