/**
 * PanelFrame — inline panel chrome for the secondary zone. Provides
 * the same header rhythm as `Modal` (title + close) without portal,
 * scroll lock, or backdrop semantics.
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/IconButton.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

interface PanelFrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional trailing header slot (usage badges, etc.). */
  headerAside?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PanelFrame({
  title,
  onClose,
  children,
  headerAside,
  className,
  contentClassName
}: PanelFrameProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-surface-base', className)}>
      <SurfaceShell className={cn('mx-3 mt-3 shrink-0', surfaceShellInnerClassName('compact'))}>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
            {title}
          </h2>
          {headerAside}
          <IconButton label="Close panel" onClick={onClose}>
            <X className="h-4 w-4" strokeWidth={2.25} />
          </IconButton>
        </div>
      </SurfaceShell>
      <div
        className={cn(
          'scrollbar-stealth min-h-0 flex-1 overflow-y-auto px-3 py-3',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
