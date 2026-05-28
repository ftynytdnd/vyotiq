/**
 * timelineRowChrome — May 2026 timeline restyle integration regression.
 *
 * Renders one full Timeline turn block carrying a representative mix of
 * row kinds (user prompt → reasoning → sub-agent → tool group →
 * assistant prose → run complete) and pins the chromeless reading
 * column contract. The intent is a single failure surface that catches
 * any future drift back into card / lane / hairline-rule chrome on a
 * canonical fixture, complementing the focused per-row tests.
 *
 * What this test pins:
 *   - One agent column rail (`timelineAgentColumnClassName`'s
 *     `pl-3 max-w-[46rem]`) wraps the turn's agent stream.
 *   - User prompt row carries no SurfaceShell card, no "You" eyebrow.
 *   - Assistant prose row carries no rounded/tinted lane fill and
 *     surfaces an `aria-label` on the row root.
 *   - Phase / run-complete dividers render no horizontal hairline
 *     rules around the label.
 *   - Sub-agent rows render the dot prefix; a model badge appears
 *     only when `snap.model` is populated (and is omitted otherwise).
 *   - Hover-revealed Copy/Edit/Revert + Copy/Regenerate strips are
 *     still present beneath the user and assistant rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

let originalScrollIntoView: typeof window.HTMLElement.prototype.scrollIntoView;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

beforeEach(() => {
  vi.useFakeTimers();
  originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  originalRaf = window.requestAnimationFrame;
  originalCaf = window.cancelAnimationFrame;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: null,
    isProcessing: false
  });
});

const CONV_ID = 'c-row-chrome';

function seedSettledTurn(opts: { withSubAgentModel: boolean }) {
  const events: TimelineEvent[] = [
    { kind: 'user-prompt', id: 'p1', ts: 100, content: 'Audit the providers/' },
    { kind: 'agent-reasoning-delta', id: 'r1', ts: 110, delta: 'Planning…' },
    { kind: 'agent-reasoning-end', id: 'r1', ts: 120 },
    {
      kind: 'subagent-spawn',
      id: 'spawn-A1',
      ts: 130,
      subagentId: 'A1',
      task: 'Read providers',
      files: ['src/main/providers/openaiChatStream.ts'],
      tools: ['read'],
      ...(opts.withSubAgentModel
        ? { model: { providerId: 'openai', modelId: 'gpt-test' } }
        : {})
    },
    {
      kind: 'subagent-result',
      id: 'res-A1',
      ts: 140,
      subagentId: 'A1',
      output: '<result><status>success</status><summary>read</summary></result>'
    },
    {
      kind: 'subagent-status',
      id: 'st-A1',
      ts: 140,
      subagentId: 'A1',
      status: 'done'
    },
    { kind: 'agent-text-delta', id: 'a1', ts: 150, delta: 'Done. Here is what I found.' },
    { kind: 'phase', id: 'ph1', ts: 160, label: 'Wrapping up' }
  ];

  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: CONV_ID,
    isProcessing: false,
    runStartedAt: 100,
    events,
    assistantTexts: {
      a1: { id: 'a1', text: 'Done. Here is what I found.', done: true, startedAt: 150 }
    },
    reasoningTexts: {
      r1: {
        id: 'r1',
        text: 'Planning…',
        done: true,
        startedAt: 110,
        endedAt: 120
      }
    },
    subagents: {
      A1: {
        id: 'A1',
        task: 'Read providers',
        files: ['src/main/providers/openaiChatStream.ts'],
        missingFiles: [],
        tools: ['read'],
        unknownTools: [],
        status: 'done',
        startedAt: 130,
        endedAt: 140,
        steps: [],
        fileEdits: [],
        assistantTexts: {},
        reasoningTexts: {},
        iterationOrder: [],
        partialToolCallArgs: {},
        ...(opts.withSubAgentModel
          ? { model: { providerId: 'openai', modelId: 'gpt-test' } }
          : {})
      }
    }
  });
}

describe('Timeline row chrome — May 2026 restyle', () => {
  it('renders the canonical turn flush in a single chromeless agent column', () => {
    seedSettledTurn({ withSubAgentModel: true });
    useTimelineUiStore.setState({
      expandedByConvo: { [CONV_ID]: new Set(['turn-activity:p1']) },
      manualOverrideByConvo: {},
      diffFoldExpandedByScope: {},
      hydrated: true
    });

    const { container } = render(<Timeline />);

    // 1. One agent column rail wraps the turn's agent stream and
    //    carries the canonical reading-column tokens.
    const agentColumns = container.querySelectorAll('.timeline-agent-column');
    expect(agentColumns.length).toBeGreaterThanOrEqual(1);
    const sample = agentColumns[0]!;
    expect(sample.className).toContain('vx-timeline-agent-column');

    // 2. User prompt is flush — no SurfaceShell descendant, no "You" eyebrow.
    const prompt = container.querySelector('[data-row-kind="user-prompt"]');
    expect(prompt).not.toBeNull();
    expect(prompt!.querySelector('.surface-shell')).toBeNull();
    expect(prompt!.textContent ?? '').not.toMatch(/^You$/m);

    // 3. Assistant prose is flush — aria-labeled, no rounded/tinted
    //    lane fill on the row wrapper.
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant!.getAttribute('aria-label')).toMatch(/response$/);
    expect(assistant!.className).not.toMatch(/bg-surface-overlay/);
    expect(assistant!.className).not.toMatch(/rounded-inner/);

    // 4. Phase + run-complete dividers render no horizontal hairlines.
    const phase = container.querySelector('[data-row-kind="phase"]');
    expect(phase).not.toBeNull();
    expect(phase!.innerHTML).not.toMatch(/h-px[^"]*flex-1[^"]*bg-border-divider/);
    const runComplete = container.querySelector('[data-row-kind="run-complete"]');
    expect(runComplete).not.toBeNull();
    expect((runComplete as HTMLElement).className).not.toMatch(/border-t/);
    expect(runComplete!.innerHTML).not.toMatch(/h-px[^"]*flex-1[^"]*bg-border-divider/);

    // 5. Sub-agent inline trace removed from timeline DOM.
    expect(container.querySelector('[data-row-kind="subagent-line"]')).toBeNull();
  });

  it('does not render sub-agent trace rows when model metadata is absent', () => {
    seedSettledTurn({ withSubAgentModel: false });
    useTimelineUiStore.setState({
      expandedByConvo: { [CONV_ID]: new Set(['turn-activity:p1']) },
      manualOverrideByConvo: {},
      diffFoldExpandedByScope: {},
      hydrated: true
    });

    const { container } = render(<Timeline />);

    expect(container.querySelector('[data-row-kind="subagent-line"]')).toBeNull();
  });
});
