/**
 * Deliverables policy — timeline markdown vs HTML report thresholds.
 * Referenced by harness prose, tool briefs, and auto-report UI.
 */

/** Keep assistant timeline prose under this line count when possible. */
export const TIMELINE_MARKDOWN_LINE_BUDGET = 80;

/** Prefer `report` when a single answer would exceed this many lines. */
export const REPORT_TOOL_LINE_THRESHOLD = TIMELINE_MARKDOWN_LINE_BUDGET;

/** Offer a run-summary HTML report after edits at or above this count. */
export const AUTO_REPORT_MIN_EDITS = 3;

/** Offer a run-summary when at least this many distinct files were edited. */
export const AUTO_REPORT_MIN_FILES = 2;

/** Max prompt excerpt shown in auto-generated run summary HTML (and IPC payload). */
export const RUN_SUMMARY_PROMPT_PREVIEW_MAX_CHARS = 240;

/** Clip a user prompt for run-summary IPC + HTML (fits the 1 KiB IPC string cap). */
export function clipRunSummaryPromptPreview(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= RUN_SUMMARY_PROMPT_PREVIEW_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, RUN_SUMMARY_PROMPT_PREVIEW_MAX_CHARS - 1)}…`;
}

/** Auto-sent when the user clicks the settings-gated "AI report" footer action. */
export const AI_RUN_SUMMARY_USER_PROMPT =
  'Generate an HTML report for this edit run using the `report` tool. ' +
  'Include a severity table and PR-style directory groups for every file changed. ' +
  'Keep the timeline to one short paragraph, then call `report` and `finish`.';
