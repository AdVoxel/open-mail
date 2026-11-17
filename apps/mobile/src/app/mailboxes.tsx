import { View } from "react-native";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import { Header, IconButton } from "@/src/components/kit";
import { MailboxNav } from "@/src/components/MailboxNav";
import { useColors } from "@/src/lib/theme";

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Accounts and folders on phones (the sidebar on wide screens). */
export default function MailboxesScreen() {
  const colors = useColors();
  return (
    // The phone's drawer: the sidebar color.
    <View className="flex-1" style={{ backgroundColor: colors.surface }}>
      <Header safeTop background={colors.surface} title="Mailboxes" left={<IconButton icon={X} label="Close" onPress={back} />} />
      <MailboxNav onDone={back} />
    </View>
  );
}
