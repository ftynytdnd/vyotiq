/**
 * Dock scheduled runs popover — read-only list and manage link.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockScheduledRunsPopover } from '@renderer/components/dock/DockScheduledRunsPopover';

const listMock = vi.fn();
const openSettingsMock = vi.fn();
const selectMock = vi.fn();

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    scheduledRuns: {
      list: (...args: unknown[]) => listMock(...args)
    }
  }
}));

vi.mock('@renderer/store/useDockSchedulesStore.js', () => ({
  useDockSchedulesStore: (selector: (s: { open: boolean; setOpen: (v: boolean) => void }) => unknown) =>
    selector({ open: true, setOpen: vi.fn() })
}));

vi.mock('@renderer/store/useWorkspaceStore.js', () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null; setActive: typeof vi.fn }) => unknown) =>
    selector({ activeId: 'ws-1', setActive: vi.fn() })
}));

vi.mock('@renderer/store/useConversationsStore.js', () => ({
  useConversationsStore: (selector: (s: { select: typeof selectMock }) => unknown) =>
    selector({ select: selectMock })
}));

vi.mock('@renderer/store/useAppViewStore.js', () => ({
  useAppViewStore: {
    getState: () => ({ openSettings: openSettingsMock })
  }
}));

vi.mock('@renderer/store/useUiStore.js', () => ({
  useUiStore: {
    getState: () => ({ setDockPanelTab: vi.fn() })
  }
}));

describe('DockScheduledRunsPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([
      {
        id: 'run-1',
        enabled: true,
        label: 'Hourly sweep',
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        prompt: 'Check CI',
        providerId: 'p1',
        modelId: 'm1',
        intervalMinutes: 60,
        nextRunAt: Date.now() + 3_600_000,
        createdAt: 1,
        updatedAt: 1
      }
    ]);
  });

  it('lists enabled schedules for the active workspace', async () => {
    render(<DockScheduledRunsPopover />);
    expect(await screen.findByText('Hourly sweep')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scheduled runs' })).toBeInTheDocument();
  });

  it('opens settings scheduled-runs section from Manage', async () => {
    render(<DockScheduledRunsPopover />);
    await screen.findByText('Hourly sweep');
    await userEvent.click(screen.getByRole('button', { name: 'Manage…' }));
    expect(openSettingsMock).toHaveBeenCalledWith('agent-behavior', {
      agentBehaviorSection: 'scheduled-runs'
    });
  });
});
