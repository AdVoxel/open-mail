import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";
import { MAIL_PRESETS, type AccountInfo, type AccountInput, type HostConfig } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { ServerForm } from "@/src/components/ConnectScreen";
import { Card, Header, IconButton, Initials, SectionTitle, Segmented, useConfirm, useNotify } from "@/src/components/kit";
import { useApi, useConnection } from "@/src/lib/connection";
import { useIsWide } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";
import { useColors, useThemeMode } from "@/src/lib/theme";

const inputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  secure,
  keyboardType,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: "email-address" | "number-pad";
  className?: string;
}) {
  const colors = useColors();
  return (
    <View className={`gap-1.5 ${className}`}>
      <Text size="sm" className="font-medium">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        className={inputClass}
      />
    </View>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-1">
        <Text size="sm" className="font-medium">
          {label}
        </Text>
        {hint ? (
          <Text size="xs" className="text-muted-foreground">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} size="sm" />
    </View>
  );
}

function providerName(account: AccountInfo): string {
  return MAIL_PRESETS.find((p) => p.imap.host === account.imapHost)?.label ?? account.imapHost;
}

// ------------------------------------------------------------- accounts

function AccountRow({ account, last }: { account: AccountInfo; last: boolean }) {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const { reloadAccounts } = useMail();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(account.label);
  const [name, setName] = useState(account.name);
  const [saveSentCopy, setSaveSentCopy] = useState(account.saveSentCopy);
  const [busy, setBusy] = useState(false);
  const editable = account.source === "app";

  async function save() {
    setBusy(true);
    try {
      await api.updateAccount(account.id, { label: label.trim() || account.address, name: name.trim(), saveSentCopy });
      await reloadAccounts();
      notify("Account updated");
      setOpen(false);
    } catch (e) {
      notify("Couldn't update the account", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove ${account.label}?`,
      message: "The server forgets this account and its password. Your mail stays with the provider.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.removeAccount(account.id);
      await reloadAccounts();
      notify("Account removed");
    } catch (e) {
      notify("Couldn't remove the account", (e as Error).message, "error");
    }
  }

  return (
    <View className={last ? "" : "border-b border-border/70"}>
      <Pressable onPress={() => editable && setOpen((o) => !o)} className="flex-row items-center gap-3 px-4 py-3 data-[hover=true]:bg-accent/50">
        <Initials name={account.label} size={36} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-medium">
            {account.label}
          </Text>
          <Text size="sm" numberOfLines={1} className="text-muted-foreground">
            {account.address} · {providerName(account)}
            {account.source === "env" ? " · from .env" : ""}
          </Text>
        </View>
        {editable ? <IconButton icon={open ? ChevronUp : ChevronDown} label="Edit" onPress={() => setOpen((o) => !o)} /> : null}
        {editable ? <IconButton icon={Trash2} label="Remove" onPress={() => void remove()} /> : null}
      </Pressable>
      {open ? (
        <View className="gap-3 px-4 pb-4">
          <View className="flex-row flex-wrap gap-3">
            <LabeledInput label="Label" value={label} onChange={setLabel} className="min-w-[200px] flex-1" />
            <LabeledInput label="Sender name" value={name} onChange={setName} placeholder="Shown in the From field" className="min-w-[200px] flex-1" />
          </View>
          <ToggleRow
            label="Save a copy in Sent"
            hint="Turn on if sent mail doesn't appear in this account's Sent folder (needed for iCloud)."
            value={saveSentCopy}
            onChange={setSaveSentCopy}
          />
          <View className="flex-row gap-2">
            <Button size="sm" className="rounded-lg" disabled={busy} onPress={() => void save()}>
              <ButtonText>Save</ButtonText>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-lg" onPress={() => setOpen(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function HostFields({ title, value, onChange }: { title: string; value: HostConfig; onChange: (v: HostConfig) => void }) {
  return (
    <View className="gap-2">
      <Text size="sm" className="font-semibold">
        {title}
      </Text>
      <View className="flex-row flex-wrap items-end gap-3">
        <LabeledInput label="Host" value={value.host} onChange={(host) => onChange({ ...value, host })} className="min-w-[180px] flex-1" />
        <LabeledInput
          label="Port"
          value={String(value.port || "")}
          onChange={(port) => onChange({ ...value, port: Number(port.replace(/\D/g, "")) || 0 })}
          keyboardType="number-pad"
          className="w-24"
        />
        <View className="h-10 flex-row items-center gap-2">
          <Text size="sm" className="text-muted-foreground">
            SSL/TLS
          </Text>
          <Switch size="sm" value={value.secure} onValueChange={(secure) => onChange({ ...value, secure })} />
        </View>
      </View>
    </View>
  );
}

const CUSTOM = "custom";

function AddAccount() {
  const api = useApi();
  const notify = useNotify();
  const { capabilities } = useConnection();
  const { accounts, reloadAccounts } = useMail();
  const [presetId, setPresetId] = useState(MAIL_PRESETS[0]!.id);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [imap, setImap] = useState<HostConfig>({ host: "", port: 993, secure: true });
  const [smtp, setSmtp] = useState<HostConfig>({ host: "", port: 465, secure: true });
  const [busy, setBusy] = useState<"test" | "add" | "google" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const preset = MAIL_PRESETS.find((p) => p.id === presetId);
  const input = (): AccountInput => ({
    address: address.trim(),
    password,
    name: name.trim() || undefined,
    user: user.trim() || undefined,
    imap: preset ? preset.imap : imap,
    smtp: preset ? preset.smtp : smtp,
    // "Gmail", "iCloud"... unless that label is taken; then the server uses the address.
    label: preset && !accounts.some((a) => a.label === preset.label) ? preset.label : undefined,
  });
  const ready = address.includes("@") && password.length > 0 && (preset || (imap.host && smtp.host && imap.port && smtp.port));

  async function run(kind: "test" | "add") {
    setBusy(kind);
    setResult(null);
    try {
      if (kind === "test") {
        await api.testAccount(input());
        setResult({ ok: true, text: "Connection works" });
      } else {
        const account = await api.addAccount(input());
        await reloadAccounts();
        notify("Account added", account.address);
        setAddress("");
        setPassword("");
        setName("");
        setUser("");
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy("google");
    setResult(null);
    try {
      const { sessionId, url } = await api.startGoogleSignIn();
      await Linking.openURL(url);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await api.googleSignInStatus(sessionId);
        if (status.status === "done") {
          await reloadAccounts();
          notify("Account added", status.account?.address);
          return;
        }
        if (status.status === "error") throw new Error(status.error ?? "Google sign-in failed");
      }
      throw new Error("Google sign-in timed out");
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="gap-4 p-4">
      <Segmented
        value={presetId}
        onChange={(id) => {
          setPresetId(id);
          setResult(null);
        }}
        options={[...MAIL_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: CUSTOM, label: "Other" }]}
      />
      {preset ? (
        <Text size="sm" className="text-muted-foreground">
          {preset.help}
        </Text>
      ) : (
        <Text size="sm" className="text-muted-foreground">
          Any provider with IMAP and SMTP. Port 993 + SSL for IMAP; 465 + SSL or 587 without SSL (STARTTLS) for SMTP.
        </Text>
      )}
      <View className="flex-row flex-wrap gap-3">
        <LabeledInput label="Email address" value={address} onChange={setAddress} placeholder="you@example.com" keyboardType="email-address" className="min-w-[220px] flex-1" />
        <LabeledInput label="App password" value={password} onChange={setPassword} secure className="min-w-[220px] flex-1" />
      </View>
      <LabeledInput label="Sender name (optional)" value={name} onChange={setName} placeholder="Shown to recipients" />
      {!preset ? (
        <>
          <HostFields title="Incoming (IMAP)" value={imap} onChange={setImap} />
          <HostFields title="Outgoing (SMTP)" value={smtp} onChange={setSmtp} />
        </>
      ) : null}
      <Pressable onPress={() => setAdvanced((a) => !a)} className="self-start">
        <Text size="sm" className="text-muted-foreground underline">
          {advanced ? "Hide advanced" : "Advanced"}
        </Text>
      </Pressable>
      {advanced ? (
        <LabeledInput label="Login username (if not the email address)" value={user} onChange={setUser} placeholder={address || "username"} />
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button className="rounded-lg" disabled={!ready || busy !== null} onPress={() => void run("add")}>
          <ButtonText>{busy === "add" ? "Adding…" : "Add account"}</ButtonText>
        </Button>
        <Button variant="outline" className="rounded-lg" disabled={!ready || busy !== null} onPress={() => void run("test")}>
          <ButtonText>{busy === "test" ? "Testing…" : "Test connection"}</ButtonText>
        </Button>
        {presetId === "gmail" && capabilities?.googleSignIn ? (
          <Button variant="ghost" className="rounded-lg" disabled={busy !== null} onPress={() => void google()}>
            <ButtonText>{busy === "google" ? "Waiting for Google…" : "Sign in with Google instead"}</ButtonText>
          </Button>
        ) : null}
      </View>
      {result ? (
        <Text size="sm" className={result.ok ? "text-muted-foreground" : "text-destructive"}>
          {result.text}
        </Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- screen

export default function SettingsScreen() {
  const isWide = useIsWide();
  const { accounts } = useMail();
  const { mode, setMode } = useThemeMode();

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header
        safeTop={!isWide}
        title="Settings"
        left={!isWide ? <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : undefined}
      />
      <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl px-4 pb-16" keyboardShouldPersistTaps="handled">
        <SectionTitle>Accounts</SectionTitle>
        {accounts.length ? (
          <Card>
            {accounts.map((a, i) => (
              <AccountRow key={a.id} account={a} last={i === accounts.length - 1} />
            ))}
          </Card>
        ) : (
          <Text size="sm" className="px-1 text-muted-foreground">
            No accounts yet. Add one below.
          </Text>
        )}

        <SectionTitle>Add an account</SectionTitle>
        <AddAccount />

        <SectionTitle>Server</SectionTitle>
        <Card className="p-4">
          <ServerForm compact />
        </Card>

        <SectionTitle>Appearance</SectionTitle>
        <View className="items-start">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
