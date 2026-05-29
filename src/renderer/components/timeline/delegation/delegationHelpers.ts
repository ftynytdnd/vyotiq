/** Shared helpers for inline delegation stream rendering. */

import type { ToolName } from '@shared/types/tool.js';
import {
  toolGroupSummary,
  type FileEditGroupChild,
  type ToolGroupChild
} from '../reducer/deriveRows.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';

export function workerTagFromIndex(index: number): string {
  return `W${index + 1}`;
}

export function footnoteMarker(oneBasedIndex: number): string {
  const digits = String(oneBasedIndex)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] ?? d)
    .join('');
  return `[${digits}]`;
}

export function formatToolGroupFootnote(toolName: ToolName, children: ToolGroupChild[]): string {
  const { verb, primary, suffix } = toolGroupSummary(toolName, children);
  const head = primary ? `${verb} ${primary}` : verb;
  return `${head}${suffix}`.trim();
}

export function formatFileEditFootnote(items: FileEditGroupChild[]): string {
  const primary = items[0]?.filePath ?? '';
  const rest = Math.max(0, items.length - 1);
  const suffix = rest > 0 ? ` and ${rest} other file${rest === 1 ? '' : 's'}` : '';
  return primary ? `Edited ${primary}${suffix}` : 'Edited files';
}

export function rowFootnoteLabel(row: DisplayRow): string | null {
  if (row.kind === 'tool-group') {
    return formatToolGroupFootnote(row.toolName, row.children);
  }
  if (row.kind === 'file-edit-group') {
    return formatFileEditFootnote(row.children);
  }
  return null;
}

export function workerHasInlineOutput(rows: DisplayRow[]): boolean {
  return rows.some(
    (r) =>
      r.kind === 'assistant-text' ||
      r.kind === 'reasoning-line' ||
      r.kind === 'tool-group' ||
      r.kind === 'file-edit-group'
  );
}
