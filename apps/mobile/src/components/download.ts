/** Downloads aren't wired up on phones yet; the web/desktop build saves files (download.web.ts). */
export async function saveFile(_blob: Blob, _filename: string): Promise<boolean> {
  return false;
}
