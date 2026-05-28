/**
 * `UserPromptRow` regression suite.
 *
 * Collapse + expand of long prompts, and Copy / Edit affordances.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { UserPromptRow } from '@renderer/components/timeline/rows/UserPromptRow';
import { RevertPromptProvider } from '@renderer/components/timeline/revert/RevertPromptContext';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

let originalDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'scrollHeight'
  );
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
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
  act(() => {
    useChatStore.setState({
      isProcessing: false,
      conversationId: null,
      runIdToFileEditCount: {}
    });
  });
});

function findBubble(root: HTMLElement): HTMLDivElement {
  const el = root.querySelector('.vx-timeline-prompt');
  if (!el) throw new Error('bubble not found');
  return el as HTMLDivElement;
}

describe('UserPromptRow collapse', () => {
  it('renders short prompts without the show-more affordance', () => {
    const { container, queryByRole } = render(<UserPromptRow content="hello" />);
    const bubble = findBubble(container);
    expect(queryByRole('button', { name: /show more/i })).toBeNull();
    expect(queryByRole('button', { name: /show less/i })).toBeNull();
    expect(bubble.style.maxHeight).toBe('');
  });

  it('clamps long prompts and expands on toggle click', () => {
    const longContent = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const { container, getByRole, queryByRole } = render(
      <UserPromptRow content={longContent} />
    );

    const collapsed = findBubble(container);
    expect(collapsed.style.maxHeight).toBe('144px');
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

    expect(container.querySelector('.surface-shell')).toBeNull();
    expect(queryByText('You')).toBeNull();
    expect(container.firstElementChild?.className ?? '').not.toContain('items-end');
    expect(container.firstElementChild?.className ?? '').toContain('vx-timeline-agent-column');
    expect(container.querySelector('.vx-timeline-user-bubble')).not.toBeNull();
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
    expect(container.firstElementChild?.className ?? '').toContain('vx-timeline-agent-column');
  });
});

describe('UserPromptRow edit affordance', () => {
  it('renders Edit disabled with the unavailable tooltip when no provider is mounted', () => {
    const { queryByRole } = render(
      <UserPromptRow id="p-1" content="hello" />
    );
    const btn = queryByRole('button', { name: /edit.*unavailable here/i });
    expect(btn).not.toBeNull();
    expect(btn).toBeDisabled();
  });

  it('disables Edit while the conversation is processing', () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: true });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { getByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', {
      name: /edit.*unavailable while this conversation is running/i
    });
    expect(btn).toBeDisabled();
  });

  it('renders a numeric badge on Edit when the run has file edits', () => {
    useChatStore.setState({
      conversationId: 'c-1',
      isProcessing: false,
      runIdToFileEditCount: { 'run-99': 3 }
    });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { getByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" runId="run-99" content="please undo" />
      </RevertPromptProvider>
    );
    const btn = getByRole('button', {
      name: /edit and resend this message \(3 file changes\)/i
    });
    expect(btn).not.toBeDisabled();
    expect(btn.textContent ?? '').toMatch(/Edit.*3/);
  });

  it('exposes Copy and Edit in the hover-reveal strip (no Revert)', () => {
    useChatStore.setState({ conversationId: 'c-1', isProcessing: false });
    useWorkspaceStore.setState({ activeId: 'ws-1' });
    const { queryByRole } = render(
      <RevertPromptProvider>
        <UserPromptRow id="p-7" runId="run-99" content="hello" />
      </RevertPromptProvider>
    );
    expect(queryByRole('button', { name: /Copy/i })).not.toBeNull();
    expect(queryByRole('button', { name: /^Edit/i })).not.toBeNull();
    expect(queryByRole('button', { name: /Revert/i })).toBeNull();
  });
});
