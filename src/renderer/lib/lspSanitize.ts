/**
 * Minimal HTML sanitizer for LSP hover tooltips.
 */

const BLOCKED_TAGS = /<\/?(?:script|iframe|object|embed|link|style|meta|base|form)\b[^>]*>/gi;
const EVENT_ATTRS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URLS = /href\s*=\s*("|')\s*javascript:[^"']*\1/gi;

export function sanitizeLspHtml(html: string): string {
  return html
    .replace(BLOCKED_TAGS, '')
    .replace(EVENT_ATTRS, '')
    .replace(JS_URLS, 'href="#"');
}
