/**
 * Pure XML body escaper. Escapes the three characters that can confuse an
 * LLM's XML-tag parser when they appear inside element bodies or attribute
 * values: `&`, `<`, `>`.
 *
 * This is critical for the Prime Directives boundary: a hostile user paste
 * containing the literal string `</system_instructions>` would otherwise
 * close the harness boundary and let arbitrary instructions through.
 *
 * Use it via `wrapXml(tag, body, attrs, { escape: true })` for any content
 * that originated outside the trust boundary (user prompts, file contents,
 * tool outputs, sub-agent text).
 */

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
};

export function escapeXmlBody(s: string): string {
  return s.replace(/[&<>]/g, (c) => XML_ESCAPES[c] ?? c);
}

/**
 * Attribute-value escaper. Extends `escapeXmlBody` with the quote
 * characters that terminate an attribute value; without this, any
 * attribute sourced from user / agent / filesystem data (e.g. a file
 * path or error message containing `"`) would break the surrounding
 * element and let the model misparse the surrounding envelope.
 *
 * Use this for EVERY value you interpolate inside an `attr="…"` slot.
 * `wrapXml` routes its attribute map through here; ad-hoc string
 * interpolation (see `contextManager.inlineFiles`) must call this
 * helper directly.
 */
const XML_ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
};

export function escapeXmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ATTR_ESCAPES[c] ?? c);
}
