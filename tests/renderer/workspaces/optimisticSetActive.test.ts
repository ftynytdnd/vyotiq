/**
 * `useWorkspaceStore.setActive` must flip `activeId` + the derived
 * `info` mirror SYNCHRONOUSLY so the dock tree highlight + chat
 * mirror downstream reactions don't stall behind the settings.json
 * disk write. On a persistence rejection, the store rolls back to
 * the prior state and surfaces a danger toast.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useToastStore } from '@renderer/store/useToastStore';

beforeEach(() => {
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
  useToastStore.setState({ toasts: [] });
  useUiStore.setState({
    dockExpanded: true,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
});

describe('useWorkspaceStore.setActive — optimistic flip', () => {
  it('flips activeId + info BEFORE the IPC awaits', async () => {
    // Hang the IPC indefinitely so we can assert state mid-flight.
    let resolveSet: ((v: unknown) => void) | null = null;
    window.vyotiq.workspace.setActive = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve;
        })
    ) as never;

    const pending = useWorkspaceStore.getState().setActive('ws-B');
    // Mid-IPC: the optimistic flip is already visible.
    expect(useWorkspaceStore.getState().activeId).toBe('ws-B');
    expect(useWorkspaceStore.getState().info).toEqual({ path: '/tmp/B', label: 'B' });

    // Settle the IPC with main's authoritative reply.
    resolveSet!({
      activeId: 'ws-B',
      workspaces: [
        { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
        { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
      ]
    });
    await pending;

    expect(useWorkspaceStore.getState().activeId).toBe('ws-B');
  });

  it('rolls back the optimistic flip when persistence rejects', async () => {
    window.vyotiq.workspace.setActive = vi.fn(async () => {
      throw new Error('disk write failed');
    }) as never;

    await useWorkspaceStore.getState().setActive('ws-B');

    // Rolled back to the previous state.
    expect(useWorkspaceStore.getState().activeId).toBe('ws-A');
    expect(useWorkspaceStore.getState().info).toEqual({ path: '/tmp/A', label: 'A' });

    // Toast surfaced so the user sees the desync.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[toasts.length - 1]?.message.toLowerCase()).toContain('could not switch workspace');
    expect(toasts[toasts.length - 1]?.tone).toBe('danger');
  });

  it('is a no-op when the target is already active', async () => {
    const setSpy = vi.fn(async () => ({ activeId: 'ws-A', workspaces: [] }));
    window.vyotiq.workspace.setActive = setSpy as never;

    await useWorkspaceStore.getState().setActive('ws-A');

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('logs and ignores an unknown workspace id', async () => {
    const setSpy = vi.fn(async () => ({ activeId: 'ws-A', workspaces: [] }));
    window.vyotiq.workspace.setActive = setSpy as never;

    await useWorkspaceStore.getState().setActive('ws-does-not-exist');

    expect(setSpy).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeId).toBe('ws-A');
  });
});

describe('useWorkspaceStore.remove', () => {
  it('clears deleted workspace dock state and reconciles conversations', async () => {
    const reconcileSpy = vi
      .spyOn(useConversationsStore.getState(), 'reconcileWithMain')
      .mockResolvedValue(undefined);
    useUiStore.setState({ collapsedWorkspaces: new Set<string>(['ws-A']) });
    window.vyotiq.settings.set = vi.fn(async (patch: object) => patch) as never;
    window.vyotiq.workspace.remove = vi.fn(async () => ({
      activeId: 'ws-B',
      workspaces: [{ id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }]
    })) as never;

    await useWorkspaceStore.getState().remove('ws-A', { deleteConversations: true });

    expect(window.vyotiq.workspace.remove).toHaveBeenCalledWith('ws-A', {
      deleteConversations: true
    });
    expect(useWorkspaceStore.getState().activeId).toBe('ws-B');
    expect(useUiStore.getState().collapsedWorkspaces.has('ws-A')).toBe(false);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    reconcileSpy.mockRestore();
  });
});
