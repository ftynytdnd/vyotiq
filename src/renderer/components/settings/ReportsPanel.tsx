import { useSettingsStore } from '../../store/useSettingsStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function ReportsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const reports = resolveReportsSettings(settings.ui);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['reports']>) => {
    void vyotiq.settings
      .set({ ui: { reports: { ...settings.ui?.reports, ...patch } } })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save report settings: ${msg}`, 'danger');
      });
  };

  return (
    <ShellSection title="Reports" className="mt-4">
      <ShellCaption>
        HTML deliverables open in a dedicated report window or your system browser. Quick
        summary is always free; the AI report button uses your selected model.
      </ShellCaption>
      <SettingsSwitchRow
        label="Auto-open reports"
        description="Opens HTML when a new report completes during a run (not on app startup)."
        value={reports.autoOpenReports}
        onChange={(v) => apply({ autoOpenReports: v })}
      />
      <SettingsSwitchRow
        label="Open in Vyotiq browser"
        description="View reports in a dedicated in-app window instead of your system browser."
        value={reports.openInAppBrowser}
        onChange={(v) => apply({ openInAppBrowser: v })}
      />
      <SettingsSwitchRow
        label="Prompt after large edits"
        description="Vyotiq asks before generating a report at run end. Uses agent tokens only if you choose Yes."
        value={reports.promptForReportAfterEdits}
        onChange={(v) => apply({ promptForReportAfterEdits: v })}
      />
      <SettingsSwitchRow
        label="AI report button"
        description="Shows a token-costing footer action to request a full AI-authored HTML report."
        value={reports.enableAiRunSummary}
        onChange={(v) => apply({ enableAiRunSummary: v })}
      />
    </ShellSection>
  );
}
