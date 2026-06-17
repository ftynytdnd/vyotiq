/**
 * Failure classification → target phase routing (no full-loop rewind).
 */

import type { DiagnoseClassification, ExecutionPhase } from '@shared/types/phased.js';

export function routeDiagnoseTarget(classification: DiagnoseClassification): ExecutionPhase {
  switch (classification) {
    case 'wrong_facts':
      return 'understand';
    case 'wrong_approach':
      return 'think_frame';
    case 'bad_implementation':
      return 'execute';
    case 'test_failure':
      return 'verify';
    case 'blocked_environment':
      return 'understand';
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

/**
 * Human-readable label for the approach/work that failed, derived from the
 * diagnose classification. Used for the ledger `attemptedApproaches` entry so
 * the inspector shows *what* failed (not the routing target).
 */
export function diagnoseFailedApproachLabel(classification: DiagnoseClassification): string {
  switch (classification) {
    case 'wrong_facts':
      return 'Prior understanding of the code';
    case 'wrong_approach':
      return 'Chosen approach / framing';
    case 'bad_implementation':
      return 'Implementation increment';
    case 'test_failure':
      return 'Implementation (failed acceptance tests)';
    case 'blocked_environment':
      return 'Execution environment';
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

export function failureSignature(parts: {
  phase: ExecutionPhase;
  classification?: DiagnoseClassification;
  message: string;
}): string {
  const norm = parts.message.trim().slice(0, 200).toLowerCase();
  return `${parts.phase}|${parts.classification ?? 'none'}|${norm}`;
}
