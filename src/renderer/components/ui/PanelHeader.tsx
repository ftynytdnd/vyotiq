/**
 * PanelHeader — title row + close X with the optional actions slot
 * shared by {@link FloatingPanel} and {@link ComposerDialog}. Keeps
 * both surfaces visually identical (same hairline, same height, same
 * X button placement) so the chrome reads as one family.
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../lib/shellIcons.js';

export interface PanelHeaderProps {
  /** Title text. */
  title: ReactNode;
  /** Stable id — wire as `aria-labelledby` on the parent dialog. */
  titleId?: string;
  /** Optional actions inserted between the title and the close X. */
  actions?: ReactNode;
  /** Close handler — fired by the X button. */
  onClose: () => void;
  /** Close-button accessible label. Defaults to "Close". */
  closeLabel?: string;
  /** Optional badge (e.g. "Approval 2 of 5") rendered next to the title. */
  badge?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  titleId,
  actions,
  onClose,
  closeLabel = 'Close',
  badge,
  className
}: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-border-subtle/20 px-3 py-2',
        className
      )}
    >
      <h2
        id={titleId}
        className="min-w-0 flex-1 truncate text-section font-medium text-text-primary"
      >
        {title}
      </h2>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      {actions}
      <button
        type="button"
        className="vx-btn vx-btn-quiet px-2"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
      </button>
    </header>
  );
}
