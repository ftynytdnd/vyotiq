/**
 * `UserPromptRow` regression suite.
 *
 * Two behaviours are pinned here:
 *   1. Collapse + expand of long prompts (`overflow-hidden` clamp
 *      with a "Show more" toggle).
 *   2. Inline-Revert affordance contract. The Revert action lives
 *      inside the hover-reveal strip and is wired through
 *      `useRevertPrompt()`. Outside the provider the button renders
 *      disabled rather than crashing; the same disabled state
 *      appears while the active conversation is `isProcessing`.
 *
 * happy-dom does zero layout, so `scrollHeight` is always 0 by
 * default. We install a temporary prototype-level getter that
 * returns a value proportional to the element's rendered text
 * length. That puts the measuring code on its production code path
 * without resorting to brittle per-instance Object.defineProperty
 * gymnastics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { UserPromptRow } from '@renderer/components/timeline/rows/UserPromptRow';
import { RevertPromptProvider } from '@renderer/components/timeline/revert/RevertPromptContext';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

let originalDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'scrollHeight'
  );
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      // ≈ 1px per character. A 40-line paste (~250 chars) crosses
      // the 144px collapse threshold; a short "hello" does not.
      return this.textContent?.length ?? 0;
    }
  });
});

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(
      window.HTMLElement.prototype,
      'scrollHeight',
      originalDescriptor
    );
  } else {
    delete (window.HTMLElement.prototype as unknown as { scrollHeight?: unknown })
      .scrollHeight;
  }
  // Reset the chat store's active-mirror flags so a test that flips
  // `isProcessing` (or seeds `runIdToFileEditCount` for the badge
  // cases) doesn't bleed into the next test. Wrapped in `act()` so
  // the trailing state-flush after the test's mount doesn't trigger
  // React's "update was not wrapped in act" warning.
  act(() => {
    useChatStore.setState({
      isProcessing: false,
      conversationId: null,
      runIdToFileEditCount: {}
    });
  });
});

function findBubble(root: HTMLElement): HTMLDivElement {
  const el = root.querySelector('div.whitespace-pre-wrap');
  if (!el) throw new Error('bubble not found');
  return el as HTMLDivElement;
}

describe('UserPromptRow collapse', () => {
  it('renders short prompts without the show-more affordance', () => {
    const { container, queryByRole } = render(<UserPromptRow content="hello" />);
    const bubble = findBubble(container);
    expect(queryByRole('button', { name: /show more/i })).toBeNull();
    expect(queryByRole('button', { name: /show less/i })).toBeNull();
    // Short branch stays exactly as before: no inline max-height.
    expect(bubble.style.maxHeight).toBe('');
  });

  it('clamps long prompts and expands on toggle click', () => {
    // ~250 chars of prose → measured at > 144px via the prototype
    // getter, well past the collapse threshold.
    const longContent = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const { container, getByRole, queryByRole } = render(
      <UserPromptRow content={longContent} />
    );

    const collapsed = findBubble(container);
    expect(collapsed.style.maxHeight).toBe('144px');
    // Regression guard: without `overflow-hidden` the clamp only
    // constrains layout height while the long text visually bleeds
    // onto the rows below. See UI report dated 2026-05-05.
    expect(collapsed.className).toMatch(/overflow-hidden/);

    const toggle = getByRole('button', { name: /show more/i });
    fireEvent.click(toggle);

    const expanded = findBubble(container);
    expect(expanded.style.maxHeight).toBe('320px');
    expect(queryByRole('button', { name: /show less/i })).not.toBeNull();
    expect(expanded.className).toMatch(/overflow-y-auto/);
  });

  it('renders live prompts flush in the agent reading column with no card chrome', () => {
    useChatStore.setState({ isProcessing: true });
    const { container, queryByText, queryByRole } = render(
      <UserPromptRow id="p-live" content="Analyze the screenshot and stream tool progress" live />
    );

    // Restyle contract: the May 2026 timeline dropped the raised
    // `SurfaceShell` card, the `You` eyebrow, and right-alignment.
    // The row now reads flush in the column rail.
    expect(container.querySelector('.surface-shell')).toBeNull();
    expect(queryByText('You')).toBeNull();
    expect(container.firstElementChild?.className ?? '').not.toContain('items-end');
    // Reading-column rail token still applied to the row wrapper.
    expect(container.firstElementChild?.className ?? '').toContain('max-w-[46rem]');
    expect(container.firstElementChild?.className ?? '').toContain('pl-3.5');
    // Hover-revealed action strip still tagged for the live turn so
    // `LiveStatusRow` continues to anchor itself correctly.
    expect(container.querySelector('[data-live-prompt-actions="true"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Analyze the screenshot');
    expect(queryByRole('button', { name: /copy/i })).not.toBeNull();
    expect(queryByRole('button', { name: /edit.*unavailable/i })).not.toBeNull();
  });

  it('renders completed prompts flush with no You eyebrow', () => {
    const { container, queryByText } = render(
      <UserPromptRow content="hello" />
    );
    expect(container.querySelector('.surface-shell')).toBeNull();
    expect(queryByText('You')).toBeNull();
    expect(container.firstElementChild?.className ?? '').not.toContain('items-end');
    expect(container.firstElementChild?.className ?? '').toContain('max-w-[46rem]');
  });
});

/**
 * Stub the rewind preview call so the modal that opens after a
 * Revert click doesn't try to drive a real IPC bridge. The preview
 * returns a benign "nothing to revert" error, which puts the modal
 * straight into its `error` phase — the modal still mounts (proof
 * the click was routed end-to-end) but no further IPC fans out.
 */
function installPreviewStub() {
  useCheckpointsStore.setState((prev) => ({
    ...prev,
    previewRewind: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'no-run-binding' as const, promptEventId: 'p-7' }
    }))
  }));
}

describe('UserPromptRow revert affordance', () => {
  it('renders Revert disabled with the unavailable tooltip when no provider is mounted', () => {
    const { queryByRole } = render(
      <UserPromptRow id="p-1" content="hello" />
    );
    const btn = queryByRole('button', { name: /revert is unavailable here/i });
    expect(btn).not.toBeNull();
    expect(btn).toBeDisabled();
  });

  it('renders Revert disabled when id is absent even with a provider', () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: false });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { queryByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow content="no id" />
      </RevertPromptProvider>
    );
    const btn = queryByRole('button', { name: /revert is unavailable here/i });
    expect(btn).not.toBeNull();
    expect(btn).toBeDisabled();
  });

  it('opens the revert preview modal on click with the matching prompt id', async () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: false });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    installPreviewStub();
    const { getByRole, findByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', { name: /revert to before this message/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    // The modal renders via portal under document.body; the title
    // appearing is the smoking-gun proof that the click routed through
    // useRevertPrompt → setOpenState → RevertPreviewModal mount.
    const dialog = await findByRole('dialog');
    expect(dialog.textContent ?? '').toMatch(/Revert to before this message/i);
    // The stubbed previewRewind resolved to no-run-binding — the
    // modal lands in its error phase with the explanatory copy.
    await waitFor(() => {
      expect(dialog.textContent ?? '').toMatch(/Could not compute revert preview/i);
    });
    expect(useCheckpointsStore.getState().previewRewind).toHaveBeenCalledWith({
      conversationId: 'c-1',
      workspaceId: 'ws-1',
      promptEventId: 'p-7'
    });
  });

  it('disables Revert while the conversation is processing', () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: true });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { getByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', {
      name: /revert is unavailable while this conversation is running/i
    });
    expect(btn).toBeDisabled();
  });

  it('renders a numeric badge on the Revert button when the run has file edits', () => {
    useChatStore.setState({
      conversationId: 'c-1',
      isProcessing: false,
      runIdToFileEditCount: { 'run-99': 3 }
    });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    installPreviewStub();
    const { getByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" runId="run-99" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', {
      name: /revert to before this message \(3 file changes\)/i
    });
    expect(btn).not.toBeDisabled();
    expect(btn.textContent ?? '').toMatch(/Revert.*3/);
  });

  it('omits the badge when the run produced no file edits', () => {
    useChatStore.setState({
      conversationId: 'c-1',
      isProcessing: false,
      runIdToFileEditCount: {}
    });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    installPreviewStub();
    const { getByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" runId="run-99" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', { name: /revert to before this message/i });
    // No file-change suffix in the aria-label — the title stays terse
    // when there is nothing to flag.
    expect(btn.getAttribute('aria-label') ?? '').not.toMatch(/file change/i);
  });

  it('exposes Copy, Edit, and Revert in the hover-reveal strip', () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: false });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { queryByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" runId="run-99" content="hello" />
      </RevertPromptProvider>
    );
    // Pin the contract: Copy + Edit + Revert all exist. Edit was
    // previously removed because the old "Edit & resend" only seeded
    // the composer with the prompt's content (leaving the user
    // editing a "future" message). The new Edit affordance routes
    // through the rewind-preview modal so the rewind happens FIRST
    // and the edited message lands at the same conversation
    // position the original occupied.
    expect(queryByRole('button', { name: /Copy/i })).not.toBeNull();
    expect(queryByRole('button', { name: /^Edit/i })).not.toBeNull();
    expect(queryByRole('button', { name: /Revert/i })).not.toBeNull();
  });
});
