import { describe, it, expect } from "vitest";
import { groqChat } from "../src/llm/groq";

describe("groqChat", () => {
  it("posts OpenAI-compatible body and returns content", async () => {
    let captured: any;
    const mockFetch = (async (_url: string, init: any) => {
      captured = { url: _url, body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ choices: [{ message: { content: " hello " } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await groqChat({ apiKey: "k", system: "s", user: "u", fetchFn: mockFetch });
    expect(out).toBe("hello");
    expect(captured.url).toContain("/openai/v1/chat/completions");
    expect(captured.headers.Authorization).toBe("Bearer k");
    expect(captured.body.messages[0]).toEqual({ role: "system", content: "s" });
  });
  it("throws on non-200", async () => {
    const mockFetch = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    await expect(groqChat({ apiKey: "k", system: "s", user: "u", fetchFn: mockFetch })).rejects.toThrow();
  });
});
