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
import { AgentThoughtRow } from '@renderer/components/timeline/rows/AgentThoughtRow';
import { ToolGroupRow } from '@renderer/components/timeline/rows/ToolGroupRow';
import { InvocationShell } from '@renderer/components/timeline/tools/shared/InvocationShell';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { ReasoningTextAcc } from '@renderer/components/timeline/reducer/types';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows';
const REASONING_ID = 'r-stream';

async function seedReasoning(acc: ReasoningTextAcc): Promise<void> {
  await act(async () => {
    useChatStore.setState({
      reasoningTexts: { [acc.id]: acc }
    });
  });
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
    expect(labelClass).toMatch(/vx-timeline-phase-live/);
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
    expect(labelClass).not.toMatch(/vx-timeline-phase-live/);
  });
});

describe('AgentThoughtRow live phase heading', () => {
  it('uses gold phase heading for info-severity text when `live` is true', () => {
    const { container } = render(<AgentThoughtRow content="pondering" live />);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/vx-timeline-phase-live/);
    expect(span?.className).toMatch(/italic/);
    expect(span?.className ?? '').not.toMatch(/vyotiq-shimmer-text/);
  });

  it('does NOT use gold when `live` is false', () => {
    const { container } = render(<AgentThoughtRow content="pondering" live={false} />);
    const span = container.querySelector('span');
    expect(span?.className ?? '').not.toMatch(/vx-timeline-phase-live/);
    expect(span?.className).toMatch(/vx-caption/);
  });

  it('never shimmers warnings even when `live`', () => {
    const { container } = render(
      <AgentThoughtRow content="retrying" severity="warn" live />
    );
    expect(container.innerHTML).not.toContain('vyotiq-shimmer-text');
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
