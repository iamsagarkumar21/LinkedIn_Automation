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
  const system = [
    "You pick the single best trending topic for an India-based AI/tech professional's LinkedIn post.",
    "The post will be witty, slightly satirical, and often code-switches between English and Hindi.",
    "STRONGLY PREFER topics that are:",
    "- Fresh news (today/this week) about AI, software, startups, outages, bugs, launches, lawsuits, incidents.",
    "- A story you can bend into an Indian context (desi analogy, Hindi punchline, local culture) — e.g. 'Tesla Roadster vs Bangalore potholes', 'AI vs Indian aunty', 'Jio AGM shareholder', 'PHP RCE bug AI found'.",
    "- Memeable: a surprising fact, a failure, a culture clash, a '20-year-old bug' angle.",
    "AVOID: hiring posts, generic motivation, vague thought-leadership, soft-skill tips, old evergreen content, politics.",
    "Reply with ONLY the number of the best option.",
  ].join("\n");
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
