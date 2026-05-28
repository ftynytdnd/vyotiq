/**
 * Sanitizes raw sub-agent task / message strings for safe display in
 * the Agent Trace panel. Strips orchestration XML directives, control
 * characters, and excessive whitespace so the resulting label is a
 * clean, single-line, human-readable summary.
 *
 * Reuses the shared `stripDelegatesForDisplay` helper that powers the
 * timeline's own directive-stripping logic — same regex constants,
 * same code-fence masking — so there's exactly one source of truth for
 * which tags are machine-only vs user-visible.
 */

import { stripDelegatesForDisplay } from '@shared/text/strip.js';

/**
 * Strip XML orchestration markup, control chars, and collapse runs of
 * whitespace into a trimmed single-line string suitable for tab labels,
 * panel titles, and error message badges.
 *
 * Callers typically truncate the result further (e.g. `.slice(0, 36)`)
 * for compact surfaces.
 */
export function sanitizeTraceTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  // Strip orchestration directives (<delegate>, <result>, <task>, …)
  const stripped = stripDelegatesForDisplay(raw);
  // Collapse all whitespace (newlines, tabs, runs of spaces) into
  // single spaces and trim leading/trailing junk.
  return stripped.replace(/[\s\u200B\u00A0]+/g, ' ').trim();
}
