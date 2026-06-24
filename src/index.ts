import { createModels } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"

async function main() {
  const models = createModels()
  models.setProvider(opencodeProvider())

  const model = models.getModel("opencode", "deepseek-v4-flash-free")!

  const response = await models.complete(model, {
    messages: [
      {
        role: "user",
        content:
          "You are helping build an agentic problem solving loop. " +
          "The system should: fetch new problems, solve them, test the solution, " +
          "iterate until correct, then move to the next problem. " +
          "All fully autonomous. Give me a brief overview of how you'd architect this system.",
        timestamp: Date.now(),
      },
    ],
  })

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
