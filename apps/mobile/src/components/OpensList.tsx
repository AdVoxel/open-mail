import { View } from "react-native";
import type { TrackingOpen, TrackingSummary } from "@mail-app/api-client";
import { Text } from "@/components/ui/text";
import { useColors } from "@/src/lib/theme";

/** Most opens listed; the rest are counted. */
const SHOWN = 15;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The opens of a tracked message: when, from which app and system, and from which address. */
export function OpensList({ tracked }: { tracked: TrackingSummary }) {
  const colors = useColors();
  const events = tracked.events;

  if (!tracked.opens) {
    return (
      <Text size="xs" className="text-muted-foreground">
        Tracked · not opened yet
      </Text>
    );
  }
  if (!events) {
    return (
      <Text size="xs" className="text-muted-foreground">
        Opened {tracked.opens}× · update the server to see each open
      </Text>
    );
  }

  const anyProxied = events.some((e) => e.proxied);
  return (
    <View style={{ gap: 6 }}>
      <Text size="xs" className="font-semibold">
        Opened {tracked.opens}×
      </Text>
      {events.slice(0, SHOWN).map((e, i) => (
        <OpenRow key={`${e.at}-${i}`} open={e} muted={colors.muted} />
      ))}
      {events.length > SHOWN ? (
        <Text size="xs" className="text-muted-foreground">
          +{events.length - SHOWN} earlier
        </Text>
      ) : null}
      {anyProxied ? (
        <Text size="xs" className="text-muted-foreground" style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 6 }}>
          * Fetched by the mail provider: the address and system are the provider's, not the reader's. Apple's may load
          images without the message being read.
        </Text>
      ) : null}
    </View>
  );
}

function OpenRow({ open, muted }: { open: TrackingOpen; muted: string }) {
  const app = [open.client, open.device].filter(Boolean).join(" · ") + (open.proxied ? " *" : "");
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "baseline" }}>
      <Text size="xs" style={{ color: muted, minWidth: 92 }}>
        {when(open.at)}
      </Text>
      <Text size="xs" numberOfLines={1} style={{ flex: 1 }} {...(open.agent ? { title: open.agent } : {})}>
        {app}
      </Text>
      <Text size="xs" selectable style={{ color: muted, fontFamily: "monospace" }}>
        {open.ip ?? "—"}
      </Text>
    </View>
  );
}
