/**
 * Phased execution engine — shared types for main + renderer.
 */

/** Ordered phases in the per-subtask state machine. */
export const EXECUTION_PHASES = [
  'intake',
  'understand',
  'think_frame',
  'plan',
  'rethink',
  'checkpoint',
  'execute',
  'verify',
  'diagnose',
  'reflect',
  'done'
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type PhasedExecutionMode = 'auto' | 'always' | 'never';

export type GateDecisionKind = 'passed' | 'looped_back' | 'blocked';

export type DiagnoseClassification =
  | 'wrong_facts'
  | 'wrong_approach'
  | 'bad_implementation'
  | 'test_failure'
  | 'blocked_environment';

export interface CodeLink {
  file: string;
  line?: number;
}

export interface DoneCriterion {
  id: string;
  description: string;
}

export interface PlanStep {
  subtaskId: string;
  order: number;
  description: string;
  doneCriterionId: string;
  verificationMethod: string;
}

export interface PhaseFact {
  statement: string;
  codeLinks: CodeLink[];
}

export interface RejectedAlternative {
  approach: string;
  reason: string;
}

export interface AttemptedApproach {
  approach: string;
  whyFailed: string;
}

/** Host-recorded acceptance test evidence (VERIFY gate). */
export interface AcceptanceRunEvidence {
  command: string;
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export interface CheckpointMarkerRef {
  checkpointId: string;
  lastEntryId: string;
  entryCount: number;
}

/** Discriminated artifacts submitted via `phase_gate`. */
export type PhaseArtifact =
  | {
      phase: 'intake';
      goalRestatement: string;
      doneCriteria: DoneCriterion[];
      acceptanceCommands: string[];
    }
  | {
      phase: 'understand';
      facts: PhaseFact[];
      openAmbiguities: string[];
    }
  | {
      phase: 'think_frame';
      chosenApproach: string;
      rejectedAlternatives: RejectedAlternative[];
      hypotheses: string[];
      constraints: string[];
    }
  | {
      phase: 'plan';
      steps: PlanStep[];
    }
  | {
      phase: 'rethink';
      riskiestAssumption: string;
      attackNotes: string;
      unaddressedHighRisks: string[];
    }
  | {
      phase: 'checkpoint';
      ready: true;
    }
  | {
      phase: 'execute';
      incrementSummary: string;
      codeLinks: CodeLink[];
      selfConsistent: boolean;
    }
  | {
      phase: 'verify';
      validationNotes: string;
      supplementalChecksPass: boolean;
    }
  | {
      phase: 'diagnose';
      classification: DiagnoseClassification;
      targetPhase: ExecutionPhase;
      evidence: string;
      citeLedgerEntryId: string;
    }
  | {
      phase: 'reflect';
      lessons: string[];
      remainingSteps: PlanStep[];
    };

export interface PhaseGateDecision {
  kind: GateDecisionKind;
  reason: string;
  targetPhase?: ExecutionPhase;
  citeLedgerEntryId?: string;
}

/** One subtask's position in the per-subtask state machine. */
export interface PersistedSubtaskState {
  subtaskId: string;
  description: string;
  currentPhase: ExecutionPhase;
  isRoot: boolean;
}

/** Termination-guard counters — persisted so no-progress survives restart. */
export interface PersistedGuardState {
  phaseCyclesUsed: number;
  phaseCycleCap: number;
  globalIteration: number;
  /** Soft global-iteration cap that trips the escape hatch (≤ hard ceiling). */
  globalIterationCap: number;
  lastFailureSignature: string | null;
  repeatFailureCount: number;
}

/**
 * Fully serializable phase-engine state. Embedded in `phase-gate` timeline
 * events so a run can be reconstructed exactly after a process restart
 * (event-sourced durable execution) — no in-memory snapshot required.
 */
export interface PersistedPhaseEngineState {
  active: boolean;
  mode: PhasedExecutionMode;
  runId: string;
  seq: number;
  subtasks: PersistedSubtaskState[];
  activeSubtaskId: string;
  currentPhase: ExecutionPhase;
  doneCriteria: DoneCriterion[];
  acceptanceCommands: string[];
  planSteps: PlanStep[];
  checkpointMarker: CheckpointMarkerRef | null;
  verifyEvidence: AcceptanceRunEvidence[] | null;
  guards: PersistedGuardState;
  ledgerEntryIds: string[];
}

/** Human escape-hatch resolutions when the engine pauses for help. */
export type PhasedEscapeAction =
  | 'supply_info'
  | 'approve_approach'
  | 'rollback'
  | 'abort';

export const PHASED_ESCAPE_ACTION_IDS: Record<PhasedEscapeAction, PhasedEscapeAction> = {
  supply_info: 'supply_info',
  approve_approach: 'approve_approach',
  rollback: 'rollback',
  abort: 'abort'
};

export function isPhasedEscapeAction(v: unknown): v is PhasedEscapeAction {
  return v === 'supply_info' || v === 'approve_approach' || v === 'rollback' || v === 'abort';
}
