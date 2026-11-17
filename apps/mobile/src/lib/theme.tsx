import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";
import { vars } from "nativewind";
import type { ModeType } from "@/components/ui/gluestack-ui-provider";
import { loadJson, saveJson } from "./storage";

const STORAGE_KEY = "mail.theme";
const ACCENT_KEY = "mail.accent";
const SURFACES_KEY = "mail.surfaces";

/** The two areas whose background can be chosen: the main panel, and the sidebar/drawers. */
export type SurfaceArea = "panel" | "drawer";
/** Chosen backgrounds (#rrggbb) per theme; missing = the default. Light and dark are separate so text stays readable. */
type Surfaces = Record<"light" | "dark", Partial<Record<SurfaceArea, string>>>;

const DEFAULTS = {
  light: { panel: "#ffffff", drawer: "#fafafa" },
  dark: { panel: "#0a0a0a", drawer: "#171717" },
} as const;

/** Backgrounds to pick from, per theme (light tints for light mode, deep shades for dark). */
export const SURFACE_PRESETS = {
  light: [
    { label: "White", color: "#ffffff" },
    { label: "Snow", color: "#fafafa" },
    { label: "Stone", color: "#f5f5f4" },
    { label: "Cream", color: "#fdf8ee" },
    { label: "Sky", color: "#f0f6ff" },
    { label: "Mint", color: "#effaf4" },
    { label: "Rose", color: "#fdf2f4" },
    { label: "Lavender", color: "#f5f3ff" },
    { label: "Slate", color: "#eef2f6" },
  ],
  dark: [
    { label: "Black", color: "#0a0a0a" },
    { label: "Charcoal", color: "#171717" },
    { label: "Graphite", color: "#232326" },
    { label: "Navy", color: "#0f172a" },
    { label: "Midnight", color: "#111827" },
    { label: "Forest", color: "#0f1d17" },
    { label: "Plum", color: "#1c1424" },
    { label: "Espresso", color: "#1c1714" },
    { label: "Ocean", color: "#0b1f2a" },
  ],
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** "#rrggbb" → "r g b", the form the theme's CSS variables take. */
function rgbTriple(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

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
  surfaces: Surfaces;
  /** Sets (or with null, resets) an area's background for the theme in use. */
  setSurface: (area: SurfaceArea, color: string | null) => void;
}

const Context = createContext<ThemeState | null>(null);

export function ThemeModeProvider({ children }: { children: (mode: ModeType) => ReactNode }) {
  const [mode, setModeState] = useState<ModeType>("system");
  const [accentId, setAccentId] = useState<AccentId>("blue");
  const [surfaces, setSurfaces] = useState<Surfaces>({ light: {}, dark: {} });
  const system = useColorScheme();
  const dark = mode === "dark" || (mode === "system" && system === "dark");

  useEffect(() => {
    void loadJson<ModeType>(STORAGE_KEY).then((saved) => saved && setModeState(saved));
    void loadJson<string>(ACCENT_KEY).then((saved) => saved && setAccentId(accentOf(saved).id));
    void loadJson<Surfaces>(SURFACES_KEY).then((saved) => saved && setSurfaces({ light: saved.light ?? {}, dark: saved.dark ?? {} }));
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
      surfaces,
      setSurface: (area: SurfaceArea, color: string | null) => {
        if (color !== null && !HEX.test(color)) return;
        setSurfaces((current) => {
          const theme = dark ? "dark" : "light";
          const next = { ...current, [theme]: { ...current[theme], [area]: color?.toLowerCase() ?? undefined } };
          if (color === null) delete next[theme][area];
          void saveJson(SURFACES_KEY, next);
          return next;
        });
      },
    }),
    [mode, accentId, surfaces, dark],
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
  const chosen = theme?.surfaces[dark ? "dark" : "light"] ?? {};
  const defaults = DEFAULTS[dark ? "dark" : "light"];
  return {
    dark,
    /** The main panel's background (chosen in Settings, or the default). */
    background: chosen.panel ?? defaults.panel,
    /** The sidebar's and drawers' background. */
    surface: chosen.drawer ?? defaults.drawer,
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

/**
 * Puts the chosen main-panel background into the theme's --background
 * variable, so every `bg-background` follows it. Web: on the page root (it
 * beats the light/dark rules); native: returns the style for the root view.
 */
export function useSurfaceVars() {
  const { background, dark } = useColors();
  const theme = useContext(Context);
  const custom = theme?.surfaces[dark ? "dark" : "light"].panel;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement.style;
    if (custom) root.setProperty("--background", rgbTriple(custom));
    else root.removeProperty("--background");
  }, [custom]);
  return useMemo(() => (Platform.OS !== "web" && custom ? vars({ "--background": rgbTriple(background) }) : undefined), [custom, background]);
}
