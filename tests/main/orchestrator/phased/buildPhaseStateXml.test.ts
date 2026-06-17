import { describe, expect, it } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import { buildPhaseStateXml } from '../../../../src/main/orchestrator/phased/buildPhaseStateXml.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';

function makeEngine(): PhaseEngine {
  return new PhaseEngine({
    runId: 'run-xml',
    workspaceId: 'ws',
    workspacePath: '/tmp/ws',
    prompt: 'implement a multi-step feature',
    settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
    emit: () => {}
  });
}

describe('buildPhaseStateXml', () => {
  it('reports inactive for a null / inactive engine', () => {
    expect(buildPhaseStateXml(null)).toContain('inactive');
  });

  it('exposes plan steps, done-criteria and subtask roster', () => {
    const engine = makeEngine();
    engine.doneCriteria = [{ id: 'c1', description: 'Parser handles edge cases' }];
    engine.planSteps = [
      {
        subtaskId: 'st-2',
        order: 1,
        description: 'Add tokenizer guard',
        doneCriterionId: 'c1',
        verificationMethod: 'npm test'
      }
    ];
    engine.subtasks = [
      { subtaskId: 'root-1', description: 'Root task', currentPhase: 'plan', isRoot: true },
      { subtaskId: 'st-2', description: 'Tokenizer subtask', currentPhase: 'understand', isRoot: false }
    ];
    engine.activeSubtaskId = 'root-1';
    engine.ledgerEntryIds = ['led-1', 'led-2'];

    const xml = buildPhaseStateXml(engine);
    expect(xml).toContain('<phase_state>');
    expect(xml).toContain('done_criteria:');
    expect(xml).toContain('c1: Parser handles edge cases');
    expect(xml).toContain('plan_steps_remaining:');
    expect(xml).toContain('Add tokenizer guard');
    expect(xml).toContain('subtasks:');
    expect(xml).toContain('Tokenizer subtask');
    expect(xml).toContain('recent_ledger_entry_ids: led-1, led-2');
  });
});
