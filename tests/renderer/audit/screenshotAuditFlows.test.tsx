/**
 * Screenshot UI audit — automated flow checks (RTL).
 *
 * Manual repro (no Playwright in repo; use `npm run dev` + Electron):
 *   1. Connecting dedupe — start a run; only `.vx-composer-status-strip` shows
 *      "Connecting…", not `[data-turn-running-meta]`.
 *   2. Settings agent group — Tool access (Fully Auto) visible under Agent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { TurnRunningMeta } from '@renderer/components/timeline/activity/TurnRunningMeta';
import { SettingsPanel } from '@renderer/components/settings/SettingsPanel';
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
      phase: 'connecting',
      label: 'Connecting to provider…',
      ts: Date.now()
    } as never
  });
});

describe('screenshot audit flows', () => {
  it('connecting status appears only in composer strip, not timeline meta', () => {
    render(
      <>
        <TurnRunningMeta live />
        <ComposerStatusStrip />
      </>
    );

    expect(screen.getByText(/Connecting to provider/i)).toBeTruthy();
    expect(document.querySelector('[data-turn-running-meta]')).toBeNull();
    expect(document.querySelector('.vx-composer-status-strip')).not.toBeNull();
  });

  it('settings agent group shows memory section', () => {
    render(<SettingsPanel initialTab="memory" embedded />);
    expect(screen.getAllByText(/Memory/i).length).toBeGreaterThan(0);
  });
});
