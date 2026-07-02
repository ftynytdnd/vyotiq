/**
 * Frameless title bar — compact app menu and window controls.
 * Center zone shows settings breadcrumb when settings is open.
 */

import { useRef } from 'react';
import { WindowControls } from './WindowControls.js';
import { HamburgerMenu } from './HamburgerMenu.js';
import { type FileMenuActions } from './menu/menus/FileMenu.js';
import { useTitlebarHeight } from '../../hooks/useTitlebarHeight.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useWorkbenchActive } from '../workbench/useWorkbenchActive.js';
import { isPlaceholderChatTitle } from '../dock/displayChatTitles.js';
import { WorkspaceContextBar } from '../workspace/WorkspaceContextBar.js';
import { SETTINGS_SECTION_LABELS } from '@shared/settings/settingsSection.js';
import {
  AGENT_BEHAVIOR_SECTION_LABELS,
  resolveAgentBehaviorSectionId
} from '@shared/settings/agentBehaviorSection.js';
import {
  TITLEBAR_BREADCRUMB_ZONE_CLASS,
  TITLEBAR_LEFT_CLUSTER_CLASS,
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_RIGHT_CLUSTER_CLASS,
  TITLEBAR_ROOT_CLASS,
  TITLEBAR_WINDOW_ZONE_CLASS
} from './titlebarShared.js';
import { TitlebarDockChrome, TitlebarWorkbenchChrome } from './TitlebarChrome.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
  onBackFromSettings: () => void;
}

function SettingsBreadcrumb({
  sectionLabel,
  subsectionLabel
}: {
  sectionLabel: string;
  subsectionLabel?: string;
}) {
  return (
    <span className="vx-titlebar-breadcrumb truncate text-text-muted">
      <span className="text-text-faint">Settings</span>
      <span className="px-1 text-text-faint" aria-hidden>
        ›
      </span>
      {subsectionLabel ? (
        <>
          <span className="text-text-faint">{sectionLabel}</span>
          <span className="px-1 text-text-faint" aria-hidden>
            ›
          </span>
          <span className="text-text-primary">{subsectionLabel}</span>
        </>
      ) : (
        <span className="text-text-primary">{sectionLabel}</span>
      )}
    </span>
  );
}

export function TitleBar({ fileActions, onBackFromSettings }: TitleBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  useTitlebarHeight(rootRef);

  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const appView = useAppViewStore((s) => s.view);
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const settingsSection = useAppViewStore((s) => s.settingsSection);
  const aboutOpen = useAppViewStore((s) => s.aboutOpen);
  const lastAgentBehaviorSection = useSettingsStore(
    (s) => s.settings.ui?.lastAgentBehaviorSection
  );
  const activeSection = aboutOpen ? 'about' : settingsSection;
  const sectionLabel = settingsOpen ? SETTINGS_SECTION_LABELS[activeSection] : null;
  const agentSubsectionLabel =
    settingsOpen && activeSection === 'agent-behavior'
      ? AGENT_BEHAVIOR_SECTION_LABELS[
          resolveAgentBehaviorSectionId(lastAgentBehaviorSection, 'memory')
        ]
      : undefined;

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaceEntry = useWorkspaceStore((s) => {
    const entry = s.activeId ? s.list.find((w) => w.id === s.activeId) : undefined;
    return entry ?? null;
  });
  const workspaceLabel = workspaceEntry?.label ?? '';
  const activeChatId = useConversationsStore((s) =>
    activeWorkspaceId ? s.activeIdByWorkspace[activeWorkspaceId] : undefined
  );
  const chatTitle = useConversationsStore((s) => {
    if (!activeChatId) return null;
    const conv = s.list.find((c) => c.id === activeChatId);
    if (!conv) return null;
    return isPlaceholderChatTitle(conv.title) ? 'Untitled' : conv.title;
  });

  const events = useChatStore((s) => s.events);
  const workbenchActive = useWorkbenchActive();
  const isEmptyChatLanding =
    appView === 'chat' && !settingsOpen && events.length === 0 && !workbenchActive;

  const showChatBreadcrumb =
    appView === 'chat' &&
    !settingsOpen &&
    !dockExpanded &&
    !isEmptyChatLanding &&
    workspaceLabel.length > 0 &&
    activeWorkspaceId &&
    chatTitle;

  return (
    <header ref={rootRef} className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_LEFT_CLUSTER_CLASS}>
        <div className={TITLEBAR_MENUBAR_ZONE_CLASS}>
          <HamburgerMenu fileActions={fileActions} />
        </div>
        <TitlebarDockChrome onBackFromSettings={onBackFromSettings} />
      </div>

      <div
        className={TITLEBAR_BREADCRUMB_ZONE_CLASS}
        aria-hidden={!settingsOpen && !showChatBreadcrumb}
      >
        {sectionLabel ? (
          <SettingsBreadcrumb
            sectionLabel={sectionLabel}
            subsectionLabel={agentSubsectionLabel}
          />
        ) : showChatBreadcrumb ? (
          <WorkspaceContextBar
            workspaceId={activeWorkspaceId!}
            workspaceLabel={workspaceLabel}
            variant="breadcrumb"
            chatTitle={chatTitle}
            className="vx-titlebar-breadcrumb max-w-full"
          />
        ) : null}
      </div>

      <div className={TITLEBAR_RIGHT_CLUSTER_CLASS}>
        <TitlebarWorkbenchChrome />
        <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
          <WindowControls />
        </div>
      </div>
    </header>
  );
}
