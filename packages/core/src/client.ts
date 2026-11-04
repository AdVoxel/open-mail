import Anthropic from "@anthropic-ai/sdk";
import type { AiRoute } from "./presets.js";

/** An AI route plus its API key (when it isn't taken from the environment). */
export interface AiSettings {
  route: AiRoute;
  apiKey?: string;
}

const claudeClients = new Map<string, Anthropic>();

/** Without an explicit key, reads ANTHROPIC_API_KEY or an `ant auth login` profile. */
export function claudeClient(apiKey?: string): Anthropic {
  const cacheKey = apiKey ?? "";
  let client = claudeClients.get(cacheKey);
  if (!client) {
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    claudeClients.set(cacheKey, client);
  }
  return client;
}

export interface Email {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string; // plain text — strip HTML before passing it in
}

export function formatEmail(email: Email): string {
  return [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Date: ${email.date}`,
    `Subject: ${email.subject}`,
    "",
    email.body,
  ].join("\n");
}

export class RefusalError extends Error {
  constructor(public category: string | null | undefined) {
    super(`Model declined the request (category: ${category ?? "unknown"})`);
  }
}
