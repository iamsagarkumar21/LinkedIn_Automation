import { describe, it, expect } from "vitest";
import { needsRefresh, buildPostBody, publishPost } from "../src/linkedin";
import { fakeKv } from "./helpers/fakeKv";
import { setTokens, getTokens } from "../src/kv";
import type { Env, Tokens } from "../src/types";

describe("linkedin token logic", () => {
  it("needsRefresh true within 2 days", () => {
    const now = 1_000_000_000_000;
    expect(needsRefresh({ accessExpiresAt: now + 1000 } as Tokens, now)).toBe(true);
    expect(needsRefresh({ accessExpiresAt: now + 5 * 86400_000 } as Tokens, now)).toBe(false);
  });
  it("buildPostBody references author and image urn", () => {
    const body: any = buildPostBody("urn:li:person:ME", "hello", "urn:li:image:IMG");
    expect(body.author).toBe("urn:li:person:ME");
    expect(body.commentary).toBe("hello");
    expect(body.content.media.id).toBe("urn:li:image:IMG");
  });
});

function mkEnv() {
  return { STATE: fakeKv(), LINKEDIN_CLIENT_ID: "c", LINKEDIN_CLIENT_SECRET: "s", LINKEDIN_VERSION: "202506", DRY_RUN: "false" } as unknown as Env;
}
function liFetch(calls: string[], auths: string[] = []) {
  return (async (url: string, init: any) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    auths.push(init?.headers?.Authorization ?? "");
    if (String(url).includes("oauth/v2/accessToken")) {
      return new Response(JSON.stringify({ access_token: "NEW_AT", expires_in: 5184000, refresh_token: "NEW_RT", refresh_token_expires_in: 31536000 }), { status: 200 });
    }
    if (String(url).includes("action=initializeUpload")) {
      return new Response(JSON.stringify({ value: { uploadUrl: "https://upload.example/u", image: "urn:li:image:IMG" } }), { status: 200 });
    }
    if (String(url) === "https://upload.example/u") return new Response("", { status: 201 });
    if (String(url).includes("/rest/posts")) return new Response("", { status: 201 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
}

describe("publishPost", () => {
  it("runs init-upload, PUT, create-post in order", async () => {
    const env = mkEnv();
    const now = Date.now();
    await setTokens(env, { accessToken: "AT", refreshToken: "RT", accessExpiresAt: now + 30 * 86400_000, refreshExpiresAt: now + 300 * 86400_000, memberUrn: "urn:li:person:ME" });
    const calls: string[] = [];
    await publishPost({ env, text: "hello", imageBase64: "QUJD", imageMime: "image/png", fetchFn: liFetch(calls) });
    expect(calls[0]).toContain("initializeUpload");
    expect(calls[1]).toBe("PUT https://upload.example/u");
    expect(calls[2]).toContain("/rest/posts");
  });
  it("refreshes and persists an expiring token before posting", async () => {
    const env = mkEnv();
    const now = Date.now();
    await setTokens(env, { accessToken: "OLD_AT", refreshToken: "RT", accessExpiresAt: now + 1000, refreshExpiresAt: now + 300 * 86400_000, memberUrn: "urn:li:person:ME" });
    const calls: string[] = []; const auths: string[] = [];
    await publishPost({ env, text: "hello", imageBase64: "QUJD", imageMime: "image/png", fetchFn: liFetch(calls, auths) });
    expect(calls[0]).toContain("oauth/v2/accessToken");
    expect(auths[1]).toBe("Bearer NEW_AT");
    const stored = await getTokens(env);
    expect(stored?.accessToken).toBe("NEW_AT");
    expect(stored?.memberUrn).toBe("urn:li:person:ME");
  });
  it("throws when no tokens are stored", async () => {
    await expect(publishPost({ env: mkEnv(), text: "t", imageBase64: "QUJD", imageMime: "image/png", fetchFn: liFetch([]) })).rejects.toThrow(/tokens/i);
  });
});
