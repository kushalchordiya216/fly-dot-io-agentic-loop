import assert from "node:assert/strict"
import { test } from "node:test"
import { createModels, type Context } from "@earendil-works/pi-ai"
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { runLoop } from "../src/index.js"
import { definitions } from "../src/tools/index.js"
import { get } from "../src/prompts.js"

function makeContext(): Context {
  return {
    systemPrompt: get("echo-system", {
      challenge_url: "https://fly.io/dist-sys/1/",
    }),
    messages: [
      { role: "user", content: "Go ahead.", timestamp: Date.now() },
    ],
    tools: definitions,
  }
}

test("loop returns text for a single text response (no tool calls)", async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage("Hello from the LLM!"),
  ])

  const context = makeContext()
  const model = faux.getModel()
  const output = await runLoop(context, models, model)

  assert.equal(output, "Hello from the LLM!")
  assert.equal(faux.state.callCount, 1)
})

test("loop processes one tool call and returns final text", async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash_spawn", { command: "echo hi" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Done!"),
  ])

  const context = makeContext()
  const model = faux.getModel()
  const output = await runLoop(context, models, model)

  assert(output.includes("Done!"))
  assert.equal(faux.state.callCount, 2)
  // context should have: user, assistant(toolCall), toolResult, assistant(text)
  assert.equal(context.messages.length, 4)
})

test("loop processes multiple parallel tool calls in one turn", async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("bash_spawn", { command: "echo a" }),
      fauxToolCall("bash_spawn", { command: "echo b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("All done!"),
  ])

  const context = makeContext()
  const model = faux.getModel()
  const output = await runLoop(context, models, model)

  assert(output.includes("All done!"))
  // 1 user + 1 assistant (2 toolCalls) + 2 toolResults + 1 assistant (text) = 5
  assert.equal(context.messages.length, 5)
})

test("loop handles tool error gracefully", async () => {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("nonexistent_tool", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("Recovered from error."),
  ])

  const context = makeContext()
  const model = faux.getModel()
  const output = await runLoop(context, models, model)

  assert(output.includes("Recovered from error."))
  // check the toolResult was marked as error
  const toolResult = context.messages.find(
    (m) => m.role === "toolResult",
  )
  assert(toolResult)
  assert(toolResult.isError === true)
})
