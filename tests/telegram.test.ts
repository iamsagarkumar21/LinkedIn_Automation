import { describe, it, expect } from "vitest";
import { formatCaption, buildKeyboard, parseUpdate, sendDraft } from "../src/telegram";
import type { PostDraft } from "../src/types";

const draft: PostDraft = {
  id: "d1", topic: { key: "k", title: "T", url: "u", source: "hn", score: 1 },
  text: "Hook line.\n\nBody.", hashtags: ["#AI", "#Tech"],
  imageBase64: "QUJD", imageMime: "image/png", status: "pending", createdAt: 0,
};

describe("telegram helpers", () => {
  it("formatCaption appends hashtags", () => {
    expect(formatCaption(draft)).toBe("Hook line.\n\nBody.\n\n#AI #Tech");
  });
  it("buildKeyboard encodes draft id in callbacks", () => {
    const kb: any = buildKeyboard("d1");
    const data = kb.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(data).toContain("approve:d1");
    expect(data).toContain("skip:d1");
  });
  it("parseUpdate classifies a button tap", () => {
    const cmd = parseUpdate({ callback_query: { id: "cb", data: "approve:d1", from: { id: 123 }, message: { chat: { id: 123 } } } });
    expect(cmd).toMatchObject({ kind: "approve", draftId: "d1", chatId: "123", fromId: "123", callbackId: "cb" });
  });
  it("parseUpdate classifies a plain message as edit_reply", () => {
    const cmd = parseUpdate({ message: { text: "my edit", chat: { id: 123 }, from: { id: 123 } } });
    expect(cmd).toMatchObject({ kind: "edit_reply", messageText: "my edit", chatId: "123" });
  });
});

describe("sendDraft", () => {
  it("sends photo then a message bearing the keyboard", async () => {
    const calls: string[] = [];
    const mockFetch = (async (url: string) => { calls.push(String(url)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await sendDraft({ botToken: "T", chatId: "123", draft, fetchFn: mockFetch });
    expect(calls.some((u) => u.includes("/sendPhoto"))).toBe(true);
    expect(calls.some((u) => u.includes("/sendMessage"))).toBe(true);
  });
  it("sends a >1024 char post in full via sendMessage, not a truncated caption", async () => {
    const long = { ...draft, text: "x".repeat(2000) };
    const bodies: string[] = [];
    const mockFetch = (async (url: string, init: any) => {
      if (String(url).includes("/sendMessage")) bodies.push(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await sendDraft({ botToken: "T", chatId: "123", draft: long, fetchFn: mockFetch });
    expect(bodies.some((b) => b.includes("x".repeat(2000)) && b.includes("approve:d1"))).toBe(true);
  });
});
