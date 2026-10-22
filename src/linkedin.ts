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

  const initRes = await fetchFn("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner: tokens.memberUrn } }),
  });
  if (!initRes.ok) throw new Error(`LinkedIn init upload ${initRes.status}: ${await initRes.text()}`);
  const init: any = await initRes.json();
  const uploadUrl: string = init?.value?.uploadUrl;
  const imageUrn: string = init?.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("LinkedIn init upload missing uploadUrl/image");

  const putRes = await fetchFn(uploadUrl, {
    method: "PUT", headers: { Authorization: `Bearer ${tokens.accessToken}` },
    body: base64ToBlob(args.imageBase64, args.imageMime),
  });
  if (!putRes.ok) throw new Error(`LinkedIn image PUT ${putRes.status}: ${await putRes.text()}`);

  const postRes = await fetchFn("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify(buildPostBody(tokens.memberUrn, args.text, imageUrn)),
  });
  if (!postRes.ok) throw new Error(`LinkedIn create post ${postRes.status}: ${await postRes.text()}`);
}
