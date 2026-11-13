// Finding the quoted history (earlier messages) in a reply, to show only what's
// new and keep the rest behind "Show quoted text".

/** Where mail apps start the quoted part of a reply or forward. */
const QUOTE_SELECTORS = [
  ".gmail_quote_container",
  ".gmail_quote", // Gmail
  "blockquote[type='cite']", // Apple Mail, Thunderbird
  ".moz-cite-prefix", // Thunderbird's "On … wrote:"
  "#divRplyFwdMsg", // Outlook on the web
  "#appendonsend", // Outlook
  "#mail-editor-reference-message-container", // Outlook (new)
  ".yahoo_quoted", // Yahoo
  "div.quoted", // this app
  "hr#stopSpelling", // old Outlook
];

/** Outlook desktop: a "From: … Sent: …" block under a thin line (div with border-top). */
const HEADER_START = /^\s*(From|De|Von|Da|Van|Från|Fra|Od|От)\s*:/i;
/** The attribution line before a quote: "On …, X wrote:" (and a few languages). */
const ATTRIBUTION = /(wrote|escreveu|a écrit|schrieb|escribió|scrisse|schreef|написал)\s*:\s*$/i;
/** Plain "-----Original Message-----" style separators. */
const SEPARATOR = /^\s*-{3,}\s*(Original Message|Forwarded message|Mensagem original|Mensagem encaminhada|Message d'origine|Ursprüngliche Nachricht|Mensaje original)/i;

function firstInDocument(elements: Element[]): Element | null {
  let first: Element | null = null;
  for (const el of elements) {
    if (!first || first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) first = el;
  }
  return first;
}

/** Where the quoted part starts in a rendered message, if anywhere. */
function quoteStart(doc: Document): Element | null {
  const body = doc.body;
  const candidates = QUOTE_SELECTORS.flatMap((selector) => [...body.querySelectorAll(selector)]);
  for (const el of body.querySelectorAll("div[style*='border-top']")) {
    if (HEADER_START.test(el.textContent ?? "")) candidates.push(el);
  }
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (SEPARATOR.test(node.textContent ?? "") && node.parentElement) {
      candidates.push(node.parentElement);
      break;
    }
  }
  let start = firstInDocument(candidates);
  // Take the "On …, X wrote:" line before it along (Apple puts a <br> in between).
  let previous = start?.previousElementSibling;
  while (previous && (previous.tagName === "BR" || !previous.textContent?.trim())) previous = previous.previousElementSibling;
  if (start && previous && ATTRIBUTION.test(previous.textContent ?? "")) start = previous;
  return start;
}

/**
 * Hides the quoted history of a rendered message. Returns a function that shows
 * or hides it again, or null when there's nothing to fold (no quote, or nothing
 * written above it, e.g. a bare forward).
 */
export function foldQuotes(doc: Document): ((show: boolean) => void) | null {
  if (!doc.body) return null;
  const start = quoteStart(doc);
  if (!start) return null;
  const before = doc.createRange();
  before.setStart(doc.body, 0);
  before.setEndBefore(start);
  if (!before.toString().trim() && !before.cloneContents().querySelector?.("img")) return null;

  // The start and everything after it, at each level up to <body>.
  const parts: HTMLElement[] = [];
  const take = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) parts.push(node as HTMLElement);
    else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const span = doc.createElement("span"); // text can't be hidden on its own
      node.parentNode!.insertBefore(span, node);
      span.appendChild(node);
      parts.push(span);
    }
  };
  take(start);
  for (let level: Node | null = start; level && level !== doc.body; level = level.parentNode) {
    const followers: Node[] = [];
    for (let sibling = level.nextSibling; sibling; sibling = sibling.nextSibling) followers.push(sibling);
    followers.forEach(take);
  }

  const original = new Map(parts.map((el) => [el, [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")] as const]));
  const show = (visible: boolean) => {
    for (const el of parts) {
      if (visible) {
        const [value, priority] = original.get(el)!;
        if (value) el.style.setProperty("display", value, priority);
        else el.style.removeProperty("display");
      } else {
        el.style.setProperty("display", "none", "important");
      }
    }
  };
  show(false);
  return show;
}

/** Lines that start the quoted part of a plain-text message. */
const TEXT_MARKERS = [
  /^On .+ wrote:\s*$/m,
  /^(Em|Le|Am|El|Il) .+ (escreveu|a écrit|schrieb|escribió|scrisse):\s*$/m,
  /^\s*-{3,}\s*(Original Message|Forwarded message|Mensagem original|Mensagem encaminhada|Message d'origine|Ursprüngliche Nachricht|Mensaje original)/im,
  /^(From|De|Von):\s.+\r?\n(Sent|Enviado|Enviada|Gesendet|Date|Data|Envoyé):/im,
  /^>/m,
];

/** A plain-text message split into what's new and the quoted history (null: nothing to fold). */
export function splitQuotedText(text: string): { fresh: string; quoted: string } | null {
  let at = -1;
  for (const marker of TEXT_MARKERS) {
    const match = marker.exec(text);
    if (match && (at === -1 || match.index < at)) at = match.index;
  }
  if (at <= 0) return null;
  const fresh = text.slice(0, at).trimEnd();
  return fresh ? { fresh, quoted: text.slice(at) } : null;
}
