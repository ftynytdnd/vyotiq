/**
 * `ReasoningLineRow` auto-expand contract.
 *
 * The row's expanded state is derived from the reasoning accumulator's
 * `done` flag with a one-shot user override:
 *
 *   - streaming (`done === false`) → expanded by default,
 *   - completed (`done === true`)  → collapsed by default,
 *   - any chevron click locks the visible state for the lifetime of
 *     this component instance, so the auto-flip on `done` no longer
 *     fires once the user has interacted.
 *
 * These specs guard the "Thinking panel auto-opens live, then folds
 * back to a single-line summary" UX so a future refactor can't silently
 * regress it. The reducer-level stopwatch contract is covered in a
 * sibling spec (`reasoningStopwatch.test.ts`); we don't duplicate it
 * here.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { ReasoningLineRow } from '@renderer/components/timeline/rows/ReasoningLineRow';
import { useChatStore } from '@renderer/store/useChatStore';
import type { ReasoningTextAcc } from '@renderer/components/timeline/reducer/types';

const ROW_ID = 'r1';

async function setReasoning(acc: ReasoningTextAcc | undefined): Promise<void> {
  // Drive the real selector path. The store is a plain Zustand store,
  // so a partial `setState` patch is the canonical way to inject
  // reducer output into a component test without mocking. Wrapped in
  // an async `act` so the external-store subscription's scheduled
  // re-render flushes before the next assertion (otherwise React 18
  // logs an `act(...)` warning even though the result is correct).
  await act(async () => {
    useChatStore.setState({
      reasoningTexts: acc ? { [acc.id]: acc } : {}
    });
  });
}

function streaming(text = 'pondering the question'): ReasoningTextAcc {
  return { id: ROW_ID, text, done: false, startedAt: 1_000 };
}

function completed(text = 'pondering the question'): ReasoningTextAcc {
  return {
    id: ROW_ID,
    text,
    done: true,
    startedAt: 1_000,
    endedAt: 4_000
  };
}

describe('ReasoningLineRow auto-expand', () => {
  beforeEach(() => {
    // Clean slate for every spec. `setTranscript(null, [])` would also
    // work but pulls in IPC bookkeeping we don't need here. RTL's
    // `cleanup` (registered in `tests/setup/rendererSetup.ts`) unmounts
    // the previous test's component before this fires, so we don't risk
    // an act() warning from a still-mounted subscriber.
    useChatStore.setState({ reasoningTexts: {} });
  });

  it('renders nothing when the accumulator is missing', () => {
    const { container } = render(<ReasoningLineRow id={ROW_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the body is whitespace-only', async () => {
    await setReasoning({ id: ROW_ID, text: '   ', done: false, startedAt: 1_000 });
    const { container } = render(<ReasoningLineRow id={ROW_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it('auto-expands while streaming (done === false)', async () => {
    await setReasoning(streaming('live thought stream'));
    const { container } = render(<ReasoningLineRow id={ROW_ID} />);
    // Body text is rendered inside `NestedDetailRail` only when expanded.
    expect(container.textContent).toContain('Thinking…');
    expect(container.textContent).toContain('live thought stream');
  });

  it('auto-collapses when reasoning completes (done === true)', async () => {
    await setReasoning(completed('hidden thought body'));
    const { container } = render(<ReasoningLineRow id={ROW_ID} />);
    expect(container.textContent).toMatch(/Thought for \d+s/);
    expect(container.textContent).not.toContain('hidden thought body');
  });

  it('manual collapse during streaming survives the done flip', async () => {
    await setReasoning(streaming('still streaming'));
    const { container, getByRole } = render(<ReasoningLineRow id={ROW_ID} />);
    // Sanity: starts expanded.
    expect(container.textContent).toContain('still streaming');

    // User collapses while streaming.
    fireEvent.click(getByRole('button'));
    expect(container.textContent).not.toContain('still streaming');

    // Reasoning ends — auto rule would re-collapse, but we're already
    // collapsed AND the override is active, so the row must stay closed.
    await setReasoning(completed('still streaming'));
    expect(container.textContent).not.toContain('still streaming');
    expect(container.textContent).toMatch(/Thought for \d+s/);
  });

  it('caps the expanded body height with internal scroll', async () => {
    // Long thought stream — without a height cap this would render
    // dozens of rems and dominate the timeline. The body container
    // must carry both `max-h-*` and `overflow-y-auto` so the surface
    // stays bounded regardless of stream length.
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    await setReasoning(streaming(long));
    const { container } = render(<ReasoningLineRow id={ROW_ID} />);
    const body = container.querySelector('div.whitespace-pre-wrap');
    expect(body).not.toBeNull();
    expect(body?.className).toMatch(/max-h-/);
    expect(body?.className).toMatch(/overflow-y-auto/);
    // Sanity: full text is still in the DOM (just clipped visually).
    expect(body?.textContent).toContain('line 79');
  });

  it('manual expand on a finished row survives subsequent re-renders', async () => {
    await setReasoning(completed('archived thought'));
    const { container, getByRole, rerender } = render(
      <ReasoningLineRow id={ROW_ID} />
    );
    // Sanity: starts collapsed.
    expect(container.textContent).not.toContain('archived thought');

    // User expands a completed row.
    fireEvent.click(getByRole('button'));
    expect(container.textContent).toContain('archived thought');

    // Force a re-render via a fresh store update; the override must
    // continue to win against `acc.done === true`.
    await setReasoning(completed('archived thought'));
    rerender(<ReasoningLineRow id={ROW_ID} />);
    expect(container.textContent).toContain('archived thought');
  });
});
