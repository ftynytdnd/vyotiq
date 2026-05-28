import type { ReactNode } from 'react';
import { Eyebrow } from '../ui/Eyebrow.js';
import { cn } from '../../lib/cn.js';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
    ?? '';
  return /mac/i.test(p);
}

export function platformModKey(): string {
  return isMacPlatform() ? '\u2318' : 'Ctrl';
}

export function platformAltKey(): string {
  return isMacPlatform() ? '\u2325' : 'Alt';
}

/** Render a Windows-style shortcut label with the platform modifier. */
export function formatPlatformShortcut(shortcut: string): string {
  const mod = platformModKey();
  return shortcut
    .replace(/^Ctrl\+Shift\+/i, `${mod}+Shift+`)
    .replace(/^Ctrl\+/i, `${mod}+`);
}

interface ShortcutsPanelProps {
  mod?: string;
  alt?: string;
}

/**
 * Keyboard shortcut reference card. Shared between the title bar help
 * popover and any future surfaces that need the same listing.
 */
export function ShortcutsPanel({ mod = platformModKey(), alt = platformAltKey() }: ShortcutsPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="flex flex-col gap-2"
    >
      <ShortcutGroup title="Navigation">
        <ShortcutRow combo={`${mod}+B`} label="Toggle navigation dock" />
        <ShortcutRow combo={`${mod}+K`} label="Search chats" />
        <ShortcutRow combo={`${alt}+\u2191 / ${alt}+\u2193`} label="Prev / next chat" />
      </ShortcutGroup>
      <ShortcutGroup title="Workspace">
        <ShortcutRow combo={`${mod}+N`} label="New conversation" />
        <ShortcutRow combo={`${mod}+O`} label="Open workspace" />
        <ShortcutRow combo={`${mod}+,`} label="Settings" />
        <ShortcutRow combo={`${mod}+Shift+H`} label="Checkpoints" />
        <ShortcutRow combo={`${mod}+Shift+C`} label="Context Inspector" />
      </ShortcutGroup>
      <ShortcutGroup title="Timeline">
        <ShortcutRow combo="g j" label="Next user prompt" />
        <ShortcutRow combo="g k" label="Previous user prompt" />
        <ShortcutRow combo="Esc" label="Drop sticky scroll" />
      </ShortcutGroup>
      <ShortcutGroup title="Window">
        <ShortcutRow combo={`${mod}+R`} label="Reload" />
        <ShortcutRow combo={`${mod}+Shift+I`} label="Toggle DevTools" />
      </ShortcutGroup>
    </div>
  );
}

function ShortcutGroup({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Eyebrow className="px-1 pb-0.5">{title}</Eyebrow>
      {children}
    </div>
  );
}

function ShortcutRow({ combo, label }: { combo: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-0.5 text-row">
      <span className="truncate text-text-secondary">{label}</span>
      <kbd
        className={cn(
          'shrink-0 rounded-inner border border-border-subtle/30 px-1.5 py-0.5',
          'font-mono text-row tracking-tight text-text-muted'
        )}
      >
        {combo}
      </kbd>
    </div>
  );
}
