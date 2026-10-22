import type { Topic, StyleConfig, Env } from "./types";
import { bedrockClaude } from "./llm/bedrock";
import { groqChat } from "./llm/groq";

export function buildWriterPrompt(topic: Topic, style: StyleConfig): { system: string; user: string } {
  const system = [
    "You are a LinkedIn ghostwriter for an AI/tech professional.",
    `Tone: ${style.tone}`,
    "Structure rules:", ...style.structureRules.map((r) => `- ${r}`),
    `Hashtags: ${style.hashtagStrategy}`,
    "Do:", ...style.dos.map((r) => `- ${r}`),
    "Don't:", ...style.donts.map((r) => `- ${r}`),
    style.examples.length ? `Match the voice of these example posts:\n${style.examples.join("\n---\n")}` : "",
    'Return ONLY a JSON object, no markdown fences: {"text": "<the post body WITHOUT hashtags>", "hashtags": ["#Tag1", "#Tag2"]}',
  ].filter(Boolean).join("\n");

  const user = `Trending topic: "${topic.title}" (source: ${topic.source}, link: ${topic.url}).\nWrite today's post about this.`;
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
  fetchFn?: typeof fetch; signedFetch?: typeof fetch;
}

export async function writePost(args: WriteArgs): Promise<{ text: string; hashtags: string[] }> {
  const { system, user } = buildWriterPrompt(args.topic, args.style);
  try {
    const raw = await bedrockClaude({ env: args.env, system, user, signedFetch: args.signedFetch });
    return parseWriterOutput(raw);
  } catch {
    const raw = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.8, fetchFn: args.fetchFn });
    return parseWriterOutput(raw);
  }
}
