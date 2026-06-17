/**
 * Builds `<phase_state>` envelope for phased execution runs.
 */

import { wrapXml } from '../envelope/index.js';
import type { PhaseEngine } from '../phased/phaseEngine.js';

const MAX_DESC = 120;

function clip(s: string, max = MAX_DESC): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildPhaseStateXml(engine: PhaseEngine | null): string {
  if (!engine?.active) {
    return wrapXml('phase_state', 'inactive');
  }
  const lines: string[] = [
    `active_subtask_id: ${engine.activeSubtaskId}`,
    ...engine.buildRunStateLines()
  ];

  if (engine.doneCriteria.length > 0) {
    lines.push('done_criteria:');
    for (const c of engine.doneCriteria) {
      lines.push(`  - ${c.id}: ${clip(c.description)}`);
    }
  }

  if (engine.planSteps.length > 0) {
    lines.push('plan_steps_remaining:');
    for (const s of engine.planSteps) {
      lines.push(
        `  - [${s.order}] ${clip(s.description)} (criterion=${s.doneCriterionId}; verify=${clip(s.verificationMethod, 80)})`
      );
    }
  }

  if (engine.subtasks.length > 1) {
    lines.push('subtasks:');
    for (const st of engine.subtasks) {
      const marker = st.subtaskId === engine.activeSubtaskId ? '▸' : ' ';
      lines.push(
        `  ${marker} ${st.subtaskId.slice(0, 8)} [${st.currentPhase}] ${clip(st.description, 80)}`
      );
    }
  }

  if (engine.ledgerEntryIds.length > 0) {
    const recent = engine.ledgerEntryIds.slice(-5).join(', ');
    lines.push(`recent_ledger_entry_ids: ${recent}`);
  }

  return wrapXml('phase_state', lines.join('\n'));
}
