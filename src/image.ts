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
    if (!r.ok) return null;
    return extractGeminiImage(await r.json());
  } catch { return null; }
}

async function tryPollinations(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}?width=1024&height=1024&nologo=true`;
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const mime = r.headers.get("Content-Type") || "image/jpeg";
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0) return null;
    return { base64: bytesToBase64(bytes), mime };
  } catch { return null; }
}

export async function generateImage(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  return (await tryGemini(args)) ?? (await tryPollinations(args));
}
