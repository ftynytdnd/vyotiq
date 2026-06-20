/**
 * Detect filesystem paths on the clipboard (Explorer copy, URI lists).
 */

export function looksLikeAbsoluteFilePath(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes('\n') || t.includes('\r')) return false;
  if (/^file:/i.test(t)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  if (t.startsWith('\\\\')) return true;
  if (t.startsWith('/') && !t.startsWith('//')) return true;
  return false;
}

/** Normalize `file://` URIs and URI-list lines to host paths. */
export function normalizeClipboardPath(text: string): string {
  const t = text.trim();
  if (!/^file:/i.test(t)) return t;
  try {
    const url = new URL(t);
    let path = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
    return path;
  } catch {
    return t;
  }
}

/** Case-insensitive path key for deduping clipboard host paths vs plain-text paths. */
export function normalizePathComparisonKey(path: string): string {
  return normalizeClipboardPath(path.trim()).replace(/\\/g, '/').toLowerCase();
}

export function parseFileUriList(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^file:/i.test(trimmed)) continue;
    const path = normalizeClipboardPath(trimmed);
    if (path) out.push(path);
  }
  return out;
}
