/**
 * Strip orchestration `<delegate />` directives from streamed assistant
 * text before showing it to the user. The directives are machine-readable
 * side-channel content; the user shouldn't see them.
 *
 * Re-exports the shared `stripDelegatesForDisplay` from `@shared/text/strip`
 * so the renderer-side strip and the main-side strip use literally the
 * same regex constants. See `@shared/text/strip.ts` for the canonical
 * implementation (paired form, self-closing, trailing partial tag,
 * blank-line collapse).
 */
export { stripDelegatesForDisplay } from '@shared/text/strip.js';
