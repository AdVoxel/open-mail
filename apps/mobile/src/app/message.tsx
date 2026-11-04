import { router, useLocalSearchParams } from "expo-router";
import { Reader } from "@/src/components/Reader";

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Full-screen reader on phones. */
export default function MessageScreen() {
  const { accountId, folder, uid } = useLocalSearchParams<{ accountId: string; folder: string; uid: string }>();
  return <Reader accountId={accountId} folder={folder || "INBOX"} uid={Number(uid)} onBack={back} onClosed={back} />;
}
