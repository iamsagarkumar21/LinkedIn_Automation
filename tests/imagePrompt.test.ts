import { describe, it, expect } from "vitest";
import { craftImagePrompt } from "../src/imagePrompt";
import type { Topic } from "../src/types";

const topic: Topic = { key: "mcp", title: "Cloudflare removes MCP support", url: "u", source: "hn", score: 1 };

describe("craftImagePrompt", () => {
  it("returns Groq's prompt", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "A cinematic server room, witty mood" } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const out = await craftImagePrompt({ topic, postText: "p", groqApiKey: "k", fetchFn: mockFetch });
    expect(out).toContain("server room");
  });
  it("falls back to a topic-based prompt on failure", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const out = await craftImagePrompt({ topic, postText: "p", groqApiKey: "k", fetchFn: mockFetch });
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain("cloudflare removes mcp support");
  });
});
