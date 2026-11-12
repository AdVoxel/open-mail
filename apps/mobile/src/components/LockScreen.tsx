import { useState } from "react";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { Lock } from "lucide-react-native";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApi } from "@/src/lib/connection";
import { useLock } from "@/src/lib/lock";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { ColorDot, Loading } from "./kit";

const inputClass = "h-11 rounded-lg border border-border bg-background px-3 text-[15px] text-foreground font-sans web:outline-none";

/** Covers the whole app while it's locked. */
export function LockScreen() {
  const { ready, locked } = useLock();
  if (ready && !locked) return null;
  return (
    <View className="absolute inset-0 z-50 bg-background">
      {ready ? <LockForm /> : <Loading />}
    </View>
  );
}

function LockForm() {
  const api = useApi();
  const colors = useColors();
  const { unlock, unlockAfterReset } = useLock();
  const { accounts } = useMail();
  const [step, setStep] = useState<"unlock" | "forgot" | "reset">("unlock");
  const [password, setPassword] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitUnlock = () =>
    run(async () => {
      await unlock(password);
      setPassword("");
    });

  const sendCode = () =>
    run(async () => {
      const { sentTo } = await api.requestLockReset(accountId);
      setSentTo(sentTo);
      setStep("reset");
    });

  const submitReset = () =>
    run(async () => {
      if (newPassword !== confirm) throw new Error("The passwords don't match");
      await api.confirmLockReset(code, newPassword);
      unlockAfterReset();
    });

  return (
    <KeyboardAvoidingView className="flex-1 items-center justify-center p-6" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="w-full max-w-sm gap-4">
        <View className="items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary">
            <Lock size={22} color={colors.background} strokeWidth={1.75} />
          </View>
          <Heading size="xl" className="font-semibold tracking-tight">
            {step === "unlock" ? "Mail is locked" : "Reset the password"}
          </Heading>
        </View>

        {step === "unlock" ? (
          <>
            <TextInput
              autoFocus
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submitUnlock()}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={colors.muted}
              className={inputClass}
            />
            <Button className="rounded-lg" disabled={busy || !password} onPress={() => void submitUnlock()}>
              <ButtonText>{busy ? "Checking…" : "Unlock"}</ButtonText>
            </Button>
            <Pressable onPress={() => (setStep("forgot"), setError(null))} className="items-center py-1">
              <Text size="sm" className="text-muted-foreground underline">
                Forgot the password?
              </Text>
            </Pressable>
          </>
        ) : step === "forgot" ? (
          <>
            <Text size="sm" className="text-muted-foreground">
              We'll email a code to one of your accounts. Pick which one:
            </Text>
            <View className="gap-1.5">
              {accounts.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  className={`flex-row items-center gap-2 rounded-lg border px-3 py-2 ${a.id === accountId ? "border-primary bg-accent" : "border-border data-[hover=true]:bg-accent/50"}`}
                >
                  <ColorDot color={a.color} />
                  <Text size="sm" className="flex-1">
                    {a.address}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button className="rounded-lg" disabled={busy || !accountId} onPress={() => void sendCode()}>
              <ButtonText>{busy ? "Sending…" : "Send the code"}</ButtonText>
            </Button>
            <Pressable onPress={() => (setStep("unlock"), setError(null))} className="items-center py-1">
              <Text size="sm" className="text-muted-foreground underline">
                Back
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text size="sm" className="text-muted-foreground">
              A code is on its way to {sentTo}. It works for 15 minutes.
            </Text>
            <TextInput
              autoFocus
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              className={inputClass}
            />
            <TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="New password" placeholderTextColor={colors.muted} className={inputClass} />
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={() => void submitReset()}
              secureTextEntry
              placeholder="New password again"
              placeholderTextColor={colors.muted}
              className={inputClass}
            />
            <Button className="rounded-lg" disabled={busy || !code || !newPassword} onPress={() => void submitReset()}>
              <ButtonText>{busy ? "Saving…" : "Set the password and unlock"}</ButtonText>
            </Button>
            <Pressable onPress={() => (setStep("forgot"), setError(null))} className="items-center py-1">
              <Text size="sm" className="text-muted-foreground underline">
                Send another code
              </Text>
            </Pressable>
          </>
        )}

        {error ? (
          <Text size="sm" className="text-center text-destructive">
            {error}
          </Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
