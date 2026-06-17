/**
 * Apply a human escape-hatch decision to a paused phased run.
 *
 * The engine pauses (structured `ask_user`) when a termination guard trips.
 * The human's choice maps to a concrete recovery:
 *   - supply_info      → resume at the current phase with the new context
 *   - approve_approach → clear the no-progress/cycle counters and continue
 *   - rollback         → restore the last checkpoint marker, resume at EXECUTE
 *   - abort            → stop the run cleanly (no further iterations)
 */

import type {
  PersistedPhaseEngineState,
  PhasedEscapeAction
} from '@shared/types/phased.js';
import type { AskUserAnswer } from '@shared/types/askUser.js';
import type { GuardTripReason } from './terminationGuards.js';
import { isPhasedEscapeAction } from '@shared/types/phased.js';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants.js';
import { revertEntriesAfterMarker } from './checkpointMarker.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('phased/escape-resolve');

const ESCAPE_QUESTION_ID = 'escape_action';

/**
 * Extra global iterations granted when a human approves continuing past a
 * soft iteration cap. Always clamped to the absolute `MAX_TOTAL_ITERATIONS`
 * ceiling, so the hard runtime limit can never be exceeded.
 */
const ITERATION_CAP_EXTENSION = 8;

export function readPhasedEscapeAction(
  answers: readonly AskUserAnswer[]
): PhasedEscapeAction {
  const answer =
    answers.find((a) => a.questionId === ESCAPE_QUESTION_ID) ?? answers[0];
  const selected = answer?.selectedOptionIds?.[0];
  if (isPhasedEscapeAction(selected)) return selected;
  // A free-text reply with no option selected is treated as supplying info.
  return 'supply_info';
}

export type PhasedEscapeResolution =
  | { kind: 'resume'; snapshot: PersistedPhaseEngineState; note: string }
  | { kind: 'abort'; note: string };

function clearGuardsForResume(state: PersistedPhaseEngineState, trip?: GuardTripReason['kind']): void {
  state.guards.repeatFailureCount = 0;
  state.guards.lastFailureSignature = null;
  state.guards.phaseCyclesUsed = 0;
  // A soft global-iteration cap can be lifted on human approval, but never
  // beyond the absolute hard ceiling.
  if (trip === 'global_iteration_cap') {
    state.guards.globalIterationCap = Math.min(
      MAX_TOTAL_ITERATIONS,
      state.guards.globalIteration + ITERATION_CAP_EXTENSION
    );
  }
}

export async function applyPhasedEscapeResolution(opts: {
  snapshot: PersistedPhaseEngineState;
  action: PhasedEscapeAction;
  trip?: GuardTripReason['kind'];
  workspaceId: string;
  runId: string;
}): Promise<PhasedEscapeResolution> {
  const { action, snapshot, trip } = opts;

  if (action === 'abort') {
    return { kind: 'abort', note: 'Run aborted by user from phased escape hatch' };
  }

  // Deep-clone so the caller's reference to the paused snapshot is untouched
  // until we deliberately swap it in.
  const next: PersistedPhaseEngineState = {
    ...snapshot,
    subtasks: snapshot.subtasks.map((s) => ({ ...s })),
    guards: { ...snapshot.guards },
    ledgerEntryIds: [...snapshot.ledgerEntryIds]
  };
  clearGuardsForResume(next, trip);

  if (action === 'rollback') {
    if (next.checkpointMarker) {
      const rev = await revertEntriesAfterMarker(
        opts.workspaceId,
        opts.runId,
        next.checkpointMarker
      );
      if (!rev.ok) {
        log.warn('phased rollback revert failed', { runId: opts.runId, error: rev.error });
      }
      next.checkpointMarker = null;
    }
    next.currentPhase = 'execute';
    const active = next.subtasks.find((s) => s.subtaskId === next.activeSubtaskId);
    if (active) active.currentPhase = 'execute';
    return {
      kind: 'resume',
      snapshot: next,
      note: 'Rolled back to last checkpoint; resuming at EXECUTE'
    };
  }

  const note =
    action === 'approve_approach'
      ? 'Approach approved; counters cleared, resuming current phase'
      : 'Information supplied; resuming current phase';
  return { kind: 'resume', snapshot: next, note };
}
