import type { Env, PostDraft } from "./types";
import { collectTrends, collectLearningTopics } from "./trends";
import { categoryForDate, filterForCategory, CATEGORY_LABEL, type Category } from "./schedule";
import { selectTopic } from "./selector";
import { writePost, fetchArticleBody } from "./writer";
import { craftImagePrompt } from "./imagePrompt";
import { generateImage } from "./image";
import { sendDraft, sendMessage } from "./telegram";
import { getRecentTopicKeys, addRecentTopic, setPendingDraft, getStyleConfig, getTokens } from "./kv";

export class NoFreshTopicError extends Error {
  constructor() { super("No fresh trending topic available today"); this.name = "NoFreshTopicError"; }
}

export interface PipelineDeps { fetchFn?: typeof fetch; signedFetch?: typeof fetch; }

export async function buildDraft(env: Env, deps: PipelineDeps = {}, category: Category = "ai_news"): Promise<PostDraft> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const pool = category === "learning" ? await collectLearningTopics(fetchFn) : await collectTrends(fetchFn);
  const topics = filterForCategory(pool, category);
  console.log(`category ${category}: ${topics.length} candidate topics`);
  const recentKeys = await getRecentTopicKeys(env);
  const topic = await selectTopic({ topics, recentKeys, groqApiKey: env.GROQ_API_KEY, category, fetchFn });
  if (!topic) throw new NoFreshTopicError();

  const style = await getStyleConfig(env);
  const articleBody = await fetchArticleBody(topic.url, fetchFn);
  const { text, hashtags } = await writePost({ topic, style, env, groqApiKey: env.GROQ_API_KEY, articleBody, category, fetchFn, signedFetch: deps.signedFetch });
  const imgPrompt = await craftImagePrompt({ topic, postText: text, groqApiKey: env.GROQ_API_KEY, fetchFn });
  const image = await generateImage({ prompt: imgPrompt, geminiApiKey: env.GEMINI_API_KEY, fetchFn });

  return {
    id: crypto.randomUUID(), topic, text, hashtags, category,
    imageBase64: image?.base64, imageMime: image?.mime, imagePrompt: imgPrompt,
    status: "pending", createdAt: Date.now(),
  };
}

export async function regenText(env: Env, draft: PostDraft, deps: PipelineDeps = {}): Promise<PostDraft> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const style = await getStyleConfig(env);
  const articleBody = await fetchArticleBody(draft.topic.url, fetchFn);
  const { text, hashtags } = await writePost({ topic: draft.topic, style, env, groqApiKey: env.GROQ_API_KEY, articleBody, category: draft.category, fetchFn, signedFetch: deps.signedFetch });
  return { ...draft, id: crypto.randomUUID(), text, hashtags, status: "pending", createdAt: Date.now() };
}

export async function regenImage(env: Env, draft: PostDraft, deps: PipelineDeps = {}): Promise<PostDraft> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const prompt = await craftImagePrompt({ topic: draft.topic, postText: draft.text, groqApiKey: env.GROQ_API_KEY, fetchFn });
  const image = await generateImage({ prompt, geminiApiKey: env.GEMINI_API_KEY, fetchFn });
  return {
    ...draft, id: crypto.randomUUID(),
    imageBase64: image?.base64, imageMime: image?.mime, imagePrompt: prompt,
    status: "pending", createdAt: Date.now(),
  };
}

const WARN_WINDOW = 7 * 24 * 60 * 60 * 1000;

async function warnIfAuthExpiring(env: Env, fetchFn: typeof fetch): Promise<void> {
  try {
    const t = await getTokens(env);
    const send = (m: string) => sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, m, fetchFn);
    if (!t) { await send("⚠️ No LinkedIn tokens stored — follow scripts/linkedin-oauth.md before approving a post."); return; }
    const expiresAt = t.refreshToken ? t.refreshExpiresAt : t.accessExpiresAt;
    const left = expiresAt - Date.now();
    if (left < WARN_WINDOW) {
      const days = Math.max(0, Math.ceil(left / 86400_000));
      await send(`⚠️ LinkedIn authorization expires in ${days} day(s). Re-authorize (see scripts/linkedin-oauth.md) before then.`);
    }
  } catch { /* a failed warning must never block the draft */ }
}

export async function runDailyPipeline(env: Env, deps: PipelineDeps = {}, category: Category = "ai_news"): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  await warnIfAuthExpiring(env, fetchFn);
  try {
    const draft = await buildDraft(env, deps, category);
    await setPendingDraft(env, draft);
    await addRecentTopic(env, draft.topic.key);
    await sendDraft({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, draft, fetchFn });
  } catch (err: any) {
    const msg = err?.name === "NoFreshTopicError"
      ? `ℹ️ No fresh ${CATEGORY_LABEL[category]} topic today — skipping.`
      : `⚠️ Draft generation failed: ${err?.message ?? err}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg, fetchFn).catch(() => {});
  }
}
