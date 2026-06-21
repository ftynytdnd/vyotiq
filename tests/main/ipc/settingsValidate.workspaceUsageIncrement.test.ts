import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.workspaceUsageIncrement', () => {
  it('accepts full TurnUsageStatsDelta fields', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          workspaceUsageIncrement: {
            'ws-1': {
              spendUsd: 0.12,
              netCacheSavingsUsd: 0.03,
              cachedTokens: 1200,
              reasoningTokens: 400,
              lastCacheHitPct: 88.5
            }
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects unknown usage increment fields', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          workspaceUsageIncrement: {
            'ws-1': { spendUsd: 1, rogueField: 9 }
          }
        }
      })
    ).toThrow(/not a recognized usage increment field/);
  });

  it('rejects out-of-range lastCacheHitPct', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          workspaceUsageIncrement: {
            'ws-1': { spendUsd: 0, lastCacheHitPct: 101 }
          }
        }
      })
    ).toThrow();
  });
});
