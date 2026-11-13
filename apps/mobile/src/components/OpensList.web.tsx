import type { CSSProperties } from "react";
import type { TrackingOpen, TrackingSummary } from "@mail-app/api-client";
import { useColors } from "@/src/lib/theme";

/** Most opens listed; the rest are counted. */
const SHOWN = 15;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * The opens of a tracked message as a compact table: when · app · address.
 * Plain DOM with its own styles: it's drawn in a portal on <body>, outside the
 * app's theme, where the app's Text components lose their colors and sizes.
 */
export function OpensList({ tracked }: { tracked: TrackingSummary }) {
  const colors = useColors();
  const base: CSSProperties = {
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize: 12,
    lineHeight: "18px",
    color: colors.foreground,
  };
  const muted: CSSProperties = { color: colors.muted };
  const events = tracked.events;

  if (!tracked.opens || !events) {
    return (
      <div style={{ ...base, ...muted }}>
        {!tracked.opens ? "Tracked · not opened yet" : `Opened ${tracked.opens}× · update the server to see each open`}
      </div>
    );
  }

  const anyProxied = events.some((e) => e.proxied);
  return (
    <div style={base}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Opened {tracked.opens}×</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 14, rowGap: 4, alignItems: "baseline" }}>
        {events.slice(0, SHOWN).map((e, i) => (
          <Row key={`${e.at}-${i}`} open={e} muted={muted} />
        ))}
      </div>
      {events.length > SHOWN ? <div style={{ ...muted, marginTop: 6 }}>+{events.length - SHOWN} earlier</div> : null}
      {anyProxied ? (
        <div style={{ ...muted, fontSize: 11, lineHeight: "16px", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
          * Fetched by the mail provider: the address and system are the provider's, not the reader's. Apple's may load
          images without the message being read.
        </div>
      ) : null}
    </div>
  );
}

function Row({ open, muted }: { open: TrackingOpen; muted: CSSProperties }) {
  const app = [open.client, open.device].filter(Boolean).join(" · ") + (open.proxied ? " *" : "");
  return (
    <>
      <span style={{ ...muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{when(open.at)}</span>
      <span title={open.agent} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {app}
      </span>
      <span style={{ ...muted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 11, whiteSpace: "nowrap", userSelect: "text" }}>
        {open.ip ?? "—"}
      </span>
    </>
  );
}
