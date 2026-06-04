/**
 * Renderer-side diff entry-point. Thin re-export of the shared
 * `@shared/text/diff/computeDiffHunks` module so the Checkpoints UI
 * (and any future renderer caller) shares one algorithm + one set of
 * tests with the main-process `edit` tool. Pre-deduplication this
 * file carried a near-byte-identical copy of the LCS walker; that
 * fork is gone — the canonical implementation lives in shared.
 *
 * Kept as a separate file so existing call sites keep their import
 * path stable; only the implementation moved.
 */

export { computeDiffHunks as computeDiffHunksClient } from '@shared/text/diff/computeDiffHunks.js';
