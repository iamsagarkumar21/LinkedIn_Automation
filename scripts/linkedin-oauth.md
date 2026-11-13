# One-time LinkedIn OAuth Setup (seed tokens into KV)

> **Important:** Posts will go to your **personal LinkedIn profile**, not any company page.
> The "LinkedIn Page" you create below is just a formality required by LinkedIn's developer
> portal — it has nothing to do with where posts are published.

---

## Part 1: Create the LinkedIn Developer App

1. Go to https://www.linkedin.com/developers/apps → click **"Create app"**

2. Fill the form:
   - **App name:** `AutoPost` (or anything you like)
   - **LinkedIn Page:** Click the field → type your name → if nothing appears,
     click **"Create a new LinkedIn Page"** → choose **"Company"** → fill any name
     (e.g. your own name like `Your Name`) → click **"Create page"** → come back
     and select that page. *(This page is never used for posting — it's just required
     to create the app.)*
   - **Privacy policy URL:** Type `https://example.com` (placeholder is fine)
   - **App logo:** Skip (optional)
   - Check the **legal agreement** box
   - Click **"Create app"**

3. You'll land on the app dashboard. Go to the **"Auth"** tab.
   - Note down:
     - **Client ID** (looks like: `86xxxxxxxxxxxxxx`)
     - **Client Secret** (click "Show" to reveal it)

4. Still on the **"Auth"** tab, scroll to **"OAuth 2.0 settings"**:
   - Click the **pencil/edit icon** next to "Authorized redirect URLs"
   - Add this URL: `https://localhost:3000/callback`
     *(We won't actually run a server — we just need any URL here. We'll copy
     the `code` from the browser address bar manually.)*
   - Click **"Update"**

5. Go to the **"Products"** tab:
   - Find **"Share on LinkedIn"** → click **"Request access"** → confirm
   - Find **"Sign In with OpenID Connect"** → click **"Request access"** → confirm
   - Both should show as **"Added"** within a few seconds ✅

---

## Part 2: Get the Authorization Code (in browser)

6. Build this URL by replacing `YOUR_CLIENT_ID` with the Client ID you noted:

   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=openid%20profile%20w_member_social
   ```

7. Paste that URL into your browser and press Enter.

8. LinkedIn will show a permissions page — click **"Allow"**.

9. Your browser will try to go to `https://localhost:3000/callback?code=XXXX...`
   and will show an error like "This site can't be reached" — **that's expected**.
   
   Look at the browser address bar. Copy the value of `code=` from the URL.
   Example: `https://localhost:3000/callback?code=AQT8abc123...` → copy `AQT8abc123...`
   
   > ⚠️ **This code expires in ~60 seconds. Do the next step immediately.**

---

## Part 3: Exchange Code for Tokens (in terminal)

10. Open your terminal and run this command. Replace the 4 values:

    ```bash
    curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
      -d "grant_type=authorization_code" \
      -d "code=PASTE_CODE_HERE" \
      -d "redirect_uri=https://localhost:3000/callback" \
      -d "client_id=YOUR_CLIENT_ID" \
      -d "client_secret=YOUR_CLIENT_SECRET"
    ```

11. You'll get a JSON response like:
    ```json
    {
      "access_token": "AQV...",
      "expires_in": 5183999,
      "refresh_token": "AQX...",
      "refresh_token_expires_in": 31535999
    }
    ```
    Copy all 4 values.

    > If you don't get `refresh_token`, that's okay — put an empty string `""` for it below.

---

## Part 4: Get Your Member ID

12. Run this (replace `ACCESS_TOKEN`):

    ```bash
    curl -H "Authorization: Bearer ACCESS_TOKEN" \
      https://api.linkedin.com/v2/userinfo
    ```

13. You'll get something like:
    ```json
    { "sub": "abcXYZ123", "name": "Your Name", ... }
    ```
    Copy the `sub` value (e.g. `abcXYZ123`).

---

## Part 5: Calculate Expiry Timestamps

14. Run this to get current time in milliseconds:

    ```bash
    date +%s%3N
    ```

    Example output: `1729593600000`

15. Calculate:
    - `accessExpiresAt` = output from step 14 + (`expires_in` × 1000)
    - `refreshExpiresAt` = output from step 14 + (`refresh_token_expires_in` × 1000)

    Example: if `date +%s%3N` = `1729593600000` and `expires_in` = `5183999`:
    - `accessExpiresAt` = `1729593600000 + 5183999000` = `1734777599000`

    Or just run this one-liner (replace EXPIRES_IN with your value):
    ```bash
    echo $(($(date +%s%3N) + EXPIRES_IN * 1000))
    ```

---

## Part 6: Seed Tokens into KV

16. Make sure you're in the project directory (`<your project folder>`)
    and wrangler is logged in (`npx wrangler whoami`).

17. Run this command (replace all 5 values):

    ```bash
    npx wrangler kv key put --binding=STATE "linkedin:tokens" '{
      "accessToken": "YOUR_ACCESS_TOKEN",
      "refreshToken": "YOUR_REFRESH_TOKEN_OR_EMPTY_STRING",
      "accessExpiresAt": YOUR_ACCESS_EXPIRES_AT_MS,
      "refreshExpiresAt": YOUR_REFRESH_EXPIRES_AT_MS,
      "memberUrn": "urn:li:person:YOUR_SUB"
    }'
    ```

    Example:
    ```bash
    npx wrangler kv key put --binding=STATE "linkedin:tokens" '{
      "accessToken": "AQV...",
      "refreshToken": "AQX...",
      "accessExpiresAt": 1734777599000,
      "refreshExpiresAt": 1761129599000,
      "memberUrn": "urn:li:person:abcXYZ123"
    }'
    ```

18. ✅ Done! LinkedIn is now connected. Posts will publish to your personal profile.

---

## Maintenance

- Access token lasts ~60 days, refresh token lasts ~1 year.
- The Worker auto-refreshes the access token before expiry.
- When refresh token nears expiry (within 7 days), you'll get a Telegram warning.
- At that point, repeat this entire guide once to get fresh tokens.
