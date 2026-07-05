import { createModels, type Context, type ToolCall } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import { definitions, executeTool } from "../src/tools/index.js"
import { get } from "../src/prompts.js"

async function main() {
  const promptName = process.argv[2]
  if (!promptName) {
    console.error("Usage: npx tsx scripts/run-test.ts <prompt-name>")
    console.error("Available: test_file_write, test_file_edit, test_file_read_grep, test_file_workflow")
    process.exit(1)
  }

  const models = createModels()
  models.setProvider(opencodeProvider())

  const model = models.getModel("opencode", "deepseek-v4-flash-free")!
  if (!model) {
    console.error("Model not found — is OPENCODE_API_KEY set in .env?")
    process.exit(1)
  }

  const context: Context = {
    systemPrompt: get(promptName),
    messages: [
      { role: "user", content: "Go ahead and run the test.", timestamp: Date.now() },
    ],
    tools: definitions,
  }

  console.error(`\nRunning test with prompt: ${promptName}\n`)

  let response = await models.complete(model, context)
  context.messages.push(response)

  while (response.stopReason === "toolUse") {
    const toolCalls = response.content.filter((b): b is ToolCall => b.type === "toolCall")
    for (const call of toolCalls) {
      console.error(`  → executing ${call.name}(${JSON.stringify(call.arguments)})`)
      const result = await executeTool(call.name, call.arguments)
      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result }],
        isError: result.startsWith("Error"),
        timestamp: Date.now(),
      })
      console.error(`  ← ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`)
    }
    response = await models.complete(model, context)
    context.messages.push(response)
  }

  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text)
    }
  }
}

main().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
