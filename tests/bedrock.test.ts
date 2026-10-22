import { describe, it, expect } from "vitest";
import { bedrockClaude } from "../src/llm/bedrock";
import type { Env } from "../src/types";

const env = {
  AWS_REGION: "us-east-1",
  BEDROCK_MODEL_ID: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
  AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret",
} as unknown as Env;

describe("bedrockClaude", () => {
  it("builds correct URL/body and extracts text", async () => {
    let captured: any;
    const signedFetch = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "a witty post" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await bedrockClaude({ env, system: "s", user: "u", signedFetch });
    expect(out).toBe("a witty post");
    expect(captured.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-3-5-haiku-20241022-v1%3A0/invoke"
    );
    expect(captured.body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(captured.body.system).toBe("s");
    expect(captured.body.messages[0]).toEqual({ role: "user", content: "u" });
  });
  it("throws on non-200", async () => {
    const signedFetch = (async () => new Response("deny", { status: 403 })) as unknown as typeof fetch;
    await expect(bedrockClaude({ env, system: "s", user: "u", signedFetch })).rejects.toThrow();
  });
});
