/**
 * EditDiffView — compatibility shim that delegates to the modular
 * `diff/DiffViewer`. Kept so existing imports across the codebase
 * (timeline `EditInvocation`, pending-changes panel,
 * `EditApprovalDialog`, bash/delete diff streams, sub-agent flows)
 * continue to work without changes.
 *
 * The actual implementation now lives under `./diff/`:
 *
 *   - `DiffViewer`        — top-level renderer with line-number gutter,
 *                           hunk navigator, copy button, soft-fold,
 *                           settle animation.
 *   - `DiffHunk`          — single-hunk renderer (sticky header, caps).
 *   - `DiffLine`          — single-row renderer (gutter + intra-line).
 *   - `DiffNavigator`     — prev / next + jump menu (≥ 2 hunks).
 *   - `DiffCopyButton`    — hover-revealed copy-as-patch.
 *   - `useIntraLineHighlight` — pair-wise word-diff helpers.
 *   - `softFold`          — long-context-run fold helper.
 *   - `hunksToPatch`      — pure unified-diff serialiser.
 *
 * Three render variants:
 *
 *   1. Authoritative result diff — `result.data.hunks` from a
 *      successful tool execution. Variant: `'authoritative'`.
 *   2. Pre-result preview — synthesized from the call's own
 *      `oldString` / `newString` while the tool is still running.
 *      Variant: `'preview'`.
 *   3. Failed-call "intended diff" — same synthesis as (2), but
 *      shown alongside an error pane so the user can see exactly
 *      what the model TRIED to do. Variant: `'preview'`.
 *
 * Caps preserved (test-pinned):
 *   - `MAX_VISIBLE_HUNKS = 30`
 *   - `MAX_VISIBLE_LINES_PER_HUNK = 200`
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { DiffViewer } from './diff/DiffViewer.js';
import type { DiffViewVariant } from './diff/DiffHunk.js';
import type { ReviewLinePickProps } from './diff/diffLinePick.js';

interface EditDiffViewProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  /** Passed through to `DiffViewer` for tall review modals. */
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
}

export function EditDiffView({ hunks, variant, maxHeightClass, linePick }: EditDiffViewProps) {
  return (
    <DiffViewer
      hunks={hunks}
      variant={variant}
      {...(maxHeightClass ? { maxHeightClass } : {})}
      {...(linePick ? { linePick } : {})}
    />
  );
}
