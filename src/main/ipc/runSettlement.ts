/**
 * Per-conversation run settlement — `flushAll` + `drainAppendChain` complete
 * before the next `readTranscript` on `chat:send` supersede.
 */

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

/** Await prior run finalization (coalescer flush + append drain). */
export async function awaitRunSettlement(conversationId: string): Promise<void> {
  const slot = byConversation.get(conversationId);
  if (!slot) return;
  await slot.promise;
}
