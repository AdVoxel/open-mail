import { useColors } from "@/src/lib/theme";
import type { FieldProps } from "./DateTimeFields";

function NativeInput({ type, value, onChange, disabled, width }: FieldProps & { type: "date" | "time"; width: number }) {
  const colors = useColors();
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      style={{
        width,
        height: 40,
        padding: "0 10px",
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.foreground,
        colorScheme: colors.dark ? "dark" : "light",
        fontSize: 14,
        fontFamily: "inherit",
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

/** The browser's date picker (web and desktop). */
export function DateField(props: FieldProps) {
  return <NativeInput type="date" width={160} {...props} />;
}

/** The browser's time picker (web and desktop). */
export function TimeField(props: FieldProps) {
  return <NativeInput type="time" width={120} {...props} />;
}
