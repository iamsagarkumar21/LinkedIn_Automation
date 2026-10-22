import { describe, it, expect } from "vitest";
import { fakeKv } from "./helpers/fakeKv";
import { getTokens, setTokens, addRecentTopic, getRecentTopicKeys, getStyleConfig } from "../src/kv";
import type { Env, Tokens } from "../src/types";

function env(kv = fakeKv()): Env {
  return { STATE: kv, TELEGRAM_CHAT_ID: "123", DRY_RUN: "true" } as unknown as Env;
}

describe("kv", () => {
  it("round-trips tokens", async () => {
    const e = env();
    const t: Tokens = { accessToken: "a", refreshToken: "r", accessExpiresAt: 1, refreshExpiresAt: 2, memberUrn: "urn:li:person:x" };
    await setTokens(e, t);
    expect(await getTokens(e)).toEqual(t);
  });
  it("returns default style when unset", async () => {
    const s = await getStyleConfig(env());
    expect(s.hashtagStrategy.length).toBeGreaterThan(0);
  });
  it("drops recent topics older than 14 days", async () => {
    const kv = fakeKv();
    const e = env(kv);
    const old = Date.now() - 15 * 24 * 60 * 60 * 1000;
    await kv.put("topics:recent", JSON.stringify([{ key: "old", usedAt: old }]));
    await addRecentTopic(e, "new");
    const keys = await getRecentTopicKeys(e);
    expect(keys).toEqual(["new"]);
  });
});
