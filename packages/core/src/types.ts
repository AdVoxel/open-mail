// Shapes shared by the server and the apps. Types only: no Node imports.
import type { HostConfig } from "./presets.js";

export type AccountId = string;
export type AuthType = "password" | "google";

export interface Address {
  name: string;
  address: string;
}

export interface AccountInfo {
  id: AccountId;
  label: string;
  address: string;
  /** Display name used in the From header. */
  name: string;
  /** "env" accounts come from .env and can't be edited or removed from the apps. */
  source: "env" | "app";
  authType: AuthType;
  saveSentCopy: boolean;
  imapHost: string;
}

/** A password-based account from the Add Account form (custom servers or a preset). */
export interface AccountInput {
  label?: string;
  name?: string;
  address: string;
  user?: string; // defaults to the address
  password: string;
  imap: HostConfig;
  smtp: HostConfig;
  saveSentCopy?: boolean;
}

export interface AccountUpdate {
  label?: string;
  name?: string;
  saveSentCopy?: boolean;
}

/** IMAP special-use roles we care about. */
export type FolderRole = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | "all" | "flagged";

export interface Folder {
  path: string;
  name: string;
  role: FolderRole | null;
  total: number | null;
  unread: number | null;
}

export interface MessageHeader {
  accountId: AccountId;
  folder: string;
  uid: number;
  messageId?: string;
  from: Address;
  to: Address[];
  subject: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  size: number;
}

export interface MessagePage {
  messages: MessageHeader[];
  /** Total matching messages (folder size, or number of search hits). */
  total: number;
  /** Per-account failures when listing several accounts at once. */
  errors?: { accountId: AccountId; error: string }[];
}

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface MailMessage extends MessageHeader {
  cc: Address[];
  replyTo: Address[];
  references: string[];
  text: string;
  html: string | null;
  attachments: AttachmentInfo[];
}

export interface OutgoingAttachment {
  filename: string;
  contentType?: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface OutgoingMail {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}

export type ScheduleStatus = "pending" | "sending" | "sent" | "failed";

export interface ScheduledMail extends OutgoingMail {
  id: string;
  accountId: AccountId;
  /** ISO timestamp. */
  sendAt: string;
  status: ScheduleStatus;
  attempts: number;
  /** When a failed attempt will be retried. */
  retryAt?: string;
  error?: string;
  sentAt?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendResult {
  messageId: string;
}
