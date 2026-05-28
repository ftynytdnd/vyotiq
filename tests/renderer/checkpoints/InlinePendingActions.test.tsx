/**
 * InlinePendingActions — Accept/Reject wiring to checkpoints store.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { InlinePendingActions } from '@renderer/components/checkpoints/shared/InlinePendingActions';

const accept = vi.fn(async () => true);
const reject = vi.fn(async () => ({ ok: true as const }));
const showToast = vi.fn();

vi.mock('@renderer/store/useCheckpointsStore.js', () => ({
  useCheckpointsStore: (selector: (s: { accept: typeof accept; reject: typeof reject }) => unknown) =>
    selector({ accept, reject })
}));

vi.mock('@renderer/store/useToastStore.js', () => ({
  useToastStore: (selector: (s: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast })
}));

const change: PendingChange = {
  entryId: 'e-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  filePath: 'src/foo.ts',
  kind: 'modify',
  additions: 1,
  deletions: 0,
  createdAt: 1,
  source: 'edit'
};

beforeEach(() => {
  accept.mockClear();
  reject.mockClear();
  showToast.mockClear();
});

describe('InlinePendingActions', () => {
  it('calls accept with entry and conversation ids', async () => {
    render(<InlinePendingActions change={change} />);
    await userEvent.click(screen.getByRole('button', { name: /Accept src\/foo.ts/i }));
    expect(accept).toHaveBeenCalledWith('e-1', 'conv-1');
  });

  it('calls reject with entry and conversation ids', async () => {
    render(<InlinePendingActions change={change} />);
    await userEvent.click(screen.getByRole('button', { name: /Reject src\/foo.ts/i }));
    expect(reject).toHaveBeenCalledWith('e-1', 'conv-1');
  });
});
