/**
 * Screenshot UI audit — automated flow checks (RTL).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { TurnRunningMeta } from '@renderer/components/timeline/activity/TurnRunningMeta';
import { SettingsFullView } from '@renderer/components/settings/SettingsFullView';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { DEFAULT_PERMISSIONS } from '@shared/constants';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    app: {
      playWarningSound: vi.fn(async () => {})
    },
    settings: {
      set: vi.fn(async (patch: unknown) => patch)
    },
    memory: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({ content: '', key: 'test' }))
    }
  }
}));

beforeEach(() => {
  useChatStore.setState({
    isProcessing: true,
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      phase: 'running-tool',
      label: 'Running tool',
      ts: Date.now()
    } as never
  });
});

describe('screenshot audit flows', () => {
  it('run phase appears in timeline meta, not composer strip', () => {
    render(
      <>
        <TurnRunningMeta live />
        <ComposerStatusStrip />
      </>
    );

    expect(screen.getByText(/Exploring/i)).toBeTruthy();
    expect(document.querySelector('[data-turn-running-meta]')).not.toBeNull();
    expect(document.querySelector('.vx-composer-status-strip')).toBeNull();
  });

  it('settings agent group shows memory section', () => {
    render(<SettingsFullView initialSection="agent-behavior" />);
    expect(screen.getAllByText(/Memory/i).length).toBeGreaterThan(0);
  });
});
