import React from 'react';
import { cn } from '../../lib/cn.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent text-surface-base hover:bg-accent-strong',
  secondary:
    'bg-surface-raised text-text-primary hover:bg-surface-hover',
  ghost:
    'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  danger:
    'bg-transparent text-danger hover:bg-danger/10'
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-row',
  md: 'h-9 px-3.5 text-body'
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'app-no-drag inline-flex items-center justify-center gap-1.5 rounded-inner font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
