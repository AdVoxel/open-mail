import { useEffect, useRef, useState } from "react";
import type { MailMessage } from "@mail-app/api-client";
import { View } from "react-native";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { blockContextMenu } from "@/src/lib/contextMenu";
import { foldQuotes, splitQuotedText } from "@/src/lib/quotes";

const BASE_STYLE = `
  <base target="_blank">
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font: 14px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 4px 2px; overflow-wrap: anywhere; }
    /* The frame is sized to the body, so the body must be only as tall as its content (floats included). */
    html, body { height: auto !important; min-height: 0 !important; }
    body { display: flow-root; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre { white-space: pre-wrap; }
    /* Quoted history, when shown: a clear line between the earlier messages. */
    blockquote[type="cite"], blockquote.gmail_quote { margin: 8px 0 !important; padding: 0 0 0 12px !important; border-left: 3px solid #d4d4d4 !important; color: #444; }
    div[style*="border-top"][style*="padding:3.0pt"], div[style*="border-top"][style*="padding: 3pt"] {
      border-top: 2px solid #c8c8c8 !important; margin-top: 18px !important; padding-top: 10px !important;
    }
    #divRplyFwdMsg, #appendonsend + hr, hr#stopSpelling { margin-top: 18px !important; }
  </style>`;

/**
 * "Show quoted text" / "Hide quoted text". It floats at the bottom of the
 * screen while you scroll through the message, so it's always at hand.
 */
function QuoteToggle({ shown, onPress }: { shown: boolean; onPress: () => void }) {
  return (
    <div style={{ position: "sticky", bottom: 12, zIndex: 2, display: "flex", marginTop: 8, pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>
        <Pressable
          onPress={onPress}
          className="rounded-full border border-border bg-background px-3 py-1 shadow-hard-2 data-[hover=true]:bg-accent"
        >
          <Text size="xs" className="font-medium text-muted-foreground">
            {shown ? "Hide quoted text" : "••• Show quoted text"}
          </Text>
        </Pressable>
      </div>
    </div>
  );
}

/**
 * How tall the message's content is. Not the document's scrollHeight: that is
 * never less than the frame itself, so the frame could grow but never shrink
 * (hiding quoted text left it big).
 */
function contentHeight(frame: HTMLIFrameElement): number {
  const body = frame.contentDocument?.body;
  if (!body) return 80;
  const style = frame.contentWindow?.getComputedStyle(body);
  const margins = style ? (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0) : 0;
  return Math.max(80, Math.ceil(body.getBoundingClientRect().height + margins));
}

/**
 * HTML mail in a sandboxed iframe: scripts never run, links open in the
 * system browser. `allow-same-origin` (without scripts) only lets us measure
 * the content height so the reader scrolls as one page.
 */
export function MessageBody({ message }: { message: MailMessage }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  // The earlier messages a reply quotes are folded away until asked for.
  const fold = useRef<((show: boolean) => void) | null>(null);
  const [hasQuote, setHasQuote] = useState(false);
  const [quoteShown, setQuoteShown] = useState(false);

  useEffect(() => {
    const frame = ref.current;
    if (!frame || !message.html) return;
    let observer: ResizeObserver | undefined;
    const measure = () => setHeight(contentHeight(frame));
    const onLoad = () => {
      const doc = frame.contentDocument;
      fold.current = doc ? foldQuotes(doc) : null;
      setHasQuote(Boolean(fold.current));
      setQuoteShown(false);
      measure();
      // Events inside the message don't reach the app's own listener.
      frame.contentDocument?.addEventListener("contextmenu", blockContextMenu);
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [message.html]);

  const toggleQuote = () => {
    const next = !quoteShown;
    fold.current?.(next);
    setQuoteShown(next);
    if (ref.current) setHeight(contentHeight(ref.current));
  };

  if (!message.html) {
    const split = splitQuotedText(message.text);
    return (
      <View>
        <Text selectable className="text-[15px] leading-6 text-foreground">
          {(split && !quoteShown ? split.fresh : message.text) || "(empty message)"}
        </Text>
        {split ? <QuoteToggle shown={quoteShown} onPress={() => setQuoteShown((s) => !s)} /> : null}
      </View>
    );
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(127,127,127,0.18)" }}>
      <iframe
        ref={ref}
        title="Message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={BASE_STYLE + message.html}
        style={{ width: "100%", height, border: 0, display: "block", background: "#fff" }}
      />
      {hasQuote ? <QuoteToggle shown={quoteShown} onPress={toggleQuote} /> : null}
    </div>
  );
}
