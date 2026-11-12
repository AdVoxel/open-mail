import { TextInput } from "react-native";
import { useColors } from "@/src/lib/theme";

export interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const inputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans";

/** Phones: typed dates for now (the web/desktop build uses the browser's pickers, see DateTimeFields.web.tsx). */
export function DateField({ value, onChange, disabled }: FieldProps) {
  const colors = useColors();
  return (
    <TextInput value={value} onChangeText={onChange} editable={!disabled} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} className={`w-36 ${inputClass}`} />
  );
}

export function TimeField({ value, onChange, disabled }: FieldProps) {
  const colors = useColors();
  return (
    <TextInput value={value} onChangeText={onChange} editable={!disabled} placeholder="HH:MM" placeholderTextColor={colors.muted} className={`w-24 ${inputClass}`} />
  );
}
