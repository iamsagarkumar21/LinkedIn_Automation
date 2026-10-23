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

async function tryPollinations(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}?width=1024&height=1024&nologo=true`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchFn(url);
      if (r.ok) {
        const mime = r.headers.get("Content-Type") || "image/jpeg";
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length === 0) { console.log("pollinations: empty body"); return null; }
        return { base64: bytesToBase64(bytes), mime };
      }
      const body = (await r.text()).slice(0, 300);
      console.log(`pollinations failed ${r.status} (attempt ${attempt + 1}): ${body}`);
      if (r.status !== 402 && r.status !== 429) return null;
      const m = /after (\d+)s/.exec(body);
      const waitMs = ((m ? Number(m[1]) : 45) + 2) * 1000;
      if (attempt < 2) await new Promise((res) => setTimeout(res, Math.min(waitMs, 50000)));
    } catch (e) { console.log(`pollinations threw: ${e}`); return null; }
  }
  return null;
}

export async function generateImage(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  return (await tryGemini(args)) ?? (await tryPollinations(args));
}
