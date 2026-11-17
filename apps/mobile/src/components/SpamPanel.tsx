import { useState } from "react";
import { TextInput, View } from "react-native";
import type { BlockInput, MessageHeader } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useColors } from "@/src/lib/theme";

/** What to block when reporting spam: each sender, each sender's domain, a regex, or nothing. */
export type SpamBlock = { kind: "sender" } | { kind: "domain" } | { kind: "regex"; value: string } | { kind: "none" };

/** The block rules a choice makes for these messages (one per distinct sender or domain). */
export function blocksFor(choice: SpamBlock, messages: Pick<MessageHeader, "from">[]): BlockInput[] {
  const addresses = [...new Set(messages.map((m) => m.from.address.trim().toLowerCase()).filter(Boolean))];
  if (choice.kind === "sender") return addresses.map((value) => ({ kind: "address", value }));
  if (choice.kind === "domain") return [...new Set(addresses.map((a) => a.split("@")[1]!).filter(Boolean))].map((value) => ({ kind: "domain", value }));
  if (choice.kind === "regex") return [{ kind: "regex", value: choice.value }];
  return [];
}

/**
 * Report spam: the messages go to their account's spam folder, and (unless
 * "Don't block") the chosen rule sends that sender's future mail there too.
 */
export function SpamPanel({ messages, onReport }: { messages: Pick<MessageHeader, "from">[]; onReport: (choice: SpamBlock) => void }) {
  const colors = useColors();
  const senders = [...new Set(messages.map((m) => m.from.address.toLowerCase()).filter(Boolean))];
  const domains = [...new Set(senders.map((a) => a.split("@")[1]).filter(Boolean))];
  const [kind, setKind] = useState<SpamBlock["kind"]>("sender");
  const [regex, setRegex] = useState(senders.length === 1 ? `^${senders[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : "");
  const one = (list: string[], single: string, many: string) => (list.length === 1 ? single.replace("%", list[0]!) : many.replace("%", String(list.length)));
  const options: { kind: SpamBlock["kind"]; label: string }[] = [
    { kind: "sender", label: one(senders, "Block %", "Block these % senders") },
    { kind: "domain", label: one(domains, "Block everyone at @%", "Block these % domains") },
    { kind: "regex", label: "Block with a regular expression" },
    { kind: "none", label: "Don't block, just move to spam" },
  ];
  const ready = kind !== "regex" || regex.trim().length > 0;
  return (
    <View className="gap-2 border-b border-border px-4 py-3">
      <Text size="xs" className="font-semibold uppercase tracking-wider text-muted-foreground">
        Report spam
      </Text>
      <Text size="xs" className="text-muted-foreground">
        {messages.length > 1 ? "They go" : "It goes"} to the account's spam folder. A blocked sender's new mail goes there on its own.
      </Text>
      <View className="gap-1">
        {options.map((o) => {
          const on = kind === o.kind;
          return (
            <Pressable
              key={o.kind}
              onPress={() => setKind(o.kind)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              className="flex-row items-center gap-2 self-start rounded-md px-1 py-1 data-[hover=true]:bg-accent"
            >
              <View className={`h-4 w-4 items-center justify-center rounded-full border ${on ? "border-primary" : "border-border"}`}>
                {on ? <View className="h-2 w-2 rounded-full bg-primary" /> : null}
              </View>
              <Text size="sm">{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {kind === "regex" ? (
        <TextInput
          value={regex}
          onChangeText={setRegex}
          placeholder="e.g. @(promo|deals)\.example\.com$"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground web:outline-none"
        />
      ) : null}
      {kind === "regex" ? (
        <Text size="xs" className="text-muted-foreground">
          {'Case-insensitive, tested on the sender\'s address and on "Name <address>".'}
        </Text>
      ) : null}
      <View className="flex-row">
        <Button size="sm" className="rounded-lg" disabled={!ready} onPress={() => onReport(kind === "regex" ? { kind, value: regex.trim() } : ({ kind } as SpamBlock))}>
          <ButtonText>{messages.length > 1 ? `Move ${messages.length} to spam` : "Move to spam"}</ButtonText>
        </Button>
      </View>
    </View>
  );
}
