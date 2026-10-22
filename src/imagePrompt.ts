import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export interface ImagePromptArgs {
  topic: Topic; postText: string; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function craftImagePrompt(args: ImagePromptArgs): Promise<string> {
  const system =
    "You write prompts for an AI image generator. Produce ONE vivid, visually clear scene for a LinkedIn post image: modern, clean, slightly playful, professional. Avoid heavy on-image text, logos, or real brand marks. Reply with only the prompt, one sentence or two.";
  const user = `Topic: ${args.topic.title}\nPost gist: ${args.postText.slice(0, 400)}\nWrite the image prompt.`;
  try {
    const out = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.7, fetchFn: args.fetchFn });
    if (out) return out;
  } catch { /* fall through */ }
  return `A clean, modern, slightly playful digital illustration representing "${args.topic.title}", professional LinkedIn style, no text, vibrant but tasteful colors.`;
}
