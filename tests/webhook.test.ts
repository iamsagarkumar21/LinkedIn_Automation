import { describe, it, expect } from "vitest";
import { handleCommand } from "../src/index";
import { fakeKv } from "./helpers/fakeKv";
import { setPendingDraft, getPendingDraft } from "../src/kv";
import type { Env, PostDraft } from "../src/types";

function env() {
  return { STATE: fakeKv(), TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "123", DRY_RUN: "true" } as unknown as Env;
}
const draft: PostDraft = {
  id: "d1", topic: { key: "k", title: "T", url: "u", source: "hn", score: 1 },
  text: "Body", hashtags: ["#AI"], imageBase64: "QUJD", imageMime: "image/png", status: "pending", createdAt: 0,
};
const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

describe("handleCommand", () => {
  it("ignores commands from the wrong chat id", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    const calls: string[] = [];
    const fetchFn = (async (u: string) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await handleCommand(e, { kind: "approve", draftId: "d1", chatId: "999", fromId: "999", callbackId: "cb" }, { fetchFn });
    expect(await getPendingDraft(e)).not.toBeNull();
    expect(calls.length).toBe(0);
  });
  it("skip clears the pending draft", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "skip", draftId: "d1", chatId: "123", fromId: "123", callbackId: "cb" }, { fetchFn: ok });
    expect(await getPendingDraft(e)).toBeNull();
  });
  it("approve in DRY_RUN does not call LinkedIn but clears draft", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    const calls: string[] = [];
    const fetchFn = (async (u: string) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await handleCommand(e, { kind: "approve", draftId: "d1", chatId: "123", fromId: "123", callbackId: "cb" }, { fetchFn });
    expect(calls.some((u) => u.includes("api.linkedin.com"))).toBe(false);
    expect(await getPendingDraft(e)).toBeNull();
  });
  it("edit_reply replaces the pending draft text after Edit was tapped", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "edit", draftId: "d1", chatId: "123", fromId: "123", callbackId: "cb" }, { fetchFn: ok });
    await handleCommand(e, { kind: "edit_reply", messageText: "New text", chatId: "123", fromId: "123" }, { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("New text");
  });
  it("ignores a stale approve whose draftId does not match the pending draft", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "approve", draftId: "OLD", chatId: "123", fromId: "123", callbackId: "cb" }, { fetchFn: ok });
    expect(await getPendingDraft(e)).not.toBeNull();
  });
});
