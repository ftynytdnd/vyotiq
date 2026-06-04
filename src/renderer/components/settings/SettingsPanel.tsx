import { ProvidersPanel } from './ProvidersPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { CheckpointSettingsPanel } from '../checkpoints/CheckpointSettingsPanel.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useEffect, useState } from 'react';
import { LoadingHint } from '../ui/LoadingHint.js';
import {
  ShellStack
} from '../ui/ShellSection.js';
import { LeftSubnav, LeftSubnavLayout, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import {
  secondaryZonePanelContentClassName
} from '../ui/SurfaceShell.js';
import {
  SHELL_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';
import {
  Brain,
  Cloud,
  History,
  Keyboard,
  Palette,
  type LucideIcon
} from 'lucide-react';
import { AppearancePanel } from './AppearancePanel.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { cn } from '../../lib/cn.js';
import type { SettingsTabId } from '../../store/useSecondaryZoneStore.js';

type TabId = SettingsTabId;

interface SettingsPanelProps {
  initialTab?: TabId;
  /** When true, uses compact layouts suited to the secondary zone column. */
  embedded?: boolean;
}

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'providers', label: 'Providers', Icon: Cloud },
  { id: 'checkpoints', label: 'Checkpoints', Icon: History },
  { id: 'memory', label: 'Memory', Icon: Brain },
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard }
];

/**
 * Settings body — rendered inside the secondary zone.
 */
export function SettingsPanel({ initialTab = 'providers', embedded = false }: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const loading = useSettingsStore((s) => s.loading);
  const persistSettingsTab = useSecondaryZoneStore((s) => s.setSettingsTab);
  useEffect(() => setTab(initialTab), [initialTab]);

  const navItems: LeftSubnavItem<TabId>[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    tabId: `settings-tab-${t.id}`,
    panelId: `settings-panel-${t.id}`,
    icon: <t.Icon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} aria-hidden />
  }));

  const onTabChange = (next: TabId) => {
    setTab(next);
    persistSettingsTab(next);
  };

  return (
    <LeftSubnavLayout
      className={cn('min-h-0', secondaryZonePanelContentClassName)}
      contentClassName="scrollbar-stealth overflow-y-auto"
      nav={
        <LeftSubnav<TabId>
          items={navItems}
          value={tab}
          onChange={onTabChange}
          ariaLabel="Settings sections"
          footer={
            loading ? (
              <div
                className="mt-2 flex items-center gap-1.5 px-2 text-meta text-text-faint"
                aria-live="polite"
              >
                <LoadingHint message="Syncing…" className="py-2" />
              </div>
            ) : undefined
          }
        />
      }
    >
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="min-h-0"
      >
        <ShellStack>
          {tab === 'providers' && <ProvidersPanel embedded={embedded} />}
          {tab === 'checkpoints' && <CheckpointSettingsPanel embedded={embedded} />}
          {tab === 'memory' && <MemoryPanel />}
          {tab === 'appearance' && <AppearancePanel />}
          {tab === 'shortcuts' && <ShortcutsPanel />}
        </ShellStack>
      </div>
    </LeftSubnavLayout>
  );
}
