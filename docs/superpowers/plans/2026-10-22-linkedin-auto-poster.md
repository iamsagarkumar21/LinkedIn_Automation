# LinkedIn Auto-Poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that, once a day, researches trending tech/AI topics, writes a witty LinkedIn post with an AI-generated image, sends it to the owner on Telegram for approval, and publishes approved posts to LinkedIn via the official API.

**Architecture:** One Cloudflare Worker (TypeScript). Its `scheduled()` handler runs the daily draft pipeline; its `fetch()` handler is the Telegram webhook that processes button taps (approve/edit/regenerate/skip) and publishes to LinkedIn. State (OAuth tokens, pending draft, recent topics, style config) lives in Workers KV. Every network-calling module receives its `fetch` function as a parameter so logic is unit-tested with plain Vitest and a mocked fetch — no Workers runtime needed for tests.

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Workers KV, Vitest, `aws4fetch` (Bedrock SigV4 signing). LLMs: Groq (Llama 3.3, utility tasks + fallback writer), Claude Haiku via AWS Bedrock (post copy), Gemini 2.5 Flash Image / "Nano Banana" (image). External: Hacker News Algolia API, Reddit JSON, RSS, Telegram Bot API, LinkedIn Posts API.

**Spec:** `docs/superpowers/specs/2026-10-22-linkedin-auto-poster-design.md`

## Global Constraints

- **Language/runtime:** TypeScript targeting the Cloudflare Workers runtime (Web-standard `fetch`, `FormData`, `Blob`, `crypto.subtle`, `btoa`/`atob`). No Node-only APIs in `src/` (tests may use Node).
- **Test framework:** Vitest. Pure/logic modules are tested directly; network modules accept an injected `fetchFn: typeof fetch` parameter (default `globalThis.fetch`) so tests pass a mock.
- **No secrets in code or git.** All keys come from `env` (Wrangler secrets / `.dev.vars`). `.dev.vars` and `.wrangler/` are git-ignored.
- **Budget:** ≤ ₹100/month; only Bedrock Haiku costs money (~₹5). Exactly one Haiku call per produced draft.
- **Safety:** Never publish to LinkedIn without an explicit approve action. Only the configured Telegram chat id may command the bot. When `env.DRY_RUN === "true"`, never call the LinkedIn publish endpoint.
- **Values to confirm at setup (use these defaults in code, override via env):**
  - Bedrock model id `BEDROCK_MODEL_ID` default `us.anthropic.claude-3-5-haiku-20241022-v1:0` (cross-region inference profile); region `AWS_REGION` default `us-east-1`.
  - Gemini image model string `gemini-2.5-flash-image`.
  - LinkedIn REST version header `LINKEDIN_VERSION` default `202506` (format `YYYYMM`).
  - Groq model `llama-3.3-70b-versatile`.

## Review Focus

- **Reddit/RSS source blocked or 403 from Worker IP (likely):** a single failing trend source must contribute zero items, never throw — the pipeline still produces a draft from the remaining sources. Pinned in Task 3.
- **Telegram caption > 1024 chars (LinkedIn posts routinely exceed it):** the full post text must be sent as a `sendMessage` (4096 limit) carrying the buttons, not as a photo caption. Pinned in Task 10.
- **Commands from a chat id other than the owner's:** webhook must ignore any update whose chat/user id ≠ `TELEGRAM_CHAT_ID`. Pinned in Task 13.
- **Expired LinkedIn access token at publish time:** publisher must refresh (and persist) the token when it is within the refresh window before calling the posts endpoint. Pinned in Task 11.
- **Gemini returns a text-only (no image) response, e.g. safety refusal:** image generator must detect "no inlineData part" and fall through to the fallback provider rather than returning undefined bytes. Pinned in Task 9.

---

### Task 1: Project scaffold, types, and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `.gitignore`, `.dev.vars.example`
- Create: `src/types.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all shared types used by later tasks — `Topic`, `PostDraft`, `Tokens`, `StyleConfig`, `Settings`, and the `Env` binding interface:

```typescript
export interface Topic { key: string; title: string; url: string; source: string; score: number; }
export type DraftStatus = "pending" | "approved" | "posted" | "skipped";
export interface PostDraft {
  id: string; topic: Topic; text: string; hashtags: string[];
  imageBase64?: string; imageMime?: string; status: DraftStatus; createdAt: number;
}
export interface Tokens {
  accessToken: string; refreshToken: string;
  accessExpiresAt: number; refreshExpiresAt: number; memberUrn: string;
}
export interface StyleConfig {
  tone: string; structureRules: string[]; hashtagStrategy: string;
  dos: string[]; donts: string[]; examples: string[];
}
export interface Settings { timezone: string; dryRun: boolean; allowedChatId: string; }
export interface Env {
  STATE: KVNamespace;
  TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string;
  GROQ_API_KEY: string; GEMINI_API_KEY: string;
  AWS_ACCESS_KEY_ID: string; AWS_SECRET_ACCESS_KEY: string; AWS_REGION: string;
  BEDROCK_MODEL_ID: string;
  LINKEDIN_CLIENT_ID: string; LINKEDIN_CLIENT_SECRET: string; LINKEDIN_VERSION: string;
  WORKER_BASE_URL: string; DRY_RUN: string;
}
```

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "linkedin-auto-poster",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250620.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "wrangler": "^3.78.0"
  },
  "dependencies": {
    "aws4fetch": "^1.0.20"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `wrangler.toml`** (KV id filled during setup, Task 14)

```toml
name = "linkedin-auto-poster"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["30 3 * * *"]  # 03:30 UTC = 09:00 IST, daily

[[kv_namespaces]]
binding = "STATE"
id = "REPLACE_WITH_KV_ID"

[vars]
AWS_REGION = "us-east-1"
BEDROCK_MODEL_ID = "us.anthropic.claude-3-5-haiku-20241022-v1:0"
LINKEDIN_VERSION = "202506"
DRY_RUN = "true"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.dev.vars
.wrangler/
dist/
*.log
```

- [ ] **Step 6: Create `.dev.vars.example`** (template; real `.dev.vars` is git-ignored)

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GROQ_API_KEY=
GEMINI_API_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
WORKER_BASE_URL=
```

- [ ] **Step 7: Create `src/types.ts`** with the interfaces from the Interfaces block above.

- [ ] **Step 8: Write the smoke test `tests/smoke.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import type { Topic } from "../src/types";
describe("scaffold", () => {
  it("types import and basic object conforms", () => {
    const t: Topic = { key: "k", title: "T", url: "u", source: "hn", score: 1 };
    expect(t.key).toBe("k");
  });
});
```

- [ ] **Step 9: Install and run**

Run: `npm install && npm run test`
Expected: smoke test PASSES; `npm run typecheck` reports no errors.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: scaffold Cloudflare Worker project with types and tooling"
```

---

### Task 2: KV state store

**Files:**
- Create: `src/kv.ts`
- Test: `tests/kv.test.ts`
- Create: `tests/helpers/fakeKv.ts`

**Interfaces:**
- Consumes: `Env`, `Tokens`, `PostDraft`, `StyleConfig`, `Settings` from `src/types.ts`.
- Produces:
  - `getTokens(env): Promise<Tokens | null>` / `setTokens(env, t): Promise<void>`
  - `getPendingDraft(env): Promise<PostDraft | null>` / `setPendingDraft(env, d): Promise<void>` / `clearPendingDraft(env): Promise<void>`
  - `getRecentTopicKeys(env): Promise<string[]>` / `addRecentTopic(env, key): Promise<void>` (keeps last 14 days)
  - `getStyleConfig(env): Promise<StyleConfig>` (returns `DEFAULT_STYLE` if unset)
  - `getSettings(env): Promise<Settings>` (derives `dryRun` from `env.DRY_RUN`, `allowedChatId` from `env.TELEGRAM_CHAT_ID`)
  - Exported constant `DEFAULT_STYLE: StyleConfig`.

- [ ] **Step 1: Create the fake KV helper `tests/helpers/fakeKv.ts`**

```typescript
export function fakeKv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
    _map: m,
  } as unknown as KVNamespace & { _map: Map<string, string> };
}
```

- [ ] **Step 2: Write the failing test `tests/kv.test.ts`**

```typescript
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
  it("dedups and trims recent topics older than 14 days", async () => {
    const e = env();
    await addRecentTopic(e, "old"); // will be aged manually below
    await addRecentTopic(e, "new");
    const keys = await getRecentTopicKeys(e);
    expect(keys).toContain("new");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/kv.test.ts`
Expected: FAIL (module `../src/kv` not found).

- [ ] **Step 4: Implement `src/kv.ts`**

```typescript
import type { Env, Tokens, PostDraft, StyleConfig, Settings } from "./types";

const K = {
  tokens: "linkedin:tokens",
  draft: "draft:pending",
  recent: "topics:recent",
  style: "config:style",
};
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_STYLE: StyleConfig = {
  tone: "Witty, confident, and relatable; a sharp AI/tech practitioner who makes people smile and think. Never cringe, never offensive, never clickbait-lies.",
  structureRules: [
    "Open with a scroll-stopping hook line (a question, a bold claim, or a surprising number).",
    "Use short paragraphs (1-2 sentences) separated by blank lines.",
    "Make one clear point or insight about the trend.",
    "End with a light question or CTA to invite comments.",
    "Keep the whole post under ~1300 characters.",
  ],
  hashtagStrategy: "Use 3-5 hashtags: one or two broad (#AI, #Tech), one niche to the topic, and one that is currently trending for the topic. No spaces, PascalCase for multiword.",
  dos: ["Tie to a real current trend", "Add a practitioner's perspective", "Use humour that lands with engineers"],
  donts: ["No fake statistics", "No hashtag soup (>5)", "No corporate buzzword salad", "No politics or sensitive controversy"],
  examples: [],
};

export async function getTokens(env: Env): Promise<Tokens | null> {
  const raw = await env.STATE.get(K.tokens);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}
export async function setTokens(env: Env, t: Tokens): Promise<void> {
  await env.STATE.put(K.tokens, JSON.stringify(t));
}
export async function getPendingDraft(env: Env): Promise<PostDraft | null> {
  const raw = await env.STATE.get(K.draft);
  return raw ? (JSON.parse(raw) as PostDraft) : null;
}
export async function setPendingDraft(env: Env, d: PostDraft): Promise<void> {
  await env.STATE.put(K.draft, JSON.stringify(d));
}
export async function clearPendingDraft(env: Env): Promise<void> {
  await env.STATE.delete(K.draft);
}
export async function getRecentTopicKeys(env: Env): Promise<string[]> {
  const raw = await env.STATE.get(K.recent);
  const list = raw ? (JSON.parse(raw) as { key: string; usedAt: number }[]) : [];
  const cutoff = Date.now() - FOURTEEN_DAYS;
  return list.filter((x) => x.usedAt >= cutoff).map((x) => x.key);
}
export async function addRecentTopic(env: Env, key: string): Promise<void> {
  const raw = await env.STATE.get(K.recent);
  const list = raw ? (JSON.parse(raw) as { key: string; usedAt: number }[]) : [];
  const cutoff = Date.now() - FOURTEEN_DAYS;
  const next = list.filter((x) => x.usedAt >= cutoff && x.key !== key);
  next.push({ key, usedAt: Date.now() });
  await env.STATE.put(K.recent, JSON.stringify(next));
}
export async function getStyleConfig(env: Env): Promise<StyleConfig> {
  const raw = await env.STATE.get(K.style);
  return raw ? (JSON.parse(raw) as StyleConfig) : DEFAULT_STYLE;
}
export async function getSettings(env: Env): Promise<Settings> {
  return { timezone: "Asia/Kolkata", dryRun: env.DRY_RUN === "true", allowedChatId: env.TELEGRAM_CHAT_ID };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/kv.test.ts`
Expected: PASS (all 3).

- [ ] **Step 6: Commit**

```bash
git add src/kv.ts tests/kv.test.ts tests/helpers/fakeKv.ts && git commit -m "feat: KV state store with tokens, drafts, recent topics, style config"
```

---

### Task 3: Trend Collector

**Files:**
- Create: `src/trends.ts`
- Test: `tests/trends.test.ts`
- Create: `tests/fixtures/hn.json`, `tests/fixtures/reddit.json`, `tests/fixtures/techcrunch.xml`

**Interfaces:**
- Consumes: `Topic` from `src/types.ts`.
- Produces: `collectTrends(fetchFn?: typeof fetch): Promise<Topic[]>` — fetches HN + Reddit + RSS, normalizes to `Topic[]` sorted by score descending. **Any single source that throws or returns non-200 contributes `[]`; the function never rejects.** Also exports pure parsers used by tests: `parseHn(json): Topic[]`, `parseReddit(json): Topic[]`, `parseRss(xml, source): Topic[]`, and `topicKey(title): string` (lowercased, alnum-collapsed slug for dedup).

- [ ] **Step 1: Create fixtures**

`tests/fixtures/hn.json`:
```json
{ "hits": [
  { "objectID": "1", "title": "Cloudflare removes MCP support", "url": "https://news.example/mcp", "points": 540 },
  { "objectID": "2", "title": "Jio files for IPO", "url": "https://news.example/jio", "points": 320 }
] }
```

`tests/fixtures/reddit.json`:
```json
{ "data": { "children": [
  { "data": { "title": "OpenAI acquires a startup", "url": "https://r.example/oai", "score": 1200, "permalink": "/r/tech/x" } }
] } }
```

`tests/fixtures/techcrunch.xml`:
```xml
<rss><channel>
  <item><title>New open model beats GPT on benchmarks</title><link>https://tc.example/model</link></item>
</channel></rss>
```

- [ ] **Step 2: Write the failing test `tests/trends.test.ts`**

```typescript
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
      return new Response("blocked", { status: 403 }); // reddit + rss blocked
    }) as unknown as typeof fetch;
    const topics = await collectTrends(mockFetch);
    expect(topics.length).toBe(2);
    expect(topics.every((t) => t.source === "hn")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/trends.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/trends.ts`**

```typescript
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

  // de-duplicate by key, keep highest score
  const byKey = new Map<string, Topic>();
  for (const t of out) {
    const prev = byKey.get(t.key);
    if (!prev || t.score > prev.score) byKey.set(t.key, t);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/trends.test.ts`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add src/trends.ts tests/trends.test.ts tests/fixtures/ && git commit -m "feat: trend collector (HN + Reddit + RSS) with per-source resilience"
```

---

### Task 4: Groq client

**Files:**
- Create: `src/llm/groq.ts`
- Test: `tests/groq.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `groqChat(opts): Promise<string>` where
  `opts = { apiKey: string; system: string; user: string; temperature?: number; model?: string; fetchFn?: typeof fetch }`.
  Returns `choices[0].message.content` trimmed. Throws `Error` on non-200.

- [ ] **Step 1: Write the failing test `tests/groq.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { groqChat } from "../src/llm/groq";

describe("groqChat", () => {
  it("posts OpenAI-compatible body and returns content", async () => {
    let captured: any;
    const mockFetch = (async (_url: string, init: any) => {
      captured = { url: _url, body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ choices: [{ message: { content: " hello " } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await groqChat({ apiKey: "k", system: "s", user: "u", fetchFn: mockFetch });
    expect(out).toBe("hello");
    expect(captured.url).toContain("/openai/v1/chat/completions");
    expect(captured.headers.Authorization).toBe("Bearer k");
    expect(captured.body.messages[0]).toEqual({ role: "system", content: "s" });
  });
  it("throws on non-200", async () => {
    const mockFetch = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    await expect(groqChat({ apiKey: "k", system: "s", user: "u", fetchFn: mockFetch })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/groq.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/llm/groq.ts`**

```typescript
export interface GroqOpts {
  apiKey: string; system: string; user: string;
  temperature?: number; model?: string; fetchFn?: typeof fetch;
}

export async function groqChat(opts: GroqOpts): Promise<string> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const r = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? "llama-3.3-70b-versatile",
      temperature: opts.temperature ?? 0.7,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq error ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/groq.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/llm/groq.ts tests/groq.test.ts && git commit -m "feat: Groq chat client"
```

---

### Task 5: Topic Selector + dedup

**Files:**
- Create: `src/selector.ts`
- Test: `tests/selector.test.ts`

**Interfaces:**
- Consumes: `Topic` (types), `groqChat` (Task 4), `Env` + `getRecentTopicKeys` (Task 2).
- Produces: `selectTopic(args): Promise<Topic | null>` where
  `args = { topics: Topic[]; recentKeys: string[]; groqApiKey: string; fetchFn?: typeof fetch }`.
  Filters out topics whose `key` is in `recentKeys`, keeps the top 8 by score, asks Groq to pick the single best one for an AI/tech creator, and returns that `Topic` (or the highest-scored fresh one if Groq is unavailable/garbled). Returns `null` only when no fresh topics remain. Also exports `filterFresh(topics, recentKeys): Topic[]`.

- [ ] **Step 1: Write the failing test `tests/selector.test.ts`**

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/selector.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/selector.ts`**

```typescript
import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export function filterFresh(topics: Topic[], recentKeys: string[]): Topic[] {
  const recent = new Set(recentKeys);
  return topics.filter((t) => !recent.has(t.key));
}

export interface SelectArgs {
  topics: Topic[]; recentKeys: string[]; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function selectTopic(args: SelectArgs): Promise<Topic | null> {
  const fresh = filterFresh(args.topics, args.recentKeys).slice(0, 8);
  if (fresh.length === 0) return null;

  const numbered = fresh.map((t, i) => `${i + 1}. [${t.source}, score ${t.score}] ${t.title}`).join("\n");
  const system =
    "You help an AI/tech professional pick the single best trending topic to make a witty, insightful LinkedIn post about. Prefer topics that are current, relevant to AI/software engineers, and have humour or strong-opinion potential. Reply with ONLY the number of the best option.";
  try {
    const reply = await groqChat({
      apiKey: args.groqApiKey, system, user: `Options:\n${numbered}\n\nReply with only the number.`,
      temperature: 0.3, fetchFn: args.fetchFn,
    });
    const n = parseInt((reply.match(/\d+/)?.[0] ?? ""), 10);
    if (Number.isInteger(n) && n >= 1 && n <= fresh.length) return fresh[n - 1];
  } catch {
    // fall through to score-based pick
  }
  return fresh[0]; // already sorted by score descending
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/selector.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/selector.ts tests/selector.test.ts && git commit -m "feat: topic selector with dedup and Groq-assisted pick"
```

---

### Task 6: Bedrock Claude client

**Files:**
- Create: `src/llm/bedrock.ts`
- Test: `tests/bedrock.test.ts`

**Interfaces:**
- Consumes: `Env` (types).
- Produces: `bedrockClaude(opts): Promise<string>` where
  `opts = { env: Env; system: string; user: string; maxTokens?: number; temperature?: number; signedFetch?: typeof fetch }`.
  Builds the Bedrock invoke URL from `env.AWS_REGION` and `env.BEDROCK_MODEL_ID`, signs with `aws4fetch` `AwsClient` (service `bedrock`), posts the Anthropic Messages body, and returns `content[0].text`. For testing, a pre-signed `signedFetch` can be injected to bypass real signing. Throws on non-200.

- [ ] **Step 1: Write the failing test `tests/bedrock.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { bedrockClaude } from "../src/llm/bedrock";
import type { Env } from "../src/types";

const env = {
  AWS_REGION: "us-east-1",
  BEDROCK_MODEL_ID: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
  AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret",
} as unknown as Env;

describe("bedrockClaude", () => {
  it("builds correct URL/body and extracts text", async () => {
    let captured: any;
    const signedFetch = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "a witty post" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await bedrockClaude({ env, system: "s", user: "u", signedFetch });
    expect(out).toBe("a witty post");
    expect(captured.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-3-5-haiku-20241022-v1%3A0/invoke"
    );
    expect(captured.body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(captured.body.system).toBe("s");
    expect(captured.body.messages[0]).toEqual({ role: "user", content: "u" });
  });
  it("throws on non-200", async () => {
    const signedFetch = (async () => new Response("deny", { status: 403 })) as unknown as typeof fetch;
    await expect(bedrockClaude({ env, system: "s", user: "u", signedFetch })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bedrock.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/llm/bedrock.ts`**

```typescript
import { AwsClient } from "aws4fetch";
import type { Env } from "../types";

export interface BedrockOpts {
  env: Env; system: string; user: string;
  maxTokens?: number; temperature?: number; signedFetch?: typeof fetch;
}

export async function bedrockClaude(opts: BedrockOpts): Promise<string> {
  const { env } = opts;
  const url = `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com/model/${encodeURIComponent(env.BEDROCK_MODEL_ID)}/invoke`;
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.8,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  let res: Response;
  if (opts.signedFetch) {
    res = await opts.signedFetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  } else {
    const aws = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region: env.AWS_REGION,
      service: "bedrock",
    });
    res = await aws.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  }
  if (!res.ok) throw new Error(`Bedrock error ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  const text = (j?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("").trim();
  if (!text) throw new Error("Bedrock returned empty content");
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bedrock.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/llm/bedrock.ts tests/bedrock.test.ts && git commit -m "feat: Bedrock Claude client with aws4fetch SigV4 signing"
```

---

### Task 7: Post Writer

**Files:**
- Create: `src/writer.ts`
- Test: `tests/writer.test.ts`

**Interfaces:**
- Consumes: `Topic`, `StyleConfig`, `Env` (types); `bedrockClaude` (Task 6); `groqChat` (Task 4).
- Produces:
  - `buildWriterPrompt(topic, style): { system: string; user: string }` (pure).
  - `parseWriterOutput(raw: string): { text: string; hashtags: string[] }` (pure) — the model is instructed to return JSON `{ "text": "...", "hashtags": ["#AI", ...] }`; parser extracts the first `{...}` block, normalizes hashtags (ensure leading `#`, dedupe, max 5), and throws if no usable text.
  - `writePost(args): Promise<{ text: string; hashtags: string[] }>` where
    `args = { topic: Topic; style: StyleConfig; env: Env; groqApiKey: string; fetchFn?: typeof fetch; signedFetch?: typeof fetch }`.
    Tries Bedrock Haiku first; on error falls back to Groq. Returns parsed output.

- [ ] **Step 1: Write the failing test `tests/writer.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildWriterPrompt, parseWriterOutput, writePost } from "../src/writer";
import { DEFAULT_STYLE } from "../src/kv";
import type { Env, Topic } from "../src/types";

const topic: Topic = { key: "mcp", title: "Cloudflare removes MCP support", url: "https://x", source: "hn", score: 540 };
const env = { AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "m" } as unknown as Env;

describe("writer prompt + parse", () => {
  it("prompt mentions topic and hashtag rule", () => {
    const p = buildWriterPrompt(topic, DEFAULT_STYLE);
    expect(p.user).toContain("Cloudflare removes MCP support");
    expect(p.system.toLowerCase()).toContain("json");
  });
  it("parses JSON and normalizes hashtags", () => {
    const out = parseWriterOutput('Sure: {"text":"Hook.\\n\\nBody.","hashtags":["AI","#Tech","AI"]}');
    expect(out.text).toContain("Hook.");
    expect(out.hashtags).toEqual(["#AI", "#Tech"]);
  });
  it("caps hashtags at 5", () => {
    const out = parseWriterOutput('{"text":"t","hashtags":["#a","#b","#c","#d","#e","#f"]}');
    expect(out.hashtags.length).toBe(5);
  });
  it("throws when no text", () => {
    expect(() => parseWriterOutput("no json here")).toThrow();
  });
});

describe("writePost fallback", () => {
  it("uses Groq when Bedrock fails", async () => {
    const signedFetch = (async () => new Response("deny", { status: 403 })) as unknown as typeof fetch; // bedrock fails
    const fetchFn = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"G","hashtags":["#AI"]}' } }] }), { status: 200 })
    ) as unknown as typeof fetch; // groq ok
    const out = await writePost({ topic, style: DEFAULT_STYLE, env, groqApiKey: "k", fetchFn, signedFetch });
    expect(out.text).toBe("G");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/writer.ts`**

```typescript
import type { Topic, StyleConfig, Env } from "./types";
import { bedrockClaude } from "./llm/bedrock";
import { groqChat } from "./llm/groq";

export function buildWriterPrompt(topic: Topic, style: StyleConfig): { system: string; user: string } {
  const system = [
    "You are a LinkedIn ghostwriter for an AI/tech professional.",
    `Tone: ${style.tone}`,
    "Structure rules:", ...style.structureRules.map((r) => `- ${r}`),
    `Hashtags: ${style.hashtagStrategy}`,
    "Do:", ...style.dos.map((r) => `- ${r}`),
    "Don't:", ...style.donts.map((r) => `- ${r}`),
    style.examples.length ? `Match the voice of these example posts:\n${style.examples.join("\n---\n")}` : "",
    'Return ONLY a JSON object, no markdown fences: {"text": "<the post body WITHOUT hashtags>", "hashtags": ["#Tag1", "#Tag2"]}',
  ].filter(Boolean).join("\n");

  const user = `Trending topic: "${topic.title}" (source: ${topic.source}, link: ${topic.url}).\nWrite today's post about this.`;
  return { system, user };
}

export function parseWriterOutput(raw: string): { text: string; hashtags: string[] } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Writer output had no JSON object");
  let obj: any;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error("Writer output JSON was invalid"); }
  const text = String(obj?.text ?? "").trim();
  if (!text) throw new Error("Writer output had empty text");
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const h of Array.isArray(obj?.hashtags) ? obj.hashtags : []) {
    let tag = String(h).trim();
    if (!tag) continue;
    if (!tag.startsWith("#")) tag = "#" + tag.replace(/^#+/, "");
    const low = tag.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low); hashtags.push(tag);
    if (hashtags.length === 5) break;
  }
  return { text, hashtags };
}

export interface WriteArgs {
  topic: Topic; style: StyleConfig; env: Env; groqApiKey: string;
  fetchFn?: typeof fetch; signedFetch?: typeof fetch;
}

export async function writePost(args: WriteArgs): Promise<{ text: string; hashtags: string[] }> {
  const { system, user } = buildWriterPrompt(args.topic, args.style);
  try {
    const raw = await bedrockClaude({ env: args.env, system, user, signedFetch: args.signedFetch });
    return parseWriterOutput(raw);
  } catch {
    const raw = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.8, fetchFn: args.fetchFn });
    return parseWriterOutput(raw);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/writer.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts && git commit -m "feat: post writer (Haiku primary, Groq fallback) with JSON parsing and hashtag rules"
```

---

### Task 8: Image Prompt Crafter

**Files:**
- Create: `src/imagePrompt.ts`
- Test: `tests/imagePrompt.test.ts`

**Interfaces:**
- Consumes: `Topic` (types); `groqChat` (Task 4).
- Produces: `craftImagePrompt(args): Promise<string>` where
  `args = { topic: Topic; postText: string; groqApiKey: string; fetchFn?: typeof fetch }`.
  Asks Groq for a single vivid, non-text-heavy image description suitable for a professional-yet-playful LinkedIn visual. On Groq failure, returns a deterministic fallback prompt built from the topic title. Always returns a non-empty string.

- [ ] **Step 1: Write the failing test `tests/imagePrompt.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { craftImagePrompt } from "../src/imagePrompt";
import type { Topic } from "../src/types";

const topic: Topic = { key: "mcp", title: "Cloudflare removes MCP support", url: "u", source: "hn", score: 1 };

describe("craftImagePrompt", () => {
  it("returns Groq's prompt", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "A cinematic server room, witty mood" } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const out = await craftImagePrompt({ topic, postText: "p", groqApiKey: "k", fetchFn: mockFetch });
    expect(out).toContain("server room");
  });
  it("falls back to a topic-based prompt on failure", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const out = await craftImagePrompt({ topic, postText: "p", groqApiKey: "k", fetchFn: mockFetch });
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain("cloudflare removes mcp support");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/imagePrompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/imagePrompt.ts`**

```typescript
import type { Topic } from "./types";
import { groqChat } from "./llm/groq";

export interface ImagePromptArgs {
  topic: Topic; postText: string; groqApiKey: string; fetchFn?: typeof fetch;
}

export async function craftImagePrompt(args: ImagePromptArgs): Promise<string> {
  const system =
    "You write prompts for an AI image generator. Produce ONE vivid, visually clear scene for a LinkedIn post image: modern, clean, slightly playful, professional. Avoid heavy on-image text, logos, or real brand marks. Reply with only the prompt, one sentence or two.";
  const user = `Topic: ${args.topic.title}\nPost gist: ${args.postText.slice(0, 400)}\nWrite the image prompt.`;
  try {
    const out = await groqChat({ apiKey: args.groqApiKey, system, user, temperature: 0.7, fetchFn: args.fetchFn });
    if (out) return out;
  } catch { /* fall through */ }
  return `A clean, modern, slightly playful digital illustration representing "${args.topic.title}", professional LinkedIn style, no text, vibrant but tasteful colors.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/imagePrompt.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/imagePrompt.ts tests/imagePrompt.test.ts && git commit -m "feat: image prompt crafter with deterministic fallback"
```

---

### Task 9: Image Generator

**Files:**
- Create: `src/image.ts`
- Test: `tests/image.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (takes plain args).
- Produces: `generateImage(args): Promise<{ base64: string; mime: string } | null>` where
  `args = { prompt: string; geminiApiKey: string; fetchFn?: typeof fetch }`.
  Tries Gemini `gemini-2.5-flash-image` first and reads `candidates[0].content.parts[].inlineData`; **if no image part is present (e.g. text-only/safety response), falls through to Pollinations** (`https://image.pollinations.ai/prompt/<encoded>?width=1024&height=1024&nologo=true`), reading raw bytes and base64-encoding them. Returns `null` only if every provider fails. Also exports `extractGeminiImage(json): { base64: string; mime: string } | null` (pure) and `bytesToBase64(bytes): string`.

- [ ] **Step 1: Write the failing test `tests/image.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { extractGeminiImage, generateImage, bytesToBase64 } from "../src/image";

describe("extractGeminiImage", () => {
  it("pulls inlineData when present", () => {
    const json = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] };
    expect(extractGeminiImage(json)).toEqual({ base64: "QUJD", mime: "image/png" });
  });
  it("returns null for text-only response", () => {
    const json = { candidates: [{ content: { parts: [{ text: "I can't generate that" }] } }] };
    expect(extractGeminiImage(json)).toBeNull();
  });
});

describe("generateImage fallback", () => {
  it("falls through to Pollinations when Gemini has no image", async () => {
    const mockFetch = (async (url: string) => {
      if (String(url).includes("generativelanguage")) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 });
      }
      return new Response(new Uint8Array([65, 66, 67]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const out = await generateImage({ prompt: "cats", geminiApiKey: "k", fetchFn: mockFetch });
    expect(out?.mime).toBe("image/jpeg");
    expect(out?.base64).toBe(bytesToBase64(new Uint8Array([65, 66, 67])));
  });
  it("returns null when all providers fail", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const out = await generateImage({ prompt: "x", geminiApiKey: "k", fetchFn: mockFetch });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/image.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/image.ts`**

```typescript
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function extractGeminiImage(json: any): { base64: string; mime: string } | null {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data;
    if (inline?.data) return { base64: String(inline.data), mime: String(inline.mimeType ?? inline.mime_type ?? "image/png") };
  }
  return null;
}

export interface ImageArgs { prompt: string; geminiApiKey: string; fetchFn?: typeof fetch; }

async function tryGemini(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${args.geminiApiKey}`;
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: args.prompt }] }] }),
    });
    if (!r.ok) return null;
    return extractGeminiImage(await r.json());
  } catch { return null; }
}

async function tryPollinations(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}?width=1024&height=1024&nologo=true`;
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const mime = r.headers.get("Content-Type") || "image/jpeg";
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0) return null;
    return { base64: bytesToBase64(bytes), mime };
  } catch { return null; }
}

export async function generateImage(args: ImageArgs): Promise<{ base64: string; mime: string } | null> {
  return (await tryGemini(args)) ?? (await tryPollinations(args));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/image.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/image.ts tests/image.test.ts && git commit -m "feat: image generator (Gemini Nano Banana with Pollinations fallback)"
```

---

### Task 10: Telegram module

**Files:**
- Create: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

**Interfaces:**
- Consumes: `PostDraft` (types).
- Produces:
  - `formatCaption(draft): string` (pure) — joins `draft.text` + blank line + hashtags; used as the message text.
  - `base64ToBlob(base64, mime): Blob` (pure helper).
  - `sendDraft(args): Promise<void>` — sends the image via `sendPhoto` (short caption) **then** the full post text via `sendMessage` **carrying the inline keyboard** (so text length up to 4096 is never truncated to the 1024 photo-caption limit). `args = { botToken: string; chatId: string; draft: PostDraft; fetchFn?: typeof fetch }`. If `draft.imageBase64` is absent, it sends text-only with a "⚠️ no image" note.
  - `sendMessage(botToken, chatId, text, fetchFn?, replyMarkup?): Promise<void>`
  - `answerCallback(botToken, callbackId, fetchFn?, text?): Promise<void>`
  - `buildKeyboard(draftId): object` (pure) — inline keyboard with callback_data `approve:<id>`, `edit:<id>`, `regen_text:<id>`, `regen_image:<id>`, `skip:<id>`.
  - Types: `TelegramUpdate`, `ParsedCommand = { kind: "approve"|"edit"|"regen_text"|"regen_image"|"skip"|"edit_reply"|"ignore"; draftId?: string; chatId?: string; fromId?: string; callbackId?: string; messageText?: string }`.
  - `parseUpdate(update): ParsedCommand` (pure) — classifies `callback_query` (split `data` on `:`) vs plain `message` (treated as `edit_reply`).

- [ ] **Step 1: Write the failing test `tests/telegram.test.ts`**

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/telegram.ts`**

```typescript
import type { PostDraft } from "./types";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export function formatCaption(draft: PostDraft): string {
  const tags = draft.hashtags.join(" ");
  return tags ? `${draft.text}\n\n${tags}` : draft.text;
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function buildKeyboard(draftId: string) {
  return {
    inline_keyboard: [
      [ { text: "✅ Approve", callback_data: `approve:${draftId}` }, { text: "✏️ Edit", callback_data: `edit:${draftId}` } ],
      [ { text: "🔄 Regen text", callback_data: `regen_text:${draftId}` }, { text: "🖼️ Regen image", callback_data: `regen_image:${draftId}` } ],
      [ { text: "⏭️ Skip", callback_data: `skip:${draftId}` } ],
    ],
  };
}

export async function sendMessage(botToken: string, chatId: string, text: string, fetchFn: typeof fetch = globalThis.fetch, replyMarkup?: object): Promise<void> {
  await fetchFn(api(botToken, "sendMessage"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
}

export async function answerCallback(botToken: string, callbackId: string, fetchFn: typeof fetch = globalThis.fetch, text?: string): Promise<void> {
  await fetchFn(api(botToken, "answerCallbackQuery"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, ...(text ? { text } : {}) }),
  });
}

export interface SendDraftArgs { botToken: string; chatId: string; draft: PostDraft; fetchFn?: typeof fetch; }

export async function sendDraft(args: SendDraftArgs): Promise<void> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  const { botToken, chatId, draft } = args;

  if (draft.imageBase64 && draft.imageMime) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", "🖼️ Draft image preview");
    form.append("photo", base64ToBlob(draft.imageBase64, draft.imageMime), "draft.png");
    await fetchFn(api(botToken, "sendPhoto"), { method: "POST", body: form });
  } else {
    await sendMessage(botToken, chatId, "⚠️ No image for this draft.", fetchFn);
  }
  await sendMessage(botToken, chatId, formatCaption(draft), fetchFn, buildKeyboard(draft.id));
}

export interface ParsedCommand {
  kind: "approve" | "edit" | "regen_text" | "regen_image" | "skip" | "edit_reply" | "ignore";
  draftId?: string; chatId?: string; fromId?: string; callbackId?: string; messageText?: string;
}

export function parseUpdate(update: any): ParsedCommand {
  const cq = update?.callback_query;
  if (cq) {
    const [action, draftId] = String(cq.data ?? "").split(":");
    const kinds = ["approve", "edit", "regen_text", "regen_image", "skip"];
    return {
      kind: (kinds.includes(action) ? action : "ignore") as ParsedCommand["kind"],
      draftId, callbackId: String(cq.id),
      chatId: cq.message?.chat?.id != null ? String(cq.message.chat.id) : undefined,
      fromId: cq.from?.id != null ? String(cq.from.id) : undefined,
    };
  }
  const msg = update?.message;
  if (msg && typeof msg.text === "string") {
    return {
      kind: "edit_reply", messageText: msg.text,
      chatId: msg.chat?.id != null ? String(msg.chat.id) : undefined,
      fromId: msg.from?.id != null ? String(msg.from.id) : undefined,
    };
  }
  return { kind: "ignore" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts && git commit -m "feat: Telegram module (send draft, keyboard, update parsing)"
```

---

### Task 11: LinkedIn Publisher

**Files:**
- Create: `src/linkedin.ts`
- Test: `tests/linkedin.test.ts`

**Interfaces:**
- Consumes: `Env`, `Tokens` (types); `getTokens`/`setTokens` (Task 2).
- Produces:
  - `needsRefresh(tokens, now): boolean` (pure) — true when `accessExpiresAt - now < 2 days`.
  - `refreshTokens(args): Promise<Tokens>` — POST to `https://www.linkedin.com/oauth/v2/accessToken` with `grant_type=refresh_token`; returns updated `Tokens` (preserves `memberUrn`, recomputes expiries from `expires_in`/`refresh_token_expires_in`). `args = { env; tokens; fetchFn? }`.
  - `publishPost(args): Promise<void>` — ensures a fresh token (refresh + persist if needed), then: (1) init image upload, (2) PUT image bytes, (3) create the post via Posts API. `args = { env; text: string; imageBase64: string; imageMime: string; fetchFn? }`. Throws on any non-2xx with the response body.
  - `buildPostBody(authorUrn, text, imageUrn): object` (pure) — the Posts API payload.

- [ ] **Step 1: Write the failing test `tests/linkedin.test.ts`**

```typescript
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

describe("publishPost", () => {
  it("runs init-upload, PUT, create-post in order", async () => {
    const kv = fakeKv();
    const now = Date.now();
    const env = { STATE: kv, LINKEDIN_CLIENT_ID: "c", LINKEDIN_CLIENT_SECRET: "s", LINKEDIN_VERSION: "202506", DRY_RUN: "false" } as unknown as Env;
    const tokens: Tokens = { accessToken: "AT", refreshToken: "RT", accessExpiresAt: now + 30 * 86400_000, refreshExpiresAt: now + 300 * 86400_000, memberUrn: "urn:li:person:ME" };
    await setTokens(env, tokens);
    const calls: string[] = [];
    const mockFetch = (async (url: string, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("action=initializeUpload")) {
        return new Response(JSON.stringify({ value: { uploadUrl: "https://upload.example/u", image: "urn:li:image:IMG" } }), { status: 200 });
      }
      if (String(url) === "https://upload.example/u") return new Response("", { status: 201 });
      if (String(url).includes("/rest/posts")) return new Response("", { status: 201 });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await publishPost({ env, text: "hello", imageBase64: "QUJD", imageMime: "image/png", fetchFn: mockFetch });
    expect(calls[0]).toContain("initializeUpload");
    expect(calls[1]).toBe("PUT https://upload.example/u");
    expect(calls[2]).toContain("/rest/posts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/linkedin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/linkedin.ts`**

```typescript
import type { Env, Tokens } from "./types";
import { getTokens, setTokens } from "./kv";
import { base64ToBlob } from "./telegram";

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

export function needsRefresh(tokens: Tokens, now: number = Date.now()): boolean {
  return tokens.accessExpiresAt - now < TWO_DAYS;
}

export interface RefreshArgs { env: Env; tokens: Tokens; fetchFn?: typeof fetch; }

export async function refreshTokens(args: RefreshArgs): Promise<Tokens> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.tokens.refreshToken,
    client_id: args.env.LINKEDIN_CLIENT_ID,
    client_secret: args.env.LINKEDIN_CLIENT_SECRET,
  });
  const r = await fetchFn("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`LinkedIn token refresh ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  const now = Date.now();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? args.tokens.refreshToken,
    accessExpiresAt: now + Number(j.expires_in) * 1000,
    refreshExpiresAt: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : args.tokens.refreshExpiresAt,
    memberUrn: args.tokens.memberUrn,
  };
}

export function buildPostBody(authorUrn: string, text: string, imageUrn: string) {
  return {
    author: authorUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: imageUrn, title: "" } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

export interface PublishArgs { env: Env; text: string; imageBase64: string; imageMime: string; fetchFn?: typeof fetch; }

export async function publishPost(args: PublishArgs): Promise<void> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  let tokens = await getTokens(args.env);
  if (!tokens) throw new Error("No LinkedIn tokens stored — run the one-time OAuth setup");
  if (needsRefresh(tokens)) {
    tokens = await refreshTokens({ env: args.env, tokens, fetchFn });
    await setTokens(args.env, tokens);
  }

  const h = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "LinkedIn-Version": args.env.LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };

  // 1. initialize upload
  const initRes = await fetchFn("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner: tokens.memberUrn } }),
  });
  if (!initRes.ok) throw new Error(`LinkedIn init upload ${initRes.status}: ${await initRes.text()}`);
  const init: any = await initRes.json();
  const uploadUrl: string = init?.value?.uploadUrl;
  const imageUrn: string = init?.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("LinkedIn init upload missing uploadUrl/image");

  // 2. PUT the image bytes
  const putRes = await fetchFn(uploadUrl, {
    method: "PUT", headers: { Authorization: `Bearer ${tokens.accessToken}` },
    body: base64ToBlob(args.imageBase64, args.imageMime),
  });
  if (!putRes.ok) throw new Error(`LinkedIn image PUT ${putRes.status}: ${await putRes.text()}`);

  // 3. create the post
  const postRes = await fetchFn("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify(buildPostBody(tokens.memberUrn, args.text, imageUrn)),
  });
  if (!postRes.ok) throw new Error(`LinkedIn create post ${postRes.status}: ${await postRes.text()}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/linkedin.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/linkedin.ts tests/linkedin.test.ts && git commit -m "feat: LinkedIn publisher with token refresh and image post flow"
```

---

### Task 12: Draft pipeline orchestration

**Files:**
- Create: `src/pipeline.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above + KV helpers.
- Produces:
  - `buildDraft(args): Promise<PostDraft>` — runs collect → select → write → image-prompt → image; assembles a `PostDraft` with a generated `id` (`crypto.randomUUID()`), status `"pending"`. Throws `NoFreshTopicError` when `selectTopic` returns null. `args = { env; fetchFn?; signedFetch? }` (dependencies pulled from `env`/KV internally).
  - `runDailyPipeline(env, deps?): Promise<void>` — calls `buildDraft`, stores it as pending, records the topic in recent, and sends it to Telegram. On any thrown error, notifies the owner on Telegram with the error message and rethrows-as-handled (does not send a draft). `deps` optionally injects `fetchFn`/`signedFetch` for tests.
  - Exported `class NoFreshTopicError extends Error`.

- [ ] **Step 1: Write the failing test `tests/pipeline.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { runDailyPipeline } from "../src/pipeline";
import { fakeKv } from "./helpers/fakeKv";
import { getPendingDraft } from "../src/kv";
import type { Env } from "../src/types";

function makeEnv() {
  return {
    STATE: fakeKv(), TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "123",
    GROQ_API_KEY: "g", GEMINI_API_KEY: "gem",
    AWS_REGION: "us-east-1", BEDROCK_MODEL_ID: "m", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b",
    DRY_RUN: "true",
  } as unknown as Env;
}

// Routes each outbound URL to a canned success response.
function router(): typeof fetch {
  return (async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("algolia")) return new Response(JSON.stringify({ hits: [{ objectID: "1", title: "Cloudflare removes MCP", url: "https://x", points: 500 }] }), { status: 200 });
    if (u.includes("reddit") || u.includes("techcrunch") || u.includes("theverge")) return new Response("blocked", { status: 403 });
    if (u.includes("groq.com")) return new Response(JSON.stringify({ choices: [{ message: { content: "1" } }] }), { status: 200 });
    if (u.includes("generativelanguage")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }), { status: 200 });
    if (u.includes("api.telegram.org")) return new Response("{}", { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

describe("runDailyPipeline", () => {
  it("produces and stores a pending draft, sends to Telegram", async () => {
    const env = makeEnv();
    // Bedrock path: signedFetch returns a valid writer JSON.
    const signedFetch = (async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: '{"text":"Hook.\\n\\nBody.","hashtags":["#AI"]}' }] }), { status: 200 })
    ) as unknown as typeof fetch;
    await runDailyPipeline(env, { fetchFn: router(), signedFetch });
    const d = await getPendingDraft(env);
    expect(d?.status).toBe("pending");
    expect(d?.text).toContain("Hook.");
    expect(d?.imageBase64).toBe("QUJD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/pipeline.ts`**

```typescript
import type { Env, PostDraft } from "./types";
import { collectTrends } from "./trends";
import { selectTopic } from "./selector";
import { writePost } from "./writer";
import { craftImagePrompt } from "./imagePrompt";
import { generateImage } from "./image";
import { sendDraft, sendMessage } from "./telegram";
import { getRecentTopicKeys, addRecentTopic, setPendingDraft, getStyleConfig } from "./kv";

export class NoFreshTopicError extends Error {
  constructor() { super("No fresh trending topic available today"); this.name = "NoFreshTopicError"; }
}

export interface PipelineDeps { fetchFn?: typeof fetch; signedFetch?: typeof fetch; }

export async function buildDraft(env: Env, deps: PipelineDeps = {}): Promise<PostDraft> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const topics = await collectTrends(fetchFn);
  const recentKeys = await getRecentTopicKeys(env);
  const topic = await selectTopic({ topics, recentKeys, groqApiKey: env.GROQ_API_KEY, fetchFn });
  if (!topic) throw new NoFreshTopicError();

  const style = await getStyleConfig(env);
  const { text, hashtags } = await writePost({ topic, style, env, groqApiKey: env.GROQ_API_KEY, fetchFn, signedFetch: deps.signedFetch });
  const imgPrompt = await craftImagePrompt({ topic, postText: text, groqApiKey: env.GROQ_API_KEY, fetchFn });
  const image = await generateImage({ prompt: imgPrompt, geminiApiKey: env.GEMINI_API_KEY, fetchFn });

  return {
    id: crypto.randomUUID(), topic, text, hashtags,
    imageBase64: image?.base64, imageMime: image?.mime,
    status: "pending", createdAt: Date.now(),
  };
}

export async function runDailyPipeline(env: Env, deps: PipelineDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  try {
    const draft = await buildDraft(env, deps);
    await setPendingDraft(env, draft);
    await addRecentTopic(env, draft.topic.key);
    await sendDraft({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, draft, fetchFn });
  } catch (err: any) {
    const msg = err?.name === "NoFreshTopicError"
      ? "ℹ️ No fresh trending topic today — skipping."
      : `⚠️ Draft generation failed: ${err?.message ?? err}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, msg, fetchFn);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts tests/pipeline.test.ts && git commit -m "feat: daily draft pipeline orchestration with error notification"
```

---

### Task 13: Worker entry (cron + Telegram webhook)

**Files:**
- Create: `src/index.ts`
- Test: `tests/webhook.test.ts`

**Interfaces:**
- Consumes: `runDailyPipeline`, `buildDraft` (Task 12); telegram parse/send (Task 10); `publishPost` (Task 11); KV helpers (Task 2).
- Produces:
  - `default export { scheduled, fetch }`.
  - `scheduled(event, env, ctx)` → `runDailyPipeline(env)`.
  - `fetch(request, env, ctx)` → Telegram webhook. Verifies the request, **ignores any update whose `fromId`/`chatId` ≠ `env.TELEGRAM_CHAT_ID`** (returns 200 "ok" without acting), then dispatches via `handleCommand(env, cmd, deps?)`.
  - `handleCommand(env, cmd, deps?): Promise<void>` (exported for tests) — implements: `approve` → publish pending draft (unless `DRY_RUN`), confirm, clear pending; `skip` → clear pending, confirm; `regen_text`/`regen_image` → rebuild draft and resend; `edit` → prompt the owner to reply with new text; `edit_reply` → replace pending draft text with the message and resend for final approval.

- [ ] **Step 1: Write the failing test `tests/webhook.test.ts`**

```typescript
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

describe("handleCommand", () => {
  it("ignores commands from the wrong chat id", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    const calls: string[] = [];
    const fetchFn = (async (u: string) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await handleCommand(e, { kind: "approve", draftId: "d1", chatId: "999", fromId: "999", callbackId: "cb" }, { fetchFn });
    expect(await getPendingDraft(e)).not.toBeNull(); // nothing happened
  });

  it("skip clears the pending draft", async () => {
    const e = env();
    await setPendingDraft(e, draft);
    const fetchFn = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await handleCommand(e, { kind: "skip", draftId: "d1", chatId: "123", fromId: "123", callbackId: "cb" }, { fetchFn });
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhook.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/index.ts`**

```typescript
import type { Env } from "./types";
import { runDailyPipeline, buildDraft, type PipelineDeps } from "./pipeline";
import { parseUpdate, sendDraft, sendMessage, answerCallback, type ParsedCommand } from "./telegram";
import { getPendingDraft, setPendingDraft, clearPendingDraft } from "./kv";
import { publishPost } from "./linkedin";

export async function handleCommand(env: Env, cmd: ParsedCommand, deps: PipelineDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const token = env.TELEGRAM_BOT_TOKEN;

  // Owner-only guard
  if (cmd.kind === "ignore") return;
  if (cmd.chatId && cmd.chatId !== env.TELEGRAM_CHAT_ID) return;
  if (cmd.fromId && cmd.fromId !== env.TELEGRAM_CHAT_ID) return;
  if (cmd.callbackId) await answerCallback(token, cmd.callbackId, fetchFn);

  const chat = env.TELEGRAM_CHAT_ID;

  if (cmd.kind === "skip") {
    await clearPendingDraft(env);
    await sendMessage(token, chat, "⏭️ Skipped. Nothing will be posted.", fetchFn);
    return;
  }

  if (cmd.kind === "edit") {
    await sendMessage(token, chat, "✏️ Send the corrected post text as a reply, and I'll re-draft it for approval.", fetchFn);
    return;
  }

  if (cmd.kind === "edit_reply") {
    const d = await getPendingDraft(env);
    if (!d) { await sendMessage(token, chat, "No pending draft to edit.", fetchFn); return; }
    d.text = cmd.messageText ?? d.text;
    await setPendingDraft(env, d);
    await sendDraft({ botToken: token, chatId: chat, draft: d, fetchFn });
    return;
  }

  if (cmd.kind === "regen_text" || cmd.kind === "regen_image") {
    await sendMessage(token, chat, "🔄 Regenerating…", fetchFn);
    try {
      const fresh = await buildDraft(env, deps);
      await setPendingDraft(env, fresh);
      await sendDraft({ botToken: token, chatId: chat, draft: fresh, fetchFn });
    } catch (err: any) {
      await sendMessage(token, chat, `⚠️ Regeneration failed: ${err?.message ?? err}`, fetchFn);
    }
    return;
  }

  if (cmd.kind === "approve") {
    const d = await getPendingDraft(env);
    if (!d) { await sendMessage(token, chat, "No pending draft to post.", fetchFn); return; }
    const fullText = d.hashtags.length ? `${d.text}\n\n${d.hashtags.join(" ")}` : d.text;

    if (env.DRY_RUN === "true") {
      await clearPendingDraft(env);
      await sendMessage(token, chat, "✅ (DRY RUN) Would have posted to LinkedIn. Draft cleared.", fetchFn);
      return;
    }
    if (!d.imageBase64 || !d.imageMime) {
      await sendMessage(token, chat, "⚠️ Draft has no image; cannot post an image share. Regenerate the image first.", fetchFn);
      return;
    }
    try {
      await publishPost({ env, text: fullText, imageBase64: d.imageBase64, imageMime: d.imageMime, fetchFn });
      await clearPendingDraft(env);
      await sendMessage(token, chat, "✅ Posted to LinkedIn!", fetchFn);
    } catch (err: any) {
      await sendMessage(token, chat, `⚠️ LinkedIn post failed: ${err?.message ?? err}`, fetchFn);
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDailyPipeline(env);
  },
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("ok", { status: 200 });
    let update: any;
    try { update = await request.json(); } catch { return new Response("ok", { status: 200 }); }
    const cmd = parseUpdate(update);
    await handleCommand(env, cmd);
    return new Response("ok", { status: 200 });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webhook.test.ts && npm run typecheck`
Expected: PASS (all 3) and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/webhook.test.ts && git commit -m "feat: worker entry with cron handler and owner-guarded Telegram webhook"
```

---

### Task 14: Setup guide, OAuth bootstrap, and deployment

**Files:**
- Create: `README.md`
- Create: `scripts/linkedin-oauth.md`
- Modify: `wrangler.toml` (fill KV id)

**Interfaces:**
- Consumes: the finished Worker.
- Produces: runnable setup documentation; no code logic (so no unit test — this task's deliverable is verified by the manual steps succeeding).

- [ ] **Step 1: Write `scripts/linkedin-oauth.md`** — the one-time authorization that seeds `linkedin:tokens` in KV.

````markdown
# One-time LinkedIn OAuth (seed tokens)

1. Create a LinkedIn app at https://www.linkedin.com/developers/apps → add the
   **"Share on LinkedIn"** product. Set an Authorized redirect URL:
   `https://<your-worker-subdomain>.workers.dev/oauth/callback` (any URL you
   control is fine for this manual step — you'll copy the `code` by hand).
2. Note the **Client ID** and **Client Secret**.
3. Open this URL in a browser (replace CLIENT_ID and REDIRECT), approve access:

   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT&scope=openid%20profile%20w_member_social
   ```

4. After approving you'll land on REDIRECT with `?code=XXXX`. Copy `XXXX`.
5. Exchange the code for tokens:

   ```bash
   curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
     -d grant_type=authorization_code -d code=XXXX -d redirect_uri=REDIRECT \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET
   ```

   Response has `access_token`, `refresh_token`, `expires_in`, `refresh_token_expires_in`.
6. Get your member id (the `sub` field):

   ```bash
   curl -H "Authorization: Bearer ACCESS_TOKEN" https://api.linkedin.com/v2/userinfo
   ```

7. Seed KV (compute `accessExpiresAt`/`refreshExpiresAt` as `now_ms + expires_in*1000`):

   ```bash
   wrangler kv key put --binding=STATE "linkedin:tokens" '{
     "accessToken":"ACCESS_TOKEN","refreshToken":"REFRESH_TOKEN",
     "accessExpiresAt":PUT_MS,"refreshExpiresAt":PUT_MS,
     "memberUrn":"urn:li:person:SUB"
   }'
   ```
````

- [ ] **Step 2: Write `README.md`** with the full setup + deploy flow.

````markdown
# LinkedIn Auto-Poster

Daily trend-aware, humorous LinkedIn posts with an AI image, approved by you on Telegram.

## Setup

1. `npm install`
2. **Telegram:** message @BotFather → `/newbot` → copy the bot token. Message your
   new bot once, then get your numeric chat id from
   `https://api.telegram.org/bot<TOKEN>/getUpdates` (the `chat.id`).
3. **Groq:** get a free API key at https://console.groq.com .
4. **Gemini:** get a key at https://aistudio.google.com/apikey .
5. **AWS Bedrock:** in the AWS console enable model access for Claude 3.5 Haiku in
   your region; create an IAM user with `bedrock:InvokeModel`; copy the access key.
6. **LinkedIn:** follow `scripts/linkedin-oauth.md`.
7. **Cloudflare:**
   ```bash
   npx wrangler kv namespace create STATE   # copy the id into wrangler.toml
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put LINKEDIN_CLIENT_ID
   npx wrangler secret put LINKEDIN_CLIENT_SECRET
   npx wrangler deploy
   ```
8. Seed LinkedIn tokens into KV (step 7 of the OAuth doc).
9. **Register the Telegram webhook** (points Telegram at your Worker):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/"
   ```

## Going live

- Keep `DRY_RUN = "true"` in `wrangler.toml` until you've seen a few drafts and a
  dry-run "approve". Then set it to `"false"` and `npx wrangler deploy` again.
- Trigger a draft immediately for testing:
  `npx wrangler dev` then in another shell hit the scheduled handler, or wait for
  the cron (default 09:00 IST).

## Changing your style

Edit the style config in KV:
```bash
wrangler kv key put --binding=STATE "config:style" "$(cat my-style.json)"
```
`my-style.json` matches the `StyleConfig` shape (tone, structureRules,
hashtagStrategy, dos, donts, examples). Paste a few of your best past posts into
`examples` to make the voice match yours.
````

- [ ] **Step 3: Fill the KV id in `wrangler.toml`** with the id printed by
  `wrangler kv namespace create STATE`.

- [ ] **Step 4: Verify the whole suite and types pass**

Run: `npm run test && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/linkedin-oauth.md wrangler.toml && git commit -m "docs: setup guide, LinkedIn OAuth bootstrap, finalize wrangler config"
```

---

## Notes for the implementer

- **Order matters:** implement tasks 1→14 in sequence; each task's `Interfaces`
  block names the exact exports later tasks import.
- **Secrets** are never committed. `.dev.vars` (local) mirrors `.dev.vars.example`.
- **Dry-run first.** Ship with `DRY_RUN="true"`; only flip to `"false"` after a
  successful dry-run approve and one real test post.
- **Setup-time values to confirm** (already defaulted in code): Bedrock model id /
  region, Gemini model string, LinkedIn version header. If an API rejects one,
  change the env var / `wrangler.toml` var — no code change needed.
