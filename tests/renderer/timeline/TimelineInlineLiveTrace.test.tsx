/**
 * Timeline inline live trace regression.
 *
 * The active run should read like the reference trace: task header,
 * live phase line, then tool/agent rows in the same turn. The live
 * phase must not also render at the global tail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
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

  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c-inline-live',
    isProcessing: true,
    runStartedAt: 1000,
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      id: 'rs-live',
      ts: Date.now(),
      phase: 'running-tool',
      label: 'Running tool',
      detail: { toolName: 'read' }
    },
    events: [
      {
        kind: 'user-prompt',
        id: 'p-live',
        ts: 1000,
        content: 'Analyze the screenshot and stream tool progress'
      }
    ] satisfies TimelineEvent[]
  });
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
    isProcessing: false,
    runStartedAt: null
  });
});

describe('Timeline inline live trace', () => {
  it('mounts live status in the inline stream under the active prompt', () => {
    const { container } = render(<Timeline />);

    const prompt = container.querySelector('[data-row-kind="user-prompt"]');
    const inlineStream = container.querySelector('[data-turn-inline-stream]');
    const liveRows = container.querySelectorAll('[data-row-kind="live-status"]');
    const liveStatus = liveRows[0];

    expect(prompt).not.toBeNull();
    expect(inlineStream).not.toBeNull();
    expect(liveRows).toHaveLength(1);
    expect(liveStatus).not.toBeUndefined();
    expect(inlineStream?.contains(liveStatus ?? null)).toBe(true);
    expect(prompt!.compareDocumentPosition(liveStatus!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent ?? '').toContain('Exploring');
    // May 2026 restyle: the user-prompt row no longer wraps content in
    // a SurfaceShell card, and the visible "You" eyebrow was removed.
    // The row is now flush in the agent column rail and carries the
    // canonical reading-column tokens.
    expect(container.querySelector('[data-row-kind="user-prompt"] .surface-shell')).toBeNull();
    expect(prompt!.className).toContain('max-w-[46rem]');
    expect(prompt!.className).toContain('pl-3.5');
  });
});
