import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export function filterFresh(topics: Topic[], recentKeys: string[]): Topic[] {
  const recent = new Set(recentKeys);
  return topics.filter((t) => !recent.has(t.key));
}

export interface SelectArgs {
  topics: Topic[]; recentKeys: string[]; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function selectTopic(args: SelectArgs): Promise<Topic | null> {
  const fresh = filterFresh(args.topics, args.recentKeys).slice(0, 8);
  if (fresh.length === 0) return null;

  const numbered = fresh.map((t, i) => `${i + 1}. [${t.source}, score ${t.score}] ${t.title}`).join("\n");
  const system =
    "You help an AI/tech professional pick the single best trending topic to make a witty, insightful LinkedIn post about. Prefer topics that are current, relevant to AI/software engineers, and have humour or strong-opinion potential. Reply with ONLY the number of the best option.";
  try {
    const reply = await groqChat({
      apiKey: args.groqApiKey, system, user: `Options:\n${numbered}\n\nReply with only the number.`,
      temperature: 0.3, fetchFn: args.fetchFn,
    });
    const n = parseInt((reply.match(/\d+/)?.[0] ?? ""), 10);
    if (Number.isInteger(n) && n >= 1 && n <= fresh.length) return fresh[n - 1];
  } catch {
    // fall through to score-based pick
  }
  return fresh[0];
}
