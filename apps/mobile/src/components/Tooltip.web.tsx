import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useColors } from "@/src/lib/theme";

const DELAY_MS = 350;

/**
 * A hover label for a small icon (not a button). Rendered into <body>, so rows
 * below can't cover it, and only listens to hovering, so a click still reaches
 * the row underneath.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setAt({ x: r.left + r.width / 2, y: r.bottom + 6 });
    }, DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAt(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span ref={anchor} onMouseEnter={show} onMouseLeave={hide} aria-label={label} style={{ display: "inline-flex" }}>
      {children}
      {at
        ? createPortal(
            <div
              style={{
                position: "fixed",
                zIndex: 1000,
                top: at.y,
                // Centered under the icon, kept inside the window.
                left: Math.min(Math.max(at.x, 60), window.innerWidth - 60),
                transform: "translateX(-50%)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                padding: "4px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                background: colors.foreground,
                color: colors.background,
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
