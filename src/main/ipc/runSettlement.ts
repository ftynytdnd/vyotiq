/**
 * Per-conversation run settlement — `flushAll` + `drainAppendChain` complete
 * before the next `readTranscript` on `chat:send` supersede.
 */

import { RUN_SETTLEMENT_TIMEOUT_MS } from '@shared/constants.js';
import { logger } from '../logging/logger.js';

const log = logger.child('ipc/runSettlement');

type SettlementSlot = {
  promise: Promise<void>;
  resolve: () => void;
};

const byConversation = new Map<string, SettlementSlot>();

/** Arm a fresh settlement latch for the run about to start. */
export function armRunSettlement(conversationId: string): void {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  byConversation.set(conversationId, { promise, resolve });
}

/** Resolve the in-flight run's settlement latch (idempotent). */
export function settleRun(conversationId: string): void {
  const slot = byConversation.get(conversationId);
  if (!slot) return;
  slot.resolve();
  byConversation.delete(conversationId);
}

/**
 * Await prior run finalization (coalescer flush + append drain). Times out
 * and force-opens the latch so supersede cannot hang forever.
 */
export async function awaitRunSettlement(
  conversationId: string,
  timeoutMs: number = RUN_SETTLEMENT_TIMEOUT_MS
): Promise<void> {
  const slot = byConversation.get(conversationId);
  if (!slot) return;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      log.warn('run settlement timed out; forcing latch open', {
        conversationId,
        timeoutMs
      });
      settleRun(conversationId);
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([slot.promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
