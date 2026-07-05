import { createModels } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import type { Context, ToolCall } from "@earendil-works/pi-ai"
import { definitions, executeTool } from "./tools/index"
import { get } from "./prompts"
import { crawlAllChallenges } from "./crawl-challenges"

async function main() {
  console.error("Crawling challenges…")
  const challenges = await crawlAllChallenges("challenges.json")
  console.error(`Crawled ${challenges.length} challenges → challenges.json`)

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
      challenges_json_path: "challenges.json",
      challenges_count: String(challenges.length),
    }),
    messages: [
      { role: "user", content: "Go ahead and start the task.", timestamp: Date.now() },
    ],
    tools: definitions,
  }

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

  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text)
    }
  }
}

main().catch((err) => {
  console.error("Loop failed:", err)
  process.exit(1)
})
