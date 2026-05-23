/**
 * PendingChangesTimelineRow — collapsed tail row with gate-on auto-expand.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { PendingChangesTimelineRow } from '@renderer/components/checkpoints/timeline/PendingChangesTimelineRow';
import { useChatStore } from '@renderer/store/useChatStore';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import type { PendingChange } from '@shared/types/checkpoint';

const CONVO = 'conv-1';
const WORKSPACE = 'ws-1';

function makePending(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    entryId: 'e1',
    runId: 'run-1',
    conversationId: CONVO,
    workspaceId: WORKSPACE,
    filePath: 'src/foo.ts',
    kind: 'edit',
    additions: 3,
    deletions: 1,
    createdAt: 1,
    ...overrides
  };
}

beforeEach(() => {
  useChatStore.setState({ conversationId: CONVO });
  useWorkspaceStore.setState({ activeId: WORKSPACE });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
  useSettingsStore.setState((prev) => ({
    ...prev,
    settings: {
      ...prev.settings,
      ui: { gatePromptOnPendingByWorkspace: {} }
    }
  }));
  useCheckpointsStore.setState((prev) => ({
    ...prev,
    pendingByConversation: {},
    summaryByWorkspace: {},
    acceptAll: vi.fn(async () => true),
    refreshPending: vi.fn(async () => {}),
    refreshSummary: vi.fn(async () => {})
  }));
});

describe('PendingChangesTimelineRow', () => {
  it('renders nothing when no pending entries', () => {
    const { container } = render(<PendingChangesTimelineRow />);
    expect(container.innerHTML).toBe('');
  });

  it('is collapsed by default when gate is off', async () => {
    await act(async () => {
      useCheckpointsStore.setState((prev) => ({
        ...prev,
        pendingByConversation: { [CONVO]: [makePending()] }
      }));
    });
    const { container } = render(<PendingChangesTimelineRow />);
    expect(container.textContent ?? '').toContain('1 pending change');
    expect(container.querySelector('[aria-expanded="true"]')).toBeNull();
  });

  it('auto-expands when gate-on and pending entries exist', async () => {
    await act(async () => {
      useSettingsStore.setState((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          ui: {
            gatePromptOnPendingByWorkspace: { [WORKSPACE]: true }
          }
        }
      }));
      useCheckpointsStore.setState((prev) => ({
        ...prev,
        pendingByConversation: { [CONVO]: [makePending(), makePending({ entryId: 'e2', filePath: 'b.ts' })] }
      }));
    });
    const { container } = render(<PendingChangesTimelineRow />);
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('approve or reject before sending');
  });

  it('accept-all invokes store acceptAll', async () => {
    const acceptAll = vi.fn(async () => true);
    await act(async () => {
      useCheckpointsStore.setState((prev) => ({
        ...prev,
        pendingByConversation: { [CONVO]: [makePending()] },
        acceptAll
      }));
    });
    const { container } = render(<PendingChangesTimelineRow />);
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Accept all')
    );
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(acceptAll).toHaveBeenCalledWith(CONVO);
  });
});
