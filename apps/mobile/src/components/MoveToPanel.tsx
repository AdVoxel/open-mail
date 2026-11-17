import { useEffect } from "react";
import { View } from "react-native";
import { Folder as FolderIcon } from "lucide-react-native";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

/**
 * The account's folders as buttons, to move messages there. `current` (the
 * folder they're in) is left out. Messages of several accounts can't share one.
 */
export function MoveToPanel({
  accountId,
  current,
  onPick,
}: {
  /** null: the messages belong to different accounts. */
  accountId: string | null;
  current?: string;
  onPick: (path: string, name: string) => void;
}) {
  const colors = useColors();
  const { folders, loadFolders } = useMail();
  // Phones don't show the sidebar, which loads the folders: load them here when needed.
  useEffect(() => {
    if (accountId && !folders[accountId]) void loadFolders(accountId);
  }, [accountId, folders, loadFolders]);
  const list = accountId ? (folders[accountId] ?? []).filter((f) => f.path !== current) : [];
  return (
    <View className="gap-2 border-b border-border px-4 py-3">
      <Text size="xs" className="font-semibold uppercase tracking-wider text-muted-foreground">
        Move to
      </Text>
      {accountId === null ? (
        <Text size="sm" className="text-muted-foreground">
          These messages are in different accounts: select messages of one account to move them.
        </Text>
      ) : list.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {list.map((f) => (
            <Pressable
              key={f.path}
              onPress={() => onPick(f.path, f.name)}
              className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1 data-[hover=true]:bg-accent"
            >
              <FolderIcon size={13} color={colors.muted} />
              <Text size="sm">{f.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text size="sm" className="text-muted-foreground">
          No other folders.
        </Text>
      )}
    </View>
  );
}
