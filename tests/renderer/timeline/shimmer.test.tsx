/**
 * Streaming shimmer contract — every in-flight timeline surface must
 * carry the `vyotiq-shimmer-*` classes while live, and shed them the
 * moment the underlying state reaches a terminal value. Also asserts
 * that the dropped `(task pending)` literal and deleted `PendingDot`
 * component never appear in the DOM.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { ReasoningLineRow } from '@renderer/components/timeline/rows/ReasoningLineRow';
import { LiveStatusRow } from '@renderer/components/timeline/rows/LiveStatusRow';
import { AgentThoughtRow } from '@renderer/components/timeline/rows/AgentThoughtRow';
import { SubAgentTrace } from '@renderer/components/timeline/subagent/SubAgentTrace';
import { SubAgentHeader } from '@renderer/components/timeline/subagent/SubAgentHeader';
import { ToolGroupRow } from '@renderer/components/timeline/rows/ToolGroupRow';
import { InvocationShell } from '@renderer/components/timeline/tools/shared/InvocationShell';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type {
  ReasoningTextAcc,
  SubAgentSnapshot
} from '@renderer/components/timeline/reducer/types';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows';
const REASONING_ID = 'r-stream';

async function seedReasoning(acc: ReasoningTextAcc): Promise<void> {
  await act(async () => {
    useChatStore.setState({
      reasoningTexts: { [acc.id]: acc }
    });
  });
}

async function seedSubagent(snap: SubAgentSnapshot): Promise<void> {
  await act(async () => {
    useChatStore.setState({
      subagents: { [snap.id]: snap },
      conversationId: 'c-test'
    });
  });
}

async function seedSubagents(snaps: SubAgentSnapshot[]): Promise<void> {
  await act(async () => {
    useChatStore.setState({
      subagents: Object.fromEntries(snaps.map((snap) => [snap.id, snap])),
      conversationId: 'c-test'
    });
  });
}

function makeSnap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'S1',
    task: 'probe the codebase',
    // Audit fix §1.1: per-iteration worker streaming accumulators
    // are now part of the snapshot shape. Empty fixtures keep the
    // existing shimmer contract assertions intact.
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: 0,
    steps: [],
    fileEdits: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

function callChild(withResult: boolean): ToolGroupChild {
  const child: ToolGroupChild = {
    callId: 'c1',
    call: { id: 'c1', name: 'bash', args: { command: 'echo hi' } }
  };
  if (withResult) {
    child.result = {
      id: 'c1',
      name: 'bash',
      ok: true,
      output: 'hi',
      durationMs: 1,
      data: {
        tool: 'bash',
        command: 'echo hi',
        stdout: 'hi',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false
      }
    };
  }
  return child;
}

beforeEach(() => {
  useChatStore.setState({
    reasoningTexts: {},
    subagents: {},
    conversationId: 'c-test'
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: false
  });
});

describe('ReasoningLineRow shimmer', () => {
  it('applies gold phase heading while streaming (done === false)', async () => {
    await seedReasoning({
      id: REASONING_ID,
      text: 'thinking…',
      done: false,
      startedAt: Date.now()
    });
    const { container } = render(<ReasoningLineRow id={REASONING_ID} />);
    const button = container.querySelector('button');
    const labels = button?.querySelectorAll('span');
    const labelClass = Array.from(labels ?? []).map((s) => s.className).join(' ');
    expect(labelClass).toMatch(/text-accent-gold/);
    expect(labelClass).not.toMatch(/vyotiq-shimmer-text/);
  });

  it('removes gold phase styling once reasoning completes (done === true)', async () => {
    await seedReasoning({
      id: REASONING_ID,
      text: 'thinking…',
      done: true,
      startedAt: 1_000,
      endedAt: 5_000
    });
    const { container } = render(<ReasoningLineRow id={REASONING_ID} />);
    const button = container.querySelector('button');
    const labels = button?.querySelectorAll('span');
    const labelClass = Array.from(labels ?? []).map((s) => s.className).join(' ');
    expect(labelClass).not.toMatch(/text-accent-gold/);
  });
});

describe('LiveStatusRow shimmer', () => {
  it('shimmers while a run is in flight', async () => {
    // The row renders only while `isProcessing` is true, so seed the
    // store accordingly. With no events / accumulators the row falls
    // through to the default `Awaiting response…` label, which is
    // still shimmered (the row only suppresses shimmer when nothing
    // is live — and `isProcessing === true` IS live by definition).
    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        events: [],
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {},
        runId: 'r-test',
        conversationId: 'c-test'
      });
    });
    const { container } = render(<LiveStatusRow />);
    expect(container.innerHTML).toContain('vyotiq-shimmer-text');
  });

  it('renders nothing when no run is in flight', async () => {
    await act(async () => {
      useChatStore.setState({
        isProcessing: false,
        runStartedAt: null,
        events: [],
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {}
      });
    });
    const { container } = render(<LiveStatusRow />);
    expect(container.innerHTML).toBe('');
  });

  it('uses gold Exploring headline during running-tool phase', async () => {
    await act(async () => {
      useChatStore.setState({
        isProcessing: true,
        runStartedAt: Date.now(),
        latestOrchestratorRunStatus: {
          kind: 'run-status',
          id: 'rs-explore',
          ts: Date.now(),
          phase: 'running-tool',
          label: 'Exploring',
          detail: { toolName: 'read' }
        },
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {}
      });
    });
    const { container } = render(<LiveStatusRow />);
    expect(container.textContent ?? '').toContain('Exploring');
    expect(container.innerHTML).toContain('text-accent-gold');
    expect(container.textContent ?? '').toContain('read');
    expect(container.innerHTML).not.toContain('vyotiq-shimmer-text');
  });
});

describe('AgentThoughtRow live phase heading', () => {
  it('uses gold phase heading for info-severity text when `live` is true', () => {
    const { container } = render(<AgentThoughtRow content="pondering" live />);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/text-accent-gold/);
    expect(span?.className).toMatch(/italic/);
    expect(span?.className ?? '').not.toMatch(/vyotiq-shimmer-text/);
  });

  it('does NOT use gold when `live` is false', () => {
    const { container } = render(<AgentThoughtRow content="pondering" live={false} />);
    const span = container.querySelector('span');
    expect(span?.className ?? '').not.toMatch(/text-accent-gold/);
    expect(span?.className).toMatch(/text-text-faint/);
  });

  it('never shimmers warnings even when `live`', () => {
    const { container } = render(
      <AgentThoughtRow content="retrying" severity="warn" live />
    );
    expect(container.innerHTML).not.toContain('vyotiq-shimmer-text');
  });
});

describe('SubAgentTrace — chevron-only row chrome', () => {
  it('omits shimmer and `(task pending)` while pending', async () => {
    await seedSubagent(makeSnap({ status: 'pending', task: '' }));
    const { container } = render(<SubAgentTrace subagentId="S1" />);
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-text/);
    expect(container.textContent ?? '').not.toContain('(task pending)');
    expect(container.querySelector('span.animate-pulse')).toBeNull();
  });

  it('keeps collapsed one-liners until expanded', async () => {
    await seedSubagents([
      makeSnap({ id: 'S1', startedAt: 1, status: 'running', task: 'worker one' }),
      makeSnap({ id: 'S2', startedAt: 2, status: 'running', task: 'worker two' })
    ]);
    const older = render(<SubAgentTrace subagentId="S1" />);
    expect(older.container.textContent ?? '').toContain('worker one');
    expect(older.container.textContent ?? '').not.toContain('Thought for');

    const latest = render(<SubAgentTrace subagentId="S2" />);
    expect(latest.container.textContent ?? '').toContain('worker two');
    expect(latest.container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('SubAgentHeader status pill shimmer', () => {
  it('shimmers the status pill while running', () => {
    const { container } = render(<SubAgentHeader snap={makeSnap({ status: 'running' })} />);
    expect(container.innerHTML).toMatch(/vyotiq-shimmer-pill/);
  });

  it('freezes the status pill once the sub-agent is done', () => {
    const { container } = render(<SubAgentHeader snap={makeSnap({ status: 'done' })} />);
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-pill/);
  });
});

describe('ToolGroupRow — chevron-only row chrome', () => {
  it('does not shimmer while a child is in-flight', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:1" toolName="bash" items={[callChild(false)]} />
    );
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-text/);
  });

  it('stays shimmer-free once every child has a result', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:2" toolName="bash" items={[callChild(true)]} />
    );
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-text/);
  });
});

describe('InvocationShell — chevron-only row chrome', () => {
  it('does not shimmer while pending (`ok === null`)', () => {
    const { container } = render(
      <InvocationShell
        title="bash"
        summary="echo hi"
        ok={null}
      />
    );
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-text/);
  });

  it('stays shimmer-free once resolved', () => {
    const { container } = render(
      <InvocationShell
        title="bash"
        summary="echo hi"
        ok
      />
    );
    expect(container.innerHTML).not.toMatch(/vyotiq-shimmer-text/);
  });
});
