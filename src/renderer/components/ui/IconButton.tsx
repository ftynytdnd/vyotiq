import React from 'react';
import { cn } from '../../lib/cn.js';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, label, active, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'app-no-drag inline-flex h-8 w-8 items-center justify-center rounded-inner',
          'text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          active && 'bg-surface-hover text-text-primary',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
