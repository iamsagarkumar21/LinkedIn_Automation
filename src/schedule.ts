import type { Topic } from "./types";

export type Category = "ai_news" | "tech_news" | "learning" | "repo";

export const CATEGORY_LABEL: Record<Category, string> = {
  ai_news: "AI news",
  tech_news: "Tech news (non-AI)",
  learning: "Learning / explainer",
  repo: "Repo spotlight",
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Weekday in IST: 0 = Sunday ... 6 = Saturday. */
export function istWeekday(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
}

/** Whole weeks since Monday 1970-01-05 (IST). Used to alternate Sundays. */
export function istWeekIndex(now: Date): number {
  const days = Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000);
  return Math.floor((days - 4) / 7); // 1970-01-05 is day 4 and a Monday
}

/**
 * Weekly plan (IST): Mon AI news, Wed learning, Fri non-AI tech news,
 * Sat repo spotlight, Sun AI news on alternate weeks. Tue and Thu are skipped.
 */
export function categoryForDate(now: Date): Category | null {
  switch (istWeekday(now)) {
    case 1: return "ai_news";
    case 3: return "learning";
    case 5: return "tech_news";
    case 6: return "repo";
    case 0: return istWeekIndex(now) % 2 === 0 ? "ai_news" : null;
    default: return null;
  }
}

const AI_RE = /\b(ai|a\.i\.|llm|llms|gpt|chatgpt|openai|anthropic|claude|gemini|deepmind|mistral|copilot|cursor|agent|agents|agentic|neural|machine learning|deep learning|diffusion|transformer|rag|mcp|nvidia|hugging ?face|model|models)\b/i;

export function isAiTopic(t: Topic): boolean {
  return AI_RE.test(t.title);
}

/** Narrow the pooled topics to the ones that fit today's category. */
export function filterForCategory(topics: Topic[], category: Category): Topic[] {
  switch (category) {
    case "repo": return topics.filter((t) => t.source === "github-trending");
    case "ai_news": return topics.filter((t) => t.source !== "github-trending" && isAiTopic(t));
    case "tech_news": return topics.filter((t) => t.source !== "github-trending" && !isAiTopic(t));
    case "learning": return topics;
  }
}
