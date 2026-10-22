# LinkedIn Auto-Poster — Design Spec (v1)

**Date:** 2026-10-22
**Owner:** rahul.kumar@appinventiv.com
**Status:** Approved design, pending spec review

## 1. Purpose & Success Criteria

**Purpose:** Grow the owner's LinkedIn reach as an AI/tech professional by
publishing one high-quality, trend-aware, humorous post per day — each with an
AI-generated image — while keeping the owner in control via a quick approval
step.

**Who it's for:** A single user (the owner), who works in the AI domain and
wants consistent, on-brand LinkedIn presence without daily manual effort.

**Success looks like:**
- One draft is reliably delivered every day to the owner's Telegram.
- The owner can approve / edit / regenerate / skip in ~1 minute.
- Approved posts publish to LinkedIn via the official API (no ToS risk).
- Content is genuinely witty, tied to current tech/AI trends, and formatted for
  LinkedIn engagement (hook-first, short paragraphs, 3–5 hashtags, soft CTA).
- Running cost stays well under ₹100/month (target ≈ ₹5).

**Explicit non-goals (v1):**
- No analysis of the owner's past posts yet (owner will supply examples later to
  refine the style guide; defaults are used until then).
- No multi-user support, no analytics dashboard, no scheduling of multiple
  posts/day, no auto-replies/comments.

## 2. Constraints

- **Budget:** ≤ ₹100/month absolute; target ≈ ₹5/month. Free resources first.
- **Safety:** Human-in-the-loop approval before every post. Never post on
  failure or partial content. Official LinkedIn API only (no browser automation).
- **Platform:** Single free platform — Cloudflare Workers — for cron + webhook +
  storage. No server to maintain.

## 3. Architecture Overview

Everything runs on **Cloudflare Workers (TypeScript)**:

- **Cron Trigger** (daily, configurable time, default 09:00 IST) runs the draft
  pipeline and sends a draft to Telegram.
- **Fetch handler** serves as the **Telegram webhook**, so the owner can act on
  the draft at any time; button taps trigger regenerate / edit / skip / publish.
- **Workers KV** stores: LinkedIn OAuth tokens, the current pending draft,
  recently-used topics (for dedup), and the editable style config.

```
Cron (daily) ──► Draft Pipeline ──► Telegram (photo + caption + inline buttons)
                                              │
Telegram webhook ◄── owner taps a button ─────┘
     │
     ├─ ✅ Approve      → LinkedIn Publisher → "✅ Posted" confirmation
     ├─ ✏️ Edit         → await corrected caption reply → store → Approve
     ├─ 🔄 Regen text   → Post Writer again → resend draft
     ├─ 🖼️ Regen image  → Image Generator again → resend draft
     └─ ⏭️ Skip         → discard pending draft (nothing posts today)
```

### Draft Pipeline (cron path)
1. **Trend Collector** gathers candidate topics.
2. **Topic Selector** (Groq) picks the best fresh angle, skipping recent topics.
3. **Post Writer** (Claude Haiku via Bedrock) writes hook + body + hashtags.
4. **Image Prompt Crafter** (Groq) turns the post into a vivid image prompt.
5. **Image Generator** (Gemini Nano Banana) renders the image.
6. **Telegram module** sends the draft with inline buttons; stores it as the
   pending draft in KV.

## 4. Components (isolated, single-purpose)

| # | Component | Responsibility | Depends on |
|---|---|---|---|
| 1 | **Trend Collector** | Return ranked candidate topics `{title, url, source, score}` | HN Algolia API, Reddit public JSON, RSS feeds |
| 2 | **Topic Selector** | Choose best fresh angle; reject topics seen in last ~14 days | Groq; KV (recent topics) |
| 3 | **Post Writer** | Produce `{hook, body, hashtags[]}` per style guide + LinkedIn rules | Claude Haiku (Bedrock); Groq fallback; KV (style config) |
| 4 | **Image Prompt Crafter** | Turn the post into an image prompt | Groq |
| 5 | **Image Generator** | Prompt → image bytes; fallbacks | Gemini Nano Banana → FLUX/Pollinations → manual |
| 6 | **Telegram Module** | Send draft, handle callback buttons & edit replies | Telegram Bot API |
| 7 | **LinkedIn Publisher** | Publish image post; manage OAuth token refresh | LinkedIn Posts API; KV (tokens) |
| 8 | **State Store** | tokens, pending draft, recent topics, style config | Workers KV |
| 9 | **Orchestrator** | Wire cron pipeline and webhook routing; error handling | all above |

Each component is a module with a narrow interface and no knowledge of the
others' internals, so it can be unit-tested with the external API mocked.

## 5. LLM / Model Routing (efficient resource use)

- **Groq (Llama, free, fast)** — "utility LLM" for low-creativity tasks: topic
  ranking/selection and image-prompt crafting. Also the **fallback writer** if
  Bedrock is unavailable.
- **Claude Haiku (Bedrock)** — "creative writer" for the actual post copy, where
  wit and style-matching matter. ~1 call/day → ≈ ₹2–5/month.
- **Gemini Nano Banana (free)** — image generation; we only need ~1–3
  images/day, so free-tier limits are never a constraint.

## 6. Content Quality Rules

- **Hook-first** opening line (question, bold claim, or number) to stop the scroll.
- Short paragraphs with line breaks for readability.
- One clear point of view or insight; witty and relatable, never cringe or
  offensive.
- **3–5 hashtags**: a curated mix of broad (#AI, #Tech), niche, and
  topic-derived tags.
- A light CTA/question at the end to invite comments.
- All of the above encoded in an editable **style config** in KV, with strong
  defaults tuned for an AI-domain creator. The owner can later paste example
  posts to refine tone/structure.

## 7. Data Shapes (KV)

- `linkedin:tokens` → `{ access_token, refresh_token, access_expires_at, refresh_expires_at, member_urn }`
- `draft:pending` → `{ id, topic, text, hashtags[], image_ref, status, created_at }`
- `topics:recent` → `[{ key, used_at }]` (trimmed to ~14 days)
- `config:style` → `{ tone, structure_rules, hashtag_strategy, dos[], donts[], examples[] }`
- `config:settings` → `{ cron_time, timezone, dry_run, allowed_telegram_chat_id }`

## 8. LinkedIn Publishing Details

- **Auth:** OAuth 2.0, `w_member_social` scope ("Share on LinkedIn" product).
  One-time manual authorization seeds `linkedin:tokens` in KV. Access token
  (~60 days) is refreshed automatically before expiry using the refresh token
  (~1 year). When the refresh token nears expiry, the owner is notified on
  Telegram to re-authorize.
- **Image post flow:** register upload → upload image binary → create the post
  (Posts API) referencing the uploaded image asset and the approved text.

## 9. Error Handling

- Every external call is wrapped; failures are caught per-component.
- On any pipeline failure (trend/LLM/image), the owner is **notified on Telegram**
  with the reason; no broken draft is sent.
- If image generation fails, a **text-only draft** is sent with a note, so the day
  isn't lost.
- If LinkedIn publishing fails, the owner is notified and the draft is **retained**
  for a retry (a "🔁 Retry post" button).
- **Dry-run mode** (`config.settings.dry_run = true`) sends drafts to Telegram but
  never publishes to LinkedIn — used for testing.
- Only the configured Telegram chat id may control the bot (ignore others).

## 10. Testing Strategy

- **Unit tests** (deterministic, external APIs mocked):
  - Trend parsing/ranking from sample HN/Reddit/RSS payloads.
  - Topic selection + dedup logic against a seeded recent-topics list.
  - Post formatting + hashtag rules (count, format, dedup).
  - LinkedIn token-refresh decision logic (expiry math).
- **Integration (manual, gated):** dry-run end-to-end to Telegram; one real
  test post to LinkedIn before going live.
- TDD: write the failing unit test before each component's logic.

## 11. Cost Estimate

| Item | ₹/month |
|---|---|
| Cloudflare Workers + KV | 0 |
| Gemini Nano Banana (image) | 0 |
| Groq (utility LLM) | 0 |
| HN / Reddit / RSS / Telegram / LinkedIn | 0 |
| Bedrock Claude Haiku (1 post/day) | ~2–5 |
| **Total** | **~5** |

## 12. One-Time Setup (owner, guided)

1. Telegram: create bot via BotFather → bot token; note own chat id.
2. LinkedIn: create Developer app → add "Share on LinkedIn" product → run
   one-time OAuth to seed tokens.
3. Google AI Studio: API key for Gemini (Nano Banana).
4. Groq: free API key.
5. AWS: enable Bedrock access to Claude Haiku in a supported region; create an
   IAM key with Bedrock invoke permission.
6. Cloudflare: account + `wrangler`; create KV namespace; set secrets; deploy;
   register the Telegram webhook.

All services have free tiers; total setup ≈ 30–40 minutes.

## 13. Open Items / Future (not in v1)

- Refine style guide from the owner's real past posts.
- Optional: best-time-to-post tuning, A/B hooks, light analytics, carousel/image
  variety, multi-source trend expansion (e.g., curated newsletters).
