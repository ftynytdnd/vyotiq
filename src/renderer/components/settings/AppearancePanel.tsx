import { useSettingsStore } from '../../store/useSettingsStore.js';
import {
  applyAppTheme,
  themePrefsFromSettings,
  type AppDensity,
  type AppThemeMode
} from '../../lib/theme.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellFieldLabel, ShellRow, ShellRowSplit, ShellSection } from '../ui/ShellSection.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

const THEME_TABS: TabItem<AppThemeMode>[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' }
];

const DENSITY_TABS: TabItem<AppDensity>[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'airy', label: 'Airy' }
];

export function AppearancePanel() {
  const settings = useSettingsStore((s) => s.settings);

  const ui = settings.ui ?? {};
  const theme = ui.theme ?? 'dark';
  const density = ui.density ?? 'balanced';
  const reducedMotion = ui.reducedMotion ?? false;

  const apply = (next: Partial<typeof ui>) => {
    void persistSettingsPatch({ ui: next })
      .then((updated) => {
        applyAppTheme(themePrefsFromSettings(updated));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save appearance settings: ${msg}`, 'danger');
      });
  };

  return (
    <ShellSection>
      <ShellRow>
        <ShellRowSplit
          main={<ShellFieldLabel>Color scheme</ShellFieldLabel>}
          control={
            <Tabs<AppThemeMode>
              items={THEME_TABS}
              value={theme}
              onChange={(id) => apply({ theme: id })}
              variant="segmented"
              size="md"
              ariaLabel="Color scheme"
            />
          }
        />
      </ShellRow>
      <ShellRow>
        <ShellRowSplit
          main={<ShellFieldLabel>Spacing</ShellFieldLabel>}
          control={
            <Tabs<AppDensity>
              items={DENSITY_TABS}
              value={density}
              onChange={(id) => apply({ density: id })}
              variant="segmented"
              size="md"
              ariaLabel="UI density"
            />
          }
        />
      </ShellRow>
      <SettingsSwitchRow
        label="Reduce motion"
        description="Less animation; honors your OS reduced-motion preference."
        value={reducedMotion}
        onChange={(v) => apply({ reducedMotion: v })}
      />
    </ShellSection>
  );
}
