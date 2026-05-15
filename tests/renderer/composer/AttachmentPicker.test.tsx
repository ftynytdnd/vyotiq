/**
 * `AttachmentPicker` controlled-mode tests. The Phase-2 `@`-mention
 * trigger relies on the picker accepting external filter state and
 * showing a breadcrumb instead of its own input.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentPicker } from '@renderer/components/composer/AttachmentPicker';
import { invalidateWorkspaceTreeCache } from '@renderer/lib/workspaceTreeCache';

beforeEach(() => {
  // Reset the mocked workspace tree for every test so a stale list
  // from one case can't leak into the next. The renderer-side TTL
  // cache is shared at module scope, so a stale entry from a prior
  // test would otherwise short-circuit the fresh `listTree` mock —
  // explicitly invalidate it here.
  invalidateWorkspaceTreeCache();
  window.vyotiq.workspace.listTree = vi.fn(async () =>
    ({
      entries: ['src/main.ts', 'src/utils.ts', 'README.md'],
      truncated: false,
      total: 3
    }) as never
  ) as unknown as typeof window.vyotiq.workspace.listTree;
});

describe('AttachmentPicker', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AttachmentPicker open={false} onClose={() => { }} selected={[]} onPick={() => { }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('uncontrolled: shows its own filter input and lists workspace entries', async () => {
    render(
      <AttachmentPicker open onClose={() => { }} selected={[]} onPick={() => { }} />
    );
    expect(screen.getByPlaceholderText('Filter files…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('src/main.ts')).toBeInTheDocument();
    });
  });

  it('controlled mode hides the filter input and shows a breadcrumb', async () => {
    render(
      <AttachmentPicker
        open
        onClose={() => { }}
        selected={[]}
        onPick={() => { }}
        controlledFilter="ut"
        onControlledFilterChange={() => { }}
      />
    );
    expect(screen.queryByPlaceholderText('Filter files…')).toBeNull();
    expect(screen.getByText(/Mention/i)).toBeInTheDocument();
    expect(screen.getByText('@ut')).toBeInTheDocument();
    // Filter `ut` matches `src/utils.ts` only.
    await waitFor(() => {
      expect(screen.getByText('src/utils.ts')).toBeInTheDocument();
    });
    expect(screen.queryByText('README.md')).toBeNull();
  });

  it('calls onPick with the cleaned file path', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <AttachmentPicker open onClose={onClose} selected={[]} onPick={onPick} />
    );
    await waitFor(() => {
      expect(screen.getByText('src/main.ts')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText('src/main.ts'));
    expect(onPick).toHaveBeenCalledWith('src/main.ts');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables already-selected entries', async () => {
    render(
      <AttachmentPicker
        open
        onClose={() => { }}
        selected={['src/main.ts']}
        onPick={() => { }}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('src/main.ts')).toBeInTheDocument();
    });
    const row = screen.getByText('src/main.ts').closest('button');
    expect(row).toBeDisabled();
  });

  it('shows "Pick a workspace first." when the tree is empty', async () => {
    window.vyotiq.workspace.listTree = vi.fn(async () =>
      ({ entries: [], truncated: false, total: 0 }) as never
    ) as unknown as typeof window.vyotiq.workspace.listTree;
    render(
      <AttachmentPicker open onClose={() => { }} selected={[]} onPick={() => { }} />
    );
    await waitFor(() => {
      expect(screen.getByText(/Pick a workspace first/)).toBeInTheDocument();
    });
  });
});
