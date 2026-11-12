import { useEffect, useState } from "react";
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

/** Full-window viewer for an image or video attachment. Escape or a click outside closes it. */
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

  return (
    <div
      role="dialog"
      aria-label={attachment.filename}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.86)", display: "flex", flexDirection: "column" }}
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
          <video src={url} controls autoPlay onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        ) : (
          <img
            src={url}
            alt={attachment.filename}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, background: "#ffffff" }}
          />
        )}
      </div>
    </div>
  );
}
