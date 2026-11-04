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
  /**
   * Whether the server leaves no copy in "Sent" when mail goes out over SMTP,
   * so we append one over IMAP ourselves. Gmail and Zoho store it already.
   */
  saveSentCopy: boolean;
  help: string;
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    saveSentCopy: false,
    help: "Use an app password: Google Account → Security → 2-Step Verification → App passwords.",
  },
  {
    id: "icloud",
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    saveSentCopy: true,
    help: "Use an app-specific password: account.apple.com → Sign-In and Security → App-Specific Passwords. If login fails, set the username to the part before the @.",
  },
  {
    id: "zoho",
    label: "Zoho",
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    saveSentCopy: false,
    help: "Enable IMAP in Zoho Mail settings, then create an app password. EU accounts: use Zoho (EU).",
  },
  {
    id: "zoho-eu",
    label: "Zoho (EU)",
    imap: { host: "imap.zoho.eu", port: 993, secure: true },
    smtp: { host: "smtp.zoho.eu", port: 465, secure: true },
    saveSentCopy: false,
    help: "Enable IMAP in Zoho Mail settings, then create an app password.",
  },
];

export const GMAIL_PRESET = MAIL_PRESETS[0]!;
