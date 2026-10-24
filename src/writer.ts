import type { Topic, StyleConfig, Env } from "./types";
import { bedrockClaude } from "./llm/bedrock";
import { groqChat } from "./llm/groq";

export function buildWriterPrompt(topic: Topic, style: StyleConfig, articleBody?: string): { system: string; user: string } {
  const system = [
    "You are a LinkedIn ghostwriter for an AI/tech professional.",
    `Tone: ${style.tone}`,
    "Structure rules:", ...style.structureRules.map((r) => `- ${r}`),
    `Hashtags: ${style.hashtagStrategy}`,
    "Do:", ...style.dos.map((r) => `- ${r}`),
    "Don't:", ...style.donts.map((r) => `- ${r}`),
    style.examples.length ? `Match the voice of these example posts (notice: ONE joke in the hook, then plain facts, then a dry takeaway):\n${style.examples.join("\n---\n")}` : "",
    'Return ONLY a JSON object, no markdown fences: {"text": "<the post body WITHOUT hashtags>", "hashtags": ["#Tag1", "#Tag2"]}',
  ].filter(Boolean).join("\n");

  const bodyBlock = articleBody && articleBody.trim()
    ? `Article excerpt (use ONLY these facts — do not invent anything that is not here or in the headline):\n"""\n${articleBody.slice(0, 3000)}\n"""\n`
    : `No article excerpt is available. Write only from the headline. Keep facts minimal and generic rather than inventing specifics.\n`;

  const user = [
    `Headline: "${topic.title}"`,
    `Source: ${topic.source}`,
    `Link: ${topic.url}`,
    "",
    bodyBlock,
    "Write today's post about this. Follow the 5-section structure (Hook / Facts / Twist / Takeaway / CTA + hashtags) and stay inside 70-100 words.",
  ].join("\n");

  return { system, user };
}

export function parseWriterOutput(raw: string): { text: string; hashtags: string[] } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Writer output had no JSON object");
  let obj: any;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error("Writer output JSON was invalid"); }
  const text = String(obj?.text ?? "").trim();
  if (!text) throw new Error("Writer output had empty text");
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const h of Array.isArray(obj?.hashtags) ? obj.hashtags : []) {
    let tag = String(h).trim();
    if (!tag) continue;
    if (!tag.startsWith("#")) tag = "#" + tag.replace(/^#+/, "");
    const low = tag.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low); hashtags.push(tag);
    if (hashtags.length === 5) break;
  }
  return { text, hashtags };
}

export interface WriteArgs {
  topic: Topic; style: StyleConfig; env: Env; groqApiKey: string;
  articleBody?: string;
  fetchFn?: typeof fetch; signedFetch?: typeof fetch;
}

export async function writePost(args: WriteArgs): Promise<{ text: string; hashtags: string[] }> {
  const { system, user } = buildWriterPrompt(args.topic, args.style, args.articleBody);
  try {
    const raw = await bedrockClaude({ env: args.env, system, user, signedFetch: args.signedFetch });
    return parseWriterOutput(raw);
  } catch {
    const raw = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.8, fetchFn: args.fetchFn });
    return parseWriterOutput(raw);
  }
}

/** Fetch a news article, strip HTML, return readable text (first ~3000 chars). Best-effort — any failure returns "". */
export async function fetchArticleBody(url: string, fetchFn: typeof fetch = globalThis.fetch): Promise<string> {
  if (!url || !/^https?:\/\//.test(url)) return "";
  try {
    const r = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; linkedin-auto-poster/0.2; +https://linkedin-auto-poster.workers.dev)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!r.ok) { console.log(`article fetch ${url} -> ${r.status}`); return ""; }
    const ct = r.headers.get("Content-Type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return "";
    const html = await r.text();
    // Prefer <article>, fall back to <main>, then <body>.
    const section =
      html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
      html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
      html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
      html;
    const text = section
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 3000);
  } catch (e) { console.log(`article fetch threw ${url}: ${e}`); return ""; }
}
