/**
 * HeartbeatStatusPill — read-only agent heartbeat indicator in the metrics row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { HeartbeatStatusPill } from '@renderer/components/composer/HeartbeatStatusPill';

describe('HeartbeatStatusPill', () => {
  beforeEach(() => {
    window.vyotiq.heartbeat.get = vi.fn(async () => null) as never;
    vi.restoreAllMocks();
  });

  it('renders nothing when no heartbeat is attached', async () => {
    const { container } = render(<HeartbeatStatusPill conversationId="c1" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.vyotiq.heartbeat.attach).not.toHaveBeenCalled();
  });

  it('shows interval when the agent has attached a heartbeat', async () => {
    window.vyotiq.heartbeat.get = vi.fn(async () => ({
      conversationId: 'c1',
      workspaceId: 'ws-1',
      enabled: true,
      intervalMinutes: 7,
      wakePrompt: '',
      selection: { providerId: 'p1', modelId: 'm1' },
      createdAt: 0,
      updatedAt: 0
    })) as never;

    render(<HeartbeatStatusPill conversationId="c1" />);

    const pill = await screen.findByRole('status');
    expect(pill.textContent).toMatch(/Heartbeat · 7m/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('updates live when heartbeat:onUpdated fires', async () => {
    let onUpdatedCb: ((conversationId: string, row: unknown) => void) | null = null;
    vi.spyOn(window.vyotiq.heartbeat, 'onUpdated').mockImplementation((cb) => {
      onUpdatedCb = cb;
      return () => {
        onUpdatedCb = null;
      };
    });

    render(<HeartbeatStatusPill conversationId="c1" />);

    await waitFor(() => expect(onUpdatedCb).not.toBeNull());

    await act(async () => {
      onUpdatedCb!('c1', {
        conversationId: 'c1',
        workspaceId: 'ws-1',
        enabled: true,
        intervalMinutes: 9,
        wakePrompt: '',
        selection: { providerId: 'p1', modelId: 'm1' },
        createdAt: 0,
        updatedAt: 0
      });
    });

    const pill = screen.getByRole('status');
    expect(pill.textContent).toMatch(/Heartbeat · 9m/);
  });
});
