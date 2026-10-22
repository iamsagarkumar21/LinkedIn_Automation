export interface GroqOpts {
  apiKey: string; system: string; user: string;
  temperature?: number; model?: string; fetchFn?: typeof fetch;
}

export async function groqChat(opts: GroqOpts): Promise<string> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const r = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? "llama-3.3-70b-versatile",
      temperature: opts.temperature ?? 0.7,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq error ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}
