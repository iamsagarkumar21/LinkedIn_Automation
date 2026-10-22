import type { Env, PostDraft } from "./types";
import { runDailyPipeline, regenText, regenImage, type PipelineDeps } from "./pipeline";
import { parseUpdate, sendDraft, sendMessage, answerCallback, type ParsedCommand } from "./telegram";
import { getPendingDraft, setPendingDraft, clearPendingDraft, setAwaitingEdit, takeAwaitingEdit } from "./kv";
import { publishPost } from "./linkedin";

const MAX_POST_CHARS = 3000; // LinkedIn commentary limit

export function splitTrailingHashtags(input: string): { text: string; hashtags: string[] } {
  const trimmed = input.trim();
  const lines = trimmed.split("\n");
  const tokens = lines[lines.length - 1].trim().split(/\s+/).filter(Boolean);
  if (tokens.length && lines.length > 1 && tokens.every((t) => /^#[\p{L}\p{N}_]+$/u.test(t))) {
    lines.pop();
    return { text: lines.join("\n").trimEnd(), hashtags: tokens };
  }
  return { text: trimmed, hashtags: [] };
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function handleCommand(env: Env, cmd: ParsedCommand, deps: PipelineDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID;
  const say = (m: string) => sendMessage(token, chat, m, fetchFn);

  // Owner-only guard (fail closed)
  if (cmd.kind === "ignore") return;
  if (cmd.chatId !== env.TELEGRAM_CHAT_ID) return;
  if (cmd.fromId !== env.TELEGRAM_CHAT_ID) return;
  if (cmd.callbackId) await answerCallback(token, cmd.callbackId, fetchFn);

  if (cmd.kind === "edit_reply") {
    const text = cmd.messageText ?? "";
    if (text.startsWith("/")) return;
    const awaiting = await takeAwaitingEdit(env);
    if (!awaiting) return; // stray message, not an edit
    const d = await getPendingDraft(env);
    if (!d || d.id !== awaiting) { await say("That draft is no longer pending."); return; }
    const parsed = splitTrailingHashtags(text);
    const hashtags = parsed.hashtags.length ? parsed.hashtags : d.hashtags;
    const total = parsed.text.length + (hashtags.length ? hashtags.join(" ").length + 2 : 0);
    if (!parsed.text || total > MAX_POST_CHARS) {
      await setAwaitingEdit(env, d.id);
      await say(`⚠️ Edit must be 1–${MAX_POST_CHARS} characters including hashtags (yours: ${total}). Send a shorter version.`);
      return;
    }
    const edited: PostDraft = { ...d, text: parsed.text, hashtags };
    await setPendingDraft(env, edited);
    await sendDraft({ botToken: token, chatId: chat, draft: edited, fetchFn });
    return;
  }

  // Every button acts on the CURRENT pending draft only
  const d = await getPendingDraft(env);
  if (!d) { await say("No pending draft."); return; }
  if (!cmd.draftId || cmd.draftId !== d.id) {
    await say("⚠️ That draft is outdated. Use the buttons on the latest draft.");
    return;
  }

  if (cmd.kind === "skip") {
    await clearPendingDraft(env);
    await say("⏭️ Skipped. Nothing will be posted.");
    return;
  }

  if (cmd.kind === "edit") {
    await setAwaitingEdit(env, d.id);
    await say("✏️ Send the corrected post text as your next message (trailing hashtags are picked up automatically).");
    return;
  }

  if (cmd.kind === "regen_text" || cmd.kind === "regen_image") {
    await say(cmd.kind === "regen_text" ? "🔄 Rewriting the text…" : "🖼️ Regenerating the image…");
    try {
      const fresh = cmd.kind === "regen_text" ? await regenText(env, d, deps) : await regenImage(env, d, deps);
      await setPendingDraft(env, fresh);
      await sendDraft({ botToken: token, chatId: chat, draft: fresh, fetchFn });
    } catch (err: any) {
      await say(`⚠️ Regeneration failed: ${err?.message ?? err}`);
    }
    return;
  }

  if (cmd.kind === "approve") {
    if (d.status !== "pending") { await say("⏳ This draft is already being posted."); return; }
    if (env.DRY_RUN === "true") {
      await clearPendingDraft(env);
      await say("✅ (DRY RUN) Would have posted to LinkedIn. Draft cleared.");
      return;
    }
    const fullText = d.hashtags.length ? `${d.text}\n\n${d.hashtags.join(" ")}` : d.text;
    await setPendingDraft(env, { ...d, status: "publishing" });
    try {
      await publishPost({ env, text: fullText, imageBase64: d.imageBase64, imageMime: d.imageMime, fetchFn });
      await clearPendingDraft(env);
      await say(d.imageBase64 ? "✅ Posted to LinkedIn!" : "✅ Posted to LinkedIn (text only, no image).");
    } catch (err: any) {
      await setPendingDraft(env, { ...d, status: "pending" });
      await say(`⚠️ LinkedIn post failed: ${err?.message ?? err}`).catch(() => {});
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDailyPipeline(env);
  },
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("ok", { status: 200 });
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!env.WEBHOOK_SECRET || !timingSafeEqual(secret, env.WEBHOOK_SECRET)) {
      return new Response("forbidden", { status: 403 });
    }
    let update: any;
    try { update = await request.json(); } catch { return new Response("ok", { status: 200 }); }
    try {
      await handleCommand(env, parseUpdate(update));
    } catch (err) {
      console.error("handleCommand failed", err); // answer 200 anyway so Telegram does not redeliver
    }
    return new Response("ok", { status: 200 });
  },
};
