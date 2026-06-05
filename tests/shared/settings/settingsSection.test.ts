import { describe, expect, it } from 'vitest';
import { resolveSettingsSectionId } from '@shared/settings/settingsSection.js';

describe('resolveSettingsSectionId', () => {
  it('keeps current section ids', () => {
    expect(resolveSettingsSectionId('models-api')).toBe('models-api');
    expect(resolveSettingsSectionId('agent-behavior')).toBe('agent-behavior');
    expect(resolveSettingsSectionId('workspace-data')).toBe('workspace-data');
  });

  it('maps legacy tabs and groups', () => {
    expect(resolveSettingsSectionId('providers')).toBe('models-api');
    expect(resolveSettingsSectionId('checkpoints')).toBe('models-api');
    expect(resolveSettingsSectionId('setup')).toBe('models-api');
    expect(resolveSettingsSectionId('memory')).toBe('agent-behavior');
    expect(resolveSettingsSectionId('agent')).toBe('agent-behavior');
    expect(resolveSettingsSectionId('appearance')).toBe('appearance');
    expect(resolveSettingsSectionId('shortcuts')).toBe('shortcuts');
  });

  it('falls back when unknown', () => {
    expect(resolveSettingsSectionId('bogus', 'appearance')).toBe('appearance');
    expect(resolveSettingsSectionId(undefined, 'models-api')).toBe('models-api');
  });
});
