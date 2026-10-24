import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export interface ImagePromptArgs {
  topic: Topic; postText: string; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function craftImagePrompt(args: ImagePromptArgs): Promise<string> {
  const system = [
    "You write a single image-generation prompt for a LinkedIn post about a real tech / AI news story.",
    "Default style: a polished editorial poster — clean composition, bold headline-style typography on top of a cinematic photo-realistic or 3D-rendered scene that visually represents the news. Think magazine cover meets tech blog hero image.",
    "The image's main title text should mirror the post's hook or the news in 3-6 words (e.g. 'PHP2Shell: AI Found the Bug', 'OpenAI Agent Goes Shopping').",
    "Only include an Indian setting, desi characters or Hinglish text in the image if the NEWS itself is explicitly about India or Indian companies — otherwise keep it globally neutral.",
    "No real logos, no real people's faces unless the post explicitly names them.",
    "Specify: lighting, mood, 1-2 key visual elements, and the on-image text. 2-4 sentences total.",
    "Reply with ONLY the prompt, no preamble.",
  ].join(" ");
  const user = `Topic: ${args.topic.title}\n\nPost text:\n${args.postText.slice(0, 800)}\n\nWrite the image prompt.`;
  try {
    const out = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.7, fetchFn: args.fetchFn });
    if (out) return out;
  } catch { /* fall through */ }
  return `A clean, modern, slightly playful digital illustration representing "${args.topic.title}", professional LinkedIn style, no text, vibrant but tasteful colors.`;
}
