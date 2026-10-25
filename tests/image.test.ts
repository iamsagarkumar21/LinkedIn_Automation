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

describe("generateImage (Gemini only)", () => {
  it("returns the Gemini image when present", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const out = await generateImage({ prompt: "cats", geminiApiKey: "k", fetchFn: mockFetch });
    expect(out).toEqual({ base64: "QUJD", mime: "image/png" });
  });
  it("returns null when Gemini has no image (owner uploads instead)", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateImage({ prompt: "x", geminiApiKey: "k", fetchFn: mockFetch })).toBeNull();
  });
  it("returns null when Gemini errors", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    expect(await generateImage({ prompt: "x", geminiApiKey: "k", fetchFn: mockFetch })).toBeNull();
  });
});
// bytesToBase64 is still exported; keep an import reference so the removal
// of the Pollinations test doesn't leave a dangling unused import error.
void bytesToBase64;
