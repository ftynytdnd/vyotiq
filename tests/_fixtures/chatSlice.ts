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
  ContextMessageOverride
} from '@shared/types/contextSummary';
import type {
  AssistantTextAcc,
  ContextSummaryAcc,
  PartialToolCallArgs,
  ReasoningTextAcc,
  SubAgentSnapshot,
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
  runStartedAt: number | null;
  draft: string;
  events: TimelineEvent[];
  assistantTexts: Record<string, AssistantTextAcc>;
  reasoningTexts: Record<string, ReasoningTextAcc>;
  subagents: Record<string, SubAgentSnapshot>;
  partialToolCallArgs: Record<string, PartialToolCallArgs>;
  settledCallIds: Record<string, true>;
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
  /**
   * Per-summary streaming + lifecycle accumulator. Empty on the
   * fresh-slice fixture; tests that exercise the context-summary
   * row stamp entries here directly. Mirrors the slice's own
   * `summaries` field one-for-one.
   */
  summaries: Record<string, ContextSummaryAcc>;
  /**
   * Per-conversation per-message override map. Mirrors the slice's
   * own `messageOverrides` field; tests for the Inspector toggle
   * stamp entries here. Empty default.
   */
  messageOverrides: Record<string, ContextMessageOverride>;
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
    runStartedAt: null,
    draft: '',
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    partialToolCallArgs: {},
    settledCallIds: {},
    runIdToFileEditCount: {},
    summaries: {},
    messageOverrides: {},
    ...overrides
  };
}
