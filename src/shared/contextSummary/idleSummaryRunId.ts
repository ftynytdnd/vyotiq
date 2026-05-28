/**
 * Synthetic run ids for idle-mode context summarization.
 *
 * Idle summaries stream on `CHAT_EVENT` like orchestrator runs but are
 * NOT registered in main's `activeRuns` map. The renderer mints ids with
 * `mintIdleSummaryRunId()` and routes Composer Stop / `abort()` through
 * `contextSummary.abortIdle` instead of `chat.abort`.
 */

export { IDLE_SUMMARY_RUN_ID_PREFIX } from '../constants.js';
import { IDLE_SUMMARY_RUN_ID_PREFIX } from '../constants.js';

/** True when `runId` was minted for an idle summarizer side-run. */
export function isIdleSummaryRunId(runId: string): boolean {
  return runId.startsWith(IDLE_SUMMARY_RUN_ID_PREFIX);
}

/** Mint a renderer-side route key for idle summarization events. */
export function mintIdleSummaryRunId(): string {
  return `${IDLE_SUMMARY_RUN_ID_PREFIX}${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
