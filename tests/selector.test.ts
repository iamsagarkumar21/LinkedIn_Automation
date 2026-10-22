import { describe, it, expect } from "vitest";
import { filterFresh, selectTopic } from "../src/selector";
import type { Topic } from "../src/types";

const topics: Topic[] = [
  { key: "a", title: "A", url: "ua", source: "hn", score: 100 },
  { key: "b", title: "B", url: "ub", source: "hn", score: 90 },
];

describe("selector", () => {
  it("filterFresh removes recent keys", () => {
    expect(filterFresh(topics, ["a"]).map((t) => t.key)).toEqual(["b"]);
  });
  it("returns null when all topics are recent", async () => {
    const out = await selectTopic({ topics, recentKeys: ["a", "b"], groqApiKey: "k" });
    expect(out).toBeNull();
  });
  it("uses Groq's chosen index", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "2" } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const out = await selectTopic({ topics, recentKeys: [], groqApiKey: "k", fetchFn: mockFetch });
    expect(out?.key).toBe("b");
  });
  it("falls back to top score when Groq fails", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const out = await selectTopic({ topics, recentKeys: [], groqApiKey: "k", fetchFn: mockFetch });
    expect(out?.key).toBe("a");
  });
  it("falls back to top score when Groq replies out of range", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "99" } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const out = await selectTopic({ topics, recentKeys: [], groqApiKey: "k", fetchFn: mockFetch });
    expect(out?.key).toBe("a");
  });
});
