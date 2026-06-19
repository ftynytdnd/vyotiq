/**
 * Sanitize rich HTML clipboard payloads before inserting into the composer.
 * Allowlisted tags only — strips scripts, event handlers, and unknown elements.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
  'span',
  'div',
  'blockquote'
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  '*': new Set(['class'])
};

function stripHtmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

function sanitizeElement(el: Element): void {
  const children = Array.from(el.children);
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      const text = document.createTextNode(child.textContent ?? '');
      child.replaceWith(text);
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const allowed =
        ALLOWED_ATTRS[tag]?.has(attr.name) || ALLOWED_ATTRS['*']?.has(attr.name);
      if (!allowed || attr.name.startsWith('on')) {
        child.removeAttribute(attr.name);
      }
      if (attr.name === 'href' && /^\s*javascript:/i.test(attr.value)) {
        child.removeAttribute('href');
      }
    }
    sanitizeElement(child);
  }
}

export function sanitizeComposerHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';

  const doc = new DOMParser().parseFromString(trimmed, 'text/html');
  sanitizeElement(doc.body);
  const out = doc.body.innerHTML.trim();
  return out || stripHtmlToPlain(trimmed);
}
