/**
 * Floating overlay panels — Settings, Checkpoints, Inspector.
 * Does not push chat width; dim backdrop + resizable panel.
 */

import { lazy, Suspense } from 'react';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { usePersistedPanelWidth } from '../../hooks/usePersistedPanelWidth.js';

const SettingsPanel = lazy(() =>
  import('../settings/index.js').then((m) => ({ default: m.SettingsPanel }))
);
const CheckpointsPanel = lazy(() =>
  import('../checkpoints/CheckpointsView.js').then((m) => ({ default: m.CheckpointsPanel }))
);
const ContextInspectorBody = lazy(() =>
  import('../contextInspector/index.js').then((m) => ({
    default: m.ContextInspectorBody
  }))
);

const PANEL_TITLE: Record<string, string> = {
  settings: 'Settings',
  checkpoints: 'Checkpoints',
  inspector: 'Context inspector'
};

export function SecondaryZone() {
  const panel = useSecondaryZoneStore((s) => s.panel);
  const settingsTab = useSecondaryZoneStore((s) => s.settingsTab);
  const close = useSecondaryZoneStore((s) => s.close);
  const widthKey = panel ?? 'settings';
  const { initialWidth, onWidthChange } = usePersistedPanelWidth(widthKey);

  const title = panel ? PANEL_TITLE[panel] : '';

  return (
    <FloatingPanel
      open={panel !== null}
      onClose={close}
      title={title}
      widthKey={widthKey}
      initialWidth={initialWidth}
      onWidthChange={onWidthChange}
      showBackdrop={false}
    >
      <Suspense fallback={<LoadingHint />}>
        {panel === 'settings' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SettingsPanel initialTab={settingsTab} embedded />
          </div>
        )}
        {panel === 'checkpoints' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CheckpointsPanel embedded />
          </div>
        )}
        {panel === 'inspector' && <ContextInspectorBody />}
      </Suspense>
    </FloatingPanel>
  );
}
