/**
 * Structured `ask_user` payload when phased execution hits escape hatch.
 */

import type { GuardTripReason } from './terminationGuards.js';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import { PHASED_ESCAPE_ACTION_IDS } from '@shared/types/phased.js';

export function buildPhasedEscapeAskUser(
  trip: GuardTripReason,
  ledgerEntryIds: string[]
): AskUserStructuredPayload {
  const cite = ledgerEntryIds.slice(-3).join(', ') || '(none)';
  let summary: string;
  switch (trip.kind) {
    case 'no_progress':
      summary = `Phased execution stalled: same failure signature repeated (${trip.count}×). Cited ledger: ${cite}.`;
      break;
    case 'phase_cycle_cap':
      summary = `Per-subtask phase cycle cap reached (${trip.used}/${trip.cap}). Cited ledger: ${cite}.`;
      break;
    case 'global_iteration_cap':
      summary = `Global iteration cap approaching (${trip.iteration}/${trip.cap}). Cited ledger: ${cite}.`;
      break;
    case 'token_budget':
      summary = `Run token budget exceeded. Cited ledger: ${cite}.`;
      break;
    case 'wall_clock_budget':
      summary = `Run wall-clock budget exceeded. Cited ledger: ${cite}.`;
      break;
    default: {
      const _exhaustive: never = trip;
      summary = String(_exhaustive);
    }
  }

  return {
    title: 'Phased execution stuck',
    questions: [
      {
        id: 'escape_action',
        prompt: summary,
        options: [
          { id: PHASED_ESCAPE_ACTION_IDS.supply_info, label: 'Supply missing info / credentials' },
          { id: PHASED_ESCAPE_ACTION_IDS.approve_approach, label: 'Approve a different approach' },
          { id: PHASED_ESCAPE_ACTION_IDS.rollback, label: 'Roll back to last checkpoint and retry' },
          { id: PHASED_ESCAPE_ACTION_IDS.abort, label: 'Abort this run' }
        ],
        allow_multiple: false
      }
    ]
  };
}
