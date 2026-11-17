import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Platform, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Check, Contact as ContactIcon, Mail, MessageCircle, Pencil, Phone, Search, Send, Settings } from "lucide-react-native";
import type { Contact } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { ColorDot, EmptyState, ErrorBanner, Header, IconButton, Initials, LabeledInput, Loading, RefreshButton, Segmented, useNotify } from "@/src/components/kit";
import { useApi } from "@/src/lib/connection";
import { formatRecipient, useContacts } from "@/src/lib/contacts";
import { connectGoogle } from "@/src/lib/googleConnect";
import { formatListDate, useIsWide } from "@/src/lib/format";
import { loadJson, saveJson } from "@/src/lib/storage";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

type Filter = "saved" | "all";

const EMAIL_ONLY_KEY = "contacts.emailOnly";

/** WhatsApp's link for a phone number: digits only, in international form ("+33 6…" or "0033 6…" → "336…"). */
function whatsappUrl(phone: string): string | null {
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");
  return digits.length >= 7 ? `https://wa.me/${digits}` : null;
}

/** A round check box; empty until checked. */
function CheckBox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  const colors = useColors();
  return (
    <View
      className={`h-5 w-5 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary" : "border-border"} ${disabled ? "opacity-30" : ""}`}
    >
      {checked ? <Check size={13} color={colors.background} strokeWidth={3} /> : null}
    </View>
  );
}

/** Edits a contact where it lives (Google or iCloud): one email or phone per line. */
function ContactEditor({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const api = useApi();
  const notify = useNotify();
  const colors = useColors();
  const { reload } = useContacts();
  const [name, setName] = useState(contact.name);
  const [organization, setOrganization] = useState(contact.organization);
  const [emails, setEmails] = useState(contact.emails.join("\n"));
  const [phones, setPhones] = useState(contact.phones.join("\n"));
  const [busy, setBusy] = useState(false);
  const lines = (text: string) => text.split(/[\n,;]/).map((l) => l.trim()).filter(Boolean);
  const area = "min-h-[72px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-sans web:outline-none";

  const save = async () => {
    setBusy(true);
    try {
      await api.updateContact(contact.id, { name, organization, emails: lines(emails), phones: lines(phones) });
      await reload();
      notify("Contact saved");
      onDone();
    } catch (e) {
      notify("Couldn't save the contact", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-2 gap-3">
      <View className="flex-row flex-wrap gap-3">
        <LabeledInput label="Name" value={name} onChange={setName} className="min-w-[180px] flex-1" />
        <LabeledInput label="Company" value={organization} onChange={setOrganization} className="min-w-[180px] flex-1" />
      </View>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-[180px] flex-1 gap-1.5">
          <Text size="sm" className="font-medium">
            Emails (one per line)
          </Text>
          <TextInput value={emails} onChangeText={setEmails} multiline autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textAlignVertical="top" placeholderTextColor={colors.muted} className={area} />
        </View>
        <View className="min-w-[180px] flex-1 gap-1.5">
          <Text size="sm" className="font-medium">
            Phones (one per line)
          </Text>
          <TextInput value={phones} onChangeText={setPhones} multiline keyboardType="phone-pad" textAlignVertical="top" placeholder="+33 6 12 34 56 78" placeholderTextColor={colors.muted} className={area} />
        </View>
      </View>
      <View className="flex-row gap-2">
        <Button size="sm" className="rounded-lg" disabled={busy} onPress={() => void save()}>
          <ButtonText>{busy ? "Saving…" : "Save"}</ButtonText>
        </Button>
        <Button size="sm" variant="ghost" className="rounded-lg" disabled={busy} onPress={onDone}>
          <ButtonText>Cancel</ButtonText>
        </Button>
      </View>
    </View>
  );
}

function ContactRow({
  contact,
  accountColor,
  last,
  selected,
  onToggle,
  whatsapp,
}: {
  contact: Contact;
  accountColor?: string;
  last: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Show the WhatsApp shortcut next to phone numbers (phones and phone-sized screens). */
  whatsapp: boolean;
}) {
  const colors = useColors();
  const notify = useNotify();
  const selectable = contact.emails.length > 0;
  const [editing, setEditing] = useState(false);
  const write = (email: string) => router.push({ pathname: "/compose", params: { mode: "new", to: formatRecipient(contact.name, email) } });
  const openWhatsapp = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      notify("Couldn't open WhatsApp", (e as Error).message, "error");
    }
  };
  return (
    <View className={`flex-row gap-3 px-4 py-3 ${selected ? "bg-accent/60" : ""} ${last ? "" : "border-b border-border/70"}`}>
      <Pressable
        onPress={onToggle}
        disabled={!selectable}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: !selectable }}
        accessibilityLabel={selectable ? `Select ${contact.name}` : `${contact.name} has no email address`}
        className="flex-row items-center gap-3 self-start"
      >
        <CheckBox checked={selected} disabled={!selectable} />
        <Initials name={contact.name} size={36} />
      </Pressable>
      <View className="min-w-0 flex-1 gap-0.5">
        <Pressable onPress={onToggle} disabled={!selectable} className="flex-row items-center gap-2 self-start">
          <Text numberOfLines={1} className="flex-shrink font-medium">
            {contact.name}
          </Text>
          {accountColor ? <ColorDot color={accountColor} /> : null}
        </Pressable>
        {editing ? <ContactEditor contact={contact} onDone={() => setEditing(false)} /> : null}
        {!editing && contact.organization && contact.organization !== contact.name ? (
          <Text size="sm" numberOfLines={1} className="text-muted-foreground">
            {contact.organization}
          </Text>
        ) : null}
        {!editing && contact.emails.map((email) => (
          <Pressable key={email} onPress={() => write(email)} className="flex-row items-center gap-1.5 self-start rounded-md py-0.5 data-[hover=true]:bg-accent">
            <Mail size={13} color={colors.muted} />
            <Text size="sm" numberOfLines={1} className="text-primary">
              {email}
            </Text>
          </Pressable>
        ))}
        {!editing && contact.phones.map((phone) => {
          const url = whatsapp ? whatsappUrl(phone) : null;
          return (
            <View key={phone} className="flex-row items-center gap-1.5 py-0.5">
              <Phone size={13} color={colors.muted} />
              <Text size="sm" selectable className="text-muted-foreground">
                {phone}
              </Text>
              {url ? (
                <Pressable
                  onPress={() => void openWhatsapp(url)}
                  accessibilityRole="link"
                  accessibilityLabel={`WhatsApp ${phone}`}
                  className="ml-1 flex-row items-center gap-1 rounded-full px-2 py-0.5"
                  style={{ backgroundColor: "#25D366" }}
                >
                  <MessageCircle size={12} color="#ffffff" />
                  <Text size="xs" className="font-medium text-white">
                    WhatsApp
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {/* Gmail's remembered addresses can't be edited (Google keeps them read-only). */}
      {!contact.auto && !editing ? <IconButton icon={Pencil} size={16} label="Edit contact" onPress={() => setEditing(true)} /> : null}
    </View>
  );
}

export default function ContactsScreen() {
  const isWide = useIsWide();
  const colors = useColors();
  const { accounts } = useMail();
  const { page, error, refresh, reload } = useContacts();
  const api = useApi();
  const notify = useNotify();
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  /** A fresh Google sign-in, so the account's permission covers contacts; then import again. */
  const reconnect = async (accountId: string) => {
    setReconnecting(accountId);
    try {
      await connectGoogle(api, accountId);
      await refresh();
      notify("Google reconnected", "Contacts are imported.");
    } catch (e) {
      notify("Couldn't reconnect Google", (e as Error).message, "error");
    } finally {
      setReconnecting(null);
    }
  };
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("saved");
  /** Hide contacts without an email address (on by default; remembered). */
  const [emailOnly, setEmailOnlyState] = useState(true);
  useEffect(() => {
    void loadJson<boolean>(EMAIL_ONLY_KEY).then((saved) => saved !== null && setEmailOnlyState(saved));
  }, []);
  const setEmailOnly = (on: boolean) => {
    setEmailOnlyState(on);
    void saveJson(EMAIL_ONLY_KEY, on);
  };
  /** Selected contact ids. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // WhatsApp shortcuts on phones (the app, or the web app on a phone-sized screen).
  const whatsapp = Platform.OS !== "web" || !isWide;

  const hasAuto = page?.contacts.some((c) => c.auto) ?? false;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (page?.contacts ?? []).filter(
      (c) =>
        (filter === "all" || !c.auto) &&
        (!emailOnly || c.emails.length > 0) &&
        (!q || `${c.name} ${c.organization} ${c.emails.join(" ")} ${c.phones.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [page, query, filter, emailOnly]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = (page?.contacts ?? []).filter((c) => selected.has(c.id) && c.emails.length);
  const selectableShown = shown.filter((c) => c.emails.length);
  const allShownSelected = selectableShown.length > 0 && selectableShown.every((c) => selected.has(c.id));
  const selectAllShown = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const c of selectableShown) {
        if (allShownSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  /** A new message to every selected contact (their first address). */
  const writeToSelected = () => {
    const to = chosen.map((c) => formatRecipient(c.name, c.emails[0]!)).join(", ");
    router.push({ pathname: "/compose", params: { mode: "new", to } });
  };

  const color = (id: string) => (accounts.length > 1 ? accounts.find((a) => a.id === id)?.color : undefined);
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? "An account";
  const importing = accounts.some((a) => a.importContacts !== false && a.calendar.connected);
  const subtitle = page
    ? `${shown.length} ${shown.length === 1 ? "contact" : "contacts"}${page.updatedAt ? ` · imported ${formatListDate(page.updatedAt)}` : ""}`
    : undefined;

  return (
    <View className="flex-1 bg-background">
      <Header
        safeTop={!isWide}
        title="Contacts"
        subtitle={subtitle}
        left={!isWide ? <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : undefined}
        right={<RefreshButton label="Import contacts now" onPress={refresh} busy={page?.refreshing ?? false} />}
      />
      {error ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {(page?.errors ?? []).map((e) => (
        <View key={e.accountId}>
          <ErrorBanner message={`${label(e.accountId)}: ${e.error}`} />
          {/reconnect Google/i.test(e.error) ? (
            <View className="items-start px-4 pb-2">
              <Button size="sm" variant="outline" className="rounded-lg" disabled={reconnecting !== null} onPress={() => void reconnect(e.accountId)}>
                <ButtonText>{reconnecting === e.accountId ? "Waiting for Google…" : `Reconnect Google for ${label(e.accountId)}`}</ButtonText>
              </Button>
            </View>
          ) : null}
        </View>
      ))}
      {page === null ? (
        error ? null : <Loading />
      ) : page.contacts.length === 0 ? (
        <EmptyState
          icon={ContactIcon}
          title={page.refreshing ? "Importing your contacts…" : "No contacts yet"}
          message={
            importing
              ? "Contacts come from your iCloud and Gmail accounts on their own. Click refresh to import them now."
              : "Contacts are imported from iCloud accounts, and from Gmail accounts once Google is connected (Settings → account → Calendar). Check that \"Import contacts automatically\" is on for the account."
          }
          action={
            <Button size="sm" variant="outline" className="rounded-lg" onPress={() => router.push("/settings")}>
              <Settings size={14} color={colors.foreground} />
              <ButtonText>Open Settings</ButtonText>
            </Button>
          }
        />
      ) : (
        <View className="mx-auto w-full max-w-3xl flex-1 px-4">
          <View className="flex-row flex-wrap items-center gap-2 py-3">
            <View className="h-10 min-w-[220px] flex-1 flex-row items-center gap-2 rounded-lg border border-border px-3">
              <Search size={15} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name, email, company or phone"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                className="h-10 flex-1 text-sm text-foreground font-sans web:outline-none"
              />
            </View>
            {hasAuto ? (
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "saved", label: "Saved" },
                  { value: "all", label: "With emailed" },
                ]}
              />
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-2 pb-3">
            <Pressable onPress={selectAllShown} disabled={!selectableShown.length} className="flex-row items-center gap-2 rounded-md px-1 py-1 data-[hover=true]:bg-accent">
              <CheckBox checked={allShownSelected} disabled={!selectableShown.length} />
              <Text size="sm" className="text-muted-foreground">
                {allShownSelected ? "Unselect all" : "Select all"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEmailOnly(!emailOnly)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: emailOnly }}
              className="flex-row items-center gap-2 rounded-md px-1 py-1 data-[hover=true]:bg-accent"
            >
              <CheckBox checked={emailOnly} />
              <Text size="sm" className="text-muted-foreground">
                Only with email
              </Text>
            </Pressable>
            <View className="flex-1" />
            {selected.size ? (
              <Button size="sm" variant="ghost" className="rounded-lg" onPress={() => setSelected(new Set())}>
                <ButtonText>Clear</ButtonText>
              </Button>
            ) : null}
            <Button size="sm" className="rounded-lg" disabled={chosen.length === 0} onPress={writeToSelected}>
              <Send size={14} color={colors.background} />
              <ButtonText>{chosen.length ? `Email ${chosen.length} selected` : "Email selected"}</ButtonText>
            </Button>
          </View>
          <FlatList
            data={shown}
            keyExtractor={(c) => c.id}
            className="flex-1 rounded-xl border border-border"
            contentContainerClassName="pb-2"
            extraData={selected}
            renderItem={({ item, index }) => (
              <ContactRow
                contact={item}
                accountColor={color(item.accountId)}
                last={index === shown.length - 1}
                selected={selected.has(item.id)}
                onToggle={() => toggle(item.id)}
                whatsapp={whatsapp}
              />
            )}
            ListEmptyComponent={
              <Text size="sm" className="p-6 text-center text-muted-foreground">
                No contact matches "{query}".
              </Text>
            }
          />
          <View className="h-4" />
        </View>
      )}
    </View>
  );
}
