/**
 * TextField — Vyotiq UI border-bottom input (`vx-input`) or filled inset (legacy).
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type TextFieldSize = 'sm' | 'md' | 'lg';
type TextFieldTone = 'base' | 'raised' | 'overlay' | 'transparent';
type TextFieldAppearance = 'underline' | 'filled' | 'boxed';

const SIZE_CLASS: Record<TextFieldSize, string> = {
  sm: 'text-row',
  md: 'text-row',
  lg: 'text-body'
};

const TONE_CLASS: Record<TextFieldTone, string> = {
  base: 'bg-surface-base',
  raised: 'bg-surface-raised',
  overlay: 'bg-surface-overlay',
  transparent: 'bg-transparent'
};

const FILLED_SIZE: Record<TextFieldSize, string> = {
  sm: 'h-7 px-2',
  md: 'h-8 px-2.5',
  lg: 'h-9 px-3'
};

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: TextFieldSize;
  tone?: TextFieldTone;
  appearance?: TextFieldAppearance;
};

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { className, type = 'text', size = 'md', tone = 'base', appearance = 'underline', ...rest },
    ref
  ) {
    if (appearance === 'underline') {
      return (
        <input
          ref={ref}
          type={type}
          className={cn(
            'vx-input app-no-drag',
            SIZE_CLASS[size],
            'disabled:cursor-not-allowed disabled:opacity-50',
            type === 'number' &&
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
            className
          )}
          {...rest}
        />
      );
    }

    if (appearance === 'boxed') {
      return (
        <input
          ref={ref}
          type={type}
          className={cn(
            'vx-input-boxed app-no-drag',
            SIZE_CLASS[size],
            'disabled:cursor-not-allowed disabled:opacity-50',
            type === 'number' &&
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
            className
          )}
          {...rest}
        />
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'app-no-drag rounded-inner text-text-primary outline-none focus:outline-none',
          FILLED_SIZE[size],
          SIZE_CLASS[size],
          TONE_CLASS[tone],
          'placeholder:text-text-muted',
          'disabled:cursor-not-allowed disabled:opacity-50',
          type === 'number' &&
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          className
        )}
        {...rest}
      />
    );
  }
);
