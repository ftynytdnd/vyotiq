/**
 * Screenshot UI audit — automated flow checks (RTL).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { TurnStickyFooter } from '@renderer/components/timeline/shared/TurnStickyFooter';
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
      get: vi.fn(async () => ({})),
      set: vi.fn(async (patch: unknown) => patch)
    },
    memory: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => null)
    },
    promptCache: {
      getStatus: vi.fn(async () => ({
        geminiExplicitCache: { state: 'disabled' as const }
      }))
    },
    providers: {
      setAccountPollSource: vi.fn(async () => undefined)
    }
  }
}));

beforeEach(() => {
  useChatStore.setState({
    isProcessing: true,
    events: [
      { kind: 'user-prompt', id: 'p1', ts: Date.now() - 3000, content: 'audit', runId: 'r1' }
    ],
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      phase: 'running-tool',
      label: 'Exploring',
      detail: { toolName: 'read' },
      ts: Date.now()
    } as never
  });
});

describe('screenshot audit flows', () => {
  it('run telemetry appears in sticky footer, not composer strip', () => {
    render(
      <>
        <TurnStickyFooter live promptId="p1">
          <div />
        </TurnStickyFooter>
        <ComposerStatusStrip />
      </>
    );

    expect(screen.getByText(/Reading/i)).toBeTruthy();
    expect(document.querySelector('[data-turn-sticky-footer]')).not.toBeNull();
    expect(document.querySelector('.vx-composer-status-strip')).toBeNull();
  });

  it('settings agent group shows memory section', () => {
    render(<SettingsFullView initialSection="agent-behavior" />);
    expect(screen.getAllByText(/Memory/i).length).toBeGreaterThan(0);
  });
});
