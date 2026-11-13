/**
 * The open-tracking image in a message: <img … /t/<32 hex>.gif …>. Removed
 * wherever you read your own mail, so reading it here never counts as an open.
 */
export const TRACKING_PIXEL = /<img\b[^>]*\/t\/[0-9a-f]{32}\.gif[^>]*>/gi;

/** `html` without any tracking image. */
export function stripTrackingPixel(html: string): string {
  return html.replace(TRACKING_PIXEL, "");
}
