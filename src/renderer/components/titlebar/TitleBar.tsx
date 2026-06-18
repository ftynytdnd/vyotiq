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
import { SETTINGS_SECTION_LABELS } from '@shared/settings/settingsSection.js';
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
  onOpenSettings: () => void;
  onBackFromSettings: () => void;
}

export function TitleBar({ fileActions, onOpenSettings, onBackFromSettings }: TitleBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  useTitlebarHeight(rootRef);

  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const settingsSection = useAppViewStore((s) => s.settingsSection);
  const aboutOpen = useAppViewStore((s) => s.aboutOpen);
  const activeSection = aboutOpen ? 'about' : settingsSection;
  const breadcrumbLabel = settingsOpen ? SETTINGS_SECTION_LABELS[activeSection] : null;

  return (
    <header ref={rootRef} className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_LEFT_CLUSTER_CLASS}>
        <div className={TITLEBAR_MENUBAR_ZONE_CLASS}>
          <HamburgerMenu fileActions={fileActions} />
        </div>
        <TitlebarDockChrome
          onOpenSettings={onOpenSettings}
          onBackFromSettings={onBackFromSettings}
        />
      </div>

      <div
        className={TITLEBAR_BREADCRUMB_ZONE_CLASS}
        aria-hidden={!settingsOpen}
      >
        {breadcrumbLabel ? (
          <span className="vx-titlebar-breadcrumb truncate text-text-muted">
            <span className="text-text-faint">Settings</span>
            <span className="px-1 text-text-faint" aria-hidden>
              ›
            </span>
            {breadcrumbLabel}
          </span>
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
