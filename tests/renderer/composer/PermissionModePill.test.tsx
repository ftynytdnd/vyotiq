/**
 * PermissionModePill — Ask/Auto toggle on click (§1 / Phase 4).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionModePill } from '@renderer/components/composer/PermissionModePill';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { DEFAULT_PERMISSIONS } from '@shared/constants';
import type { AppSettings } from '@shared/types/ipc';

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: 'ws-1' } as never);
  useSettingsStore.setState({
    settings: {
      permissions: { ...DEFAULT_PERMISSIONS, allowAuto: false }
    },
    loading: false
  });
  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;
});

describe('PermissionModePill', () => {
  it('shows Ask when auto is off and toggles to Auto on click', async () => {
    const setForWorkspace = vi.spyOn(useSettingsStore.getState(), 'setPermissionsForWorkspace');

    render(<PermissionModePill />);
    expect(screen.getByRole('button', { name: /ask/i }).textContent).toMatch(/Ask/);

    await userEvent.click(screen.getByRole('button'));

    expect(setForWorkspace).toHaveBeenCalledWith('ws-1', { allowAuto: true });
  });

  it('shows Auto when workspace override enables auto mode', () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS, allowAuto: false },
        ui: { permissionsByWorkspace: { 'ws-1': { allowAuto: true } } }
      }
    });

    render(<PermissionModePill />);
    expect(screen.getByRole('button').textContent).toMatch(/Auto/);
  });
});
