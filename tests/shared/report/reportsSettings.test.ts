import { describe, expect, it } from 'vitest';
import { resolveReportsSettings } from '@shared/report/reportsSettings';

describe('reportsSettings', () => {
  it('defaults auto-open and in-app browser on', () => {
    expect(resolveReportsSettings()).toEqual({
      autoOpenReports: true,
      openInAppBrowser: true,
      promptForReportAfterEdits: true,
      enableAiRunSummary: false
    });
  });

  it('respects explicit false toggles', () => {
    expect(
      resolveReportsSettings({
        reports: {
          autoOpenReports: false,
          openInAppBrowser: false,
          promptForReportAfterEdits: false,
          enableAiRunSummary: true
        }
      })
    ).toEqual({
      autoOpenReports: false,
      openInAppBrowser: false,
      promptForReportAfterEdits: false,
      enableAiRunSummary: true
    });
  });
});
