import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.agentBehavior.contextManagement', () => {
  it('accepts summaryModel and serverSideCompaction', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          agentBehavior: {
            contextManagement: {
              serverSideCompaction: true,
              summaryModel: { providerId: 'anthropic', modelId: 'claude-haiku' }
            }
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects removed ceiling fields', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          agentBehavior: {
            contextManagement: {
              absoluteCeilingTokens: 200_000
            }
          }
        }
      })
    ).toThrow(/not a recognized field/);
  });
});
