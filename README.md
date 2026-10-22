# LinkedIn Auto-Poster

Daily trend-aware, humorous LinkedIn posts with an AI image, approved by you on Telegram.
Runs on a single Cloudflare Worker (cron + Telegram webhook + KV). Cost is about ₹5/month
(only Bedrock Claude Haiku is paid).

Design: `docs/superpowers/specs/2026-10-22-linkedin-auto-poster-design.md`

## Setup

1. `npm install`
2. **Telegram:** message @BotFather → `/newbot` → copy the bot token. Send your new bot a
   message, then read your numeric chat id from
   `https://api.telegram.org/bot<TOKEN>/getUpdates` (`message.chat.id`).
3. **Groq:** free API key at https://console.groq.com .
4. **Gemini:** key at https://aistudio.google.com/apikey .
5. **AWS Bedrock:** enable model access for Claude 3.5 Haiku in your region; create an IAM
   user allowed `bedrock:InvokeModel`; copy its access key.
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
   npx wrangler secret put WEBHOOK_SECRET   # any long random string, e.g. `openssl rand -hex 32`
   npx wrangler deploy
   ```
8. Seed LinkedIn tokens into KV (last step of the OAuth doc).
9. **Register the Telegram webhook:**
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url="https://<your-worker>.workers.dev/" -d secret_token="<same value as WEBHOOK_SECRET>"
   ```
   The Worker rejects any request that lacks this secret, so nobody else can drive your bot.

## Yearly maintenance

`LINKEDIN_VERSION` in `wrangler.toml` (currently `202610`) must stay inside LinkedIn's
supported window (each monthly version lives about a year). Bump it at least once a year.
The daily run also warns you on Telegram when your LinkedIn authorization is within 7 days of expiring.

## Going live

- Ship with `DRY_RUN = "true"` in `wrangler.toml`: drafts reach Telegram, "Approve" only
  pretends to post. After a few good drafts, set it to `"false"` and `npx wrangler deploy`.
- The cron runs daily at 09:00 IST (`30 3 * * *` UTC). To test now, run
  `npx wrangler dev --test-scheduled` and open `http://localhost:8787/__scheduled`.

## Changing your style

Store a `StyleConfig` JSON in KV (tone, structureRules, hashtagStrategy, dos, donts, examples):

```bash
npx wrangler kv key put --binding=STATE "config:style" "$(cat my-style.json)"
```

Paste a few of your best past posts into `examples` to make the voice match yours.

## Tests

```bash
npm test
npm run typecheck
```
