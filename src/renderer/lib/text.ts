/**
 * Strip legacy orchestration XML (and the broader envelope allowlist) from
 * assistant text before showing it to the user.
 *
 * Back-compat only: Agent V is a solo agent and no longer emits
 * `<delegate ... />` markup in assistant prose. `stripDelegatesForDisplay`
 * scrubs historical transcripts and occasional model hallucinations at
 * display time.
 *
 * Re-exports shared helpers so renderer and main use the same regex constants.
 */
export { stripDelegatesForDisplay } from '@shared/text/strip.js';
export { displayAssistantTurnText } from '@shared/text/assistantDisplayText.js';
