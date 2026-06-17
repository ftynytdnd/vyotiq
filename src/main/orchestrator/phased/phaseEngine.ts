/**
 * Phased execution engine — gated per-subtask state machine.
 */

import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '@shared/types/chat.js';
import type {
  AcceptanceRunEvidence,
  CheckpointMarkerRef,
  DoneCriterion,
  ExecutionPhase,
  PersistedPhaseEngineState,
  PersistedSubtaskState,
  PhaseArtifact,
  PhasedExecutionMode,
  PlanStep
} from '@shared/types/phased.js';
import { VERIFY_EVIDENCE_PERSIST_CHARS } from '@shared/constants.js';
import type { ResolvedPhasedExecutionSettings } from '@shared/settings/phasedExecutionSettings.js';
import { recordCheckpointMarker, revertEntriesAfterMarker } from './checkpointMarker.js';
import { diagnoseFailedApproachLabel, routeDiagnoseTarget } from './diagnoseRouter.js';
import {
  exitCriteriaForPhase,
  nextPhaseAfter,
  parsePhaseGateArgs,
  phaseLabel,
  type ParsePhaseGateResult
} from './gateValidators.js';
import { toolsAllowedInPhase } from './toolAllowlist.js';
import { runAcceptanceCommands } from './verifyRunner.js';
import {
  checkTerminationGuards,
  clearNoProgress,
  createTerminationGuardState,
  incrementPhaseCycle,
  recordFailureForNoProgress,
  type GuardTripReason,
  type TerminationGuardState
} from './terminationGuards.js';
import { classifyPromptForPhasedMode, resolvePhasedModeActive } from './modeClassifier.js';

export type SubtaskState = PersistedSubtaskState;

export type PhaseEngineSnapshot = PersistedPhaseEngineState;

export interface PhaseEngineOpts {
  runId: string;
  workspaceId: string;
  workspacePath: string;
  prompt: string;
  settings: ResolvedPhasedExecutionSettings;
  emit: (event: TimelineEvent) => void;
  signal?: AbortSignal;
}

export type PhaseGateHandleResult =
  | { kind: 'advanced'; phase: ExecutionPhase }
  | { kind: 'looped_back'; phase: ExecutionPhase; reason: string }
  | { kind: 'blocked'; reason: string; citeLedgerEntryId?: string }
  | { kind: 'verify_pending' }
  | { kind: 'all_subtasks_done' }
  | { kind: 'error'; message: string };

export type PhaseEngineSnapshotOpts = Omit<PhaseEngineOpts, 'prompt'>;

export class PhaseEngine {
  readonly runId: string;
  private readonly workspaceId: string;
  private readonly workspacePath: string;
  private readonly emit: (event: TimelineEvent) => void;
  private readonly signal?: AbortSignal;

  active: boolean;
  mode: ResolvedPhasedExecutionSettings['mode'];
  seq = 0;
  subtasks: SubtaskState[] = [];
  activeSubtaskId: string;
  currentPhase: ExecutionPhase = 'intake';
  doneCriteria: DoneCriterion[] = [];
  acceptanceCommands: string[] = [];
  planSteps: PlanStep[] = [];
  checkpointMarker: CheckpointMarkerRef | null = null;
  verifyEvidence: AcceptanceRunEvidence[] | null = null;
  guards: TerminationGuardState;
  ledgerEntryIds: string[] = [];
  private pendingVerify = false;
  private readonly verifyTimeoutMs: number;

  constructor(opts: PhaseEngineOpts) {
    this.runId = opts.runId;
    this.workspaceId = opts.workspaceId;
    this.workspacePath = opts.workspacePath;
    this.emit = opts.emit;
    this.signal = opts.signal;
    this.mode = opts.settings.mode;
    this.verifyTimeoutMs = opts.settings.verifyTimeoutMs;
    this.active = resolvePhasedModeActive(opts.settings.mode, opts.prompt);
    this.guards = createTerminationGuardState(
      opts.settings.phaseCycleCap,
      opts.settings.maxIterations
    );
    const rootId = randomUUID();
    this.activeSubtaskId = rootId;
    this.subtasks = [
      {
        subtaskId: rootId,
        description: 'Root task',
        currentPhase: 'intake',
        isRoot: true
      }
    ];
    if (this.active) {
      this.emitModeDecision('auto');
      this.emitPhaseTransition('intake', rootId);
    }
  }

  static fromSnapshot(snapshot: PhaseEngineSnapshot, opts: PhaseEngineSnapshotOpts): PhaseEngine {
    const engine = new PhaseEngine({
      ...opts,
      prompt: '',
      settings: opts.settings
    });
    engine.active = snapshot.active;
    engine.mode = snapshot.mode;
    engine.seq = snapshot.seq;
    engine.subtasks = snapshot.subtasks;
    engine.activeSubtaskId = snapshot.activeSubtaskId;
    engine.currentPhase = snapshot.currentPhase;
    engine.doneCriteria = snapshot.doneCriteria;
    engine.acceptanceCommands = snapshot.acceptanceCommands;
    engine.planSteps = snapshot.planSteps;
    engine.checkpointMarker = snapshot.checkpointMarker;
    engine.verifyEvidence = snapshot.verifyEvidence;
    engine.guards = snapshot.guards;
    engine.ledgerEntryIds = snapshot.ledgerEntryIds;
    return engine;
  }

  snapshot(): PhaseEngineSnapshot {
    return {
      active: this.active,
      mode: this.mode,
      runId: this.runId,
      seq: this.seq,
      subtasks: this.subtasks.map((s) => ({ ...s })),
      activeSubtaskId: this.activeSubtaskId,
      currentPhase: this.currentPhase,
      doneCriteria: [...this.doneCriteria],
      acceptanceCommands: [...this.acceptanceCommands],
      planSteps: [...this.planSteps],
      checkpointMarker: this.checkpointMarker ? { ...this.checkpointMarker } : null,
      verifyEvidence: this.verifyEvidence ? [...this.verifyEvidence] : null,
      guards: { ...this.guards },
      ledgerEntryIds: [...this.ledgerEntryIds]
    };
  }

  /**
   * Snapshot for embedding in persisted timeline events. Identical to
   * `snapshot()` but truncates acceptance-test output so the JSONL ledger
   * stays bounded (durable-execution Continue-As-New discipline).
   */
  private serializeForPersistence(): PhaseEngineSnapshot {
    const snap = this.snapshot();
    if (snap.verifyEvidence) {
      snap.verifyEvidence = snap.verifyEvidence.map((e) => ({
        ...e,
        output: e.output.slice(0, VERIFY_EVIDENCE_PERSIST_CHARS)
      }));
    }
    return snap;
  }

  promoteToPhased(reason: string): void {
    if (this.active) return;
    this.active = true;
    this.emitModeDecision('always', reason);
    this.emitPhaseTransition(this.currentPhase, this.activeSubtaskId);
  }

  onIterationStart(iteration: number, budget: { tokenExceeded?: boolean; wallExceeded?: boolean }): GuardTripReason | null {
    if (!this.active) return null;
    this.guards.globalIteration = iteration;
    const trip = checkTerminationGuards(this.guards, {
      tokenBudgetExceeded: budget.tokenExceeded,
      wallClockExceeded: budget.wallExceeded
    });
    return trip;
  }

  getToolAllowlist(): readonly string[] | undefined {
    if (!this.active) return undefined;
    return toolsAllowedInPhase(this.currentPhase);
  }

  buildRunStateLines(): string[] {
    if (!this.active) return ['phased_execution: inactive'];
    const sub = this.subtasks.find((s) => s.subtaskId === this.activeSubtaskId);
    return [
      'phased_execution: active',
      `phase: ${this.currentPhase}`,
      `subtask: ${sub?.description ?? this.activeSubtaskId}`,
      `phase_cycles: ${this.guards.phaseCyclesUsed} of ${this.guards.phaseCycleCap}`,
      `global_iteration: ${this.guards.globalIteration}`,
      `acceptance_commands: ${this.acceptanceCommands.length}`,
      `plan_steps_remaining: ${this.planSteps.length}`
    ];
  }

  async handlePhaseGateArgs(args: Record<string, unknown>): Promise<PhaseGateHandleResult> {
    if (!this.active) {
      return { kind: 'error', message: 'phased execution is not active for this run' };
    }
    const parsed = parsePhaseGateArgs(args);
    if (!parsed.ok) {
      return { kind: 'error', message: parsed.error };
    }
    return this.handleParsedGate(parsed);
  }

  async runPendingVerifyIfNeeded(): Promise<PhaseGateHandleResult | null> {
    if (!this.pendingVerify) return null;
    this.pendingVerify = false;
    return this.runHostVerify();
  }

  private async handleParsedGate(parsed: Extract<ParsePhaseGateResult, { ok: true }>): Promise<PhaseGateHandleResult> {
    if (parsed.subtaskId !== this.activeSubtaskId) {
      return { kind: 'error', message: 'subtaskId does not match active subtask' };
    }
    if (parsed.phase !== this.currentPhase) {
      return {
        kind: 'error',
        message: `expected phase ${this.currentPhase}, got ${parsed.phase}`
      };
    }

    const ledgerId = this.emitLedgerFromArtifact(parsed.artifact);
    const exitCriteria = exitCriteriaForPhase(parsed.phase);

    if (parsed.phase === 'checkpoint') {
      const marker = await recordCheckpointMarker(this.workspaceId, this.runId);
      if (!marker) {
        this.emitGate(parsed.phase, exitCriteria, {
          kind: 'blocked',
          reason: 'No checkpoint entries to mark — perform at least one tracked change before EXECUTE',
          citeLedgerEntryId: ledgerId
        });
        recordFailureForNoProgress(this.guards, parsed.phase, 'checkpoint marker empty');
        return { kind: 'blocked', reason: 'checkpoint marker unavailable', citeLedgerEntryId: ledgerId };
      }
      this.checkpointMarker = marker;
      this.emitLedger({
        phase: 'checkpoint',
        checkpointRef: marker,
        artifactSummary: 'Checkpoint manifest head recorded'
      });
      return this.passGate(parsed.phase, exitCriteria);
    }

    if (parsed.phase === 'verify') {
      this.pendingVerify = true;
      return { kind: 'verify_pending' };
    }

    if (parsed.phase === 'diagnose') {
      const art = parsed.artifact;
      if (art.phase !== 'diagnose') {
        return { kind: 'error', message: 'expected diagnose artifact' };
      }
      // Every loop-back must be traceable to a real ledger entry — reject
      // citations that reference nothing recorded (evidence, not memory).
      if (!this.ledgerEntryIds.includes(art.citeLedgerEntryId)) {
        const reason = `citeLedgerEntryId ${art.citeLedgerEntryId} does not match any recorded ledger entry — cite a real prior entry id`;
        recordFailureForNoProgress(this.guards, parsed.phase, reason, art.classification);
        this.emitGate(parsed.phase, exitCriteria, {
          kind: 'blocked',
          reason,
          citeLedgerEntryId: art.citeLedgerEntryId
        });
        return { kind: 'blocked', reason, citeLedgerEntryId: art.citeLedgerEntryId };
      }
      const routed = routeDiagnoseTarget(art.classification);
      const target = art.targetPhase === routed ? art.targetPhase : routed;
      if (target === 'execute' && this.checkpointMarker) {
        const rev = await revertEntriesAfterMarker(
          this.workspaceId,
          this.runId,
          this.checkpointMarker
        );
        if (!rev.ok) {
          this.emitGate(parsed.phase, exitCriteria, {
            kind: 'blocked',
            reason: `Rollback failed: ${rev.error}`,
            citeLedgerEntryId: art.citeLedgerEntryId
          });
          return { kind: 'blocked', reason: rev.error, citeLedgerEntryId: art.citeLedgerEntryId };
        }
        this.checkpointMarker = null;
      }
      incrementPhaseCycle(this.guards);
      recordFailureForNoProgress(this.guards, parsed.phase, art.evidence, art.classification);
      this.setPhase(target);
      this.emitGate(parsed.phase, exitCriteria, {
        kind: 'looped_back',
        reason: art.evidence,
        targetPhase: target,
        citeLedgerEntryId: art.citeLedgerEntryId
      });
      return { kind: 'looped_back', phase: target, reason: art.evidence };
    }

    if (parsed.phase === 'intake') {
      const art = parsed.artifact;
      if (art.phase !== 'intake') return { kind: 'error', message: 'artifact mismatch' };
      this.doneCriteria = art.doneCriteria;
      this.acceptanceCommands = art.acceptanceCommands;
    }

    if (parsed.phase === 'plan') {
      const art = parsed.artifact;
      if (art.phase !== 'plan') return { kind: 'error', message: 'artifact mismatch' };
      const criterionIds = new Set(this.doneCriteria.map((c) => c.id));
      for (const step of art.steps) {
        if (!criterionIds.has(step.doneCriterionId)) {
          recordFailureForNoProgress(
            this.guards,
            parsed.phase,
            `step ${step.order} unknown criterion`
          );
          this.setPhase('intake');
          this.emitGate(parsed.phase, exitCriteria, {
            kind: 'looped_back',
            reason: `Step ${step.order} references unknown doneCriterionId ${step.doneCriterionId}`,
            targetPhase: 'intake',
            citeLedgerEntryId: ledgerId
          });
          return { kind: 'looped_back', phase: 'intake', reason: 'step criterion mismatch' };
        }
      }
      this.planSteps = art.steps;
    }

    if (parsed.phase === 'reflect') {
      const art = parsed.artifact;
      if (art.phase !== 'reflect') return { kind: 'error', message: 'artifact mismatch' };
      clearNoProgress(this.guards);
      const reflectingSubtask = this.activeSubtaskId;
      if (art.remainingSteps.length > 0) {
        this.planSteps = art.remainingSteps;
        const next = art.remainingSteps[0]!;
        this.startSubtask(next.subtaskId, next.description, false);
        this.emitGate(parsed.phase, exitCriteria, { kind: 'passed', reason: 'Gate satisfied' }, {
          subtaskId: reflectingSubtask
        });
        return { kind: 'advanced', phase: this.currentPhase };
      }
      this.setPhase('done');
      this.emitGate(parsed.phase, exitCriteria, { kind: 'passed', reason: 'All subtasks complete' }, {
        subtaskId: reflectingSubtask
      });
      return { kind: 'all_subtasks_done' };
    }

    return this.passGate(parsed.phase, exitCriteria);
  }

  private async passGate(
    phase: ExecutionPhase,
    exitCriteria: string
  ): Promise<PhaseGateHandleResult> {
    clearNoProgress(this.guards);
    const gatedSubtask = this.activeSubtaskId;
    const next = nextPhaseAfter(phase);
    this.setPhase(next);
    this.emitGate(phase, exitCriteria, { kind: 'passed', reason: 'Gate satisfied' }, {
      subtaskId: gatedSubtask
    });
    if (next === 'verify') {
      this.pendingVerify = true;
      return { kind: 'verify_pending' };
    }
    return { kind: 'advanced', phase: next };
  }

  private async runHostVerify(): Promise<PhaseGateHandleResult> {
    const phase: ExecutionPhase = 'verify';
    const exitCriteria = exitCriteriaForPhase(phase);
    if (this.acceptanceCommands.length === 0) {
      recordFailureForNoProgress(this.guards, phase, 'missing acceptance commands');
      this.setPhase('intake');
      this.emitGate(phase, exitCriteria, {
        kind: 'looped_back',
        reason: 'No acceptance commands declared at intake',
        targetPhase: 'intake'
      });
      return { kind: 'looped_back', phase: 'intake', reason: 'missing acceptance commands' };
    }
    const result = await runAcceptanceCommands(
      this.workspaceId,
      this.workspacePath,
      this.acceptanceCommands,
      this.signal,
      this.verifyTimeoutMs
    );
    this.verifyEvidence = result.evidence;
    if (result.blocked) {
      recordFailureForNoProgress(
        this.guards,
        phase,
        result.blockedReason ?? 'verify blocked',
        'blocked_environment'
      );
      this.emitGate(phase, exitCriteria, {
        kind: 'blocked',
        reason: result.blockedReason ?? 'Cannot execute acceptance tests'
      }, { acceptanceEvidence: result.evidence });
      return { kind: 'blocked', reason: result.blockedReason ?? 'verify blocked' };
    }
    if (!result.allPassed) {
      const fail = result.evidence.find((e) => e.exitCode !== 0 || e.timedOut);
      const reason = fail
        ? `Acceptance command failed (exit ${fail.exitCode}): ${fail.command}`
        : 'Acceptance commands failed';
      incrementPhaseCycle(this.guards);
      recordFailureForNoProgress(this.guards, phase, reason, 'test_failure');
      this.setPhase('diagnose');
      this.emitGate(phase, exitCriteria, {
        kind: 'looped_back',
        reason,
        targetPhase: 'diagnose'
      }, { acceptanceEvidence: result.evidence });
      return { kind: 'looped_back', phase: 'diagnose', reason };
    }
    this.setPhase('reflect');
    this.emitGate(phase, exitCriteria, { kind: 'passed', reason: 'Acceptance commands passed' }, {
      acceptanceEvidence: result.evidence
    });
    return { kind: 'advanced', phase: 'reflect' };
  }

  private setPhase(phase: ExecutionPhase): void {
    this.currentPhase = phase;
    const sub = this.subtasks.find((s) => s.subtaskId === this.activeSubtaskId);
    if (sub) sub.currentPhase = phase;
    this.emitPhaseTransition(phase, this.activeSubtaskId);
  }

  private startSubtask(subtaskId: string, description: string, isRoot: boolean): void {
    const existing = this.subtasks.find((s) => s.subtaskId === subtaskId);
    if (existing) {
      this.activeSubtaskId = subtaskId;
      this.setPhase('understand');
      return;
    }
    this.subtasks.push({ subtaskId, description, currentPhase: 'understand', isRoot });
    this.activeSubtaskId = subtaskId;
    this.checkpointMarker = null;
    this.verifyEvidence = null;
    this.setPhase(isRoot ? 'intake' : 'understand');
  }

  private emitPhaseTransition(phase: ExecutionPhase, subtaskId: string): void {
    const sub = this.subtasks.find((s) => s.subtaskId === subtaskId);
    this.emit({
      kind: 'phase',
      id: randomUUID(),
      ts: Date.now(),
      label: phaseLabel(phase),
      tooltip: `subtask=${subtaskId} · ${sub?.description ?? ''}`
    });
  }

  private emitGate(
    phase: ExecutionPhase,
    exitCriteria: string,
    decision: {
      kind: 'passed' | 'looped_back' | 'blocked';
      reason: string;
      targetPhase?: ExecutionPhase;
      citeLedgerEntryId?: string;
    },
    opts?: { acceptanceEvidence?: AcceptanceRunEvidence[]; subtaskId?: string }
  ): void {
    this.seq += 1;
    this.emit({
      kind: 'phase-gate',
      id: randomUUID(),
      ts: Date.now(),
      runId: this.runId,
      subtaskId: opts?.subtaskId ?? this.activeSubtaskId,
      seq: this.seq,
      phase,
      exitCriteria,
      gateDecision: decision,
      ...(opts?.acceptanceEvidence ? { acceptanceEvidence: opts.acceptanceEvidence } : {}),
      engineState: this.serializeForPersistence()
    });
  }

  private emitLedgerFromArtifact(artifact: PhaseArtifact): string {
    const id = randomUUID();
    this.seq += 1;
    const entry: TimelineEvent = {
      kind: 'phase-ledger-entry',
      id,
      ts: Date.now(),
      runId: this.runId,
      subtaskId: this.activeSubtaskId,
      seq: this.seq,
      phase: artifact.phase,
      exitCriteria: exitCriteriaForPhase(artifact.phase),
      artifactSummary: JSON.stringify(artifact).slice(0, 4000),
      ...this.ledgerFieldsForArtifact(artifact)
    };
    this.emit(entry);
    this.ledgerEntryIds.push(id);
    return id;
  }

  /**
   * Maps a phase artifact onto the structured ledger fields (decisions +
   * rationale incl. rejected alternatives, assumptions, discovered
   * constraints, attempted approaches + why they failed, code links).
   */
  private ledgerFieldsForArtifact(
    artifact: PhaseArtifact
  ): Partial<Extract<TimelineEvent, { kind: 'phase-ledger-entry' }>> {
    switch (artifact.phase) {
      case 'think_frame':
        return {
          decisions: [
            {
              decision: artifact.chosenApproach,
              rationale:
                artifact.rejectedAlternatives
                  .map((r) => `rejected ${r.approach}: ${r.reason}`)
                  .join('; ') || 'no alternatives rejected'
            }
          ],
          assumptions: artifact.hypotheses,
          discoveredConstraints: artifact.constraints
        };
      case 'understand':
        return {
          codeLinks: artifact.facts.flatMap((f) => f.codeLinks),
          assumptions: artifact.facts.map((f) => f.statement)
        };
      case 'execute':
        return { codeLinks: artifact.codeLinks };
      case 'rethink':
        return {
          assumptions: [artifact.riskiestAssumption],
          decisions: [{ decision: 'Plan survives adversarial review', rationale: artifact.attackNotes }]
        };
      case 'diagnose':
        return {
          attemptedApproaches: [
            {
              approach: diagnoseFailedApproachLabel(artifact.classification),
              whyFailed: artifact.evidence
            }
          ],
          decisions: [
            {
              decision: `Route to ${artifact.targetPhase}`,
              rationale: `${artifact.classification}: ${artifact.evidence}`
            }
          ]
        };
      case 'reflect':
        return {
          decisions: artifact.lessons.map((lesson) => ({
            decision: 'lesson',
            rationale: lesson
          }))
        };
      case 'intake':
        return {
          doneCriteria: artifact.doneCriteria,
          acceptanceCommandCount: artifact.acceptanceCommands.length
        };
      case 'plan':
        return { planSteps: artifact.steps };
      case 'checkpoint':
      case 'verify':
        return {};
      default: {
        const _exhaustive: never = artifact;
        return _exhaustive;
      }
    }
  }

  private emitLedger(partial: Omit<Extract<TimelineEvent, { kind: 'phase-ledger-entry' }>, 'kind' | 'id' | 'ts' | 'runId' | 'subtaskId' | 'seq'>): string {
    const id = randomUUID();
    this.seq += 1;
    this.emit({
      kind: 'phase-ledger-entry',
      id,
      ts: Date.now(),
      runId: this.runId,
      subtaskId: this.activeSubtaskId,
      seq: this.seq,
      ...partial
    });
    this.ledgerEntryIds.push(id);
    return id;
  }

  private emitModeDecision(mode: PhasedExecutionMode, reason?: string): void {
    this.emitLedger({
      phase: this.currentPhase,
      modeDecision: mode,
      artifactSummary: reason ?? `Phased mode activated (${mode})`
    });
  }
}

export function maybePromotePhasedEngine(engine: PhaseEngine, prompt: string): void {
  if (engine.active) return;
  if (engine.mode !== 'auto') return;
  if (classifyPromptForPhasedMode(prompt)) {
    engine.promoteToPhased('Classifier promoted mid-run after multi-step signals');
  }
}
