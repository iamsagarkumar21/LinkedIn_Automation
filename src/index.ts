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
  if (cmd.chatId !== env.TELEGRAM_CHAT_ID) return;
  if (cmd.fromId !== env.TELEGRAM_CHAT_ID) return;
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
    if (cmd.draftId && cmd.draftId !== d.id) {
      await sendMessage(token, chat, "⚠️ That draft is outdated. Use the buttons on the latest draft.", fetchFn);
      return;
    }
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
