import { Type, type Tool } from "@earendil-works/pi-ai"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
})

export const definition: Tool = {
  name: "web_fetch",
  description:
    "Fetch a URL and extract the main readable content. Strips navigation, ads, sidebars, and other clutter.",
  parameters: Type.Object({
    url: Type.String({ description: "The URL to fetch" }),
    extractMode: Type.Optional(
      Type.Union(
        [Type.Literal("markdown"), Type.Literal("text")],
        { description: "Output format (default: markdown)" },
      ),
    ),
    maxChars: Type.Optional(
      Type.Integer({ description: "Truncate output to this many characters" }),
    ),
  }),
}

export interface WebFetchArgs {
  url: string
  extractMode?: "markdown" | "text"
  maxChars?: number
}

export async function handle(args: WebFetchArgs): Promise<string> {
  const response = await fetch(args.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AgenticLoop/1.0; +https://github.com/kushal/flydotio)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    return `Error: HTTP ${response.status} ${response.statusText}`
  }

  const html = await response.text()
  const { document } = parseHTML(html)
  const reader = new Readability(document)
  const article = reader.parse()

  if (!article) {
    return "Error: Could not extract readable content from this page."
  }

  let content: string

  if (args.extractMode === "text") {
    content = article.textContent
  } else {
    content = turndown.turndown(article.content)
  }

  const header = `# ${article.title}\n\n`
  const body = content.trim()
  let result = header + body

  if (args.maxChars && result.length > args.maxChars) {
    result = result.slice(0, args.maxChars) + "\n\n[...truncated]"
  }

  return result
}
