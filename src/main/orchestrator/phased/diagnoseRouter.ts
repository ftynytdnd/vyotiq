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

export function failureSignature(parts: {
  phase: ExecutionPhase;
  classification?: DiagnoseClassification;
  message: string;
}): string {
  const norm = parts.message.trim().slice(0, 200).toLowerCase();
  return `${parts.phase}|${parts.classification ?? 'none'}|${norm}`;
}
