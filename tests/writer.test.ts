import { describe, it, expect } from "vitest";
import { buildWriterPrompt, parseWriterOutput, writePost } from "../src/writer";
import { DEFAULT_STYLE } from "../src/kv";
import type { Env, Topic } from "../src/types";

const topic: Topic = { key: "mcp", title: "Cloudflare removes MCP support", url: "https://x", source: "hn", score: 540 };
const env = { AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "m" } as unknown as Env;

describe("writer prompt + parse", () => {
  it("prompt mentions topic and hashtag rule", () => {
    const p = buildWriterPrompt(topic, DEFAULT_STYLE);
    expect(p.user).toContain("Cloudflare removes MCP support");
    expect(p.system.toLowerCase()).toContain("json");
  });
  it("parses JSON and normalizes hashtags", () => {
    const out = parseWriterOutput('Sure: {"text":"Hook.\\n\\nBody.","hashtags":["AI","#Tech","AI"]}');
    expect(out.text).toContain("Hook.");
    expect(out.hashtags).toEqual(["#AI", "#Tech"]);
  });
  it("caps hashtags at 5", () => {
    const out = parseWriterOutput('{"text":"t","hashtags":["#a","#b","#c","#d","#e","#f"]}');
    expect(out.hashtags.length).toBe(5);
  });
  it("throws when no text", () => {
    expect(() => parseWriterOutput("no json here")).toThrow();
  });
});

describe("writePost fallback", () => {
  it("uses Groq when Bedrock fails", async () => {
    const signedFetch = (async () => new Response("deny", { status: 403 })) as unknown as typeof fetch;
    const fetchFn = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"G","hashtags":["#AI"]}' } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const out = await writePost({ topic, style: DEFAULT_STYLE, env, groqApiKey: "k", fetchFn, signedFetch });
    expect(out.text).toBe("G");
  });
});
