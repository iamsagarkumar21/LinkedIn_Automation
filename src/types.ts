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
