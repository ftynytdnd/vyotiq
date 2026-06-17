/**
 * Shared `ChatSlice` fixture for renderer store tests.
 *
 * Why this exists:
 *   The `ChatSlice` shape inside `useChatStore` extends `TimelineState`
 *   and adds `conversationId / runId / isProcessing / runStartedAt /
 *   draft`. Each time a new field is added to either side (e.g. the
 *   audit-pass `partialToolCallArgs`, `settledCallIds`, `draft`
 *   additions), every inline test fixture goes stale. Centralising
 *   the shape here means a future field addition is a one-line patch
 *   in this file instead of a 25-test sweep.
 *
 *   The exported helper is structurally compatible with the
 *   module-internal `ChatSlice` type — tests compare slices by
 *   structural equality, never by nominal identity, so the absence
 *   of a direct import of the private type is fine.
 *
 * Usage:
 *   ```ts
 *   import { chatSliceFixture } from '../../_fixtures/chatSlice';
 *
 *   useChatStore.setState({
 *     slices: {
 *       'conv-A': chatSliceFixture({ conversationId: 'conv-A',
 *                                    runId: 'run-A',
 *                                    isProcessing: true,
 *                                    runStartedAt: 1 })
 *     }
 *   });
 *   ```
 */

import type { TimelineEvent } from '@shared/types/chat';
import type {
  AssistantTextAcc,
  PartialToolCallArgs,
  ReasoningTextAcc,
  TokenUsageAggregate
} from '@renderer/components/timeline/reducer/types';

/**
 * Structural mirror of the private `ChatSlice` type from
 * `@renderer/store/useChatStore`. Kept as an exported interface so
 * test files can name the fixture's return shape if they need to
 * narrow it for a generic test helper. Production code never imports
 * this — it's a tests-only contract.
 */
export interface ChatSliceFixture {
  conversationId: string;
  runId: string | null;
  isProcessing: boolean;
  awaitingAskUser?: boolean;
  runStartedAt: number | null;
  draft: string;
  events: TimelineEvent[];
  assistantTexts: Record<string, AssistantTextAcc>;
  reasoningTexts: Record<string, ReasoningTextAcc>;
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
  settledCallIds: Record<string, true>;
  liveDiffByCallId: Record<string, import('@renderer/components/timeline/reducer/types').DiffStreamSnapshot>;
  liveToolOutputByCallId: Record<string, import('@renderer/components/timeline/reducer/types').LiveToolOutputSnapshot>;
  toolResultSettledIds: Record<string, true>;
  liveReportResultIds: Record<string, true>;
  orchestratorUsage?: TokenUsageAggregate;
  latestOrchestratorRunStatus?: never;
  lastUserPromptId?: string;
  lastUserPromptContent?: string;
  /**
   * Per-runId file-edit count map. Drives the inline numeric badge
   * on `UserPromptRow`'s Revert affordance. Defaults to an empty
   * record on the fresh-slice fixture.
   */
  runIdToFileEditCount: Record<string, number>;
}

/**
 * Build a fully-populated `ChatSlice` literal for tests. All fields
 * default to the same "empty / idle" values that
 * `useChatStore.emptySlice(id)` returns on a cold start; callers
 * override only what the test actually exercises.
 */
export function chatSliceFixture(
  overrides: Partial<ChatSliceFixture> & { conversationId: string }
): ChatSliceFixture {
  return {
    runId: null,
    isProcessing: false,
    awaitingAskUser: false,
    runStartedAt: null,
    draft: '',
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    partialToolCallArgs: {},
    settledCallIds: {},
    liveDiffByCallId: {},
    liveToolOutputByCallId: {},
    toolResultSettledIds: {},
    liveReportResultIds: {},
    runIdToFileEditCount: {},
    ...overrides
  };
}
