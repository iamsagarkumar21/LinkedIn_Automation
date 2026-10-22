import { describe, it, expect } from "vitest";
import { runDailyPipeline } from "../src/pipeline";
import { fakeKv } from "./helpers/fakeKv";
import { getPendingDraft } from "../src/kv";
import type { Env } from "../src/types";

function makeEnv() {
  return {
    STATE: fakeKv(), TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "123",
    GROQ_API_KEY: "g", GEMINI_API_KEY: "gem",
    AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "m", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b",
    DRY_RUN: "true",
  } as unknown as Env;
}

function router(sent: string[] = []): typeof fetch {
  return (async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("algolia")) return new Response(JSON.stringify({ hits: [{ objectID: "1", title: "Cloudflare removes MCP", url: "https://x", points: 500 }] }), { status: 200 });
    if (u.includes("reddit") || u.includes("techcrunch") || u.includes("theverge")) return new Response("blocked", { status: 403 });
    if (u.includes("groq.com")) return new Response(JSON.stringify({ choices: [{ message: { content: "1" } }] }), { status: 200 });
    if (u.includes("generativelanguage")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }), { status: 200 });
    if (u.includes("api.telegram.org")) { sent.push(`${u} ${typeof init?.body === "string" ? init.body : ""}`); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

const goodBedrock = (async () =>
  new Response(JSON.stringify({ content: [{ type: "text", text: '{"text":"Hook.\\n\\nBody.","hashtags":["#AI"]}' }] }), { status: 200 })
) as unknown as typeof fetch;

describe("runDailyPipeline", () => {
  it("produces and stores a pending draft, sends to Telegram", async () => {
    const env = makeEnv();
    await runDailyPipeline(env, { fetchFn: router(), signedFetch: goodBedrock });
    const d = await getPendingDraft(env);
    expect(d?.status).toBe("pending");
    expect(d?.text).toContain("Hook.");
    expect(d?.imageBase64).toBe("QUJD");
  });
  it("notifies the owner and stores no draft when the topic list is empty", async () => {
    const env = makeEnv();
    const sent: string[] = [];
    const empty = (async (url: string, init?: any) => {
      if (String(url).includes("api.telegram.org")) { sent.push(String(init?.body ?? "")); return new Response("{}", { status: 200 }); }
      return new Response("blocked", { status: 403 });
    }) as unknown as typeof fetch;
    await runDailyPipeline(env, { fetchFn: empty, signedFetch: goodBedrock });
    expect(await getPendingDraft(env)).toBeNull();
    expect(sent.some((b) => b.includes("No fresh trending topic"))).toBe(true);
  });
});
