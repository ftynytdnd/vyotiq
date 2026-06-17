import { MAX_TOOL_OUTPUT_CHARS } from '../constants.js';
import { redactSensitiveText } from './redactSecretsInText.js';

/** Truncate at a UTF-16 code-unit boundary without splitting a surrogate pair. */
export function truncateUtf8Safe(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  let cut = maxChars;
  const lastCode = s.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
  return s.slice(0, cut);
}

const TRUNC_MARKER = '\n…[truncated]';

/** Cap tool output retained in LLM context (see `MAX_TOOL_OUTPUT_CHARS`). */
export function truncateToolOutputForContext(
  s: string,
  maxChars: number = MAX_TOOL_OUTPUT_CHARS
): string {
  const redacted = redactSensitiveText(s);
  if (redacted.length <= maxChars) return redacted;
  const budget = Math.max(1, maxChars - TRUNC_MARKER.length);
  return truncateUtf8Safe(redacted, budget) + TRUNC_MARKER;
}
