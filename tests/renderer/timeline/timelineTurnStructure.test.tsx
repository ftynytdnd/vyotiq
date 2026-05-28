/**

 * Multi-turn transcript hierarchy — prompt card, activity rows, prose, run closer.

 */



import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, render } from '@testing-library/react';

import { Timeline } from '@renderer/components/timeline/Timeline';

import { useChatStore } from '@renderer/store/useChatStore';

import { rebuildTimelineState } from '@renderer/components/timeline/reducer/applyTimelineEvent';

import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

import { chatSliceFixture } from '../../_fixtures/chatSlice';

import type { TimelineEvent } from '@shared/types/chat';

import { AGENT_NAME } from '@shared/constants.js';



const CONV_ID = 'c-turns';



const TURN_EVENTS = [

  {

    kind: 'user-prompt',

    id: 'p-1',

    ts: 100,

    content: 'First question'

  },

  {

    kind: 'agent-text-delta',

    id: 'a-1',

    ts: 200,

    delta: 'First answer.'

  },

  {

    kind: 'agent-text-end',

    id: 'a-1',

    ts: 201

  },

  {

    kind: 'user-prompt',

    id: 'p-2',

    ts: 500,

    content: 'Second question'

  },

  {

    kind: 'agent-text-delta',

    id: 'a-2',

    ts: 600,

    delta: 'Second answer.'

  },

  {

    kind: 'agent-text-end',

    id: 'a-2',

    ts: 601

  }

] satisfies TimelineEvent[];



function resetStore(): void {

  useChatStore.setState({

    ...INITIAL_TIMELINE_STATE,

    orchestratorUsage: undefined,

    conversationId: null,

    runId: null,

    isProcessing: false,

    runStartedAt: null,

    slices: {},

    runIdToConv: {},

    runIdToModel: {}

  });

}



function seedMultiTurnTranscript(): void {

  const timeline = rebuildTimelineState(TURN_EVENTS);

  const slice = chatSliceFixture({

    conversationId: CONV_ID,

    isProcessing: false,

    ...timeline

  });



  useChatStore.setState({

    ...timeline,

    conversationId: CONV_ID,

    isProcessing: false,

    slices: { [CONV_ID]: slice }

  });

}



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



  resetStore();

  seedMultiTurnTranscript();

});



afterEach(() => {

  cleanup();

  vi.useRealTimers();

  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;

  window.requestAnimationFrame = originalRaf;

  window.cancelAnimationFrame = originalCaf;

  resetStore();

});



describe('Timeline multi-turn structure', () => {

  it('orders user card → activity → assistant prose → run closer per turn', () => {

    const { container } = render(<Timeline />);



    const prompts = container.querySelectorAll('[data-row-kind="user-prompt"]');

    expect(prompts).toHaveLength(2);

    // May 2026 restyle: prompt rows are flush in the agent column.
    expect(prompts[0]?.querySelector('.surface-shell')).toBeNull();

    expect(prompts[1]?.querySelector('.surface-shell')).toBeNull();



    const assistantRows = container.querySelectorAll('[data-row-kind="assistant-text"]');

    expect(assistantRows).toHaveLength(2);

    // Visible AGENT_NAME eyebrow dropped — a11y label now carries it.
    expect(assistantRows[0]?.getAttribute('aria-label')).toBe(`${AGENT_NAME} response`);

    expect(assistantRows[0]?.textContent ?? '').toContain('First answer.');



    const runComplete = container.querySelector('[data-row-kind="run-complete"]');

    expect(runComplete).not.toBeNull();



    const transcript = container.textContent ?? '';

    const firstPromptIdx = transcript.indexOf('First question');

    const firstAnswerIdx = transcript.indexOf('First answer.');

    const runCloserIdx = transcript.indexOf('done in');

    const secondPromptIdx = transcript.indexOf('Second question');

    expect(firstPromptIdx).toBeGreaterThanOrEqual(0);

    expect(firstAnswerIdx).toBeGreaterThan(firstPromptIdx);

    expect(runCloserIdx).toBeGreaterThan(firstAnswerIdx);

    expect(secondPromptIdx).toBeGreaterThan(runCloserIdx);

  });

});


