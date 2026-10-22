import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseHn, parseReddit, parseRss, topicKey, collectTrends } from "../src/trends";

const hn = JSON.parse(readFileSync("tests/fixtures/hn.json", "utf8"));
const reddit = JSON.parse(readFileSync("tests/fixtures/reddit.json", "utf8"));
const rss = readFileSync("tests/fixtures/techcrunch.xml", "utf8");

describe("trend parsers", () => {
  it("parses HN hits", () => {
    const t = parseHn(hn);
    expect(t[0]).toMatchObject({ title: "Cloudflare removes MCP support", source: "hn", score: 540 });
  });
  it("parses Reddit children", () => {
    expect(parseReddit(reddit)[0].title).toBe("OpenAI acquires a startup");
  });
  it("parses RSS items", () => {
    expect(parseRss(rss, "techcrunch")[0].title).toContain("open model");
  });
  it("topicKey slugifies", () => {
    expect(topicKey("Cloudflare Removes MCP!")).toBe("cloudflare-removes-mcp");
  });
});

describe("collectTrends resilience", () => {
  it("a failing source contributes nothing, never throws", async () => {
    const mockFetch = (async (url: string) => {
      if (String(url).includes("algolia")) {
        return new Response(JSON.stringify(hn), { status: 200 });
      }
      return new Response("blocked", { status: 403 });
    }) as unknown as typeof fetch;
    const topics = await collectTrends(mockFetch);
    expect(topics.length).toBe(2);
    expect(topics.every((t) => t.source === "hn")).toBe(true);
  });
  it("a throwing fetch contributes nothing", async () => {
    const mockFetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect(await collectTrends(mockFetch)).toEqual([]);
  });
});
