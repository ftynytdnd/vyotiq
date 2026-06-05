import { useEffect, useState } from 'react';
import { ArrowLeft, Brain, Cloud, FolderTree, Info, Keyboard, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProvidersPanel } from './ProvidersPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { AppearancePanel } from './AppearancePanel.js';
import { WorkspaceDataPanel } from './WorkspaceDataPanel.js';
import { AboutPanel } from './AboutPanel.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useAppViewStore, type SettingsSectionId } from '../../store/useAppViewStore.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { LeftSubnav, LeftSubnavLayout, type LeftSubnavItem } from '../ui/LeftSubnav.js';
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
  const closeSettings = useAppViewStore((s) => s.closeSettings);
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

  const navItems: LeftSubnavItem<SettingsSectionId>[] = FLAT_SECTIONS.map((t) => ({
    id: t.id,
    label: t.label,
    tabId: `settings-tab-${t.id}`,
    panelId: `settings-panel-${t.id}`,
    icon: <t.Icon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} aria-hidden />
  }));

  const activeSection = aboutOpen ? 'about' : section;

  return (
    <div className="vx-settings-full-view flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle/40 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={closeSettings}
          className="app-no-drag"
          aria-label="Back to chat"
        >
          <ArrowLeft className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} />
          Back to chat
        </Button>
        <span className="text-row font-medium text-text-primary">Settings</span>
      </header>

      <LeftSubnavLayout
        className="min-h-0 flex-1"
        contentClassName="scrollbar-stealth overflow-y-auto px-[clamp(0.875rem,3vw,1.5rem)] py-3"
        nav={
          <LeftSubnav<SettingsSectionId>
            items={navItems}
            value={activeSection === 'about' ? 'models-api' : activeSection}
            onChange={onSectionChange}
            ariaLabel="Settings sections"
            className="px-2 py-3"
            footer={
              <div className="mt-auto border-t border-border-subtle/30 pt-2">
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
        }
      >
        <div
          role="tabpanel"
          id={`settings-panel-${activeSection}`}
          aria-labelledby={`settings-tab-${activeSection}`}
          className="relative min-h-0"
        >
          {aboutOpen ? (
            <ShellStack>
              <AboutPanel />
            </ShellStack>
          ) : (
            <ShellStack>
              {section === 'models-api' && <ProvidersPanel />}
              {section === 'agent-behavior' && <MemoryPanel />}
              {section === 'workspace-data' && <WorkspaceDataPanel />}
              {section === 'appearance' && <AppearancePanel />}
              {section === 'shortcuts' && <ShortcutsPanel />}
            </ShellStack>
          )}
        </div>
      </LeftSubnavLayout>
    </div>
  );
}
