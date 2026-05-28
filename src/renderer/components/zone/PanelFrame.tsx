/**
 * PanelFrame — inline panel chrome for the secondary zone. Flat header
 * (title + close); no inset shell box around the title row.
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/IconButton.js';
import { chromeEdgeClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

interface PanelFrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
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
      <div
        className={cn(
          'mx-3 flex shrink-0 items-center gap-2 border-b py-2',
          chromeEdgeClassName
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-row font-semibold text-text-primary">
          {title}
        </h2>
        {headerAside}
        <IconButton label="Close panel" onClick={onClose}>
          <X className="h-4 w-4" strokeWidth={2.25} />
        </IconButton>
      </div>
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
