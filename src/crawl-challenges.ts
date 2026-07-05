interface Challenge {
  title: string;
  description: string;
  link: string;
  next_link: string | null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

function extractChallenge(
  html: string,
  url: string,
): { challenge: Challenge; nextLink: string | null } {
  const titleMatch = html.match(/<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].trim().replace(/\s+/g, " "))
    : "";

  const descMatch = html.match(
    /<h1[^>]*>[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/i,
  );
  let description = "";
  if (descMatch) {
    description = decodeHtmlEntities(stripHtmlTags(descMatch[1]));
    description = description.replace(/\s+/g, " ").trim();
  }

  const nextRegex =
    /(?:(?:move on to|continue on to)\s+(?:the\s+)?|for the next challenge:\s*)<a\s+href='([^']+)'/i;
  const nextMatch = html.match(nextRegex);
  let nextLink: string | null = null;
  if (nextMatch) {
    let href = nextMatch[1];
    if (!href.startsWith("http")) {
      href = `https://fly.io${href}`;
    }
    if (!href.endsWith("/")) {
      href += "/";
    }
    nextLink = href;
  }

  const challenge: Challenge = {
    title,
    description,
    link: url,
    next_link: nextLink,
  };
  return { challenge, nextLink };
}

async function crawl(): Promise<void> {
  let currentUrl: string | null = "https://fly.io/dist-sys/1/";
  while (currentUrl) {
    const html = await fetchPage(currentUrl);
    const { challenge, nextLink } = extractChallenge(html, currentUrl);
    console.log(JSON.stringify(challenge));
    currentUrl = nextLink;
  }
}

crawl().catch(console.error);
