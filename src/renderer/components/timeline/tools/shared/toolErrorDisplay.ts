/**
 * Unified tool error hint (collapsed) and body (expanded) extraction.
 */

import type { ToolResult } from '@shared/types/tool.js';

export function toolErrorHint(result: ToolResult | undefined): string | undefined {
  if (!result || result.ok) return undefined;
  return result.output?.split('\n')[0]?.trim() || result.error;
}

export function toolErrorBody(result: ToolResult | undefined): string {
  if (!result || result.ok) return '';
  if (result.output && result.output.length > 0) return result.output;
  return result.error ?? '';
}

/** Collapsed one-line error hint (already trimmed by caller when needed). */
export function collapsedToolErrorHint(hint: string): string {
  return hint;
}
