import type { Topic, StyleConfig, Env } from "./types";
import { bedrockClaude } from "./llm/bedrock";
import { groqChat } from "./llm/groq";

export function buildWriterPrompt(topic: Topic, style: StyleConfig, articleBody?: string): { system: string; user: string } {
  const system = [
    "You are ghostwriting a single short LinkedIn post for an AI/tech practitioner.",
    "",
    `VOICE: ${style.tone}`,
    "",
    "HOW TO WRITE:",
    ...style.structureRules.map((r) => `- ${r}`),
    "",
    `HASHTAGS: ${style.hashtagStrategy}`,
    "",
    "DO:",
    ...style.dos.map((r) => `- ${r}`),
    "",
    "DON'T:",
    ...style.donts.map((r) => `- ${r}`),
    "",
    style.examples.length
      ? `TWO FLAVOUR SAMPLES (just the voice and the rhythm — DO NOT copy sentences, phrases, analogies, characters, or the subject matter from these; write something NEW about the actual story below):\n\n${style.examples.map((e, i) => `--- sample ${i + 1} ---\n${e}`).join("\n\n")}`
      : "",
    "",
    'Return ONLY a JSON object, no markdown fences: {"text": "<the post body WITHOUT hashtags>", "hashtags": ["#Tag1"]}. The hashtags array MUST contain 4-5 relevant hashtags.',
  ].filter(Boolean).join("\n");

  const bodyBlock = articleBody && articleBody.trim()
    ? `Article excerpt (use ONLY these facts — never invent CVE numbers, quotes, percentages, dates, or company statements that are not here or in the headline):\n"""\n${articleBody.slice(0, 3000)}\n"""`
    : `No article excerpt is available. Write only from the headline. Keep the post short and do not invent specifics.`;

  const user = [
    `Headline: "${topic.title}"`,
    `Source: ${topic.source}`,
    `Link: ${topic.url}`,
    "",
    bodyBlock,
    "",
    "Write today's post about this story. Study the sample rhythm but write something NEW. 60-120 words. No labelled sections. Include 4-5 hashtags in the hashtags array.",
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

const MIN_HASHTAGS = 4;
const GENERIC_TAGS = ["#AI", "#SoftwareEngineering", "#Tech", "#Developers", "#Technology"];

function normTag(h: string): string {
  const t = h.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return t ? "#" + t : "";
}

/** Guarantee 4-5 hashtags: ask Groq for missing ones, then pad with generic tags. */
export async function ensureHashtags(
  post: { text: string; hashtags: string[] }, topic: Topic, groqApiKey: string, fetchFn?: typeof fetch,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (h: string) => {
    const t = normTag(h);
    if (t && !seen.has(t.toLowerCase()) && out.length < 5) { seen.add(t.toLowerCase()); out.push(t); }
  };
  post.hashtags.forEach(add);
  if (out.length < MIN_HASHTAGS) {
    try {
      const raw = await groqChat({
        apiKey: groqApiKey, temperature: 0.4, fetchFn,
        system: "You output only hashtags: 5 relevant LinkedIn hashtags, space separated, PascalCase, no explanation.",
        user: `Headline: ${topic.title}\n\nPost:\n${post.text}`,
      });
      (raw.match(/#[\p{L}\p{N}_]+/gu) ?? []).forEach(add);
    } catch { /* fall through to generic */ }
  }
  for (const g of GENERIC_TAGS) if (out.length < MIN_HASHTAGS) add(g);
  return out;
}

export async function writePost(args: WriteArgs): Promise<{ text: string; hashtags: string[] }> {
  const { system, user } = buildWriterPrompt(args.topic, args.style, args.articleBody);
  let post: { text: string; hashtags: string[] };
  try {
    const raw = await bedrockClaude({ env: args.env, system, user, signedFetch: args.signedFetch });
    post = parseWriterOutput(raw);
  } catch {
    const raw = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.8, fetchFn: args.fetchFn });
    post = parseWriterOutput(raw);
  }
  return { text: post.text, hashtags: await ensureHashtags(post, args.topic, args.groqApiKey, args.fetchFn) };
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
