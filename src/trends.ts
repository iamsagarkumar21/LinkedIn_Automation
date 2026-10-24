import type { Topic } from "./types";

const UA = "linkedin-auto-poster/0.2 (personal content assistant)";

// Signals that tend to go viral on a tech/AI professional's LinkedIn feed
// (fresh news, incidents, launches, India angle, meme-worthy stories).
// Reward concrete, named news stories with a clear tech / AI angle.
// (Earlier we also boosted India keywords; that pushed too much
// desi-flavoured content. India-only stuff is still eligible via the
// subreddits / Google News India feed below, just not auto-boosted.)
const BOOST_WORDS = [
  "bug", "vulnerability", "cve", "rce", "exploit", "crash", "outage", "down",
  "leaked", "hacked", "breach", "lawsuit", "ban", "banned", "fired", "layoffs",
  "launch", "launched", "release", "released", "unveils", "announces", "ships",
  "ai", "agent", "llm", "gpt", "claude", "gemini", "openai", "anthropic",
  "nvidia", "deepmind", "mistral", "meta ai", "copilot", "cursor",
  "funding", "raises", "acquires", "ipo", "acquired",
];

const PENALTY_WORDS = [
  // soft-skill / recruitment noise we don't want
  "hiring", "we're hiring", "join our team", "apply now", "career tips",
  // generic motivation / listicle junk
  "motivation", "monday motivation", "success tips", "top 10", "top 5",
  "ultimate guide", "beginner's guide",
];

export function topicKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function scoreBoost(title: string): number {
  const t = title.toLowerCase();
  let bonus = 0;
  for (const w of BOOST_WORDS) if (t.includes(w)) bonus += 25;
  for (const w of PENALTY_WORDS) if (t.includes(w)) bonus -= 40;
  // Numbers in title ("20-year-old PHP bug", "47% drop") read as concrete, scroll-stoppers.
  if (/\b\d{2,}\b/.test(title)) bonus += 15;
  return bonus;
}

export function parseHn(json: any): Topic[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .filter((h: any) => h?.title && (h?.url || h?.objectID))
    .map((h: any) => ({
      key: topicKey(h.title), title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hn", score: (Number(h.points) || 0) + scoreBoost(h.title),
    }));
}

export function parseReddit(json: any, sub: string): Topic[] {
  const children = json?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .map((c: any) => c?.data)
    .filter((d: any) => d?.title)
    .map((d: any) => ({
      key: topicKey(d.title), title: d.title,
      url: d.url?.startsWith("http") ? d.url : `https://www.reddit.com${d.permalink ?? ""}`,
      source: `r/${sub}`, score: (Number(d.score) || 0) + scoreBoost(d.title),
    }));
}

export function parseRss(xml: string, source: string): Topic[] {
  const items: Topic[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const linkRe = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i;
  for (const block of xml.match(itemRe) || []) {
    const title = (block.match(titleRe)?.[1] || "")
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
    const link = (block.match(linkRe)?.[1] || "").trim();
    if (title) items.push({ key: topicKey(title), title, url: link, source, score: 50 + scoreBoost(title) });
  }
  return items;
}

/** Parse github.com/trending HTML. Scores by stars-today. */
export function parseGithubTrending(html: string): Topic[] {
  const items: Topic[] = [];
  const repoRe = /<h2[^>]*class="h3[^"]*lh-condensed"[\s\S]*?<a\s+href="\/([^"]+)"[\s\S]*?<\/a>[\s\S]*?<\/h2>([\s\S]*?)(?=<article|<\/main|$)/gi;
  for (const m of html.matchAll(repoRe)) {
    const slug = m[1].trim();
    const chunk = m[2];
    const desc = (chunk.match(/<p[^>]*class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] || "")
      .replace(/\s+/g, " ").trim();
    const starsToday = Number((chunk.match(/([\d,]+)\s+stars today/)?.[1] || "0").replace(/,/g, ""));
    const title = desc ? `${slug} — ${desc}` : slug;
    items.push({
      key: topicKey(slug), title: title.slice(0, 160),
      url: `https://github.com/${slug}`,
      source: "github-trending",
      score: starsToday + scoreBoost(title),
    });
  }
  return items;
}

async function safeFetchJson(fetchFn: typeof fetch, url: string): Promise<any | null> {
  try {
    const r = await fetchFn(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) { console.log(`trends: ${url} -> ${r.status}`); return null; }
    return await r.json();
  } catch (e) { console.log(`trends fetch threw: ${url}: ${e}`); return null; }
}
async function safeFetchText(fetchFn: typeof fetch, url: string): Promise<string | null> {
  try {
    const r = await fetchFn(url, { headers: { "User-Agent": UA } });
    if (!r.ok) { console.log(`trends: ${url} -> ${r.status}`); return null; }
    return await r.text();
  } catch (e) { console.log(`trends fetch threw: ${url}: ${e}`); return null; }
}

const SUBREDDITS = ["technology", "programming", "developersIndia", "india", "webdev", "LocalLLaMA"];
const RSS_FEEDS = [
  // Global tech
  { url: "https://techcrunch.com/feed/", source: "techcrunch" },
  { url: "https://www.theverge.com/rss/index.xml", source: "theverge" },
  { url: "https://dev.to/feed", source: "dev.to" },
  // India tech / startup / incidents (via Google News search RSS — free, no auth)
  { url: "https://news.google.com/rss/search?q=india+ai+OR+startup+OR+tech+when:1d&hl=en-IN&gl=IN&ceid=IN:en", source: "gnews-india-tech" },
  { url: "https://news.google.com/rss/search?q=programming+OR+developer+OR+outage+OR+bug+when:1d&hl=en-US&gl=US&ceid=US:en", source: "gnews-dev" },
  { url: "https://news.google.com/rss/search?q=openai+OR+anthropic+OR+google+ai+when:1d&hl=en-US&gl=US&ceid=US:en", source: "gnews-ai" },
];

export async function collectTrends(fetchFn: typeof fetch = globalThis.fetch): Promise<Topic[]> {
  const out: Topic[] = [];

  // Hacker News front page
  const hn = await safeFetchJson(fetchFn, "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25");
  if (hn) out.push(...parseHn(hn));

  // Reddit (daily top from each sub)
  for (const sub of SUBREDDITS) {
    const j = await safeFetchJson(fetchFn, `https://www.reddit.com/r/${sub}/top.json?t=day&limit=10`);
    if (j) out.push(...parseReddit(j, sub));
  }

  // RSS feeds (tech blogs + Google News searches for India / dev / AI)
  for (const feed of RSS_FEEDS) {
    const xml = await safeFetchText(fetchFn, feed.url);
    if (xml) out.push(...parseRss(xml, feed.source).slice(0, 10));
  }

  // GitHub trending (daily)
  const gh = await safeFetchText(fetchFn, "https://github.com/trending?since=daily");
  if (gh) out.push(...parseGithubTrending(gh).slice(0, 10));

  // Dedupe by key, keep highest-scoring version
  const byKey = new Map<string, Topic>();
  for (const t of out) {
    const prev = byKey.get(t.key);
    if (!prev || t.score > prev.score) byKey.set(t.key, t);
  }
  console.log(`trends: collected ${out.length} items, ${byKey.size} unique`);
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
