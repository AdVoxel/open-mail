import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import type { ModeType } from "@/components/ui/gluestack-ui-provider";
import { loadJson, saveJson } from "./storage";

const STORAGE_KEY = "mail.theme";
const ACCENT_KEY = "mail.accent";

/** Accent colors to pick from in Settings, each with a lighter shade for dark mode. */
export const ACCENTS = [
  { id: "blue", label: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { id: "indigo", label: "Indigo", light: "#4f46e5", dark: "#818cf8" },
  { id: "violet", label: "Violet", light: "#7c3aed", dark: "#a78bfa" },
  { id: "pink", label: "Pink", light: "#db2777", dark: "#f472b6" },
  { id: "red", label: "Red", light: "#dc2626", dark: "#f87171" },
  { id: "orange", label: "Orange", light: "#ea580c", dark: "#fb923c" },
  { id: "green", label: "Green", light: "#16a34a", dark: "#4ade80" },
  { id: "teal", label: "Teal", light: "#0d9488", dark: "#2dd4bf" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export type Accent = (typeof ACCENTS)[number];

function accentOf(id: string | null | undefined): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

interface ThemeState {
  mode: ModeType;
  setMode: (mode: ModeType) => void;
  accent: Accent;
  setAccent: (id: AccentId) => void;
}

const Context = createContext<ThemeState | null>(null);

export function ThemeModeProvider({ children }: { children: (mode: ModeType) => ReactNode }) {
  const [mode, setModeState] = useState<ModeType>("system");
  const [accentId, setAccentId] = useState<AccentId>("blue");

  useEffect(() => {
    void loadJson<ModeType>(STORAGE_KEY).then((saved) => saved && setModeState(saved));
    void loadJson<string>(ACCENT_KEY).then((saved) => saved && setAccentId(accentOf(saved).id));
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: ModeType) => {
        setModeState(next);
        void saveJson(STORAGE_KEY, next);
      },
      accent: accentOf(accentId),
      setAccent: (next: AccentId) => {
        setAccentId(next);
        void saveJson(ACCENT_KEY, next);
      },
    }),
    [mode, accentId],
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
  const theme = useContext(Context);
  const mode = theme?.mode ?? "system";
  const accent = theme?.accent ?? ACCENTS[0];
  const dark = mode === "dark" || (mode === "system" && system === "dark");
  return {
    dark,
    background: dark ? "#0a0a0a" : "#ffffff",
    surface: dark ? "#171717" : "#fafafa",
    foreground: dark ? "#fafafa" : "#0a0a0a",
    muted: dark ? "#a1a1a1" : "#737373",
    border: dark ? "#2e2e2e" : "#e5e5e5",
    accent: dark ? accent.dark : accent.light,
    /** Background of unread rows: a soft wash of the accent. */
    unread: `${dark ? accent.dark : accent.light}${dark ? "38" : "2e"}`,
    unreadHover: `${dark ? accent.dark : accent.light}${dark ? "4d" : "40"}`,
    destructive: dark ? "#ff6467" : "#e7000b",
    star: "#f59e0b",
  };
}
