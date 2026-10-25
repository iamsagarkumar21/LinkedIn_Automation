import type { PostDraft } from "./types";

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export function formatCaption(draft: PostDraft): string {
  const tags = draft.hashtags.join(" ");
  return tags ? `${draft.text}\n\n${tags}` : draft.text;
}

export function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([Buffer.from(base64, "base64")], { type: mime });
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
  const r = await fetchFn(api(botToken, "sendMessage"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
  if (!r.ok) throw new Error(`Telegram sendMessage ${r.status}: ${await r.text()}`);
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
    form.append("caption", "🖼️ Auto-image (optional preview — replace by replying with your own photo)");
    form.append("photo", base64ToBlob(draft.imageBase64, draft.imageMime), "draft.png");
    const r = await fetchFn(api(botToken, "sendPhoto"), { method: "POST", body: form });
    if (!r.ok) throw new Error(`Telegram sendPhoto ${r.status}: ${await r.text()}`);
  }
  // The prompt is the primary artifact — the owner usually generates the image
  // themselves in a better tool and uploads it via a photo reply.
  if (draft.imagePrompt) {
    await sendMessage(botToken, chatId, `🎨 Image prompt — paste into ChatGPT / Midjourney / Gemini / Sora, generate, then reply here with the photo:\n\n${draft.imagePrompt}`, fetchFn);
  }
  await sendMessage(botToken, chatId, formatCaption(draft), fetchFn, buildKeyboard(draft.id));
}

export interface ParsedCommand {
  kind: "approve" | "edit" | "regen_text" | "regen_image" | "skip" | "edit_reply" | "photo_reply" | "ignore";
  draftId?: string; chatId?: string; fromId?: string; callbackId?: string;
  messageText?: string; photoFileId?: string;
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
  if (msg) {
    const chatId = msg.chat?.id != null ? String(msg.chat.id) : undefined;
    const fromId = msg.from?.id != null ? String(msg.from.id) : undefined;
    // Photo: Telegram sends an array of sizes; pick the largest (last).
    if (Array.isArray(msg.photo) && msg.photo.length) {
      const biggest = msg.photo[msg.photo.length - 1];
      return { kind: "photo_reply", chatId, fromId, photoFileId: String(biggest.file_id) };
    }
    // Document that is an image (user may send "as file" to preserve quality).
    if (msg.document && typeof msg.document.mime_type === "string" && msg.document.mime_type.startsWith("image/")) {
      return { kind: "photo_reply", chatId, fromId, photoFileId: String(msg.document.file_id) };
    }
    if (typeof msg.text === "string") {
      return { kind: "edit_reply", messageText: msg.text, chatId, fromId };
    }
  }
  return { kind: "ignore" };
}

export interface FetchTelegramFileArgs { botToken: string; fileId: string; fetchFn?: typeof fetch; }

export async function fetchTelegramFile(args: FetchTelegramFileArgs): Promise<{ base64: string; mime: string }> {
  const fetchFn = args.fetchFn ?? globalThis.fetch;
  const meta = await fetchFn(api(args.botToken, "getFile"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: args.fileId }),
  });
  if (!meta.ok) throw new Error(`Telegram getFile ${meta.status}: ${await meta.text()}`);
  const metaJson: any = await meta.json();
  const path = metaJson?.result?.file_path;
  if (!path) throw new Error("Telegram getFile: missing file_path");
  const url = `https://api.telegram.org/file/bot${args.botToken}/${path}`;
  const file = await fetchFn(url);
  if (!file.ok) throw new Error(`Telegram file download ${file.status}`);
  const mime = file.headers.get("Content-Type") || (path.endsWith(".png") ? "image/png" : "image/jpeg");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { base64: Buffer.from(bytes).toString("base64"), mime };
}
