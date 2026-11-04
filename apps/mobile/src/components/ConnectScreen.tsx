import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { Server } from "lucide-react-native";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { useConnection } from "@/src/lib/connection";
import { useColors } from "@/src/lib/theme";

const inputClass = "h-11 rounded-lg border border-border bg-background px-3 text-[15px] text-foreground font-sans web:outline-none";

/** Server address + token form. Used as the first-run screen and in Settings. */
export function ServerForm({ compact = false }: { compact?: boolean }) {
  const { connection, connect, capabilities, status } = useConnection();
  const colors = useColors();
  const [url, setUrl] = useState(connection?.url ?? "");
  const [token, setToken] = useState(connection?.token ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (connection) {
      setUrl(connection.url);
      setToken(connection.token);
    }
  }, [connection]);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await connect({ url, token });
      setMessage({ ok: true, text: "Connected" });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <Text size="sm" className="font-medium">
          Server address
        </Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="http://localhost:8787"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          className={inputClass}
        />
      </View>
      <View className="gap-1.5">
        <Text size="sm" className="font-medium">
          Access token
        </Text>
        <TextInput
          value={token}
          onChangeText={setToken}
          placeholder="MAIL_APP_TOKEN from the server's .env"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          className={inputClass}
        />
      </View>
      <View className="flex-row items-center gap-3">
        <Button className="rounded-lg" disabled={busy || !url || !token} onPress={() => void submit()}>
          <ButtonText>{busy ? "Connecting…" : compact ? "Save" : "Connect"}</ButtonText>
        </Button>
        {message ? (
          <Text size="sm" className={`flex-1 ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
            {message.text}
          </Text>
        ) : compact && status === "connected" && capabilities ? (
          <Text size="sm" className="flex-1 text-muted-foreground">
            Connected · server {capabilities.version}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ConnectScreen() {
  const { status, error, retry } = useConnection();
  const colors = useColors();
  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerClassName="grow items-center justify-center p-6">
        <View className="w-full max-w-md gap-6">
          <View className="gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary">
              <Server size={22} color={colors.background} strokeWidth={1.75} />
            </View>
            <Heading size="2xl" className="font-semibold tracking-tight">
              Connect to your mail server
            </Heading>
            <Text className="text-muted-foreground">
              The app talks to your own server, which talks to Gmail, iCloud and Zoho. Start it with{" "}
              <Text className="font-mono text-sm">npm run server</Text> and use the token from its <Text className="font-mono text-sm">.env</Text>.
            </Text>
          </View>
          {status === "offline" && error ? (
            <View className="flex-row items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <Text size="sm" className="flex-1 text-destructive">
                {error}
              </Text>
              <Button size="sm" variant="ghost" onPress={retry}>
                <ButtonText>Retry</ButtonText>
              </Button>
            </View>
          ) : null}
          <ServerForm />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
