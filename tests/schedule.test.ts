import { describe, it, expect } from "vitest";
import { categoryForDate, filterForCategory, isAiTopic } from "../src/schedule";
import { buildSelectorSystem } from "../src/selector";
import { buildWriterPrompt } from "../src/writer";
import { DEFAULT_STYLE } from "../src/kv";
import { parseRss, parseHfPapers } from "../src/trends";
import type { Topic } from "../src/types";

// The daily cron fires at 05:30 UTC = 11:00 IST.
const at = (ymd: string) => new Date(`${ymd}T05:30:00Z`);
const topic = (title: string, source = "hn"): Topic => ({ key: title, title, url: "https://x", source, score: 1 });

describe("categoryForDate (IST weekly plan)", () => {
  it("maps weekdays to categories and skips Tue/Thu", () => {
    expect(categoryForDate(at("2026-11-16"))).toBe("ai_news");   // Mon
    expect(categoryForDate(at("2026-11-17"))).toBeNull();        // Tue
    expect(categoryForDate(at("2026-11-18"))).toBe("learning");  // Wed
    expect(categoryForDate(at("2026-11-19"))).toBeNull();        // Thu
    expect(categoryForDate(at("2026-11-20"))).toBe("tech_news"); // Fri
    expect(categoryForDate(at("2026-11-21"))).toBe("repo");      // Sat
  });
  it("posts on exactly one of two consecutive Sundays", () => {
    const a = categoryForDate(at("2026-11-22"));
    const b = categoryForDate(at("2026-11-29"));
    expect([a, b].filter(Boolean)).toEqual(["ai_news"]);
    // and keeps alternating
    expect(categoryForDate(at("2026-12-06"))).toBe(a);
    expect(categoryForDate(at("2026-12-13"))).toBe(b);
  });
  it("uses the IST date, not UTC (Mon 23:00 UTC is already Tue in IST)", () => {
    expect(categoryForDate(new Date("2026-11-16T23:00:00Z"))).toBeNull();
  });
});

describe("filterForCategory", () => {
  const pool = [
    topic("OpenAI ships a new model"), topic("PHP bug lets attackers run code"),
    topic("acme/tool — fast thing", "github-trending"),
  ];
  it("splits AI from non-AI and isolates repos", () => {
    expect(filterForCategory(pool, "ai_news").map((t) => t.title)).toEqual(["OpenAI ships a new model"]);
    expect(filterForCategory(pool, "tech_news").map((t) => t.title)).toEqual(["PHP bug lets attackers run code"]);
    expect(filterForCategory(pool, "repo").map((t) => t.source)).toEqual(["github-trending"]);
    expect(filterForCategory(pool, "learning")).toHaveLength(3);
  });
  it("does not treat words like 'said' or 'maintain' as AI", () => {
    expect(isAiTopic(topic("Maintainers said they would paint the fence"))).toBe(false);
  });
});

describe("category prompts", () => {
  it("learning asks for a longer post and overrides the short-post rule", () => {
    const { system } = buildWriterPrompt(topic("KV cache explained"), DEFAULT_STYLE, "body", "learning");
    expect(system).toContain("180-280 words");
    expect(system).toContain("overrides the 60-120 words rule");
  });
  it("news prompt has no category override", () => {
    const { system, user } = buildWriterPrompt(topic("x"), DEFAULT_STYLE, "body", "ai_news");
    expect(system).not.toContain("CATEGORY:");
    expect(user).toContain("60-120 words");
  });
  it("selector prompt differs per category", () => {
    expect(buildSelectorSystem("learning")).toContain("LEARNING");
    expect(buildSelectorSystem("repo")).toContain("GitHub repository");
    expect(buildSelectorSystem("ai_news")).toContain("trending topic");
  });
});

describe("feed parsing", () => {
  it("parses Atom entries (Simon Willison style)", () => {
    const atom = `<feed><entry><title>Notes on tool calling</title><link href="https://simonwillison.net/2026/x/" rel="alternate"/></entry></feed>`;
    expect(parseRss(atom, "simonwillison")[0]).toMatchObject({ title: "Notes on tool calling", url: "https://simonwillison.net/2026/x/" });
  });
  it("parses Hugging Face daily papers", () => {
    const t = parseHfPapers([{ paper: { id: "2611.00001", title: "A  Small   Idea", upvotes: 42 } }]);
    expect(t[0]).toMatchObject({ title: "A Small Idea", url: "https://huggingface.co/papers/2611.00001", score: 42 });
  });
});
