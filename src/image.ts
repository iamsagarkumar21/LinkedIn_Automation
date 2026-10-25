export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function extractGeminiImage(json: any): { base64: string; mime: string } | null {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data;
    if (inline?.data) return { base64: String(inline.data), mime: String(inline.mimeType ?? inline.mime_type ?? "image/png") };
  }
  return null;
}

export interface ImageArgs { prompt: string; geminiApiKey: string; fetchFn?: typeof fetch; }

async function tryGemini(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${args.geminiApiKey}`;
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: args.prompt }] }] }),
    });
    if (!r.ok) { console.log(`gemini image failed ${r.status}: ${(await r.text()).slice(0, 300)}`); return null; }
    const out = extractGeminiImage(await r.json());
    if (!out) console.log("gemini image: no inlineData in response");
    return out;
  } catch (e) { console.log(`gemini image threw: ${e}`); return null; }
}

// Pollinations was removed — its outputs were low-quality and distracting.
// If Gemini fails or has no quota, the draft arrives with the image PROMPT
// only, and the owner generates the image externally and uploads it via the
// Telegram photo-reply flow.
export async function generateImage(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  return await tryGemini(args);
}
