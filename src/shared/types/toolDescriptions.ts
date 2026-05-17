/**
 * One-liner descriptions for every registered tool. Mirrored directly
 * from the OpenAI-compat schema descriptions in `src/main/tools/*.tool.ts`
 * (single source of truth — keep these in sync with the schema strings;
 * tests can pin the parity if drift becomes a real concern).
 *
 * Lives in `@shared/` so the renderer can show user-facing tool
 * rationale (e.g. inside the sub-agent Briefing's Scope list)
 * without crossing the IPC boundary or duplicating string content.
 *
 * Pure data — no imports beyond the shared type union.
 */

import type { ToolName } from './tool.js';

/**
 * Compact, user-facing one-liner for each tool. Trimmed to a single
 * sentence so the Briefing's Scope list stays scannable without
 * making the user read three lines per tool.
 */
export const TOOL_ONE_LINERS: Record<ToolName, string> = {
  bash: 'Run a shell command in the workspace root and capture stdout/stderr.',
  ls: 'Recursively list files and folders within the workspace.',
  read: 'Read a UTF-8 text file inside the workspace; returns line-numbered content.',
  edit: 'Edit a file surgically (oldString → newString) or create a new file.',
  delete: 'Delete a file from the workspace; pre-state is snapshotted so it can be reverted.',
  search: 'Local file grep (default) or web search (when permitted).',
  memory: 'Read / write / append persistent markdown notes (global meta-rules or workspace notes).',
  recall: 'Read-only recall of other conversations the user has had with the agent.',
  report: 'Write a self-contained HTML report to .vyotiq/reports/ with an Open-in-browser affordance.',
  unknown: 'Unrecognised tool — the host could not resolve this name to a registered tool.'
};
