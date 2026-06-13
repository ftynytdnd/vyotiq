import { useEffect, useState } from 'react';
import { Cloud, BarChart3, Brain, FolderTree, Info, Keyboard, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProvidersPanel } from './ProvidersPanel.js';
import { UsagePanel } from './UsagePanel.js';
import { AgentBehaviorPanel } from './AgentBehaviorPanel.js';
import { AppearancePanel } from './AppearancePanel.js';
import { WorkspaceDataPanel } from './WorkspaceDataPanel.js';
import { AboutPanel } from './AboutPanel.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useAppViewStore, type SettingsSectionId } from '../../store/useAppViewStore.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Notice } from '../ui/Notice.js';
import { Button } from '../ui/Button.js';
import { RegionErrorBoundary } from '../RegionErrorBoundary.js';
import { LeftSubnav, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import { ShellStack } from '../ui/ShellSection.js';
import {
  SHELL_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';

type NavGroup = { label: string; items: { id: SettingsSectionId; label: string; Icon: LucideIcon }[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Models & API',
    items: [
      { id: 'models-api', label: 'Models & API', Icon: Cloud },
      { id: 'usage', label: 'Usage', Icon: BarChart3 }
    ]
  },
  {
    label: 'Agent',
    items: [{ id: 'agent-behavior', label: 'Agent behavior', Icon: Brain }]
  },
  {
    label: 'Workspace',
    items: [{ id: 'workspace-data', label: 'Workspace data', Icon: FolderTree }]
  },
  {
    label: 'Interface',
    items: [
      { id: 'appearance', label: 'Appearance', Icon: Palette },
      { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard }
    ]
  }
];

const FLAT_SECTIONS = NAV_GROUPS.flatMap((g) => g.items);

const ABOUT_NAV_ITEM = {
  id: 'about' as const,
  label: 'About',
  Icon: Info
};

interface SettingsFullViewProps {
  initialSection?: SettingsSectionId;
}

export function SettingsFullView({ initialSection = 'models-api' }: SettingsFullViewProps) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const loading = useSettingsStore((s) => s.loading);
  const loadError = useSettingsStore((s) => s.loadError);
  const refreshSettings = useSettingsStore((s) => s.refresh);
  const persistSection = useAppViewStore((s) => s.setSettingsSection);
  const aboutOpen = useAppViewStore((s) => s.aboutOpen);
  const openAbout = useAppViewStore((s) => s.openAbout);
  const closeAbout = useAppViewStore((s) => s.closeAbout);

  useEffect(() => setSection(initialSection), [initialSection]);
  useEffect(() => {
    if (aboutOpen) setSection('about');
  }, [aboutOpen]);

  const onSectionChange = (next: SettingsSectionId) => {
    if (next === 'about') {
      openAbout();
      return;
    }
    closeAbout();
    setSection(next);
    persistSection(next);
  };

  const activeSection = aboutOpen ? 'about' : section;

  const navItems: LeftSubnavItem<SettingsSectionId>[] = [
    ...FLAT_SECTIONS.map((t) => ({
      id: t.id,
      label: t.label,
      tabId: `settings-tab-${t.id}`,
      panelId: `settings-panel-${t.id}`,
      icon: <t.Icon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} aria-hidden />
    })),
    {
      id: ABOUT_NAV_ITEM.id,
      label: ABOUT_NAV_ITEM.label,
      tabId: 'settings-tab-about',
      panelId: 'settings-panel-about',
      icon: (
        <ABOUT_NAV_ITEM.Icon
          className={SHELL_TAB_ICON_CLASS}
          strokeWidth={SHELL_TAB_ICON_STROKE}
          aria-hidden
        />
      )
    }
  ];

  const panelId = activeSection;

  return (
    <div className="vx-settings-full-view flex h-full min-h-0 flex-col bg-surface-base">
      <div className="vx-settings-shell mx-auto flex min-h-0 w-full max-w-5xl flex-1 overflow-hidden px-[clamp(0.875rem,3vw,1.5rem)]">
        <aside className="vx-settings-inpane-nav shrink-0 pt-3 pb-3">
          <h1 className="vx-settings-nav-title text-hero font-medium text-text-primary">Settings</h1>
          <LeftSubnav<SettingsSectionId>
            items={navItems}
            value={activeSection}
            onChange={onSectionChange}
            ariaLabel="Settings sections"
            className="mt-2 py-1"
            footer={
              loading ? (
                <div className="mt-2 px-2" aria-live="polite">
                  <LoadingHint message="Syncing…" className="py-2" />
                </div>
              ) : null
            }
          />
        </aside>

        <div
          role="tabpanel"
          id={`settings-panel-${panelId}`}
          aria-labelledby={`settings-tab-${panelId}`}
          className="vx-settings-inpane-content scrollbar-stealth min-h-0 min-w-0 flex-1 overflow-y-auto py-3 pb-3"
        >
          <RegionErrorBoundary label="Settings">
            {loadError ? (
              <Notice
                tone="danger"
                title="Failed to load settings."
                actions={
                  <Button variant="secondary" onClick={() => void refreshSettings()}>
                    Retry
                  </Button>
                }
              >
                <span className="break-words">{loadError}</span>
              </Notice>
            ) : aboutOpen ? (
              <ShellStack>
                <AboutPanel />
              </ShellStack>
            ) : (
              <ShellStack>
                {section === 'models-api' && <ProvidersPanel />}
                {section === 'usage' && <UsagePanel />}
                {section === 'agent-behavior' && <AgentBehaviorPanel />}
                {section === 'workspace-data' && <WorkspaceDataPanel />}
                {section === 'appearance' && <AppearancePanel />}
                {section === 'shortcuts' && <ShortcutsPanel />}
              </ShellStack>
            )}
          </RegionErrorBoundary>
        </div>
      </div>
    </div>
  );
}
