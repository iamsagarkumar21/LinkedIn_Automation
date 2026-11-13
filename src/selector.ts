import type { Topic } from "./types";
import { groqChat } from "./llm/groq";
import type { Category } from "./schedule";

export function filterFresh(topics: Topic[], recentKeys: string[]): Topic[] {
  const recent = new Set(recentKeys);
  return topics.filter((t) => !recent.has(t.key));
}

export interface SelectArgs {
  topics: Topic[]; recentKeys: string[]; groqApiKey: string; category?: Category; fetchFn?: typeof fetch;
}

const NEWS_SYSTEM = [
  "You pick the single best trending topic for an AI/tech professional's LinkedIn post.",
  "The post will summarise one real news item in ~80 words with a dry, observational hook and clear facts.",
  "STRONGLY PREFER topics where the headline alone makes it obvious WHAT happened and WHY a tech professional should care:",
  "- Fresh (today/this week) news about AI models, software launches, outages, security bugs/CVEs, data breaches, major funding, acquisitions, lawsuits, open-source releases, developer-tool incidents.",
  "- Specific, named stories with numbers or IDs (CVE, version, severity, user count, dollar amount).",
  "- A clear AI / engineering angle the writer can expand into a 'why this matters' twist.",
  "AVOID: hiring posts, generic motivation, soft-skill advice, 'top 10 tips' listicles, vague thought-leadership, political controversy, celebrity gossip, or headlines so vague the writer would have to invent the facts.",
  "Reply with ONLY the number of the best option.",
];

const LEARNING_SYSTEM = [
  "You pick the single best topic for a LEARNING post on an AI/tech professional's LinkedIn: a concept, technique or paper that working engineers should understand, explained simply.",
  "PREFER: a new or recently popular idea that is practical and relevant (how something works, a new method, a common mistake, a tool or technique people are starting to use).",
  "PREFER topics a smart beginner could follow after a 250-word explanation with one analogy and one example.",
  "AVOID: breaking news, funding or business stories, pure benchmarks/leaderboards, papers that only make sense with heavy maths, hiring posts, motivational content.",
  "Reply with ONLY the number of the best option.",
];

const REPO_SYSTEM = [
  "You pick the single best GitHub repository to spotlight in a LinkedIn post for AI/tech professionals.",
  "PREFER: a repo that solves a clear, real problem, that a developer could try in 5 minutes, with a one-line description that makes its purpose obvious.",
  "AVOID: awesome-lists, tutorials-only repos, crypto/trading bots, repos whose description is empty or vague.",
  "Reply with ONLY the number of the best option.",
];

export function buildSelectorSystem(category?: Category): string {
  const lines = category === "learning" ? LEARNING_SYSTEM : category === "repo" ? REPO_SYSTEM : NEWS_SYSTEM;
  return lines.join("\n");
}

export async function selectTopic(args: SelectArgs): Promise<Topic | null> {
  const fresh = filterFresh(args.topics, args.recentKeys).slice(0, 8);
  if (fresh.length === 0) return null;

  const numbered = fresh.map((t, i) => `${i + 1}. [${t.source}, score ${t.score}] ${t.title}`).join("\n");
  const system = buildSelectorSystem(args.category);
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
