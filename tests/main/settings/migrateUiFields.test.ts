import { describe, expect, it } from 'vitest';
import { migrateLegacyDockUi, normalizeSettingsPatch } from '@main/settings/migrateUiFields.js';

describe('migrateLegacyDockUi', () => {
  it('maps sidebarVisible to dockExpanded and drops the legacy key', () => {
    const { ui, changed } = migrateLegacyDockUi({
      sidebarVisible: true,
      collapsedWorkspaces: ['ws-1']
    });
    expect(changed).toBe(true);
    expect(ui).toEqual({ dockExpanded: true, collapsedWorkspaces: ['ws-1'] });
    expect(ui).not.toHaveProperty('sidebarVisible');
  });

  it('maps sidebarWidth to dockWidth when dockWidth is absent', () => {
    const { ui } = migrateLegacyDockUi({ sidebarWidth: 240, dockExpanded: false });
    expect(ui).toEqual({ dockExpanded: false, dockWidth: 240 });
    expect(ui).not.toHaveProperty('sidebarWidth');
  });

  it('prefers existing dockExpanded over sidebarVisible', () => {
    const { ui } = migrateLegacyDockUi({ sidebarVisible: true, dockExpanded: false });
    expect(ui.dockExpanded).toBe(false);
    expect(ui).not.toHaveProperty('sidebarVisible');
  });
});

describe('normalizeSettingsPatch', () => {
  it('rewrites stale renderer patches before validation', () => {
    const patch = normalizeSettingsPatch({ ui: { sidebarVisible: false } });
    expect(patch.ui).toEqual({ dockExpanded: false });
  });

  it('clamps legacy dockWidth values before IPC validation', () => {
    const patch = normalizeSettingsPatch({ ui: { dockWidth: 200, theme: 'dark' } });
    expect(patch.ui).toEqual({ dockWidth: 220, theme: 'dark' });
  });

  it('strips removed right-dock fields before IPC validation', () => {
    const patch = normalizeSettingsPatch({ ui: { rightDockWidth: 200, secondaryZoneMode: 'docked' } });
    expect(patch.ui).toEqual({});
  });
});
