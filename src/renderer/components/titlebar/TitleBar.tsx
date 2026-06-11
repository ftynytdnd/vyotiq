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
  TITLEBAR_MENUBAR_ZONE_CLASS,
  TITLEBAR_MENUBAR_ZONE_STYLE,
  TITLEBAR_ROOT_CLASS,
  TITLEBAR_WINDOW_ZONE_CLASS
} from './titlebarShared.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
}

export function TitleBar({ fileActions }: TitleBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  useTitlebarHeight(rootRef);

  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const settingsSection = useAppViewStore((s) => s.settingsSection);
  const aboutOpen = useAppViewStore((s) => s.aboutOpen);
  const activeSection = aboutOpen ? 'about' : settingsSection;
  const breadcrumbLabel = settingsOpen ? SETTINGS_SECTION_LABELS[activeSection] : null;

  return (
    <header ref={rootRef} className={TITLEBAR_ROOT_CLASS}>
      <div className={TITLEBAR_MENUBAR_ZONE_CLASS} style={TITLEBAR_MENUBAR_ZONE_STYLE}>
        <HamburgerMenu fileActions={fileActions} />
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

      <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
        <WindowControls />
      </div>
    </header>
  );
}
