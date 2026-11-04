import { useEffect, useMemo, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { CalendarClock, X } from "lucide-react-native";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Modal, ModalBackdrop, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatWhen, parseLocalDateTime, schedulePresets, toLocalInputs } from "@/src/lib/format";
import { useColors } from "@/src/lib/theme";
import { IconButton } from "./kit";

const inputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";

/** On web a native date/time input; on phones a plain "YYYY-MM-DD" + "HH:MM" pair. */
function DateTimeFields({ date, time, onChange }: { date: string; time: string; onChange: (date: string, time: string) => void }) {
  const colors = useColors();
  if (Platform.OS === "web") {
    const style = {
      height: 40,
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
      background: colors.background,
      color: colors.foreground,
      padding: "0 12px",
      font: "inherit",
      fontSize: 14,
      colorScheme: colors.dark ? "dark" : "light",
    } as const;
    return (
      <View className="flex-row gap-2">
        <input type="date" value={date} onChange={(e) => onChange(e.target.value, time)} style={{ ...style, flex: 1 }} />
        <input type="time" value={time} onChange={(e) => onChange(date, e.target.value)} style={{ ...style, width: 120 }} />
      </View>
    );
  }
  return (
    <View className="flex-row gap-2">
      <TextInput
        value={date}
        onChangeText={(d) => onChange(d, time)}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        className={`${inputClass} flex-1`}
      />
      <TextInput
        value={time}
        onChangeText={(t) => onChange(date, t)}
        placeholder="HH:MM"
        placeholderTextColor={colors.muted}
        className={`${inputClass} w-24`}
      />
    </View>
  );
}

export function SchedulePicker({
  isOpen,
  initial,
  onClose,
  onPick,
  confirmLabel = "Schedule",
}: {
  isOpen: boolean;
  initial?: Date;
  onClose: () => void;
  onPick: (date: Date) => void;
  confirmLabel?: string;
}) {
  const colors = useColors();
  const presets = useMemo(() => (isOpen ? schedulePresets() : []), [isOpen]);
  const [fields, setFields] = useState(() => toLocalInputs(initial ?? presets[0]?.date ?? new Date()));

  useEffect(() => {
    if (isOpen) setFields(toLocalInputs(initial ?? schedulePresets()[0]!.date));
  }, [isOpen, initial]);

  const custom = parseLocalDateTime(fields.date, fields.time);
  const valid = custom !== null && custom.getTime() > Date.now();

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalBackdrop />
      <ModalContent className="rounded-2xl p-5">
        <ModalHeader>
          <View className="flex-row items-center gap-2">
            <CalendarClock size={18} color={colors.foreground} strokeWidth={1.75} />
            <Heading size="md" className="font-semibold">
              Schedule send
            </Heading>
          </View>
          <IconButton icon={X} label="Close" onPress={onClose} />
        </ModalHeader>
        <ModalBody className="mb-4 mt-3">
          <View className="gap-1">
            {presets.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => onPick(p.date)}
                className="flex-row items-center justify-between rounded-lg px-3 py-2.5 data-[hover=true]:bg-accent data-[active=true]:bg-accent"
              >
                <Text size="sm">{p.label}</Text>
                <Text size="sm" className="text-muted-foreground">
                  {formatWhen(p.date)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="mt-4 gap-2 border-t border-border pt-4">
            <Text size="xs" className="font-semibold uppercase tracking-wider text-muted-foreground">
              Pick a date and time
            </Text>
            <DateTimeFields date={fields.date} time={fields.time} onChange={(date, time) => setFields({ date, time })} />
            <Text size="xs" className={valid ? "text-muted-foreground" : "text-destructive"}>
              {custom === null ? "Enter a valid date and time" : valid ? formatWhen(custom) : "Choose a time in the future"}
            </Text>
          </View>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button disabled={!valid} onPress={() => custom && onPick(custom)}>
            <ButtonText>{confirmLabel}</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
