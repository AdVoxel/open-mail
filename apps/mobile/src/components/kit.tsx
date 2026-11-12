// Small building blocks on top of the gluestack-ui components, so screens share one look.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentRef, type ComponentType, type ReactNode } from "react";
import { ActivityIndicator, Dimensions, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideProps } from "lucide-react-native";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@/components/ui/alert-dialog";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Toast, ToastDescription, ToastTitle, useToast } from "@/components/ui/toast";
import { initials } from "@/src/lib/format";
import { useColors } from "@/src/lib/theme";

export type Icon = ComponentType<LucideProps>;

export function IconButton({
  icon: IconComponent,
  onPress,
  label,
  color,
  active,
  disabled,
  size = 18,
}: {
  icon: Icon;
  onPress: () => void;
  label: string;
  color?: string;
  active?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  const colors = useColors();
  const tooltip = useTooltip();
  return (
    <View ref={tooltip.ref}>
      <Pressable
        onPress={() => {
          tooltip.hide();
          onPress();
        }}
        onHoverIn={tooltip.schedule}
        onHoverOut={tooltip.hide}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityRole="button"
        className={`h-9 w-9 items-center justify-center rounded-lg data-[hover=true]:bg-accent data-[active=true]:bg-accent ${
          active ? "bg-accent" : ""
        }`}
      >
        <IconComponent size={size} color={color ?? colors.foreground} strokeWidth={1.75} />
      </Pressable>
      {tooltip.side ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: "100%", marginTop: 4, zIndex: 50, ...(tooltip.side === "right" ? { right: 0 } : tooltip.side === "left" ? { left: 0 } : { left: "50%", transform: [{ translateX: "-50%" }] }) }}
          className="rounded-md bg-foreground px-2 py-1"
        >
          <Text size="xs" className="font-medium text-background web:whitespace-nowrap">
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const TOOLTIP_DELAY_MS = 500;

/**
 * A hover tooltip for web/desktop that shows only after the pointer rests a
 * moment. `side` keeps it inside the window: near the right edge it lines up
 * with the button's right side, near the left edge with its left side.
 */
function useTooltip() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [side, setSide] = useState<"left" | "center" | "right" | null>(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setSide(null);
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      ref.current?.measureInWindow((x, _y, width) => {
        const windowWidth = Dimensions.get("window").width;
        setSide(x + width / 2 > windowWidth - 120 ? "right" : x + width / 2 < 120 ? "left" : "center");
      });
    }, TOOLTIP_DELAY_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { ref, side, schedule, hide };
}

/** Top bar of a pane or screen. */
export function Header({
  title,
  subtitle,
  left,
  right,
  safeTop = false,
}: {
  title?: ReactNode;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  safeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: safeTop ? insets.top : 0 }} className="border-b border-border bg-background">
      <View className="h-14 flex-row items-center gap-1 px-3">
        {left}
        <View className="min-w-0 flex-1 px-1">
          {typeof title === "string" ? (
            <Text numberOfLines={1} className="text-base font-semibold tracking-tight">
              {title}
            </Text>
          ) : (
            title
          )}
          {subtitle ? (
            <Text size="xs" numberOfLines={1} className="text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View className="flex-row items-center gap-0.5">{right}</View> : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon: IconComponent, title, message, action }: { icon: Icon; title: string; message?: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <IconComponent size={24} color={colors.muted} strokeWidth={1.5} />
      </View>
      <Text className="text-center font-medium">{title}</Text>
      {message ? <Text size="sm" className="max-w-sm text-center text-muted-foreground">{message}</Text> : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <ActivityIndicator color={colors.muted} />
      {label ? <Text size="sm" className="text-muted-foreground">{label}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="m-3 flex-row items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
      <Text size="sm" className="flex-1 text-destructive">
        {message}
      </Text>
      {onRetry ? (
        <Button size="sm" variant="ghost" onPress={onRetry}>
          <ButtonText>Retry</ButtonText>
        </Button>
      ) : null}
    </View>
  );
}

/** Round avatar with initials; `color` paints it (white text), otherwise it is neutral. */
export function Initials({ name, size = 36, color }: { name: string; size?: number; color?: string }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      className={`items-center justify-center ${color ? "" : "bg-muted"}`}
    >
      <Text style={{ fontSize: size * 0.36, color: color ? "#ffffff" : undefined }} className={`font-semibold ${color ? "" : "text-muted-foreground"}`}>
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * A label as a small pill: filled with its color when `on`, outlined otherwise
 * (used in the picker for labels not on the message).
 */
export function LabelChip({
  name,
  color,
  on = true,
  onPress,
}: {
  name: string;
  color: string;
  on?: boolean;
  onPress?: () => void;
}) {
  const chip = (
    <View
      style={on ? { backgroundColor: color, borderColor: color } : { borderColor: color }}
      className="flex-row items-center gap-1 rounded-full border px-2 py-0.5"
    >
      {!on ? <View style={{ backgroundColor: color }} className="h-1.5 w-1.5 rounded-full" /> : null}
      <Text size="xs" numberOfLines={1} style={on ? { color: "#ffffff" } : undefined} className="font-medium">
        {name}
      </Text>
    </View>
  );
  if (!onPress) return chip;
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={name}>
      {chip}
    </Pressable>
  );
}

/** Small round color swatch, e.g. for an account. */
export function ColorDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" className="px-1 pb-2 pt-6 font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </Text>
  );
}

/** Rounded group of rows, like iOS settings. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`overflow-hidden rounded-xl border border-border bg-background ${className}`}>{children}</View>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 ${o.value === value ? "bg-background shadow-xs" : "data-[hover=true]:bg-background/50"}`}
        >
          <Text size="sm" className={o.value === value ? "font-medium" : "text-muted-foreground"}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ toasts

export interface NotifyOptions {
  /** A button in the notice, e.g. Undo. Pressing it closes the notice. */
  action?: { label: string; onPress: () => void };
  /** How long it stays, in ms. */
  duration?: number;
}

export function useNotify() {
  const toast = useToast();
  return useCallback(
    (title: string, description?: string, kind: "info" | "error" = "info", options: NotifyOptions = {}) => {
      toast.show({
        placement: "bottom",
        duration: options.duration ?? (kind === "error" ? 6000 : 3000),
        render: ({ id }) => (
          <Toast nativeID={`toast-${id}`} action={kind === "error" ? "error" : "muted"} className="min-w-[260px] max-w-[420px] flex-row items-center gap-3 border shadow-hard-2">
            <View className="min-w-0 flex-1 gap-1">
              <ToastTitle size="sm" className={kind === "error" ? "text-destructive" : ""}>
                {title}
              </ToastTitle>
              {description ? <ToastDescription size="sm">{description}</ToastDescription> : null}
            </View>
            {options.action ? (
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onPress={() => {
                  toast.close(id);
                  options.action!.onPress();
                }}
              >
                <ButtonText>{options.action.label}</ButtonText>
              </Button>
            ) : null}
          </Toast>
        ),
      });
    },
    [toast],
  );
}

// ---------------------------------------------------------- confirm dialog

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>(undefined);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = undefined;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog isOpen={options !== null} onClose={() => close(false)} size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <Heading size="md" className="font-semibold">
              {options?.title}
            </Heading>
          </AlertDialogHeader>
          {options?.message ? (
            <AlertDialogBody className="mb-4 mt-2">
              <Text size="sm" className="text-muted-foreground">
                {options.message}
              </Text>
            </AlertDialogBody>
          ) : null}
          <AlertDialogFooter className="mt-2">
            <Button variant="outline" onPress={() => close(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button variant={options?.destructive ? "destructive" : "default"} onPress={() => close(true)}>
              <ButtonText>{options?.confirmLabel ?? "OK"}</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}

// ------------------------------------------------------------ form rows

const labeledInputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";

/** A labelled text field (Settings forms). */
export function LabeledInput({
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
        className={labeledInputClass}
      />
    </View>
  );
}

/** A label (and hint) with a switch. */
export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
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
