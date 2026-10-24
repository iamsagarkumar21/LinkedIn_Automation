import type { Env, Tokens, PostDraft, StyleConfig, Settings } from "./types";

const K = {
  tokens: "linkedin:tokens",
  draft: "draft:pending",
  recent: "topics:recent",
  style: "config:style",
  edit: "edit:awaiting",
};
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_STYLE: StyleConfig = {
  tone: "Confident, human, dry and observational. Sounds like a smart colleague summarising today's news over coffee — not a press release, not a stand-up comedy set. Self-deprecating when it fits; never puns, never dad jokes, never meme-speak.",
  structureRules: [
    "1) Hook (1-2 lines): a witty line that links the news to something every tech professional experiences — ignoring updates, 'it works on my machine', Friday deployments, endless meetings, patch Tuesday fatigue. Must make the reader smile and keep reading. Example: 'AI just found a bug that sat hidden in PHP for over a decade. 🧓 Meanwhile, I've been tapping \"Remind me tomorrow\" on a phone update since March. 😅'",
    "2) Facts (2-3 lines): what happened, who is affected, the key numbers or IDs (CVE, severity, version, user count, dollar figure, dates). Plain language, no jargon dump. If a specific fact (CVE number, exact percentage, name) is not in the material you were given, OMIT IT — do not invent anything.",
    "3) Twist (1-2 lines): the surprising or AI-related angle. Why does this matter for the AI / tech world specifically?",
    "4) Takeaway (1 line): a punchy lesson that also doubles as a mild punchline. Example: 'Lesson: \"We\\'ll update later\" isn\\'t a plan. It\\'s a countdown. ⏳ Patch today. 🔐'",
    "5) One short call-to-action line, then 3-4 relevant hashtags on their own final line.",
    "Length: 70-100 words TOTAL. Hard cap 120. Count carefully before returning.",
    "Short lines, blank line between each — reads well on a phone.",
  ],
  hashtagStrategy: "Exactly 3-4 hashtags, placed on the FINAL line only. PascalCase for multi-word, no spaces. One or two tied to the specific story (e.g. #PHP2Shell, #CloudflareOutage), one or two broader (e.g. #AISecurity, #AIEngineering, #CyberSecurity, #DevOps). Skip broad #AI #Tech soup.",
  dos: [
    "Tie to a real, named, current news item — article headline + facts you were given",
    "Use the exact numbers / IDs / names that were provided (CVE, version, severity, percentage, dollar)",
    "Keep humour dry, observational, self-deprecating — the kind a senior engineer would actually smile at",
    "Maximum 1 joke per section. Never explain the joke",
    "3-5 emojis max, placed naturally. No decorative emoji walls",
    "Default language: English. Only use Hindi/Hinglish if the user has explicitly asked, or if a single Hindi word is the perfect punch (sparingly)",
  ],
  donts: [
    "No fabricated facts, CVE numbers, percentages, quotes, dates or company statements. If you don't have it, drop the sentence.",
    "No joke in every single line — the reader must still learn what the news IS",
    "No puns, no dad jokes, no 'LOL / lmao', no meme-speak",
    "No jokes about victims, deaths, layoffs, outages that hurt real users, or anything sensitive — serious news stays light only in the hook and takeaway",
    "No corporate buzzword salad (synergize, leverage, ecosystem, paradigm, unlock, game-changer)",
    "No motivational-poster lines ('keep learning', 'success is a journey')",
    "No politics or religious controversy",
    "No Hinglish code-switching by default. Do not insert 'bhai', 'yaar', 'jugaad', 'chai', 'aunty', 'auto', 'jalebi', 'diwali' metaphors unless the news itself is about India or Indian culture",
  ],
  examples: [
    `AI just found a bug that sat hidden in PHP for over a decade. 🧓\nMeanwhile, I've been tapping "Remind me tomorrow" on a phone update since March. 😅\n\nIt's called PHP2Shell (CVE-2026-109618 & CVE-2026-109619, severity 9.2/10). Attackers could run code on a server without even logging in. PHP runs a huge chunk of the web, so the NSA's advice was basically: patch it, or switch it off.\n\nThe good news: this time the good guys found it first, with AI helping.\n\nLesson: "We'll update later" isn't a plan. It's a countdown. ⏳\nPatch today. 🔐\n\n#AISecurity #PHP2Shell #CyberSecurity #AIEngineering`,
    `OpenAI shipped a new "agent mode" and half the internet is now letting it click around their browser. 🙃\n\nIt opens tabs, fills forms, buys stuff — basically a very eager intern with your credit card. Early users report it burning through tokens and occasionally confusing "Buy Now" with "Review Later".\n\nFor engineers, the interesting part isn't the demo — it's that the tool-use loop finally feels production-shaped. Logs, retries, guardrails all included.\n\nTakeaway: give it permissions like you'd give a new hire — scoped, revocable, logged.\n\nWould you let it touch prod? 👇\n\n#AIAgents #OpenAI #DevTools #AIEngineering`,
  ],
};

export async function getTokens(env: Env): Promise<Tokens | null> {
  const raw = await env.STATE.get(K.tokens);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}
export async function setTokens(env: Env, t: Tokens): Promise<void> {
  await env.STATE.put(K.tokens, JSON.stringify(t));
}
export async function getPendingDraft(env: Env): Promise<PostDraft | null> {
  const raw = await env.STATE.get(K.draft);
  return raw ? (JSON.parse(raw) as PostDraft) : null;
}
export async function setPendingDraft(env: Env, d: PostDraft): Promise<void> {
  await env.STATE.put(K.draft, JSON.stringify(d));
}
export async function clearPendingDraft(env: Env): Promise<void> {
  await env.STATE.delete(K.draft);
}
export async function getRecentTopicKeys(env: Env): Promise<string[]> {
  const raw = await env.STATE.get(K.recent);
  const list = raw ? (JSON.parse(raw) as { key: string; usedAt: number }[]) : [];
  const cutoff = Date.now() - FOURTEEN_DAYS;
  return list.filter((x) => x.usedAt >= cutoff).map((x) => x.key);
}
export async function addRecentTopic(env: Env, key: string): Promise<void> {
  const raw = await env.STATE.get(K.recent);
  const list = raw ? (JSON.parse(raw) as { key: string; usedAt: number }[]) : [];
  const cutoff = Date.now() - FOURTEEN_DAYS;
  const next = list.filter((x) => x.usedAt >= cutoff && x.key !== key);
  next.push({ key, usedAt: Date.now() });
  await env.STATE.put(K.recent, JSON.stringify(next));
}
export async function getStyleConfig(env: Env): Promise<StyleConfig> {
  const raw = await env.STATE.get(K.style);
  return raw ? (JSON.parse(raw) as StyleConfig) : DEFAULT_STYLE;
}
export async function getSettings(env: Env): Promise<Settings> {
  return { timezone: "Asia/Kolkata", dryRun: env.DRY_RUN === "true", allowedChatId: env.TELEGRAM_CHAT_ID };
}

const EDIT_TTL = 10 * 60 * 1000;
export async function setAwaitingEdit(env: Env, draftId: string): Promise<void> {
  await env.STATE.put(K.edit, JSON.stringify({ draftId, until: Date.now() + EDIT_TTL }));
}
/** Returns the draft id the owner is editing (one-shot), or null if no live edit request. */
export async function takeAwaitingEdit(env: Env): Promise<string | null> {
  const raw = await env.STATE.get(K.edit);
  if (!raw) return null;
  await env.STATE.delete(K.edit);
  const { draftId, until } = JSON.parse(raw) as { draftId: string; until: number };
  return until > Date.now() ? draftId : null;
}
