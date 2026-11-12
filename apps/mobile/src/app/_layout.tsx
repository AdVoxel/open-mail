import "@/globals.css";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Lock, Mail } from "lucide-react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import { Text } from "@/components/ui/text";
import { ConnectScreen } from "@/src/components/ConnectScreen";
import { ConfirmProvider, IconButton, Loading } from "@/src/components/kit";
import { MailboxNav } from "@/src/components/MailboxNav";
import { LockScreen } from "@/src/components/LockScreen";
import { MinimizedDrafts } from "@/src/components/MinimizedDrafts";
import { ConnectionProvider, useConnection } from "@/src/lib/connection";
import { DraftsProvider } from "@/src/lib/drafts";
import { LockProvider, useLock } from "@/src/lib/lock";
import { blockContextMenu } from "@/src/lib/contextMenu";
import { useIsWide } from "@/src/lib/format";
import { MailProvider } from "@/src/lib/mail";
import { NotificationsProvider } from "@/src/lib/notifications";
import { ThemeModeProvider, useColors } from "@/src/lib/theme";

function Screens() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="message" />
      <Stack.Screen name="mailboxes" options={{ animation: "slide_from_left" }} />
      <Stack.Screen name="compose" options={{ animation: "slide_from_bottom" }} />
      <Stack.Screen name="scheduled" />
      <Stack.Screen name="calendar" />
      <Stack.Screen name="event" options={{ animation: "slide_from_bottom" }} />
      <Stack.Screen name="settings" />
    </Stack>
  );
}

/** Wide screens (desktop, tablets): a fixed sidebar next to the screens. */
function Sidebar() {
  const colors = useColors();
  const lock = useLock();
  return (
    <View style={{ width: 248, backgroundColor: colors.surface }} className="border-r border-border">
      <View className="h-14 flex-row items-center gap-2.5 border-b border-border px-5">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Mail size={15} color={colors.background} strokeWidth={2} />
        </View>
        <Text className="flex-1 font-semibold tracking-tight">Mail</Text>
        {lock.enabled ? <IconButton icon={Lock} size={16} label="Lock now" onPress={lock.lock} /> : null}
      </View>
      <MailboxNav />
    </View>
  );
}

function Shell() {
  const { status } = useConnection();
  const isWide = useIsWide();

  if (status === "loading") return <Loading label="Connecting…" />;
  if (status !== "connected") return <ConnectScreen />;

  return (
    <MailProvider>
      <LockProvider>
      <NotificationsProvider>
        <DraftsProvider>
          {isWide ? (
            <View className="flex-1 flex-row bg-background">
              <Sidebar />
              <View className="flex-1">
                <Screens />
              </View>
            </View>
          ) : (
            <Screens />
          )}
          <MinimizedDrafts />
        </DraftsProvider>
      </NotificationsProvider>
      <LockScreen />
      </LockProvider>
    </MailProvider>
  );
}

function ThemedStatusBar() {
  const { dark } = useColors();
  return <StatusBar style={dark ? "light" : "dark"} />;
}

export default function RootLayout() {
  // Web and desktop: no browser right-click menu over the app.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    document.addEventListener("contextmenu", blockContextMenu);
    return () => document.removeEventListener("contextmenu", blockContextMenu);
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeModeProvider>
        {(mode) => (
          <GluestackUIProvider mode={mode}>
            <ThemedStatusBar />
            <ConnectionProvider>
              <ConfirmProvider>
                <View className="flex-1 bg-background">
                  <Shell />
                </View>
              </ConfirmProvider>
            </ConnectionProvider>
          </GluestackUIProvider>
        )}
      </ThemeModeProvider>
    </SafeAreaProvider>
  );
}
