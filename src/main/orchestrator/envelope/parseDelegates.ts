/**
 * Re-export the shared delegate parser so existing `@main` imports stay
 * stable. Canonical implementation lives in `@shared/text/parseDelegates`.
 */

export {
  parseDelegates,
  parseDelegatesWithDuplicates,
  stripDelegates
} from '@shared/text/parseDelegates.js';

export type { ParsedDelegate } from '@shared/text/parseDelegates.js';
