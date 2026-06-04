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
export type { ParsedDelegate } from '@shared/text/parseDelegates.js';
export {
  buildSubagentResultsEnvelope
} from './buildSubagentResultsEnvelope.js';
