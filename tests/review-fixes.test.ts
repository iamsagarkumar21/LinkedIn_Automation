import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { handleCommand, splitTrailingHashtags } from "../src/index";
import { fakeKv } from "./helpers/fakeKv";
import { setPendingDraft, getPendingDraft, setTokens } from "../src/kv";
import { publishPost, buildPostBody } from "../src/linkedin";
import { sendMessage, sendDraft } from "../src/telegram";
import { runDailyPipeline } from "../src/pipeline";
import type { Env, PostDraft } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function env(extra: Partial<Env> = {}): Env {
  return {
    STATE: fakeKv(), TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "123", DRY_RUN: "true", WEBHOOK_SECRET: "s3cret",
    GROQ_API_KEY: "g", GEMINI_API_KEY: "gem", AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "m",
    AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", LINKEDIN_CLIENT_ID: "c", LINKEDIN_CLIENT_SECRET: "s", LINKEDIN_VERSION: "202610",
    ...extra,
  } as unknown as Env;
}
const draft: PostDraft = {
  id: "d1", topic: { key: "k", title: "T", url: "u", source: "hn", score: 1 },
  text: "Body", hashtags: ["#AI"], imageBase64: "QUJD", imageMime: "image/png", status: "pending", createdAt: 0,
};
const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
const owner = { chatId: "123", fromId: "123", callbackId: "cb" };
afterEach(() => vi.unstubAllGlobals());

describe("C1 webhook secret + draftId required", () => {
  const skipReq = (hdr?: string) => new Request("https://w/", {
    method: "POST", headers: hdr ? { "X-Telegram-Bot-Api-Secret-Token": hdr } : {},
    body: JSON.stringify({ callback_query: { id: "cb", data: "skip:d1", from: { id: 123 }, message: { chat: { id: 123 } } } }),
  });
  it("rejects a POST without the secret header", async () => {
    vi.stubGlobal("fetch", ok);
    const e = env(); await setPendingDraft(e, draft);
    const res = await worker.fetch(skipReq(), e, {} as ExecutionContext);
    expect(res.status).toBe(403);
    expect(await getPendingDraft(e)).not.toBeNull();
  });
  it("rejects a wrong secret", async () => {
    vi.stubGlobal("fetch", ok);
    const e = env(); await setPendingDraft(e, draft);
    expect((await worker.fetch(skipReq("nope"), e, {} as ExecutionContext)).status).toBe(403);
  });
  it("rejects everything when no secret is configured", async () => {
    vi.stubGlobal("fetch", ok);
    const e = env({ WEBHOOK_SECRET: "" } as any); await setPendingDraft(e, draft);
    expect((await worker.fetch(skipReq(""), e, {} as ExecutionContext)).status).toBe(403);
  });
  it("accepts the correct secret", async () => {
    vi.stubGlobal("fetch", ok);
    const e = env(); await setPendingDraft(e, draft);
    expect((await worker.fetch(skipReq("s3cret"), e, {} as ExecutionContext)).status).toBe(200);
    expect(await getPendingDraft(e)).toBeNull();
  });
  it("approve without a draftId does nothing", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "approve", ...owner }, { fetchFn: ok });
    expect(await getPendingDraft(e)).not.toBeNull();
  });
});

describe("I9 stale draftId guard on every callback", () => {
  it("skip with an outdated draftId keeps today's draft", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "skip", draftId: "OLD", ...owner }, { fetchFn: ok });
    expect(await getPendingDraft(e)).not.toBeNull();
  });
});

describe("C3 double-tap approve publishes once", () => {
  it("second approve while the first is publishing is refused", async () => {
    const e = env({ DRY_RUN: "false" } as any);
    await setPendingDraft(e, draft);
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() + 30 * 86400_000, refreshExpiresAt: Date.now() + 300 * 86400_000, memberUrn: "urn:li:person:ME" });
    let posts = 0;
    const slow = (async (url: string, init: any) => {
      const u = String(url);
      await sleep(30);
      if (u.includes("initializeUpload")) return new Response(JSON.stringify({ value: { uploadUrl: "https://upload.example/u", image: "urn:li:image:I" } }), { status: 200 });
      if (u === "https://upload.example/u") return new Response("", { status: 201 });
      if (u.includes("/rest/posts")) { posts++; return new Response("", { status: 201 }); }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const a = handleCommand(e, { kind: "approve", draftId: "d1", ...owner }, { fetchFn: slow });
    await sleep(10);
    const b = handleCommand(e, { kind: "approve", draftId: "d1", ...owner }, { fetchFn: slow });
    await Promise.all([a, b]);
    expect(posts).toBe(1);
  });
});

describe("I1 token refresh tolerance", () => {
  function liFetch(opts: { refreshStatus?: number }) {
    const calls: string[] = []; const auths: string[] = [];
    const f = (async (url: string, init: any) => {
      const u = String(url); calls.push(u); auths.push(init?.headers?.Authorization ?? "");
      if (u.includes("oauth/v2/accessToken")) return new Response("bad", { status: opts.refreshStatus ?? 400 });
      if (u.includes("initializeUpload")) return new Response(JSON.stringify({ value: { uploadUrl: "https://upload.example/u", image: "urn:li:image:I" } }), { status: 200 });
      return new Response("", { status: 201 });
    }) as unknown as typeof fetch;
    return { f, calls, auths };
  }
  it("posts with the existing token when there is no refresh token and it is still valid", async () => {
    const e = env(); const { f, calls, auths } = liFetch({});
    await setTokens(e, { accessToken: "AT", refreshToken: "", accessExpiresAt: Date.now() + 86400_000, refreshExpiresAt: 0, memberUrn: "urn:li:person:ME" });
    await publishPost({ env: e, text: "hi", imageBase64: "QUJD", imageMime: "image/png", fetchFn: f });
    expect(calls.some((u) => u.includes("oauth/v2/accessToken"))).toBe(false);
    expect(auths[0]).toBe("Bearer AT");
  });
  it("posts with the existing token when refresh fails but it is still valid", async () => {
    const e = env(); const { f, calls } = liFetch({});
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() + 86400_000, refreshExpiresAt: Date.now() + 1e9, memberUrn: "urn:li:person:ME" });
    await publishPost({ env: e, text: "hi", imageBase64: "QUJD", imageMime: "image/png", fetchFn: f });
    expect(calls.some((u) => u.includes("/rest/posts"))).toBe(true);
  });
  it("throws a re-authorize error when the token is expired and refresh fails", async () => {
    const e = env(); const { f } = liFetch({});
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() - 1000, refreshExpiresAt: Date.now() + 1e9, memberUrn: "urn:li:person:ME" });
    await expect(publishPost({ env: e, text: "hi", imageBase64: "QUJD", imageMime: "image/png", fetchFn: f })).rejects.toThrow(/re-authorize/i);
  });
});

describe("I2 token expiry warning on the daily run", () => {
  it("warns on Telegram when the refresh token expires within 7 days", async () => {
    const e = env();
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() + 30 * 86400_000, refreshExpiresAt: Date.now() + 3 * 86400_000, memberUrn: "urn:li:person:ME" });
    const sent: string[] = [];
    const f = (async (u: string, init: any) => {
      if (String(u).includes("api.telegram.org")) sent.push(String(init?.body ?? ""));
      return new Response("blocked", { status: 403 });
    }) as unknown as typeof fetch;
    await runDailyPipeline(e, { fetchFn: f });
    expect(sent.some((b) => /re-authorize/i.test(b))).toBe(true);
  });
  it("uses the access token expiry when there is no refresh token", async () => {
    const e = env();
    await setTokens(e, { accessToken: "AT", refreshToken: "", accessExpiresAt: Date.now() + 2 * 86400_000, refreshExpiresAt: 0, memberUrn: "urn:li:person:ME" });
    const sent: string[] = [];
    const f = (async (u: string, init: any) => {
      if (String(u).includes("api.telegram.org")) sent.push(String(init?.body ?? ""));
      return new Response("blocked", { status: 403 });
    }) as unknown as typeof fetch;
    await runDailyPipeline(e, { fetchFn: f });
    expect(sent.some((b) => /re-authorize/i.test(b))).toBe(true);
  });
});

describe("I3 regen keeps what it should", () => {
  const router = ((url: string) => {
    const u = String(url);
    if (u.includes("groq.com")) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "a new scene" } }] }), { status: 200 }));
    if (u.includes("generativelanguage")) return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "WFla" } }] } }] }), { status: 200 }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  const bedrock = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"text":"Fresh words","hashtags":["#AI"]}' }] }), { status: 200 })) as unknown as typeof fetch;
  it("regen_text keeps the topic and image, changes text and id", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "regen_text", draftId: "d1", ...owner }, { fetchFn: router, signedFetch: bedrock });
    const d = await getPendingDraft(e);
    expect(d?.text).toBe("Fresh words"); expect(d?.imageBase64).toBe("QUJD");
    expect(d?.topic.key).toBe("k"); expect(d?.id).not.toBe("d1");
  });
  it("regen_image keeps the topic and text, changes image and id", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "regen_image", draftId: "d1", ...owner }, { fetchFn: router });
    const d = await getPendingDraft(e);
    expect(d?.text).toBe("Body"); expect(d?.imageBase64).toBe("WFla");
    expect(d?.topic.key).toBe("k"); expect(d?.id).not.toBe("d1");
  });
});

describe("I4 edit only after tapping Edit", () => {
  const say = (text: string) => ({ kind: "edit_reply" as const, messageText: text, chatId: "123", fromId: "123" });
  it("ignores stray messages when no edit was requested", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, say("lol"), { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("Body");
  });
  it("accepts exactly one message after Edit, then ignores further ones", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "edit", draftId: "d1", ...owner }, { fetchFn: ok });
    await handleCommand(e, say("Edited text"), { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("Edited text");
    await handleCommand(e, say("another"), { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("Edited text");
  });
  it("ignores slash commands even after Edit", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "edit", draftId: "d1", ...owner }, { fetchFn: ok });
    await handleCommand(e, say("/start"), { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("Body");
  });
  it("moves trailing hashtags out of the text", () => {
    expect(splitTrailingHashtags("Great post\n\n#AI #Tech")).toEqual({ text: "Great post", hashtags: ["#AI", "#Tech"] });
    expect(splitTrailingHashtags("No tags here")).toEqual({ text: "No tags here", hashtags: [] });
  });
  it("rejects an edit longer than LinkedIn's 3000 characters", async () => {
    const e = env(); await setPendingDraft(e, draft);
    await handleCommand(e, { kind: "edit", draftId: "d1", ...owner }, { fetchFn: ok });
    await handleCommand(e, say("x".repeat(3001)), { fetchFn: ok });
    expect((await getPendingDraft(e))?.text).toBe("Body");
  });
});

describe("I5 text-only posting", () => {
  it("publishPost without an image skips the upload and sends no content block", async () => {
    const e = env();
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() + 30 * 86400_000, refreshExpiresAt: Date.now() + 1e9, memberUrn: "urn:li:person:ME" });
    const calls: string[] = []; let body: any;
    const f = (async (u: string, init: any) => { calls.push(String(u)); if (String(u).includes("/rest/posts")) body = JSON.parse(init.body); return new Response("", { status: 201 }); }) as unknown as typeof fetch;
    await publishPost({ env: e, text: "hello", fetchFn: f });
    expect(calls.some((u) => u.includes("initializeUpload"))).toBe(false);
    expect(body.content).toBeUndefined();
  });
  it("approve on an image-less draft posts text-only instead of refusing", async () => {
    const e = env({ DRY_RUN: "false" } as any);
    await setPendingDraft(e, { ...draft, imageBase64: undefined, imageMime: undefined });
    await setTokens(e, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: Date.now() + 30 * 86400_000, refreshExpiresAt: Date.now() + 1e9, memberUrn: "urn:li:person:ME" });
    let posted = false;
    const f = (async (u: string) => { if (String(u).includes("/rest/posts")) posted = true; return new Response("", { status: 201 }); }) as unknown as typeof fetch;
    await handleCommand(e, { kind: "approve", draftId: "d1", ...owner }, { fetchFn: f });
    expect(posted).toBe(true);
    expect(await getPendingDraft(e)).toBeNull();
  });
});

describe("I6 little-text escaping", () => {
  it("escapes reserved characters but leaves hashtags alone", () => {
    const body: any = buildPostBody("urn:li:person:ME", "(yes, really) *bold* [x] #AI", "urn:li:image:I");
    expect(body.commentary).toBe("\\(yes, really\\) \\*bold\\* \\[x\\] #AI");
  });
});

describe("I7 Telegram failures are loud", () => {
  const bad = (async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;
  it("sendMessage throws on a non-OK response", async () => {
    await expect(sendMessage("T", "123", "hi", bad)).rejects.toThrow(/400/);
  });
  it("sendDraft throws when the keyboard message fails", async () => {
    await expect(sendDraft({ botToken: "T", chatId: "123", draft, fetchFn: bad })).rejects.toThrow();
  });
  it("the webhook still answers 200 when handling throws, so Telegram does not retry", async () => {
    vi.stubGlobal("fetch", bad);
    const e = env(); await setPendingDraft(e, draft);
    const req = new Request("https://w/", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
      body: JSON.stringify({ callback_query: { id: "cb", data: "skip:d1", from: { id: 123 }, message: { chat: { id: 123 } } } }) });
    expect((await worker.fetch(req, e, {} as ExecutionContext)).status).toBe(200);
  });
});
