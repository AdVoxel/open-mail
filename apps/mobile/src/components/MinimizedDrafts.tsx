import { View } from "react-native";
import { router, usePathname } from "expo-router";
import { Maximize2, X } from "lucide-react-native";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useDrafts, type MinimizedDraft } from "@/src/lib/drafts";
import { useIsWide } from "@/src/lib/format";
import { useColors } from "@/src/lib/theme";
import { useConfirm } from "./kit";

/** Minimized compose windows: bars along the bottom of the screen that reopen the draft. */
export function MinimizedDrafts() {
  const { drafts, remove } = useDrafts();
  const confirm = useConfirm();
  const colors = useColors();
  const isWide = useIsWide();
  const pathname = usePathname();

  // On phones the bars would sit on top of the editor.
  if (!drafts.length || (!isWide && pathname === "/compose")) return null;

  const open = (draft: MinimizedDraft) => router.push({ pathname: "/compose", params: { ...draft.params, draft: draft.id } });
  const discard = async (draft: MinimizedDraft) => {
    const ok = await confirm({ title: "Discard this draft?", message: draft.subject || undefined, confirmLabel: "Discard", destructive: true });
    if (ok) remove(draft.id);
  };

  return (
    <View pointerEvents="box-none" className="absolute bottom-0 right-4 flex-row-reverse items-end gap-2" style={{ left: isWide ? 264 : 16 }}>
      {drafts.map((draft) => (
        <View
          key={draft.id}
          style={{ width: isWide ? 280 : undefined, flexShrink: 1, minWidth: 160 }}
          className="flex-row items-center rounded-t-lg bg-foreground pl-3 shadow-hard-2"
        >
          <Pressable onPress={() => open(draft)} accessibilityLabel={`Open draft ${draft.subject || "New message"}`} className="h-10 min-w-0 flex-1 justify-center">
            <Text size="sm" numberOfLines={1} className="font-medium text-background">
              {draft.subject || (draft.params.mode === "forward" ? "Forward" : draft.params.mode?.startsWith("reply") ? "Reply" : "New message")}
            </Text>
          </Pressable>
          <Pressable onPress={() => open(draft)} accessibilityLabel="Open" className="h-10 w-9 items-center justify-center">
            <Maximize2 size={15} color={colors.background} />
          </Pressable>
          <Pressable onPress={() => void discard(draft)} accessibilityLabel="Discard draft" className="h-10 w-9 items-center justify-center">
            <X size={16} color={colors.background} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
