/**
 * NestedDetailRail — the small left-bordered indent block that wraps
 * expanded-detail content under a Cascade-style log line. Shared by
 * `SubAgentTrace`, `ReasoningLineRow`, `ToolGroupRow`, `FileEditGroupRow`,
 * and `InvocationShell` so visual hierarchy stays exactly consistent
 * across every nestable surface.
 *
 * Style invariants (must match the existing ad-hoc copies):
 *   - 14px left margin so the rail aligns with the chevron's center.
 *   - `mt-1 pb-2 pl-3` padding around the inner content.
 *   - `border-l border-border-subtle/60` for the rail itself.
 *   - Children flow vertically with a small `gap-1.5` by default; pass
 *     a `gap` prop to override (e.g. tool-group needs `gap-1`).
 */

import { type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

interface NestedDetailRailProps {
  children: ReactNode;
  /** Tailwind gap class. Defaults to `gap-1.5`. */
  gap?: string;
  className?: string;
}

export function NestedDetailRail({
  children,
  gap = 'gap-1.5',
  className
}: NestedDetailRailProps) {
  return (
    <div
      className={cn(
        'ml-[14px] mt-1 flex flex-col border-l border-border-subtle/60 pl-3 pb-2',
        gap,
        className
      )}
    >
      {children}
    </div>
  );
}
