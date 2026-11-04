import { useEffect, useRef, useState } from "react";
import type { MailMessage } from "@mail-app/api-client";
import { Text } from "@/components/ui/text";

const BASE_STYLE = `
  <base target="_blank">
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font: 14px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 4px 2px; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre { white-space: pre-wrap; }
  </style>`;

/**
 * HTML mail in a sandboxed iframe: scripts never run, links open in the
 * system browser. `allow-same-origin` (without scripts) only lets us measure
 * the content height so the reader scrolls as one page.
 */
export function MessageBody({ message }: { message: MailMessage }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const frame = ref.current;
    if (!frame || !message.html) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.documentElement) setHeight(Math.max(80, doc.documentElement.scrollHeight));
    };
    const onLoad = () => {
      measure();
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

  if (!message.html) {
    return (
      <Text selectable className="text-[15px] leading-6 text-foreground">
        {message.text || "(empty message)"}
      </Text>
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
    </div>
  );
}
