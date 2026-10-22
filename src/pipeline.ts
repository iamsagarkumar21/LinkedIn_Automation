import type { Env, PostDraft } from "./types";
import { collectTrends } from "./trends";
import { selectTopic } from "./selector";
import { writePost } from "./writer";
import { craftImagePrompt } from "./imagePrompt";
import { generateImage } from "./image";
import { sendDraft, sendMessage } from "./telegram";
import { getRecentTopicKeys, addRecentTopic, setPendingDraft, getStyleConfig } from "./kv";

export class NoFreshTopicError extends Error {
  constructor() { super("No fresh trending topic available today"); this.name = "NoFreshTopicError"; }
}

export interface PipelineDeps { fetchFn?: typeof fetch; signedFetch?: typeof fetch; }

export async function buildDraft(env: Env, deps: PipelineDeps = {}): Promise<PostDraft> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const topics = await collectTrends(fetchFn);
  const recentKeys = await getRecentTopicKeys(env);
  const topic = await selectTopic({ topics, recentKeys, groqApiKey: env.GROQ_API_KEY, fetchFn });
  if (!topic) throw new NoFreshTopicError();

  const style = await getStyleConfig(env);
  const { text, hashtags } = await writePost({ topic, style, env, groqApiKey: env.GROQ_API_KEY, fetchFn, signedFetch: deps.signedFetch });
  const imgPrompt = await craftImagePrompt({ topic, postText: text, groqApiKey: env.GROQ_API_KEY, fetchFn });
  const image = await generateImage({ prompt: imgPrompt, geminiApiKey: env.GEMINI_API_KEY, fetchFn });

  return {
    id: crypto.randomUUID(), topic, text, hashtags,
    imageBase64: image?.base64, imageMime: image?.mime,
    status: "pending", createdAt: Date.now(),
  };
}

export async function runDailyPipeline(env: Env, deps: PipelineDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  try {
    const draft = await buildDraft(env, deps);
    await setPendingDraft(env, draft);
    await addRecentTopic(env, draft.topic.key);
    await sendDraft({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, draft, fetchFn });
  } catch (err: any) {
    const msg = err?.name === "NoFreshTopicError"
      ? "ℹ️ No fresh trending topic today — skipping."
      : `⚠️ Draft generation failed: ${err?.message ?? err}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg, fetchFn);
  }
}
