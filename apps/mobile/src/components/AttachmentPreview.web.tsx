import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ActivityIndicator, View } from "react-native";
import { Download, X } from "lucide-react-native";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatSize } from "@/src/lib/format";
import type { AttachmentPreviewProps } from "./AttachmentPreview";

/** Images and videos the browser can show. */
export function canPreview(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i.test(contentType) || /^video\/(mp4|webm|ogg|quicktime)$/i.test(contentType);
}

function ToolButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} className="h-9 w-9 items-center justify-center rounded-lg data-[hover=true]:bg-white/15">
      {children}
    </Pressable>
  );
}

/**
 * Stops the page behind the viewer from scrolling while it's open: the body,
 * and every scrollable area (wheel, touch and keyboard), until it closes.
 */
function useScrollLock(viewer: () => HTMLElement | null) {
  useEffect(() => {
    const body = document.body.style;
    const previous = { overflow: body.overflow, overscroll: body.overscrollBehavior };
    body.overflow = "hidden";
    body.overscrollBehavior = "none";
    // Wheel and touch moves outside a playing video's own controls go nowhere.
    const block = (e: Event) => {
      const target = e.target as Node | null;
      const inViewer = target && viewer()?.contains(target);
      if (!inViewer || !(target instanceof HTMLVideoElement)) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      const target = e.target as Node | null;
      if (target && viewer()?.contains(target)) return; // the viewer's own buttons and video keep their keys
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("wheel", block, { passive: false, capture: true });
    window.addEventListener("touchmove", block, { passive: false, capture: true });
    window.addEventListener("keydown", keys, { capture: true });
    return () => {
      body.overflow = previous.overflow;
      body.overscrollBehavior = previous.overscroll;
      window.removeEventListener("wheel", block, { capture: true });
      window.removeEventListener("touchmove", block, { capture: true });
      window.removeEventListener("keydown", keys, { capture: true });
    };
  }, [viewer]);
}

/**
 * Full-window viewer for an image or video attachment. Escape, the close
 * button or a click outside closes it. Drawn on the page body (a portal): inside
 * the message, a transformed ancestor would make "fixed" scroll with the mail.
 */
export function AttachmentPreview({ attachment, load, onDownload, onClose }: AttachmentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    load().then(
      (blob) => {
        if (cancelled) return;
        // The server may send a generic type: the attachment's own type lets the browser render it.
        objectUrl = URL.createObjectURL(blob.type === attachment.contentType ? blob : new Blob([blob], { type: attachment.contentType }));
        setUrl(objectUrl);
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isVideo = attachment.contentType.toLowerCase().startsWith("video/");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useScrollLock(useCallback(() => root, [root]));

  return createPortal(
    <div
      ref={setRoot}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        // Dark and blurred enough that the mail's own toolbar doesn't read through next to the viewer's buttons.
        background: "rgba(0,0,0,0.94)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        overscrollBehavior: "contain",
        touchAction: "none",
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <View className="h-14 flex-row items-center gap-3 px-4">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} style={{ color: "#ffffff" }} className="font-medium">
              {attachment.filename}
            </Text>
            <Text size="xs" style={{ color: "rgba(255,255,255,0.65)" }}>
              {formatSize(attachment.size)}
            </Text>
          </View>
          <ToolButton label="Download" onPress={onDownload}>
            <Download size={18} color="#ffffff" />
          </ToolButton>
          <ToolButton label="Close preview" onPress={onClose}>
            <X size={20} color="#ffffff" />
          </ToolButton>
        </View>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px 24px" }}>
        {error ? (
          <Text style={{ color: "#ffffff" }}>Couldn't load the preview: {error}</Text>
        ) : !url ? (
          <ActivityIndicator color="#ffffff" />
        ) : isVideo ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, background: "#000000", touchAction: "auto" }}
          />
        ) : (
          <img
            src={url}
            alt={attachment.filename}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, background: "#ffffff" }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
