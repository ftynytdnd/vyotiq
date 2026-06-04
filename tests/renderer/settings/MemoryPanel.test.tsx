/**
 * MemoryPanel — inline discard-unsaved confirmation contract.
 *
 * Pins three behaviours from the dialog UX redesign:
 *   1. Switching to a different note while the editor is dirty
 *      surfaces an inline `DestructiveConfirm` row inside the notes
 *      list (no composer dialog above the chat composer).
 *   2. Cancelling the confirm keeps the user on the dirty draft —
 *      no `memory.read` call is fired against the new key.
 *   3. Discarding switches to the new note, fetches its body, and
 *      retires the inline confirm row.
 *
 * Workspace scope is required to hit the notes-list code path; the
 * stores are seeded so `MemoryPanel` renders the workspace list and
 * the initial workspace `read` resolves with seed content.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel } from '@renderer/components/settings/MemoryPanel';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useChatStore } from '@renderer/store/useChatStore';

const NOTES = [
  { scope: 'workspace' as const, key: 'alpha', updatedAt: 1, content: '' },
  { scope: 'workspace' as const, key: 'beta', updatedAt: 2, content: '' }
];

beforeEach(() => {
  useWorkspaceStore.setState({
    info: { path: '/tmp/project', label: 'project' }
  } as never);
  useChatStore.setState({ conversationId: null });

  // List → workspace scope returns both notes; read returns the
  // matching key body so the editor populates.
  window.vyotiq.memory.list = vi.fn(async () => NOTES) as never;
  window.vyotiq.memory.read = vi.fn(async (_scope: 'global' | 'workspace', key: string) => ({
    scope: 'workspace' as const,
    key,
    content: `# ${key}\n`,
    updatedAt: 0
  })) as never;
  window.vyotiq.memory.write = vi.fn(async () => ({
    scope: 'workspace' as const,
    key: 'alpha',
    content: '',
    updatedAt: 0
  })) as never;
});

async function openWorkspaceScopeAndDirty() {
  render(<MemoryPanel />);
  await userEvent.click(screen.getByRole('tab', { name: /^Workspace$/i }));
  await userEvent.click(await screen.findByRole('button', { name: /Open editor/i }));
  const textarea = await waitFor(() =>
    screen.getByRole<HTMLTextAreaElement>('textbox')
  );
  await waitFor(() => expect(textarea.value).toBe('# alpha\n'));
  // `fireEvent.change` is more reliable than `userEvent.type` for
  // textarea-bound React state under happy-dom: typing skips the
  // bound change in some browser-quirk paths, while fireEvent
  // directly dispatches the controlled-input change event React
  // listens for.
  fireEvent.change(textarea, { target: { value: '# alpha\nedited' } });
  expect(textarea.value).toBe('# alpha\nedited');
}

describe('MemoryPanel inline discard confirm', () => {
  it('shows an inline confirm row when switching away from a dirty draft', async () => {
    await openWorkspaceScopeAndDirty();
    await userEvent.click(screen.getByRole('button', { name: /^beta$/ }));
    expect(screen.getByText('Discard unsaved edits?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
  });

  it('Keep editing leaves the dirty draft alone and does not fetch the other note', async () => {
    await openWorkspaceScopeAndDirty();
    await userEvent.click(screen.getByRole('button', { name: /^beta$/ }));
    const beforeReads = (
      window.vyotiq.memory.read as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByText('Discard unsaved edits?')).toBeNull();
    expect(
      (window.vyotiq.memory.read as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    ).toBe(beforeReads);
    // Draft content is preserved.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(textarea.value).toBe('# alpha\nedited');
  });

  it('Discard switches notes and reloads the target body', async () => {
    await openWorkspaceScopeAndDirty();
    await userEvent.click(screen.getByRole('button', { name: /^beta$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(await screen.findByRole('button', { name: /Open editor/i }));

    const textarea = await waitFor(() =>
      screen.getByRole<HTMLTextAreaElement>('textbox')
    );
    await waitFor(() => expect(textarea.value).toBe('# beta\n'));
    expect(screen.queryByText('Discard unsaved edits?')).toBeNull();
    // The most recent `read` call targets the new key.
    const reads = (
      window.vyotiq.memory.read as unknown as { mock: { calls: [unknown, string][] } }
    ).mock.calls;
    expect(reads[reads.length - 1]?.[1]).toBe('beta');
  });
});
