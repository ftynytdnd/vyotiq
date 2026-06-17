/**
 * Rebuild phase engine snapshot from persisted timeline events (resume / replay).
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { PhaseEngineSnapshot } from './phaseEngine.js';
import type { ResolvedPhasedExecutionSettings } from '@shared/settings/phasedExecutionSettings.js';
import { readTranscript } from '../../conversations/conversationStore.js';
import { logger } from '../../logging/logger.js';
import { createTerminationGuardState } from './terminationGuards.js';
import type {
  AcceptanceRunEvidence,
  CheckpointMarkerRef,
  DoneCriterion,
  ExecutionPhase,
  PlanStep
} from '@shared/types/phased.js';
import { isExecutionPhase } from './gateValidators.js';

const log = logger.child('phased/reconstruct');

/**
 * Cold-resume helper: rebuild a phase-engine snapshot from the persisted
 * JSONL transcript when no in-memory snapshot survives (e.g. after a process
 * restart). Returns null when the conversation has no phased events for the
 * run, so a fresh run cleanly starts a new engine.
 */
export async function loadPhaseEngineSnapshotFromStore(
  conversationId: string,
  runId: string,
  settings: ResolvedPhasedExecutionSettings
): Promise<PhaseEngineSnapshot | null> {
  try {
    const events = await readTranscript(conversationId);
    return reconstructPhaseEngineFromEvents(runId, events, settings);
  } catch (err) {
    log.warn('phased cold-resume reconstruction failed', { conversationId, runId, err });
    return null;
  }
}

export function reconstructPhaseEngineFromEvents(
  runId: string,
  events: readonly TimelineEvent[],
  settings: ResolvedPhasedExecutionSettings
): PhaseEngineSnapshot | null {
  const runEvents = events.filter(
    (e) =>
      (e.kind === 'phase-gate' || e.kind === 'phase-ledger-entry') && e.runId === runId
  );
  if (runEvents.length === 0) return null;

  // Exact path: the latest gate carries a full durable engine snapshot.
  // Clamp the cap to current settings so a changed config still applies.
  for (let i = runEvents.length - 1; i >= 0; i -= 1) {
    const e = runEvents[i]!;
    if (e.kind === 'phase-gate' && e.engineState) {
      return {
        ...e.engineState,
        runId,
        guards: {
          ...e.engineState.guards,
          phaseCycleCap: settings.phaseCycleCap,
          globalIterationCap: settings.maxIterations
        }
      };
    }
  }

  // Legacy fallback: approximate reconstruction from pre-durable transcripts.
  let seq = 0;
  let active = false;
  let mode = settings.mode;
  let activeSubtaskId = '';
  let currentPhase: ExecutionPhase = 'intake';
  const subtasks = new Map<string, { subtaskId: string; description: string; currentPhase: ExecutionPhase; isRoot: boolean }>();
  let doneCriteria: DoneCriterion[] = [];
  let acceptanceCommands: string[] = [];
  let planSteps: PlanStep[] = [];
  let checkpointMarker: CheckpointMarkerRef | null = null;
  let verifyEvidence: AcceptanceRunEvidence[] | null = null;
  const ledgerEntryIds: string[] = [];
  let phaseCyclesUsed = 0;

  for (const e of runEvents) {
    if (e.kind === 'phase-ledger-entry') {
      seq = Math.max(seq, e.seq);
      ledgerEntryIds.push(e.id);
      activeSubtaskId = e.subtaskId;
      if (!subtasks.has(e.subtaskId)) {
        subtasks.set(e.subtaskId, {
          subtaskId: e.subtaskId,
          description: 'Subtask',
          currentPhase: e.phase,
          isRoot: subtasks.size === 0
        });
      }
      if (e.modeDecision === 'never') active = false;
      if (e.modeDecision === 'always' || e.modeDecision === 'auto') active = true;
      if (e.checkpointRef) checkpointMarker = e.checkpointRef;
      if (e.artifactSummary?.includes('doneCriteria')) {
        try {
          const parsed = JSON.parse(e.artifactSummary) as { doneCriteria?: DoneCriterion[]; acceptanceCommands?: string[]; steps?: PlanStep[] };
          if (parsed.doneCriteria) doneCriteria = parsed.doneCriteria;
          if (parsed.acceptanceCommands) acceptanceCommands = parsed.acceptanceCommands;
          if (parsed.steps) planSteps = parsed.steps;
        } catch {
          /* ignore partial JSON */
        }
      }
    }
    if (e.kind === 'phase-gate') {
      seq = Math.max(seq, e.seq);
      active = true;
      activeSubtaskId = e.subtaskId;
      currentPhase = e.phase;
      if (!subtasks.has(e.subtaskId)) {
        subtasks.set(e.subtaskId, {
          subtaskId: e.subtaskId,
          description: 'Subtask',
          currentPhase: e.phase,
          isRoot: subtasks.size === 0
        });
      }
      const sub = subtasks.get(e.subtaskId);
      if (sub) sub.currentPhase = e.phase;
      if (e.gateDecision.kind === 'looped_back' && e.gateDecision.targetPhase && isExecutionPhase(e.gateDecision.targetPhase)) {
        currentPhase = e.gateDecision.targetPhase;
        if (sub) sub.currentPhase = e.gateDecision.targetPhase;
        phaseCyclesUsed += 1;
      }
      if (e.gateDecision.kind === 'passed') {
        if (e.acceptanceEvidence) verifyEvidence = e.acceptanceEvidence;
      }
    }
  }

  if (!activeSubtaskId) return null;

  return {
    active,
    mode,
    runId,
    seq,
    subtasks: [...subtasks.values()],
    activeSubtaskId,
    currentPhase,
    doneCriteria,
    acceptanceCommands,
    planSteps,
    checkpointMarker,
    verifyEvidence,
    guards: {
      ...createTerminationGuardState(settings.phaseCycleCap, settings.maxIterations),
      phaseCyclesUsed
    },
    ledgerEntryIds
  };
}
