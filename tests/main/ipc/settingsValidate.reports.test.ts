import { describe, expect, it } from 'vitest';
import { assertSettingsPatch } from '@main/ipc/settingsValidate';

describe('settingsValidate ui.reports', () => {
  it('accepts boolean report toggles', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: {
          reports: {
            autoOpenReports: true,
            openInAppBrowser: false,
            promptForReportAfterEdits: true,
            enableAiRunSummary: false
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects unknown report fields', () => {
    expect(() =>
      assertSettingsPatch('settings:set', {
        ui: { reports: { mysteryFlag: true } as never }
      })
    ).toThrow(/reports\.mysteryFlag/);
  });
});
