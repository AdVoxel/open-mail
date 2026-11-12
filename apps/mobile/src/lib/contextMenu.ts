/** Leaves the browser's right-click menu in text fields (paste, spelling); hides it everywhere else. */
export function blockContextMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  event.preventDefault();
}
