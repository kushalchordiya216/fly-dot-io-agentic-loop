import { createModels, type Context, type ToolCall } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import { definitions, executeTool } from "../src/tools/index.js"
import { get } from "../src/prompts.js"

function describeResponse(response: Context["messages"][number]) {
  if (response.role !== "assistant") return

  const blocks = response.content.map((block) => block.type).join(", ") || "none"
  console.error(`  ← model stopReason=${response.stopReason}; content blocks=${blocks}`)
  if (response.errorMessage) {
    console.error(`  ← model error: ${response.errorMessage}`)
  }
}

async function main() {
  const promptName = process.argv[2]
  if (!promptName) {
    console.error("Usage: node --env-file .env --import tsx/esm scripts/run-test.ts <prompt-name>")
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

  console.error("  → calling model")
  let response = await models.complete(model, context)
  describeResponse(response)
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
    console.error("  → calling model")
    response = await models.complete(model, context)
    describeResponse(response)
    context.messages.push(response)
  }

  let printedText = false
  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text)
      printedText = true
    }
  }

  if (!printedText) {
    console.error("No final text returned by the model. Full response:")
    console.error(JSON.stringify(response, null, 2))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
