import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
    ?? '';
  return /mac/i.test(p);
}

function platformModKey(): string {
  return isMacPlatform() ? '\u2318' : 'Ctrl';
}

function platformAltKey(): string {
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
    <div role="dialog" aria-label="Keyboard shortcuts" className="vx-stack gap-3">
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
    <section className="vx-section">
      <h3 className="vx-section-head mb-1">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function ShortcutRow({ combo, label }: { combo: string; label: string }) {
  return (
    <div className="vx-row flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="min-w-0 truncate text-row text-text-muted">{label}</span>
      <kbd
        className={cn(
          'shrink-0 rounded-inner border border-border-subtle/25 bg-surface-overlay/40',
          'px-1.5 py-0.5 font-mono text-meta tracking-tight text-text-secondary'
        )}
      >
        {combo}
      </kbd>
    </div>
  );
}
