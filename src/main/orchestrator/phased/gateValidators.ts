/**
 * Structural validators for `phase_gate` artifacts — schema + invariants only.
 */

import type { CodeLink, DoneCriterion, ExecutionPhase, PhaseArtifact, PlanStep } from '@shared/types/phased.js';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parseCodeLinks(raw: unknown): CodeLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => typeof x === 'object' && x !== null && isNonEmptyString((x as { file?: string }).file))
    .map((x) => {
      const o = x as { file: string; line?: number };
      return {
        file: o.file.trim(),
        ...(typeof o.line === 'number' && Number.isFinite(o.line) ? { line: Math.round(o.line) } : {})
      };
    });
}

function parseDoneCriteria(raw: unknown): DoneCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: DoneCriterion[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as { id?: string; description?: string };
    if (!isNonEmptyString(o.id) || !isNonEmptyString(o.description)) continue;
    out.push({ id: o.id.trim(), description: o.description.trim() });
  }
  return out;
}

function parsePlanSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanStep[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (
      !isNonEmptyString(o.subtaskId) ||
      typeof o.order !== 'number' ||
      !isNonEmptyString(o.description) ||
      !isNonEmptyString(o.doneCriterionId) ||
      !isNonEmptyString(o.verificationMethod)
    ) {
      continue;
    }
    out.push({
      subtaskId: o.subtaskId.trim(),
      order: Math.round(o.order),
      description: o.description.trim(),
      doneCriterionId: o.doneCriterionId.trim(),
      verificationMethod: o.verificationMethod.trim()
    });
  }
  return out;
}

export type ParsePhaseGateResult =
  | { ok: true; subtaskId: string; phase: ExecutionPhase; artifact: PhaseArtifact }
  | { ok: false; error: string };

export function parsePhaseGateArgs(args: Record<string, unknown>): ParsePhaseGateResult {
  const subtaskId = args.subtaskId;
  const phase = args.phase;
  const artifactRaw = args.artifact;
  if (!isNonEmptyString(subtaskId)) {
    return { ok: false, error: 'phase_gate requires non-empty subtaskId' };
  }
  if (typeof phase !== 'string' || !isExecutionPhase(phase) || phase === 'done') {
    return { ok: false, error: 'phase_gate requires a valid active phase' };
  }
  if (typeof artifactRaw !== 'object' || artifactRaw === null) {
    return { ok: false, error: 'phase_gate requires artifact object' };
  }
  const artifactPhase = (artifactRaw as { phase?: string }).phase;
  if (artifactPhase !== phase) {
    return { ok: false, error: 'artifact.phase must match top-level phase' };
  }

  switch (phase) {
    case 'intake': {
      const a = artifactRaw as Record<string, unknown>;
      const doneCriteria = parseDoneCriteria(a.doneCriteria);
      const acceptanceCommands = isStringArray(a.acceptanceCommands)
        ? a.acceptanceCommands.map((c) => c.trim()).filter(Boolean)
        : [];
      if (!isNonEmptyString(a.goalRestatement)) {
        return { ok: false, error: 'intake requires goalRestatement' };
      }
      if (doneCriteria.length === 0) {
        return { ok: false, error: 'intake requires at least one doneCriterion' };
      }
      if (acceptanceCommands.length === 0) {
        return { ok: false, error: 'intake requires at least one acceptanceCommand' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'intake',
          goalRestatement: a.goalRestatement.trim(),
          doneCriteria,
          acceptanceCommands
        }
      };
    }
    case 'understand': {
      const a = artifactRaw as Record<string, unknown>;
      const facts = Array.isArray(a.facts)
        ? a.facts
            .filter((f) => typeof f === 'object' && f !== null && isNonEmptyString((f as { statement?: string }).statement))
            .map((f) => ({
              statement: (f as { statement: string }).statement.trim(),
              codeLinks: parseCodeLinks((f as { codeLinks?: unknown }).codeLinks)
            }))
        : [];
      const openAmbiguities = isStringArray(a.openAmbiguities) ? a.openAmbiguities : [];
      if (facts.length === 0) {
        return { ok: false, error: 'understand requires at least one fact with codeLinks' };
      }
      if (facts.some((f) => f.codeLinks.length === 0)) {
        return { ok: false, error: 'every fact must include at least one codeLink' };
      }
      if (openAmbiguities.some((x) => x.trim().length > 0)) {
        return { ok: false, error: 'openAmbiguities must be empty before advancing' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: { phase: 'understand', facts, openAmbiguities: [] }
      };
    }
    case 'think_frame': {
      const a = artifactRaw as Record<string, unknown>;
      const rejected = Array.isArray(a.rejectedAlternatives)
        ? a.rejectedAlternatives
            .filter(
              (r) =>
                typeof r === 'object' &&
                r !== null &&
                isNonEmptyString((r as { approach?: string }).approach) &&
                isNonEmptyString((r as { reason?: string }).reason)
            )
            .map((r) => ({
              approach: (r as { approach: string }).approach.trim(),
              reason: (r as { reason: string }).reason.trim()
            }))
        : [];
      if (!isNonEmptyString(a.chosenApproach)) {
        return { ok: false, error: 'think_frame requires chosenApproach' };
      }
      if (rejected.length === 0) {
        return { ok: false, error: 'think_frame requires rejectedAlternatives' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'think_frame',
          chosenApproach: a.chosenApproach.trim(),
          rejectedAlternatives: rejected,
          hypotheses: isStringArray(a.hypotheses) ? a.hypotheses : [],
          constraints: isStringArray(a.constraints) ? a.constraints : []
        }
      };
    }
    case 'plan': {
      const steps = parsePlanSteps((artifactRaw as { steps?: unknown }).steps);
      if (steps.length === 0) {
        return { ok: false, error: 'plan requires numbered steps' };
      }
      const orders = new Set(steps.map((s) => s.order));
      if (orders.size !== steps.length) {
        return { ok: false, error: 'plan steps must have unique order values' };
      }
      return { ok: true, subtaskId: subtaskId.trim(), phase, artifact: { phase: 'plan', steps } };
    }
    case 'rethink': {
      const a = artifactRaw as Record<string, unknown>;
      const risks = isStringArray(a.unaddressedHighRisks) ? a.unaddressedHighRisks : [];
      if (!isNonEmptyString(a.riskiestAssumption) || !isNonEmptyString(a.attackNotes)) {
        return { ok: false, error: 'rethink requires riskiestAssumption and attackNotes' };
      }
      if (risks.some((r) => r.trim().length > 0)) {
        return { ok: false, error: 'unaddressedHighRisks must be empty to pass gate' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'rethink',
          riskiestAssumption: a.riskiestAssumption.trim(),
          attackNotes: a.attackNotes.trim(),
          unaddressedHighRisks: []
        }
      };
    }
    case 'checkpoint': {
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: { phase: 'checkpoint', ready: true }
      };
    }
    case 'execute': {
      const a = artifactRaw as Record<string, unknown>;
      if (!isNonEmptyString(a.incrementSummary) || a.selfConsistent !== true) {
        return { ok: false, error: 'execute requires incrementSummary and selfConsistent:true' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'execute',
          incrementSummary: a.incrementSummary.trim(),
          codeLinks: parseCodeLinks(a.codeLinks),
          selfConsistent: true
        }
      };
    }
    case 'verify': {
      const a = artifactRaw as Record<string, unknown>;
      if (a.supplementalChecksPass !== true) {
        return { ok: false, error: 'verify requires supplementalChecksPass:true' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'verify',
          validationNotes: isNonEmptyString(a.validationNotes) ? a.validationNotes.trim() : '',
          supplementalChecksPass: true
        }
      };
    }
    case 'diagnose': {
      const a = artifactRaw as Record<string, unknown>;
      const classification = a.classification;
      const targetPhase = a.targetPhase;
      if (
        typeof classification !== 'string' ||
        typeof targetPhase !== 'string' ||
        !isExecutionPhase(targetPhase) ||
        !isDiagnoseClassification(classification)
      ) {
        return { ok: false, error: 'diagnose requires classification and targetPhase' };
      }
      if (!isNonEmptyString(a.evidence) || !isNonEmptyString(a.citeLedgerEntryId)) {
        return { ok: false, error: 'diagnose requires evidence and citeLedgerEntryId' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: {
          phase: 'diagnose',
          classification,
          targetPhase,
          evidence: a.evidence.trim(),
          citeLedgerEntryId: a.citeLedgerEntryId.trim()
        }
      };
    }
    case 'reflect': {
      const a = artifactRaw as Record<string, unknown>;
      const lessons = isStringArray(a.lessons) ? a.lessons.filter((l) => l.trim().length > 0) : [];
      const remainingSteps = parsePlanSteps(a.remainingSteps);
      if (lessons.length === 0) {
        return { ok: false, error: 'reflect requires lessons' };
      }
      return {
        ok: true,
        subtaskId: subtaskId.trim(),
        phase,
        artifact: { phase: 'reflect', lessons, remainingSteps }
      };
    }
    default: {
      const _exhaustive: never = phase;
      return { ok: false, error: `unsupported phase: ${_exhaustive}` };
    }
  }
}

const EXECUTION_PHASE_SET = new Set<string>([
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
]);

export function isExecutionPhase(v: string): v is ExecutionPhase {
  return EXECUTION_PHASE_SET.has(v);
}

function isDiagnoseClassification(
  v: string
): v is import('@shared/types/phased.js').DiagnoseClassification {
  return (
    v === 'wrong_facts' ||
    v === 'wrong_approach' ||
    v === 'bad_implementation' ||
    v === 'test_failure' ||
    v === 'blocked_environment'
  );
}

export function exitCriteriaForPhase(phase: ExecutionPhase): string {
  switch (phase) {
    case 'intake':
      return 'Goal restated; done-criteria and acceptance commands declared';
    case 'understand':
      return 'Fact ledger complete; no open ambiguities';
    case 'think_frame':
      return 'Chosen approach recorded with rejected alternatives';
    case 'plan':
      return 'Every step maps to a done-criterion and verification method';
    case 'rethink':
      return 'No unaddressed high-risk assumptions';
    case 'checkpoint':
      return 'Manifest-head restore marker recorded';
    case 'execute':
      return 'Increment complete and self-consistent';
    case 'verify':
      return 'Declared acceptance commands pass; supplemental validation green';
    case 'diagnose':
      return 'Failure classified with cited ledger entry and target phase';
    case 'reflect':
      return 'Lessons recorded; remaining steps re-derived';
    case 'done':
      return 'All subtasks complete';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function nextPhaseAfter(phase: ExecutionPhase): ExecutionPhase {
  switch (phase) {
    case 'intake':
      return 'understand';
    case 'understand':
      return 'think_frame';
    case 'think_frame':
      return 'plan';
    case 'plan':
      return 'rethink';
    case 'rethink':
      return 'checkpoint';
    case 'checkpoint':
      return 'execute';
    case 'execute':
      return 'verify';
    case 'verify':
      return 'reflect';
    case 'reflect':
      return 'done';
    case 'diagnose':
      return 'understand';
    case 'done':
      return 'done';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function phaseLabel(phase: ExecutionPhase): string {
  switch (phase) {
    case 'intake':
      return 'Intake';
    case 'understand':
      return 'Understand';
    case 'think_frame':
      return 'Think / Frame';
    case 'plan':
      return 'Plan';
    case 'rethink':
      return 'Rethink';
    case 'checkpoint':
      return 'Checkpoint';
    case 'execute':
      return 'Execute';
    case 'verify':
      return 'Verify + Tests';
    case 'diagnose':
      return 'Diagnose';
    case 'reflect':
      return 'Reflect';
    case 'done':
      return 'Done';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
