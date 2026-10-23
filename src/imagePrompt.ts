import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export interface ImagePromptArgs {
  topic: Topic; postText: string; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function craftImagePrompt(args: ImagePromptArgs): Promise<string> {
  const system = [
    "You write prompts for an AI image generator (Midjourney / Gemini / Sora / ChatGPT image) for a LinkedIn post.",
    "The post is an India-based AI/tech practitioner's slightly satirical take on a news item.",
    "Produce ONE prompt (2-4 sentences) describing a vivid, meme-style scene that visually mirrors the post's punchline.",
    "Lean into desi context when the post does: Indian street, auto-rickshaw, chaiwala, aunty, Bangalore pothole, Jio AGM audience, Indian barber shop, etc.",
    "Allow comic-style callouts, speech bubbles, Hinglish text labels in the IMAGE when they are the joke (e.g. 'Haanji, ho jayega.', 'Shareholder hoon. Discount milega?').",
    "Specify style explicitly: 'photo-real cinematic meme-poster', 'Pixar-style illustration', 'editorial collage with bold headline', etc. so the image feels polished, not generic clipart.",
    "Avoid real logos and real people's faces unless the post itself names them.",
    "Reply with ONLY the image prompt, no preamble.",
  ].join(" ");
  const user = `Topic: ${args.topic.title}\n\nPost text:\n${args.postText.slice(0, 800)}\n\nWrite the image prompt.`;
  try {
    const out = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.7, fetchFn: args.fetchFn });
    if (out) return out;
  } catch { /* fall through */ }
  return `A clean, modern, slightly playful digital illustration representing "${args.topic.title}", professional LinkedIn style, no text, vibrant but tasteful colors.`;
}
