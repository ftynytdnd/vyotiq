/**
 * Section title for Recent, Favorites, Local, and Cloud blocks.
 */

import { Eyebrow } from '../../ui/Eyebrow.js';
import { cn } from '../../../lib/cn.js';

interface ModelPickerSectionHeaderProps {
  label: string;
  /** Local / Cloud use uppercase eyebrow styling. */
  variant?: 'pinned' | 'category';
}

export function ModelPickerSectionHeader({
  label,
  variant = 'pinned'
}: ModelPickerSectionHeaderProps) {
  return (
    <div className="vx-model-picker-section-head px-2 py-0.5">
      <Eyebrow
        as="span"
        bold={variant === 'category'}
        className={cn(
          'text-text-faint',
          variant === 'category' && 'uppercase tracking-wide',
          variant === 'pinned' && 'normal-case tracking-normal'
        )}
      >
        {label}
      </Eyebrow>
    </div>
  );
}
