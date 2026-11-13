import { useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import type { TrackingSummary } from "@mail-app/api-client";
import { useColors } from "@/src/lib/theme";
import { OpensList } from "./OpensList";

/** Phones have no hover: tapping `children` (the views badge) shows who opened the message. */
export function OpensPopover({ tracked, children }: { tracked: TrackingSummary; children: ReactNode }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityLabel={tracked.opens ? `Opened ${tracked.opens} times` : "Tracked, not opened yet"}>
        {children}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.35)" }}>
          <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <OpensList tracked={tracked} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
