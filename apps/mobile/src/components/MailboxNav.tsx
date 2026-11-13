import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import Constants from "expo-constants";
import { router, usePathname } from "expo-router";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder as FolderIcon,
  Inbox,
  Lock,
  Mails,
  PenSquare,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react-native";
import type { Folder, FolderRole } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useLock } from "@/src/lib/lock";
import { ALL_SENT, useMail, type Mailbox } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { ColorDot, IconButton, type Icon } from "./kit";

const ROLE_ICONS: Record<FolderRole, Icon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  trash: Trash2,
  junk: ShieldAlert,
  archive: Archive,
  all: Mails,
  flagged: Star,
};

function NavItem({
  icon: IconComponent,
  label,
  count,
  active,
  indent,
  onPress,
}: {
  icon: Icon;
  label: string;
  count?: number | null;
  active: boolean;
  indent?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      className={`h-9 flex-row items-center gap-3 rounded-lg px-3 ${indent ? "ml-2" : ""} ${
        active ? "bg-accent" : "data-[hover=true]:bg-accent/60"
      }`}
    >
      <IconComponent size={16} strokeWidth={1.75} color={active ? colors.foreground : colors.muted} />
      <Text size="sm" numberOfLines={1} className={`flex-1 ${active ? "font-medium" : "text-foreground/80"}`}>
        {label}
      </Text>
      {count ? (
        <Text size="xs" className="font-medium text-muted-foreground">
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Accounts, folders and app sections. The sidebar on wide screens; its own
 * screen on phones (then `onDone` takes the user back to the list).
 */
export function MailboxNav({ onDone, showCompose = true }: { onDone?: () => void; showCompose?: boolean }) {
  const { accounts, folders, loadFolders, mailbox, setMailbox } = useMail();
  const pathname = usePathname();
  const colors = useColors();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const onMail = pathname === "/" || pathname === "/message";

  useEffect(() => {
    for (const a of accounts) if (!folders[a.id]) void loadFolders(a.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const open = (next: Mailbox) => {
    setMailbox(next);
    if (onDone) onDone();
    else if (!onMail) router.navigate("/");
  };
  const go = (path: "/scheduled" | "/settings" | "/calendar") => {
    if (onDone) router.push(path);
    else router.navigate(path);
  };
  const isActive = (m: Mailbox) => onMail && mailbox.accountId === m.accountId && mailbox.folder === m.folder;
  const unreadInboxes = accounts.reduce((sum, a) => sum + (folders[a.id]?.find((f) => f.role === "inbox")?.unread ?? 0), 0);

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="gap-0.5 p-3">
        {showCompose ? (
          <Button className="mb-4 h-10 rounded-lg" onPress={() => router.push("/compose")}>
            <PenSquare size={16} color={colors.background} strokeWidth={2} />
            <ButtonText className="font-medium">New message</ButtonText>
          </Button>
        ) : null}

        {accounts.length > 1 ? (
          <NavItem
            icon={Inbox}
            label="All inboxes"
            count={unreadInboxes}
            active={isActive({ accountId: null, folder: "INBOX" })}
            onPress={() => open({ accountId: null, folder: "INBOX" })}
          />
        ) : null}
        {accounts.length > 1 ? (
          <NavItem
            icon={Send}
            label="All sent"
            active={isActive({ accountId: null, folder: ALL_SENT })}
            onPress={() => open({ accountId: null, folder: ALL_SENT })}
          />
        ) : null}

        {accounts.map((account, i) => {
          const list: Folder[] = folders[account.id] ?? [{ path: "INBOX", name: "Inbox", role: "inbox", total: null, unread: null }];
          const isOpen = expanded[account.id] ?? false; // every account starts collapsed
          const shown = isOpen ? list : list.filter((f) => f.role === "inbox");
          return (
            <View key={account.id} className="mt-3">
              <Pressable
                onPress={() => setExpanded((e) => ({ ...e, [account.id]: !isOpen }))}
                className="h-8 flex-row items-center gap-1.5 rounded-md px-3 data-[hover=true]:bg-accent/60"
              >
                {isOpen ? <ChevronDown size={14} color={colors.muted} /> : <ChevronRight size={14} color={colors.muted} />}
                <ColorDot color={account.color} />
                <Text size="xs" numberOfLines={1} className="flex-1 font-semibold uppercase tracking-wider text-muted-foreground">
                  {account.label}
                </Text>
              </Pressable>
              {shown.map((f) => (
                <NavItem
                  key={f.path}
                  icon={f.role ? ROLE_ICONS[f.role] : FolderIcon}
                  label={f.name}
                  count={f.role === "inbox" || f.role === null ? f.unread : null}
                  active={isActive({ accountId: account.id, folder: f.path })}
                  onPress={() => open({ accountId: account.id, folder: f.path })}
                />
              ))}
            </View>
          );
        })}

        <View className="my-4 h-px bg-border" />
        <NavItem icon={CalendarDays} label="Calendar" active={pathname === "/calendar" || pathname === "/event"} onPress={() => go("/calendar")} />
        <NavItem icon={Clock} label="Scheduled" active={pathname === "/scheduled"} onPress={() => go("/scheduled")} />
        <NavItem icon={Settings} label="Settings" active={pathname === "/settings"} onPress={() => go("/settings")} />
      </ScrollView>
      <NavFooter onSetUpLock={() => go("/settings")} />
    </View>
  );
}

/**
 * The app's version: major.minor from app.json, then the build number (the
 * repo's commit count, so every commit bumps it), and the commit built. Both
 * come from the deploy script; a dev build shows app.json's version as is.
 */
const VERSION = (() => {
  const base = Constants.expoConfig?.version ?? "";
  const build = process.env.EXPO_PUBLIC_BUILD_NUMBER;
  const version = build ? `${base.split(".").slice(0, 2).join(".")}.${build}` : base;
  return [version, process.env.EXPO_PUBLIC_BUILD_ID].filter(Boolean).join(" · ");
})();

/** Bottom of the sidebar: the version, and a button to lock the app now. */
function NavFooter({ onSetUpLock }: { onSetUpLock: () => void }) {
  const { enabled, lock } = useLock();
  return (
    <View className="h-12 flex-row items-center justify-between border-t border-border px-3">
      <Text size="xs" selectable className="text-muted-foreground">
        {VERSION ? `v${VERSION}` : ""}
      </Text>
      <IconButton icon={Lock} label={enabled ? "Lock now" : "Set up a lock password"} onPress={enabled ? lock : onSetUpLock} />
    </View>
  );
}
