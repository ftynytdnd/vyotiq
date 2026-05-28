import { useSettingsStore } from '../../store/useSettingsStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { applyAppTheme, themePrefsFromSettings, type AppDensity, type AppThemeMode } from '../../lib/theme.js';
import { ShellFieldLabel, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { Switch } from '../ui/Switch.js';

const THEMES: { id: AppThemeMode; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' }
];

const DENSITIES: { id: AppDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'airy', label: 'Airy' }
];

export function AppearancePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.refresh);

  const ui = settings.ui ?? {};
  const theme = ui.theme ?? 'dark';
  const density = ui.density ?? 'balanced';
  const reducedMotion = ui.reducedMotion ?? false;

  const apply = (next: Partial<typeof ui>) => {
    const merged = { ...ui, ...next };
    void vyotiq.settings.set({ ui: merged }).then(() => {
      applyAppTheme(themePrefsFromSettings({ ...settings, ui: merged }));
      void setSettings();
    });
  };

  return (
    <ShellStack>
      <ShellSection title="Theme">
        <ShellRow>
          <ShellFieldLabel>Color scheme</ShellFieldLabel>
          <div className="flex flex-wrap gap-1">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`vx-btn px-2 py-1 text-row ${theme === t.id ? 'vx-btn-primary' : 'vx-btn-quiet'}`}
                onClick={() => apply({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </ShellRow>
      </ShellSection>
      <ShellSection title="Density">
        <ShellRow>
          <ShellFieldLabel>Spacing</ShellFieldLabel>
          <div className="flex flex-wrap gap-1">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`vx-btn px-2 py-1 text-row ${density === d.id ? 'vx-btn-primary' : 'vx-btn-quiet'}`}
                onClick={() => apply({ density: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </ShellRow>
      </ShellSection>
      <ShellSection title="Motion">
        <ShellRow>
          <ShellFieldLabel>Reduce motion</ShellFieldLabel>
          <Switch value={reducedMotion} onChange={(v) => apply({ reducedMotion: v })} />
        </ShellRow>
        <p className="text-meta text-text-faint">
          When on, disables shimmer and most transitions. Also respects your OS reduced-motion setting.
        </p>
      </ShellSection>
    </ShellStack>
  );
}
