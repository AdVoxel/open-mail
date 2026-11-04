import { useWindowDimensions } from "react-native";

/** Three-pane layout from this width up; stacked screens below it. */
export const WIDE_BREAKPOINT = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "14:05" today, "Mon" this week, "4 Nov" this year, "4 Nov 2025" otherwise. */
export function formatListDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) return formatTime(date);
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return date.toLocaleDateString(undefined, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Today 18:00", "Tomorrow 08:00", "Mon 4 Nov, 08:00". */
export function formatWhen(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, now)) return `Today ${formatTime(date)}`;
  if (sameDay(date, tomorrow)) return `Tomorrow ${formatTime(date)}`;
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${formatTime(date)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const words = name.replace(/[<>"@.].*$/, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return ((words[0]![0] ?? "") + (words.length > 1 ? (words[words.length - 1]![0] ?? "") : "")).toUpperCase();
}

/** Quick choices for "Schedule send". */
export function schedulePresets(now = new Date()): { label: string; date: Date }[] {
  const at = (daysAhead: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const inAnHour = new Date(now.getTime() + 60 * 60_000);
  inAnHour.setSeconds(0, 0);
  const presets = [{ label: "In 1 hour", date: inAnHour }];
  if (now.getHours() < 17) presets.push({ label: "This evening", date: at(0, 18) });
  presets.push({ label: "Tomorrow morning", date: at(1, 8) });
  presets.push({ label: "Tomorrow afternoon", date: at(1, 13) });
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  if (daysToMonday > 1) presets.push({ label: "Monday morning", date: at(daysToMonday, 8) });
  return presets;
}

/** Parse "YYYY-MM-DD" + "HH:MM" in local time. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const result = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  return Number.isNaN(result.getTime()) ? null : result;
}

export function toLocalInputs(date: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}
