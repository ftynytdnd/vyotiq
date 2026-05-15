/**
 * Envelope module — public re-exports. The orchestrator boundary's safety
 * (Prime Directives §6) lives here; one place to wrap data, escape user
 * content, and parse the agent's structured emissions.
 */

// `escapeXmlBody` is intentionally NOT re-exported — direct imports
// from `./escapeXmlBody.js` keep the public envelope surface minimal
// and surface a single attribute escaper here. The previous
// `escapeXmlText` alias was unused everywhere and has been dropped.
export { wrapXml, escapeXmlAttr } from './wrapXml.js';
export {
  parseDelegates,
  parseDelegatesWithDuplicates,
  stripDelegates
} from './parseDelegates.js';
// `ParseDelegatesResult` is intentionally NOT re-exported — every
// consumer of `parseDelegatesWithDuplicates` outside the envelope
// module destructures the result inline (`{ directives, duplicates }`)
// rather than typing the shape, and `knip --reporter compact` flagged
// it as an unused exported type. Direct import from
// `./parseDelegates.js` remains available for any future consumer
// that legitimately needs the shape by name.
export type { ParsedDelegate } from './parseDelegates.js';
// Narrow companion strip that removes ONLY `<delegate>` (paired +
// self-closing) so callers can compute the assistant's
// non-delegate remainder while preserving other orchestration tags
// like `<status>`, `<task>`, `<run_state>`. See `parseDelegates` for
// the matching parser.
export { stripDelegateOnlyMarkup as stripDelegatesOnly } from '@shared/text/strip.js';
export {
  buildSubagentResultsEnvelope
} from './buildSubagentResultsEnvelope.js';
