/** Slice fields that determine whether an orchestrator run is still open. */
export interface RunActiveSlice {
  isProcessing: boolean;
  awaitingAskUser?: boolean;
}

/** True while the orchestrator is streaming or paused for `ask_user`. */
export function isSliceRunActive(slice: RunActiveSlice): boolean {
  return slice.isProcessing || Boolean(slice.awaitingAskUser);
}
