/**
 * Switch — Vyotiq UI square-thumb toggle (`vx-toggle-track`).
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type SwitchSize = 'sm' | 'md';

interface SwitchProps {
  value: boolean;
  onChange: (next: boolean) => void;
  size?: SwitchSize;
  label?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const TRACK_CLASS: Record<SwitchSize, string> = {
  sm: 'h-[1.125rem] w-[2.75rem]',
  md: 'h-[1.125rem] w-[2.75rem]'
};

function SwitchTrack({ size, value }: { size: SwitchSize; value: boolean }) {
  return (
    <span
      aria-hidden
      data-on={value ? 'true' : 'false'}
      className={cn('vx-toggle-track', TRACK_CLASS[size])}
    >
      <span className="vx-toggle-thumb" />
    </span>
  );
}

export function Switch({
  value,
  onChange,
  size = 'sm',
  label,
  ariaLabel,
  disabled,
  className,
  id
}: SwitchProps) {
  const handleClick = () => {
    if (disabled) return;
    onChange(!value);
  };

  const commonButtonProps: React.ButtonHTMLAttributes<HTMLButtonElement> = {
    type: 'button',
    role: 'switch',
    'aria-checked': value,
    disabled,
    onClick: handleClick,
    ...(id ? { id } : {}),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {})
  };

  if (label !== undefined) {
    return (
      <button
        {...commonButtonProps}
        className={cn(
          'app-no-drag vx-toggle-row',
          disabled && 'cursor-not-allowed opacity-50',
          className
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <SwitchTrack size={size} value={value} />
      </button>
    );
  }

  return (
    <button
      {...commonButtonProps}
      data-on={value ? 'true' : 'false'}
      className={cn(
        'app-no-drag vx-toggle-track',
        TRACK_CLASS[size],
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span className="vx-toggle-thumb" />
    </button>
  );
}
