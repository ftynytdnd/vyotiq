import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.workspaceSpendUsd', () => {
  it('accepts numeric spend per workspace', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { workspaceSpendUsd: { 'ws-1': 1.25, 'ws-2': 0.0042 } }
      })
    ).not.toThrow();
  });

  it('rejects negative spend', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { workspaceSpendUsd: { 'ws-1': -0.01 } }
      })
    ).toThrow();
  });

  it('accepts atomic workspace spend increments', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { workspaceSpendIncrement: { 'ws-1': 0.05, 'ws-2': 0.001 } }
      })
    ).not.toThrow();
  });
});
