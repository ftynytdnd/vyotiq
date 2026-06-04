/**
 * Exponential backoff helper. Plain async/await — pairs with the
 * natural-language retry rules in `00-orchestrator-core.md` §C
 * ("Self-Correction & Three-Strike Rule"). `BASE_BACKOFF_MS` and
 * `MAX_BACKOFF_MS` are surfaced into the model's `<runtime_limits>`
 * envelope (see `harnessLoader.buildRuntimeLimitsBlock`) so the prose
 * references resolve to the same live values this helper consumes.
 */

import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '@shared/constants.js';
import { abortableSleep } from '@shared/async/abortableSleep.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/retry');

export interface BackoffOpts {
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  signal?: AbortSignal;
}

export async function backoff(attempt: number, opts: BackoffOpts = {}): Promise<void> {
  const base = opts.baseMs ?? BASE_BACKOFF_MS;
  const max = opts.maxMs ?? MAX_BACKOFF_MS;
  const raw = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  const jitter = opts.jitter !== false ? Math.random() * 0.25 * raw : 0;
  const wait = Math.max(0, raw + jitter);
  log.debug('backoff', { attempt, waitMs: Math.round(wait) });
  await abortableSleep(wait, opts.signal);
}
