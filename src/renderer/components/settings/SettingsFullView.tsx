import { useEffect, useState } from 'react';
import { Brain, Cloud, FolderTree, Info, Keyboard, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProvidersPanel } from './ProvidersPanel.js';
import { AgentBehaviorPanel } from './AgentBehaviorPanel.js';
import { AppearancePanel } from './AppearancePanel.js';
import { WorkspaceDataPanel } from './WorkspaceDataPanel.js';
import { AboutPanel } from './AboutPanel.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useAppViewStore, type SettingsSectionId } from '../../store/useAppViewStore.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { LeftSubnav, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import { ShellStack } from '../ui/ShellSection.js';
import {
  SHELL_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

type NavGroup = { label: string; items: { id: SettingsSectionId; label: string; Icon: LucideIcon }[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Models & API',
    items: [{ id: 'models-api', label: 'Models & API', Icon: Cloud }]
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

interface SettingsFullViewProps {
  initialSection?: SettingsSectionId;
}

export function SettingsFullView({ initialSection = 'models-api' }: SettingsFullViewProps) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const loading = useSettingsStore((s) => s.loading);
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

  const navItems: LeftSubnavItem<SettingsSectionId>[] = FLAT_SECTIONS.map((t) => ({
    id: t.id,
    label: t.label,
    tabId: `settings-tab-${t.id}`,
    panelId: `settings-panel-${activeSection === 'about' ? 'about' : activeSection}`,
    icon: <t.Icon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} aria-hidden />
  }));

  const panelId = activeSection;

  return (
    <div className="vx-settings-full-view flex h-full min-h-0 flex-col bg-surface-base">
      <header className="vx-settings-header shrink-0 px-[clamp(0.875rem,3vw,1.5rem)] pt-3 pb-2">
        <h1 className="text-hero font-medium text-text-primary">Settings</h1>
      </header>

      <div className="vx-settings-inpane mx-auto flex min-h-0 w-full max-w-4xl flex-1 gap-3 overflow-hidden px-[clamp(0.875rem,3vw,1.5rem)] pb-3">
        <div className="vx-settings-inpane-nav shrink-0">
          <LeftSubnav<SettingsSectionId>
            items={navItems}
            value={activeSection === 'about' ? 'models-api' : activeSection}
            onChange={onSectionChange}
            ariaLabel="Settings sections"
            className="py-1"
            footer={
              <div className="mt-2 border-t border-border-subtle/20 pt-2">
                <button
                  type="button"
                  className={cn(
                    'vx-left-subnav-item app-no-drag w-full',
                    aboutOpen && 'bg-chrome-active'
                  )}
                  onClick={() => onSectionChange('about')}
                >
                  <Info className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} />
                  <span>About</span>
                </button>
                {loading ? (
                  <div className="mt-2 px-2" aria-live="polite">
                    <LoadingHint message="Syncing…" className="py-2" />
                  </div>
                ) : null}
              </div>
            }
          />
        </div>

        <div
          role="tabpanel"
          id={`settings-panel-${panelId}`}
          aria-labelledby={`settings-tab-${panelId}`}
          className="vx-settings-inpane-content scrollbar-stealth min-h-0 min-w-0 flex-1 overflow-y-auto py-1"
        >
          {aboutOpen ? (
            <ShellStack>
              <AboutPanel />
            </ShellStack>
          ) : (
            <ShellStack>
              {section === 'models-api' && <ProvidersPanel />}
              {section === 'agent-behavior' && <AgentBehaviorPanel />}
              {section === 'workspace-data' && <WorkspaceDataPanel />}
              {section === 'appearance' && <AppearancePanel />}
              {section === 'shortcuts' && <ShortcutsPanel />}
            </ShellStack>
          )}
        </div>
      </div>
    </div>
  );
}
