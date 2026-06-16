/**
 * Detect poll-cycle aborts — superseded in-flight account fetches should
 * not warn or overwrite snapshots.
 */

import { isAbortError } from '../orchestrator/abortSignal.js';

export function isSupersededProviderPollAbort(err: unknown, signal?: AbortSignal): boolean {
  if (isAbortError(err, signal)) return true;
  if (typeof err === 'string') {
    return err.toLowerCase().includes('abort');
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = String((err as { message: unknown }).message).toLowerCase();
    if (msg.includes('abort')) return true;
  }
  return false;
}
