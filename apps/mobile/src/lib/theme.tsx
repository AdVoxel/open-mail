import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import type { ModeType } from "@/components/ui/gluestack-ui-provider";
import { loadJson, saveJson } from "./storage";

const STORAGE_KEY = "mail.theme";

const Context = createContext<{ mode: ModeType; setMode: (mode: ModeType) => void } | null>(null);

export function ThemeModeProvider({ children }: { children: (mode: ModeType) => ReactNode }) {
  const [mode, setModeState] = useState<ModeType>("system");

  useEffect(() => {
    void loadJson<ModeType>(STORAGE_KEY).then((saved) => saved && setModeState(saved));
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: ModeType) => {
        setModeState(next);
        void saveJson(STORAGE_KEY, next);
      },
    }),
    [mode],
  );
  return <Context.Provider value={value}>{children(mode)}</Context.Provider>;
}

export function useThemeMode() {
  const value = useContext(Context);
  if (!value) throw new Error("useThemeMode must be used inside ThemeModeProvider");
  return value;
}

/** Raw colors for things that can't take a className (icons, navigation, spinners). */
export function useColors() {
  const system = useColorScheme();
  const mode = useContext(Context)?.mode ?? "system";
  const dark = mode === "dark" || (mode === "system" && system === "dark");
  return {
    dark,
    background: dark ? "#0a0a0a" : "#ffffff",
    surface: dark ? "#171717" : "#fafafa",
    foreground: dark ? "#fafafa" : "#0a0a0a",
    muted: dark ? "#a1a1a1" : "#737373",
    border: dark ? "#2e2e2e" : "#e5e5e5",
    accent: dark ? "#60a5fa" : "#2563eb",
    destructive: dark ? "#ff6467" : "#e7000b",
    star: "#f59e0b",
  };
}
