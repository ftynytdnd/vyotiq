/**
 * Strip legacy orchestration `<delegate />` XML (and the broader
 * orchestration-envelope allowlist) from assistant text before showing
 * it to the user.
 *
 * Back-compat only: delegation is now a real function-calling tool, so
 * the live loop no longer emits `<delegate ... />` markup into assistant
 * text. `stripDelegatesForDisplay` exists solely so historical
 * transcripts recorded in the pre-tool era still render cleanly — old
 * assistant rows that embedded the raw XML are scrubbed at display time.
 * Keep it wired into the historical-row rendering path (via
 * `displayAssistantTurnText`); do not delete it.
 *
 * Re-exports the shared helpers from `@shared/text/*` so the renderer-side
 * strip and the main-side strip use literally the same regex constants.
 */
export { stripDelegatesForDisplay } from '@shared/text/strip.js';
export { displayAssistantTurnText } from '@shared/text/parseDelegates.js';
