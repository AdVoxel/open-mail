import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pressable, View } from "react-native";
import type { TrackingSummary } from "@mail-app/api-client";
import { useColors } from "@/src/lib/theme";
import { OpensList } from "./OpensList";

const WIDTH = 380;
const SHOW_DELAY_MS = 250;
/** Time to move the pointer from the badge onto the panel without it closing. */
const HIDE_DELAY_MS = 200;

/**
 * Hovering `children` (the views badge) shows who opened the message, in a panel
 * on top of everything: it's rendered into <body>, so rows below can't cover it.
 */
export function OpensPopover({ tracked, children }: { tracked: TrackingSummary; children: ReactNode }) {
  const colors = useColors();
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = anchor.current as unknown as HTMLElement | null;
      if (!el?.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
      // Below the badge, or above it when there's no room underneath.
      setAt(r.bottom + 260 < window.innerHeight ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
    }, SHOW_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAt(null), HIDE_DELAY_MS);
  }, []);
  const keep = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => () => clearTimeout(timer.current), []);
  // Scrolling moves the badge away from the panel: close it.
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [at]);

  return (
    <>
      <Pressable ref={anchor} onHoverIn={show} onHoverOut={hide} onPress={show} accessibilityLabel={tracked.opens ? `Opened ${tracked.opens} times` : "Tracked, not opened yet"}>
        {children}
      </Pressable>
      {at
        ? createPortal(
            <div
              onMouseEnter={keep}
              onMouseLeave={hide}
              style={{
                position: "fixed",
                zIndex: 1000,
                left: at.left,
                top: at.top,
                bottom: at.bottom,
                width: WIDTH,
                maxHeight: "60vh",
                overflowY: "auto",
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.foreground,
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              }}
            >
              <OpensList tracked={tracked} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
