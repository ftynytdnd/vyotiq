import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.promptCaching', () => {
  it('accepts boolean prompt caching toggles', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          promptCaching: {
            anthropicCacheDiagnostics: true,
            geminiExplicitCache: false
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects unknown promptCaching keys', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { promptCaching: { unknownFlag: true } as never }
      })
    ).toThrow(/promptCaching\.unknownFlag/);
  });
});
