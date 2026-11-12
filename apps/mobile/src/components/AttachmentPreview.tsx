import type { AttachmentInfo } from "@mail-app/api-client";

export interface AttachmentPreviewProps {
  attachment: AttachmentInfo;
  /** Fetches the file. */
  load: () => Promise<Blob>;
  onDownload: () => void;
  onClose: () => void;
}

/** Phones: no preview yet, attachments download (AttachmentPreview.web.tsx has the viewer). */
export function canPreview(_contentType: string): boolean {
  return false;
}

export function AttachmentPreview(_props: AttachmentPreviewProps) {
  return null;
}
