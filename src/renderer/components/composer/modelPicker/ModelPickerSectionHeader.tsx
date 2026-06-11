/**
 * Section title for Recent, Favorites, Local, and Cloud blocks.
 */

import { Eyebrow } from '../../ui/Eyebrow.js';
import { cn } from '../../../lib/cn.js';

interface ModelPickerSectionHeaderProps {
  label: string;
  /** Local / Cloud use uppercase eyebrow styling. */
  variant?: 'pinned' | 'category';
  count?: number;
}

export function ModelPickerSectionHeader({
  label,
  variant = 'pinned',
  count
}: ModelPickerSectionHeaderProps) {
  const title = count !== undefined ? `${label} · ${count}` : label;
  return (
    <div className="vx-model-picker-section-head">
      <Eyebrow
        as="span"
        bold={variant === 'category'}
        className={cn(
          'text-text-faint',
          variant === 'category' && 'uppercase tracking-wide',
          variant === 'pinned' && 'normal-case tracking-normal'
        )}
      >
        {title}
      </Eyebrow>
    </div>
  );
}
