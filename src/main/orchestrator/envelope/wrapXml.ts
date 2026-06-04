/**
 * `wrapXml` — wraps a body inside `<tag>…</tag>` envelopes. The body is NOT
 * escaped by default (most of our wrapped content is harness markdown we
 * intentionally want kept readable). Pass `{ escape: true }` for any body
 * sourced outside the trust boundary — user prompts, file contents,
 * untrusted text, etc. This is the only safe way to embed untrusted content
 * inside the prompt without risking a `</system_instructions>` injection.
 *
 * Attribute values are ALWAYS escaped (they're untrusted by definition).
 */

import { escapeXmlBody, escapeXmlAttr } from './escapeXmlBody.js';

interface WrapXmlOptions {
  /** Escape `&`, `<`, `>` in the body before wrapping. Default false. */
  escape?: boolean;
}

export function wrapXml(
  tag: string,
  body: string,
  attrs?: Record<string, string | number | boolean>,
  opts?: WrapXmlOptions
): string {
  const attrStr = attrs
    ? Object.entries(attrs)
      // Attribute values MUST be quote-escaped (`"` → `&quot;`) or a
      // value containing `"` breaks the surrounding element. See
      // `escapeXmlAttr` for the full escape set.
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`)
      .join('')
    : '';
  const safeBody = opts?.escape === true ? escapeXmlBody(body) : body;
  return `<${tag}${attrStr}>\n${safeBody}\n</${tag}>`;
}

/** Public re-export so callers can escape ad-hoc strings (e.g. when
 *  building attribute lists outside `wrapXml`). The body-only escaper
 *  (`escapeXmlBody`) lives in `./escapeXmlBody.js` and is imported
 *  directly by the few internal call sites that need it; we don't
 *  re-export it here to keep the public envelope surface minimal. */
export { escapeXmlAttr } from './escapeXmlBody.js';
