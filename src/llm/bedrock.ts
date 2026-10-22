import { AwsClient } from "aws4fetch";
import type { Env } from "../types";

export interface BedrockOpts {
  env: Env; system: string; user: string;
  maxTokens?: number; temperature?: number; signedFetch?: typeof fetch;
}

export async function bedrockClaude(opts: BedrockOpts): Promise<string> {
  const { env } = opts;
  const url = `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com/model/${encodeURIComponent(env.BEDROCK_MODEL_ID)}/invoke`;
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.8,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  let res: Response;
  if (opts.signedFetch) {
    res = await opts.signedFetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  } else {
    const aws = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region: env.AWS_REGION,
      service: "bedrock",
    });
    res = await aws.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  }
  if (!res.ok) throw new Error(`Bedrock error ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  const text = (j?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("").trim();
  if (!text) throw new Error("Bedrock returned empty content");
  return text;
}
