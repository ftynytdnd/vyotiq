/**
 * Regression for the phase_gate tool-call/result pairing bug (audit H1).
 *
 * The orchestrator loop must include each processed `phase_gate` call in the
 * assistant message's `tool_calls`, because `interceptPhaseGate` settles a
 * `role:'tool'` result for it. If the assistant message omits the call, the
 * result is an orphan that `sanitizeToolPairing` drops every phased turn (which
 * is exactly what `vyotiq.log` showed: repeated
 * "dropping orphan role:tool message ... functions.phase_gate:0").
 */

import { describe, expect, it, vi } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import {
  interceptPhaseGate,
  settleSupersededPhaseGate
} from '../../../../src/main/orchestrator/loop/phaseGateIntercept.js';
import {
  insertHistoryBeforeTail,
  seedCacheLayeredMessages
} from '../../../../src/main/orchestrator/context/buildContextLayers.js';
import { sanitizeToolCallPairingWithStats } from '../../../../src/main/orchestrator/loop/sanitizeToolPairing.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';
import type { ChatMessage, TimelineEvent } from '../../../../src/shared/types/chat.js';

vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  recordCheckpointMarker: vi.fn(async () => ({ checkpointId: 'cp', lastEntryId: '', entryCount: 0 })),
  revertEntriesAfterMarker: vi.fn(async () => ({ ok: true, reverted: 0 }))
}));

function makeEngine(events: TimelineEvent[]): PhaseEngine {
  return new PhaseEngine({
    runId: 'run-pair',
    workspaceId: 'ws',
    workspacePath: '/tmp/ws',
    prompt: 'implement a feature',
    settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
    emit: (e) => events.push(e)
  });
}

function intakeArgs(subtaskId: string) {
  return {
    subtaskId,
    phase: 'intake' as const,
    artifact: {
      phase: 'intake' as const,
      goalRestatement: 'do it',
      doneCriteria: [{ id: 'c1', description: 'works' }],
      acceptanceCommands: ['npm test']
    }
  };
}

function assistantToolCalls(messages: ChatMessage[], ...ids: string[]): void {
  insertHistoryBeforeTail(messages, {
    role: 'assistant',
    content: null,
    tool_calls: ids.map((id) => ({
      id,
      type: 'function' as const,
      function: { name: 'phase_gate', arguments: '{}' }
    }))
  });
}

describe('phase_gate tool pairing (audit H1)', () => {
  it('leaves no orphan when the gate call is listed in the assistant message', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    const messages = seedCacheLayeredMessages([], '<turn>go</turn>');

    // The loop lists the processed phase_gate call in the assistant message...
    assistantToolCalls(messages, 'g0');
    // ...then the engine settles its tool result (same id).
    const outcome = await interceptPhaseGate({
      engine,
      tc: { id: 'g0', name: 'phase_gate', argumentsBuf: JSON.stringify(intakeArgs(engine.activeSubtaskId)) },
      messages,
      emit: (e) => events.push(e),
      runId: 'run-pair'
    });

    expect(outcome.kind).toBe('continued');
    const { stats } = sanitizeToolCallPairingWithStats(messages);
    expect(stats.droppedOrphans).toBe(0);
    expect(stats.injectedStubs).toBe(0);
    // The phase_gate tool result must survive sanitisation.
    const sanitized = sanitizeToolCallPairingWithStats(messages).messages;
    expect(sanitized.some((m) => m.role === 'tool' && m.tool_call_id === 'g0')).toBe(true);
  });

  it('detects the bug: an omitted gate call orphans its tool result', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    const messages = seedCacheLayeredMessages([], '<turn>go</turn>');

    // Reproduce the old behaviour: assistant message WITHOUT the phase_gate id.
    insertHistoryBeforeTail(messages, { role: 'assistant', content: 'thinking' });
    await interceptPhaseGate({
      engine,
      tc: { id: 'g0', name: 'phase_gate', argumentsBuf: JSON.stringify(intakeArgs(engine.activeSubtaskId)) },
      messages,
      emit: (e) => events.push(e),
      runId: 'run-pair'
    });

    const { stats } = sanitizeToolCallPairingWithStats(messages);
    expect(stats.droppedOrphans).toBe(1);
  });

  it('pairs every gate id when multiple gate calls are emitted in one turn', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    const messages = seedCacheLayeredMessages([], '<turn>go</turn>');

    // Two phase_gate calls in one turn: both ids listed on the assistant message.
    assistantToolCalls(messages, 'g0', 'g1');
    // The first advances the engine; the extra is settled as superseded.
    await settleSupersededPhaseGate({ id: 'g1', name: 'phase_gate', argumentsBuf: '{}' }, messages, (e) =>
      events.push(e)
    );
    await interceptPhaseGate({
      engine,
      tc: { id: 'g0', name: 'phase_gate', argumentsBuf: JSON.stringify(intakeArgs(engine.activeSubtaskId)) },
      messages,
      emit: (e) => events.push(e),
      runId: 'run-pair'
    });

    const { stats } = sanitizeToolCallPairingWithStats(messages);
    expect(stats.droppedOrphans).toBe(0);
    expect(stats.injectedStubs).toBe(0);
  });
});
