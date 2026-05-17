/**
 * Small labeled container for a section of expanded invocation detail.
 * Keeps per-tool components visually consistent without forcing a layout.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn.js';

interface DetailPaneProps {
  label: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

export function DetailPane({ label, tone = 'default', children }: DetailPaneProps) {
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'mb-0.5 text-meta font-medium uppercase tracking-wider',
          tone === 'danger' ? 'text-danger' : 'text-text-faint'
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
