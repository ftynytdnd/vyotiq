import { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Settings } from 'lucide-react';
import { NavItem } from './NavItem.js';
import { Popover } from '../ui/Popover.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { cn } from '../../lib/cn.js';

interface SidebarFooterProps {
  onOpenSettings: () => void;
  /**
   * The scroll container of the chats list. The footer paints a hairline
   * border-top only when this container is overflowing, so the divider
   * appears as a subtle scroll-shadow rather than a permanent rule.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Detect whether the host platform is macOS so the shortcut hint row can
 * render the glyph `⌘` instead of `Ctrl`. Falls back to `Ctrl` everywhere
 * else (Windows, Linux, SSR).
 */
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

export function SidebarFooter({
  onOpenSettings,
  scrollContainerRef
}: SidebarFooterProps) {
  const [overflows, setOverflows] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const mod = useMemo(platformModKey, []);
  const alt = useMemo(platformAltKey, []);

  useEffect(() => {
    const el = scrollContainerRef?.current;
    if (!el) return;
    const measure = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Re-measure when descendants change (new conversation row, etc.).
    const mut = new MutationObserver(measure);
    mut.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mut.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollContainerRef]);

  return (
    <div
      className={cn(
        'p-2 transition-colors duration-150',
        overflows ? 'border-t border-border-subtle/40' : 'border-t border-transparent'
      )}
    >
      {/*
        Settings + a small `?` trigger live on the same row. The `?`
        button discloses the keyboard-shortcut popover on click — the
        always-visible 10 px hint block was illegible at production
        resolution, so this surface is now opt-in.
      */}
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <NavItem
            icon={<Settings className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Settings"
            onClick={onOpenSettings}
          />
        </div>
        <button
          ref={helpButtonRef}
          type="button"
          onClick={() => setShortcutsOpen((v) => !v)}
          aria-label="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          aria-haspopup="dialog"
          title="Keyboard shortcuts"
          className={cn(
            'app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-inner',
            'text-text-muted transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text-primary',
            shortcutsOpen && 'bg-surface-hover text-text-primary'
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <Popover
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        triggerRef={helpButtonRef}
        align="end"
        offset={8}
        className="elev-1 w-56 rounded-card bg-surface-overlay p-2.5"
      >
        <ShortcutsPanel mod={mod} alt={alt} />
      </Popover>
    </div>
  );
}

interface ShortcutsPanelProps {
  mod: string;
  alt: string;
}

/**
 * Popover content listing the shortcuts that `useSidebarShortcuts` wires
 * at the window level. Read-only by design — the popover is purely a
 * reference card. Reuses existing tokens (`text-row`, `text-text-muted`,
 * `surface-overlay`) and the global `font-mono` family for keycaps so no
 * new design tokens are introduced.
 */
function ShortcutsPanel({ mod, alt }: ShortcutsPanelProps) {
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" className="flex flex-col gap-1.5">
      <Eyebrow className="px-1 pb-0.5">Shortcuts</Eyebrow>
      <ShortcutRow combo={`${mod}+B`} label="Toggle sidebar" />
      <ShortcutRow combo={`${mod}+K`} label="Search chats" />
      <ShortcutRow combo={`${alt}+\u2191 / ${alt}+\u2193`} label="Prev / next chat" />
    </div>
  );
}

function ShortcutRow({ combo, label }: { combo: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-0.5 text-row">
      <span className="truncate text-text-secondary">{label}</span>
      <kbd
        className={cn(
          'shrink-0 rounded-inner font-mono text-row text-text-muted',
          'bg-surface-overlay px-1.5 py-0.5 tracking-tight'
        )}
      >
        {combo}
      </kbd>
    </div>
  );
}
