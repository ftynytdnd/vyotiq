/**
 * RangeField — Vyotiq UI range slider (`vx-range`) with accent progress fill.
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type RangeFieldSize = 'sm' | 'md';

interface RangeFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: RangeFieldSize;
  /** 0–1 normalized value for accent progress track. */
  valueRatio: number;
}

const WIDTH_CLASS: Record<RangeFieldSize, string> = {
  sm: 'w-24',
  md: 'w-32'
};

export const RangeField = React.forwardRef<HTMLInputElement, RangeFieldProps>(
  function RangeField({ className, size = 'md', valueRatio, style, ...rest }, ref) {
    const pct = `${Math.round(Math.max(0, Math.min(1, valueRatio)) * 100)}%`;
    return (
      <input
        ref={ref}
        type="range"
        className={cn('vx-range app-no-drag', WIDTH_CLASS[size], className)}
        style={{ ...style, '--range-progress': pct } as React.CSSProperties}
        {...rest}
      />
    );
  }
);
