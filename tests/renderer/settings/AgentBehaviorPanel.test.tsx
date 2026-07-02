/**
 * AgentBehaviorPanel — sub-nav persistence and deep-link consumption.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentBehaviorPanel } from '@renderer/components/settings/AgentBehaviorPanel';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { vyotiq } from '@renderer/lib/ipc.js';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    settings: { set: vi.fn(async (patch) => patch) },
    memory: { list: vi.fn(async () => []), get: vi.fn(async () => ({ content: '', key: 'x' })) },
    checkpoints: { list: vi.fn(async () => []) },
    harness: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({ content: '' })),
      reset: vi.fn(async () => undefined)
    },
    scheduler: { list: vi.fn(async () => []) }
  }
}));

beforeEach(() => {
  useAppViewStore.setState({
    pendingAgentBehaviorSection: null
  });
  useSettingsStore.setState({
    loading: false,
    settings: { ui: { lastAgentBehaviorSection: 'harness' } }
  } as never);
  vi.mocked(vyotiq.settings.set).mockClear();
});

describe('AgentBehaviorPanel', () => {
  it('restores persisted sub-section on mount', () => {
    render(<AgentBehaviorPanel />);
    expect(screen.getByRole('tab', { name: /Harness/i })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.vx-settings-subpanel-title')?.textContent).toBe('Harness');
  });

  it('consumes pending deep-link sub-section over persisted value', () => {
    useAppViewStore.setState({ pendingAgentBehaviorSection: 'lsp' });
    render(<AgentBehaviorPanel />);
    expect(screen.getByRole('tab', { name: /Editor LSP/i })).toHaveAttribute('aria-selected', 'true');
    expect(useAppViewStore.getState().pendingAgentBehaviorSection).toBeNull();
  });

  it('persists sub-section changes via settings IPC', async () => {
    render(<AgentBehaviorPanel />);
    fireEvent.click(screen.getByRole('tab', { name: /Editor LSP/i }));
    await waitFor(() => {
      expect(vyotiq.settings.set).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({ lastAgentBehaviorSection: 'lsp' })
        })
      );
    });
    expect(useSettingsStore.getState().settings.ui?.lastAgentBehaviorSection).toBe('lsp');
  });
});
