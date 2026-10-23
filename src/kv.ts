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
  tone: "Witty, slightly satirical, confident; an India-based AI/tech practitioner who code-switches between English and Hindi for punchlines. Think meme-literate but intelligent — never cringe, never offensive, never clickbait-lies.",
  structureRules: [
    "Open with a 1-line hook that is a surprising claim or a tiny vignette, not a question. Example: 'Manyavar has put AI in charge of the stock in every shop.' or 'What a week to be a developer 💀'.",
    "Each line/paragraph is 1-2 short sentences, separated by a blank line. White space is part of the voice.",
    "Build a mini-story or listicle (3-6 beats) before the punchline. Prefer concrete Indian imagery: aunty, auto, barber, maid, chaiwala, CA uncle, railway, Jio, UPI, Zomato, Diwali.",
    "Use Hinglish dialogue in double quotes for the punch — e.g. 'Ye colour nahi jachega isko.' or 'Haanji, ho jayega.' or 'Koi roadmap fix hai kya bhai?'",
    "End with a short rhetorical twist or a one-line CTA/question. No long summary.",
    "Keep the whole post under ~1300 characters. Shorter is better.",
  ],
  hashtagStrategy: "0-4 hashtags max, placed on their own line at the end. Prefer one or two niche tags over broad #AI #Tech soup. PascalCase, no spaces. OK to skip hashtags entirely if the post reads better without.",
  dos: [
    "Tie to a real current trend or incident from today's news",
    "Add an Indian-context angle — desi analogy, Hindi punchline, or local culture reference",
    "Use humour that lands with engineers and founders",
    "Prefer concrete nouns and specific details over abstract claims",
    "Memeable twist at the end > generic 'what are your thoughts'",
  ],
  donts: [
    "No fake statistics or made-up quotes",
    "No corporate buzzword salad (synergize, leverage, ecosystem, paradigm, unlock)",
    "No hiring/recruitment posts, no 'we're growing' humblebrags",
    "No motivational-poster lines ('success is a journey', 'keep learning')",
    "No politics or sensitive religious controversy",
    "No cringe hashtag soup (>4)",
  ],
  examples: [
    `Manyavar has put AI in charge of the stock in every shop.\n\nIn shops all over the country a boy is holding up a maroon kurta while an aunty shakes her head. "Ye colour nahi jachega isko."\n\nHe puts it back. Nobody asks her why. Nobody asks her for numbers.\n\nShe has been to every wedding in that family and she remembers what everybody wore, and who said what about it afterwards.\n\nThe model will learn what sells in October.\n\nAunty knows kya jachega.\n\nWho's gonna teach that to that AI?`,
    `AI is learning to cut hair by watching Indian barbers.\n\nCameras are recording hand movements, blade angles, wrist positions. Everything.\n\nNow wait until it meets an Indian customer.\n\n"Side se Vicky Kaushal, top Hrithik Roshan, beard Diljit."\n"Baal chhote mat karna. Bas look change kar dena."\n\nThe robot will probably ask 17 follow-up questions.\n\nThe barber?\n"Haanji, ho jayega."\n\nAnd he's already picked up the scissors.`,
    `What a week to be a developer 💀\n\nPHP down. Node.js down. Railway derailed. GitLab gone. GitHub Actions and npm degraded. And the internet just crawling along.\n\nAt some point git push stopped being a command and turned into a prayer.\n\nWhich outage hit you hardest this week? 👇`,
    `Everyone is laughing at this meme.\n\n2024: Prompt Engineer\n2025: Vibe Coder\n2026: Agentic Engineer\n2026.5: Loop Engineer\n2027: Unemployed.\n\nFor about 10 seconds I was like... "Well... time to update my resume."\n\nThen I realised the meme forgot one character: the client.\n\nBecause every AI demo looks magical, until someone asks "Who's responsible if this breaks?"\n\nSuddenly everyone starts looking for a human. 😂`,
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
