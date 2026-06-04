import { describe, expect, it } from 'vitest';
import { migrateLastSettingsTab } from '@shared/settings/settingsGroups.js';

describe('migrateLastSettingsTab', () => {
  it('keeps current group ids', () => {
    expect(migrateLastSettingsTab('setup')).toBe('setup');
    expect(migrateLastSettingsTab('agent')).toBe('agent');
  });

  it('maps legacy tabs to setup or agent', () => {
    expect(migrateLastSettingsTab('providers')).toBe('setup');
    expect(migrateLastSettingsTab('appearance')).toBe('setup');
    expect(migrateLastSettingsTab('about')).toBe('setup');
    expect(migrateLastSettingsTab('app')).toBe('setup');
    expect(migrateLastSettingsTab('memory')).toBe('agent');
    expect(migrateLastSettingsTab('permissions')).toBe('setup');
    expect(migrateLastSettingsTab('context')).toBe('setup');
    expect(migrateLastSettingsTab('checkpoints')).toBe('setup');
    expect(migrateLastSettingsTab('shortcuts')).toBe('setup');
  });

  it('falls back when unknown', () => {
    expect(migrateLastSettingsTab('bogus', 'agent')).toBe('agent');
    expect(migrateLastSettingsTab(undefined, 'setup')).toBe('setup');
  });
});
