/**
 * Floating overlay panel — Settings only.
 */

import { lazy, Suspense } from 'react';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { usePersistedPanelWidth } from '../../hooks/usePersistedPanelWidth.js';
import { Button } from '../ui/Button.js';
import { AboutOverlay } from '../settings/AboutOverlay.js';

const SettingsPanel = lazy(() =>
  import('../settings/index.js').then((m) => ({ default: m.SettingsPanel }))
);

export function SecondaryZone() {
  const panel = useSecondaryZoneStore((s) => s.panel);
  const settingsTab = useSecondaryZoneStore((s) => s.settingsTab);
  const close = useSecondaryZoneStore((s) => s.close);
  const openSettings = useSecondaryZoneStore((s) => s.openSettings);
  const { initialWidth, onWidthChange } = usePersistedPanelWidth('settings');
  const aboutOpen = panel === 'settings' && settingsTab === 'about';

  return (
    <FloatingPanel
      open={panel !== null}
      onClose={close}
      title="Settings"
      widthKey="settings"
      initialWidth={initialWidth}
      onWidthChange={onWidthChange}
      showBackdrop={false}
      headerActions={
        panel === 'settings' && !aboutOpen ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openSettings('about')}
            className="app-no-drag"
          >
            About
          </Button>
        ) : null
      }
    >
      <Suspense fallback={<LoadingHint />}>
        {panel === 'settings' && (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <SettingsPanel
              initialTab={aboutOpen ? 'providers' : settingsTab}
              embedded
            />
            <AboutOverlay
              open={aboutOpen}
              onClose={() => openSettings('providers')}
            />
          </div>
        )}
      </Suspense>
    </FloatingPanel>
  );
}
