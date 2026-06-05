/**
 * Renderer RAM helpers for chat slices — unload idle inactive slices so
 * long sessions do not pin full transcripts for every conversation opened.
 */

import { emptySlice, type ChatSlice } from './chatStoreTypes.js';

export function shouldUnloadIdleSlice(slice: ChatSlice | undefined): slice is ChatSlice {
  if (!slice) return false;
  if (slice.isProcessing || slice.runId) return false;
  return slice.events.length > 0;
}

/** Drop transcript weight from an idle slice; preserve draft for re-open. */
export function unloadIdleSlice(slice: ChatSlice): ChatSlice {
  if (slice.isProcessing || slice.runId) return slice;
  const draft = slice.draft;
  const attachmentDraft = slice.attachmentDraft;
  return { ...emptySlice(slice.conversationId), draft, attachmentDraft };
}
