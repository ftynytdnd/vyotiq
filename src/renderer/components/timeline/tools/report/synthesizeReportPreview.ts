/**
 * Predictive diff for an in-flight `report` tool call's `body` argument.
 * Mirrors `synthesizeDiffPreview` for edits — renders HTML as all-`+`
 * lines so the user sees the deliverable materialise before the tool runs.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { synthesizeCreateHunks } from '@shared/text/diff/synthesizeCreateHunks.js';

export interface ReportPreview {
  hunks: DiffHunk[];
}

export function synthesizeReportPreview(
  args: Record<string, unknown> | null | undefined
): ReportPreview | null {
  if (!args || typeof args !== 'object') return null;
  const body = args['body'];
  if (typeof body !== 'string' || body.length === 0) return null;
  return { hunks: synthesizeCreateHunks(body) };
}
