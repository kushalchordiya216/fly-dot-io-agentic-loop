import { createModels, type Context } from "@earendil-works/pi-ai"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import { handle as webFetch } from "./tools/web-fetch.js"
import { get } from "./prompts.js"

const models = createModels()
models.setProvider(opencodeProvider())
const model = models.getModel("opencode", "deepseek-v4-flash-free")!

interface Challenge {
  title: string
  description: string
  link: string
  next_link: string | null
}

function extractJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text)
  } catch {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) {
      try {
        return JSON.parse(codeBlock[1])
      } catch {}
    }
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0])
      } catch {}
    }
  }
  throw new Error(`Could not parse JSON from LLM response: ${text.slice(0, 200)}`)
}

async function extractChallenge(pageContent: string, url: string): Promise<Challenge> {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: get("extract-challenge", { page_content: pageContent }),
        timestamp: Date.now(),
      },
    ],
  }

  const response = await models.complete(model, context)
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")

  const data = extractJson(text)

  return {
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    link: url,
    next_link: data.next_link ? String(data.next_link) : null,
  }
}

async function crawl(): Promise<void> {
  let currentUrl: string | null = "https://fly.io/dist-sys/1/"

  while (currentUrl) {
    const result = await webFetch({ url: currentUrl, extractMode: "markdown" })

    if (result.startsWith("Error:")) {
      console.error(result)
      break
    }

    const challenge = await extractChallenge(result, currentUrl)
    console.log(JSON.stringify(challenge))
    currentUrl = challenge.next_link
  }
}

crawl().catch(console.error)
