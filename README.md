# LinkedIn Auto-Poster

Drafts a LinkedIn post from today's tech news, sends it to you on Telegram, and publishes it to your profile when you tap **Approve**. Nothing is posted without your approval.

Runs on one Cloudflare Worker (cron + Telegram webhook + KV storage). Only AWS Bedrock is paid, roughly ₹6–18/month.

## How it works

```
Cron 11:00 IST ──► pick today's category ──► collect topics ──► pick best one
                                                                     │
                      Telegram ◄── draft + image prompt ◄── write post (Bedrock Claude Haiku, Groq fallback)
                          │
        you tap Approve / Edit / Regen / Skip ──► LinkedIn Posts API ──► your profile
```

1. **Cron** fires daily at 11:00 AM IST. The Worker decides if today has a post.
2. **Topics** come from HN, Reddit, TechCrunch, The Verge, Ars Technica, Simon Willison, DEV.to, Google News, GitHub Trending and Hugging Face papers.
3. **Groq** picks the best topic; **Claude Haiku on Bedrock** writes the post (Groq is the fallback). The article text is fetched so the post uses real facts.
4. **Telegram** receives the category, source link, image prompt, the post and buttons.
5. **Approve** publishes to LinkedIn (text, or with the image).

## Weekly plan (IST)

| Day | Category | Length |
|---|---|---|
| Mon | AI news | 60–120 words |
| Tue | skipped | – |
| Wed | Learning: one concept explained simply | 180–280 words |
| Thu | skipped | – |
| Fri | Non-AI tech news (security, cloud, dev tools) | 60–120 words |
| Sat | Repo spotlight (GitHub Trending) | 90–160 words |
| Sun | AI news, every other week | 60–120 words |

Change the plan in `categoryForDate` in [src/schedule.ts](src/schedule.ts). Every post gets 4–5 hashtags.

## Using the Telegram bot

| Action | What it does |
|---|---|
| ✅ Approve | Publishes to LinkedIn |
| ✏️ Edit | Send your corrected text as the next message |
| 🔄 Regen text | Rewrites the post |
| 🖼️ Regen image | Tries image generation again |
| ⏭️ Skip | Discards the draft |
| Reply with a photo | Attaches your own image to the pending draft |

Image generation uses Gemini, whose free quota is often exhausted. Every draft therefore includes an **image prompt**: paste it into ChatGPT, Gemini or Midjourney, then send the result back to the bot as a photo.

## Setup

1. `npm install`
2. **Telegram:** create a bot with @BotFather and copy the token. Message the bot once, then read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` (`message.chat.id`).
3. **Groq:** free key at https://console.groq.com
4. **Gemini:** key at https://aistudio.google.com/apikey
5. **AWS Bedrock:** enable Claude 3.5 Haiku in `us-east-1` and create an IAM user allowed `bedrock:InvokeModel`.
6. **LinkedIn:** follow [scripts/linkedin-oauth.md](scripts/linkedin-oauth.md) (create app, get tokens, seed them into KV).
7. **Cloudflare:**
   ```bash
   npx wrangler login
   npx wrangler kv namespace create STATE        # put the id in wrangler.toml
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put LINKEDIN_CLIENT_ID
   npx wrangler secret put LINKEDIN_CLIENT_SECRET
   npx wrangler secret put WEBHOOK_SECRET        # any long random string: openssl rand -hex 32
   npx wrangler deploy
   ```
8. **Register the Telegram webhook** (use the same `WEBHOOK_SECRET`):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url="https://<your-worker>.workers.dev/" -d secret_token="<WEBHOOK_SECRET>"
   ```
   The Worker rejects any request without this secret and ignores every chat except yours.

## Config

In `wrangler.toml`:

| Setting | Meaning |
|---|---|
| `crons` | Run time in UTC. `30 5 * * *` = 11:00 IST |
| `DRY_RUN` | `"true"`: Approve only pretends to post. `"false"`: real posts |
| `LINKEDIN_VERSION` | LinkedIn API version, e.g. `202610` |
| `BEDROCK_MODEL_ID` | Model used for writing |

Redeploy after any change: `npx wrangler deploy`.

**Writing style** lives in `DEFAULT_STYLE` in [src/kv.ts](src/kv.ts). To override it without redeploying, store a `StyleConfig` JSON in KV:

```bash
npx wrangler kv key put --binding=STATE "config:style" "$(cat my-style.json)"
```

## Operating

```bash
npx wrangler tail          # live logs
npm test                   # 84 tests
npm run typecheck
```

- **Test a run now:** `npx wrangler dev --test-scheduled`, then open `http://localhost:8787/__scheduled`. The category follows today's weekday, and a Tue/Thu run posts nothing.
- **Yearly:** bump `LINKEDIN_VERSION`, and re-authorize LinkedIn when the bot warns you (7 days before expiry).
- **No draft arrived?** It is a skip day, or check `wrangler tail`. Failures are also sent to you on Telegram.

## Project layout

```
src/index.ts       cron + Telegram webhook entry
src/pipeline.ts    draft pipeline
src/schedule.ts    weekly category plan and topic filters
src/trends.ts      news sources
src/selector.ts    topic picking prompts
src/writer.ts      post writing, article fetch, hashtag guarantee
src/imagePrompt.ts, image.ts   image prompt and Gemini call
src/telegram.ts    bot messages, buttons, photo upload
src/linkedin.ts    OAuth refresh and publishing
src/kv.ts          state storage and default style
tests/             vitest
```

Original design notes: [docs/superpowers/specs/](docs/superpowers/specs/2026-10-22-linkedin-auto-poster-design.md)
