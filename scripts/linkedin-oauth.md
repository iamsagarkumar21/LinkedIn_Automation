# One-time LinkedIn OAuth (seed tokens)

1. Create a LinkedIn app at https://www.linkedin.com/developers/apps and add the
   **"Share on LinkedIn"** product (and "Sign In with OpenID Connect" for `/userinfo`).
   Set an Authorized redirect URL, e.g. `https://<your-worker-subdomain>.workers.dev/oauth/callback`
   (the Worker does not serve it — you copy the `code` from the browser address bar by hand).
2. Note the **Client ID** and **Client Secret**.
3. Open this URL in a browser (replace CLIENT_ID and REDIRECT, URL-encoded), approve access:

   ```
   https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT&scope=openid%20profile%20w_member_social
   ```

4. After approving you land on REDIRECT with `?code=XXXX`. Copy `XXXX` (it expires in minutes).
5. Exchange the code for tokens:

   ```bash
   curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
     -d grant_type=authorization_code -d code=XXXX -d redirect_uri=REDIRECT \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET
   ```

   The response has `access_token`, `expires_in`, and (if your app has refresh tokens
   enabled) `refresh_token`, `refresh_token_expires_in`.
6. Get your member id (the `sub` field):

   ```bash
   curl -H "Authorization: Bearer ACCESS_TOKEN" https://api.linkedin.com/v2/userinfo
   ```

7. Seed KV. Compute `accessExpiresAt` / `refreshExpiresAt` as `now_ms + expires_in*1000`
   (`date +%s%3N` gives now in ms):

   ```bash
   npx wrangler kv key put --binding=STATE "linkedin:tokens" '{
     "accessToken":"ACCESS_TOKEN","refreshToken":"REFRESH_TOKEN",
     "accessExpiresAt":MS,"refreshExpiresAt":MS,
     "memberUrn":"urn:li:person:SUB"
   }'
   ```

If LinkedIn did not return a refresh token, put an empty string for `refreshToken`
and repeat this procedure when the access token (about 60 days) nears expiry.
