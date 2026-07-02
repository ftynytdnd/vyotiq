/**
 * Settings → Agent behavior — screen capture picker privacy options.
 */

import { resolveCaptureSettings } from '@shared/settings/captureSettings.js';
import { useSettingsPatch } from '../../hooks/useSettingsPatch.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function CapturePanel() {
  const { settings, apply: applySettings } = useSettingsPatch('capture settings');
  const resolved = resolveCaptureSettings(settings.ui);
  const capture = settings.ui?.capture ?? {};

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['capture']>) => {
    applySettings({ ui: { capture: { ...capture, ...patch } } });
  };

  return (
    <ShellSection className="vx-capture-settings-panel">
      <ShellCaption>
        Screen and window capture is user-initiated from the composer camera button only — Vyotiq
        never captures your display in the background. Captures are saved under{' '}
        <code>.vyotiq/captures/</code> in the active workspace and attached to your message.
      </ShellCaption>
      <SettingsSwitchRow
        label="Redact sensitive window titles"
        description="Hide banking, password-manager, and sign-in window names in the capture picker list. The screenshot itself is unchanged."
        value={resolved.redactWindowTitles}
        onChange={(redactWindowTitles) => apply({ redactWindowTitles })}
      />
    </ShellSection>
  );
}
