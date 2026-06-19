/**
 * Detect http(s) URLs on the clipboard for URL attachment chips.
 */

const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;

export function isClipboardHttpUrl(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes('\n') || t.includes('\r')) return false;
  return HTTP_URL_RE.test(t);
}

export function parseClipboardHttpUrl(text: string): string | null {
  const t = text.trim();
  if (!isClipboardHttpUrl(t)) return null;
  try {
    const url = new URL(t);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function urlAttachmentLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}
