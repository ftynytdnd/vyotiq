/**
 * Serialise a `DiffHunk[]` to a unified-diff plain-text body suitable
 * for clipboard or external paste (e.g. into a code review tool).
 *
 * The format mirrors the canonical unified-diff syntax — `@@` header
 * followed by `+` / `-` / ` ` body lines — so the result is portable.
 *
 * Pure / no React imports — safe to call inside a `useMemo` or a
 * test harness.
 */

import type { DiffHunk } from '@shared/types/tool.js';

export function hunksToPatch(hunks: readonly DiffHunk[]): string {
  const out: string[] = [];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart} +${h.newStart} @@`);
    for (const l of h.lines) {
      out.push(`${l.kind}${l.text}`);
    }
  }
  return out.join('\n');
}
