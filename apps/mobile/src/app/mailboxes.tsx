import { View } from "react-native";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import { Header, IconButton } from "@/src/components/kit";
import { MailboxNav } from "@/src/components/MailboxNav";

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Accounts and folders on phones (the sidebar on wide screens). */
export default function MailboxesScreen() {
  return (
    <View className="flex-1 bg-background">
      <Header safeTop title="Mailboxes" left={<IconButton icon={X} label="Close" onPress={back} />} />
      <MailboxNav onDone={back} />
    </View>
  );
}
