/**
 * Eyebrow — small-caps section label used to introduce a list, panel,
 * or block of related content. Captures the existing
 *
 *     uppercase tracking-wider text-text-faint
 *
 * substring shared by ~10 call sites across the renderer (workspace
 * group header in the sidebar, group titles in the model picker /
 * dropdown, web-search endpoint label in Settings, dialect tag in
 * ProviderRow, Shortcuts panel header, attachment-picker mention
 * breadcrumb, etc.).
 *
 * Variants:
 *   - `size`  — `'meta'` (10px, default) or `'row'` (11px). Reserved
 *               for future `text-row` callers; the form-field label
 *               family in `AddProviderForm` already uses `text-row`
 *               but is intentionally NOT migrated yet because it's
 *               structurally part of a label+input pair, not a free-
 *               standing eyebrow.
 *   - `bold`  — flips on `font-medium`. Mirrors the existing split:
 *               group/section headers tend to be bold; muted
 *               descriptors (dialect tag, shortcuts panel title) are
 *               not.
 *   - `as`    — `'div' | 'span' | 'label'`. Element choice mirrors
 *               each call site's existing DOM tree to avoid layout
 *               or accessibility drift.
 *
 * Positional spacing (px/pb/mt) stays caller-side via `className` so
 * each surface keeps its own rhythm.
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type EyebrowSize = 'meta' | 'row';
type EyebrowElement = 'div' | 'span' | 'label';

const SIZE_CLASS: Record<EyebrowSize, string> = {
  meta: 'text-meta',
  row: 'text-row'
};

interface EyebrowProps {
  size?: EyebrowSize;
  bold?: boolean;
  as?: EyebrowElement;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

export function Eyebrow({
  size = 'meta',
  bold = false,
  as = 'div',
  className,
  title,
  children
}: EyebrowProps) {
  const cls = cn(
    SIZE_CLASS[size],
    bold && 'font-medium',
    'uppercase tracking-wider text-text-faint',
    className
  );
  if (as === 'span') {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    );
  }
  if (as === 'label') {
    return (
      <label className={cls} title={title}>
        {children}
      </label>
    );
  }
  return (
    <div className={cls} title={title}>
      {children}
    </div>
  );
}
