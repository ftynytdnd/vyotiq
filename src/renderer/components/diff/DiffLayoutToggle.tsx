/**
 * Redesigned unified / split diff layout toggle — single control reused
 * by timeline, checkpoints review, and edit approval surfaces.
 */

import { cn } from '../../lib/cn.js';
import type { DiffLayoutMode } from './diffLayoutPref.js';

interface DiffLayoutToggleProps {
  value: DiffLayoutMode;
  onChange: (mode: DiffLayoutMode) => void;
  className?: string;
}

export function DiffLayoutToggle({ value, onChange, className }: DiffLayoutToggleProps) {
  return (
    <div
      role="group"
      aria-label="Diff layout"
      className={cn('vx-diff-layout-toggle', className)}
    >
      <button
        type="button"
        className={cn('vx-diff-layout-toggle__btn', value === 'unified' && 'is-active')}
        aria-pressed={value === 'unified'}
        onClick={() => onChange('unified')}
      >
        Unified
      </button>
      <button
        type="button"
        className={cn('vx-diff-layout-toggle__btn', value === 'split' && 'is-active')}
        aria-pressed={value === 'split'}
        onClick={() => onChange('split')}
      >
        Split
      </button>
    </div>
  );
}
