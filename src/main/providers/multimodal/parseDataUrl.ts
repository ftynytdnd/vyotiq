/**
 * Parse `data:{mime};base64,{payload}` URLs from prepared vision parts.
 */

export interface ParsedDataUrl {
  mime: string;
  base64: string;
}

export function parseDataUrl(url: string): ParsedDataUrl | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice(5, comma);
  const base64 = url.slice(comma + 1);
  if (!header.endsWith(';base64') || base64.length === 0) return null;
  const mime = header.slice(0, -';base64'.length);
  if (!mime) return null;
  return { mime, base64 };
}
