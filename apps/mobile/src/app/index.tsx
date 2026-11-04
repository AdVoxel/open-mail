import { useCallback } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { MailOpen } from "lucide-react-native";
import { messageKey, type MessageHeader } from "@mail-app/api-client";
import { EmptyState } from "@/src/components/kit";
import { MessageList } from "@/src/components/MessageList";
import { Reader } from "@/src/components/Reader";
import { useIsWide } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";

/** Message list; on wide screens with the reader beside it. */
export default function InboxScreen() {
  const isWide = useIsWide();
  const { list, selectedKey, setSelectedKey } = useMail();
  const selected = list.messages.find((m) => messageKey(m) === selectedKey);

  const open = useCallback(
    (m: MessageHeader) => {
      if (isWide) setSelectedKey(messageKey(m));
      else router.push({ pathname: "/message", params: { accountId: m.accountId, folder: m.folder, uid: String(m.uid) } });
    },
    [isWide, setSelectedKey],
  );

  if (!isWide) return <MessageList onOpen={open} isWide={false} />;

  return (
    <View className="flex-1 flex-row">
      <View style={{ width: 380 }} className="border-r border-border">
        <MessageList onOpen={open} isWide />
      </View>
      <View className="flex-1">
        {selected ? (
          <Reader
            key={selectedKey}
            accountId={selected.accountId}
            folder={selected.folder}
            uid={selected.uid}
            onClosed={() => setSelectedKey(null)}
          />
        ) : (
          <EmptyState icon={MailOpen} title="No message selected" message="Pick a message from the list to read it." />
        )}
      </View>
    </View>
  );
}
