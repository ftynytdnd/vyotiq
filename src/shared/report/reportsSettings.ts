/**
 * Resolved defaults for `settings.ui.reports`.
 */

import type { AppSettings } from '../types/ipc.js';

export interface ReportsSettings {
  autoOpenReports: boolean;
  openInAppBrowser: boolean;
  promptForReportAfterEdits: boolean;
  enableAiRunSummary: boolean;
}

export const DEFAULT_REPORTS_SETTINGS: ReportsSettings = {
  autoOpenReports: true,
  openInAppBrowser: true,
  promptForReportAfterEdits: true,
  enableAiRunSummary: false
} as const;

export type ResolvedReportsSettings = ReportsSettings;

export function resolveReportsSettings(ui?: AppSettings['ui']): ResolvedReportsSettings {
  const r = ui?.reports;
  return {
    autoOpenReports: r?.autoOpenReports !== false,
    openInAppBrowser: r?.openInAppBrowser !== false,
    promptForReportAfterEdits: r?.promptForReportAfterEdits !== false,
    enableAiRunSummary: r?.enableAiRunSummary === true
  };
}
