/**
 * Strip orchestration `<delegate />` directives from streamed assistant
 * text before showing it to the user. The directives are machine-readable
 * side-channel content; the user shouldn't see them.
 *
 * Re-exports the shared helpers from `@shared/text/*` so the renderer-side
 * strip and the main-side strip use literally the same regex constants.
 */
export { stripDelegatesForDisplay } from '@shared/text/strip.js';
export { displayAssistantTurnText } from '@shared/text/parseDelegates.js';
