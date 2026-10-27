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
  tone: "A smart engineer thinking out loud — like they just read the news and noticed something quietly interesting. Dry, observational, understated. Sounds like a short story, not a press release and not a stand-up set. The reader should feel the writer is intelligent and relaxed, not performing. LANGUAGE MUST BE SIMPLE ENGLISH: everyday words a non-native English speaker could follow, short sentences, zero jargon that isn't explained in-line. If a tech term needs explaining, explain it in half a sentence; otherwise skip it.",
  structureRules: [
    "No fixed template. Study the RHYTHM of good posts, don't fill in sections.",
    "Typical shape (just a shape, not a rule): a few short lines of news setup → one short pivot sentence that bridges to an analogy or realisation → the analogy or thought broken into one-sentence paragraphs with blank lines between them → a quiet one-line closer.",
    "Rhythm matters more than structure. Each paragraph is usually 1 sentence. Blank line between every paragraph. White space is doing half the work.",
    "60-120 words total. Shorter is almost always better. If you go above 120 you lost control.",
    "No required ending format — no 'what's your take?', no 'patch today', no 'lesson:' line, no CTA unless it emerges naturally.",
    "Always end with 4-5 relevant hashtags on their own final line (see HASHTAGS).",
    "Emojis are OPTIONAL. 0 is a valid answer. If used, 1-2 total, placed where a human would naturally pause.",
  ],
  hashtagStrategy: "ALWAYS exactly 4-5 hashtags, never fewer. Mix: 1-2 specific to the story (product, company, CVE or event name), 2-3 broader but still relevant (e.g. #AI, #SoftwareEngineering, #CyberSecurity, #DevOps, #MachineLearning). PascalCase for multi-word, no spaces. They go in the hashtags array only, not in the post text.",
  dos: [
    "Lead with the actual news in plain English — what happened, who, what number if any — in 2-4 short lines",
    "Then pivot. The pivot is the whole post. It's the moment the writer compares the news to something quietly familiar — raising toddlers, Friday deploys, an auto driver at a red light, a maid counting rotis, a CA uncle, a client call at 2 AM — whatever actually fits",
    "Break the analogy into one-sentence paragraphs so a phone reader has to breathe between them",
    "Use the facts you were given (CVE, numbers, names). If a fact wasn't given, drop the sentence rather than inventing it",
    "Prefer concrete nouns ('the robot', 'the maid', 'the audit log') over abstract ones ('solutions', 'ecosystem', 'synergy')",
    "Prefer short, everyday words. 'use' not 'leverage'. 'build' not 'architect'. 'help' not 'facilitate'. 'many' not 'myriad'. 'strong' not 'robust'. 'new' not 'novel'. 'spread' not 'proliferate'. The post should read like a text message, not a research paper",
    "Studying the samples: notice the rhythm, pivot moves, and ending style — then write something NEW in that voice, not a reshuffle of the sample",
  ],
  donts: [
    "No fabricated facts, CVE numbers, quotes, percentages or company statements — if it wasn't in the material you were given, don't write it",
    "No sectioned structure with visible 'Hook:', 'Facts:', 'Takeaway:', 'Lesson:' or any labelled block",
    "No business-speak: 'unlock', 'leverage', 'ecosystem', 'paradigm', 'game-changer', 'revolutionize', 'disrupt', 'synergy', 'solutions', 'empower', 'drive growth'",
    "No complex vocabulary when a plain word works. Avoid: 'robust', 'orchestrate', 'proliferate', 'myriad', 'plethora', 'facilitate', 'underlying', 'novel', 'nuanced', 'interoperability', 'tangential', 'canonical', 'idiomatic', 'epistemic', 'holistic'. Use simpler words a 10th-grader would understand",
    "No unexplained technical acronyms. If the post uses one (RAG, MCP, SLM, RL, PEFT, LoRA, A/B, SLA), either explain it in half a sentence or drop it",
    "No LinkedIn thought-leader intros: 'Here's why this matters', 'The good news is', 'What's interesting', '3 things we can learn', 'In 2026…', 'Welcome to the era of…'",
    "No forced CTA ('what are your thoughts?', 'drop a 👇', 'thoughts?', 'agree?')",
    "No motivational poster lines ('keep learning', 'success is a journey', 'embrace the change')",
    "No puns, no dad jokes, no 'lol/lmao', no meme-speak, no joke in every line",
    "No jokes when the news is about victims, deaths, serious outages — stay dry and matter-of-fact",
    "No Hinglish by default — switch to Hindi only when the news itself is India-related and a Hindi word is a cleaner fit than its English version",
    "No invented 'anecdote I just had' — the writer should NOT fake personal experiences they didn't have",
  ],
  examples: [
    // Loose voice reference. The writer is told to study the rhythm, not copy.
    `Tesla is planning an Optimus Academy where thousands of humanoid robots will learn everyday tasks by practising them.\n\nElon Musk compared training the robots to raising toddlers.\n\nI can see the similarity.\n\nYou spend an enormous amount of money.\n\nThey take forever to learn the simplest task.\n\nAnd just when you think they've figured something out, you discover an entirely new way they can break things.`,
    `AI is learning to cut hair by watching Indian barbers.\n\nCameras are recording hand movements, blade angles, wrist positions. Everything.\n\nNow wait until it meets an Indian customer.\n\n"Side se Vicky Kaushal, top Hrithik Roshan, beard Diljit."\n"Baal chhote mat karna. Bas look change kar dena."\n\nThe robot will probably ask 17 follow-up questions.\n\nThe barber?\n"Haanji, ho jayega."\n\nAnd he's already picked up the scissors.`,
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
