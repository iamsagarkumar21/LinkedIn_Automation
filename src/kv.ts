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
  tone: "Witty, confident, and relatable; a sharp AI/tech practitioner who makes people smile and think. Never cringe, never offensive, never clickbait-lies.",
  structureRules: [
    "Open with a scroll-stopping hook line (a question, a bold claim, or a surprising number).",
    "Use short paragraphs (1-2 sentences) separated by blank lines.",
    "Make one clear point or insight about the trend.",
    "End with a light question or CTA to invite comments.",
    "Keep the whole post under ~1300 characters.",
  ],
  hashtagStrategy: "Use 3-5 hashtags: one or two broad (#AI, #Tech), one niche to the topic, and one that is currently trending for the topic. No spaces, PascalCase for multiword.",
  dos: ["Tie to a real current trend", "Add a practitioner's perspective", "Use humour that lands with engineers"],
  donts: ["No fake statistics", "No hashtag soup (>5)", "No corporate buzzword salad", "No politics or sensitive controversy"],
  examples: [],
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
