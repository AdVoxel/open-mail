import { useMemo, useRef, useState, type ComponentRef } from "react";
import { Platform, TextInput, View, type TextInputKeyPressEvent } from "react-native";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatRecipient, recipientEmail, splitRecipients, useContacts, type Suggestion } from "@/src/lib/contacts";
import { useColors } from "@/src/lib/theme";

/**
 * A comma-separated recipients field that suggests addresses from your
 * contacts as you type the current one. Arrow keys move, Enter or Tab picks.
 */
export function RecipientInput({
  value,
  onChangeText,
  className,
  placeholder,
  autoFocus,
  editable = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const colors = useColors();
  const { suggest } = useContacts();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const parts = splitRecipients(value);
  const current = parts.at(-1)?.trim() ?? "";
  const suggestions = useMemo(
    () => (focused && current.length >= 1 ? suggest(current, parts.slice(0, -1).map(recipientEmail)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focused, value, suggest],
  );

  const pick = (s: Suggestion) => {
    const kept = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
    onChangeText([...kept, formatRecipient(s.name, s.email)].join(", ") + ", ");
    setHighlight(0);
    input.current?.focus();
  };

  const onKeyPress = (e: TextInputKeyPressEvent) => {
    if (!suggestions.length) return;
    const key = e.nativeEvent.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h + (key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (key === "Enter" || key === "Tab") {
      e.preventDefault();
      pick(suggestions[Math.min(highlight, suggestions.length - 1)]!);
    } else if (key === "Escape") {
      setFocused(false);
    }
  };

  return (
    <View className="relative flex-1 justify-center" style={{ zIndex: suggestions.length ? 30 : undefined }}>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(v) => {
          setHighlight(0);
          onChangeText(v);
        }}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        // Later than a tap on a suggestion, so the tap still lands.
        onBlur={() => (blurTimer.current = setTimeout(() => setFocused(false), 150))}
        onKeyPress={onKeyPress}
        autoFocus={autoFocus}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        className={className}
        // Callers' classes may say flex-1 (for a row); here the input sits in a column, where that would stretch its height.
        style={{ flexGrow: 0, flexShrink: 0, flexBasis: "auto", width: "100%" }}
        {...(Platform.OS === "web" ? { autoComplete: "off" } : {})}
      />
      {suggestions.length ? (
        <View
          style={{ position: "absolute", top: "100%", left: 0, right: 0, maxWidth: 420, backgroundColor: colors.background }}
          className="overflow-hidden rounded-lg border border-border shadow-lg"
        >
          {suggestions.map((s, i) => (
            <Pressable
              key={s.email}
              onPress={() => pick(s)}
              onHoverIn={() => setHighlight(i)}
              className={`px-3 py-2 ${i === highlight ? "bg-accent" : ""}`}
            >
              <Text size="sm" numberOfLines={1} className="font-medium">
                {s.name || s.email}
              </Text>
              {s.name ? (
                <Text size="xs" numberOfLines={1} className="text-muted-foreground">
                  {s.email}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
