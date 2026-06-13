/**
 * UsagePanel — stable Zustand selectors (no render loop when spend map unset).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsagePanel } from '@renderer/components/settings/UsagePanel';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useProviderAccountStore } from '@renderer/store/useProviderAccountStore';
import { useSessionStatsStore } from '@renderer/store/useSessionStatsStore';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    providers: {
      setAccountPollSource: vi.fn(async () => undefined)
    }
  }
}));

beforeEach(() => {
  useSettingsStore.setState({
    loading: false,
    initialLoadDone: true,
    settings: { ui: {} }
  } as never);
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Test workspace', path: '/tmp' }]
  } as never);
  useConversationsStore.setState({ list: [] } as never);
  useProviderStore.setState({ providers: [], discoveryPollHints: {} } as never);
  useProviderAccountStore.setState({ snapshots: {}, hydrated: true } as never);
  useSessionStatsStore.setState({
    stats: {
      spendUsd: 0,
      cacheSavingsUsd: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      runCount: 0
    }
  } as never);
});

describe('UsagePanel', () => {
  it('renders without crashing when workspaceSpendUsd is unset', () => {
    render(<UsagePanel />);
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Test workspace')).toBeInTheDocument();
  });
});
