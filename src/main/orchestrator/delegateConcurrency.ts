/**
 * Resolve how many sub-agent workers may run in parallel for one
 * delegation round. The model may declare `concurrency` on delegate
 * calls; the host clamps by spec count, global ceiling, and optional
 * per-provider metadata.
 */

import type { ParsedDelegate } from './envelope/index.js';
import {
  DEFAULT_DELEGATE_CONCURRENCY,
  HOST_DELEGATE_CONCURRENCY_CEILING
} from '@shared/constants.js';

export { formatDelegateSpawnStatusLabel } from '@shared/text/delegationStatus.js';

export function resolveDelegateRoundConcurrency(
  specs: readonly ParsedDelegate[],
  providerMaxConcurrent?: number
): number {
  let modelDeclared = 0;
  for (const s of specs) {
    const c = s.concurrency;
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      modelDeclared = Math.max(modelDeclared, Math.floor(c));
    }
  }
  const providerCap =
    typeof providerMaxConcurrent === 'number' &&
    Number.isFinite(providerMaxConcurrent) &&
    providerMaxConcurrent > 0
      ? Math.floor(providerMaxConcurrent)
      : HOST_DELEGATE_CONCURRENCY_CEILING;
  const requested =
    modelDeclared > 0
      ? modelDeclared
      : providerCap > 0
        ? providerCap
        : DEFAULT_DELEGATE_CONCURRENCY;
  return Math.max(
    1,
    Math.min(specs.length, HOST_DELEGATE_CONCURRENCY_CEILING, providerCap, requested)
  );
}
