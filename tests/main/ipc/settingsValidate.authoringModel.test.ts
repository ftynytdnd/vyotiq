import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate authoringModel', () => {
  it('accepts authoringModel: null to clear the override', () => {
    expect(() =>
      assertSettingsPatch('settings:set', { authoringModel: null })
    ).not.toThrow();
  });

  it('still validates sibling keys when authoringModel is cleared', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        authoringModel: null,
        ui: { workspaceSpendUsd: { 'ws-1': -1 } }
      })
    ).toThrow();
  });
});
