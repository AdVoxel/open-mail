import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react-native";
import {
  ACCOUNT_COLORS,
  MAIL_PRESETS,
  type AccountInfo,
  type AccountInput,
  type HostConfig,
  type MailLabel,
} from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { ServerForm } from "@/src/components/ConnectScreen";
import { SignaturePreview } from "@/src/components/SignaturePreview";
import { AccountCalendarSettings } from "@/src/components/CalendarSetup";
import {
  Card,
  Header,
  IconButton,
  Initials,
  LabelChip,
  LabeledInput,
  SectionTitle,
  Segmented,
  ToggleRow,
  useConfirm,
  useNotify,
} from "@/src/components/kit";
import { useApi, useConnection } from "@/src/lib/connection";
import { useIsWide } from "@/src/lib/format";
import { CHECK_INTERVALS, useMail, type CheckInterval } from "@/src/lib/mail";
import { AUTO_LOCK_OPTIONS, useLock, type AutoLock } from "@/src/lib/lock";
import { useNotifications } from "@/src/lib/notifications";
import { SEND_DELAYS, useSendDelay, type SendDelay } from "@/src/lib/sendDelay";
import { useAutoDrafts, useTrackOpens } from "@/src/lib/composePrefs";
import { ACCENTS, useColors, useThemeMode } from "@/src/lib/theme";

const inputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <View className="gap-1.5">
      <Text size="sm" className="font-medium">
        Color
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {ACCOUNT_COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            accessibilityLabel={`Color ${color}`}
            style={{ backgroundColor: color }}
            className={`h-8 w-8 items-center justify-center rounded-full ${value === color ? "border-2 border-foreground" : ""}`}
          >
            {value === color ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SignatureEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const colors = useColors();
  return (
    <View className="gap-1.5">
      <Text size="sm" className="font-medium">
        Signature (HTML)
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        placeholder={'<p><b>Your name</b><br>Your title · <a href="https://example.com">example.com</a></p>'}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
        className="min-h-[110px] rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground web:outline-none"
      />
      {value.trim() ? (
        <View className="gap-1">
          <Text size="xs" className="text-muted-foreground">
            Preview
          </Text>
          <SignaturePreview html={value} />
        </View>
      ) : (
        <Text size="xs" className="text-muted-foreground">
          Added below what you write, above quoted replies. You can turn it off for a single message when composing.
        </Text>
      )}
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
  const [color, setColor] = useState(account.color);
  const [signature, setSignature] = useState(account.signature);
  const [name, setName] = useState(account.name);
  const [saveSentCopy, setSaveSentCopy] = useState(account.saveSentCopy);
  const [busy, setBusy] = useState(false);
  const editable = account.source === "app";

  async function save() {
    setBusy(true);
    try {
      await api.updateAccount(account.id, { label: label.trim() || account.address, color, signature: signature.trim(), name: name.trim(), saveSentCopy });
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
        <Initials name={account.label} size={36} color={account.color} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-medium">
            {account.label}
          </Text>
          <Text size="sm" numberOfLines={1} className="text-muted-foreground">
            {account.address} · {providerName(account)}
            {account.source === "env" ? " · from environment" : ""}
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
          <ColorPicker value={color} onChange={setColor} />
          <SignatureEditor value={signature} onChange={setSignature} />
          <AccountCalendarSettings account={account} />
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

// ----------------------------------------------------------- screen lock

function ScreenLockSection() {
  const api = useApi();
  const notify = useNotify();
  const colors = useColors();
  const lock = useLock();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mode, setMode] = useState<"idle" | "change" | "off">("idle");
  const [busy, setBusy] = useState(false);
  const field = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";

  const reset = () => {
    setCurrent("");
    setPassword("");
    setConfirm("");
    setMode("idle");
  };
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      notify(done);
      reset();
    } catch (e) {
      notify("Couldn't save", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const setNew = (withCurrent: boolean) =>
    run(async () => {
      if (password !== confirm) throw new Error("The passwords don't match");
      await api.setLockPassword(password, withCurrent ? current : undefined);
      lock.setEnabled(true);
    }, withCurrent ? "Password changed" : "Screen lock on");

  const newPasswordFields = (
    <>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="New password (4+ characters)" placeholderTextColor={colors.muted} className={field} />
      <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="New password again" placeholderTextColor={colors.muted} className={field} />
    </>
  );

  if (!lock.enabled) {
    return (
      <Card className="gap-3 p-4">
        <Text size="xs" className="text-muted-foreground">
          Locks the app with a password, on every device. If you forget it, a code is emailed to one of your accounts. It hides your mail on screen; it doesn't encrypt it.
        </Text>
        {newPasswordFields}
        <View className="items-start">
          <Button size="sm" className="rounded-lg" disabled={busy || password.length < 4} onPress={() => void setNew(false)}>
            <ButtonText>Turn on screen lock</ButtonText>
          </Button>
        </View>
      </Card>
    );
  }

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row flex-wrap items-center gap-3">
        <Text size="sm" className="flex-1 font-medium">
          Screen lock is on
        </Text>
        <Button size="sm" variant="outline" className="rounded-lg" onPress={lock.lock}>
          <ButtonText>Lock now</ButtonText>
        </Button>
      </View>
      <View className="gap-1.5">
        <Text size="sm" className="font-medium">
          Lock after
        </Text>
        <View className="items-start">
          <Segmented
            value={String(lock.autoLock)}
            onChange={(v) => lock.setAutoLock(Number(v) as AutoLock)}
            options={AUTO_LOCK_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? "Never" : `${m} min` }))}
          />
        </View>
        <Text size="xs" className="text-muted-foreground">
          Without use on this device. The app also locks whenever it starts.
        </Text>
      </View>
      {mode === "idle" ? (
        <View className="flex-row gap-2">
          <Button size="sm" variant="outline" className="rounded-lg" onPress={() => setMode("change")}>
            <ButtonText>Change password</ButtonText>
          </Button>
          <Button size="sm" variant="ghost" className="rounded-lg" onPress={() => setMode("off")}>
            <ButtonText>Turn off</ButtonText>
          </Button>
        </View>
      ) : (
        <View className="gap-2">
          <TextInput value={current} onChangeText={setCurrent} secureTextEntry placeholder="Current password" placeholderTextColor={colors.muted} className={field} />
          {mode === "change" ? newPasswordFields : null}
          <View className="flex-row gap-2">
            <Button
              size="sm"
              className="rounded-lg"
              disabled={busy || !current || (mode === "change" && password.length < 4)}
              onPress={() =>
                void (mode === "change"
                  ? setNew(true)
                  : run(async () => {
                      await api.disableLock(current);
                      lock.setEnabled(false);
                    }, "Screen lock off"))
              }
            >
              <ButtonText>{mode === "change" ? "Change password" : "Turn off screen lock"}</ButtonText>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-lg" onPress={reset}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </View>
        </View>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- sending

function SendDelaySection() {
  const [delay, setDelay] = useSendDelay();
  const [autoDrafts, setAutoDrafts] = useAutoDrafts();
  const [trackOpens, setTrackOpens] = useTrackOpens();
  return (
    <Card className="gap-3 p-4">
      <ToggleRow
        label="Save drafts automatically"
        hint="What you write goes to the account's Drafts folder as you type, so closing the window or the app doesn't lose it."
        value={autoDrafts}
        onChange={setAutoDrafts}
      />
      <ToggleRow
        label="Track opens"
        hint="New messages get a tiny image that tells your server when it's loaded (change it per message in Compose). Needs the server online; approximate."
        value={trackOpens}
        onChange={setTrackOpens}
      />
      <View>
        <Text size="sm" className="font-medium">
          Delay sending
        </Text>
        <Text size="xs" className="text-muted-foreground">
          Every message waits this long before it goes out, with an Undo button meanwhile. It still goes out if you close the app.
        </Text>
      </View>
      <View className="items-start">
        <Segmented
          value={String(delay)}
          onChange={(value) => setDelay(Number(value) as SendDelay)}
          options={SEND_DELAYS.map((s) => ({ value: String(s), label: s === 0 ? "Off" : `${s} s` }))}
        />
      </View>
    </Card>
  );
}

// --------------------------------------------------------- notifications

function NotificationsSection() {
  const notify = useNotify();
  const { supported, enabled, permission, setEnabled, test, eventAlerts, setEventAlerts } = useNotifications();
  const alertsRow = (
    <ToggleRow
      label="Calendar alerts"
      hint="When an event's alert is due: a notice in the app, and a system notification when those are on."
      value={eventAlerts}
      onChange={setEventAlerts}
    />
  );

  if (!supported) {
    return (
      <Card className="p-4">
        <Text size="sm" className="text-muted-foreground">
          New-mail notifications work in the browser and the desktop app for now. Phones are coming later.
        </Text>
      </Card>
    );
  }

  const hint =
    permission === "denied"
      ? "Blocked. Allow notifications for this app in your browser or system settings, then turn this on again."
      : "A notification with the subject and the start of the message when mail arrives in an inbox.";

  return (
    <Card className="gap-3 p-4">
      <ToggleRow
        label="New mail notifications"
        hint={hint}
        value={enabled}
        onChange={(on) =>
          void setEnabled(on).then((result) => {
            if (on && result === "denied") notify("Notifications are blocked", "Allow them in your browser or system settings.", "error");
            if (on && result === "granted") test();
          })
        }
      />
      {enabled ? (
        <View className="items-start">
          <Button size="sm" variant="outline" className="rounded-lg" onPress={test}>
            <ButtonText>Send a test notification</ButtonText>
          </Button>
        </View>
      ) : null}
      {alertsRow}
    </Card>
  );
}

// ---------------------------------------------------------------- labels

function LabelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Omit<MailLabel, "id">;
  submitLabel: string;
  onSubmit: (label: Omit<MailLabel, "id">) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), color });
      if (!onCancel) setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-end gap-3">
        <LabeledInput label="Name" value={name} onChange={setName} placeholder="e.g. Invoices" className="min-w-[200px] flex-1" />
        {name.trim() ? <LabelChip name={name.trim()} color={color} /> : null}
      </View>
      <ColorPicker value={color} onChange={setColor} />
      <View className="flex-row gap-2">
        <Button size="sm" className="rounded-lg" disabled={busy || !name.trim()} onPress={() => void submit()}>
          <ButtonText>{submitLabel}</ButtonText>
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" className="rounded-lg" onPress={onCancel}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function LabelsSection() {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const { labels, reloadLabels } = useMail();
  const [editing, setEditing] = useState<string | null>(null);

  const run = async (done: string, action: () => Promise<unknown>) => {
    try {
      await action();
      await reloadLabels();
      notify(done);
      return true;
    } catch (e) {
      notify("Couldn't save the label", (e as Error).message, "error");
      return false;
    }
  };

  const remove = async (label: MailLabel) => {
    const ok = await confirm({
      title: `Delete “${label.name}”?`,
      message: "The label disappears from every message. The messages themselves stay where they are.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) await run("Label deleted", () => api.removeLabel(label.id));
  };

  return (
    <Card>
      {labels.map((label) => (
        <View key={label.id} className="border-b border-border/70">
          {editing === label.id ? (
            <View className="p-4">
              <LabelForm
                initial={label}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (update) => {
                  if (await run("Label updated", () => api.updateLabel(label.id, update))) setEditing(null);
                }}
              />
            </View>
          ) : (
            <Pressable onPress={() => setEditing(label.id)} className="flex-row items-center gap-3 px-4 py-3 data-[hover=true]:bg-accent/50">
              <View className="flex-1 items-start">
                <LabelChip name={label.name} color={label.color} />
              </View>
              <IconButton icon={ChevronDown} label="Edit" onPress={() => setEditing(label.id)} />
              <IconButton icon={Trash2} label="Delete" onPress={() => void remove(label)} />
            </Pressable>
          )}
        </View>
      ))}
      <View className="gap-2 p-4">
        <Text size="sm" className="font-semibold">
          New label
        </Text>
        <LabelForm
          initial={{ name: "", color: ACCOUNT_COLORS[labels.length % ACCOUNT_COLORS.length]! }}
          submitLabel="Add label"
          onSubmit={async (label) => {
            await run("Label added", () => api.addLabel(label));
          }}
        />
      </View>
    </Card>
  );
}

// ------------------------------------------------------------ appearance

function AccentPicker() {
  const { accent, setAccent } = useThemeMode();
  const { dark } = useColors();
  return (
    <View className="gap-2">
      <View>
        <Text size="sm" className="font-medium">
          Accent color
        </Text>
        <Text size="xs" className="text-muted-foreground">
          The background of unread messages, and the app's highlights.
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {ACCENTS.map((a) => {
          const color = dark ? a.dark : a.light;
          const on = a.id === accent.id;
          return (
            <Pressable
              key={a.id}
              onPress={() => setAccent(a.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={a.label}
              style={{ backgroundColor: color }}
              className={`h-8 w-8 items-center justify-center rounded-full ${on ? "border-2 border-foreground" : ""}`}
            >
              {on ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** "30 s", "1 min", "15 min". */
function intervalLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

// ---------------------------------------------------------------- screen

export default function SettingsScreen() {
  const isWide = useIsWide();
  const { accounts, groupConversations, setGroupConversations, checkInterval, setCheckInterval } = useMail();
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

        <SectionTitle>Reading</SectionTitle>
        <Card className="gap-3 p-4">
          <ToggleRow
            label="Group by conversation"
            hint="One row per conversation in the message list, most recent first."
            value={groupConversations}
            onChange={setGroupConversations}
          />
          <View>
            <Text size="sm" className="font-medium">
              Check for new mail every
            </Text>
            <Text size="xs" className="text-muted-foreground">
              Refreshes the list and the unread count on the browser tab's icon. In the browser a service worker does the
              checking, also while the tab is in the background.
            </Text>
          </View>
          <View className="items-start">
            <Segmented
              value={String(checkInterval)}
              onChange={(value) => setCheckInterval(Number(value) as CheckInterval)}
              options={CHECK_INTERVALS.map((s) => ({ value: String(s), label: intervalLabel(s) }))}
            />
          </View>
        </Card>

        <SectionTitle>Screen lock</SectionTitle>
        <ScreenLockSection />

        <SectionTitle>Sending</SectionTitle>
        <SendDelaySection />

        <SectionTitle>Notifications</SectionTitle>
        <NotificationsSection />

        <SectionTitle>Labels</SectionTitle>
        <LabelsSection />

        <SectionTitle>Appearance</SectionTitle>
        <Card className="gap-4 p-4">
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
          <AccentPicker />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
