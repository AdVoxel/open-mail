// Pure data (no Node imports) so the desktop and mobile UIs can import it too.

export interface HostConfig {
  host: string;
  port: number;
  secure: boolean; // true = SSL/TLS from the start, false = STARTTLS
}

export interface MailPreset {
  id: string;
  label: string;
  imap: HostConfig;
  smtp: HostConfig;
  help: string;
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    help: "Use an app password: Google Account → Security → 2-Step Verification → App passwords.",
  },
  {
    id: "icloud",
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    help: "Use an app-specific password: account.apple.com → Sign-In and Security → App-Specific Passwords.",
  },
  {
    id: "zoho",
    label: "Zoho",
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    help: "Enable IMAP in Zoho Mail settings, then create an app password. EU accounts: use the Zoho (EU) preset.",
  },
  {
    id: "zoho-eu",
    label: "Zoho (EU)",
    imap: { host: "imap.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
    help: "Enable IMAP in Zoho Mail settings, then create an app password.",
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    help: "Microsoft may require modern auth for some accounts; app passwords work where enabled.",
  },
];

export const GMAIL_PRESET = MAIL_PRESETS[0]!;

export type AiProvider = "anthropic" | "openai-compatible";

/** Which AI engine handles a job (triage or drafting). */
export interface AiRoute {
  provider: AiProvider;
  model: string;
  baseUrl?: string; // openai-compatible only, e.g. https://api.openai.com/v1
}

export interface AiPreset {
  id: string;
  label: string;
  provider: AiProvider;
  baseUrl?: string;
  needsKey: boolean;
  /** Suggestions only: provider model lists change, so the field stays editable. */
  modelHint: string;
}

export const AI_PRESETS: AiPreset[] = [
  { id: "anthropic", label: "Claude (Anthropic)", provider: "anthropic", needsKey: true, modelHint: "claude-haiku-5-5" },
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    modelHint: "a model id from platform.openai.com/docs/models",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    modelHint: "a model id from ai.google.dev/gemini-api/docs/models",
  },
  {
    id: "ollama",
    label: "Ollama (local, free)",
    provider: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    modelHint: "a model you've pulled, e.g. from `ollama list`",
  },
  {
    id: "custom",
    label: "Other OpenAI-compatible API",
    provider: "openai-compatible",
    needsKey: true,
    modelHint: "model id",
  },
];

/** Claude models offered in settings (all support effort + structured outputs). */
export const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

export const DEFAULT_TRIAGE_ROUTE: AiRoute = { provider: "anthropic", model: "claude-haiku-5-5" };
export const DEFAULT_DRAFT_ROUTE: AiRoute = { provider: "anthropic", model: "claude-sonnet-5-5" };
