// Adds an account's HTML signature to outgoing mail. Pure functions, no Node imports.
import type { OutgoingMail } from "./types.js";

/** Where quoted text starts in a reply or forward drafted by the apps (see replyDraft/forwardDraft). */
const QUOTE_START = /^(On .+ wrote:|-{5,} Forwarded message -{5,})$/m;
/** The same in HTML written by the apps' editor (see draftToHtml). */
const HTML_QUOTE_START = '<div class="quoted"';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text rendering of plain text, for the HTML part. */
function textToHtml(text: string): string {
  return `<div style="white-space: pre-wrap">${escapeHtml(text)}</div>`;
}

/** Whether a draft still has the quoted message of a reply or forward. */
export function hasQuote(html: string | null, text: string): boolean {
  return Boolean(html?.includes(HTML_QUOTE_START)) || QUOTE_START.test(text);
}

/** A draft without the quoted message (what you wrote stays). */
export function stripQuote(html: string | null, text: string): { html: string | null; text: string } {
  const at = text.search(QUOTE_START);
  const quoteAt = html?.indexOf(HTML_QUOTE_START) ?? -1;
  return {
    html: html && quoteAt !== -1 ? html.slice(0, quoteAt).replace(/(<div><br><\/div>)+$/, "") : html,
    text: at === -1 ? text : text.slice(0, at).trimEnd(),
  };
}

/**
 * A draft's plain text (as replyDraft/forwardDraft write it) as editor HTML:
 * what's written as paragraphs, the quoted part in a `div.quoted` (in italics,
 * also in the mail sent), replies' "> " lines as a blockquote.
 */
export function draftToHtml(text: string): string {
  const lines = (part: string) => part.split("\n").map((line) => escapeHtml(line) || "<br>");
  const at = text.search(QUOTE_START);
  const written = at === -1 ? text : text.slice(0, at);
  const html = lines(written.replace(/\n+$/, "")).map((line) => `<div>${line}</div>`).join("");
  if (at === -1) return html;

  const [intro, ...rest] = text.slice(at).split("\n");
  const isReply = rest.every((line) => line.startsWith(">") || !line.trim());
  const inline = (part: string) => part.split("\n").map(escapeHtml).join("<br>");
  const body = isReply
    ? `<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex">${inline(rest.map((l) => l.replace(/^> ?/, "")).join("\n"))}</blockquote>`
    : `<div>${inline(rest.join("\n"))}</div>`;
  return `${html || "<div><br></div>"}<div><br></div><div class="quoted" style="font-style:italic"><div>${escapeHtml(intro ?? "")}</div>${body}</div>`;
}

/** A readable plain-text version of an HTML signature. */
export function signatureText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<a\s[^>]*href="(?:mailto:)?([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return !text || text === href || href.endsWith(`//${text}`) ? href : `${text} (${href})`;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The mail with the signature after what was written and before any quoted
 * reply or forwarded message. Sends an HTML part so the signature keeps its
 * formatting, with a plain-text fallback.
 */
export function applySignature(mail: OutgoingMail, signatureHtml: string, position: "before-quote" | "end" = "before-quote"): OutgoingMail {
  const html = signatureHtml.trim();
  if (!html) return mail;
  if (position === "end") {
    const text = [mail.text.trimEnd(), `-- \n${signatureText(html)}`].filter(Boolean).join("\n\n");
    const body = mail.html ?? textToHtml(mail.text);
    return { ...mail, text, html: `${body}<br><div class="signature">${html}</div>` };
  }
  const at = mail.text.search(QUOTE_START);
  const written = (at === -1 ? mail.text : mail.text.slice(0, at)).trimEnd();
  const quoted = at === -1 ? "" : mail.text.slice(at);

  const text = [written, `-- \n${signatureText(html)}`, quoted].filter(Boolean).join("\n\n");
  const signatureBlock = `<div class="signature">${html}</div>`;
  let htmlBody: string;
  if (mail.html) {
    const quoteAt = mail.html.indexOf(HTML_QUOTE_START);
    htmlBody =
      quoteAt === -1
        ? `${mail.html}<br>${signatureBlock}`
        : `${mail.html.slice(0, quoteAt)}<br>${signatureBlock}<br>${mail.html.slice(quoteAt)}`;
  } else {
    htmlBody = [written && textToHtml(written), signatureBlock, quoted && `<br>${textToHtml(quoted)}`].filter(Boolean).join("<br>");
  }
  return { ...mail, text, html: htmlBody };
}
