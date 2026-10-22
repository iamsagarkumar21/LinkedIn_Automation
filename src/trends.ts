import type { Topic } from "./types";

const UA = "linkedin-auto-poster/0.1 (personal content assistant)";
const RSS_FEEDS = [
  { url: "https://techcrunch.com/feed/", source: "techcrunch" },
  { url: "https://www.theverge.com/rss/index.xml", source: "theverge" },
];
const SUBREDDITS = ["technology", "artificial", "programming"];

export function topicKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function parseHn(json: any): Topic[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .filter((h: any) => h?.title && (h?.url || h?.objectID))
    .map((h: any) => ({
      key: topicKey(h.title), title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hn", score: Number(h.points) || 0,
    }));
}

export function parseReddit(json: any): Topic[] {
  const children = json?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .map((c: any) => c?.data)
    .filter((d: any) => d?.title)
    .map((d: any) => ({
      key: topicKey(d.title), title: d.title,
      url: d.url || `https://www.reddit.com${d.permalink}`,
      source: "reddit", score: Number(d.score) || 0,
    }));
}

export function parseRss(xml: string, source: string): Topic[] {
  const items: Topic[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const linkRe = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i;
  for (const block of xml.match(itemRe) || []) {
    const title = (block.match(titleRe)?.[1] || "").trim();
    const link = (block.match(linkRe)?.[1] || "").trim();
    if (title) items.push({ key: topicKey(title), title, url: link, source, score: 50 });
  }
  return items;
}

async function safeFetchJson(fetchFn: typeof fetch, url: string): Promise<any | null> {
  try {
    const r = await fetchFn(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function safeFetchText(fetchFn: typeof fetch, url: string): Promise<string | null> {
  try {
    const r = await fetchFn(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

export async function collectTrends(fetchFn: typeof fetch = globalThis.fetch): Promise<Topic[]> {
  const out: Topic[] = [];

  const hn = await safeFetchJson(fetchFn, "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20");
  if (hn) out.push(...parseHn(hn));

  for (const sub of SUBREDDITS) {
    const j = await safeFetchJson(fetchFn, `https://www.reddit.com/r/${sub}/top.json?t=day&limit=10`);
    if (j) out.push(...parseReddit(j));
  }

  for (const feed of RSS_FEEDS) {
    const xml = await safeFetchText(fetchFn, feed.url);
    if (xml) out.push(...parseRss(xml, feed.source).slice(0, 8));
  }

  const byKey = new Map<string, Topic>();
  for (const t of out) {
    const prev = byKey.get(t.key);
    if (!prev || t.score > prev.score) byKey.set(t.key, t);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
