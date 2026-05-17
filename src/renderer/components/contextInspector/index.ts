/**
 * Context Inspector public surface.
 *
 * Only the slide-over container is re-exported — the modular
 * subcomponents stay private to the folder so a future refactor
 * can rearrange them without churning every consumer.
 *
 * The Inspector is mounted ONCE in `App.tsx` (lazy-loaded) and
 * reads its open / closed state from `useContextSummaryStore`.
 * Other surfaces (the composer's `TokenUsagePill`, the timeline's
 * `ContextSummaryRow`) push state INTO the store rather than
 * importing the panel directly so the lazy-load split stays
 * effective.
 */

export { ContextInspectorPanel } from './ContextInspectorPanel.js';
