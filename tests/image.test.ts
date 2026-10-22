import { describe, it, expect } from "vitest";
import { extractGeminiImage, generateImage, bytesToBase64 } from "../src/image";

describe("extractGeminiImage", () => {
  it("pulls inlineData when present", () => {
    const json = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] };
    expect(extractGeminiImage(json)).toEqual({ base64: "QUJD", mime: "image/png" });
  });
  it("returns null for text-only response", () => {
    const json = { candidates: [{ content: { parts: [{ text: "I can't generate that" }] } }] };
    expect(extractGeminiImage(json)).toBeNull();
  });
});

describe("generateImage fallback", () => {
  it("falls through to Pollinations when Gemini has no image", async () => {
    const mockFetch = (async (url: string) => {
      if (String(url).includes("generativelanguage")) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 });
      }
      return new Response(new Uint8Array([65, 66, 67]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const out = await generateImage({ prompt: "cats", geminiApiKey: "k", fetchFn: mockFetch });
    expect(out?.mime).toBe("image/jpeg");
    expect(out?.base64).toBe(bytesToBase64(new Uint8Array([65, 66, 67])));
  });
  it("returns null when all providers fail", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const out = await generateImage({ prompt: "x", geminiApiKey: "k", fetchFn: mockFetch });
    expect(out).toBeNull();
  });
});
