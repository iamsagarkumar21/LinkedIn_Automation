export interface GroqOpts {
  apiKey: string; system: string; user: string;
  temperature?: number; model?: string; fetchFn?: typeof fetch;
}

const FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-20b",
];

export async function groqChat(opts: GroqOpts): Promise<string> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const models = opts.model ? [opts.model] : FALLBACK_MODELS;
  let lastErr = "";
  for (const model of models) {
    const r = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.7,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (r.ok) {
      const j: any = await r.json();
      return String(j?.choices?.[0]?.message?.content ?? "").trim();
    }
    lastErr = `Groq error ${r.status}: ${await r.text()}`;
    if (r.status !== 404 && r.status !== 400 && r.status !== 403) break;
  }
  throw new Error(lastErr);
}
