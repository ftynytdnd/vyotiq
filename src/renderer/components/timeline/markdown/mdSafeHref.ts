/**
 * Renderer-side markdown link allowlist — blocks executable URL schemes
 * before they reach `<a href>`. React-markdown does not sanitize hrefs.
 */

const BLOCKED_SCHEME = /^(javascript|vbscript|data):/i;
const EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function mdSafeHref(href: string | undefined): string | undefined {
  if (href == null) return undefined;
  const trimmed = href.trim();
  if (trimmed.length === 0) return undefined;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return undefined;

  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }

  if (!EXPLICIT_SCHEME.test(trimmed)) {
    return trimmed;
  }

  if (BLOCKED_SCHEME.test(trimmed)) return undefined;

  try {
    const url = new URL(trimmed);
    if (!ALLOWED_SCHEMES.has(url.protocol.toLowerCase())) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
